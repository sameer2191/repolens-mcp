import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  ArchitectureSummary,
  ChangeImpactResult,
  CodeMatch,
  DeadCodeCandidate,
  DecisionRecord,
  Edge,
  GraphSchema,
  GraphSearchMatch,
  GraphSearchOptions,
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
    const deadCode = this.findDeadCode(5);

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
    if (deadCode.length > 0) risks.push(`${deadCode.length} dead-code candidates sampled`);

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
      hotspots,
      boundaries: boundaryData.boundaries,
      clusters: boundaryData.clusters,
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
  return path.join(root, ".repolens", "memory.db");
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

function clampPositive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
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
