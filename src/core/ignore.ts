import fs from "node:fs/promises";
import path from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".repolens",
  ".pnpm-store",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  "target",
  "vendor",
  "vendored",
  "artifacts",
  "DerivedData",
  "xcuserdata",
  ".swiftpm",
  ".gradle",
  ".build"
]);

const ignoredFiles = new Set([
  "bun.lockb",
  ".repolensignore",
  "tsconfig.tsbuildinfo"
]);

interface IgnoreRule {
  pattern: string;
  regex: RegExp;
  negated: boolean;
}

export interface RepoIgnoreMatcher {
  patterns: string[];
  shouldIgnore(relativePath: string, isDirectory?: boolean): boolean;
}

export async function loadRepoIgnoreMatcher(root: string): Promise<RepoIgnoreMatcher> {
  const ignorePath = path.join(root, ".repolensignore");
  const content = await fs.readFile(ignorePath, "utf8").catch(() => "");
  return createRepoIgnoreMatcher(content);
}

export function createRepoIgnoreMatcher(content: string): RepoIgnoreMatcher {
  const rules = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(compileIgnoreRule);
  return {
    patterns: rules.map((rule) => rule.pattern),
    shouldIgnore(relativePath: string, isDirectory = false): boolean {
      const normalized = normalizePatternPath(relativePath);
      let ignored = false;
      for (const rule of rules) {
        const target = isDirectory && !normalized.endsWith("/") ? `${normalized}/` : normalized;
        if (rule.regex.test(target)) {
          ignored = !rule.negated;
        }
      }
      return ignored;
    }
  };
}

export function shouldIgnoreDirectory(name: string, includeHidden = false): boolean {
  if (ignoredDirectories.has(name)) {
    return true;
  }
  return !includeHidden && name.startsWith(".") && name !== ".github";
}

export function shouldIgnoreFile(name: string): boolean {
  if (ignoredFiles.has(name)) {
    return true;
  }
  return /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|tar|bin|wasm|mp4|mov|sqlite|db)$/i.test(name);
}

function compileIgnoreRule(raw: string): IgnoreRule {
  const negated = raw.startsWith("!");
  const pattern = normalizePatternPath(negated ? raw.slice(1) : raw);
  const anchored = pattern.startsWith("/");
  const directoryOnly = pattern.endsWith("/");
  const body = pattern.replace(/^\/+/, "").replace(/\/+$/, "");
  const hasSlash = body.includes("/");
  const source = globToRegExpSource(body);
  const regex = directoryOnly
    ? new RegExp(hasSlash || anchored ? `^${source}(?:/.*)?$` : `(?:^|/)${source}(?:/.*)?$`)
    : new RegExp(hasSlash || anchored ? `^${source}$` : `(?:^|/)${source}$`);
  return { pattern: raw, regex, negated };
}

function globToRegExpSource(value: string): string {
  let source = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "*") {
      if (value[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return source;
}

function normalizePatternPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
