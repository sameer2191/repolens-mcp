import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { indexRepository } from "../src/core/indexer.js";
import { MemoryStore } from "../src/core/store.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");

test("indexes a TypeScript repo with symbols, routes, search, and architecture", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await indexRepository({ root: fixture, dbPath });

  assert.equal(result.mode, "full");
  assert.equal(result.filesIndexed, 5);
  assert.equal(result.filesUnchanged, 0);
  assert.equal(result.filesRemoved, 0);
  assert.ok(result.symbols >= 14);
  assert.ok(result.edges >= 12);

  const store = new MemoryStore(dbPath);
  try {
    const symbols = store.searchSymbols("createOrder");
    assert.equal(symbols[0]?.name, "createOrder");

    const code = store.searchCode("/orders");
    assert.ok(code.some((match) => match.text.includes("app.get")));

    const arch = store.architecture(fixture);
    assert.equal(arch.languages[0]?.language, "typescript");
    assert.ok(arch.languages.some((language) => language.language === "swift"));
    assert.ok(arch.entrypoints.some((entry) => entry.path.includes("server.ts")));
    assert.ok(arch.nodeLabels.some((label) => label.kind === "function"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "CALLS"));
    assert.ok(arch.topSymbols.some((symbol) => symbol.name === "createOrder"));

    const trace = store.traceSymbol("createOrder", "inbound", 2);
    assert.ok(trace.some((edge) => edge.source.includes("server.ts")));

    const schema = store.graphSchema();
    assert.ok(schema.nodeLabels.some((label) => label.kind === "class"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "DEFINES"));

    const graphMatches = store.searchGraph({ query: "createOrder", minDegree: 1 });
    assert.equal(graphMatches[0]?.symbol.name, "createOrder");
    assert.ok(graphMatches[0]?.degree >= 1);

    const swiftSymbols = store.searchGraph({ kind: "class", filePattern: "ios" });
    assert.ok(swiftSymbols.some((match) => match.symbol.name === "CheckoutViewModel"));

    const deadCode = store.findDeadCode();
    assert.ok(deadCode.some((candidate) => candidate.symbol.name === "normalizeOrder"));
  } finally {
    store.close();
  }
});

test("incremental indexing skips unchanged files and prunes removed files", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-incremental-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.cp(fixture, repo, { recursive: true });

  const full = await indexRepository({ root: repo, dbPath });
  const unchanged = await indexRepository({ root: repo, dbPath, incremental: true });
  assert.equal(unchanged.mode, "incremental");
  assert.equal(unchanged.filesUnchanged, full.filesDiscovered);
  assert.equal(unchanged.filesRemoved, 0);
  assert.equal(unchanged.symbols, full.symbols);
  assert.equal(unchanged.edges, full.edges);

  await fs.appendFile(path.join(repo, "src", "orders.ts"), "\nexport function cancelOrder() { return orders.pop(); }\n");
  const changed = await indexRepository({ root: repo, dbPath, incremental: true });
  assert.equal(changed.filesRemoved, 0);
  assert.ok(changed.filesUnchanged < changed.filesDiscovered);
  assert.ok(changed.symbols > full.symbols);

  let store = new MemoryStore(dbPath);
  try {
    assert.equal(store.searchSymbols("cancelOrder")[0]?.name, "cancelOrder");
  } finally {
    store.close();
  }

  await fs.rm(path.join(repo, "README.md"));
  const removed = await indexRepository({ root: repo, dbPath, incremental: true });
  assert.equal(removed.filesRemoved, 1);

  store = new MemoryStore(dbPath);
  try {
    assert.equal(store.searchCode("Demo service").length, 0);
  } finally {
    store.close();
  }
});
