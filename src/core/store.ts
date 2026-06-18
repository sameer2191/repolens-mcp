import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cosineSimilarity, semanticScore, semanticTokens, semanticVector, type LocalVector } from "./semantic.js";
import type {
  ArchitectureSummary,
  ArchitectureRecommendation,
  ChangeImpactResult,
  CodeMatch,
  CodeSnippet,
  DeadCodeCandidate,
  DependencyCycle,
  DecisionRecord,
  Edge,
  GraphQueryResult,
  GraphCommunity,
  GraphSchema,
  GraphSearchMatch,
  GraphSearchOptions,
  GitHistoryFile,
  IndexedFile,
  Language,
  SemanticSearchMatch,
  SymbolNode,
  SymbolReference,
  RuntimeTrace,
  SecretConfidence,
  SecretFinding,
  SecretScanOptions,
  SecretScanResult,
  TraceIngestResult,
  VectorIndexStats,
  VectorSearchMatch
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

interface SymbolVectorRow {
  qualified_name: string;
  dimensions: number;
  magnitude: number;
  weights: string;
  tokens: string;
  updated_at: string;
}

interface ParsedGraphQuery {
  pattern:
    | { kind: "node"; alias: string; label?: string }
    | { kind: "edge"; leftAlias: string; leftLabel?: string; edgeAlias: string; edgeType?: string; rightAlias: string; rightLabel?: string; direction: "outbound" | "inbound" };
  where: GraphWhereCondition[];
  returns: GraphReturnExpression[];
  orderBy: GraphOrderExpression[];
  limit: number;
  skip: number;
  distinct: boolean;
}

interface GraphWhereCondition {
  alias: string;
  property: string;
  operator: "=" | "<>" | "CONTAINS" | "STARTS WITH" | "ENDS WITH";
  value: string;
}

interface GraphReturnExpression {
  alias: string;
  property: string;
  output: string;
  aggregate?: "count";
  distinct?: boolean;
}

interface GraphOrderExpression {
  alias: string;
  property: string;
  direction: "ASC" | "DESC";
}

export class MemoryStore {
  readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly lockOwners = new Map<string, string>();
  private codeFtsAvailable = false;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath, { timeout: 5000 });
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initSchema();
    this.codeFtsAvailable = this.initSearchIndex();
  }

  close(): void {
    this.db.close();
  }

  snapshotTo(outPath: string): void {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (fs.existsSync(outPath)) {
      fs.unlinkSync(outPath);
    }
    this.db.exec(`VACUUM INTO ${sqlString(outPath)}`);
  }

  acquireLock(name: string, staleAfterMs = 10 * 60 * 1000): void {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
    const owner = `${process.pid}:${now.getTime()}:${Math.random().toString(36).slice(2)}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM locks WHERE name = ? AND locked_at < ?").run(name, staleBefore);
      const existing = this.db.prepare("SELECT locked_at, owner FROM locks WHERE name = ?").get(name) as { locked_at: string; owner: string } | undefined;
      if (existing) {
        throw new Error(`RepoLens ${name} lock is already held by ${existing.owner} since ${existing.locked_at}`);
      }
      this.db.prepare("INSERT INTO locks(name, locked_at, owner) VALUES (?, ?, ?)").run(name, now.toISOString(), owner);
      this.db.exec("COMMIT");
      this.lockOwners.set(name, owner);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  releaseLock(name: string): void {
    const owner = this.lockOwners.get(name);
    if (!owner) {
      return;
    }
    this.db.prepare("DELETE FROM locks WHERE name = ? AND owner = ?").run(name, owner);
    this.lockOwners.delete(name);
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
    this.db.prepare("DELETE FROM symbol_vectors").run();
    this.db.prepare("DELETE FROM edges").run();
    this.db.prepare("DELETE FROM code_lines").run();
    this.deleteSearchRows();
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
    const ftsStmt = this.codeFtsAvailable
      ? this.db.prepare("INSERT INTO code_fts(file_path, language, line, text, search_text) VALUES (?, ?, ?, ?, ?)")
      : null;
    const language = this.fileLanguage(filePath);
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index];
      if (text.trim()) {
        const clippedText = text.slice(0, 2000);
        stmt.run(filePath, index + 1, clippedText);
        ftsStmt?.run(filePath, language, index + 1, clippedText, buildCodeSearchText(clippedText));
      }
    }
  }

  listFiles(): IndexedFile[] {
    const rows = this.db
      .prepare("SELECT * FROM files ORDER BY path ASC")
      .all() as unknown as FileRow[];
    return rows.map((row) => ({
      path: row.path,
      language: row.language,
      bytes: row.bytes,
      lines: row.lines,
      sha256: row.sha256,
      indexedAt: row.indexed_at,
      skipped: row.skipped === 1,
      skipReason: row.skip_reason ?? undefined
    }));
  }

  symbolsForFile(filePath: string): SymbolNode[] {
    const rows = this.db
      .prepare("SELECT * FROM symbols WHERE file_path = ? ORDER BY start_line ASC")
      .all(filePath) as unknown as SymbolRow[];
    return rows.map(rowToSymbol);
  }

  deleteFile(filePath: string): void {
    const rows = this.db
      .prepare("SELECT qualified_name FROM symbols WHERE file_path = ?")
      .all(filePath) as Array<{ qualified_name: string }>;
    const deleteEdges = this.db.prepare("DELETE FROM edges WHERE source = ? OR target = ?");
    const deleteVector = this.db.prepare("DELETE FROM symbol_vectors WHERE qualified_name = ?");
    for (const row of rows) {
      deleteEdges.run(row.qualified_name, row.qualified_name);
      deleteVector.run(row.qualified_name);
    }
    this.db.prepare("DELETE FROM symbols WHERE file_path = ?").run(filePath);
    this.db.prepare("DELETE FROM code_lines WHERE file_path = ?").run(filePath);
    this.deleteSearchRows(filePath);
    this.db.prepare("DELETE FROM files WHERE path = ?").run(filePath);
    this.deleteOrphanChannels();
  }

  deleteCallEdges(): void {
    this.db.prepare("DELETE FROM edges WHERE type IN ('CALLS', 'CALLS_LOCAL')").run();
  }

  deleteDerivedEdges(): void {
    this.db
      .prepare("DELETE FROM edges WHERE type IN ('CALLS', 'CALLS_LOCAL', 'HTTP_CALLS', 'IMPORTS_FILE', 'INHERITS', 'IMPLEMENTS', 'USES_TYPE', 'SIMILAR_TO', 'SEMANTICALLY_RELATED')")
      .run();
  }

  counts(): { symbols: number; edges: number } {
    return {
      symbols: getCount(this.db, "SELECT count(*) AS count FROM symbols"),
      edges: getCount(this.db, "SELECT count(*) AS count FROM edges")
    };
  }

  searchCode(query: string, limit = 20): CodeMatch[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const ftsQuery = buildFtsQuery(trimmed);
    if (this.codeFtsAvailable && ftsQuery) {
      try {
        const rows = this.db
          .prepare(
            `SELECT file_path, language, line, text, bm25(code_fts) AS rank
             FROM code_fts
             WHERE code_fts MATCH ?
             ORDER BY rank ASC, file_path ASC, line ASC
             LIMIT ?`
          )
          .all(ftsQuery, limit) as Array<{
          file_path: string;
          language: Language;
          line: number;
          text: string;
          rank: number;
        }>;

        if (rows.length > 0) {
          return rows.map((row) => ({
            filePath: row.file_path,
            language: row.language,
            line: row.line,
            text: row.text,
            score: Number((-row.rank).toFixed(6))
          }));
        }
      } catch {
        this.codeFtsAvailable = false;
      }
    }

    const normalized = `%${trimmed.toLowerCase()}%`;
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

    const lowered = trimmed.toLowerCase();
    return rows.map((row) => ({
      filePath: row.file_path,
      language: row.language,
      line: row.line,
      text: row.text,
      score: row.text.toLowerCase().includes(lowered) ? 1 : 0.5
    }));
  }

  scanSecrets(options: SecretScanOptions = {}): SecretScanResult {
    const limit = clampPositive(options.limit ?? 50, 1, 500);
    const minConfidence = options.minConfidence ?? "low";
    const minRank = secretConfidenceRank(minConfidence);
    const includeTests = options.includeTests ?? false;
    const rows = this.db
      .prepare(
        `SELECT code_lines.file_path, files.language, code_lines.line, code_lines.text
         FROM code_lines
         JOIN files ON files.path = code_lines.file_path
         WHERE files.skipped = 0
         ORDER BY code_lines.file_path ASC, code_lines.line ASC`
      )
      .all() as Array<{
      file_path: string;
      language: Language;
      line: number;
      text: string;
    }>;

    const findings: SecretFinding[] = [];
    let scannedLines = 0;
    for (const row of rows) {
      if (!includeTests && isTestLikePath(row.file_path)) {
        continue;
      }
      scannedLines += 1;
      for (const finding of detectSecretFindings({
        filePath: row.file_path,
        language: row.language,
        line: row.line,
        text: row.text
      })) {
        if (secretConfidenceRank(finding.confidence) >= minRank) {
          findings.push(finding);
        }
      }
    }

    findings.sort(
      (left, right) =>
        secretConfidenceRank(right.confidence) - secretConfidenceRank(left.confidence) ||
        secretSeverityRank(right.severity) - secretSeverityRank(left.severity) ||
        left.filePath.localeCompare(right.filePath) ||
        left.line - right.line
    );

    const totals = {
      findings: findings.length,
      high: findings.filter((finding) => finding.severity === "high").length,
      medium: findings.filter((finding) => finding.severity === "medium").length,
      low: findings.filter((finding) => finding.severity === "low").length,
      files: new Set(findings.map((finding) => finding.filePath)).size
    };
    const risks: string[] = [];
    if (totals.high > 0) risks.push(`${totals.high} high-severity secret patterns`);
    if (totals.medium > 0) risks.push(`${totals.medium} medium-severity secret patterns`);
    if (totals.low > 0) risks.push(`${totals.low} low-confidence sensitive references`);
    if (findings.length > limit) risks.push(`showing ${limit} of ${findings.length} findings`);

    return {
      scannedLines,
      findings: findings.slice(0, limit),
      totals,
      risks
    };
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

  getCodeSnippet(identifier: string, context = 4): CodeSnippet | null {
    const symbol = this.getSymbol(identifier) ?? this.searchSymbols(identifier, undefined, 1)[0];
    if (symbol) {
      return this.snippetForLocation(symbol.filePath, symbol.startLine, symbol.endLine, clampPositive(context, 0, 40), symbol);
    }

    const location = parseFileLine(identifier);
    if (location) {
      return this.snippetForLocation(location.filePath, location.line, location.line, clampPositive(context, 0, 40));
    }

    const file = this.db.prepare("SELECT * FROM files WHERE path = ? LIMIT 1").get(identifier) as FileRow | undefined;
    if (!file) {
      return null;
    }
    return this.snippetForLocation(file.path, 1, Math.min(file.lines, 40), 0);
  }

  findReferences(identifier: string, limit = 100): SymbolReference[] {
    const symbol = this.getSymbol(identifier) ?? this.searchSymbols(identifier, undefined, 1)[0];
    const targetName = (symbol?.name ?? identifier).trim();
    if (!targetName) {
      return [];
    }
    const exactMatcher = identifierMatcher(targetName);
    const rows = this.db
      .prepare(
        `SELECT code_lines.file_path, files.language, code_lines.line, code_lines.text
         FROM code_lines
         JOIN files ON files.path = code_lines.file_path
         WHERE lower(code_lines.text) LIKE ?
         ORDER BY code_lines.file_path ASC, code_lines.line ASC
         LIMIT 10000`
      )
      .all(`%${targetName.toLowerCase()}%`) as Array<{
      file_path: string;
      language: Language;
      line: number;
      text: string;
    }>;

    let definitionEmitted = false;
    return rows
      .filter((row) => exactMatcher(row.text))
      .map((row) => {
        const inSymbolRange = Boolean(symbol && row.file_path === symbol.filePath && row.line >= symbol.startLine && row.line <= symbol.endLine);
        const isDefinition = inSymbolRange && !definitionEmitted;
        if (isDefinition) {
          definitionEmitted = true;
        }
        return {
          filePath: row.file_path,
          language: row.language,
          line: row.line,
          text: row.text,
          kind: isDefinition ? "definition" : "reference",
          score: isDefinition ? 1 : row.file_path === symbol?.filePath ? 0.82 : 0.7,
          ...(symbol ? { symbol } : {}),
          reason: isDefinition ? "symbol definition line" : `exact identifier match for ${targetName}`
        } satisfies SymbolReference;
      })
      .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath) || a.line - b.line)
      .slice(0, clampPositive(limit, 1, 500));
  }

  private snippetForLocation(filePath: string, startLine: number, endLine: number, context: number, symbol?: SymbolNode): CodeSnippet | null {
    const file = this.db.prepare("SELECT * FROM files WHERE path = ? LIMIT 1").get(filePath) as FileRow | undefined;
    const from = Math.max(1, startLine - context);
    const to = Math.max(from, endLine + context);
    const root = this.latestRoot();
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);

    let lines: Array<{ line: number; text: string; highlight: boolean }> = [];
    try {
      const content = fs.readFileSync(absolutePath, "utf8");
      lines = content
        .split(/\r?\n/)
        .slice(from - 1, to)
        .map((text, index) => {
          const line = from + index;
          return { line, text, highlight: line >= startLine && line <= endLine };
        });
    } catch {
      const rows = this.db
        .prepare(
          `SELECT line, text
           FROM code_lines
           WHERE file_path = ? AND line BETWEEN ? AND ?
           ORDER BY line ASC`
        )
        .all(filePath, from, to) as Array<{ line: number; text: string }>;
      lines = rows.map((row) => ({ ...row, highlight: row.line >= startLine && row.line <= endLine }));
    }

    if (lines.length === 0) {
      return null;
    }

    return {
      filePath,
      language: symbol?.language ?? file?.language ?? "unknown",
      startLine: from,
      endLine: lines[lines.length - 1].line,
      symbol,
      lines
    };
  }

  private codeWindow(filePath: string, startLine: number, endLine: number): string {
    const rows = this.db
      .prepare(
        `SELECT text
         FROM code_lines
         WHERE file_path = ? AND line BETWEEN ? AND ?
         ORDER BY line ASC`
      )
      .all(filePath, startLine, Math.max(startLine, endLine)) as Array<{ text: string }>;
    return rows.map((row) => row.text).join("\n");
  }

  private vectorText(symbol: SymbolNode): string {
    return [
      symbol.kind,
      symbol.name,
      symbol.qualifiedName,
      symbol.filePath,
      symbol.signature ?? "",
      symbol.doc ?? "",
      JSON.stringify(symbol.metadata ?? {}),
      this.codeWindow(symbol.filePath, symbol.startLine, symbol.endLine)
    ].join("\n");
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

  graphSchema(): GraphSchema {
    const languages = this.db
      .prepare(
        `SELECT files.language AS language, count(*) AS files,
          (SELECT count(*) FROM symbols WHERE symbols.language = files.language) AS symbols
         FROM files
         WHERE skipped = 0
         GROUP BY files.language
         ORDER BY symbols DESC, files DESC`
      )
      .all() as Array<{ language: Language; files: number; symbols: number }>;

    return {
      totals: {
        files: getCount(this.db, "SELECT count(*) AS count FROM files WHERE skipped = 0"),
        symbols: getCount(this.db, "SELECT count(*) AS count FROM symbols"),
        edges: getCount(this.db, "SELECT count(*) AS count FROM edges")
      },
      languages,
      nodeLabels: this.nodeLabels(),
      edgeTypes: this.edgeTypes()
    };
  }

  searchGraph(options: GraphSearchOptions = {}): GraphSearchMatch[] {
    const limit = clampPositive(options.limit ?? 20, 1, 200);
    const offset = Math.max(0, options.offset ?? 0);
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (options.query?.trim()) {
      const query = `%${options.query.trim().toLowerCase()}%`;
      where.push("(lower(s.name) LIKE ? OR lower(s.qualified_name) LIKE ? OR lower(s.file_path) LIKE ? OR lower(coalesce(s.signature, '')) LIKE ?)");
      params.push(query, query, query, query);
    }
    if (options.kind?.trim()) {
      where.push("lower(s.kind) = lower(?)");
      params.push(options.kind.trim());
    }
    if (options.filePattern?.trim()) {
      where.push("lower(s.file_path) LIKE ?");
      params.push(`%${options.filePattern.trim().toLowerCase()}%`);
    }
    if (options.relationship?.trim()) {
      where.push("EXISTS (SELECT 1 FROM edges rel WHERE rel.type = ? AND (rel.source = s.qualified_name OR rel.target = s.qualified_name))");
      params.push(options.relationship.trim());
    }
    if ((options.minDegree ?? 0) > 0) {
      where.push("coalesce(i.inbound, 0) + coalesce(o.outbound, 0) >= ?");
      params.push(options.minDegree ?? 0);
    }

    const regex = options.namePattern?.trim() ? new RegExp(options.namePattern.trim(), "i") : null;
    const sqlLimit = regex ? Math.min(1000, Math.max(limit + offset, (limit + offset) * 12)) : limit;
    const sqlOffset = regex ? 0 : offset;
    const rows = this.db
      .prepare(
        `WITH inbound AS (
           SELECT target, count(*) AS inbound FROM edges GROUP BY target
         ),
         outbound AS (
           SELECT source, count(*) AS outbound FROM edges GROUP BY source
         )
         SELECT s.*, coalesce(i.inbound, 0) AS inbound, coalesce(o.outbound, 0) AS outbound,
           coalesce(i.inbound, 0) + coalesce(o.outbound, 0) AS degree
         FROM symbols s
         LEFT JOIN inbound i ON i.target = s.qualified_name
         LEFT JOIN outbound o ON o.source = s.qualified_name
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY degree DESC, s.exported DESC, s.name ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, sqlLimit, sqlOffset) as unknown as Array<SymbolRow & { inbound: number; outbound: number; degree: number }>;

    const matches = regex ? rows.filter((row) => regex.test(row.name) || regex.test(row.qualified_name)).slice(offset, offset + limit) : rows;
    return matches.map((row) => ({
      symbol: rowToSymbol(row),
      inbound: row.inbound,
      outbound: row.outbound,
      degree: row.degree
    }));
  }

  semanticSearch(query: string | string[], limit = 20): SemanticSearchMatch[] {
    const queryText = Array.isArray(query) ? query.join(" ") : query;
    const queryTokens = semanticTokens(queryText);
    if (queryTokens.size === 0) {
      return [];
    }
    const rows = this.db
      .prepare(
        `SELECT *
         FROM symbols
         WHERE kind NOT IN ('file', 'dependency', 'package')
         ORDER BY exported DESC, name ASC
         LIMIT 8000`
      )
      .all() as unknown as SymbolRow[];

    return rows
      .map((row) => {
        const symbol = rowToSymbol(row);
        const body = this.codeWindow(symbol.filePath, symbol.startLine, symbol.endLine);
        const targetTokens = semanticTokens([symbol.name, symbol.signature ?? "", symbol.filePath, body].join("\n"));
        const scored = semanticScore(queryTokens, targetTokens);
        const nameTokens = semanticTokens(symbol.name);
        const nameHits = [...queryTokens].filter((token) => nameTokens.has(token));
        const pathHits = [...queryTokens].filter((token) => symbol.filePath.toLowerCase().includes(token));
        const boost = nameHits.length * 0.18 + pathHits.length * 0.08 + (symbol.exported ? 0.03 : 0);
        const score = Number(Math.min(1, scored.score + boost).toFixed(4));
        const reasons = [
          ...(nameHits.length ? [`name matched ${nameHits.join(", ")}`] : []),
          ...(pathHits.length ? [`path matched ${pathHits.join(", ")}`] : []),
          ...(scored.matchedTokens.length ? [`semantic tokens ${scored.matchedTokens.slice(0, 8).join(", ")}`] : [])
        ];
        return { symbol, score, matchedTokens: scored.matchedTokens, reasons };
      })
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score || a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName))
      .slice(0, clampPositive(limit, 1, 100));
  }

  rebuildSymbolVectors(dimensions = 384): VectorIndexStats {
    const vectorDimensions = Math.max(32, Math.min(2048, Math.floor(dimensions)));
    const rows = this.db
      .prepare(
        `SELECT *
         FROM symbols
         WHERE kind NOT IN ('file', 'dependency', 'package', 'lockfile', 'locked_dependency')
         ORDER BY file_path ASC, start_line ASC
         LIMIT 20000`
      )
      .all() as unknown as SymbolRow[];
    const insert = this.db.prepare(
      `INSERT INTO symbol_vectors(qualified_name, dimensions, magnitude, weights, tokens, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(qualified_name) DO UPDATE SET
         dimensions=excluded.dimensions,
         magnitude=excluded.magnitude,
         weights=excluded.weights,
         tokens=excluded.tokens,
         updated_at=excluded.updated_at`
    );
    const updatedAt = new Date().toISOString();
    let vectors = 0;

    this.transaction(() => {
      this.db.prepare("DELETE FROM symbol_vectors").run();
      for (const row of rows) {
        const symbol = rowToSymbol(row);
        const vector = semanticVector(this.vectorText(symbol), vectorDimensions);
        if (vector.magnitude === 0 || vector.weights.length === 0) {
          continue;
        }
        insert.run(symbol.qualifiedName, vector.dimensions, vector.magnitude, JSON.stringify(vector.weights), JSON.stringify(vector.tokens), updatedAt);
        vectors += 1;
      }
    });

    return { dimensions: vectorDimensions, symbols: rows.length, vectors };
  }

  vectorSearch(query: string | string[], limit = 20): VectorSearchMatch[] {
    const queryText = Array.isArray(query) ? query.join(" ") : query;
    const queryVector = semanticVector(queryText);
    if (queryVector.magnitude === 0 || queryVector.weights.length === 0) {
      return [];
    }
    this.ensureSymbolVectors(queryVector.dimensions);

    const rows = this.db
      .prepare(
        `SELECT s.*, v.dimensions, v.magnitude, v.weights, v.tokens, v.updated_at
         FROM symbol_vectors v
         JOIN symbols s ON s.qualified_name = v.qualified_name
         WHERE v.dimensions = ?
         ORDER BY s.exported DESC, s.name ASC
         LIMIT 20000`
      )
      .all(queryVector.dimensions) as unknown as Array<SymbolRow & SymbolVectorRow>;
    const queryTokens = new Set(queryVector.tokens);

    return rows
      .map((row) => {
        const symbol = rowToSymbol(row);
        const vector = rowToVector(row);
        const targetTokens = new Set(vector.tokens);
        const matchedTokens = [...queryTokens].filter((token) => targetTokens.has(token)).sort();
        const cosine = cosineSimilarity(queryVector, vector);
        const nameTokens = semanticTokens(symbol.name);
        const nameHits = [...queryTokens].filter((token) => nameTokens.has(token));
        const pathHits = [...queryTokens].filter((token) => symbol.filePath.toLowerCase().includes(token));
        const boost = nameHits.length * 0.03 + pathHits.length * 0.015 + (symbol.exported ? 0.01 : 0);
        const score = Number(Math.min(1, Math.max(0, cosine + boost)).toFixed(4));
        const reasons = [
          `cosine ${Math.max(0, cosine).toFixed(3)}`,
          ...(nameHits.length ? [`name vector matched ${nameHits.join(", ")}`] : []),
          ...(pathHits.length ? [`path vector matched ${pathHits.join(", ")}`] : []),
          ...(matchedTokens.length ? [`overlap ${matchedTokens.slice(0, 10).join(", ")}`] : [])
        ];
        return {
          symbol,
          score,
          matchedTokens,
          vector: {
            dimensions: vector.dimensions,
            magnitude: vector.magnitude,
            nonZero: vector.weights.length
          },
          reasons
        };
      })
      .filter((match) => match.score > 0.04 && (match.matchedTokens.length > 0 || match.score > 0.2))
      .sort((a, b) => b.score - a.score || a.symbol.qualifiedName.localeCompare(b.symbol.qualifiedName))
      .slice(0, clampPositive(limit, 1, 100));
  }

  queryGraph(query: string, limit = 100): GraphQueryResult {
    const parsed = parseGraphQuery(query, clampPositive(limit, 1, 500));
    const params: Array<string | number> = [];
    const where: string[] = [];
    const aliasMap =
      parsed.pattern.kind === "node"
        ? new Map([[parsed.pattern.alias, "s"]])
        : new Map([
            [parsed.pattern.leftAlias, "left_symbol"],
            [parsed.pattern.rightAlias, "right_symbol"],
            [parsed.pattern.edgeAlias, "edges"],
            ["e", "edges"]
          ]);

    if (parsed.pattern.kind === "node" && parsed.pattern.label) {
      where.push("lower(s.kind) = lower(?)");
      params.push(normalizeGraphLabel(parsed.pattern.label));
    } else if (parsed.pattern.kind === "edge") {
      if (parsed.pattern.leftLabel) {
        where.push("lower(left_symbol.kind) = lower(?)");
        params.push(normalizeGraphLabel(parsed.pattern.leftLabel));
      }
      if (parsed.pattern.rightLabel) {
        where.push("lower(right_symbol.kind) = lower(?)");
        params.push(normalizeGraphLabel(parsed.pattern.rightLabel));
      }
      if (parsed.pattern.edgeType) {
        where.push("edges.type = ?");
        params.push(parsed.pattern.edgeType.toUpperCase());
      }
    }

    for (const condition of parsed.where) {
      where.push(whereSql(condition, aliasMap, params));
    }

    const selectSql = parsed.returns.map((expr, index) => `${returnSql(expr, aliasMap)} AS c${index}`);
    const fromSql =
      parsed.pattern.kind === "node"
        ? "symbols s"
        : parsed.pattern.direction === "outbound"
          ? "edges JOIN symbols left_symbol ON left_symbol.qualified_name = edges.source JOIN symbols right_symbol ON right_symbol.qualified_name = edges.target"
          : "edges JOIN symbols left_symbol ON left_symbol.qualified_name = edges.target JOIN symbols right_symbol ON right_symbol.qualified_name = edges.source";
    const orderSql = parsed.orderBy.map((expr) => `${propertySql(expr.alias, expr.property, aliasMap)} ${expr.direction}`);
    const sql =
      `SELECT ${parsed.distinct ? "DISTINCT " : ""}${selectSql.join(", ")} FROM ${fromSql}` +
      `${where.length ? ` WHERE ${where.join(" AND ")}` : ""}` +
      `${orderSql.length ? ` ORDER BY ${orderSql.join(", ")}` : ""}` +
      " LIMIT ? OFFSET ?";
    const rows = this.db.prepare(sql).all(...params, parsed.limit, parsed.skip) as Array<Record<string, string | number | boolean | null>>;
    return {
      query,
      columns: parsed.returns.map((expr) => expr.output),
      rows: rows.map((row) =>
        Object.fromEntries(parsed.returns.map((expr, index) => [expr.output, row[`c${index}`] ?? null]))
      ),
      limit: parsed.limit
    };
  }

  ingestTraces(traces: RuntimeTrace[]): TraceIngestResult {
    const edges: Edge[] = [];
    const unresolved: TraceIngestResult["unresolved"] = [];
    const observedAt = new Date().toISOString();

    for (const trace of traces) {
      const type = trace.type ?? inferTraceType(trace);
      if (type === "http") {
        const source = this.resolveTraceEndpoint(trace.source, trace.sourceFile);
        const route = this.findRoute(trace.method ?? "ANY", trace.path ?? trace.target ?? "");
        if (!source || !route) {
          unresolved.push({ trace, reason: !source ? "source symbol not found" : "route target not found" });
          continue;
        }
        edges.push({
          source,
          target: route.qualifiedName,
          type: "OBSERVED_HTTP_CALLS",
          weight: traceWeight(trace),
          metadata: traceMetadata(trace, observedAt, { method: String(route.metadata?.method ?? trace.method ?? "ANY"), path: String(route.metadata?.path ?? trace.path ?? "") })
        });
        continue;
      }

      if (type === "event") {
        const source = this.resolveTraceEndpoint(trace.source, trace.sourceFile);
        const channel = normalizeObservedChannel(trace.channel ?? trace.target);
        if (!source || !channel) {
          unresolved.push({ trace, reason: !source ? "source symbol not found" : "channel target not found" });
          continue;
        }
        const channelSymbol = this.ensureRuntimeChannel(channel);
        edges.push({
          source,
          target: channelSymbol.qualifiedName,
          type: trace.direction === "listen" ? "OBSERVED_LISTENS_ON" : "OBSERVED_EMITS",
          weight: traceWeight(trace),
          metadata: traceMetadata(trace, observedAt, { channel })
        });
        continue;
      }

      const source = this.resolveTraceEndpoint(trace.source, trace.sourceFile);
      const target = this.resolveTraceEndpoint(trace.target, trace.targetFile);
      if (!source || !target) {
        unresolved.push({ trace, reason: !source ? "source symbol not found" : "target symbol not found" });
        continue;
      }
      edges.push({
        source,
        target,
        type: normalizeObservedEdgeType(trace.edgeType ?? "OBSERVED_CALLS"),
        weight: traceWeight(trace),
        metadata: traceMetadata(trace, observedAt)
      });
    }

    this.transaction(() => {
      for (const edge of edges) {
        this.insertEdge(edge);
      }
    });

    return {
      tracesReceived: traces.length,
      edgesInserted: edges.length,
      edges,
      unresolved
    };
  }

  communities(limit = 20, minMembers = 4): GraphCommunity[] {
    const nodeRows = this.db
      .prepare(
        `SELECT *
         FROM symbols
         WHERE kind NOT IN ('dependency', 'package')
         ORDER BY file_path ASC, start_line ASC
         LIMIT 15000`
      )
      .all() as unknown as SymbolRow[];
    const symbols = new Map(nodeRows.map((row) => [row.qualified_name, rowToSymbol(row)]));
    if (symbols.size === 0) {
      return [];
    }

    const edgeRows = this.db
      .prepare(
        `SELECT source, target, type, weight
         FROM edges
         WHERE type IN ('CALLS', 'CALLS_LOCAL', 'HTTP_CALLS', 'IMPORTS', 'DEFINES', 'DECLARES', 'SIMILAR_TO', 'SEMANTICALLY_RELATED')
         LIMIT 60000`
      )
      .all() as Array<{ source: string; target: string; type: string; weight: number }>;

    const adjacency = new Map<string, Map<string, number>>();
    const degree = new Map<string, number>();
    const graphEdges: Array<{ source: string; target: string; type: string; weight: number }> = [];
    for (const row of edgeRows) {
      if (!symbols.has(row.source) || !symbols.has(row.target) || row.source === row.target) {
        continue;
      }
      const weight = communityEdgeWeight(row.type, row.weight);
      degree.set(row.source, (degree.get(row.source) ?? 0) + 1);
      degree.set(row.target, (degree.get(row.target) ?? 0) + 1);
      graphEdges.push({ ...row, weight });
    }
    for (const edge of graphEdges) {
      const normalizedWeight = edge.weight / Math.sqrt(Math.max(1, degree.get(edge.source) ?? 1) * Math.max(1, degree.get(edge.target) ?? 1));
      addWeightedNeighbor(adjacency, edge.source, edge.target, normalizedWeight);
      addWeightedNeighbor(adjacency, edge.target, edge.source, normalizedWeight);
    }

    const labels = new Map([...symbols.keys()].map((id) => [id, id]));
    const orderedNodes = [...symbols.keys()].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || a.localeCompare(b));
    for (let iteration = 0; iteration < 8; iteration += 1) {
      let changed = 0;
      for (const node of orderedNodes) {
        const neighbors = adjacency.get(node);
        if (!neighbors || neighbors.size === 0) {
          continue;
        }
        const scores = new Map<string, number>();
        for (const [neighbor, weight] of neighbors) {
          const label = labels.get(neighbor) ?? neighbor;
          scores.set(label, (scores.get(label) ?? 0) + weight);
        }
        const current = labels.get(node) ?? node;
        scores.set(current, (scores.get(current) ?? 0) + 0.1);
        const best = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? current;
        if (best !== current) {
          labels.set(node, best);
          changed += 1;
        }
      }
      if (changed === 0) {
        break;
      }
    }

    const membersByLabel = new Map<string, string[]>();
    for (const [node, label] of labels) {
      const members = membersByLabel.get(label) ?? [];
      members.push(node);
      membersByLabel.set(label, members);
    }

    const communities = [];
    for (const [label, members] of membersByLabel) {
      for (const [suffix, groupedMembers] of splitLargeCommunity(members, symbols)) {
        communities.push(communityFromMembers(`${label}:${suffix}`, groupedMembers, symbols, graphEdges, degree));
      }
    }

    return communities
      .filter((community) => community.members >= clampPositive(minMembers, 2, 200))
      .sort((a, b) => b.internalEdges - a.internalEdges || b.members - a.members || a.label.localeCompare(b.label))
      .slice(0, clampPositive(limit, 1, 100));
  }

  findDeadCode(limit = 50): DeadCodeCandidate[] {
    const rows = this.db
      .prepare(
        `WITH inbound AS (
           SELECT target, count(*) AS inbound
           FROM edges
           WHERE type IN ('CALLS', 'CALLS_LOCAL')
           GROUP BY target
         ),
         outbound AS (
           SELECT source, count(*) AS outbound
           FROM edges
           WHERE type IN ('CALLS', 'CALLS_LOCAL')
           GROUP BY source
         )
         SELECT s.*, coalesce(i.inbound, 0) AS inbound, coalesce(o.outbound, 0) AS outbound
         FROM symbols s
         LEFT JOIN inbound i ON i.target = s.qualified_name
         LEFT JOIN outbound o ON o.source = s.qualified_name
         WHERE s.kind IN ('function', 'method')
           AND s.exported = 0
           AND coalesce(i.inbound, 0) = 0
           AND lower(s.name) NOT IN ('main', 'handler', 'setup', 'init')
           AND lower(s.file_path) NOT LIKE '%test%'
           AND lower(s.file_path) NOT LIKE '%spec%'
         ORDER BY s.file_path ASC, s.start_line ASC
         LIMIT ?`
      )
      .all(clampPositive(limit, 1, 500)) as unknown as Array<SymbolRow & { inbound: number; outbound: number }>;

    return rows.map((row) => ({
      symbol: rowToSymbol(row),
      inbound: row.inbound,
      outbound: row.outbound,
      reason: "no inbound call edges and not exported"
    }));
  }

  dependencyCycles(limit = 20): DependencyCycle[] {
    const resolvedRows = this.db
      .prepare(
        `SELECT source_symbol.file_path AS source_file,
          target_symbol.file_path AS target_file,
          edges.type
         FROM edges
         JOIN symbols source_symbol ON source_symbol.qualified_name = edges.source
         JOIN symbols target_symbol ON target_symbol.qualified_name = edges.target
         WHERE edges.type = 'IMPORTS_FILE'
         LIMIT 50000`
      )
      .all() as Array<{ source_file: string; target_file: string; type: string }>;

    const graph = new Map<string, Set<string>>();
    const edges = new Map<string, { source: string; target: string; count: number; sampleEdges: Array<{ source: string; target: string; type: string }> }>();
    const addCycleEdge = (sourceFile: string, targetFile: string, type: string) => {
      if (targetFile === sourceFile) {
        return;
      }
      const source = clusterName(sourceFile);
      const target = clusterName(targetFile);
      if (source === target) {
        return;
      }
      const targets = graph.get(source) ?? new Set<string>();
      targets.add(target);
      graph.set(source, targets);
      if (!graph.has(target)) graph.set(target, new Set<string>());

      const key = `${source}->${target}`;
      const edge = edges.get(key) ?? { source, target, count: 0, sampleEdges: [] };
      edge.count += 1;
      if (edge.sampleEdges.length < 3) {
        edge.sampleEdges.push({ source: sourceFile, target: targetFile, type });
      }
      edges.set(key, edge);
    };

    if (resolvedRows.length > 0) {
      for (const row of resolvedRows) {
        addCycleEdge(row.source_file, row.target_file, row.type);
      }
      return dependencyCyclesFromGraph(graph, edges, limit);
    }

    const fileRows = this.db
      .prepare("SELECT path FROM files WHERE skipped = 0")
      .all() as Array<{ path: string }>;
    const filePaths = new Set(fileRows.map((row) => row.path));
    const packageRoots = (this.db
      .prepare("SELECT name, file_path FROM symbols WHERE kind = 'package' ORDER BY length(name) DESC")
      .all() as Array<{ name: string; file_path: string }>).map((row) => [row.name, path.posix.dirname(row.file_path)] as [string, string]);
    const rows = this.db
      .prepare(
        `SELECT source_symbol.file_path AS source_file,
          edges.type,
          edges.source,
          edges.target,
          edges.metadata
         FROM edges
         JOIN symbols source_symbol ON source_symbol.qualified_name = edges.source
         WHERE edges.type = 'IMPORTS'
         LIMIT 25000`
      )
      .all() as Array<{ source_file: string; type: string; source: string; target: string; metadata: string }>;

    for (const row of rows) {
      const imported = parseMetadata(row.metadata).import;
      if (typeof imported !== "string") {
        continue;
      }
      const targetFile = resolveImportFile(row.source_file, imported, filePaths, packageRoots);
      if (!targetFile || targetFile === row.source_file) {
        continue;
      }
      addCycleEdge(row.source_file, targetFile, row.type);
    }

    return dependencyCyclesFromGraph(graph, edges, limit);
  }

  detectChanges(root = this.latestRoot(), limit = 100): ChangeImpactResult {
    const repoRoot = path.resolve(root);
    const changed = new Set<string>();
    const signals: string[] = [];
    for (const args of [
      ["diff", "--name-only"],
      ["diff", "--cached", "--name-only"],
      ["ls-files", "--others", "--exclude-standard"]
    ]) {
      const result = spawnSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
      if (result.status !== 0) {
        const message = String(result.stderr || result.stdout || "git command failed").trim();
        signals.push(`${args.join(" ")} failed: ${message}`);
        continue;
      }
      for (const line of result.stdout.split(/\r?\n/)) {
        if (line.trim()) changed.add(line.trim());
      }
    }

    const changedFiles = [...changed].sort();
    const impacted = changedFiles.length > 0 ? this.impactedBy(changedFiles, limit) : [];
    const risk = impacted.length > 40 || changedFiles.length > 12 ? "high" : impacted.length > 12 || changedFiles.length > 4 ? "medium" : changedFiles.length > 0 ? "low" : "none";
    if (changedFiles.length === 0) {
      signals.push("no uncommitted git changes detected");
    }
    if (impacted.length === 0 && changedFiles.length > 0) {
      signals.push("changed files did not map to indexed symbols; re-index may be needed");
    }

    return { root: repoRoot, changedFiles, impacted, risk, signals };
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

    const nodeLabels = this.nodeLabels();
    const edgeTypes = this.edgeTypes();
    const topSymbols = this.topSymbols();
    const boundaryData = this.boundariesAndClusters();
    const dependencyCycles = this.dependencyCycles(8);
    const deadCode = this.findDeadCode(5);
    const gitHistory = gitHistoryHotspots(root, 12);

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

    const hotspots = topFiles
      .filter((file) => !isDependencyMetadataFile(file.path))
      .slice(0, 8)
      .map((file) => {
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
      .prepare("SELECT DISTINCT name FROM symbols WHERE kind IN ('package','dependency') ORDER BY name ASC LIMIT 80")
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
    if (deadCode.length > 0) risks.push(`${deadCode.length} dead-code candidates sampled`);
    if (dependencyCycles.length > 0) risks.push(`${dependencyCycles.length} dependency cycles across architecture clusters`);

    const recommendations = architectureRecommendations({
      dependencyCycles,
      hotspots,
      gitHistory,
      deadCode,
      skippedFiles,
      taskCount,
      secretHints
    });

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
      nodeLabels,
      edgeTypes,
      topFiles,
      topSymbols,
      gitHistory,
      hotspots,
      boundaries: boundaryData.boundaries,
      clusters: boundaryData.clusters,
      dependencyCycles,
      recommendations,
      entrypoints,
      packages,
      deadCode: { candidates: deadCode.length, samples: deadCode },
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

  private resolveTraceEndpoint(identifier: string | undefined, filePath?: string): string | null {
    const split = splitTraceIdentifier(identifier);
    const scopedFile = filePath ?? split.filePath;
    const name = split.name;

    if (scopedFile) {
      if (!name) {
        const file = this.db.prepare("SELECT path FROM files WHERE path = ? LIMIT 1").get(scopedFile) as { path: string } | undefined;
        return file ? `${file.path}:file` : null;
      }
      const row = this.db
        .prepare(
          `SELECT * FROM symbols
           WHERE file_path = ? AND (name = ? OR qualified_name = ?)
           ORDER BY exported DESC, start_line ASC
           LIMIT 1`
        )
        .get(scopedFile, name, name) as SymbolRow | undefined;
      if (row) {
        return rowToSymbol(row).qualifiedName;
      }
      return null;
    }

    if (!name) {
      return null;
    }
    const trimmed = name.trim();
    const symbol = this.getSymbol(trimmed) ?? this.searchSymbols(trimmed, undefined, 1)[0];
    if (symbol) {
      return symbol.qualifiedName;
    }
    const file = this.db.prepare("SELECT path FROM files WHERE path = ? LIMIT 1").get(trimmed) as { path: string } | undefined;
    return file ? `${file.path}:file` : null;
  }

  private findRoute(method: string, routePath: string): SymbolNode | null {
    const normalizedPath = normalizeObservedHttpPath(routePath);
    if (!normalizedPath) {
      return null;
    }
    const normalizedMethod = method.toUpperCase();
    const rows = this.db
      .prepare("SELECT * FROM symbols WHERE kind = 'route' ORDER BY name ASC")
      .all() as unknown as SymbolRow[];
    for (const row of rows) {
      const symbol = rowToSymbol(row);
      const metadataPath = normalizeObservedHttpPath(String(symbol.metadata?.path ?? ""));
      const metadataMethod = String(symbol.metadata?.method ?? "ANY").toUpperCase();
      if (metadataPath === normalizedPath && (metadataMethod === normalizedMethod || normalizedMethod === "ANY" || metadataMethod === "ANY")) {
        return symbol;
      }
    }
    return null;
  }

  private ensureRuntimeChannel(channel: string): SymbolNode {
    const qualifiedName = `channel:${channel}`;
    const existing = this.getSymbol(qualifiedName);
    if (existing) {
      return existing;
    }
    const symbol: SymbolNode = {
      filePath: "__channels__",
      language: "unknown",
      kind: "channel",
      name: channel,
      qualifiedName,
      startLine: 1,
      endLine: 1,
      exported: true,
      metadata: { channel, observed: true }
    };
    this.insertSymbol(symbol);
    return symbol;
  }

  private nodeLabels(): Array<{ kind: string; count: number }> {
    return this.db
      .prepare("SELECT kind, count(*) AS count FROM symbols GROUP BY kind ORDER BY count DESC, kind ASC")
      .all() as Array<{ kind: string; count: number }>;
  }

  private edgeTypes(): Array<{ type: string; count: number }> {
    return this.db
      .prepare("SELECT type, count(*) AS count FROM edges GROUP BY type ORDER BY count DESC, type ASC")
      .all() as Array<{ type: string; count: number }>;
  }

  private topSymbols(): Array<{
    name: string;
    qualifiedName: string;
    kind: string;
    filePath: string;
    degree: number;
    inbound: number;
    outbound: number;
  }> {
    return (
      this.db
        .prepare(
          `WITH inbound AS (
             SELECT target, count(*) AS inbound FROM edges GROUP BY target
           ),
           outbound AS (
             SELECT source, count(*) AS outbound FROM edges GROUP BY source
           )
           SELECT s.name, s.qualified_name, s.kind, s.file_path,
             coalesce(i.inbound, 0) AS inbound,
             coalesce(o.outbound, 0) AS outbound,
             coalesce(i.inbound, 0) + coalesce(o.outbound, 0) AS degree
           FROM symbols s
           LEFT JOIN inbound i ON i.target = s.qualified_name
           LEFT JOIN outbound o ON o.source = s.qualified_name
           WHERE s.kind <> 'file'
           ORDER BY degree DESC, s.exported DESC, s.name ASC
           LIMIT 20`
        )
        .all() as Array<{
        name: string;
        qualified_name: string;
        kind: string;
        file_path: string;
        degree: number;
        inbound: number;
        outbound: number;
      }>
    ).map((row) => ({
      name: row.name,
      qualifiedName: row.qualified_name,
      kind: row.kind,
      filePath: row.file_path,
      degree: row.degree,
      inbound: row.inbound,
      outbound: row.outbound
    }));
  }

  private boundariesAndClusters(): {
    boundaries: Array<{ source: string; target: string; edges: number; sampleTypes: string[] }>;
    clusters: Array<{ name: string; files: number; symbols: number; edges: number }>;
  } {
    const fileRows = this.db
      .prepare(
        `SELECT files.path, count(symbols.qualified_name) AS symbols
         FROM files
         LEFT JOIN symbols ON symbols.file_path = files.path
         WHERE files.skipped = 0
         GROUP BY files.path`
      )
      .all() as Array<{ path: string; symbols: number }>;

    const clusters = new Map<string, { name: string; files: Set<string>; symbols: number; edges: number }>();
    for (const row of fileRows) {
      const name = clusterName(row.path);
      const cluster = clusters.get(name) ?? { name, files: new Set<string>(), symbols: 0, edges: 0 };
      cluster.files.add(row.path);
      cluster.symbols += row.symbols;
      clusters.set(name, cluster);
    }

    const boundaryRows = this.db
      .prepare(
        `SELECT source_symbol.file_path AS source_file, target_symbol.file_path AS target_file, edges.type
         FROM edges
         JOIN symbols source_symbol ON source_symbol.qualified_name = edges.source
         JOIN symbols target_symbol ON target_symbol.qualified_name = edges.target
         WHERE source_symbol.file_path <> target_symbol.file_path
         LIMIT 10000`
      )
      .all() as Array<{ source_file: string; target_file: string; type: string }>;

    const boundaries = new Map<string, { source: string; target: string; edges: number; sampleTypes: Set<string> }>();
    for (const row of boundaryRows) {
      const source = clusterName(row.source_file);
      const target = clusterName(row.target_file);
      const sourceCluster = clusters.get(source);
      const targetCluster = clusters.get(target);
      if (sourceCluster) sourceCluster.edges += 1;
      if (targetCluster && target !== source) targetCluster.edges += 1;
      if (source === target) {
        continue;
      }
      const key = `${source}->${target}`;
      const boundary = boundaries.get(key) ?? { source, target, edges: 0, sampleTypes: new Set<string>() };
      boundary.edges += 1;
      boundary.sampleTypes.add(row.type);
      boundaries.set(key, boundary);
    }

    return {
      boundaries: [...boundaries.values()]
        .sort((a, b) => b.edges - a.edges)
        .slice(0, 20)
        .map((item) => ({ source: item.source, target: item.target, edges: item.edges, sampleTypes: [...item.sampleTypes].sort().slice(0, 5) })),
      clusters: [...clusters.values()]
        .sort((a, b) => b.symbols - a.symbols)
        .slice(0, 20)
        .map((item) => ({ name: item.name, files: item.files.size, symbols: item.symbols, edges: item.edges }))
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
      CREATE TABLE IF NOT EXISTS locks (
        name TEXT PRIMARY KEY,
        locked_at TEXT NOT NULL,
        owner TEXT NOT NULL
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
      CREATE TABLE IF NOT EXISTS symbol_vectors (
        qualified_name TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL,
        magnitude REAL NOT NULL,
        weights TEXT NOT NULL,
        tokens TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_symbol_vectors_dimensions ON symbol_vectors(dimensions);
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

  private initSearchIndex(): boolean {
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS code_fts USING fts5(
          file_path UNINDEXED,
          language UNINDEXED,
          line UNINDEXED,
          text UNINDEXED,
          search_text,
          tokenize = 'unicode61'
        );
      `);

      const indexedRows = getCount(this.db, "SELECT count(*) AS count FROM code_fts");
      const sourceRows = getCount(this.db, "SELECT count(*) AS count FROM code_lines");
      if (indexedRows === 0 && sourceRows > 0) {
        const rows = this.db
          .prepare(
            `SELECT code_lines.file_path, files.language, code_lines.line, code_lines.text
             FROM code_lines
             JOIN files ON files.path = code_lines.file_path
             WHERE files.skipped = 0
             ORDER BY code_lines.file_path ASC, code_lines.line ASC`
          )
          .all() as Array<{ file_path: string; language: Language; line: number; text: string }>;
        const stmt = this.db.prepare("INSERT INTO code_fts(file_path, language, line, text, search_text) VALUES (?, ?, ?, ?, ?)");
        for (const row of rows) {
          stmt.run(row.file_path, row.language, row.line, row.text, buildCodeSearchText(row.text));
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private ensureSymbolVectors(dimensions: number): void {
    const row = this.db.prepare("SELECT count(*) AS count, min(dimensions) AS min_dimensions, max(dimensions) AS max_dimensions FROM symbol_vectors").get() as
      | { count: number; min_dimensions: number | null; max_dimensions: number | null }
      | undefined;
    if (!row?.count || row.min_dimensions !== dimensions || row.max_dimensions !== dimensions) {
      this.rebuildSymbolVectors(dimensions);
    }
  }

  private fileLanguage(filePath: string): Language {
    const row = this.db.prepare("SELECT language FROM files WHERE path = ?").get(filePath) as { language: Language } | undefined;
    return row?.language ?? "unknown";
  }

  private deleteSearchRows(filePath?: string): void {
    if (!this.codeFtsAvailable) {
      return;
    }
    try {
      if (filePath) {
        this.db.prepare("DELETE FROM code_fts WHERE file_path = ?").run(filePath);
      } else {
        this.db.prepare("DELETE FROM code_fts").run();
      }
    } catch {
      this.codeFtsAvailable = false;
    }
  }

  private deleteOrphanChannels(): void {
    this.db
      .prepare(
        `DELETE FROM symbols
         WHERE kind = 'channel'
           AND qualified_name NOT IN (
             SELECT target FROM edges WHERE type IN ('EMITS', 'LISTENS_ON')
             UNION
             SELECT source FROM edges WHERE type IN ('EMITS', 'LISTENS_ON')
           )`
      )
      .run();
  }
}

export function defaultDbPath(root: string): string {
  return path.join(root, ".repolens", "memory.db");
}

function inferTraceType(trace: RuntimeTrace): "http" | "event" | "edge" {
  if (trace.method || trace.path) {
    return "http";
  }
  if (trace.channel) {
    return "event";
  }
  return "edge";
}

function traceWeight(trace: RuntimeTrace): number {
  const count = trace.count ?? 1;
  return Math.max(1, Math.min(1000, count));
}

function traceMetadata(trace: RuntimeTrace, defaultObservedAt: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    observed: true,
    observedAt: trace.observedAt ?? defaultObservedAt,
    count: trace.count ?? 1,
    ...extra,
    ...(trace.metadata ?? {})
  };
}

function normalizeObservedHttpPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed, "http://repolens.local");
    return parsed.pathname || "/";
  } catch {
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }
}

function normalizeObservedChannel(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/^["'`]|["'`]$/g, "");
}

function splitTraceIdentifier(identifier: string | undefined): { filePath?: string; name?: string } {
  const trimmed = identifier?.trim();
  if (!trimmed) {
    return {};
  }
  const hash = trimmed.lastIndexOf("#");
  if (hash > 0 && hash < trimmed.length - 1) {
    return { filePath: trimmed.slice(0, hash), name: trimmed.slice(hash + 1) };
  }
  return { name: trimmed };
}

function normalizeObservedEdgeType(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return normalized.startsWith("OBSERVED_") ? normalized : `OBSERVED_${normalized || "CALLS"}`;
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

function rowToVector(row: SymbolVectorRow): LocalVector {
  return {
    dimensions: row.dimensions,
    magnitude: row.magnitude,
    weights: parseVectorWeights(row.weights),
    tokens: parseStringArray(row.tokens)
  };
}

function parseVectorWeights(value: string): Array<[number, number]> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (item): item is [number, number] =>
          Array.isArray(item) &&
          item.length === 2 &&
          Number.isFinite(item[0]) &&
          Number.isFinite(item[1])
      )
      .map(([bucket, weight]) => [Math.floor(bucket), weight]);
  } catch {
    return [];
  }
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

function clampPositive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function detectSecretFindings(row: { filePath: string; language: Language; line: number; text: string }): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const seen = new Set<string>();
  const text = row.text;

  const knownPatterns: Array<{
    kind: string;
    label: string;
    severity: "medium" | "high";
    confidence: SecretConfidence;
    regex: RegExp;
    reason: string;
  }> = [
    {
      kind: "aws_access_key",
      label: "AWS access key id",
      severity: "high",
      confidence: "high",
      regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
      reason: "matches an AWS access key id shape"
    },
    {
      kind: "github_token",
      label: "GitHub token",
      severity: "high",
      confidence: "high",
      regex: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,}_[A-Za-z0-9_]{20,})\b/g,
      reason: "matches a GitHub token shape"
    },
    {
      kind: "openai_key",
      label: "OpenAI API key",
      severity: "high",
      confidence: "high",
      regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
      reason: "matches an OpenAI API key shape"
    },
    {
      kind: "stripe_live_key",
      label: "Stripe live key",
      severity: "high",
      confidence: "high",
      regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g,
      reason: "matches a Stripe live secret key shape"
    },
    {
      kind: "slack_token",
      label: "Slack token",
      severity: "high",
      confidence: "high",
      regex: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
      reason: "matches a Slack token shape"
    },
    {
      kind: "private_key",
      label: "Private key marker",
      severity: "high",
      confidence: "high",
      regex: /-----BEGIN [A-Z0-9 ]+ PRIVATE KEY-----/g,
      reason: "contains a private key block marker"
    },
    {
      kind: "jwt",
      label: "JWT-like token",
      severity: "medium",
      confidence: "high",
      regex: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g,
      reason: "matches a three-part JWT token shape"
    }
  ];

  for (const pattern of knownPatterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const value = match[0];
      addSecretFinding(findings, seen, {
        filePath: row.filePath,
        language: row.language,
        line: row.line,
        kind: pattern.kind,
        label: pattern.label,
        severity: pattern.severity,
        confidence: pattern.confidence,
        evidence: redactLine(text, value),
        redacted: redactSecret(value),
        reason: pattern.reason
      });
    }
  }

  const assignmentPattern =
    /["']?([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|pwd|credential|client[_-]?secret|access[_-]?key)[A-Za-z0-9_.-]*)["']?\s*[:=]\s*(["'`]?)([^"'`,\s#;]+)\2/gi;
  for (const match of text.matchAll(assignmentPattern)) {
    const key = match[1];
    const quote = match[2];
    const value = match[3];
    if (!value || !isSensitiveAssignmentKey(key) || isPlaceholderSecretValue(value)) {
      continue;
    }
    if (!quote && looksLikeCodeExpression(value)) {
      continue;
    }
    const severity = /password|passwd|pwd|client[_-]?secret|access[_-]?key|secret/i.test(key) ? "medium" : "low";
    addSecretFinding(findings, seen, {
      filePath: row.filePath,
      language: row.language,
      line: row.line,
      kind: "sensitive_assignment",
      label: key,
      severity,
      confidence: severity === "low" ? "low" : "medium",
      evidence: redactLine(text, value),
      redacted: redactSecret(value),
      reason: "sensitive-looking key assigned to a literal value"
    });
  }

  if (findings.length === 0 && isSensitiveReferenceLine(text) && !isPlaceholderReference(text)) {
    addSecretFinding(findings, seen, {
      filePath: row.filePath,
      language: row.language,
      line: row.line,
      kind: "sensitive_reference",
      label: "sensitive reference",
      severity: "low",
      confidence: "low",
      evidence: clipEvidence(text),
      redacted: "",
      reason: "line references sensitive configuration without an obvious literal secret"
    });
  }

  return findings;
}

function addSecretFinding(findings: SecretFinding[], seen: Set<string>, finding: SecretFinding): void {
  const key = `${finding.filePath}:${finding.line}:${finding.kind}:${finding.redacted}:${finding.evidence}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  findings.push(finding);
}

function isPlaceholderSecretValue(value: string): boolean {
  const normalized = value.trim().replace(/^["'`]|["'`]$/g, "");
  if (normalized.length < 8) {
    return true;
  }
  const lower = normalized.toLowerCase();
  if (["string", "number", "boolean", "unknown", "object", "undefined", "function"].includes(lower)) {
    return true;
  }
  if (
    lower.includes("example") ||
    lower.includes("sample") ||
    lower.includes("placeholder") ||
    lower.includes("dummy") ||
    lower.includes("minimum") ||
    (lower.includes("min-") && lower.includes("char")) ||
    lower.includes("changeme") ||
    lower.includes("replace") ||
    lower.includes("redacted") ||
    lower.includes("your_") ||
    lower.includes("your-") ||
    lower.includes("todo") ||
    lower.includes("fake") ||
    lower.includes("${") ||
    lower.includes("process.env") ||
    lower.includes("import.meta.env") ||
    lower.includes("deno.env") ||
    lower.startsWith("env.") ||
    lower.startsWith("config.") ||
    lower.startsWith("settings.") ||
    lower.includes("\\(") ||
    lower.includes("<") ||
    lower.includes(">") ||
    lower.includes("...") ||
    lower.includes("***")
  ) {
    return true;
  }
  if (/^x{6,}$/i.test(normalized) || /^\*{6,}$/.test(normalized)) {
    return true;
  }
  if (/^__.*__$/.test(normalized)) {
    return true;
  }
  if (/^[A-Z][A-Z0-9_]{7,}$/.test(normalized) && !/^(?:AKIA|ASIA)[A-Z0-9]{16}$/.test(normalized)) {
    return true;
  }
  return false;
}

function isSensitiveAssignmentKey(key: string): boolean {
  const parts = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const partSet = new Set(parts);
  if (partSet.has("password") || partSet.has("passwd") || partSet.has("pwd") || partSet.has("credential") || partSet.has("credentials")) {
    return true;
  }
  if (partSet.has("secret") || (partSet.has("client") && partSet.has("secret"))) {
    return true;
  }
  if ((partSet.has("api") && partSet.has("key")) || (partSet.has("access") && partSet.has("key"))) {
    return true;
  }
  if (!partSet.has("token")) {
    return false;
  }
  if (parts.length === 1) {
    return true;
  }
  return ["auth", "access", "refresh", "session", "bearer", "api", "github", "gitlab", "slack", "stripe", "openai", "jwt"].some((part) => partSet.has(part));
}

function looksLikeCodeExpression(value: string): boolean {
  return /[()[\]{}!?]/.test(value) || /^[A-Za-z_$][A-Za-z0-9_$]*(?:[.][A-Za-z_$][A-Za-z0-9_$]*)*$/.test(value);
}

function isPlaceholderReference(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes("your_") || lower.includes("your-") || lower.includes("placeholder") || lower.includes("example");
}

function isSensitiveReferenceLine(value: string): boolean {
  const lower = value.toLowerCase();
  if (/\b(?:api[_-]?key|password|passwd|credential|credentials|client[_-]?secret|access[_-]?key)\b/i.test(value)) {
    return true;
  }
  if (/\bsecret\b/i.test(value) && /\b(?:env|config|credential|key|token|password|value|var|variable|process)\b/i.test(value)) {
    return true;
  }
  if (/\b(?:auth|access|refresh|session|bearer|github|gitlab|slack|stripe|openai|gh)[_-]?token\b/i.test(value)) {
    return true;
  }
  return lower.includes("github.token") || lower.includes("process.env") || lower.includes("import.meta.env");
}

function isTestLikePath(filePath: string): boolean {
  const segments = filePath.split("/");
  return (
    segments.some((segment) => /^(?:test|tests|spec|specs|fixture|fixtures|__tests__|mocks|__mocks__)$/i.test(segment) || /(?:test|tests|spec|specs|fixture|fixtures|mock|mocks)$/i.test(segment)) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(filePath)
  );
}

function redactLine(text: string, value: string): string {
  const redacted = redactSecret(value);
  return clipEvidence(text.split(value).join(redacted));
}

function redactSecret(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return "[redacted]";
  }
  const prefix = trimmed.slice(0, Math.min(4, Math.floor(trimmed.length / 3)));
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

function clipEvidence(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function secretConfidenceRank(confidence: SecretConfidence): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function secretSeverityRank(severity: "low" | "medium" | "high"): number {
  return severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function communityEdgeWeight(type: string, weight: number): number {
  const multiplier: Record<string, number> = {
    HTTP_CALLS: 2.4,
    CALLS_LOCAL: 2,
    CALLS: 1.6,
    INHERITS: 1.55,
    IMPLEMENTS: 1.45,
    USES_TYPE: 1.2,
    IMPORTS: 1.1,
    DEFINES: 0.9,
    DECLARES: 0.8,
    SIMILAR_TO: 0.65,
    SEMANTICALLY_RELATED: 0.55
  };
  return Math.max(0.1, weight) * (multiplier[type] ?? 1);
}

function addWeightedNeighbor(graph: Map<string, Map<string, number>>, source: string, target: string, weight: number): void {
  const neighbors = graph.get(source) ?? new Map<string, number>();
  neighbors.set(target, (neighbors.get(target) ?? 0) + weight);
  graph.set(source, neighbors);
}

function splitLargeCommunity(members: string[], symbols: Map<string, SymbolNode>): Array<[string, string[]]> {
  if (members.length <= 500) {
    return [["all", members]];
  }
  const byCluster = new Map<string, string[]>();
  for (const member of members) {
    const symbol = symbols.get(member);
    const key = symbol ? clusterName(symbol.filePath) : "unknown";
    const group = byCluster.get(key) ?? [];
    group.push(member);
    byCluster.set(key, group);
  }
  return [...byCluster.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function communityFromMembers(
  label: string,
  members: string[],
  symbols: Map<string, SymbolNode>,
  edges: Array<{ source: string; target: string; type: string; weight: number }>,
  degree: Map<string, number>
): GraphCommunity {
  const memberSet = new Set(members);
  const memberSymbols = members.map((member) => symbols.get(member)).filter((symbol): symbol is SymbolNode => Boolean(symbol));
  const codeSymbols = memberSymbols.filter((symbol) => symbol.kind !== "file");
  const files = [...new Set(memberSymbols.map((symbol) => symbol.filePath))].sort();
  const languages = new Map<Language, number>();
  for (const symbol of codeSymbols.length > 0 ? codeSymbols : memberSymbols) {
    languages.set(symbol.language, (languages.get(symbol.language) ?? 0) + 1);
  }

  let internalEdges = 0;
  let externalEdges = 0;
  const edgeTypes = new Map<string, number>();
  for (const edge of edges) {
    const sourceInside = memberSet.has(edge.source);
    const targetInside = memberSet.has(edge.target);
    if (sourceInside && targetInside) {
      internalEdges += 1;
      edgeTypes.set(edge.type, (edgeTypes.get(edge.type) ?? 0) + 1);
    } else if (sourceInside || targetInside) {
      externalEdges += 1;
    }
  }

  const representativeSymbols = (codeSymbols.length > 0 ? codeSymbols : memberSymbols)
    .map((symbol) => ({
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      kind: symbol.kind,
      filePath: symbol.filePath,
      degree: degree.get(symbol.qualifiedName) ?? 0
    }))
    .sort((a, b) => b.degree - a.degree || a.filePath.localeCompare(b.filePath) || a.name.localeCompare(b.name))
    .slice(0, 8);
  const labelSource = representativeSymbols[0]?.name ?? symbols.get(label)?.name ?? label.split(":").pop() ?? "community";
  const strongestEdgeTypes = [...edgeTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const cohesion = Number((internalEdges / Math.max(1, internalEdges + externalEdges)).toFixed(4));

  return {
    id: stableCommunityId(label, members),
    label: labelSource,
    members: memberSymbols.length,
    files: files.slice(0, 12),
    languages: [...languages.entries()]
      .map(([language, symbols]) => ({ language, symbols }))
      .sort((a, b) => b.symbols - a.symbols || a.language.localeCompare(b.language)),
    representativeSymbols,
    internalEdges,
    externalEdges,
    cohesion,
    reasons: [
      `${internalEdges} internal edges`,
      `${externalEdges} boundary edges`,
      ...(strongestEdgeTypes.length ? [`dominant relationships ${strongestEdgeTypes.map(([type, count]) => `${type}:${count}`).join(", ")}`] : [])
    ]
  };
}

function stableCommunityId(label: string, members: string[]): string {
  let hash = 0;
  for (const char of [label, ...members.slice(0, 20)].join("|")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `community-${hash.toString(16).padStart(8, "0")}`;
}

function parseGraphQuery(query: string, defaultLimit: number): ParsedGraphQuery {
  const trimmed = query.trim().replace(/;+\s*$/, "");
  if (!trimmed) {
    throw new Error("query_graph requires a query");
  }
  if (/\b(CREATE|MERGE|DELETE|SET|REMOVE|DROP|INSERT|UPDATE|ALTER|PRAGMA|ATTACH|DETACH)\b/i.test(stripQuotedStrings(trimmed))) {
    throw new Error("query_graph is read-only; mutation keywords are not supported");
  }

  const limitMatch = /\s+LIMIT\s+(\d+)\s*$/i.exec(trimmed);
  const limit = limitMatch ? clampPositive(Number(limitMatch[1]), 1, 500) : defaultLimit;
  const withoutLimit = limitMatch ? trimmed.slice(0, limitMatch.index).trim() : trimmed;
  const skipMatch = /\s+SKIP\s+(\d+)\s*$/i.exec(withoutLimit);
  const skip = skipMatch ? Math.max(0, Number(skipMatch[1])) : 0;
  const withoutSkip = skipMatch ? withoutLimit.slice(0, skipMatch.index).trim() : withoutLimit;
  const orderMatch = /\s+ORDER\s+BY\s+(.+)$/i.exec(withoutSkip);
  const orderBy = orderMatch ? parseOrderBy(orderMatch[1].trim()) : [];
  const withoutOrder = orderMatch ? withoutSkip.slice(0, orderMatch.index).trim() : withoutSkip;
  const match = /^MATCH\s+(.+?)\s+(?:WHERE\s+(.+?)\s+)?RETURN\s+(.+)$/i.exec(withoutOrder);
  if (!match) {
    throw new Error("Supported query shape: MATCH (...) [WHERE alias.property OP 'value'] RETURN [DISTINCT] alias.property[, ...] [ORDER BY alias.property] [SKIP n] [LIMIT n]");
  }

  const parsedReturn = parseReturn(match[3].trim());
  return {
    pattern: parseMatchPattern(match[1].trim()),
    where: parseWhere(match[2]?.trim()),
    returns: parsedReturn.returns,
    orderBy,
    limit,
    skip,
    distinct: parsedReturn.distinct
  };
}

function parseMatchPattern(pattern: string): ParsedGraphQuery["pattern"] {
  const node = /^\((\w+)(?::([A-Za-z_][\w-]*))?\)$/.exec(pattern);
  if (node) {
    return { kind: "node", alias: node[1], label: node[2] };
  }

  const outbound = /^\((\w+)(?::([A-Za-z_][\w-]*))?\)\s*-\s*\[(?:(\w+))?(?::([A-Za-z_][\w-]*))?\]\s*->\s*\((\w+)(?::([A-Za-z_][\w-]*))?\)$/.exec(pattern);
  if (outbound) {
    return {
      kind: "edge",
      leftAlias: outbound[1],
      leftLabel: outbound[2],
      edgeAlias: outbound[3] || "e",
      edgeType: outbound[4],
      rightAlias: outbound[5],
      rightLabel: outbound[6],
      direction: "outbound"
    };
  }

  const inbound = /^\((\w+)(?::([A-Za-z_][\w-]*))?\)\s*<-\s*\[(?:(\w+))?(?::([A-Za-z_][\w-]*))?\]\s*-\s*\((\w+)(?::([A-Za-z_][\w-]*))?\)$/.exec(pattern);
  if (inbound) {
    return {
      kind: "edge",
      leftAlias: inbound[1],
      leftLabel: inbound[2],
      edgeAlias: inbound[3] || "e",
      edgeType: inbound[4],
      rightAlias: inbound[5],
      rightLabel: inbound[6],
      direction: "inbound"
    };
  }

  throw new Error("Supported MATCH patterns: (n), (a)-[:TYPE]->(b), or (a)<-[:TYPE]-(b)");
}

function parseWhere(where: string | undefined): GraphWhereCondition[] {
  if (!where) {
    return [];
  }
  return where.split(/\s+AND\s+/i).map((part) => {
    const match = /^(\w+)\.([A-Za-z_]\w*)\s*(=|<>|CONTAINS|STARTS WITH|ENDS WITH)\s*(?:'([^']*)'|"([^"]*)"|([^\s]+))$/i.exec(part.trim());
    if (!match) {
      throw new Error(`Unsupported WHERE condition: ${part}`);
    }
    return {
      alias: match[1],
      property: match[2],
      operator: match[3].toUpperCase() as GraphWhereCondition["operator"],
      value: match[4] ?? match[5] ?? match[6] ?? ""
    };
  });
}

function parseReturn(returnText: string): { returns: GraphReturnExpression[]; distinct: boolean } {
  let text = returnText.trim();
  let distinct = false;
  if (/^DISTINCT\s+/i.test(text)) {
    distinct = true;
    text = text.replace(/^DISTINCT\s+/i, "");
  }
  const expressions = text.split(",").map((part) => {
    const countMatch = /^count\(\s*(?:(DISTINCT)\s+)?(?:(\w+)(?:\.([A-Za-z_]\w*))?|\*)\s*\)(?:\s+AS\s+([A-Za-z_]\w*))?$/i.exec(part.trim());
    if (countMatch) {
      return {
        alias: countMatch[2] ?? "*",
        property: countMatch[3] ?? "qualifiedName",
        output: countMatch[4] ?? "count",
        aggregate: "count" as const,
        distinct: Boolean(countMatch[1])
      };
    }
    const match = /^(\w+)(?:\.([A-Za-z_]\w*))?(?:\s+AS\s+([A-Za-z_]\w*))?$/i.exec(part.trim());
    if (!match) {
      throw new Error(`Unsupported RETURN expression: ${part}`);
    }
    const property = match[2] ?? "qualifiedName";
    return {
      alias: match[1],
      property,
      output: match[3] ?? `${match[1]}.${property}`
    };
  });
  if (expressions.length === 0) {
    throw new Error("RETURN must include at least one expression");
  }
  if (expressions.some((expr) => expr.aggregate) && expressions.some((expr) => !expr.aggregate)) {
    throw new Error("Aggregate RETURN expressions cannot be mixed with property expressions");
  }
  return { returns: expressions, distinct };
}

function parseOrderBy(orderText: string): GraphOrderExpression[] {
  return orderText.split(",").map((part) => {
    const match = /^(\w+)\.([A-Za-z_]\w*)(?:\s+(ASC|DESC))?$/i.exec(part.trim());
    if (!match) {
      throw new Error(`Unsupported ORDER BY expression: ${part}`);
    }
    return {
      alias: match[1],
      property: match[2],
      direction: (match[3]?.toUpperCase() as "ASC" | "DESC" | undefined) ?? "ASC"
    };
  });
}

function whereSql(condition: GraphWhereCondition, aliasMap: Map<string, string>, params: Array<string | number>): string {
  const column = propertySql(condition.alias, condition.property, aliasMap);
  switch (condition.operator) {
    case "=":
      params.push(condition.value);
      return `lower(CAST(${column} AS TEXT)) = lower(?)`;
    case "<>":
      params.push(condition.value);
      return `lower(CAST(${column} AS TEXT)) <> lower(?)`;
    case "CONTAINS":
      params.push(`%${condition.value.toLowerCase()}%`);
      return `lower(CAST(${column} AS TEXT)) LIKE ?`;
    case "STARTS WITH":
      params.push(`${condition.value.toLowerCase()}%`);
      return `lower(CAST(${column} AS TEXT)) LIKE ?`;
    case "ENDS WITH":
      params.push(`%${condition.value.toLowerCase()}`);
      return `lower(CAST(${column} AS TEXT)) LIKE ?`;
  }
}

function returnSql(expression: GraphReturnExpression, aliasMap: Map<string, string>): string {
  if (expression.aggregate === "count") {
    if (expression.alias === "*") {
      return "count(*)";
    }
    const column = propertySql(expression.alias, expression.property, aliasMap);
    return expression.distinct ? `count(DISTINCT ${column})` : `count(${column})`;
  }
  return propertySql(expression.alias, expression.property, aliasMap);
}

function propertySql(alias: string, property: string, aliasMap: Map<string, string>): string {
  const table = aliasMap.get(alias);
  if (!table) {
    throw new Error(`Unknown query alias '${alias}'`);
  }
  const normalized = normalizeGraphProperty(property);
  if (table === "edges") {
    const edgeColumns: Record<string, string> = {
      type: "type",
      source: "source",
      target: "target",
      weight: "weight"
    };
    const column = edgeColumns[normalized];
    if (!column) {
      throw new Error(`Unsupported edge property '${property}'`);
    }
    return `${table}.${column}`;
  }
  const symbolColumns: Record<string, string> = {
    id: "id",
    name: "name",
    kind: "kind",
    label: "kind",
    language: "language",
    filepath: "file_path",
    file: "file_path",
    qualifiedname: "qualified_name",
    qualified: "qualified_name",
    startline: "start_line",
    endline: "end_line",
    signature: "signature",
    exported: "exported"
  };
  const column = symbolColumns[normalized];
  if (!column) {
    throw new Error(`Unsupported symbol property '${property}'`);
  }
  return `${table}.${column}`;
}

function normalizeGraphProperty(property: string): string {
  return property.replace(/_/g, "").toLowerCase();
}

function normalizeGraphLabel(label: string): string {
  return label.replace(/Node$/i, "").toLowerCase();
}

function stripQuotedStrings(value: string): string {
  return value.replace(/'[^']*'|"[^"]*"/g, "''");
}

function stronglyConnectedComponents(graph: Map<string, Set<string>>): string[][] {
  let nextIndex = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexByNode = new Map<string, number>();
  const lowByNode = new Map<string, number>();
  const components: string[][] = [];

  function visit(node: string): void {
    indexByNode.set(node, nextIndex);
    lowByNode.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indexByNode.has(target)) {
        visit(target);
        lowByNode.set(node, Math.min(lowByNode.get(node) ?? 0, lowByNode.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowByNode.set(node, Math.min(lowByNode.get(node) ?? 0, indexByNode.get(target) ?? 0));
      }
    }

    if (lowByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      onStack.delete(current);
      component.push(current);
      if (current === node) break;
    }
    components.push(component);
  }

  for (const node of graph.keys()) {
    if (!indexByNode.has(node)) {
      visit(node);
    }
  }

  return components;
}

function architectureRecommendations(input: {
  dependencyCycles: DependencyCycle[];
  hotspots: Array<{ path: string; score: number; reasons: string[] }>;
  gitHistory: GitHistoryFile[];
  deadCode: DeadCodeCandidate[];
  skippedFiles: number;
  taskCount: number;
  secretHints: number;
}): ArchitectureRecommendation[] {
  const recommendations: ArchitectureRecommendation[] = [];
  const topCycle = input.dependencyCycles[0];
  if (topCycle) {
    recommendations.push({
      priority: "high",
      title: "Break cross-module dependency cycles",
      detail: "Cyclic clusters make change impact harder to reason about. Start with the largest cycle and move shared contracts or adapter code behind one-directional boundaries.",
      evidence: [`${topCycle.clusters.join(" -> ")} (${topCycle.edges} cross-cluster edges)`, ...topCycle.sampleEdges.slice(0, 3).map((edge) => `${edge.source} -> ${edge.target} (${edge.type})`)]
    });
  }

  const hotspot = input.hotspots[0];
  if (hotspot && hotspot.score >= 20) {
    recommendations.push({
      priority: "medium",
      title: "Review the densest hotspot",
      detail: "High symbol density or file size often means several responsibilities are sharing one file. Split only when the surrounding call graph shows separable behavior.",
      evidence: [`${hotspot.path} scored ${hotspot.score.toFixed(1)}`, ...hotspot.reasons]
    });
  }

  const historyHotspot = input.gitHistory[0];
  if (historyHotspot && (historyHotspot.commits > 1 || historyHotspot.churn >= 100)) {
    const latest = historyHotspot.lastSubject ? [`latest change: ${historyHotspot.lastSubject}`] : [];
    recommendations.push({
      priority: "medium",
      title: "Inspect high-churn files before risky edits",
      detail: "Files with repeated churn often contain unsettled behavior or shared responsibilities. Review the change history alongside static graph edges before refactoring them.",
      evidence: [
        `${historyHotspot.path}: ${historyHotspot.commits} commits, ${historyHotspot.churn} changed lines`,
        ...latest
      ]
    });
  }

  if (input.deadCode.length > 0) {
    recommendations.push({
      priority: "low",
      title: "Confirm private dead-code candidates",
      detail: "These functions have no inbound call edges in the static graph. Verify dynamic entrypoints before deleting them.",
      evidence: input.deadCode.slice(0, 3).map((item) => `${item.symbol.name} in ${item.symbol.filePath}:${item.symbol.startLine}`)
    });
  }

  if (input.secretHints > 0) {
    recommendations.push({
      priority: "medium",
      title: "Audit sensitive configuration references",
      detail: "Sensitive-key-like strings are review hints, not confirmed leaks. Check whether these are examples, environment variable names, or real values.",
      evidence: [`${input.secretHints} sensitive-key-like text matches`]
    });
  }

  if (input.taskCount > 0 || input.skippedFiles > 0) {
    recommendations.push({
      priority: "low",
      title: "Triage indexing and maintenance notes",
      detail: "Task markers and skipped files reduce confidence in automated architecture summaries. Review the highest-value ones before using the graph for risky changes.",
      evidence: [`${input.taskCount} task markers`, `${input.skippedFiles} skipped files`]
    });
  }

  return recommendations.slice(0, 8);
}

function dependencyCyclesFromGraph(
  graph: Map<string, Set<string>>,
  edges: Map<string, { source: string; target: string; count: number; sampleEdges: Array<{ source: string; target: string; type: string }> }>,
  limit: number
): DependencyCycle[] {
  return stronglyConnectedComponents(graph)
    .filter((component) => component.length > 1)
    .map((component) => {
      const members = new Set(component);
      let count = 0;
      const samples: Array<{ source: string; target: string; type: string }> = [];
      for (const edge of edges.values()) {
        if (!members.has(edge.source) || !members.has(edge.target)) {
          continue;
        }
        count += edge.count;
        for (const sample of edge.sampleEdges) {
          if (samples.length < 8) samples.push(sample);
        }
      }
      const clusters = [...component].sort();
      return {
        clusters,
        edges: count,
        sampleEdges: samples,
        recommendation: `Break the ${clusters.join(" <-> ")} cycle by moving shared contracts into a lower-level module or routing calls through one directional adapter.`
      };
    })
    .sort((a, b) => b.edges - a.edges)
    .slice(0, clampPositive(limit, 1, 100));
}

function gitHistoryHotspots(root: string, limit: number): GitHistoryFile[] {
  const result = spawnSync(
    "git",
    [
      "-C",
      root,
      "log",
      "--max-count=200",
      "--date=short",
      "--pretty=format:--REPOLENS-COMMIT--%x09%H%x09%ad%x09%an%x09%s",
      "--numstat"
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  const byPath = new Map<
    string,
    GitHistoryFile & {
      authorSet: Set<string>;
      seenCommits: Set<string>;
    }
  >();
  let current: { hash: string; date: string; author: string; subject: string } | null = null;
  const normalizePath = (value: string) => value.replace(/^"|"$/g, "").replace(/\\/g, "/");

  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    if (line.startsWith("--REPOLENS-COMMIT--\t")) {
      const [, hash = "", date = "", author = "", subject = ""] = line.split("\t");
      current = { hash, date, author, subject };
      continue;
    }
    if (!current) {
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 3 || parts[0] === "-" || parts[1] === "-") {
      continue;
    }
    const additions = Number(parts[0]);
    const deletions = Number(parts[1]);
    if (!Number.isFinite(additions) || !Number.isFinite(deletions)) {
      continue;
    }
    const filePath = normalizePath(parts.slice(2).join("\t"));
    if (!filePath || isDependencyMetadataFile(filePath)) {
      continue;
    }
    const item =
      byPath.get(filePath) ??
      {
        path: filePath,
        commits: 0,
        churn: 0,
        additions: 0,
        deletions: 0,
        authors: 0,
        authorSet: new Set<string>(),
        seenCommits: new Set<string>()
      };
    item.additions += additions;
    item.deletions += deletions;
    item.churn += additions + deletions;
    item.authorSet.add(current.author);
    if (!item.seenCommits.has(current.hash)) {
      item.seenCommits.add(current.hash);
      item.commits += 1;
    }
    item.lastCommit ??= current.hash.slice(0, 12);
    item.lastDate ??= current.date;
    item.lastAuthor ??= current.author;
    item.lastSubject ??= current.subject;
    item.authors = item.authorSet.size;
    byPath.set(filePath, item);
  }

  return [...byPath.values()]
    .map(({ authorSet: _authorSet, seenCommits: _seenCommits, ...item }) => item)
    .sort((a, b) => b.churn - a.churn || b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, clampPositive(limit, 1, 100));
}

function resolveImportFile(sourceFile: string, specifier: string, filePaths: Set<string>, packageRoots: Array<[string, string]> = []): string | null {
  if (specifier.startsWith(".")) {
    return resolveCandidate(path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier)), filePaths);
  }

  for (const [packageName, packageRoot] of packageRoots) {
    if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) {
      continue;
    }
    const subpath = specifier.slice(packageName.length).replace(/^\//, "");
    const base = subpath ? path.posix.join(packageRoot, subpath) : path.posix.join(packageRoot, "src", "index");
    const resolved = resolveCandidate(base, filePaths);
    if (resolved) {
      return resolved;
    }
  }

  if (specifier.startsWith("src/") || specifier.startsWith("apps/") || specifier.startsWith("packages/")) {
    return resolveCandidate(path.posix.normalize(specifier), filePaths);
  }

  return null;
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

  for (const candidate of candidates) {
    if (filePaths.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(tsx?|jsx?|mjs|cjs|swift|py|go|java|rs|sql|json|ya?ml|md|sh)$/i, "");
}

function parseFileLine(identifier: string): { filePath: string; line: number } | null {
  const match = /^(.*):(\d+)$/.exec(identifier);
  if (!match) {
    return null;
  }
  return { filePath: match[1], line: Number(match[2]) };
}

function clusterName(filePath: string): string {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return ".";
  }
  if ((parts[0] === "apps" || parts[0] === "packages" || parts[0] === "services") && parts[1]) {
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts[0] === "src" && parts[1]) {
    return `src/${parts[1]}`;
  }
  return parts[0];
}

function isDependencyMetadataFile(filePath: string): boolean {
  const base = path.posix.basename(filePath).toLowerCase();
  return dependencyMetadataFiles.has(base);
}

const dependencyMetadataFiles = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-lock.yml",
  "yarn.lock",
  "composer.lock",
  "cargo.lock",
  "poetry.lock",
  "go.sum",
  "gemfile.lock"
]);

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildCodeSearchText(text: string): string {
  const terms = codeSearchTerms(text);
  if (terms.length === 0) {
    return text;
  }
  return `${text}\n${terms.join(" ")}`;
}

function buildFtsQuery(query: string): string | null {
  const terms = codeSearchTerms(query).filter((term) => term.length > 1).slice(0, 12);
  if (terms.length === 0) {
    return null;
  }
  return terms.map((term) => `${term}*`).join(" OR ");
}

function codeSearchTerms(value: string): string[] {
  const terms = new Set<string>();
  for (const segment of value.split(/[^A-Za-z0-9_]+/)) {
    addSearchTermSegment(segment, terms);
  }
  return [...terms];
}

function identifierMatcher(identifier: string): (line: string) => boolean {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(identifier)) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escapeRegExp(identifier)}([^A-Za-z0-9_$]|$)`);
    return (line) => pattern.test(line);
  }
  const lowered = identifier.toLowerCase();
  return (line) => line.toLowerCase().includes(lowered);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function addSearchTermSegment(segment: string, terms: Set<string>): void {
  const normalized = segment.trim();
  if (!normalized) {
    return;
  }
  const add = (term: string) => {
    const cleaned = term.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleaned.length > 0 && cleaned.length <= 80) {
      terms.add(cleaned);
    }
  };

  add(normalized);
  for (const part of normalized.split(/_+/)) {
    add(part);
  }
  const camelSplit = normalized.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  for (const part of camelSplit.split(/\s+/)) {
    add(part);
  }
}
