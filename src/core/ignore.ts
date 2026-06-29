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

const MAX_REPOLENSIGNORE_BYTES = 64 * 1024;
const MAX_REPOLENSIGNORE_RULES = 2000;
const MAX_REPOLENSIGNORE_RULE_LENGTH = 500;

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
  const stats = await fs.stat(ignorePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stats) {
    return createRepoIgnoreMatcher("");
  }
  if (!stats.isFile()) {
    return createRepoIgnoreMatcher("");
  }
  if (stats.size > MAX_REPOLENSIGNORE_BYTES) {
    throw new Error(`${ignorePath} is ${stats.size} bytes, which exceeds the ${MAX_REPOLENSIGNORE_BYTES} byte limit.`);
  }
  const content = await fs.readFile(ignorePath, "utf8");
  return createRepoIgnoreMatcher(content);
}

export function createRepoIgnoreMatcher(content: string): RepoIgnoreMatcher {
  if (Buffer.byteLength(content, "utf8") > MAX_REPOLENSIGNORE_BYTES) {
    throw new Error(`.repolensignore exceeds the ${MAX_REPOLENSIGNORE_BYTES} byte limit.`);
  }
  const patterns = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (patterns.length > MAX_REPOLENSIGNORE_RULES) {
    throw new Error(`.repolensignore has ${patterns.length} rules, which exceeds the ${MAX_REPOLENSIGNORE_RULES} rule limit.`);
  }
  const rules = patterns.map((line) => {
    if (line.length > MAX_REPOLENSIGNORE_RULE_LENGTH) {
      throw new Error(`.repolensignore rule exceeds the ${MAX_REPOLENSIGNORE_RULE_LENGTH} character limit.`);
    }
    return compileIgnoreRule(line);
  });
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
