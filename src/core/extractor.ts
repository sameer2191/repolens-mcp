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
  host?: string;
  scheme?: string;
  url?: string;
  urlKind: "absolute" | "relative";
}

interface HttpUrlInfo {
  path: string;
  host?: string;
  scheme?: string;
  url?: string;
  urlKind: "absolute" | "relative";
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

  for (const route of extractOpenApiRoutes(filePath, language, content)) {
    symbols.push(route);
    edges.push({ source: fileNode, target: route.qualifiedName, type: "DEFINES", weight: 1 });
  }

  for (const symbol of extractManifestSymbols(filePath, language, content)) {
    symbols.push(symbol);
    edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
  }

  const lockfile = extractLockfile(filePath, language, content);
  for (const symbol of lockfile.symbols) {
    symbols.push(symbol);
  }
  for (const edge of lockfile.edges) {
    edges.push(edge);
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
  } else if (language === "graphql") {
    for (const symbol of extractGraphql(filePath, language, content)) {
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: "DECLARES", weight: 1 });
    }
  } else if (language === "proto") {
    for (const symbol of extractProto(filePath, content)) {
      symbols.push(symbol);
      edges.push({ source: fileNode, target: symbol.qualifiedName, type: symbol.kind === "route" ? "DEFINES" : "DECLARES", weight: 1 });
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
  for (const method of extractClassMethods(filePath, language, lines, symbols)) {
    symbols.push(method);
    edges.push({ source: String(method.metadata?.parentQualifiedName ?? fileNode), target: method.qualifiedName, type: "DEFINES", weight: 0.95 });
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

  const protocols = extractProtocolLinks(filePath, language, content, symbols);
  for (const symbol of protocols.symbols) {
    symbols.push(symbol);
  }
  for (const edge of protocols.edges) {
    edges.push(edge);
  }

  return { symbols: dedupeSymbols(symbols), edges, imports };
}

export function addCallEdges(symbols: SymbolNode[], fileContents: Map<string, string>): Edge[] {
  const named = symbols.filter((symbol) => ["function", "method", "class"].includes(symbol.kind) && isCallableName(symbol.name));
  const files = symbols.filter((symbol) => symbol.kind === "file");
  const methodLookup = classMethodLookup(named);
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const addEdge = (source: string, target: string, type: "CALLS" | "CALLS_LOCAL", weight: number, metadata?: Record<string, unknown>) => {
    if (source === target) {
      return;
    }
    const key = `${source}\0${target}\0${type}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push({ source, target, type, weight, metadata });
  };
  for (const file of files) {
    const content = fileContents.get(file.filePath);
    if (!content) continue;
    for (const target of named) {
      if (file.filePath !== target.filePath && callsName(content, target.name, { allowMember: target.kind !== "method" })) {
        addEdge(file.qualifiedName, target.qualifiedName, "CALLS", 0.5, { scope: "file" });
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
    for (const receiverCall of receiverMethodCalls(source, local, content, methodLookup)) {
      const type = source.filePath === receiverCall.target.filePath ? "CALLS_LOCAL" : "CALLS";
      addEdge(source.qualifiedName, receiverCall.target.qualifiedName, type, type === "CALLS_LOCAL" ? 0.92 : 0.82, {
        resolution: "receiver_type",
        receiver: receiverCall.receiver,
        receiverType: receiverCall.receiverType,
        method: receiverCall.method
      });
    }
    for (const target of named) {
      if (source.qualifiedName === target.qualifiedName) {
        continue;
      }
      if (callsName(local, target.name, { allowMember: target.kind !== "method" })) {
        const type = source.filePath === target.filePath ? "CALLS_LOCAL" : "CALLS";
        addEdge(source.qualifiedName, target.qualifiedName, type, type === "CALLS_LOCAL" ? 1 : 0.75);
      }
    }
  }
  return edges;
}

function extractClassMethods(filePath: string, language: Language, lines: string[], symbols: SymbolNode[]): SymbolNode[] {
  if (!["typescript", "javascript"].includes(language)) {
    return [];
  }
  const classes = symbols.filter((symbol) => symbol.kind === "class" && symbol.filePath === filePath);
  const methods: SymbolNode[] = [];
  const methodRegex =
    /^\s*(?:(?:public|private|protected|static|async|override|readonly|abstract|get|set)\s+)*([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^{};]+)?\{/gm;
  for (const classSymbol of classes) {
    const classText = lines.slice(classSymbol.startLine - 1, classSymbol.endLine).join("\n");
    for (const match of classText.matchAll(methodRegex)) {
      const name = match[1];
      if (!name || !isCallableName(name) || isReservedMethodName(name)) {
        continue;
      }
      const line = classSymbol.startLine + offsetToLine(classText, match.index ?? 0) - 1;
      if (line <= classSymbol.startLine || line > classSymbol.endLine) {
        continue;
      }
      const signature = lines[line - 1]?.trim().slice(0, 220);
      methods.push(
        makeSymbol(filePath, language, "method", name, line, findBlockEndLine(language, lines, line), signature, false, {
          parentClass: classSymbol.name,
          parentQualifiedName: classSymbol.qualifiedName
        })
      );
    }
  }
  return methods;
}

function classMethodLookup(symbols: SymbolNode[]): Map<string, SymbolNode[]> {
  const lookup = new Map<string, SymbolNode[]>();
  for (const method of symbols.filter((symbol) => symbol.kind === "method" && typeof symbol.metadata?.parentClass === "string")) {
    const key = classMethodKey(String(method.metadata?.parentClass), method.name);
    lookup.set(key, [...(lookup.get(key) ?? []), method]);
  }
  return lookup;
}

function receiverMethodCalls(
  source: SymbolNode,
  local: string,
  fileContent: string,
  methodLookup: Map<string, SymbolNode[]>
): Array<{ target: SymbolNode; receiver: string; receiverType: string; method: string }> {
  if (methodLookup.size === 0) {
    return [];
  }
  const receiverTypes = new Map<string, string>();
  for (const [receiver, typeName] of inferReceiverTypes(fileContent)) {
    receiverTypes.set(receiver, typeName);
  }
  for (const [receiver, typeName] of inferReceiverTypes(local)) {
    receiverTypes.set(receiver, typeName);
  }
  const parentClass = typeof source.metadata?.parentClass === "string" ? source.metadata.parentClass : undefined;
  if (parentClass) {
    receiverTypes.set("this", parentClass);
  }

  const calls: Array<{ target: SymbolNode; receiver: string; receiverType: string; method: string }> = [];
  const receiverCallRegex = /\b((?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\.([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of local.matchAll(receiverCallRegex)) {
    const receiver = match[1];
    const method = match[2];
    if (!receiver || !method || isReservedMethodName(method)) {
      continue;
    }
    const receiverType = receiverTypes.get(receiver);
    if (!receiverType) {
      continue;
    }
    const target = resolveClassMethod(receiverType, method, source, methodLookup);
    if (!target) {
      continue;
    }
    calls.push({ target, receiver, receiverType, method });
  }
  return calls;
}

function inferReceiverTypes(content: string): Map<string, string> {
  const receiverTypes = new Map<string, string>();
  const declarationRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of content.matchAll(declarationRegex)) {
    const receiver = match[1];
    const typeName = match[3] ?? match[2];
    if (receiver && typeName) {
      receiverTypes.set(receiver, typeName);
    }
  }
  const assignmentRegex = /\b(this\.[A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of content.matchAll(assignmentRegex)) {
    const receiver = match[1];
    const typeName = match[2];
    if (receiver && typeName) {
      receiverTypes.set(receiver, typeName);
    }
  }
  return receiverTypes;
}

function resolveClassMethod(typeName: string, method: string, source: SymbolNode, methodLookup: Map<string, SymbolNode[]>): SymbolNode | null {
  const candidates = methodLookup.get(classMethodKey(typeName, method)) ?? [];
  if (candidates.length === 0) {
    return null;
  }
  const sameFile = candidates.filter((candidate) => candidate.filePath === source.filePath);
  if (sameFile.length === 1) {
    return sameFile[0];
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function classMethodKey(className: string, method: string): string {
  return `${className}.${method}`;
}

function isReservedMethodName(name: string): boolean {
  return ["constructor", "if", "for", "while", "switch", "catch", "function", "return"].includes(name.toLowerCase());
}

export function addTypeRelationEdges(symbols: SymbolNode[], fileContents: Map<string, string>): Edge[] {
  const typeSymbols = symbols.filter(isTypeSymbol);
  if (typeSymbols.length === 0) {
    return [];
  }

  const typeLookup = new Map<string, SymbolNode[]>();
  for (const symbol of typeSymbols) {
    typeLookup.set(symbol.name, [...(typeLookup.get(symbol.name) ?? []), symbol]);
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();
  const structuralTargets = new Map<string, Set<string>>();
  const addEdge = (source: SymbolNode, target: SymbolNode, type: "INHERITS" | "IMPLEMENTS" | "USES_TYPE", weight: number, metadata?: Record<string, unknown>) => {
    if (source.qualifiedName === target.qualifiedName) {
      return;
    }
    const key = `${source.qualifiedName}\0${target.qualifiedName}\0${type}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    edges.push({ source: source.qualifiedName, target: target.qualifiedName, type, weight, metadata });
    if (type !== "USES_TYPE") {
      const targets = structuralTargets.get(source.qualifiedName) ?? new Set<string>();
      targets.add(target.qualifiedName);
      structuralTargets.set(source.qualifiedName, targets);
    }
  };

  for (const source of typeSymbols) {
    const declaration = declarationTextForSymbol(source, fileContents);
    for (const relation of declarationTypeRelations(source, declaration)) {
      for (const targetName of relation.targets) {
        const target = resolveTypeSymbol(targetName, source, typeLookup);
        if (!target) {
          continue;
        }
        const type = relation.type ?? structuralRelationFor(source, target);
        addEdge(source, target, type, type === "INHERITS" ? 0.95 : 0.9, { relation: relation.reason, targetName });
      }
    }
  }

  for (const source of symbols.filter(shouldScanTypeUses)) {
    const text = textForSymbol(source, fileContents);
    if (!text) {
      continue;
    }
    for (const typeName of extractReferencedTypeNames(text, typeLookup)) {
      if (typeName === source.name) {
        continue;
      }
      const target = resolveTypeSymbol(typeName, source, typeLookup);
      if (!target || structuralTargets.get(source.qualifiedName)?.has(target.qualifiedName)) {
        continue;
      }
      addEdge(source, target, "USES_TYPE", source.filePath === target.filePath ? 0.75 : 0.6, { targetName: typeName });
    }
  }

  return edges;
}

export function addDataFlowEdges(symbols: SymbolNode[], fileContents: Map<string, string>, candidateEdges: Edge[] = []): Edge[] {
  const callables = symbols.filter((symbol) => ["function", "method"].includes(symbol.kind) && isCallableName(symbol.name));
  if (callables.length === 0) {
    return [];
  }
  const byName = new Map<string, SymbolNode[]>();
  for (const callable of callables) {
    byName.set(callable.name, [...(byName.get(callable.name) ?? []), callable]);
  }
  const callCandidates = new Set(
    candidateEdges.filter((edge) => edge.type === "CALLS" || edge.type === "CALLS_LOCAL").map((edge) => `${edge.source}\0${edge.target}`)
  );
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const source of callables) {
    const content = textForSymbol(source, fileContents);
    if (!content) {
      continue;
    }
    for (const target of callables) {
      if (source.qualifiedName === target.qualifiedName) {
        continue;
      }
      if (!dataFlowCandidateAllowed(source, target, byName, callCandidates)) {
        continue;
      }
      const params = parameterNames(target.signature || declarationTextForSymbol(target, fileContents), target.language);
      for (const call of functionCallArguments(content, target.name)) {
        const mappings = mapArgumentsToParameters(call.args, params);
        if (mappings.length === 0) {
          continue;
        }
        const key = `${source.qualifiedName}\0${target.qualifiedName}\0${target.name}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        edges.push({
          source: source.qualifiedName,
          target: target.qualifiedName,
          type: "DATA_FLOWS",
          weight: source.filePath === target.filePath ? 0.82 : 0.68,
          metadata: {
            call: target.name,
            mappings
          }
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
    const host = typeof call.metadata?.host === "string" && call.metadata.host.trim() ? call.metadata.host : undefined;
    const confidence = method === "ANY" ? 0.65 : host ? 0.8 : 0.9;
    const matchReason = method === "ANY" ? "any_path" : host ? "method_path_absolute_host_unresolved" : "method_path";
    for (const route of exact.length ? exact : fallback) {
      if (source === route.qualifiedName) continue;
      edges.push({
        source,
        target: route.qualifiedName,
        type: "HTTP_CALLS",
        weight: confidence,
        metadata: {
          method,
          path: pathValue,
          ...(host ? { host } : {}),
          confidence,
          matchReason,
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

export function extractImports(language: Language, content: string): string[] {
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
  const nextRoutePath = nextRoutePathFromFile(filePath);
  if (nextRoutePath && ["typescript", "javascript"].includes(language)) {
    const nextMethodRegexes = [
      /^\s*export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/gm,
      /^\s*export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/gm
    ];
    for (const regex of nextMethodRegexes) {
      for (const match of content.matchAll(regex)) {
        const method = match[1].toUpperCase();
        const line = offsetToLine(content, match.index ?? 0);
        routes.push(
          makeSymbol(filePath, language, "route", `${method} ${nextRoutePath}`, line, line, undefined, true, {
            method,
            path: nextRoutePath,
            framework: "next-app-router"
          })
        );
      }
    }
  }
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

function nextRoutePathFromFile(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const match = /(?:^|\/)app\/api(?:\/(.+))?\/route\.[cm]?[jt]sx?$/.exec(normalized);
  if (!match) {
    return null;
  }
  const routePart = match[1] ?? "";
  const segments = routePart
    .split("/")
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
    .map(nextRouteSegment);
  return `/api${segments.length > 0 ? `/${segments.join("/")}` : ""}`;
}

function nextRouteSegment(segment: string): string {
  const optionalCatchAll = /^\[\[\.\.\.([A-Za-z0-9_-]+)\]\]$/.exec(segment);
  if (optionalCatchAll) {
    return `*${optionalCatchAll[1]}?`;
  }
  const catchAll = /^\[\.\.\.([A-Za-z0-9_-]+)\]$/.exec(segment);
  if (catchAll) {
    return `*${catchAll[1]}`;
  }
  const dynamic = /^\[([A-Za-z0-9_-]+)\]$/.exec(segment);
  if (dynamic) {
    return `:${dynamic[1]}`;
  }
  return segment;
}

function extractOpenApiRoutes(filePath: string, language: Language, content: string): SymbolNode[] {
  if (!["yaml", "json"].includes(language)) {
    return [];
  }
  if (!/^\s*(?:openapi|swagger)\s*[:=]/im.test(content) && !/"(?:openapi|swagger)"\s*:/.test(content)) {
    return [];
  }
  return language === "json" ? extractOpenApiJsonRoutes(filePath, language, content) : extractOpenApiYamlRoutes(filePath, language, content);
}

function extractOpenApiJsonRoutes(filePath: string, language: Language, content: string): SymbolNode[] {
  try {
    const parsed = JSON.parse(content) as { paths?: Record<string, Record<string, unknown>> };
    const symbols: SymbolNode[] = [];
    for (const [rawPath, pathItem] of Object.entries(parsed.paths ?? {})) {
      if (!pathItem || typeof pathItem !== "object") {
        continue;
      }
      for (const method of Object.keys(pathItem)) {
        const upperMethod = method.toUpperCase();
        if (!isOpenApiMethod(upperMethod)) {
          continue;
        }
        const routePath = openApiPathToRoutePath(rawPath);
        const line = Math.max(1, offsetToLine(content, Math.max(0, content.indexOf(`"${rawPath}"`))));
        symbols.push(openApiRouteSymbol(filePath, language, upperMethod, routePath, line));
      }
    }
    return symbols;
  } catch {
    return [];
  }
}

function extractOpenApiYamlRoutes(filePath: string, language: Language, content: string): SymbolNode[] {
  const lines = content.split(/\r?\n/);
  const symbols: SymbolNode[] = [];
  let inPaths = false;
  let pathsIndent = 0;
  let currentPath: string | null = null;
  let currentPathIndent = 0;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (/^paths\s*:\s*$/.test(trimmed)) {
      inPaths = true;
      pathsIndent = indent;
      currentPath = null;
      currentPathIndent = indent;
      continue;
    }
    if (!inPaths) {
      continue;
    }
    if (indent <= pathsIndent && !/^paths\s*:\s*$/.test(trimmed)) {
      inPaths = false;
      currentPath = null;
      continue;
    }
    const pathMatch = /^(["']?\/[^:"']*["']?)\s*:\s*$/.exec(trimmed);
    if (pathMatch) {
      currentPath = openApiPathToRoutePath(pathMatch[1].replace(/^["']|["']$/g, ""));
      currentPathIndent = indent;
      continue;
    }
    const methodMatch = /^(get|post|put|patch|delete|head|options|trace)\s*:\s*$/.exec(trimmed);
    if (currentPath && methodMatch && indent > currentPathIndent) {
      symbols.push(openApiRouteSymbol(filePath, language, methodMatch[1].toUpperCase(), currentPath, index + 1));
    }
  }

  return symbols;
}

function openApiRouteSymbol(filePath: string, language: Language, method: string, routePath: string, line: number): SymbolNode {
  return makeSymbol(filePath, language, "route", `${method} ${routePath}`, line, line, undefined, true, {
    method,
    path: routePath,
    protocol: "openapi"
  });
}

function openApiPathToRoutePath(value: string): string {
  return value.replace(/\{([A-Za-z0-9_-]+)\}/g, ":$1");
}

function isOpenApiMethod(method: string): boolean {
  return ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"].includes(method);
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
    const key = `${call.method}:${call.host ?? ""}:${call.path}:${call.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const name = `${call.method} ${call.path}`;
    const metadata: Record<string, unknown> = {
      method: call.method,
      path: call.path,
      line: call.line,
      urlKind: call.urlKind
    };
    if (call.host) metadata.host = call.host;
    if (call.scheme) metadata.scheme = call.scheme;
    if (call.url) metadata.url = call.url;
    const callSymbol = makeSymbol(filePath, language, "http_call", name, call.line, call.line, undefined, false, metadata);
    const source = sourceSymbolForLine(symbols, call.line)?.qualifiedName ?? fileNode;
    callSymbols.push(callSymbol);
    edges.push({ source: fileNode, target: callSymbol.qualifiedName, type: "DEFINES", weight: 0.8 });
    edges.push({
      source,
      target: callSymbol.qualifiedName,
      type: "CALLS_HTTP_ENDPOINT",
      weight: call.method === "ANY" ? 0.6 : 0.8,
      metadata
    });
  }

  return { symbols: callSymbols, edges, imports: [] };
}

function extractProtocolLinks(filePath: string, language: Language, content: string, symbols: SymbolNode[]): ExtractionResult {
  if (!["typescript", "javascript"].includes(language)) {
    return { symbols: [], edges: [], imports: [] };
  }

  const protocolSymbols: SymbolNode[] = [];
  const edges: Edge[] = [];
  const fileNode = fileQualifiedName(filePath);

  for (const symbol of extractGraphqlTemplates(filePath, language, content)) {
    protocolSymbols.push(symbol);
    const source = sourceSymbolForLine(symbols, symbol.startLine, filePath)?.qualifiedName ?? fileNode;
    edges.push({ source, target: symbol.qualifiedName, type: "USES_GRAPHQL", weight: 0.75, metadata: symbol.metadata });
  }

  for (const symbol of extractTrpc(filePath, language, content)) {
    protocolSymbols.push(symbol);
    const source = sourceSymbolForLine(symbols, symbol.startLine, filePath)?.qualifiedName ?? fileNode;
    edges.push({ source, target: symbol.qualifiedName, type: symbol.kind === "trpc_call" ? "CALLS_TRPC" : "DEFINES", weight: symbol.kind === "trpc_call" ? 0.75 : 0.9, metadata: symbol.metadata });
  }

  return { symbols: protocolSymbols, edges, imports: [] };
}

function extractGraphql(filePath: string, language: Language, content: string): SymbolNode[] {
  return [...extractGraphqlOperations(filePath, language, content), ...extractGraphqlTypes(filePath, language, content)];
}

function extractGraphqlTemplates(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const templateRegex = /\b(?:gql|graphql)\s*`([\s\S]*?)`/g;
  for (const match of content.matchAll(templateRegex)) {
    const body = match[1] ?? "";
    const baseLine = offsetToLine(content, match.index ?? 0);
    for (const operation of extractGraphqlOperations(filePath, language, body, baseLine)) {
      symbols.push({ ...operation, qualifiedName: `${operation.qualifiedName}:template`, metadata: { ...operation.metadata, source: "template" } });
    }
  }
  return symbols;
}

function extractGraphqlOperations(filePath: string, language: Language, content: string, baseLine = 1): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const operationRegex = /\b(query|mutation|subscription)\s+([A-Za-z_][\w]*)?/g;
  for (const match of content.matchAll(operationRegex)) {
    const operation = match[1].toLowerCase();
    const name = match[2] || "anonymous";
    const line = baseLine + offsetToLine(content, match.index ?? 0) - 1;
    symbols.push(
      makeSymbol(filePath, language, "graphql_operation", `${operation} ${name}`, line, line, undefined, true, {
        protocol: "graphql",
        operation,
        name
      })
    );
  }
  return symbols;
}

function extractGraphqlTypes(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const typeRegex = /^\s*(type|input|interface|enum|scalar)\s+([A-Za-z_][\w]*)/gm;
  for (const match of content.matchAll(typeRegex)) {
    const category = match[1].toLowerCase();
    const name = match[2];
    const line = offsetToLine(content, match.index ?? 0);
    symbols.push(
      makeSymbol(filePath, language, "graphql_type", `${category} ${name}`, line, line, undefined, true, {
        protocol: "graphql",
        category,
        name
      })
    );
  }
  return symbols;
}

function extractProto(filePath: string, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  let currentService: { name: string; line: number } | null = null;
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const serviceMatch = /^\s*service\s+([A-Za-z_][\w]*)\s*\{?/.exec(line);
    if (serviceMatch) {
      currentService = { name: serviceMatch[1], line: index + 1 };
      symbols.push(
        makeSymbol(filePath, "proto", "grpc_service", currentService.name, currentService.line, currentService.line, line.trim(), true, {
          protocol: "grpc",
          service: currentService.name
        })
      );
      continue;
    }
    if (/^\s*}\s*$/.test(line)) {
      currentService = null;
      continue;
    }
    const rpcMatch = /^\s*rpc\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)\s+returns\s+\(([^)]*)\)/.exec(line);
    if (rpcMatch && currentService) {
      const method = rpcMatch[1];
      symbols.push(
        makeSymbol(filePath, "proto", "route", `RPC /${currentService.name}/${method}`, index + 1, index + 1, line.trim(), true, {
          protocol: "grpc",
          method: "RPC",
          path: `/${currentService.name}/${method}`,
          service: currentService.name,
          rpc: method,
          request: rpcMatch[2].trim(),
          response: rpcMatch[3].trim()
        })
      );
    }
  }
  return symbols;
}

