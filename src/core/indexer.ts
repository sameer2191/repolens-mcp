import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { addCallEdges, extractFromFile } from "./extractor.js";
import { sha256 } from "./hash.js";
import { shouldIgnoreDirectory, shouldIgnoreFile } from "./ignore.js";
import { detectLanguage, isTextCandidate, normalizeSlashes } from "./language.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { Edge, IndexedFile, IndexOptions, IndexResult, SymbolNode } from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 750_000;

interface WalkedFile {
  absolutePath: string;
  relativePath: string;
  bytes: number;
}

export async function indexRepository(options: IndexOptions): Promise<IndexResult> {
  const started = performance.now();
  const root = path.resolve(options.root);
  const dbPath = path.resolve(options.dbPath ?? process.env.CODEBASE_MEMORY_DB ?? defaultDbPath(root));
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const indexedAt = new Date().toISOString();
  const store = new MemoryStore(dbPath);
  const fileContents = new Map<string, string>();
  const allSymbols: SymbolNode[] = [];
  const allEdges: Edge[] = [];

  try {
    const walked = await walk(root, root, options.includeHidden ?? false);
    store.transaction(() => {
      store.resetRepository(root);
      store.recordRun(root, options.runLabel ?? null, indexedAt);
    });

    let filesIndexed = 0;
    let filesSkipped = 0;

    for (const file of walked) {
      const language = detectLanguage(file.relativePath);
      const baseRecord: IndexedFile = {
        path: file.relativePath,
        language,
        bytes: file.bytes,
        lines: 0,
        sha256: "",
        indexedAt
      };

      if (!isTextCandidate(file.relativePath)) {
        filesSkipped += 1;
        store.insertFile({ ...baseRecord, skipped: true, skipReason: "unsupported or binary extension" });
        continue;
      }
      if (file.bytes > maxFileBytes) {
        filesSkipped += 1;
        store.insertFile({ ...baseRecord, skipped: true, skipReason: `larger than maxFileBytes ${maxFileBytes}` });
        continue;
      }

      const content = await fs.readFile(file.absolutePath, "utf8").catch(() => null);
      if (content === null || content.includes("\u0000")) {
        filesSkipped += 1;
        store.insertFile({ ...baseRecord, skipped: true, skipReason: "not valid utf8 text" });
        continue;
      }

      const lines = content.split(/\r?\n/);
      const record = {
        ...baseRecord,
        lines: lines.length,
        sha256: sha256(content)
      };
      const extracted = extractFromFile(file.relativePath, language, content);
      allSymbols.push(...extracted.symbols);
      allEdges.push(...extracted.edges);
      fileContents.set(file.relativePath, content);

      store.transaction(() => {
        store.insertFile(record);
        store.insertCodeLines(file.relativePath, lines);
        for (const symbol of extracted.symbols) store.insertSymbol(symbol);
        for (const edge of extracted.edges) store.insertEdge(edge);
      });
      filesIndexed += 1;
    }

    const callEdges = addCallEdges(allSymbols, fileContents);
    store.transaction(() => {
      for (const edge of callEdges) store.insertEdge(edge);
    });
    allEdges.push(...callEdges);

    return {
      root,
      dbPath,
      indexedAt,
      filesDiscovered: walked.length,
      filesIndexed,
      filesSkipped,
      symbols: allSymbols.length,
      edges: allEdges.length,
      elapsedMs: Math.round(performance.now() - started)
    };
  } finally {
    store.close();
  }
}

async function walk(root: string, current: string, includeHidden: boolean): Promise<WalkedFile[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files: WalkedFile[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name, includeHidden)) {
        continue;
      }
      files.push(...(await walk(root, path.join(current, entry.name), includeHidden)));
      continue;
    }
    if (!entry.isFile() || shouldIgnoreFile(entry.name)) {
      continue;
    }
    const absolutePath = path.join(current, entry.name);
    const stats = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      relativePath: normalizeSlashes(path.relative(root, absolutePath)),
      bytes: stats.size
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
