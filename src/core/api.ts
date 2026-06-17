import path from "node:path";
import { indexRepository } from "./indexer.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { DecisionRecord, IndexOptions } from "./types.js";

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

export function traceSymbol(name: string, direction: "inbound" | "outbound", depth?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.traceSymbol(name, direction, depth));
}

export function impactAnalysis(items: string[], limit?: number, dbPath?: string) {
  return withStore(dbPath, (store) => store.impactedBy(items, limit));
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

export function jsonBlock(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
