export type Language =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "rust"
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
  topFiles: Array<{ path: string; language: Language; lines: number; symbols: number }>;
  hotspots: Array<{ path: string; score: number; reasons: string[] }>;
  entrypoints: Array<{ path: string; reason: string }>;
  packages: string[];
  risks: string[];
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
  filesDiscovered: number;
  filesIndexed: number;
  filesSkipped: number;
  symbols: number;
  edges: number;
  elapsedMs: number;
}
