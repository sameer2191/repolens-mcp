import path from "node:path";
import type { Edge, Language, SymbolNode } from "./types.js";

export interface ExtractionResult {
  symbols: SymbolNode[];
  edges: Edge[];
  imports: string[];
}

interface Pattern {
  kind: string;
  regex: RegExp;
  nameGroup?: number;
  exported?: (match: RegExpExecArray) => boolean;
}

const ignoredCallableNames = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "json",
  "data",
  "body",
  "map",
  "filter",
  "reduce",
  "foreach",
  "render"
]);

const patterns: Partial<Record<Language, Pattern[]>> = {
  typescript: [
    { kind: "class", regex: /^\s*(export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) },
    { kind: "interface", regex: /^\s*(export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) },
    { kind: "type", regex: /^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) },
    { kind: "function", regex: /^\s*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) },
    { kind: "function", regex: /^\s*(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) }
  ],
  javascript: [
    { kind: "class", regex: /^\s*(export\s+)?class\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) },
    { kind: "function", regex: /^\s*(export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) },
    { kind: "function", regex: /^\s*(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/gm, nameGroup: 2, exported: (m) => Boolean(m[1]) }
  ],
  python: [
    { kind: "class", regex: /^\s*class\s+([A-Za-z_]\w*)/gm },
    { kind: "function", regex: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm }
  ],
  go: [
    { kind: "function", regex: /^func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)/gm },
    { kind: "type", regex: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/gm }
  ],
  java: [
    { kind: "class", regex: /^\s*(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/gm },
    { kind: "interface", regex: /^\s*(?:public|private|protected)?\s*interface\s+([A-Za-z_]\w*)/gm },
    { kind: "method", regex: /^\s*(?:public|private|protected)?\s*(?:static\s+)?[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*\{/gm }
  ],
  rust: [
    { kind: "function", regex: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/gm },
    { kind: "struct", regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_]\w*)/gm },
    { kind: "enum", regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_]\w*)/gm },
    { kind: "trait", regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_]\w*)/gm }
  ],
  swift: [
    { kind: "class", regex: /^\s*(?:public|open|internal|private|fileprivate|final|\s)*class\s+([A-Za-z_]\w*)/gm },
    { kind: "struct", regex: /^\s*(?:public|internal|private|fileprivate|\s)*struct\s+([A-Za-z_]\w*)/gm },
    { kind: "enum", regex: /^\s*(?:public|internal|private|fileprivate|\s)*enum\s+([A-Za-z_]\w*)/gm },
    { kind: "protocol", regex: /^\s*(?:public|internal|private|fileprivate|\s)*protocol\s+([A-Za-z_]\w*)/gm },
    { kind: "actor", regex: /^\s*(?:public|open|internal|private|fileprivate|final|\s)*actor\s+([A-Za-z_]\w*)/gm },
    { kind: "function", regex: /^\s*(?:public|open|internal|private|fileprivate|static|class|mutating|nonisolated|override|async|\s)*func\s+([A-Za-z_]\w*)/gm }
  ]
};

