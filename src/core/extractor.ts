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

interface ChannelOccurrence {
  channel: string;
  type: "EMITS" | "LISTENS_ON";
  line: number;
  pattern: string;
}

interface HttpCallOccurrence {
  method: string;
  path: string;
  line: number;
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

  for (const symbol of extractManifestSymbols(filePath, language, content)) {
    symbols.push(symbol);
    edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
  }

  if (language === "markdown") {
    for (const heading of extractMarkdown(filePath, lines)) {
      symbols.push(heading);
      edges.push({ source: fileNode, target: heading.qualifiedName, type: "DEFINES", weight: 1 });
    }
  } else if (language === "yaml") {
    const yaml = extractYamlInfrastructure(filePath, content);
    for (const symbol of yaml.symbols) {
      symbols.push(symbol);
    }
    for (const edge of yaml.edges) {
      edges.push(edge);
    }
  } else if (language === "sql") {
    for (const symbol of extractSql(filePath, content)) {
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
    }
  }

  if (isDockerfile(filePath)) {
    const dockerfile = extractDockerfile(filePath, content);
    for (const symbol of dockerfile.symbols) {
      symbols.push(symbol);
    }
    for (const edge of dockerfile.edges) {
      edges.push(edge);
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

  const channels = extractChannelLinks(filePath, language, content, symbols);
  for (const symbol of channels.symbols) {
    symbols.push(symbol);
  }
  for (const edge of channels.edges) {
    edges.push(edge);
  }

  const httpCalls = extractHttpCallLinks(filePath, language, content, symbols);
  for (const symbol of httpCalls.symbols) {
    symbols.push(symbol);
  }
  for (const edge of httpCalls.edges) {
    edges.push(edge);
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
  const httpCalls = symbols.filter((symbol) => symbol.kind === "http_call" && typeof symbol.metadata?.path === "string");
  if (routes.length === 0 || httpCalls.length === 0) {
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

  const edges: Edge[] = [];
  for (const call of httpCalls) {
    const pathValue = normalizeHttpPath(String(call.metadata?.path ?? ""));
    if (!pathValue) continue;
    const method = String(call.metadata?.method ?? "ANY").toUpperCase();
    const exact = routeLookup.get(`${method}:${pathValue}`) ?? [];
    const fallback = method === "ANY" ? routeLookup.get(`ANY:${pathValue}`) ?? [] : [];
    const source = sourceSymbolForLine(symbols, call.startLine, call.filePath)?.qualifiedName ?? fileQualifiedName(call.filePath);
    for (const route of exact.length ? exact : fallback) {
      if (source === route.qualifiedName) continue;
      edges.push({
        source,
        target: route.qualifiedName,
        type: "HTTP_CALLS",
        weight: method === "ANY" ? 0.65 : 0.9,
        metadata: {
          method,
          path: pathValue,
          line: call.startLine,
          call: call.qualifiedName
        }
      });
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

function channelQualifiedName(channel: string): string {
  return `channel:${channel}`;
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

function extractChannelLinks(filePath: string, language: Language, content: string, symbols: SymbolNode[]): ExtractionResult {
  if (!["typescript", "javascript", "python", "swift"].includes(language)) {
    return { symbols: [], edges: [], imports: [] };
  }
  const occurrences = extractChannelOccurrences(language, content);
  if (occurrences.length === 0) {
    return { symbols: [], edges: [], imports: [] };
  }

  const channelSymbols = new Map<string, SymbolNode>();
  const edges: Edge[] = [];
  for (const occurrence of occurrences) {
    const channel = normalizeChannelName(occurrence.channel);
    if (!channel) {
      continue;
    }
    const qualifiedName = channelQualifiedName(channel);
    if (!channelSymbols.has(qualifiedName)) {
      channelSymbols.set(qualifiedName, {
        filePath: "__channels__",
        language: "unknown",
        kind: "channel",
        name: channel,
        qualifiedName,
        startLine: 1,
        endLine: 1,
        exported: false,
        metadata: { channel }
      });
    }
    const source = sourceSymbolForLine(symbols, occurrence.line)?.qualifiedName ?? fileQualifiedName(filePath);
    edges.push({
      source,
      target: qualifiedName,
      type: occurrence.type,
      weight: occurrence.type === "EMITS" ? 0.85 : 0.75,
      metadata: {
        channel,
        line: occurrence.line,
        pattern: occurrence.pattern
      }
    });
  }

  return { symbols: [...channelSymbols.values()], edges, imports: [] };
}

function extractChannelOccurrences(language: Language, content: string): ChannelOccurrence[] {
  if (language === "swift") {
    return extractSwiftChannelOccurrences(content);
  }

  const occurrences: ChannelOccurrence[] = [];
  const emitRegexes: Array<{ regex: RegExp; group: number; pattern: string }> = [
    { regex: /\b(?:[\w$]+\.)?(?:emit|publish)\(\s*["'`]([^"'`]+)["'`]/g, group: 1, pattern: "emit" },
    { regex: /\bdispatchEvent\(\s*new\s+CustomEvent\(\s*["'`]([^"'`]+)["'`]/g, group: 1, pattern: "custom-event" }
  ];
  const listenRegexes: Array<{ regex: RegExp; group: number; pattern: string }> = [
    { regex: /\b(?:[\w$]+\.)?(?:on|once|addListener|subscribe)\(\s*["'`]([^"'`]+)["'`]/g, group: 1, pattern: "listener" },
    { regex: /\baddEventListener\(\s*["'`]([^"'`]+)["'`]/g, group: 1, pattern: "dom-listener" },
    { regex: /@(?:[\w.]+\.)?on\(\s*["'`]([^"'`]+)["'`]\s*\)/g, group: 1, pattern: "decorator-listener" }
  ];

  for (const { regex, group, pattern } of emitRegexes) {
    for (const match of content.matchAll(regex)) {
      occurrences.push({ channel: match[group], type: "EMITS", line: offsetToLine(content, match.index ?? 0), pattern });
    }
  }
  for (const { regex, group, pattern } of listenRegexes) {
    for (const match of content.matchAll(regex)) {
      occurrences.push({ channel: match[group], type: "LISTENS_ON", line: offsetToLine(content, match.index ?? 0), pattern });
    }
  }
  return occurrences;
}

function extractHttpCallLinks(filePath: string, language: Language, content: string, symbols: SymbolNode[]): ExtractionResult {
  if (!["typescript", "javascript"].includes(language)) {
    return { symbols: [], edges: [], imports: [] };
  }
  const calls = extractHttpCalls(content, 1);
  if (calls.length === 0) {
    return { symbols: [], edges: [], imports: [] };
  }

  const callSymbols: SymbolNode[] = [];
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const fileNode = fileQualifiedName(filePath);
  for (const call of calls) {
    const key = `${call.method}:${call.path}:${call.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const name = `${call.method} ${call.path}`;
    const callSymbol = makeSymbol(filePath, language, "http_call", name, call.line, call.line, undefined, false, {
      method: call.method,
      path: call.path,
      line: call.line
    });
    const source = sourceSymbolForLine(symbols, call.line)?.qualifiedName ?? fileNode;
    callSymbols.push(callSymbol);
    edges.push({ source: fileNode, target: callSymbol.qualifiedName, type: "DEFINES", weight: 0.8 });
    edges.push({
      source,
      target: callSymbol.qualifiedName,
      type: "CALLS_HTTP_ENDPOINT",
      weight: call.method === "ANY" ? 0.6 : 0.8,
      metadata: { method: call.method, path: call.path, line: call.line }
    });
  }

  return { symbols: callSymbols, edges, imports: [] };
}

function extractSwiftChannelOccurrences(content: string): ChannelOccurrence[] {
  const occurrences: ChannelOccurrence[] = [];
  const emitRegexes = [
    /NotificationCenter\.default\.post\([\s\S]{0,180}?\bname\s*:\s*(?:\.([A-Za-z_]\w*)|(?:Notification|NSNotification)\.Name\(\s*"([^"]+)"\s*\))/g
  ];
  const listenRegexes = [
    /NotificationCenter\.default\.addObserver\([\s\S]{0,220}?\b(?:name|forName)\s*:\s*(?:\.([A-Za-z_]\w*)|(?:Notification|NSNotification)\.Name\(\s*"([^"]+)"\s*\))/g
  ];
  for (const regex of emitRegexes) {
    for (const match of content.matchAll(regex)) {
      occurrences.push({ channel: match[1] ?? match[2], type: "EMITS", line: offsetToLine(content, match.index ?? 0), pattern: "notification-post" });
    }
  }
  for (const regex of listenRegexes) {
    for (const match of content.matchAll(regex)) {
      occurrences.push({ channel: match[1] ?? match[2], type: "LISTENS_ON", line: offsetToLine(content, match.index ?? 0), pattern: "notification-listener" });
    }
  }
  return occurrences;
}

function sourceSymbolForLine(symbols: SymbolNode[], line: number, filePath?: string): SymbolNode | null {
  const candidates = symbols
    .filter(
      (symbol) =>
        (filePath === undefined || symbol.filePath === filePath) &&
        ["function", "method", "class", "route"].includes(symbol.kind) &&
        symbol.startLine <= line &&
        symbol.endLine >= line
    )
    .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine));
  return candidates[0] ?? null;
}

function normalizeChannelName(channel: string | undefined): string | null {
  const trimmed = channel?.trim();
  if (!trimmed || trimmed.length > 160) {
    return null;
  }
  return trimmed.replace(/\s+/g, " ");
}

function extractHttpCalls(content: string, startLine: number): HttpCallOccurrence[] {
  const calls: HttpCallOccurrence[] = [];
  const fetchRegex = /\bfetch\(\s*["'`]([^"'`]+)["'`]/gi;
  for (const match of content.matchAll(fetchRegex)) {
    const pathValue = normalizeHttpPath(match[1]);
    if (!pathValue) continue;
    const windowEnd = nextHttpCallBoundary(content, (match.index ?? 0) + match[0].length);
    const callWindow = content.slice(match.index ?? 0, windowEnd);
    const methodMatch = /\bmethod\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i.exec(callWindow);
    calls.push({
      method: (methodMatch?.[1] ?? "GET").toUpperCase(),
      path: pathValue,
      line: startLine + offsetToLine(content, match.index ?? 0) - 1
    });
  }

  const regexes: Array<{ regex: RegExp; method?: (match: RegExpExecArray) => string; urlGroup: number }> = [
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

function nextHttpCallBoundary(content: string, startOffset: number): number {
  const nextFetch = content.slice(startOffset).search(/\bfetch\(/);
  const maxWindowEnd = Math.min(content.length, startOffset + 360);
  return nextFetch >= 0 ? Math.min(maxWindowEnd, startOffset + nextFetch) : maxWindowEnd;
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

function extractManifestSymbols(filePath: string, language: Language, content: string): SymbolNode[] {
  const base = path.posix.basename(filePath).toLowerCase();
  if (base === "package.json" || base === "composer.json") {
    return extractJsonDependencyManifest(filePath, language, content, base === "composer.json" ? "composer" : "npm");
  }
  if (base === "pyproject.toml") {
    return extractPyprojectManifest(filePath, language, content);
  }
  if (base === "cargo.toml") {
    return extractTomlPackageManifest(filePath, language, content, "cargo");
  }
  if (base === "go.mod") {
    return extractGoModManifest(filePath, language, content);
  }
  if (base === "pubspec.yaml" || base === "pubspec.yml") {
    return extractPubspecManifest(filePath, language, content);
  }
  if (base === "pom.xml") {
    return extractPomManifest(filePath, language, content);
  }
  if (base === "build.gradle" || base === "build.gradle.kts") {
    return extractGradleManifest(filePath, language, content);
  }
  if (base === "mix.exs") {
    return extractMixManifest(filePath, language, content);
  }
  if (base.endsWith(".gemspec")) {
    return extractGemspecManifest(filePath, language, content);
  }
  if (base === "requirements.txt") {
    return extractRequirementsManifest(filePath, language, content);
  }
  return [];
}

function extractJsonDependencyManifest(filePath: string, language: Language, content: string, ecosystem: string): SymbolNode[] {
  try {
    const parsed = JSON.parse(content) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
    };
    const symbols: SymbolNode[] = [];
    if (parsed.name) {
      symbols.push(manifestSymbol(filePath, language, "package", parsed.name, 1, ecosystem));
    }
    const dependencies =
      ecosystem === "composer"
        ? { ...parsed.require, ...parsed["require-dev"] }
        : { ...parsed.dependencies, ...parsed.devDependencies, ...parsed.peerDependencies };
    for (const [name, version] of Object.entries(dependencies)) {
      if (name.toLowerCase() === "php") continue;
      symbols.push(manifestSymbol(filePath, language, "dependency", name, 1, ecosystem, version));
    }
    return symbols;
  } catch {
    return [];
  }
}

function extractPyprojectManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const projectSection = tomlSection(content, "project");
  const poetrySection = tomlSection(content, "tool.poetry");
  const projectName = tomlStringValue(projectSection, "name") ?? tomlStringValue(poetrySection, "name");
  if (projectName) {
    symbols.push(manifestSymbol(filePath, language, "package", projectName, 1, "python"));
  }
  for (const dependency of [
    ...tomlArrayValues(projectSection, "dependencies").map(parsePythonRequirement),
    ...tomlInlineTableKeys(tomlSection(content, "project.optional-dependencies")),
    ...tomlDependencyKeys(tomlSection(content, "tool.poetry.dependencies")),
    ...tomlDependencyKeys(tomlSection(content, "tool.poetry.group.dev.dependencies"))
  ]) {
    if (dependency.name && dependency.name.toLowerCase() !== "python") {
      symbols.push(manifestSymbol(filePath, language, "dependency", dependency.name, 1, "python", dependency.version));
    }
  }
  return dedupeSymbols(symbols);
}

function extractTomlPackageManifest(filePath: string, language: Language, content: string, ecosystem: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const packageSection = tomlSection(content, "package");
  const packageName = tomlStringValue(packageSection, "name");
  if (packageName) {
    symbols.push(manifestSymbol(filePath, language, "package", packageName, 1, ecosystem));
  }
  for (const sectionName of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    for (const dependency of tomlDependencyKeys(tomlSection(content, sectionName))) {
      symbols.push(manifestSymbol(filePath, language, "dependency", dependency.name, 1, ecosystem, dependency.version));
    }
  }
  return dedupeSymbols(symbols);
}

function extractGoModManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const moduleName = /^module\s+(\S+)/m.exec(content)?.[1];
  if (moduleName) {
    symbols.push(manifestSymbol(filePath, language, "package", moduleName, 1, "go"));
  }
  const requireLine = /^require[ \t]+([^\s()]+)[ \t]+(\S+)/gm;
  for (const match of content.matchAll(requireLine)) {
    symbols.push(manifestSymbol(filePath, language, "dependency", match[1], offsetToLine(content, match.index ?? 0), "go", match[2]));
  }
  const requireBlock = /^require\s*\(([\s\S]*?)^\)/gm;
  for (const block of content.matchAll(requireBlock)) {
    for (const line of block[1].split(/\r?\n/)) {
      const match = /^\s*(\S+)\s+(\S+)/.exec(line);
      if (match) {
        symbols.push(manifestSymbol(filePath, language, "dependency", match[1], offsetToLine(content, block.index ?? 0), "go", match[2]));
      }
    }
  }
  return dedupeSymbols(symbols);
}

function extractPubspecManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const lines = content.split(/\r?\n/);
  const symbols: SymbolNode[] = [];
  const packageName = findYamlScalar(lines, "name");
  if (packageName) {
    symbols.push(manifestSymbol(filePath, language, "package", packageName, 1, "dart"));
  }
  for (const item of extractYamlMapKeys(lines, ["dependencies", "dev_dependencies", "dependency_overrides"])) {
    if (["flutter", "sdk"].includes(item.value.toLowerCase())) continue;
    symbols.push(manifestSymbol(filePath, language, "dependency", item.value, item.line, "dart"));
  }
  return dedupeSymbols(symbols);
}

function extractPomManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const projectBlock = /<project[\s\S]*?<\/project>/i.exec(content)?.[0] ?? content;
  const groupId = xmlText(projectBlock, "groupId");
  const artifactId = xmlText(projectBlock, "artifactId");
  if (artifactId) {
    symbols.push(manifestSymbol(filePath, language, "package", groupId ? `${groupId}:${artifactId}` : artifactId, 1, "maven"));
  }
  for (const dependency of content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/gi)) {
    const depGroup = xmlText(dependency[1], "groupId");
    const depArtifact = xmlText(dependency[1], "artifactId");
    const version = xmlText(dependency[1], "version");
    if (depArtifact) {
      symbols.push(manifestSymbol(filePath, language, "dependency", depGroup ? `${depGroup}:${depArtifact}` : depArtifact, offsetToLine(content, dependency.index ?? 0), "maven", version ?? undefined));
    }
  }
  return dedupeSymbols(symbols);
}

function extractGradleManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const projectName = /rootProject\.name\s*=\s*["']([^"']+)["']/.exec(content)?.[1] ?? /archivesBaseName\s*=\s*["']([^"']+)["']/.exec(content)?.[1];
  if (projectName) {
    symbols.push(manifestSymbol(filePath, language, "package", projectName, 1, "gradle"));
  }
  const dependencyRegex = /^\s*(?:implementation|api|compileOnly|runtimeOnly|testImplementation|kapt)\s*(?:\(?\s*)["']([^:"']+):([^:"']+):?([^"']*)["']/gm;
  for (const match of content.matchAll(dependencyRegex)) {
    const version = match[3]?.trim() || undefined;
    symbols.push(manifestSymbol(filePath, language, "dependency", `${match[1]}:${match[2]}`, offsetToLine(content, match.index ?? 0), "gradle", version));
  }
  return dedupeSymbols(symbols);
}

function extractMixManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const appName = /app:\s*:([A-Za-z_]\w*)/.exec(content)?.[1];
  if (appName) {
    symbols.push(manifestSymbol(filePath, language, "package", appName, 1, "hex"));
  }
  for (const match of content.matchAll(/\{\s*:([A-Za-z_]\w*)\s*,\s*["']([^"']+)["']/g)) {
    symbols.push(manifestSymbol(filePath, language, "dependency", match[1], offsetToLine(content, match.index ?? 0), "hex", match[2]));
  }
  return dedupeSymbols(symbols);
}

function extractGemspecManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const gemName = /\.name\s*=\s*["']([^"']+)["']/.exec(content)?.[1];
  if (gemName) {
    symbols.push(manifestSymbol(filePath, language, "package", gemName, 1, "ruby"));
  }
  for (const match of content.matchAll(/\.add_(?:runtime_|development_)?dependency\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/g)) {
    symbols.push(manifestSymbol(filePath, language, "dependency", match[1], offsetToLine(content, match.index ?? 0), "ruby", match[2]));
  }
  return dedupeSymbols(symbols);
}

function extractRequirementsManifest(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = /^\s*([A-Za-z0-9_.-]+)\s*([<>=!~].*)?$/.exec(line.replace(/#.*/, "").trim());
    if (match) {
      symbols.push(manifestSymbol(filePath, language, "dependency", match[1], index + 1, "python", match[2]?.trim()));
    }
  }
  return dedupeSymbols(symbols);
}

function manifestSymbol(filePath: string, language: Language, kind: "package" | "dependency", name: string, line: number, ecosystem: string, version?: string): SymbolNode {
  return makeSymbol(filePath, language, kind, name, line, line, undefined, kind === "package", {
    ecosystem,
    ...(version ? { version } : {})
  });
}

function tomlSection(content: string, name: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];
  let active = false;
  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (header) {
      if (active) {
        break;
      }
      active = header[1].trim() === name;
      continue;
    }
    if (active) {
      output.push(line);
    }
  }
  return output.join("\n");
}

function tomlStringValue(section: string, key: string): string | null {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*["']([^"']+)["']`, "m").exec(section)?.[1] ?? null;
}

function tomlArrayValues(section: string, key: string): string[] {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "m").exec(section);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]);
}

function tomlDependencyKeys(section: string): Array<{ name: string; version?: string }> {
  const dependencies: Array<{ name: string; version?: string }> = [];
  for (const line of section.split(/\r?\n/)) {
    const cleaned = line.replace(/#.*/, "").trim();
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]+)"|'([^']+)'|\{([^}]+)\})/.exec(cleaned);
    if (!match) {
      continue;
    }
    const inlineVersion = /version\s*=\s*["']([^"']+)["']/.exec(match[4] ?? "")?.[1];
    dependencies.push({ name: match[1], version: match[2] ?? match[3] ?? inlineVersion });
  }
  return dependencies;
}

function tomlInlineTableKeys(section: string): Array<{ name: string; version?: string }> {
  const dependencies: Array<{ name: string; version?: string }> = [];
  for (const line of section.split(/\r?\n/)) {
    const match = /^\s*[A-Za-z0-9_.-]+\s*=\s*\[([^\]]*)\]/.exec(line);
    if (!match) {
      continue;
    }
    dependencies.push(...[...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => parsePythonRequirement(item[1])));
  }
  return dependencies;
}

function parsePythonRequirement(value: string): { name: string; version?: string } {
  const match = /^\s*([A-Za-z0-9_.-]+)\s*(.*)$/.exec(value);
  return { name: match?.[1] ?? value.trim(), version: match?.[2]?.trim() || undefined };
}

function xmlText(block: string, tag: string): string | null {
  return new RegExp(`<${escapeRegExp(tag)}>([^<]+)</${escapeRegExp(tag)}>`, "i").exec(block)?.[1]?.trim() ?? null;
}

function extractYamlMapKeys(lines: string[], keys: string[]): Array<{ value: string; line: number }> {
  const items: Array<{ value: string; line: number }> = [];
  const keyPattern = keys.map(escapeRegExp).join("|");
  const mapStart = new RegExp(`^(\\s*)(${keyPattern})\\s*:\\s*(?:#.*)?$`);

  for (let index = 0; index < lines.length; index += 1) {
    const start = mapStart.exec(lines[index]);
    if (!start) {
      continue;
    }
    const baseIndent = start[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim()) {
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) {
        break;
      }
      const item = /^\s*([A-Za-z0-9_.-]+)\s*:/.exec(line);
      if (item) {
        items.push({ value: item[1], line: child + 1 });
      }
    }
  }
  return items;
}

function extractYamlInfrastructure(filePath: string, content: string): ExtractionResult {
  const symbols: SymbolNode[] = [];
  const edges: Edge[] = [];
  const fileNode = fileQualifiedName(filePath);
  const documents = splitYamlDocuments(content);

  for (const document of documents) {
    const kind = findYamlScalar(document.lines, "kind");
    const name = findYamlMetadataName(document.lines);
    if (kind && name) {
      const line = findYamlScalarLine(document.lines, "kind") + document.startLine - 1;
      const resource = makeSymbol(filePath, "yaml", "resource", `${kind}/${name}`, line, line, undefined, false, {
        kind,
        name
      });
      symbols.push(resource);
      edges.push({ source: fileNode, target: resource.qualifiedName, type: "DECLARES", weight: 1 });

      for (const image of extractYamlImages(document.lines)) {
        const imageSymbol = makeSymbol(filePath, "yaml", "container_image", image.value, image.line + document.startLine - 1, image.line + document.startLine - 1, undefined, false, {
          image: image.value
        });
        symbols.push(imageSymbol);
        edges.push({
          source: resource.qualifiedName,
          target: imageSymbol.qualifiedName,
          type: "CONFIGURES",
          weight: 0.8,
          metadata: { field: "image" }
        });
      }
    }
  }

  if (isKustomizationFile(filePath) || documents.some((document) => findYamlScalar(document.lines, "kind")?.toLowerCase() === "kustomization")) {
    const module = makeSymbol(filePath, "yaml", "module", `Kustomization/${kustomizationName(filePath)}`, 1, Math.max(1, content.split(/\r?\n/).length), undefined, false, {
      path: filePath
    });
    symbols.push(module);
    edges.push({ source: fileNode, target: module.qualifiedName, type: "DECLARES", weight: 1 });
    for (const item of extractYamlListItems(content.split(/\r?\n/), ["resources", "bases", "components"])) {
      edges.push({
        source: module.qualifiedName,
        target: fileQualifiedName(resolveKustomizeTarget(filePath, item.value)),
        type: "IMPORTS",
        weight: 0.7,
        metadata: { field: item.key, value: item.value }
      });
    }
  }

  return { symbols, edges, imports: [] };
}

function extractDockerfile(filePath: string, content: string): ExtractionResult {
  const symbols: SymbolNode[] = [];
  const edges: Edge[] = [];
  const fileNode = fileQualifiedName(filePath);
  const lines = content.split(/\r?\n/);
  const stagesByName = new Map<string, SymbolNode>();
  let currentStage: SymbolNode | null = null;
  let stageNumber = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const from = /^\s*FROM\s+([^\s]+)(?:\s+AS\s+([A-Za-z0-9_.-]+))?/i.exec(line);
    if (from) {
      stageNumber += 1;
      const image = from[1];
      const alias = from[2];
      const stageName = alias ?? `stage-${stageNumber}`;
      const stage = makeSymbol(filePath, "shell", "stage", stageName, lineNumber, lineNumber, line.trim(), true, {
        image,
        alias: alias ?? null
      });
      const imageSymbol = makeSymbol(filePath, "shell", "container_image", image, lineNumber, lineNumber, undefined, false, { image });
      symbols.push(stage, imageSymbol);
      edges.push({ source: fileNode, target: stage.qualifiedName, type: "DECLARES", weight: 1 });
      edges.push({ source: fileNode, target: imageSymbol.qualifiedName, type: "DECLARES", weight: 0.7 });
      edges.push({ source: stage.qualifiedName, target: imageSymbol.qualifiedName, type: "IMPORTS", weight: 0.9, metadata: { instruction: "FROM" } });
      stagesByName.set(stageName.toLowerCase(), stage);
      stagesByName.set(String(stageNumber - 1), stage);
      currentStage = stage;
      continue;
    }

    const copyFrom = /^\s*COPY\s+.*--from=([^\s]+)/i.exec(line);
    if (copyFrom && currentStage) {
      const sourceStage = stagesByName.get(copyFrom[1].toLowerCase());
      if (sourceStage) {
        edges.push({
          source: currentStage.qualifiedName,
          target: sourceStage.qualifiedName,
          type: "IMPORTS",
          weight: 0.75,
          metadata: { instruction: "COPY --from", line: lineNumber }
        });
      }
    }
  }

  return { symbols, edges, imports: [] };
}

function splitYamlDocuments(content: string): Array<{ startLine: number; lines: string[] }> {
  const lines = content.split(/\r?\n/);
  const documents: Array<{ startLine: number; lines: string[] }> = [];
  let current: string[] = [];
  let startLine = 1;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*---\s*$/.test(lines[index]) && current.some((line) => line.trim())) {
      documents.push({ startLine, lines: current });
      current = [];
      startLine = index + 2;
      continue;
    }
    current.push(lines[index]);
  }

  if (current.some((line) => line.trim())) {
    documents.push({ startLine, lines: current });
  }
  return documents;
}

function findYamlScalar(lines: string[], key: string): string | null {
  const regex = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*["']?([^"'#]+?)["']?\\s*(?:#.*)?$`);
  for (const line of lines) {
    const match = regex.exec(line);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

function findYamlScalarLine(lines: string[], key: string): number {
  const regex = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);
  const index = lines.findIndex((line) => regex.test(line));
  return index >= 0 ? index + 1 : 1;
}

function findYamlMetadataName(lines: string[]): string | null {
  for (let index = 0; index < lines.length; index += 1) {
    const metadata = /^(\s*)metadata\s*:\s*(?:#.*)?$/.exec(lines[index]);
    if (!metadata) {
      continue;
    }
    const metadataIndent = metadata[1].length;
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim()) {
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= metadataIndent) {
        break;
      }
      const name = /^\s*name\s*:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(line);
      if (name) {
        return name[1].trim();
      }
    }
  }
  return findYamlScalar(lines, "name");
}

function extractYamlImages(lines: string[]): Array<{ value: string; line: number }> {
  const images: Array<{ value: string; line: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\s*image\s*:\s*["']?([^"'#\s]+)["']?\s*(?:#.*)?$/.exec(lines[index]);
    if (match) {
      images.push({ value: match[1], line: index + 1 });
    }
  }
  return images;
}

function extractYamlListItems(lines: string[], keys: string[]): Array<{ key: string; value: string; line: number }> {
  const items: Array<{ key: string; value: string; line: number }> = [];
  const keyPattern = keys.map(escapeRegExp).join("|");
  const listStart = new RegExp(`^(\\s*)(${keyPattern})\\s*:\\s*(?:#.*)?$`);

  for (let index = 0; index < lines.length; index += 1) {
    const start = listStart.exec(lines[index]);
    if (!start) {
      continue;
    }
    const baseIndent = start[1].length;
    const key = start[2];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim()) {
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) {
        break;
      }
      const item = /^\s*-\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(line);
      if (item) {
        items.push({ key, value: item[1].trim(), line: child + 1 });
      }
    }
  }
  return items;
}

function isDockerfile(filePath: string): boolean {
  const base = path.posix.basename(filePath).toLowerCase();
  return base === "dockerfile" || base.endsWith(".dockerfile");
}

function isKustomizationFile(filePath: string): boolean {
  const base = path.posix.basename(filePath).toLowerCase();
  return base === "kustomization.yaml" || base === "kustomization.yml";
}

function kustomizationName(filePath: string): string {
  const dir = path.posix.dirname(filePath);
  return dir === "." ? "." : dir;
}

function resolveKustomizeTarget(filePath: string, value: string): string {
  if (/^[a-z]+:\/\//i.test(value) || value.startsWith("git::")) {
    return `external:${value}`;
  }
  const dir = path.posix.dirname(filePath);
  const base = dir === "." ? "" : dir;
  return path.posix.normalize(path.posix.join(base, value));
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
