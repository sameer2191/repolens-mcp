export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "rust"
  | "swift"
  | "sql"
  | "yaml"
  | "markdown"
  | "json"
  | "shell"
  | "unknown";

export interface IndexOptions {
  root: string;
  dbPath?: string;
  includeHidden?: boolean;
  incremental?: boolean;
  maxFileBytes?: number;
  runLabel?: string;
}

export interface IndexedFile {
  id?: number;
  path: string;
  language: Language;
  bytes: number;
  lines: number;
  sha256: string;
  indexedAt?: string;
  skipped?: boolean;
  skipReason?: string;
}

export interface SymbolNode {
  id?: number;
  filePath: string;
  language: Language;
  kind: string;
  name: string;
  qualifiedName: string;
  startLine: number;
  endLine: number;
  signature?: string;
  doc?: string;
  exported?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Edge {
  id?: number;
  source: string;
  target: string;
  type: string;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface CodeMatch {
  filePath: string;
  language: Language;
  line: number;
  text: string;
  score: number;
}

export interface ArchitectureSummary {
  root: string;
  indexedAt: string;
  totals: {
    files: number;
    indexedFiles: number;
    skippedFiles: number;
    symbols: number;
    edges: number;
    lines: number;
    bytes: number;
  };
  languages: Array<{ language: Language; files: number; lines: number; symbols: number }>;
  nodeLabels: Array<{ kind: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
  topFiles: Array<{ path: string; language: Language; lines: number; symbols: number }>;
  topSymbols: Array<{
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    degree: number;
    inbound: number;
    outbound: number;
  }>;
  hotspots: Array<{ path: string; score: number; reasons: string[] }>;
  boundaries: Array<{ source: string; target: string; edges: number; sampleTypes: string[] }>;
  clusters: Array<{ name: string; files: number; symbols: number; edges: number }>;
  entrypoints: Array<{ path: string; reason: string }>;
  packages: string[];
  deadCode: { candidates: number; samples: DeadCodeCandidate[] };
  risks: string[];
}

export interface GraphSchema {
  totals: { files: number; symbols: number; edges: number };
  languages: Array<{ language: Language; files: number; symbols: number }>;
  nodeLabels: Array<{ kind: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
}

export interface GraphSearchOptions {
  query?: string;
  kind?: string;
  namePattern?: string;
  filePattern?: string;
  relationship?: string;
  minDegree?: number;
  limit?: number;
  offset?: number;
}

export interface GraphSearchMatch {
  symbol: SymbolNode;
  degree: number;
  inbound: number;
  outbound: number;
}

export interface DeadCodeCandidate {
  symbol: SymbolNode;
  inbound: number;
  outbound: number;
  reason: string;
}

export interface ChangeImpactResult {
  root: string;
  changedFiles: string[];
  impacted: Array<{ item: string; reason: string; score: number }>;
  risk: "none" | "low" | "medium" | "high";
  signals: string[];
}

export interface DecisionRecord {
  id?: number;
  title: string;
  status: "proposed" | "accepted" | "superseded";
  body: string;
  tags: string[];
  createdAt?: string;
}

export interface IndexResult {
  root: string;
  dbPath: string;
  indexedAt: string;
  mode: "full" | "incremental";
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  filesUnchanged: number;
  filesRemoved: number;
  symbols: number;
  edges: number;
  elapsedMs: number;
}
