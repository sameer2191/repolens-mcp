import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { exportGraphPackage, importGraphPackage } from "./artifact.js";
import { createDiagnosticsSink, diagnosticErrorPayload } from "./diagnostics.js";
import { addCallEdges, addConfigurationEdges, addDataFlowEdges, addHttpEdges, addTypeRelationEdges, extractFromFile } from "./extractor.js";
import { sha256 } from "./hash.js";
import { buildResolvedImportEdges } from "./import-resolver.js";
import { loadRepoIgnoreMatcher, shouldIgnoreDirectory, shouldIgnoreFile, type RepoIgnoreMatcher } from "./ignore.js";
import { detectLanguage, isTextCandidate, loadLanguageOverrides, normalizeSlashes } from "./language.js";
import { buildSemanticEdges } from "./semantic.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { GraphPackageImportResult, IndexedFile, IndexOptions, IndexResult, SymbolNode } from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 750_000;
const DEFAULT_MAX_FILES = 20_000;
const DEFAULT_MAX_GRAPH_SYMBOLS = 100_000;

interface WalkedFile {
  absolutePath: string;
  relativePath: string;
  bytes: number;
}

export async function indexRepository(options: IndexOptions): Promise<IndexResult> {
  const started = performance.now();
  const root = path.resolve(options.root);
  const dbPath = path.resolve(options.dbPath ?? process.env.REPOLENS_DB ?? defaultDbPath(root));
  const diagnostics = createDiagnosticsSink({ root, diagnosticsPath: options.diagnosticsPath });
  const bootstrapPackage = await bootstrapGraphPackage(root, dbPath, options.bootstrapPackage);
  const incremental = options.incremental ?? false;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const indexedAt = new Date().toISOString();
  const store = new MemoryStore(dbPath);
  const fileContents = new Map<string, string>();
  const allSymbols: SymbolNode[] = [];
  let lockAcquired = false;
  let result: IndexResult | undefined;

  diagnostics.emit("index.start", {
    root,
    dbPath,
    mode: incremental ? "incremental" : "full",
    maxFileBytes,
    maxFiles,
    bootstrapPackage: Boolean(bootstrapPackage),
    writePackage: options.writePackage
  });

  try {
    store.acquireLock("index");
    lockAcquired = true;
    const repoIgnore = await loadRepoIgnoreMatcher(root);
    const languageOverrides = await loadLanguageOverrides(root);
    const walked = await walk(root, root, options.includeHidden ?? false, repoIgnore, maxFiles);
    diagnostics.emit("index.walk", { root, dbPath, filesDiscovered: walked.length });
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
      const language = detectLanguage(file.relativePath, languageOverrides);
      const baseRecord: IndexedFile = {
        path: file.relativePath,
        language,
        bytes: file.bytes,
        lines: 0,
        sha256: "",
        indexedAt
      };
      const previous = previousFiles.get(file.relativePath);

      if (!isTextCandidate(file.relativePath, languageOverrides)) {
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
      assertGraphInputBudget(allSymbols.length);
      const callEdges = addCallEdges(allSymbols, fileContents);
      const dataFlowEdges = addDataFlowEdges(allSymbols, fileContents, callEdges);
      const httpEdges = addHttpEdges(allSymbols, fileContents);
      const typeRelationEdges = addTypeRelationEdges(allSymbols, fileContents);
      const configurationEdges = addConfigurationEdges(allSymbols, fileContents);
      const resolvedImportEdges = buildResolvedImportEdges(allSymbols, fileContents);
      const semanticEdges = buildSemanticEdges(allSymbols, fileContents);
      diagnostics.emit("index.rebuild", {
        root,
        dbPath,
        symbols: allSymbols.length,
        callEdges: callEdges.length,
        dataFlowEdges: dataFlowEdges.length,
        httpEdges: httpEdges.length,
        typeRelationEdges: typeRelationEdges.length,
        configurationEdges: configurationEdges.length,
        resolvedImportEdges: resolvedImportEdges.length,
        semanticEdges: semanticEdges.length
      });
      store.transaction(() => {
        store.deleteDerivedEdges();
        store.deleteConfigurationLinkEdges();
        for (const edge of resolvedImportEdges) store.insertEdge(edge);
        for (const edge of callEdges) store.insertEdge(edge);
        for (const edge of dataFlowEdges) store.insertEdge(edge);
        for (const edge of httpEdges) store.insertEdge(edge);
        for (const edge of typeRelationEdges) store.insertEdge(edge);
        for (const edge of configurationEdges) store.insertEdge(edge);
        for (const edge of semanticEdges) store.insertEdge(edge);
      });
      store.rebuildSymbolVectors();
    }
    const counts = store.counts();

    result = {
      root,
      dbPath,
      indexedAt,
      mode: incremental ? "incremental" : "full",
      ...(bootstrapPackage ? { bootstrapPackage } : {}),
      filesDiscovered: walked.length,
      filesIndexed,
      filesSkipped,
      filesUnchanged,
      filesRemoved,
      symbols: counts.symbols,
      edges: counts.edges,
      elapsedMs: Math.round(performance.now() - started)
    };
    diagnostics.emit("index.finish", { ...result });
  } catch (error) {
    diagnostics.emit("index.error", { root, dbPath, ...diagnosticErrorPayload(error) });
    throw error;
  } finally {
    if (lockAcquired) {
      store.releaseLock("index");
    }
    store.close();
  }

  if (!result) {
    throw new Error("Index did not produce a result.");
  }
  const writePackagePath = graphPackageWritePath(root, options.writePackage);
  if (!writePackagePath) {
    return result;
  }
  diagnostics.emit("index.package.start", { root, dbPath, outPath: writePackagePath });
  const graphPackage = await exportGraphPackage({ dbPath, outPath: writePackagePath, label: options.runLabel });
  diagnostics.emit("index.package.finish", { root, dbPath, outPath: writePackagePath, packageBytes: graphPackage.packageBytes, sqliteBytes: graphPackage.sqliteBytes });
  return { ...result, graphPackage };
}

