export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "rust"
  | "swift"
  | "c"
  | "cpp"
  | "csharp"
  | "kotlin"
  | "php"
  | "dart"
  | "terraform"
  | "qml"
  | "apex"
  | "sql"
  | "yaml"
  | "markdown"
  | "json"
  | "toml"
  | "xml"
  | "graphql"
  | "proto"
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
  maxFiles?: number;
  runLabel?: string;
  bootstrapPackage?: string | false;
  writePackage?: string | false;
  diagnosticsPath?: string | false;
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

export type TraceDirection = "inbound" | "outbound" | "both";

export type TraceMode = "all" | "calls" | "data_flow" | "cross_service";

export interface TraceOptions {
  mode?: TraceMode;
  edgeTypes?: string[];
  includeTests?: boolean;
  parameterName?: string;
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

export interface ContextPack {
  query: string;
  semantic: SemanticSearchMatch[];
  vector: VectorSearchMatch[];
  graph: GraphSearchMatch[];
  code: CodeMatch[];
  snippets: CodeSnippet[];
  edges: Edge[];
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

export interface SymbolReference {
  filePath: string;
  language: Language;
  line: number;
  text: string;
  kind: "definition" | "reference";
  score: number;
  symbol?: SymbolNode;
  reason: string;
}

export type SecretConfidence = "low" | "medium" | "high";

export interface SecretScanOptions {
  limit?: number;
  includeTests?: boolean;
  minConfidence?: SecretConfidence;
}

export interface SecretFinding {
  filePath: string;
  language: Language;
  line: number;
  kind: string;
  label: string;
  severity: "low" | "medium" | "high";
  confidence: SecretConfidence;
  evidence: string;
  redacted: string;
  reason: string;
}

export interface SecretScanResult {
  scannedLines: number;
  findings: SecretFinding[];
  totals: {
    findings: number;
    high: number;
    medium: number;
    low: number;
    files: number;
  };
  risks: string[];
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
  gitHistory: GitHistoryFile[];
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

export interface GitHistoryFile {
  path: string;
  commits: number;
  churn: number;
  additions: number;
  deletions: number;
  authors: number;
  lastCommit?: string;
  lastDate?: string;
  lastAuthor?: string;
  lastSubject?: string;
}

export interface GraphSchema {
  totals: { files: number; symbols: number; edges: number };
  languages: Array<{ language: Language; files: number; symbols: number }>;
  nodeLabels: Array<{ kind: string; count: number }>;
  edgeTypes: Array<{ type: string; count: number }>;
  relationshipPatterns: Array<{ sourceKind: string; type: string; targetKind: string; count: number }>;
  labelProperties: Array<{
    kind: string;
    properties: Array<{ name: string; type: string; source: "column" | "metadata"; count: number }>;
  }>;
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

export interface VectorSearchMatch {
  symbol: SymbolNode;
  score: number;
  matchedTokens: string[];
  vector: {
    dimensions: number;
    magnitude: number;
    nonZero: number;
  };
  reasons: string[];
}

export interface VectorIndexStats {
  dimensions: number;
  symbols: number;
  vectors: number;
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
  changedFileDetails: Array<{
    path: string;
    status: string;
    previousPath?: string;
    indexed: boolean;
    symbols: number;
    symbolKinds: Array<{ kind: string; count: number }>;
    inboundEdges: number;
    outboundEdges: number;
    directEdges: number;
    edgeTypes: Array<{ type: string; count: number }>;
    risk: "none" | "low" | "medium" | "high";
    reasons: string[];
  }>;
  summary: {
    changedFileCount: number;
    indexedChangedFileCount: number;
    impactedItemCount: number;
    directEdgeCount: number;
    topEdgeTypes: Array<{ type: string; count: number }>;
    topSymbolKinds: Array<{ kind: string; count: number }>;
  };
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
  bootstrapPackage?: GraphPackageImportResult;
  graphPackage?: GraphPackageExportResult;
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  filesUnchanged: number;
  filesRemoved: number;
  symbols: number;
  edges: number;
  elapsedMs: number;
}

export interface BenchmarkOptions extends IndexOptions {
  secretScan?: boolean;
  secretScanLimit?: number;
}

export interface BenchmarkResult {
  root: string;
  dbPath: string;
  generatedAt: string;
  fullIndex: IndexResult;
  incrementalIndex: IndexResult;
  throughput: {
    fullFilesPerSecond: number;
    fullSymbolsPerSecond: number;
    incrementalFilesPerSecond: number;
  };
  architecture: {
    totals: ArchitectureSummary["totals"];
    languages: ArchitectureSummary["languages"];
    nodeLabels: ArchitectureSummary["nodeLabels"];
    edgeTypes: ArchitectureSummary["edgeTypes"];
    entrypoints: ArchitectureSummary["entrypoints"];
    risks: string[];
  };
  secretScan?: {
    scannedLines: number;
    findings: number;
    high: number;
    medium: number;
    low: number;
    risks: string[];
  };
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

export interface FleetProjectSummary {
  root: string;
  dbPath: string;
  label?: string;
  indexedAt: string;
  dbExists: boolean;
  totals?: { files: number; symbols: number; edges: number };
  languages: Array<{ language: Language; files: number; symbols: number }>;
  routes: Array<{ name: string; method?: string; path?: string; filePath: string }>;
  httpCalls: Array<{
    name: string;
    method?: string;
    path?: string;
    host?: string;
    scheme?: string;
    url?: string;
    urlKind?: "absolute" | "relative";
    filePath: string;
    line?: number;
  }>;
  packages: string[];
  dependencies: string[];
  risks: string[];
}

export interface FleetSummary {
  generatedAt: string;
  catalogPath: string;
  totals: {
    projects: number;
    availableProjects: number;
    files: number;
    symbols: number;
    edges: number;
    routes: number;
    httpCalls: number;
    serviceLinks: number;
    packages: number;
    dependencies: number;
  };
  projects: FleetProjectSummary[];
  languages: Array<{ language: Language; files: number; symbols: number; projects: number }>;
  sharedDependencies: Array<{ name: string; projects: string[]; count: number }>;
  routeOverlaps: Array<{ route: string; projects: string[]; count: number }>;
  serviceLinks: Array<{
    consumer: string;
    provider: string;
    route: string;
    host?: string;
    confidence: number;
    matchReason: string;
    calls: number;
    callFiles: string[];
    providerFiles: string[];
  }>;
  risks: string[];
}

export type { FleetGraph, FleetGraphEdge, FleetGraphNode, FleetGraphOptions } from "./fleet-graph.js";

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
  maxPolls?: number;
  gitAware?: boolean;
  skipInitialRun?: boolean;
  signal?: AbortSignal;
  onResult?: (result: IndexResult) => void;
  onSkip?: (event: WatchSkipEvent) => void;
}

export interface GitWatchFingerprint {
  gitRoot: string;
  head: string;
  statusHash: string;
  trackedFiles: number;
  key: string;
}

export interface WatchSkipEvent {
  root: string;
  checkedAt: string;
  reason: "git-unchanged";
  fingerprint: GitWatchFingerprint;
}

export interface WatchIndexSummary {
  root: string;
  dbPath: string;
  runs: IndexResult[];
  polls: number;
  skippedPolls: WatchSkipEvent[];
  stoppedAt: string;
}
