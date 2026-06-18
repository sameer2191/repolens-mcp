import path from "node:path";
import { extractImports } from "./extractor.js";
import type { Edge, SymbolNode } from "./types.js";

interface PackageRoot {
  name: string;
  root: string;
}

interface AliasMapping {
  pattern: string;
  targets: string[];
  configFile: string;
}

interface ResolvedImport {
  targetFile: string;
  resolver: "relative" | "workspace-package" | "path-alias" | "source-root";
  configFile?: string;
}

export function buildResolvedImportEdges(symbols: SymbolNode[], fileContents: Map<string, string>): Edge[] {
  const fileSymbols = symbols.filter((symbol) => symbol.kind === "file");
  const fileByPath = new Map(fileSymbols.map((symbol) => [symbol.filePath, symbol]));
  const filePaths = new Set(fileByPath.keys());
  const packageRoots = symbols
    .filter((symbol) => symbol.kind === "package")
    .map((symbol) => ({ name: symbol.name, root: path.posix.dirname(symbol.filePath) }))
    .sort((a, b) => b.name.length - a.name.length);
  const aliases = pathAliases(fileContents);
  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const fileSymbol of fileSymbols) {
    const content = fileContents.get(fileSymbol.filePath);
    if (!content) {
      continue;
    }
    for (const specifier of extractImports(fileSymbol.language, content)) {
      const resolved = resolveImportFile(fileSymbol.filePath, specifier, filePaths, packageRoots, aliases);
      if (!resolved || resolved.targetFile === fileSymbol.filePath) {
        continue;
      }
      const key = `${fileSymbol.filePath}\0${specifier}\0${resolved.targetFile}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      edges.push({
        source: fileSymbol.qualifiedName,
        target: `${resolved.targetFile}:file`,
        type: "IMPORTS_FILE",
        weight: 0.95,
        metadata: {
          import: specifier,
          targetFile: resolved.targetFile,
          resolver: resolved.resolver,
          ...(resolved.configFile ? { configFile: resolved.configFile } : {})
        }
      });
    }
  }

  return edges;
}

export function resolveImportFile(
  sourceFile: string,
  specifier: string,
  filePaths: Set<string>,
  packageRoots: PackageRoot[] = [],
  aliases: AliasMapping[] = []
): ResolvedImport | null {
  if (specifier.startsWith(".")) {
    const targetFile = resolveCandidate(path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier)), filePaths);
    return targetFile ? { targetFile, resolver: "relative" } : null;
  }

  for (const alias of aliases) {
    const targetFile = resolveAlias(specifier, alias, filePaths);
    if (targetFile) {
      return { targetFile, resolver: "path-alias", configFile: alias.configFile };
    }
  }

  for (const packageRoot of packageRoots) {
    if (specifier !== packageRoot.name && !specifier.startsWith(`${packageRoot.name}/`)) {
      continue;
    }
    const subpath = stripLeadingSlash(specifier.slice(packageRoot.name.length));
    if (subpath && !isSafeImportSubpath(subpath)) {
      return null;
    }
    const base = subpath ? path.posix.join(packageRoot.root, subpath) : path.posix.join(packageRoot.root, "src", "index");
    const targetFile = resolveCandidate(base, filePaths);
    if (targetFile) {
      return { targetFile, resolver: "workspace-package" };
    }
  }

  if (specifier.startsWith("@/")) {
    const subpath = specifier.slice(2);
    if (!isSafeImportSubpath(subpath)) {
      return null;
    }
    const targetFile = resolveCandidate(path.posix.join("src", subpath), filePaths);
    if (targetFile) {
      return { targetFile, resolver: "source-root" };
    }
  }

  if (specifier.startsWith("src/") || specifier.startsWith("apps/") || specifier.startsWith("packages/") || specifier.startsWith("services/")) {
    if (!isSafeImportSubpath(specifier)) {
      return null;
    }
    const targetFile = resolveCandidate(path.posix.normalize(specifier), filePaths);
    if (targetFile) {
      return { targetFile, resolver: "source-root" };
    }
  }

  return null;
}

function pathAliases(fileContents: Map<string, string>): AliasMapping[] {
  const aliases: AliasMapping[] = [];
  for (const [filePath, content] of fileContents) {
    const base = path.posix.basename(filePath).toLowerCase();
    if (!["tsconfig.json", "jsconfig.json"].includes(base)) {
      continue;
    }
    const parsed = parseJsonConfig(content);
    const compilerOptions = parsed?.compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== "object") {
      continue;
    }
    const configDir = path.posix.dirname(filePath);
    const baseUrlValue = typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : ".";
    const baseUrl = path.posix.normalize(path.posix.join(configDir === "." ? "" : configDir, baseUrlValue));
    const paths = compilerOptions.paths;
    if (!paths || typeof paths !== "object") {
      continue;
    }
    for (const [pattern, rawTargets] of Object.entries(paths as Record<string, unknown>)) {
      const targets = Array.isArray(rawTargets) ? rawTargets.filter((target): target is string => typeof target === "string") : [];
      if (targets.length === 0) {
        continue;
      }
      aliases.push({
        pattern,
        targets: targets.map((target) => path.posix.normalize(path.posix.join(baseUrl, target))),
        configFile: filePath
      });
    }
  }
  return aliases.sort((a, b) => specificity(b.pattern) - specificity(a.pattern));
}

function resolveAlias(specifier: string, alias: AliasMapping, filePaths: Set<string>): string | null {
  const star = alias.pattern.indexOf("*");
  if (star < 0) {
    if (specifier !== alias.pattern) {
      return null;
    }
    for (const target of alias.targets) {
      const resolved = resolveCandidate(target, filePaths);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  const prefix = alias.pattern.slice(0, star);
  const suffix = alias.pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null;
  }
  const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length);
  for (const target of alias.targets) {
    const expandedTarget = expandAliasTarget(target, wildcard);
    if (!expandedTarget) {
      continue;
    }
    const resolved = resolveCandidate(expandedTarget, filePaths);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function expandAliasTarget(target: string, wildcard: string): string | null {
  if (!isSafeAliasWildcard(wildcard)) {
    return null;
  }
  const star = target.indexOf("*");
  const expanded = star < 0 ? target : `${target.slice(0, star)}${wildcard}${target.slice(star + 1)}`;
  const normalized = path.posix.normalize(expanded);
  return isSafeRelativePath(normalized) ? normalized : null;
}

function isSafeAliasWildcard(value: string): boolean {
  if (value.includes("\\") || value.includes("\0") || value.startsWith("/")) {
    return false;
  }
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

function isSafeImportSubpath(value: string): boolean {
  return isSafeAliasWildcard(value);
}

function isSafeRelativePath(value: string): boolean {
  return !value.includes("\\") && !value.includes("\0") && !value.startsWith("/") && value.split("/").every((segment) => segment !== "..");
}

function stripLeadingSlash(value: string): string {
  return value.startsWith("/") ? value.slice(1) : value;
}

function resolveCandidate(base: string, filePaths: Set<string>): string | null {
  const withoutExtension = stripKnownExtension(base);
  const candidates = [
    base,
    withoutExtension,
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    `${withoutExtension}.js`,
    `${withoutExtension}.jsx`,
    `${withoutExtension}.mjs`,
    `${withoutExtension}.cjs`,
    `${withoutExtension}.swift`,
    `${withoutExtension}.py`,
    `${withoutExtension}.go`,
    `${withoutExtension}.java`,
    `${withoutExtension}.rs`,
    `${withoutExtension}/index.ts`,
    `${withoutExtension}/index.tsx`,
    `${withoutExtension}/index.js`,
    `${withoutExtension}/index.jsx`
  ];

  for (const candidate of candidates.map((item) => path.posix.normalize(item))) {
    if (filePaths.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function parseJsonConfig(content: string): { compilerOptions?: { baseUrl?: unknown; paths?: unknown } } | null {
  try {
    return JSON.parse(stripTrailingJsonCommas(stripJsonComments(content))) as { compilerOptions?: { baseUrl?: unknown; paths?: unknown } };
  } catch {
    return null;
  }
}

function stripJsonComments(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const next = value[index + 1];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "/" && next === "/") {
      index += 1;
      while (index + 1 < value.length && value[index + 1] !== "\n" && value[index + 1] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      index += 1;
      while (index + 1 < value.length) {
        index += 1;
        const commentChar = value[index];
        if (commentChar === "\n" || commentChar === "\r") {
          result += commentChar;
        }
        if (commentChar === "*" && value[index + 1] === "/") {
          index += 1;
          break;
        }
      }
      continue;
    }

    result += current;
  }

  return result;
}

function stripTrailingJsonCommas(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];

    if (inString) {
      result += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === "\"") {
        inString = false;
      }
      continue;
    }

    if (current === "\"") {
      inString = true;
      result += current;
      continue;
    }

    if (current === "," && isTrailingJsonComma(value, index + 1)) {
      continue;
    }

    result += current;
  }

  return result;
}

function isTrailingJsonComma(value: string, start: number): boolean {
  for (let index = start; index < value.length; index += 1) {
    const current = value[index];
    if (current === " " || current === "\t" || current === "\n" || current === "\r") {
      continue;
    }
    return current === "}" || current === "]";
  }
  return false;
}

function specificity(pattern: string): number {
  return pattern.replace(/\*/g, "").length;
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(tsx?|jsx?|mjs|cjs|swift|py|go|java|rs|sql|json|ya?ml|md|sh)$/i, "");
}
