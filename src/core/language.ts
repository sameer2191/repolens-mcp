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
  [".sql", "sql"],
  [".yml", "yaml"],
  [".yaml", "yaml"],
  [".md", "markdown"],
  [".mdx", "markdown"],
  [".json", "json"],
  [".jsonc", "json"],
  [".sh", "shell"],
  [".bash", "shell"],
  [".zsh", "shell"]
]);

export function detectLanguage(filePath: string): Language {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.endsWith(".dockerfile")) {
    return "shell";
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
    ".gitignore",
    ".gitattributes"
  ].includes(base);
}

export function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}