function extractTrpc(filePath: string, language: Language, content: string): SymbolNode[] {
  const symbols: SymbolNode[] = [];
  const declarationRegex = /([A-Za-z_$][\w$]*)\s*:\s*(?:publicProcedure|protectedProcedure|procedure|adminProcedure)[\s\S]{0,240}?\.(query|mutation|subscription)\s*\(/g;
  for (const match of content.matchAll(declarationRegex)) {
    const name = match[1];
    const procedureType = match[2].toLowerCase();
    const line = offsetToLine(content, match.index ?? 0);
    symbols.push(
      makeSymbol(filePath, language, "trpc_procedure", `${procedureType} ${name}`, line, line, undefined, true, {
        protocol: "trpc",
        procedure: name,
        procedureType
      })
    );
  }

  const callRegex = /\b(?:trpc|api)\.([A-Za-z_$][\w$.]*)\.(useQuery|useMutation|query|mutate|mutation)\s*\(/g;
  for (const match of content.matchAll(callRegex)) {
    const procedure = match[1];
    const callType = match[2];
    const line = offsetToLine(content, match.index ?? 0);
    symbols.push(
      makeSymbol(filePath, language, "trpc_call", `${callType} ${procedure}`, line, line, undefined, false, {
        protocol: "trpc",
        procedure,
        callType
      })
    );
  }

  return symbols;
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
    const urlInfo = parseHttpUrl(match[1]);
    if (!urlInfo) continue;
    const windowEnd = nextHttpCallBoundary(content, (match.index ?? 0) + match[0].length);
    const callWindow = content.slice(match.index ?? 0, windowEnd);
    const methodMatch = /\bmethod\s*:\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/i.exec(callWindow);
    calls.push({
      method: (methodMatch?.[1] ?? "GET").toUpperCase(),
      ...urlInfo,
      line: startLine + offsetToLine(content, match.index ?? 0) - 1
    });
  }

  const regexes: Array<{ regex: RegExp; method?: (match: RegExpExecArray) => string; urlGroup: number }> = [
    { regex: /\baxios\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi, method: (match) => match[1], urlGroup: 2 },
    { regex: /\b(?:http|https)\.(get|request)\(\s*["'`]([^"'`]+)["'`]/gi, method: (match) => (match[1].toLowerCase() === "get" ? "GET" : "ANY"), urlGroup: 2 }
  ];
  for (const { regex, method, urlGroup } of regexes) {
    for (const match of content.matchAll(regex)) {
      const urlInfo = parseHttpUrl(match[urlGroup]);
      if (!urlInfo) continue;
      calls.push({
        method: method?.(match).toUpperCase() ?? "ANY",
        ...urlInfo,
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
  const pathOnly = /^[a-z]+:\/\//i.test(trimmed) ? safeUrlPathname(trimmed) : trimmed.split(/[?#]/, 1)[0];
  return pathOnly.startsWith("/") ? pathOnly.replace(/\/+$/, "") || "/" : null;
}

function parseHttpUrl(value: string | undefined): HttpUrlInfo | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      const pathValue = normalizeHttpPath(parsed.pathname);
      if (!pathValue) {
        return null;
      }
      const host = parsed.host.toLowerCase();
      const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
      return {
        path: pathValue,
        host,
        scheme,
        url: `${scheme}://${host}${pathValue}`,
        urlKind: "absolute"
      };
    } catch {
      return null;
    }
  }
  const pathValue = normalizeHttpPath(trimmed);
  return pathValue ? { path: pathValue, urlKind: "relative" } : null;
}

function safeUrlPathname(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
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

interface LockedDependency {
  name: string;
  version?: string;
  line: number;
}

function extractLockfile(filePath: string, language: Language, content: string): ExtractionResult {
  const descriptor = lockfileDescriptor(filePath);
  if (!descriptor) {
    return { symbols: [], edges: [], imports: [] };
  }

  const dependencies = dedupeLockedDependencies(descriptor.extract(content));
  if (dependencies.length === 0) {
    return { symbols: [], edges: [], imports: [] };
  }

  const lockSymbol = makeSymbol(filePath, language, "lockfile", path.posix.basename(filePath), 1, Math.max(1, content.split(/\r?\n/).length), undefined, false, {
    ecosystem: descriptor.ecosystem,
    packageManager: descriptor.packageManager,
    lockedDependencies: dependencies.length
  });
  const symbols: SymbolNode[] = [lockSymbol];
  const edges: Edge[] = [{ source: fileQualifiedName(filePath), target: lockSymbol.qualifiedName, type: "DECLARES", weight: 1 }];

  for (const dependency of dependencies) {
    const symbol = makeSymbol(filePath, language, "locked_dependency", dependency.name, dependency.line, dependency.line, undefined, false, {
      ecosystem: descriptor.ecosystem,
      packageManager: descriptor.packageManager,
      ...(dependency.version ? { version: dependency.version } : {})
    });
    symbols.push(symbol);
    edges.push({
      source: lockSymbol.qualifiedName,
      target: symbol.qualifiedName,
      type: "LOCKS",
      weight: 0.8,
      metadata: {
        ecosystem: descriptor.ecosystem,
        packageManager: descriptor.packageManager,
        ...(dependency.version ? { version: dependency.version } : {})
      }
    });
  }

  return { symbols: dedupeSymbols(symbols), edges, imports: [] };
}

function lockfileDescriptor(filePath: string):
  | {
      ecosystem: string;
      packageManager: string;
      extract: (content: string) => LockedDependency[];
    }
  | null {
  const base = path.posix.basename(filePath).toLowerCase();
  if (base === "package-lock.json" || base === "npm-shrinkwrap.json") {
    return { ecosystem: "npm", packageManager: "npm", extract: extractPackageLock };
  }
  if (base === "pnpm-lock.yaml" || base === "pnpm-lock.yml") {
    return { ecosystem: "npm", packageManager: "pnpm", extract: extractPnpmLock };
  }
  if (base === "yarn.lock") {
    return { ecosystem: "npm", packageManager: "yarn", extract: extractYarnLock };
  }
  if (base === "composer.lock") {
    return { ecosystem: "composer", packageManager: "composer", extract: extractComposerLock };
  }
  if (base === "cargo.lock") {
    return { ecosystem: "cargo", packageManager: "cargo", extract: extractCargoOrPoetryLock };
  }
  if (base === "poetry.lock") {
    return { ecosystem: "python", packageManager: "poetry", extract: extractCargoOrPoetryLock };
  }
  if (base === "go.sum") {
    return { ecosystem: "go", packageManager: "go", extract: extractGoSum };
  }
  if (base === "gemfile.lock") {
    return { ecosystem: "ruby", packageManager: "bundler", extract: extractGemfileLock };
  }
  return null;
}

function extractPackageLock(content: string): LockedDependency[] {
  try {
    const parsed = JSON.parse(content) as {
      packages?: Record<string, { name?: string; version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    const dependencies: LockedDependency[] = [];
    if (parsed.packages) {
      for (const [packagePath, info] of Object.entries(parsed.packages)) {
        if (!packagePath) {
          continue;
        }
        const name = info.name ?? npmPackageNameFromPath(packagePath);
        if (name) {
          dependencies.push({ name, version: cleanVersion(info.version), line: jsonPropertyLine(content, name) });
        }
      }
    }
    if (dependencies.length === 0 && parsed.dependencies) {
      for (const [name, info] of Object.entries(parsed.dependencies)) {
        dependencies.push({ name, version: cleanVersion(info.version), line: jsonPropertyLine(content, name) });
      }
    }
    return dependencies;
  } catch {
    return [];
  }
}

function extractComposerLock(content: string): LockedDependency[] {
  try {
    const parsed = JSON.parse(content) as {
      packages?: Array<{ name?: string; version?: string }>;
      "packages-dev"?: Array<{ name?: string; version?: string }>;
    };
    return [...(parsed.packages ?? []), ...(parsed["packages-dev"] ?? [])].flatMap((item) =>
      item.name ? [{ name: item.name, version: cleanVersion(item.version), line: jsonPropertyLine(content, item.name) }] : []
    );
  } catch {
    return [];
  }
}

function extractPnpmLock(content: string): LockedDependency[] {
  const dependencies: LockedDependency[] = [];
  const lines = content.split(/\r?\n/);
  let inPackages = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(line) && !/^packages:\s*$/.test(line)) {
      break;
    }
    if (!inPackages) {
      continue;
    }
    const match = /^\s{2}["']?([^"':]+(?:@|\/)[^"':]+)["']?\s*:/.exec(line);
    const parsed = match ? parseLockKey(match[1]) : null;
    if (parsed) {
      dependencies.push({ ...parsed, line: index + 1 });
    }
  }

  return dependencies;
}

function extractYarnLock(content: string): LockedDependency[] {
  const dependencies: LockedDependency[] = [];
  const lines = content.split(/\r?\n/);
  let currentName: string | null = null;
  let currentLine = 1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const descriptor = /^("?[^#\s][^:]*"?):\s*$/.exec(line);
    if (descriptor) {
      currentName = yarnDescriptorName(descriptor[1]);
      currentLine = index + 1;
      continue;
    }
    if (!currentName) {
      continue;
    }
    const version = /^\s+version\s+"([^"]+)"/.exec(line)?.[1];
    if (version) {
      dependencies.push({ name: currentName, version: cleanVersion(version), line: currentLine });
      currentName = null;
    }
  }

  return dependencies;
}

