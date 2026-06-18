import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { architectureReport, packGraph, unpackGraph } from "../src/core/api.js";
import { indexRepository } from "../src/core/indexer.js";
import { MemoryStore } from "../src/core/store.js";
import { watchRepository } from "../src/core/watcher.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");

test("indexes a TypeScript repo with symbols, routes, search, and architecture", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await indexRepository({ root: fixture, dbPath });

  assert.equal(result.mode, "full");
  assert.equal(result.filesIndexed, 6);
  assert.equal(result.filesUnchanged, 0);
  assert.equal(result.filesRemoved, 0);
  assert.ok(result.symbols >= 14);
  assert.ok(result.edges >= 12);

  const store = new MemoryStore(dbPath);
  try {
    const symbols = store.searchSymbols("createOrder");
    assert.equal(symbols[0]?.name, "createOrder");

    const snippet = store.getCodeSnippet("createOrder", 1);
    assert.equal(snippet?.symbol?.name, "createOrder");
    assert.ok(snippet?.lines.some((line) => line.highlight && line.text.includes("createOrder")));

    const lineSnippet = store.getCodeSnippet("src/orders.ts:8", 1);
    assert.equal(lineSnippet?.filePath, "src/orders.ts");
    assert.ok(lineSnippet?.lines.some((line) => line.line === 8 && line.highlight));

    const code = store.searchCode("/orders");
    assert.ok(code.some((match) => match.text.includes("app.get")));

    const arch = store.architecture(fixture);
    assert.equal(arch.languages[0]?.language, "typescript");
    assert.ok(arch.languages.some((language) => language.language === "swift"));
    assert.ok(arch.entrypoints.some((entry) => entry.path.includes("server.ts")));
    assert.ok(arch.nodeLabels.some((label) => label.kind === "function"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "CALLS"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "HTTP_CALLS"));
    assert.ok(arch.topSymbols.some((symbol) => symbol.name === "createOrder"));
    assert.ok(Array.isArray(arch.dependencyCycles));
    assert.ok(Array.isArray(arch.recommendations));

    const trace = store.traceSymbol("createOrder", "inbound", 2);
    assert.ok(trace.some((edge) => edge.source.includes("server.ts")));

    const schema = store.graphSchema();
    assert.ok(schema.nodeLabels.some((label) => label.kind === "class"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "DEFINES"));

    const graphMatches = store.searchGraph({ query: "createOrder", minDegree: 1 });
    assert.equal(graphMatches[0]?.symbol.name, "createOrder");
    assert.ok(graphMatches[0]?.degree >= 1);

    const communities = store.communities(5, 3);
    assert.ok(communities.length > 0);
    assert.ok(communities.some((community) => community.representativeSymbols.some((symbol) => symbol.name === "createOrder" || symbol.name === "listOrders")));

    const semanticMatches = store.semanticSearch("create order total", 5);
    assert.ok(semanticMatches.some((match) => match.symbol.name === "createOrder"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "SEMANTICALLY_RELATED"));

    const nodeQuery = store.queryGraph("MATCH (f:Function) WHERE f.name = 'createOrder' RETURN f.name,f.filePath LIMIT 5");
    assert.equal(nodeQuery.rows[0]?.["f.name"], "createOrder");
    assert.equal(nodeQuery.rows[0]?.["f.filePath"], "src/orders.ts");

    const callQuery = store.queryGraph("MATCH (a)-[r:CALLS]->(b:Function) WHERE b.name = 'createOrder' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(callQuery.rows.some((row) => row["b.name"] === "createOrder" && row["r.type"] === "CALLS"));

    const httpQuery = store.queryGraph("MATCH (a)-[r:HTTP_CALLS]->(b:Route) WHERE b.name CONTAINS '/orders' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(httpQuery.rows.some((row) => row["a.name"] === "loadOrders" && row["r.type"] === "HTTP_CALLS"));

    assert.throws(() => store.queryGraph("MATCH (f) DELETE f RETURN f.name"), /read-only/);

    const swiftSymbols = store.searchGraph({ kind: "class", filePattern: "ios" });
    assert.ok(swiftSymbols.some((match) => match.symbol.name === "CheckoutViewModel"));

    const deadCode = store.findDeadCode();
    assert.ok(deadCode.some((candidate) => candidate.symbol.name === "normalizeOrder"));

    const markdownReport = architectureReport({ graphLimit: 50 }, dbPath);
    assert.match(markdownReport, /# RepoLens Architecture Report/);
    assert.match(markdownReport, /## Graph Schema/);
    assert.match(markdownReport, /createOrder/);

    const htmlReport = architectureReport({ format: "html", graphLimit: 50 }, dbPath);
    assert.match(htmlReport, /<!doctype html>/);
    assert.match(htmlReport, /RepoLens Architecture Report/);
    assert.match(htmlReport, /CheckoutViewModel/);
  } finally {
    store.close();
  }
});

test("packs and imports a reusable graph package", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-package-"));
  const dbPath = path.join(tmp, "memory.db");
  await indexRepository({ root: fixture, dbPath });

  const packagePath = path.join(tmp, "fixture.rlgz");
  const exported = await packGraph(packagePath, dbPath, "fixture");
  assert.equal(exported.outPath, packagePath);
  assert.equal(exported.label, "fixture");
  assert.ok(exported.sqliteBytes > exported.compressedBytes);
  assert.ok(exported.sha256.length >= 64);

  const importedDbPath = path.join(tmp, "imported.db");
  const imported = await unpackGraph(packagePath, importedDbPath);
  assert.equal(imported.label, "fixture");
  assert.equal(imported.dbPath, importedDbPath);
  assert.ok(imported.totals.files >= 5);
  assert.ok(imported.totals.symbols >= 14);
  assert.ok(imported.totals.edges >= 12);

  const store = new MemoryStore(importedDbPath);
  try {
    assert.equal(store.searchSymbols("createOrder")[0]?.name, "createOrder");
  } finally {
    store.close();
  }
});

test("watch mode keeps a repository indexed incrementally", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-watch-"));
  const dbPath = path.join(tmp, "memory.db");
  const observed: string[] = [];
  const summary = await watchRepository({
    root: fixture,
    dbPath,
    intervalMs: 250,
    maxRuns: 2,
    onResult: (result) => observed.push(result.mode)
  });

  assert.equal(summary.runs.length, 2);
  assert.deepEqual(observed, ["full", "incremental"]);
  assert.equal(summary.runs[1]?.filesUnchanged, summary.runs[0]?.filesDiscovered);
});

test("index lock prevents overlapping writers", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-lock-"));
  const dbPath = path.join(tmp, "memory.db");
  const first = new MemoryStore(dbPath);
  const second = new MemoryStore(dbPath);
  try {
    first.acquireLock("index");
    assert.throws(() => second.acquireLock("index"), /already held/);
    first.releaseLock("index");
    second.acquireLock("index");
    second.releaseLock("index");
  } finally {
    first.close();
    second.close();
  }
});

