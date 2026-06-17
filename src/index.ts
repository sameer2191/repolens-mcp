export { indexRepository } from "./core/indexer.js";
export { MemoryStore, defaultDbPath } from "./core/store.js";
export { startMcpServer } from "./mcp/server.js";
export { serveDashboard } from "./dashboard/server.js";
export type { ArchitectureSummary, CodeMatch, DecisionRecord, Edge, IndexedFile, IndexResult, Language, SymbolNode } from "./core/types.js";
