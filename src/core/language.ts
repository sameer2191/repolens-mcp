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

export function detectLanguage(filePath: string): Language {
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

export function isTextCandidate(filePath: string): boolean {
  if (detectLanguage(filePath) !== "unknown") {
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