function extractCargoOrPoetryLock(content: string): LockedDependency[] {
  const dependencies: LockedDependency[] = [];
  for (const block of content.matchAll(/\[\[package\]\]([\s\S]*?)(?=\n\[\[package\]\]|\s*$)/g)) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block[1])?.[1];
    if (!name) {
      continue;
    }
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block[1])?.[1];
    dependencies.push({ name, version: cleanVersion(version), line: offsetToLine(content, block.index ?? 0) });
  }
  return dependencies;
}

function extractGoSum(content: string): LockedDependency[] {
  const dependencies: LockedDependency[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const match = /^(\S+)\s+(\S+)(?:\/go\.mod)?\s+h1:/.exec(line.trim());
    if (match) {
      dependencies.push({ name: match[1], version: cleanVersion(match[2].replace(/\/go\.mod$/, "")), line: index + 1 });
    }
  }
  return dependencies;
}

function extractGemfileLock(content: string): LockedDependency[] {
  const dependencies: LockedDependency[] = [];
  const lines = content.split(/\r?\n/);
  let inSpecs = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s{2}specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }
    if (inSpecs && /^\S/.test(line)) {
      break;
    }
    const match = inSpecs ? /^\s{4}([A-Za-z0-9_.-]+)\s+\(([^)]+)\)/.exec(line) : null;
    if (match) {
      dependencies.push({ name: match[1], version: cleanVersion(match[2]), line: index + 1 });
    }
  }
  return dependencies;
}