export function extractFromFile(filePath: string, language: Language, content: string): ExtractionResult {
  const lines = content.split(/\r?\n/);
  const symbols: SymbolNode[] = [];
  const edges: Edge[] = [];
  const imports = extractImports(language, content);
  const fileNode = fileQualifiedName(filePath);

  symbols.push({
    filePath,
    language,
    kind: "file",
    name: path.basename(filePath),
    qualifiedName: fileNode,
    startLine: 1,
    endLine: Math.max(1, lines.length),
    metadata: { path: filePath }
  });

  for (const imported of imports) {
    const external = `external:${imported}`;
    edges.push({ source: fileNode, target: external, type: "IMPORTS", weight: 1, metadata: { import: imported } });
  }

  for (const route of extractRoutes(filePath, language, content)) {
    symbols.push(route);
    edges.push({ source: fileNode, target: route.qualifiedName, type: "DEFINES", weight: 1 });
  }

  if (language === "markdown") {
    for (const heading of extractMarkdown(filePath, lines)) {
      symbols.push(heading);
      edges.push({ source: fileNode, target: heading.qualifiedName, type: "DEFINES", weight: 1 });
    }
  } else if (language === "json") {
    for (const symbol of extractJsonManifest(filePath, content)) {
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
    }
  } else if (language === "yaml") {
    for (const symbol of extractYamlResources(filePath, content)) {
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
    }
  } else if (language === "sql") {
    for (const symbol of extractSql(filePath, content)) {
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
    }
  }

  const languagePatterns = patterns[language] ?? [];
  for (const pattern of languagePatterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const rawName = match[pattern.nameGroup ?? 1];
      if (!rawName) {
        continue;
      }
      const line = offsetToLine(content, match.index ?? 0);
      const signature = lines[line - 1]?.trim().slice(0, 220);
      const endLine = findBlockEndLine(language, lines, line);
      const symbol = makeSymbol(filePath, language, pattern.kind, rawName, line, endLine, signature, pattern.exported?.(match) ?? false);
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DEFINES", weight: 1 });
    }
  }

  return { symbols: dedupeSymbols(symbols), edges, imports };
}

export function addCallEdges(symbols: SymbolNode[], fileContents: Map<string, string>): Edge[] {
  const named = symbols.filter((symbol) => ["function", "method", "class"].includes(symbol.kind) && isCallableName(symbol.name));
  const files = symbols.filter((symbol) => symbol.kind === "file");
  const edges: Edge[] = [];
  for (const file of files) {
    const content = fileContents.get(file.filePath);
    if (!content) continue;
    for (const target of named) {
      if (file.filePath !== target.filePath && callsName(content, target.name)) {
        edges.push({
          source: file.qualifiedName,
          target: target.qualifiedName,
          type: "CALLS",
          weight: 0.5,
          metadata: { scope: "file" }
        });
      }
    }
  }
  for (const source of named) {
    const content = fileContents.get(source.filePath);
    if (!content) {
      continue;
    }
    const local = content
      .split(/\r?\n/)
      .slice(Math.max(0, source.startLine - 1), source.endLine)
      .join("\n");
    for (const target of named) {
      if (source.qualifiedName === target.qualifiedName) {
        continue;
      }
      if (callsName(local, target.name)) {
        edges.push({
          source: source.qualifiedName,
          target: target.qualifiedName,
          type: source.filePath === target.filePath ? "CALLS_LOCAL" : "CALLS",
          weight: source.filePath === target.filePath ? 1 : 0.75
        });
      }
    }
  }
  return edges;
}

export function addHttpEdges(symbols: SymbolNode[], fileContents: Map<string, string>): Edge[] {
  const routes = symbols.filter((symbol) => symbol.kind === "route" && typeof symbol.metadata?.path === "string");
  if (routes.length === 0) {
    return [];
  }
  const routeLookup = new Map<string, SymbolNode[]>();
  for (const route of routes) {
    const pathValue = normalizeHttpPath(String(route.metadata?.path ?? ""));
    if (!pathValue) continue;
    const method = String(route.metadata?.method ?? "ROUTE").toUpperCase();
    const key = `${method}:${pathValue}`;
    routeLookup.set(key, [...(routeLookup.get(key) ?? []), route]);
    routeLookup.set(`ANY:${pathValue}`, [...(routeLookup.get(`ANY:${pathValue}`) ?? []), route]);
  }

  const sources = symbols.filter((symbol) => ["function", "method", "class"].includes(symbol.kind));
  const edges: Edge[] = [];
  for (const source of sources) {
    const content = fileContents.get(source.filePath);
    if (!content) continue;
    const body = content
      .split(/\r?\n/)
      .slice(Math.max(0, source.startLine - 1), source.endLine)
      .join("\n");
    for (const call of extractHttpCalls(body, source.startLine)) {
      const exact = routeLookup.get(`${call.method}:${call.path}`) ?? [];
      const fallback = call.method === "ANY" ? routeLookup.get(`ANY:${call.path}`) ?? [] : [];
      for (const route of exact.length ? exact : fallback) {
        if (source.qualifiedName === route.qualifiedName) continue;
        edges.push({
          source: source.qualifiedName,
          target: route.qualifiedName,
          type: "HTTP_CALLS",
          weight: call.method === "ANY" ? 0.65 : 0.9,
          metadata: {
            method: call.method,
            path: call.path,
            line: call.line
          }
        });
      }
    }
  }
  return edges;
}

