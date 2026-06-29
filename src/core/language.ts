import fs from "node:fs/promises";
import path from "node:path";
import type { Language } from "./types.js";

const byExtension = new Map<string, Language>([
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".go", "go"],
  [".java", "java"],
  [".rs", "rust"],
  [".swift", "swift"],
  [".c", "c"],
  [".h", "c"],
  [".cpp", "cpp"],
  [".cc", "cpp"],
  [".cxx", "cpp"],
  [".hpp", "cpp"],
  [".hh", "cpp"],
  [".hxx", "cpp"],
  [".ipp", "cpp"],
  [".cs", "csharp"],
  [".kt", "kotlin"],
  [".kts", "kotlin"],
  [".php", "php"],
  [".phtml", "php"],
  [".dart", "dart"],
  [".tf", "terraform"],
  [".tfvars", "terraform"],
  [".hcl", "terraform"],
  [".qml", "qml"],
  [".cls", "apex"],
  [".trigger", "apex"],
  [".sql", "sql"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".md", "markdown"],
  [".mdx", "markdown"],
  [".json", "json"],
  [".jsonc", "json"],
  [".toml", "toml"],
  [".xml", "xml"],
  [".graphql", "graphql"],
  [".gql", "graphql"],
  [".proto", "proto"],
  [".gradle", "gradle"],
  [".rb", "ruby"],
  [".gemspec", "ruby"],
  [".ex", "elixir"],
  [".exs", "elixir"],
  [".sh", "shell"],
  [".bash", "shell"],
  [".zsh", "shell"]
]);

export type LanguageOverrides = ReadonlyMap<string, Language>;

const supportedOverrideLanguages = new Set<Language>(byExtension.values());

export async function loadLanguageOverrides(root: string): Promise<LanguageOverrides> {
  const configPath = path.join(root, ".repolens.json");
  const raw = await fs.readFile(configPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!raw) {
    return new Map();
  }
  try {
    return parseLanguageOverrides(JSON.parse(raw) as unknown, configPath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${configPath} must be valid JSON: ${error.message}`);
    }
    throw error;
  }
}

export function parseLanguageOverrides(value: unknown, source = ".repolens.json"): LanguageOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object.`);
  }
  const config = value as { languages?: unknown };
  if (config.languages === undefined) {
    return new Map();
  }
  if (!config.languages || typeof config.languages !== "object" || Array.isArray(config.languages)) {
    throw new Error(`${source} languages must be an object mapping file suffixes or basenames to supported languages.`);
  }

  const entries = Object.entries(config.languages as Record<string, unknown>).map(([rawPattern, rawLanguage]) => {
    const pattern = normalizeOverridePattern(rawPattern, source);
    const language = normalizeOverrideLanguage(rawLanguage, source, rawPattern);
    return [pattern, language] as const;
  });
  entries.sort((left, right) => right[0].length - left[0].length);
  return new Map(entries);
}

export function detectLanguage(filePath: string, overrides: LanguageOverrides = new Map()): Language {
  const override = detectLanguageOverride(filePath, overrides);
  if (override) {
    return override;
  }
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.endsWith(".dockerfile")) {
    return "shell";
  }
  if (base === "yarn.lock" || base === "cargo.lock" || base === "poetry.lock" || base === "gemfile.lock") {
    return "unknown";
  }
  if (base === "go.mod") {
    return "go";
  }
  if (base === "build.gradle" || base === "build.gradle.kts") {
    return "gradle";
  }
  if (base === "mix.exs") {
    return "elixir";
  }
  if (base === "gemfile" || base === "rakefile" || base.endsWith(".rake")) {
    return "ruby";
  }
  return byExtension.get(path.extname(base)) ?? "unknown";
}

export function isTextCandidate(filePath: string, overrides: LanguageOverrides = new Map()): boolean {
  if (detectLanguage(filePath, overrides) !== "unknown") {
    return true;
  }
  const base = path.basename(filePath).toLowerCase();
  return [
    "makefile",
    "license",
    "readme",
    "contributing",
    "security",
    "dockerfile",
    "go.mod",
    "go.sum",
    "yarn.lock",
    "cargo.lock",
    "poetry.lock",
    "gemfile.lock",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "pnpm-lock.yml",
    "composer.lock",
    "requirements.txt",
    "gemfile",
    "rakefile",
    ".gitignore",
    ".gitattributes"
  ].includes(base);
}

export function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

function detectLanguageOverride(filePath: string, overrides: LanguageOverrides): Language | undefined {
  if (overrides.size === 0) {
    return undefined;
  }
  const normalized = normalizeSlashes(filePath).toLowerCase();
  const base = path.posix.basename(normalized);
  for (const [pattern, language] of overrides) {
    if (pattern.startsWith(".")) {
      if (base.endsWith(pattern)) {
        return language;
      }
      continue;
    }
    if (base === pattern) {
      return language;
    }
  }
  return undefined;
}

function normalizeOverridePattern(pattern: string, source: string): string {
  const normalized = pattern.trim().toLowerCase().replace(/^\*\./, ".");
  if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("\0") || normalized.includes("..")) {
    throw new Error(`${source} language override pattern '${pattern}' must be a file suffix like .astro or a basename like Brewfile.`);
  }
  return normalized;
}

function normalizeOverrideLanguage(language: unknown, source: string, pattern: string): Language {
  if (typeof language !== "string") {
    throw new Error(`${source} language override for '${pattern}' must be a string.`);
  }
  const normalized = language.trim().toLowerCase() as Language;
  if (normalized === "unknown" || !supportedOverrideLanguages.has(normalized)) {
    throw new Error(`${source} language override for '${pattern}' uses unsupported language '${language}'.`);
  }
  return normalized;
}