test("detects dependency cycles between architecture clusters", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-cycles-"));
  const dbPath = path.join(tmp, "memory.db");
  const store = new MemoryStore(dbPath);
  try {
    store.recordRun(tmp, null, new Date().toISOString());
    store.insertFile({
      path: "src/api/orders.ts",
      language: "typescript",
      bytes: 120,
      lines: 8,
      sha256: "api",
      skipped: false
    });
    store.insertFile({
      path: "src/domain/orders.ts",
      language: "typescript",
      bytes: 120,
      lines: 8,
      sha256: "domain",
      skipped: false
    });
    store.insertSymbol({
      filePath: "src/api/orders.ts",
      language: "typescript",
      kind: "file",
      name: "orders.ts",
      qualifiedName: "src/api/orders.ts:file",
      startLine: 1,
      endLine: 8,
      metadata: { path: "src/api/orders.ts" }
    });
    store.insertSymbol({
      filePath: "src/domain/orders.ts",
      language: "typescript",
      kind: "file",
      name: "orders.ts",
      qualifiedName: "src/domain/orders.ts:file",
      startLine: 1,
      endLine: 8,
      metadata: { path: "src/domain/orders.ts" }
    });
    store.insertSymbol({
      filePath: "src/api/orders.ts",
      language: "typescript",
      kind: "function",
      name: "handleOrder",
      qualifiedName: "src/api/orders.ts:function:handleOrder:1",
      startLine: 1,
      endLine: 4,
      exported: true
    });
    store.insertSymbol({
      filePath: "src/domain/orders.ts",
      language: "typescript",
      kind: "function",
      name: "priceOrder",
      qualifiedName: "src/domain/orders.ts:function:priceOrder:1",
      startLine: 1,
      endLine: 4,
      exported: true
    });
    store.insertEdge({ source: "src/api/orders.ts:file", target: "external:../domain/orders.js", type: "IMPORTS", metadata: { import: "../domain/orders.js" } });
    store.insertEdge({ source: "src/domain/orders.ts:file", target: "external:../api/orders.js", type: "IMPORTS", metadata: { import: "../api/orders.js" } });

    const cycles = store.dependencyCycles();
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].clusters, ["src/api", "src/domain"]);
    assert.equal(cycles[0].edges, 2);

    const arch = store.architecture(tmp);
    assert.ok(arch.risks.some((risk) => risk.includes("dependency cycles")));
    assert.ok(arch.recommendations.some((recommendation) => recommendation.title.includes("dependency cycles")));
  } finally {
    store.close();
  }

  const markdownReport = architectureReport({ graphLimit: 20 }, dbPath);
  assert.match(markdownReport, /## Dependency Cycles/);
  assert.match(markdownReport, /src\/api -> src\/domain/);
});