function makeSymbol(
  filePath: string,
  language: Language,
  kind: string,
  name: string,
  startLine: number,
  endLine: number,
  signature?: string,
  exported = false,
  metadata: Record<string, unknown> = {}
): SymbolNode {
  return {
    filePath,
    language,
    kind,
    name,
    qualifiedName: `${filePath}:${kind}:${name}:${startLine}`,
    startLine,
    endLine,
    signature,
    exported,
    metadata
  };
}

function fileQualifiedName(filePath: string): string {
  return `${filePath}:file`;
}

function extractImports(language: Language, content: string): string[] {
  const imports = new Set<string>();
  const patternsByLanguage: Partial<Record<Language, RegExp[]>> = {
    typescript: [/from\s+["']([^"']+)["']/g, /import\s*\(\s*["']([^"']+)["']\s*\)/g, /require\(\s*["']([^"']+)["']\s*\)/g],
    javascript: [/from\s+["']([^"']+)["']/g, /import\s*\(\s*["']([^"']+)["']\s*\)/g, /require\(\s*["']([^"']+)["']\s*\)/g],
    python: [/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm],
    go: [/^\s*import\s+(?:"([^"]+)"|`([^`]+)`)/gm],
    java: [/^\s*import\s+([\w.*]+);/gm],
    rust: [/^\s*use\s+([^;]+);/gm],
    swift: [/^\s*import\s+([A-Za-z_][\w.]*)/gm]
  };
  for (const regex of patternsByLanguage[language] ?? []) {
    for (const match of content.matchAll(regex)) {
      const value = match[1] ?? match[2];
      if (value) imports.add(value.trim());
    }
  }
  return [...imports];
}