async function bootstrapGraphPackage(
  root: string,
  dbPath: string,
  configuredPackage: string | false | undefined
): Promise<GraphPackageImportResult | undefined> {
  if (configuredPackage === false || (configuredPackage === undefined && isFalseLike(process.env.REPOLENS_BOOTSTRAP_PACKAGE))) {
    return undefined;
  }
  if (await fileExists(dbPath)) {
    return undefined;
  }
  const packagePath = path.resolve(root, configuredPackage ?? process.env.REPOLENS_BOOTSTRAP_PACKAGE ?? ".repolens/graph.rlgz");
  if (!(await fileExists(packagePath))) {
    return undefined;
  }
  return importGraphPackage({ packagePath, dbPath });
}

async function fileExists(filePath: string): Promise<boolean> {
  const stats = await fs.stat(filePath).catch(() => null);
  return Boolean(stats?.isFile());
}

function isFalseLike(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no";
}

function graphPackageWritePath(root: string, configuredPackage: string | false | undefined): string | undefined {
  if (configuredPackage === false || (configuredPackage === undefined && isFalseLike(process.env.REPOLENS_WRITE_PACKAGE))) {
    return undefined;
  }
  const packagePath = configuredPackage ?? process.env.REPOLENS_WRITE_PACKAGE;
  return packagePath ? path.resolve(root, packagePath) : undefined;
}

function isSameSkippedFile(previous: IndexedFile | undefined, next: IndexedFile): boolean {
  return Boolean(
    previous?.skipped &&
      previous.language === next.language &&
      previous.bytes === next.bytes &&
      previous.skipReason === next.skipReason
  );
}

async function walk(root: string, current: string, includeHidden: boolean, repoIgnore: RepoIgnoreMatcher, maxFiles: number, files: WalkedFile[] = []): Promise<WalkedFile[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = normalizeSlashes(path.relative(root, absolutePath));
    if (entry.isDirectory()) {
      if (shouldIgnoreDirectory(entry.name, includeHidden) || repoIgnore.shouldIgnore(relativePath, true)) {
        continue;
      }
      await walk(root, absolutePath, includeHidden, repoIgnore, maxFiles, files);
      continue;
    }
    if (!entry.isFile() || shouldIgnoreFile(entry.name) || repoIgnore.shouldIgnore(relativePath)) {
      continue;
    }
    const stats = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      relativePath,
      bytes: stats.size
    });
    if (files.length > maxFiles) {
      throw new Error(`Index discovered more than maxFiles ${maxFiles} files, which exceeds maxFiles ${maxFiles}. Increase the limit or narrow the repository root.`);
    }
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function assertGraphInputBudget(symbols: number): void {
  if (symbols > DEFAULT_MAX_GRAPH_SYMBOLS) {
    throw new Error(`Index extracted ${symbols} symbols, which exceeds the graph rebuild budget ${DEFAULT_MAX_GRAPH_SYMBOLS}. Narrow the repository root or exclude generated files.`);
  }
}
