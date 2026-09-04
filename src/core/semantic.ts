import type { Edge, SymbolNode } from "./types.js";

const SEMANTIC_KINDS = new Set(["function", "method", "class", "interface", "type", "struct", "enum", "protocol", "actor", "route"]);
const DEFAULT_VECTOR_DIMENSIONS = 384;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "return",
  "const",
  "let",
  "var",
  "function",
  "class",
  "interface",
  "type",
  "export",
  "import",
  "private",
  "public",
  "static",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "string",
  "number",
  "boolean",
  "void"
]);

interface SymbolFeature {
  symbol: SymbolNode;
  tokens: Set<string>;
  bodyTokens: Set<string>;
}

interface CandidateScore {
  source: SymbolFeature;
  target: SymbolFeature;
  score: number;
  matchedTokens: string[];
}

export interface LocalVector {
  dimensions: number;
  weights: Array<[number, number]>;
  magnitude: number;
  tokens: string[];
}

export function buildSemanticEdges(symbols: SymbolNode[], fileContents: Map<string, string>, maxEdges = 6000): Edge[] {
  const linesByFile = new Map<string, string[]>();
  const features = symbols
    .filter((symbol) => SEMANTIC_KINDS.has(symbol.kind) && symbol.language !== "unknown")
    .map((symbol) => {
      let lines = linesByFile.get(symbol.filePath);
      if (!lines) {
        lines = (fileContents.get(symbol.filePath) ?? "").split(/\r?\n/);
        linesByFile.set(symbol.filePath, lines);
      }
      return featureForSymbol(symbol, lines);
    })
    .filter((feature) => feature.tokens.size >= 2);

  const candidates = candidateScores(features);
  const similarEdges = candidates
    .filter((candidate) => candidate.source.symbol.kind === candidate.target.symbol.kind && bodySimilarity(candidate.source, candidate.target) >= 0.78)
    .slice(0, Math.floor(maxEdges / 3))
    .map((candidate) => edgeFromCandidate(candidate, "SIMILAR_TO", "near-duplicate token profile"));

  const perSource = new Map<string, number>();
  const semanticEdges: Edge[] = [];
  for (const candidate of candidates) {
    if (semanticEdges.length + similarEdges.length >= maxEdges) break;
    if (candidate.score < 0.22 || candidate.matchedTokens.length < 2) continue;
    if (candidate.source.symbol.filePath === candidate.target.symbol.filePath && candidate.score < 0.5) continue;
    const used = perSource.get(candidate.source.symbol.qualifiedName) ?? 0;
    if (used >= 5) continue;
    perSource.set(candidate.source.symbol.qualifiedName, used + 1);
    semanticEdges.push(edgeFromCandidate(candidate, "SEMANTICALLY_RELATED", "shared semantic tokens"));
  }

  return dedupeEdges([...similarEdges, ...semanticEdges]);
}

export function semanticTokens(value: string): Set<string> {
  return new Set(semanticTokenList(value));
}

export function semanticTokenList(value: string): string[] {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./:-]+/g, " ")
    .toLowerCase();
  const tokens: string[] = [];
  for (const token of normalized.match(/[a-z][a-z0-9]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(token)) {
      tokens.push(stemToken(token));
    }
  }
  return tokens;
}

export function semanticScore(queryTokens: Set<string>, targetTokens: Set<string>): { score: number; matchedTokens: string[] } {
  const matchedTokens = [...queryTokens].filter((token) => targetTokens.has(token)).sort();
  if (matchedTokens.length === 0) {
    return { score: 0, matchedTokens };
  }
  const precision = matchedTokens.length / Math.max(1, queryTokens.size);
  const coverage = matchedTokens.length / Math.sqrt(Math.max(1, targetTokens.size));
  return { score: Number((precision * 0.7 + coverage * 0.3).toFixed(4)), matchedTokens };
}

