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
  | "toml"
  | "xml"
  | "ruby"
  | "elixir"
  | "gradle"
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

export interface RuntimeTrace {
  source?: string;
  sourceFile?: string;
  target?: string;
  targetFile?: string;
  type?: "http" | "event" | "edge";
  method?: string;
  path?: string;
  channel?: string;
  direction?: "emit" | "listen";
  edgeType?: string;
  count?: number;
  observedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TraceIngestResult {
  tracesReceived: number;
  edgesInserted: number;
  edges: Edge[];
  unresolved: Array<{ trace: RuntimeTrace; reason: string }>;
}

export interface CodeMatch {
  filePath: string;
  language: Language;
  line: number;
  text: string;
  score: number;
}

export interface CodeSnippet {
  filePath: string;
  language: Language;
  startLine: number;
  endLine: number;
  symbol?: SymbolNode;
  lines: Array<{ line: number; text: string; highlight: boolean }>;
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
  dependencyCycles: DependencyCycle[];
  recommendations: ArchitectureRecommendation[];
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

export interface GraphQueryResult {
  query: string;
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
  limit: number;
}

export interface GraphCommunity {
  id: string;
  label: string;
  members: number;
  files: string[];
  languages: Array<{ language: Language; symbols: number }>;
  representativeSymbols: Array<{
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    degree: number;
  }>;
  internalEdges: number;
  externalEdges: number;
  cohesion: number;
  reasons: string[];
}

export interface SemanticSearchMatch {
  symbol: SymbolNode;
  score: number;
  matchedTokens: string[];
  reasons: string[];
}

export interface GraphPackageExportResult {
  outPath: string;
  sourceDbPath: string;
  label?: string;
  createdAt: string;
  sqliteBytes: number;
  compressedBytes: number;
  packageBytes: number;
  sha256: string;
}

export interface GraphPackageImportResult {
  packagePath: string;
  dbPath: string;
  label?: string;
  createdAt: string;
  sqliteBytes: number;
  sha256: string;
  totals: { files: number; symbols: number; edges: number };
}

export interface DeadCodeCandidate {
  symbol: SymbolNode;
  inbound: number;
  outbound: number;
  reason: string;
}

export interface DependencyCycle {
  clusters: string[];
  edges: number;
  sampleEdges: Array<{ source: string; target: string; type: string }>;
  recommendation: string;
}

export interface ArchitectureRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  evidence: string[];
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

export interface ProjectRecord {
  root: string;
  dbPath: string;
  label?: string;
  indexedAt: string;
  mode: "full" | "incremental";
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  symbols: number;
  edges: number;
  elapsedMs: number;
}

export interface ProjectStatus extends ProjectRecord {
  dbExists: boolean;
  liveTotals?: { files: number; symbols: number; edges: number };
  staleReason?: string;
}

export interface DeleteProjectResult {
  identifier: string;
  removed: number;
  remaining: number;
  deletedDbFiles: string[];
  skippedDbFiles: string[];
}

export interface WatchIndexOptions extends IndexOptions {
  intervalMs?: number;
  maxRuns?: number;
  signal?: AbortSignal;
  onResult?: (result: IndexResult) => void;
}

export interface WatchIndexSummary {
  root: string;
  dbPath: string;
  runs: IndexResult[];
  stoppedAt: string;
}
