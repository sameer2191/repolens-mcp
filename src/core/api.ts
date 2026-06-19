import path from "node:path";
import { exportGraphPackage, importGraphPackage } from "./artifact.js";
import {
  deleteProject as deleteCatalogProject,
  fleetSummary as catalogFleetSummary,
  getProjectStatus as getCatalogProjectStatus,
  listProjects as listCatalogProjects,
  recordProjectIndex
} from "./catalog.js";
import { getRepoLensConfigValue, readRepoLensConfig, resetRepoLensConfigValue, setRepoLensConfigValue } from "./config.js";
import { buildFleetGraph, type FleetGraphOptions } from "./fleet-graph.js";
import { indexRepository } from "./indexer.js";
import { buildArchitectureReport } from "./report.js";
import { buildChangeReviewReport } from "./review.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import { getVersionStatus as readVersionStatus, type VersionStatusOptions } from "./version.js";
import { watchRepository } from "./watcher.js";
import type { ArchitectureReportOptions } from "./report.js";
import type {
  BenchmarkOptions,
  BenchmarkResult,
  ContextPack,
  DecisionRecord,
  GraphSearchOptions,
  IndexOptions,
  RuntimeTrace,
  SecretScanOptions,
  TraceDirection,
  TraceOptions,
  WatchIndexOptions
} from "./types.js";

export async function runIndex(options: IndexOptions) {
  const result = await indexRepository(options);
  await recordProjectIndex(result, options.runLabel);
  return result;
}

export async function getVersionStatus(options: VersionStatusOptions = {}) {
  return readVersionStatus(options);
}

export async function runWatch(options: WatchIndexOptions) {
  const summary = await watchRepository(options);
  const lastRun = summary.runs.at(-1);
  if (lastRun) {
    await recordProjectIndex(lastRun, options.runLabel);
  }
  return summary;
}

export async function benchmarkRepository(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const fullIndex = await runIndex({ ...options, incremental: false });
  const incrementalIndex = await runIndex({ ...options, incremental: true });
  const architecture = getArchitecture(fullIndex.dbPath);
  const secretScanResult =
    options.secretScan === false ? undefined : scanSecrets({ limit: options.secretScanLimit ?? 20, minConfidence: "medium" }, fullIndex.dbPath);

  return {
    root: fullIndex.root,
    dbPath: fullIndex.dbPath,
    generatedAt: new Date().toISOString(),
    fullIndex,
    incrementalIndex,
    throughput: {
      fullFilesPerSecond: rate(fullIndex.filesIndexed, fullIndex.elapsedMs),
      fullSymbolsPerSecond: rate(fullIndex.symbols, fullIndex.elapsedMs),
      incrementalFilesPerSecond: rate(incrementalIndex.filesDiscovered, incrementalIndex.elapsedMs)
    },
    architecture: {
      totals: architecture.totals,
      languages: architecture.languages.slice(0, 12),
      nodeLabels: architecture.nodeLabels.slice(0, 20),
      edgeTypes: architecture.edgeTypes.slice(0, 24),
      entrypoints: architecture.entrypoints,
      risks: architecture.risks
    },
    secretScan: secretScanResult
      ? {
          scannedLines: secretScanResult.scannedLines,
          findings: secretScanResult.totals.findings,
          high: secretScanResult.totals.high,
          medium: secretScanResult.totals.medium,
          low: secretScanResult.totals.low,
          risks: secretScanResult.risks
        }
      : undefined
  };
}

export async function listProjects(limit?: number) {
  return listCatalogProjects(limit);
}

export async function getProjectStatus(identifier?: string) {
  return getCatalogProjectStatus(identifier);
}

export async function deleteProject(identifier: string, deleteDb?: boolean) {
  return deleteCatalogProject(identifier, deleteDb);
}

export async function fleetSummary(limit?: number) {
  return catalogFleetSummary(limit);
}

export async function fleetGraph(options: FleetGraphOptions = {}) {
  return buildFleetGraph(await catalogFleetSummary(options.limit), options);
}

export function configList(configPath?: string) {
  return readRepoLensConfig(configPath);
}

export function configGet(key: string, configPath?: string) {
  return getRepoLensConfigValue(key, configPath);
}

export function configSet(key: string, value: string, configPath?: string) {
  return setRepoLensConfigValue(key, value, configPath);
}

export function configReset(key?: string, configPath?: string) {
  return resetRepoLensConfigValue(key, configPath);
}

export function withStore<T>(rootOrDbPath: string | undefined, fn: (store: MemoryStore) => T): T {
  const root = path.resolve(process.cwd());
  const dbPath = path.resolve(rootOrDbPath ?? process.env.REPOLENS_DB ?? defaultDbPath(root));
  const store = new MemoryStore(dbPath);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export function getArchitecture(dbPath?: string) {
  return withStore(dbPath, (store) => store.architecture());
}

export function searchCode(query: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.searchCode(query, limit));
}