function extractRoutes(filePath: string, language: Language, content: string): SymbolNode[] {
  if (!["typescript", "javascript", "python", "java", "go"].includes(language)) {
    return [];
  }
  const routeRegexes = [
    /\b(?:app|router|server)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi,
    /@(Get|Post|Put|Patch|Delete|RequestMapping)\(\s*["']?([^"')]+)?["']?\s*\)/g,
    /@(?:app|router)\.route\(\s*["']([^"']+)["']/g
  ];
  const routes: SymbolNode[] = [];
  for (const regex of routeRegexes) {
    for (const match of content.matchAll(regex)) {
      const method = match[1]?.toUpperCase() ?? "ROUTE";
      const routePath = match[2] ?? match[1];
      const line = offsetToLine(content, match.index ?? 0);
      routes.push(
        makeSymbol(filePath, language, "route", `${method} ${routePath}`, line, line, undefined, true, {
          method,
          path: routePath
        })
      );
    }
  }
  return routes;
}

function extractHttpCalls(content: string, startLine: number): Array<{ method: string; path: string; line: number }> {
  const calls: Array<{ method: string; path: string; line: number }> = [];
  const regexes: Array<{ regex: RegExp; method?: (match: RegExpExecArray) => string; urlGroup: number }> = [
    { regex: /\bfetch\(\s*["'`]([^"'`]+)["'`](?:[\s\S]{0,180}?\bmethod\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`])?/gi, method: (match) => match[2] ?? "GET", urlGroup: 1 },
    { regex: /\baxios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, method: (match) => match[1], urlGroup: 2 },
    { regex: /\b(?:http|https)\.(get|request)\(\s*["'`]([^"'`]+)["'`]/gi, method: (match) => (match[1].toLowerCase() === "get" ? "GET" : "ANY"), urlGroup: 2 }
  ];
  for (const { regex, method, urlGroup } of regexes) {
    for (const match of content.matchAll(regex)) {
      const pathValue = normalizeHttpPath(match[urlGroup]);
      if (!pathValue) continue;
      calls.push({
        method: method?.(match).toUpperCase() ?? "ANY",
        path: pathValue,
        line: startLine + offsetToLine(content, match.index ?? 0) - 1
      });
    }
  }
  return calls;
}

function normalizeHttpPath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  const pathOnly = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed.split(/[?#]/, 1)[0];
  return pathOnly.startsWith("/") ? pathOnly.replace(/\/+$/, "") || "/" : null;
}

function extractMarkdown(filePath: string, lines: string[]): SymbolNode[] {
  return lines.flatMap((line, index) => {
    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) return [];
    return [
      makeSymbol(filePath, "markdown", "heading", match[2].trim(), index + 1, index + 1, line.trim(), false, {
        level: match[1].length
      })
    ];
  });
}

function extractJsonManifest(filePath: string, content: string): SymbolNode[] {
  if (!filePath.endsWith("package.json")) {
    return [];
  }
  try {
    const parsed = JSON.parse(content) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const symbols: SymbolNode[] = [];
    if (parsed.name) {
      symbols.push(makeSymbol(filePath, "json", "package", parsed.name, 1, 1));
    }
    for (const [name, version] of Object.entries({ ...parsed.dependencies, ...parsed.devDependencies })) {
      symbols.push(makeSymbol(filePath, "json", "dependency", name, 1, 1, undefined, false, { version }));
    }
    return symbols;
  } catch {
    return [];
  }
}

function extractYamlResources(filePath: string, content: string): SymbolNode[] {
  const kind = /^kind:\s*([A-Za-z0-9_-]+)/m.exec(content)?.[1];
  const name = /^\s*name:\s*([A-Za-z0-9_.-]+)/m.exec(content)?.[1];
  if (!kind || !name) {
    return [];
  }
  return [makeSymbol(filePath, "yaml", "resource", `${kind}/${name}`, 1, 1, undefined, false, { kind, name })];
}

function extractSql(filePath: string, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const regex = /\bCREATE\s+(TABLE|VIEW|INDEX|FUNCTION|PROCEDURE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][\w.]*)/gi;
  for (const match of content.matchAll(regex)) {
    const line = offsetToLine(content, match.index ?? 0);
    symbols.push(makeSymbol(filePath, "sql", match[1].toLowerCase(), match[2], line, line));
  }
  return symbols;
}

function offsetToLine(content: string, offset: number): number {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function findBlockEndLine(language: Language, lines: string[], startLine: number): number {
  if (language === "python") {
    const start = lines[startLine - 1] ?? "";
    const indent = start.match(/^\s*/)?.[0].length ?? 0;
    for (let i = startLine; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trim()) continue;
      const currentIndent = line.match(/^\s*/)?.[0].length ?? 0;
      if (currentIndent <= indent) return i;
    }
    return lines.length;
  }

  let depth = 0;
  let sawBrace = false;
  for (let i = startLine - 1; i < lines.length; i += 1) {
    for (const char of lines[i]) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) {
      return i + 1;
    }
  }
  return startLine;
}

function dedupeSymbols(symbols: SymbolNode[]): SymbolNode[] {
  const seen = new Set<string>();
  return symbols.filter((symbol) => {
    if (seen.has(symbol.qualifiedName)) {
      return false;
    }
    seen.add(symbol.qualifiedName);
    return true;
  });
}

function isCallableName(name: string): boolean {
  if (name.length <= 2) {
    return false;
  }
  const lowered = name.toLowerCase();
  return !ignoredCallableNames.has(lowered);
}

function callsName(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_$])(?:\\.|)${escaped}\\s*\\(`).test(content);
}
