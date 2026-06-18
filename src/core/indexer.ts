import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { addCallEdges, extractFromFile } from "./extractor.js";
import { sha256 } from "./hash.js";
import { shouldIgnoreDirectory, shouldIgnoreFile } from "./ignore.js";
import { detectLanguage, isTextCandidate, normalizeSlashes } from "./language.js";
import { buildSemanticEdges } from "./semantic.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { IndexedFile, IndexOptions, IndexResult, SymbolNode } from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 750_000;

interface WalkedFile {
  absolutePath: string;
  relativePath: string;
  bytes: number;
}

export async function indexRepository(options: IndexOptions): Promise<IndexResult> {
  const started = performance.now();
  const root = path.resolve(options.root);
  const dbPath = path.resolve(options.dbPath ?? process.env.REPOLENS_DB ?? defaultDbPath(root));
  const incremental = options.incremental ?? false;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const indexedAt = new Date().toISOString();
  const store = new MemoryStore(dbPath);
  const fileContents = new Map<string, string>();
  const allSymbols: SymbolNode[] = [];
  let lockAcquired = false;

  try {
    store.acquireLock("index");
    lockAcquired = true;
    const walked = await walk(root, root, options.includeHidden ?? false);
    const walkedPaths = new Set(walked.map((file) => file.relativePath));
    const previousFiles = incremental ? new Map(store.listFiles().map((file) => [file.path, file])) : new Map<string, IndexedFile>();
    let filesRemoved = 0;
    let graphNeedsRebuild = !incremental;

    store.transaction(() => {
      if (incremental) {
        for (const previous of previousFiles.keys()) {
          if (!walkedPaths.has(previous)) {
            store.deleteFile(previous);
            filesRemoved += 1;
          }
        }
      } else {
        store.resetRepository(root);
      }
      store.recordRun(root, options.runLabel ?? null, indexedAt);
    });
    if (filesRemoved > 0) {
      graphNeedsRebuild = true;
    }

    let filesIndexed = 0;
    let filesSkipped = 0;
    let filesUnchanged = 0;

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
      const previous = previousFiles.get(file.relativePath);

      if (!isTextCandidate(file.relativePath)) {
        filesSkipped += 1;
        const skipped = { ...baseRecord, skipped: true, skipReason: "unsupported or binary extension" };
        if (isSameSkippedFile(previous, skipped)) {
          filesUnchanged += 1;
        } else {
          graphNeedsRebuild = true;
          store.transaction(() => {
            if (incremental) store.deleteFile(file.relativePath);
            store.insertFile(skipped);
          });
        }
        continue;
      }
      if (file.bytes > maxFileBytes) {
        filesSkipped += 1;
        const skipped = { ...baseRecord, skipped: true, skipReason: `larger than maxFileBytes ${maxFileBytes}` };
        if (isSameSkippedFile(previous, skipped)) {
          filesUnchanged += 1;
        } else {
          graphNeedsRebuild = true;
          store.transaction(() => {
            if (incremental) store.deleteFile(file.relativePath);
            store.insertFile(skipped);
          });
        }
        continue;
      }

      const content = await fs.readFile(file.absolutePath, "utf8").catch(() => null);
      if (content === null || content.includes("\u0000")) {
        filesSkipped += 1;
        const skipped = { ...baseRecord, skipped: true, skipReason: "not valid utf8 text" };
        if (isSameSkippedFile(previous, skipped)) {
          filesUnchanged += 1;
        } else {
          graphNeedsRebuild = true;
          store.transaction(() => {
            if (incremental) store.deleteFile(file.relativePath);
            store.insertFile(skipped);
          });
        }
        continue;
      }

      const lines = content.split(/\r?\n/);
      const record = {
        ...baseRecord,
        lines: lines.length,
        sha256: sha256(content)
      };
      fileContents.set(file.relativePath, content);
      filesIndexed += 1;

      if (incremental && previous && !previous.skipped && previous.sha256 === record.sha256) {
        filesUnchanged += 1;
        allSymbols.push(...store.symbolsForFile(file.relativePath));
        continue;
      }

      const extracted = extractFromFile(file.relativePath, language, content);
      allSymbols.push(...extracted.symbols);
      graphNeedsRebuild = true;

      store.transaction(() => {
        if (incremental) store.deleteFile(file.relativePath);
        store.insertFile(record);
        store.insertCodeLines(file.relativePath, lines);
        for (const symbol of extracted.symbols) store.insertSymbol(symbol);
        for (const edge of extracted.edges) store.insertEdge(edge);
      });
    }

    if (graphNeedsRebuild) {
      const callEdges = addCallEdges(allSymbols, fileContents);
      const semanticEdges = buildSemanticEdges(allSymbols, fileContents);
      store.transaction(() => {
        store.deleteDerivedEdges();
        for (const edge of callEdges) store.insertEdge(edge);
        for (const edge of semanticEdges) store.insertEdge(edge);
      });
    }
    const counts = store.counts();

    return {
      root,
      dbPath,
      indexedAt,
      mode: incremental ? "incremental" : "full",
      filesDiscovered: walked.length,
      filesIndexed,
      filesSkipped,
      filesUnchanged,
      filesRemoved,
      symbols: counts.symbols,
      edges: counts.edges,
      elapsedMs: Math.round(performance.now() - started)
    };
  } finally {
    if (lockAcquired) {
      store.releaseLock("index");
    }
    store.close();
  }
}

function isSameSkippedFile(previous: IndexedFile | undefined, next: IndexedFile): boolean {
  return Boolean(
    previous?.skipped &&
      previous.language === next.language &&
      previous.bytes === next.bytes &&
      previous.skipReason === next.skipReason
  );
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
