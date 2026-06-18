import path from "node:path";
import { indexRepository } from "./indexer.js";
import { buildArchitectureReport } from "./report.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { ArchitectureReportOptions } from "./report.js";
import type { DecisionRecord, GraphSearchOptions, IndexOptions } from "./types.js";

export async function runIndex(options: IndexOptions) {
  return indexRepository(options);
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

export function searchSymbols(query: string, kind?: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.searchSymbols(query, kind, limit));
}

export function getCodeSnippet(identifier: string, context?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.getCodeSnippet(identifier, context));
}

export function traceSymbol(name: string, direction: "inbound" | "outbound", depth?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.traceSymbol(name, direction, depth));
}

export function impactAnalysis(items: string[], limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.impactedBy(items, limit));
}

export function getGraphSchema(dbPath?: string) {
  return withStore(dbPath, (store) => store.graphSchema());
}

export function searchGraph(options: GraphSearchOptions, dbPath?: string) {
  return withStore(dbPath, (store) => store.searchGraph(options));
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

export function detectChanges(root?: string, limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.detectChanges(root, limit));
}

export function rememberDecision(decision: DecisionRecord, dbPath?: string) {
  return withStore(dbPath, (store) => store.addDecision(decision));
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

export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