function npmPackageNameFromPath(packagePath: string): string | null {
  const parts = packagePath.split("node_modules/");
  const last = parts.at(-1)?.replace(/\/$/, "");
  return last || null;
}

function parseLockKey(value: string): { name: string; version?: string } | null {
  const normalized = value
    .replace(/^["']|["']$/g, "")
    .replace(/^\//, "")
    .replace(/\(.+\)$/, "");
  const slashVersion = /^(.+)\/([^/]+)$/.exec(normalized);
  if (slashVersion && /^\d/.test(slashVersion[2])) {
    return { name: slashVersion[1], version: cleanVersion(slashVersion[2]) };
  }
  const split = normalized.lastIndexOf("@");
  if (split <= 0) {
    return null;
  }
  return { name: normalized.slice(0, split), version: cleanVersion(normalized.slice(split + 1)) };
}

function yarnDescriptorName(value: string): string | null {
  const descriptor = value
    .replace(/^"|"$/g, "")
    .split(/,\s*/)
    .find(Boolean);
  if (!descriptor) {
    return null;
  }
  const split = descriptor.lastIndexOf("@");
  if (split <= 0) {
    return descriptor;
  }
  return descriptor.slice(0, split);
}

function cleanVersion(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^v/, "").replace(/\(.+\)$/, "");
  return normalized || undefined;
}

function jsonPropertyLine(content: string, property: string): number {
  const escaped = escapeRegExp(JSON.stringify(property).slice(1, -1));
  const index = content.search(new RegExp(`"(${escaped})"`));
  return index >= 0 ? offsetToLine(content, index) : 1;
}

function dedupeLockedDependencies(dependencies: LockedDependency[]): LockedDependency[] {
  const seen = new Set<string>();
  const output: LockedDependency[] = [];
  for (const dependency of dependencies) {
    if (!dependency.name || dependency.name === "." || dependency.name.startsWith("file:") || dependency.name.startsWith("link:")) {
      continue;
    }
    const key = `${dependency.name}@${dependency.version ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(dependency);
  }
  return output;
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

function isTypeSymbol(symbol: SymbolNode): boolean {
  return ["class", "interface", "type", "struct", "enum", "protocol", "actor", "trait"].includes(symbol.kind);
}

function shouldScanTypeUses(symbol: SymbolNode): boolean {
  return ["function", "method", "class", "interface", "type", "struct", "enum", "protocol", "actor", "trait"].includes(symbol.kind);
}

function declarationTextForSymbol(symbol: SymbolNode, fileContents: Map<string, string>): string {
  const content = fileContents.get(symbol.filePath);
  if (!content) {
    return symbol.signature ?? "";
  }
  const lines = content.split(/\r?\n/);
  const declaration: string[] = [];
  for (let index = Math.max(0, symbol.startLine - 1); index < Math.min(lines.length, symbol.startLine + 8); index += 1) {
    const line = lines[index];
    declaration.push(line);
    if (line.includes("{") || line.trimEnd().endsWith(";")) {
      break;
    }
  }
  return declaration.join("\n");
}

function textForSymbol(symbol: SymbolNode, fileContents: Map<string, string>): string {
  const content = fileContents.get(symbol.filePath);
  if (!content) {
    return symbol.signature ?? "";
  }
  const lines = content.split(/\r?\n/);
  return lines
    .slice(Math.max(0, symbol.startLine - 1), Math.min(lines.length, symbol.endLine))
    .join("\n");
}

function declarationTypeRelations(symbol: SymbolNode, declaration: string): Array<{ type?: "INHERITS" | "IMPLEMENTS"; targets: string[]; reason: string }> {
  const compact = declaration.replace(/\s+/g, " ").trim();
  const relations: Array<{ type?: "INHERITS" | "IMPLEMENTS"; targets: string[]; reason: string }> = [];

  const classExtends = /\bclass\s+[A-Za-z_$][\w$]*(?:<[^>{}]+>)?\s+extends\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:<[^>{}]+>)?)/.exec(compact);
  if (classExtends?.[1]) {
    relations.push({ type: "INHERITS", targets: typeNamesFromList(classExtends[1]), reason: "class extends" });
  }
  const classImplements = /\bclass\s+[A-Za-z_$][\w$]*(?:<[^>{}]+>)?(?:\s+extends\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?(?:<[^>{}]+>)?)?\s+implements\s+([^{}]+)/.exec(compact);
  if (classImplements?.[1]) {
    relations.push({ type: "IMPLEMENTS", targets: typeNamesFromList(classImplements[1]), reason: "class implements" });
  }
  const interfaceExtends = /\binterface\s+[A-Za-z_$][\w$]*(?:<[^>{}]+>)?\s+extends\s+([^{}]+)/.exec(compact);
  if (interfaceExtends?.[1]) {
    relations.push({ type: "INHERITS", targets: typeNamesFromList(interfaceExtends[1]), reason: "interface extends" });
  }
  const pythonBases = /\bclass\s+[A-Za-z_]\w*\(([^)]*)\)/.exec(compact);
  if (pythonBases?.[1]) {
    relations.push({ type: "INHERITS", targets: typeNamesFromList(pythonBases[1]), reason: "python base class" });
  }
  const rustTraitBounds = /\btrait\s+[A-Za-z_]\w*\s*:\s*([^{}]+)/.exec(compact);
  if (rustTraitBounds?.[1]) {
    relations.push({ type: "INHERITS", targets: typeNamesFromList(rustTraitBounds[1]), reason: "trait bound" });
  }
  if (["swift", "kotlin"].includes(symbol.language) || ["struct", "enum", "protocol", "actor"].includes(symbol.kind)) {
    const swiftConformance = /\b(?:class|struct|enum|actor|protocol)\s+[A-Za-z_]\w*(?:<[^>{}]+>)?\s*:\s*([^{}]+)/.exec(compact);
    if (swiftConformance?.[1]) {
      relations.push({ targets: typeNamesFromList(swiftConformance[1]), reason: "swift inheritance or conformance" });
    }
  }

  return relations.filter((relation) => relation.targets.length > 0);
}

function structuralRelationFor(source: SymbolNode, target: SymbolNode): "INHERITS" | "IMPLEMENTS" {
  if (source.kind === "class" && target.kind !== "protocol" && target.kind !== "interface" && target.kind !== "trait") {
    return "INHERITS";
  }
  if (source.kind === "protocol" || source.kind === "interface" || source.kind === "trait") {
    return "INHERITS";
  }
  return "IMPLEMENTS";
}

function typeNamesFromList(value: string): string[] {
  const names = new Set<string>();
  for (const segment of value.split(/[,|+&]/)) {
    const cleaned = segment
      .replace(/<[^<>]*>/g, " ")
      .replace(/\bwhere\b[\s\S]*$/i, " ")
      .trim();
    const match = /(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)/.exec(cleaned);
    if (match?.[1] && !ignoredTypeNames.has(match[1])) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function extractReferencedTypeNames(text: string, typeLookup: Map<string, SymbolNode[]>): string[] {
  const cleaned = text.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1/g, " ");
  const names = new Set<string>();
  for (const match of cleaned.matchAll(/\b[A-Z][A-Za-z0-9_$]*\b/g)) {
    const name = match[0];
    if (typeLookup.has(name) && !ignoredTypeNames.has(name)) {
      names.add(name);
    }
  }
  return [...names];
}

const ignoredTypeNames = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "False",
  "Map",
  "None",
  "Number",
  "Object",
  "Partial",
  "Promise",
  "Record",
  "Request",
  "Response",
  "Result",
  "Set",
  "String",
  "True",
  "Void"
]);

function resolveTypeSymbol(name: string, source: SymbolNode, typeLookup: Map<string, SymbolNode[]>): SymbolNode | null {
  const candidates = typeLookup.get(name);
  if (!candidates?.length) {
    return null;
  }
  return (
    candidates.find((candidate) => candidate.filePath === source.filePath) ??
    candidates.find((candidate) => candidate.exported) ??
    candidates[0] ??
    null
  );
}

interface DataFlowArgument {
  text: string;
  index: number;
}

function dataFlowCandidateAllowed(source: SymbolNode, target: SymbolNode, byName: Map<string, SymbolNode[]>, callCandidates: Set<string>): boolean {
  const sameFileTargets = (byName.get(target.name) ?? []).filter((candidate) => candidate.filePath === source.filePath);
  if (source.filePath === target.filePath) {
    return sameFileTargets.length === 1;
  }
  return (byName.get(target.name) ?? []).length === 1 && callCandidates.has(`${source.qualifiedName}\0${target.qualifiedName}`);
}

function parameterNames(signature: string, language: Language): string[] {
  const open = signature.indexOf("(");
  const close = open >= 0 ? findMatchingParen(signature, open) : null;
  if (open < 0 || close === null || close <= open) {
    return [];
  }
  return splitArguments(signature.slice(open + 1, close))
    .map((part) => parameterNameFromPart(part, language))
    .filter((name): name is string => Boolean(name));
}

function parameterNameFromPart(part: string, language: Language): string | undefined {
  const cleaned = part
    .trim()
    .replace(/=.*$/, "")
    .replace(/^\.\.\./, "")
    .replace(/^@[A-Za-z_$][\w$]*(?:\([^)]*\))?\s*/, "");
  if (!cleaned || /^[{[]/.test(cleaned)) {
    return undefined;
  }
  const beforeColon = cleaned.includes(":") ? cleaned.slice(0, cleaned.indexOf(":")) : cleaned;
  const tokens = [...beforeColon.matchAll(/[A-Za-z_$][\w$]*\??/g)]
    .map((match) => match[0].replace(/\?$/, ""))
    .filter((token) => !ignoredParameterTokens.has(token) && token !== "_");
  if (tokens.length === 0) {
    return undefined;
  }
  if (language === "java" || language === "go") {
    return tokens.at(-1);
  }
  return tokens.at(-1);
}

const ignoredParameterTokens = new Set(["public", "private", "protected", "readonly", "final", "static", "const", "let", "var", "inout", "mutating"]);

function functionCallArguments(content: string, name: string): Array<{ args: DataFlowArgument[] }> {
  const escaped = escapeRegExp(name);
  const regex = new RegExp(`(?:^|[^A-Za-z0-9_$])${escaped}\\s*\\(`, "g");
  const calls: Array<{ args: DataFlowArgument[] }> = [];
  for (const match of content.matchAll(regex)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("(");
    const close = findMatchingParen(content, open);
    if (close === null || close - open > 1000) {
      continue;
    }
    const rawArgs = content.slice(open + 1, close);
    const args = splitArguments(rawArgs).map((text, index) => ({ text, index }));
    if (args.length > 0) {
      calls.push({ args });
    }
  }
  return calls;
}

function splitArguments(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of value) {
    if (char === "(" || char === "[" || char === "{") depth += 1;
    if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

function meaningfulDataArgument(arg: string): boolean {
  const trimmed = arg.trim();
  return Boolean(trimmed && !/^(["'`\d.{}\[])/.test(trimmed) && !/^(true|false|null|undefined)$/i.test(trimmed));
}

function mapArgumentsToParameters(args: DataFlowArgument[], params: string[]): Array<{ argument: string; parameter?: string }> {
  return args
    .filter((argument) => meaningfulDataArgument(argument.text))
    .slice(0, 12)
    .map((argument) => ({
      argument: argument.text.slice(0, 120),
      ...(params[argument.index] ? { parameter: params[argument.index] } : {})
    }));
}

function findMatchingParen(content: string, open: number): number | null {
  if (content[open] !== "(") {
    return null;
  }
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return null;
}

function callsName(content: string, name: string, options: { allowMember?: boolean } = {}): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (options.allowMember === false) {
    return new RegExp(`(?:^|[^A-Za-z0-9_$.])${escaped}\\s*\\(`).test(content);
  }
  return new RegExp(`(?:^|[^A-Za-z0-9_$])(?:\\.|)${escaped}\\s*\\(`).test(content);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