export function semanticVector(value: string, dimensions = DEFAULT_VECTOR_DIMENSIONS): LocalVector {
  const safeDimensions = Math.max(32, Math.min(2048, Math.floor(dimensions)));
  const counts = new Map<string, number>();
  for (const token of semanticTokenList(value)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  const buckets = new Map<number, number>();
  for (const [token, count] of counts) {
    const hash = hashToken(token);
    const bucket = Math.abs(hash) % safeDimensions;
    const sign = hash & 1 ? -1 : 1;
    const lengthBoost = token.length >= 8 ? 1.15 : 1;
    const weight = sign * (1 + Math.log(count)) * lengthBoost;
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + weight);
  }

  const weights = [...buckets.entries()]
    .filter(([, weight]) => Math.abs(weight) > 0.000001)
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, weight]) => [bucket, Number(weight.toFixed(6))] as [number, number]);
  const magnitude = Math.sqrt(weights.reduce((sum, [, weight]) => sum + weight * weight, 0));

  return {
    dimensions: safeDimensions,
    weights,
    magnitude: Number(magnitude.toFixed(6)),
    tokens: [...counts.keys()].sort()
  };
}

export function cosineSimilarity(query: LocalVector, target: LocalVector): number {
  if (query.magnitude === 0 || target.magnitude === 0 || query.dimensions !== target.dimensions) {
    return 0;
  }
  const targetWeights = new Map(target.weights);
  let dot = 0;
  for (const [bucket, weight] of query.weights) {
    dot += weight * (targetWeights.get(bucket) ?? 0);
  }
  return dot / Math.max(0.000001, query.magnitude * target.magnitude);
}

function featureForSymbol(symbol: SymbolNode, lines: string[]): SymbolFeature {
  const body = lines.slice(Math.max(0, symbol.startLine - 1), Math.max(symbol.startLine, symbol.endLine)).join("\n");
  const tokens = semanticTokens([symbol.name, symbol.signature ?? "", symbol.filePath, body].join("\n"));
  const bodyTokens = semanticTokens(body);
  return { symbol, tokens, bodyTokens };
}

function candidateScores(features: SymbolFeature[]): CandidateScore[] {
  const byToken = new Map<string, number[]>();
  for (let index = 0; index < features.length; index += 1) {
    for (const token of features[index].tokens) {
      const list = byToken.get(token) ?? [];
      list.push(index);
      byToken.set(token, list);
    }
  }

  const pairHits = new Map<string, number>();
  for (const postings of byToken.values()) {
    if (postings.length < 2 || postings.length > 80) continue;
    for (let i = 0; i < postings.length; i += 1) {
      for (let j = i + 1; j < postings.length; j += 1) {
        const a = postings[i];
        const b = postings[j];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        pairHits.set(key, (pairHits.get(key) ?? 0) + 1);
      }
    }
  }

  return [...pairHits.entries()]
    .map(([key, hits]) => {
      const [left, right] = key.split(":").map(Number);
      const source = features[left];
      const target = features[right];
      const union = new Set([...source.tokens, ...target.tokens]);
      const matchedTokens = [...source.tokens].filter((token) => target.tokens.has(token)).sort();
      const score = hits / Math.max(1, union.size);
      return { source, target, score, matchedTokens };
    })
    .filter((candidate) => candidate.source.symbol.qualifiedName !== candidate.target.symbol.qualifiedName)
    .sort((a, b) => b.score - a.score || a.source.symbol.qualifiedName.localeCompare(b.source.symbol.qualifiedName));
}

function bodySimilarity(source: SymbolFeature, target: SymbolFeature): number {
  if (source.bodyTokens.size < 6 || target.bodyTokens.size < 6) {
    return 0;
  }
  const intersection = [...source.bodyTokens].filter((token) => target.bodyTokens.has(token)).length;
  const union = new Set([...source.bodyTokens, ...target.bodyTokens]).size;
  return intersection / Math.max(1, union);
}

function edgeFromCandidate(candidate: CandidateScore, type: "SIMILAR_TO" | "SEMANTICALLY_RELATED", reason: string): Edge {
  return {
    source: candidate.source.symbol.qualifiedName,
    target: candidate.target.symbol.qualifiedName,
    type,
    weight: Number(candidate.score.toFixed(4)),
    metadata: {
      score: Number(candidate.score.toFixed(4)),
      reason,
      matchedTokens: candidate.matchedTokens.slice(0, 12)
    }
  };
}

function dedupeEdges(edges: Edge[]): Edge[] {
  const seen = new Set<string>();
  const output: Edge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}:${edge.type}:${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(edge);
  }
  return output;
}

function stemToken(token: string): string {
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 5) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
}

function hashToken(token: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}
