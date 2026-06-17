import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArchitectureSummary,
  CodeMatch,
  DecisionRecord,
  Edge,
  IndexedFile,
  Language,
  SymbolNode
} from "./types.js";

interface CountRow {
  count: number;
}

interface SymbolRow {
  id: number;
  file_path: string;
  language: Language;
  kind: string;
  name: string;
  qualified_name: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  doc: string | null;
  exported: number;
  metadata: string;
}

interface FileRow {
  path: string;
  language: Language;
  bytes: number;
  lines: number;
  sha256: string;
  indexed_at: string;
  skipped: number;
  skip_reason: string | null;
}

export class MemoryStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  resetRepository(root: string): void {
    this.db.prepare("DELETE FROM runs WHERE root = ?").run(root);
    this.db.prepare("DELETE FROM files").run();
    this.db.prepare("DELETE FROM symbols").run();
    this.db.prepare("DELETE FROM edges").run();
    this.db.prepare("DELETE FROM code_lines").run();
  }

  recordRun(root: string, label: string | null, indexedAt: string): number {
    const result = this.db
      .prepare("INSERT INTO runs(root, label, indexed_at) VALUES (?, ?, ?)")
      .run(root, label, indexedAt);
    return Number(result.lastInsertRowid);
  }

  insertFile(file: IndexedFile): void {
    this.db
      .prepare(
        `INSERT INTO files(path, language, bytes, lines, sha256, indexed_at, skipped, skip_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           language=excluded.language,
           bytes=excluded.bytes,
           lines=excluded.lines,
           sha256=excluded.sha256,
           indexed_at=excluded.indexed_at,
           skipped=excluded.skipped,
           skip_reason=excluded.skip_reason`
      )
      .run(
        file.path,
        file.language,
        file.bytes,
        file.lines,
        file.sha256,
        file.indexedAt ?? new Date().toISOString(),
        file.skipped ? 1 : 0,
        file.skipReason ?? null
      );
  }

  insertSymbol(symbol: SymbolNode): void {
    this.db
      .prepare(
        `INSERT INTO symbols(
          file_path, language, kind, name, qualified_name, start_line, end_line,
          signature, doc, exported, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(qualified_name) DO UPDATE SET
          file_path=excluded.file_path,
          language=excluded.language,
          kind=excluded.kind,
          name=excluded.name,
          start_line=excluded.start_line,
          end_line=excluded.end_line,
          signature=excluded.signature,
          doc=excluded.doc,
          exported=excluded.exported,
          metadata=excluded.metadata`
      )
      .run(
        symbol.filePath,
        symbol.language,
        symbol.kind,
        symbol.name,
        symbol.qualifiedName,
        symbol.startLine,
        symbol.endLine,
        symbol.signature ?? null,
        symbol.doc ?? null,
        symbol.exported ? 1 : 0,
        JSON.stringify(symbol.metadata ?? {})
      );
  }

  insertEdge(edge: Edge): void {
    this.db
      .prepare(
        `INSERT INTO edges(source, target, type, weight, metadata)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source, target, type) DO UPDATE SET
           weight=max(edges.weight, excluded.weight),
           metadata=excluded.metadata`
      )
      .run(edge.source, edge.target, edge.type, edge.weight ?? 1, JSON.stringify(edge.metadata ?? {}));
  }

  insertCodeLines(filePath: string, lines: string[]): void {
    const stmt = this.db.prepare("INSERT INTO code_lines(file_path, line, text) VALUES (?, ?, ?)");
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index];
      if (text.trim()) {
        stmt.run(filePath, index + 1, text.slice(0, 2000));
      }
    }
  }

  searchCode(query: string, limit = 20): CodeMatch[] {
    const normalized = `%${query.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT code_lines.file_path, files.language, code_lines.line, code_lines.text
         FROM code_lines
         JOIN files ON files.path = code_lines.file_path
         WHERE lower(code_lines.text) LIKE ?
         ORDER BY files.path ASC, code_lines.line ASC
         LIMIT ?`
      )
      .all(normalized, limit) as Array<{
      file_path: string;
      language: Language;
      line: number;
      text: string;
    }>;

    const lowered = query.toLowerCase();
    return rows.map((row) => ({
      filePath: row.file_path,
      language: row.language,
      line: row.line,
      text: row.text,
      score: row.text.toLowerCase().includes(lowered) ? 1 : 0.5
    }));
  }

  searchSymbols(query: string, kind?: string, limit = 20): SymbolNode[] {
    const sql = kind
      ? `SELECT * FROM symbols
         WHERE lower(name) LIKE ? AND lower(kind) = lower(?)
         ORDER BY exported DESC, name ASC
         LIMIT ?`
      : `SELECT * FROM symbols
         WHERE lower(name) LIKE ? OR lower(qualified_name) LIKE ?
         ORDER BY exported DESC, name ASC
         LIMIT ?`;
    const like = `%${query.toLowerCase()}%`;
    const rows = kind
      ? (this.db.prepare(sql).all(like, kind, limit) as unknown as SymbolRow[])
      : (this.db.prepare(sql).all(like, like, limit) as unknown as SymbolRow[]);
    return rows.map(rowToSymbol);
  }

  getSymbol(qualifiedNameOrName: string): SymbolNode | null {
    const row = this.db
      .prepare(
        `SELECT * FROM symbols
         WHERE qualified_name = ? OR name = ?
         ORDER BY qualified_name = ? DESC
         LIMIT 1`
      )
      .get(qualifiedNameOrName, qualifiedNameOrName, qualifiedNameOrName) as SymbolRow | undefined;
    return row ? rowToSymbol(row) : null;
  }

  traceSymbol(name: string, direction: "inbound" | "outbound", depth = 2): Edge[] {
    const start = this.getSymbol(name);
    if (!start) {
      return [];
    }
    const seen = new Set<string>();
    const frontier = [start.qualifiedName];
    const result: Edge[] = [];
    for (let level = 0; level < depth && frontier.length > 0; level += 1) {
      const next: string[] = [];
      while (frontier.length > 0) {
        const current = frontier.shift() as string;
        const rows = this.db
          .prepare(
            direction === "outbound"
              ? "SELECT * FROM edges WHERE source = ? ORDER BY weight DESC LIMIT 100"
              : "SELECT * FROM edges WHERE target = ? ORDER BY weight DESC LIMIT 100"
          )
          .all(current) as Array<{ source: string; target: string; type: string; weight: number; metadata: string }>;
        for (const row of rows) {
          const key = `${row.source}:${row.type}:${row.target}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          result.push({
            source: row.source,
            target: row.target,
            type: row.type,
            weight: row.weight,
            metadata: parseMetadata(row.metadata)
          });
          next.push(direction === "outbound" ? row.target : row.source);
        }
      }
      frontier.push(...next);
    }
    return result;
  }

  impactedBy(pathsOrSymbols: string[], limit = 50): Array<{ item: string; reason: string; score: number }> {
    const output = new Map<string, { item: string; reason: string; score: number }>();
    for (const item of pathsOrSymbols) {
      const fileRows = this.db
        .prepare("SELECT qualified_name FROM symbols WHERE file_path = ? LIMIT 200")
        .all(item) as Array<{ qualified_name: string }>;
      const symbols = fileRows.length > 0 ? fileRows.map((row) => row.qualified_name) : [item];
      for (const symbol of symbols) {
        const rows = this.db
          .prepare("SELECT source, target, type, weight FROM edges WHERE source = ? OR target = ? LIMIT 200")
          .all(symbol, symbol) as Array<{ source: string; target: string; type: string; weight: number }>;
        for (const row of rows) {
          const neighbor = row.source === symbol ? row.target : row.source;
          const current = output.get(neighbor);
          const score = (current?.score ?? 0) + row.weight;
          output.set(neighbor, {
            item: neighbor,
            reason: `${row.type} ${row.source === symbol ? "from" : "to"} ${symbol}`,
            score
          });
        }
      }
    }
    return [...output.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  latestRoot(): string {
    return (
      (
        this.db
          .prepare("SELECT root FROM runs ORDER BY id DESC LIMIT 1")
          .get() as unknown as { root: string } | undefined
      )?.root ?? process.cwd()
    );
  }

  architecture(root = this.latestRoot()): ArchitectureSummary {
    const indexedAt =
      (
        this.db
          .prepare("SELECT indexed_at FROM runs WHERE root = ? ORDER BY id DESC LIMIT 1")
          .get(root) as { indexed_at: string } | undefined
      )?.indexed_at ?? new Date().toISOString();

    const fileCount = getCount(this.db, "SELECT count(*) AS count FROM files");
    const indexedFiles = getCount(this.db, "SELECT count(*) AS count FROM files WHERE skipped = 0");
    const skippedFiles = getCount(this.db, "SELECT count(*) AS count FROM files WHERE skipped = 1");
    const symbolCount = getCount(this.db, "SELECT count(*) AS count FROM symbols");
    const edgeCount = getCount(this.db, "SELECT count(*) AS count FROM edges");
    const totals = this.db.prepare("SELECT coalesce(sum(lines), 0) AS lines, coalesce(sum(bytes), 0) AS bytes FROM files").get() as {
      lines: number;
      bytes: number;
    };

    const languages = this.db
      .prepare(
        `SELECT files.language AS language, count(*) AS files, sum(files.lines) AS lines,
          (SELECT count(*) FROM symbols WHERE symbols.language = files.language) AS symbols
         FROM files
         WHERE skipped = 0
         GROUP BY files.language
         ORDER BY lines DESC`
      )
      .all() as Array<{ language: Language; files: number; lines: number; symbols: number }>;

    const topFiles = this.db
      .prepare(
        `SELECT files.path, files.language, files.lines, count(symbols.qualified_name) AS symbols
         FROM files
         LEFT JOIN symbols ON symbols.file_path = files.path
         WHERE files.skipped = 0
         GROUP BY files.path
         ORDER BY symbols DESC, files.lines DESC
         LIMIT 15`
      )
      .all() as Array<{ path: string; language: Language; lines: number; symbols: number }>;

    const hotspots = topFiles.slice(0, 8).map((file) => {
      const reasons: string[] = [];
      if (file.symbols > 20) reasons.push("high symbol density");
      if (file.lines > 400) reasons.push("large file");
      if (/controller|route|server|api|handler/i.test(file.path)) reasons.push("request entrypoint");
      return { path: file.path, score: file.symbols * 2 + file.lines / 50, reasons };
    });

    const entrypoints = (this.db
      .prepare(
        `SELECT path, language FROM files
         WHERE path GLOB '*src/index.*'
            OR path GLOB '*src/main.*'
            OR path GLOB '*server.*'
            OR path GLOB '*app.*'
            OR path GLOB '*cli.*'
            OR path IN ('package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml')
         ORDER BY path ASC
         LIMIT 25`
      )
      .all() as Array<{ path: string; language: Language }>).map((row) => ({
      path: row.path,
      reason: row.language === "json" ? "package manifest" : "conventional entrypoint"
    }));

    const packages = (this.db
      .prepare("SELECT DISTINCT name FROM symbols WHERE kind IN ('package','dependency','module') ORDER BY name ASC LIMIT 80")
      .all() as Array<{ name: string }>).map((row) => row.name);

    const risks: string[] = [];
    const taskNeedle = "TO" + "DO";
    const fixNeedle = "FIX" + "ME";
    const keyNeedle = "api" + "_key";
    const sensitiveNeedle = "sec" + "ret";
    const passwordNeedle = "pass" + "word";
    const taskCount = Number(
      (
        this.db
          .prepare("SELECT count(*) AS count FROM code_lines WHERE text LIKE ? OR text LIKE ?")
          .get(`%${taskNeedle}%`, `%${fixNeedle}%`) as unknown as CountRow
      ).count
    );
    const secretHints = Number(
      (
        this.db
          .prepare("SELECT count(*) AS count FROM code_lines WHERE lower(text) LIKE ? OR lower(text) LIKE ? OR lower(text) LIKE ?")
          .get(`%${keyNeedle}%`, `%${sensitiveNeedle}%`, `%${passwordNeedle}%`) as unknown as CountRow
      ).count
    );
    if (taskCount > 0) risks.push(`${taskCount} task markers`);
    if (secretHints > 0) risks.push(`${secretHints} sensitive-key-like text matches to review`);
    if (skippedFiles > 0) risks.push(`${skippedFiles} files skipped by size, binary, or ignore policy`);

    return {
      root,
      indexedAt,
      totals: {
        files: fileCount,
        indexedFiles,
        skippedFiles,
        symbols: symbolCount,
        edges: edgeCount,
        lines: totals.lines,
        bytes: totals.bytes
      },
      languages,
      topFiles,
      hotspots,
      entrypoints,
      packages,
      risks
    };
  }

  addDecision(decision: DecisionRecord): DecisionRecord {
    const createdAt = new Date().toISOString();
    const result = this.db
      .prepare("INSERT INTO decisions(title, status, body, tags, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(decision.title, decision.status, decision.body, JSON.stringify(decision.tags), createdAt);
    return { ...decision, id: Number(result.lastInsertRowid), createdAt };
  }

  listDecisions(limit = 20): DecisionRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<{ id: number; title: string; status: DecisionRecord["status"]; body: string; tags: string; created_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      body: row.body,
      tags: parseStringArray(row.tags),
      createdAt: row.created_at
    }));
  }

  graph(limit = 500): { nodes: Array<{ id: string; label: string; group: string }>; edges: Edge[] } {
    const symbolRows = this.db
      .prepare("SELECT qualified_name, name, kind FROM symbols ORDER BY file_path ASC, start_line ASC LIMIT ?")
      .all(limit) as Array<{ qualified_name: string; name: string; kind: string }>;
    const nodeSet = new Set(symbolRows.map((row) => row.qualified_name));
    const edgeRows = this.db
      .prepare("SELECT source, target, type, weight, metadata FROM edges ORDER BY weight DESC LIMIT ?")
      .all(limit) as Array<{ source: string; target: string; type: string; weight: number; metadata: string }>;
    for (const row of edgeRows) {
      nodeSet.add(row.source);
      nodeSet.add(row.target);
    }
    const labels = new Map(symbolRows.map((row) => [row.qualified_name, { label: row.name, group: row.kind }]));
    return {
      nodes: [...nodeSet].slice(0, limit).map((id) => ({
        id,
        label: labels.get(id)?.label ?? id.split(":").pop() ?? id,
        group: labels.get(id)?.group ?? "external"
      })),
      edges: edgeRows.map((row) => ({
        source: row.source,
        target: row.target,
        type: row.type,
        weight: row.weight,
        metadata: parseMetadata(row.metadata)
      }))
    };
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root TEXT NOT NULL,
        label TEXT,
        indexed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        lines INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        skipped INTEGER NOT NULL DEFAULT 0,
        skip_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        language TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        qualified_name TEXT NOT NULL UNIQUE,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        signature TEXT,
        doc TEXT,
        exported INTEGER NOT NULL DEFAULT 0,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        target TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(source, target, type)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
      CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
      CREATE TABLE IF NOT EXISTS code_lines (
        file_path TEXT NOT NULL,
        line INTEGER NOT NULL,
        text TEXT NOT NULL,
        PRIMARY KEY(file_path, line)
      );
      CREATE INDEX IF NOT EXISTS idx_code_lines_file ON code_lines(file_path);
      CREATE TABLE IF NOT EXISTS decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        body TEXT NOT NULL,
        tags TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}

export function defaultDbPath(root: string): string {
  return path.join(root, ".codebase-memory", "memory.db");
}

function rowToSymbol(row: SymbolRow): SymbolNode {
  return {
    id: row.id,
    filePath: row.file_path,
    language: row.language,
    kind: row.kind,
    name: row.name,
    qualifiedName: row.qualified_name,
    startLine: row.start_line,
    endLine: row.end_line,
    signature: row.signature ?? undefined,
    doc: row.doc ?? undefined,
    exported: row.exported === 1,
    metadata: parseMetadata(row.metadata)
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function getCount(db: DatabaseSync, sql: string): number {
  return Number((db.prepare(sql).get() as unknown as CountRow).count);
}