export function scanSecrets(options: SecretScanOptions = {}, dbPath?: string) {
  return withStore(dbPath, (store) => store.scanSecrets(options));
}

export function searchSymbols(query: string, kind?: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.searchSymbols(query, kind, limit));
}

export function getCodeSnippet(identifier: string, context?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.getCodeSnippet(identifier, context));
}

export function findReferences(identifier: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.findReferences(identifier, limit));
}

export function traceSymbol(name: string, direction: TraceDirection = "outbound", depth?: number, dbPath?: string, options: TraceOptions = {}) {
  return withStore(dbPath, (store) => store.traceSymbol(name, direction, depth, options));
}

export function impactAnalysis(items: string[], limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.impactedBy(items, limit));
}

export function getGraphSchema(dbPath?: string) {
  return withStore(dbPath, (store) => store.graphSchema());
}

export function findCommunities(limit?: number, minMembers?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.communities(limit, minMembers));
}

export function searchGraph(options: GraphSearchOptions, dbPath?: string) {
  return withStore(dbPath, (store) => store.searchGraph(options));
}

export function semanticSearch(query: string | string[], limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.semanticSearch(query, limit));
}

export function vectorSearch(query: string | string[], limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.vectorSearch(query, limit));
}

export function queryGraph(query: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.queryGraph(query, limit));
}

export function findDeadCode(limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.findDeadCode(limit));
}

export function findDependencyCycles(limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.dependencyCycles(limit));
}

export function ingestTraces(traces: RuntimeTrace[], dbPath?: string) {
  return withStore(dbPath, (store) => store.ingestTraces(traces));
}

export function contextPack(query: string, limit?: number, context?: number, dbPath?: string): ContextPack {
  return withStore(dbPath, (store) => {
    const max = Math.min(20, Math.max(1, Math.floor(limit ?? 6)));
    const semantic = store.semanticSearch(query, max);
    const vector = store.vectorSearch(query, max);
    const graph = store.searchGraph({ query, limit: max });
    const code = store.searchCode(query, max);
    const snippetIds = new Set<string>();
    for (const match of semantic) snippetIds.add(match.symbol.qualifiedName);
    for (const match of vector) snippetIds.add(match.symbol.qualifiedName);
    for (const match of graph) snippetIds.add(match.symbol.qualifiedName);
    const snippets = [...snippetIds]
      .slice(0, max)
      .map((identifier) => store.getCodeSnippet(identifier, context ?? 2))
      .filter((snippet): snippet is NonNullable<typeof snippet> => Boolean(snippet));
    const edges = [...snippetIds]
      .slice(0, Math.min(5, max))
      .flatMap((identifier) => [
        ...store.traceSymbol(identifier, "outbound", 1),
        ...store.traceSymbol(identifier, "inbound", 1)
      ])
      .slice(0, 50);
    return { query, semantic, vector, graph, code, snippets, edges };
  });
}

export function detectChanges(root?: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.detectChanges(root, limit));
}

export function changeReviewReport(root?: string, limit?: number, dbPath?: string) {
  return buildChangeReviewReport(detectChanges(root, limit, dbPath));
}

export function rememberDecision(decision: DecisionRecord, dbPath?: string) {
  return withStore(dbPath, (store) => store.addDecision(decision));
}

export function updateDecision(id: number, patch: Partial<Pick<DecisionRecord, "title" | "status" | "body" | "tags">>, dbPath?: string) {
  return withStore(dbPath, (store) => store.updateDecision(id, patch));
}

export function deleteDecision(id: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.deleteDecision(id));
}

export function listDecisions(limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.listDecisions(limit));
}

export function graphSnapshot(limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.graph(limit));
}

export function architectureReport(options: ArchitectureReportOptions = {}, dbPath?: string) {
  return withStore(dbPath, (store) => {
    const architecture = store.architecture();
    const graph = store.graph(options.graphLimit);
    return buildArchitectureReport(architecture, graph, options);
  });
}

export async function packGraph(outPath: string, dbPath?: string, label?: string) {
  return exportGraphPackage({ outPath, dbPath, label });
}

export async function unpackGraph(packagePath: string, dbPath?: string, overwrite?: boolean) {
  return importGraphPackage({ packagePath, dbPath, overwrite });
}

export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function rate(count: number, elapsedMs: number): number {
  if (elapsedMs <= 0) {
    return count;
  }
  return Number((count / (elapsedMs / 1000)).toFixed(2));
}