test("resolves workspace package imports in dependency cycles", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-package-cycles-"));
  const dbPath = path.join(tmp, "memory.db");
  const store = new MemoryStore(dbPath);
  try {
    store.recordRun(tmp, null, new Date().toISOString());
    for (const filePath of ["packages/api/package.json", "packages/domain/package.json", "packages/api/src/index.ts", "packages/domain/src/index.ts"]) {
      store.insertFile({
        path: filePath,
        language: filePath.endsWith(".json") ? "json" : "typescript",
        bytes: 80,
        lines: 4,
        sha256: filePath,
        skipped: false
      });
    }
    store.insertSymbol({
      filePath: "packages/api/package.json",
      language: "json",
      kind: "package",
      name: "@demo/api",
      qualifiedName: "packages/api/package.json:package:@demo/api:1",
      startLine: 1,
      endLine: 1
    });
    store.insertSymbol({
      filePath: "packages/domain/package.json",
      language: "json",
      kind: "package",
      name: "@demo/domain",
      qualifiedName: "packages/domain/package.json:package:@demo/domain:1",
      startLine: 1,
      endLine: 1
    });
    store.insertSymbol({
      filePath: "packages/api/src/index.ts",
      language: "typescript",
      kind: "file",
      name: "index.ts",
      qualifiedName: "packages/api/src/index.ts:file",
      startLine: 1,
      endLine: 4
    });
    store.insertSymbol({
      filePath: "packages/domain/src/index.ts",
      language: "typescript",
      kind: "file",
      name: "index.ts",
      qualifiedName: "packages/domain/src/index.ts:file",
      startLine: 1,
      endLine: 4
    });
    store.insertEdge({ source: "packages/api/src/index.ts:file", target: "external:@demo/domain", type: "IMPORTS", metadata: { import: "@demo/domain" } });
    store.insertEdge({ source: "packages/domain/src/index.ts:file", target: "external:@demo/api", type: "IMPORTS", metadata: { import: "@demo/api" } });

    const cycles = store.dependencyCycles();
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].clusters, ["packages/api", "packages/domain"]);
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
