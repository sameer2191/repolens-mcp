import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { architectureReport, contextPack, packGraph, unpackGraph } from "../src/core/api.js";
import { indexRepository } from "../src/core/indexer.js";
import { MemoryStore } from "../src/core/store.js";
import { watchRepository } from "../src/core/watcher.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");

test("indexes a TypeScript repo with symbols, routes, search, and architecture", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await indexRepository({ root: fixture, dbPath });

  assert.equal(result.mode, "full");
  assert.equal(result.filesIndexed, 19);
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

    const splitCode = store.searchCode("create order");
    assert.ok(splitCode.some((match) => match.text.includes("createOrder")));
    assert.ok(splitCode[0]?.score > 0);

    const arch = store.architecture(fixture);
    assert.equal(arch.languages[0]?.language, "typescript");
    assert.ok(arch.languages.some((language) => language.language === "swift"));
    assert.ok(arch.entrypoints.some((entry) => entry.path.includes("server.ts")));
    assert.ok(arch.nodeLabels.some((label) => label.kind === "function"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "CALLS"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "HTTP_CALLS"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "EMITS"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "LISTENS_ON"));
    assert.ok(arch.topSymbols.some((symbol) => symbol.name === "createOrder"));
    assert.ok(Array.isArray(arch.dependencyCycles));
    assert.ok(Array.isArray(arch.recommendations));

    const trace = store.traceSymbol("createOrder", "inbound", 2);
    assert.ok(trace.some((edge) => edge.source.includes("server.ts")));

    const schema = store.graphSchema();
    assert.ok(schema.nodeLabels.some((label) => label.kind === "class"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "resource"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "container_image"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "stage"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "module"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "channel"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "http_call"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "package"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "dependency"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "DEFINES"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "CALLS_HTTP_ENDPOINT"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "CONFIGURES"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "EMITS"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "LISTENS_ON"));

    const graphMatches = store.searchGraph({ query: "createOrder", minDegree: 1 });
    assert.equal(graphMatches[0]?.symbol.name, "createOrder");
    assert.ok(graphMatches[0]?.degree >= 1);

    const imageMatches = store.searchGraph({ kind: "container_image", query: "orders-api" });
    assert.ok(imageMatches.some((match) => match.symbol.name === "ghcr.io/example/orders-api:1.2.3"));

    const stageMatches = store.searchGraph({ kind: "stage", query: "build" });
    assert.ok(stageMatches.some((match) => match.symbol.filePath === "Dockerfile"));

    const resourceMatches = store.searchGraph({ kind: "resource", query: "orders-api" });
    assert.ok(resourceMatches.some((match) => match.symbol.name === "Deployment/orders-api"));
    assert.ok(resourceMatches.some((match) => match.symbol.name === "Service/orders-api"));

    const imageQuery = store.queryGraph("MATCH (a)-[r:CONFIGURES]->(b) WHERE b.name CONTAINS 'orders-api' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(imageQuery.rows.some((row) => row["a.name"] === "Deployment/orders-api" && row["r.type"] === "CONFIGURES"));

    const kustomizeQuery = store.queryGraph("MATCH (a)-[r:IMPORTS]->(b) WHERE a.name STARTS WITH 'Kustomization' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(kustomizeQuery.rows.some((row) => row["b.name"] === "deployment.yaml" && row["r.type"] === "IMPORTS"));

    const channelMatches = store.searchGraph({ kind: "channel", query: "order.created" });
    assert.ok(channelMatches.some((match) => match.symbol.name === "order.created"));

    const emitsQuery = store.queryGraph("MATCH (a)-[r:EMITS]->(b:Channel) WHERE b.name = 'order.created' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(emitsQuery.rows.some((row) => row["a.name"] === "notifyOrderCreated" && row["r.type"] === "EMITS"));

    const listensQuery = store.queryGraph("MATCH (a)-[r:LISTENS_ON]->(b:Channel) WHERE b.name = 'order.created' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(listensQuery.rows.some((row) => row["a.name"] === "onOrderCreated" && row["r.type"] === "LISTENS_ON"));

    const swiftChannel = store.searchGraph({ kind: "channel", query: "checkoutSubmitted" });
    assert.ok(swiftChannel.some((match) => match.symbol.name === "checkoutSubmitted"));

    const packageMatches = store.searchGraph({ kind: "package", limit: 50 });
    assert.ok(packageMatches.some((match) => match.symbol.name === "sample-memory-target"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "sample-python-service"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "github.com/example/orders"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "orders-rust"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "example/orders-php"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "com.example:orders-java"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "orders-gradle"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "orders_dart"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "orders_elixir"));
    assert.ok(packageMatches.some((match) => match.symbol.name === "orders-ruby"));

    const dependencyMatches = store.searchGraph({ kind: "dependency", query: "spring" });
    assert.ok(dependencyMatches.some((match) => match.symbol.name === "org.springframework.boot:spring-boot-starter-web"));
    assert.equal(store.searchGraph({ kind: "dependency", query: "(" }).length, 0);
    assert.ok(store.searchGraph({ kind: "dependency", query: "fastapi" }).some((match) => match.symbol.name === "fastapi"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "gin-gonic" }).some((match) => match.symbol.name === "github.com/gin-gonic/gin"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "tokio" }).some((match) => match.symbol.name === "tokio"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "laravel" }).some((match) => match.symbol.name === "laravel/framework"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "okhttp" }).some((match) => match.symbol.name === "com.squareup.okhttp3:okhttp"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "json_annotation" }).some((match) => match.symbol.name === "json_annotation"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "phoenix" }).some((match) => match.symbol.name === "phoenix"));
    assert.ok(store.searchGraph({ kind: "dependency", query: "rack" }).some((match) => match.symbol.name === "rack"));

    const communities = store.communities(5, 3);
    assert.ok(communities.length > 0);
    assert.ok(communities.some((community) => community.representativeSymbols.some((symbol) => symbol.name === "createOrder" || symbol.name === "listOrders")));

    const semanticMatches = store.semanticSearch("create order total", 5);
    assert.ok(semanticMatches.some((match) => match.symbol.name === "createOrder"));
    assert.ok(arch.edgeTypes.some((edgeType) => edgeType.type === "SEMANTICALLY_RELATED"));

    const nodeQuery = store.queryGraph("MATCH (f:Function) WHERE f.name = 'createOrder' RETURN f.name,f.filePath LIMIT 5");
    assert.equal(nodeQuery.rows[0]?.["f.name"], "createOrder");
    assert.equal(nodeQuery.rows[0]?.["f.filePath"], "src/orders.ts");

    const countQuery = store.queryGraph("MATCH (f:Function) RETURN count(f) AS functions LIMIT 5");
    assert.ok(Number(countQuery.rows[0]?.functions) >= 5);

    const distinctQuery = store.queryGraph("MATCH (f:Function) RETURN DISTINCT f.name ORDER BY f.name LIMIT 20");
    const distinctNames = distinctQuery.rows.map((row) => String(row["f.name"]));
    assert.equal(new Set(distinctNames).size, distinctNames.length);
    assert.deepEqual(distinctNames, [...distinctNames].sort());

    const orderedBaseline = store.queryGraph("MATCH (f:Function) RETURN f.name ORDER BY f.name LIMIT 4");
    const orderedQuery = store.queryGraph("MATCH (f:Function) RETURN f.name ORDER BY f.name SKIP 1 LIMIT 3");
    assert.equal(orderedQuery.rows.length, 3);
    assert.deepEqual(
      orderedQuery.rows.map((row) => row["f.name"]),
      orderedBaseline.rows.slice(1).map((row) => row["f.name"])
    );

    const callQuery = store.queryGraph("MATCH (a)-[r:CALLS]->(b:Function) WHERE b.name = 'createOrder' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(callQuery.rows.some((row) => row["b.name"] === "createOrder" && row["r.type"] === "CALLS"));

    const httpQuery = store.queryGraph("MATCH (a)-[r:HTTP_CALLS]->(b:Route) WHERE b.name CONTAINS '/orders' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(httpQuery.rows.some((row) => row["a.name"] === "loadOrders" && row["r.type"] === "HTTP_CALLS"));

    const httpCallMatches = store.searchGraph({ kind: "http_call", query: "/orders" });
    assert.ok(httpCallMatches.some((match) => match.symbol.name === "GET /orders" && match.symbol.filePath === "src/client.ts"));
    const httpEndpointQuery = store.queryGraph("MATCH (a)-[r:CALLS_HTTP_ENDPOINT]->(b) WHERE b.name CONTAINS '/orders' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(httpEndpointQuery.rows.some((row) => row["a.name"] === "loadOrders" && row["r.type"] === "CALLS_HTTP_ENDPOINT"));

    const observed = store.ingestTraces([
      { type: "http", source: "submitOrder", sourceFile: "src/client.ts", method: "POST", path: "/orders", count: 3, observedAt: "2026-06-18T00:00:00.000Z" },
      { type: "event", source: "notifyOrderCreated", sourceFile: "src/client.ts", channel: "order.created", direction: "emit", count: 2 }
    ]);
    assert.equal(observed.tracesReceived, 2);
    assert.equal(observed.edgesInserted, 2);
    assert.equal(observed.unresolved.length, 0);
    const observedHttp = store.queryGraph("MATCH (a)-[r:OBSERVED_HTTP_CALLS]->(b:Route) WHERE b.name CONTAINS '/orders' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(observedHttp.rows.some((row) => row["a.name"] === "submitOrder" && row["r.type"] === "OBSERVED_HTTP_CALLS"));
    const observedEvent = store.queryGraph("MATCH (a)-[r:OBSERVED_EMITS]->(b:Channel) WHERE b.name = 'order.created' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(observedEvent.rows.some((row) => row["a.name"] === "notifyOrderCreated" && row["r.type"] === "OBSERVED_EMITS"));

    const pack = contextPack("create order", 4, 1, dbPath);
    assert.ok(pack.semantic.some((match) => match.symbol.name === "createOrder"));
    assert.ok(pack.code.some((match) => match.text.includes("createOrder")));
    assert.ok(pack.snippets.some((snippet) => snippet.symbol?.name === "createOrder"));
    assert.ok(pack.edges.length > 0);

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
    assert.equal(store.searchCode("fixture exposes").length, 0);
  } finally {
    store.close();
  }

  await fs.rm(path.join(repo, "src", "client.ts"));
  const removedClient = await indexRepository({ root: repo, dbPath, incremental: true });
  assert.equal(removedClient.filesRemoved, 1);

  store = new MemoryStore(dbPath);
  try {
    assert.equal(store.searchGraph({ kind: "channel", query: "order.created" }).length, 0);
    assert.equal(store.searchSymbols("notifyOrderCreated").length, 0);
  } finally {
    store.close();
  }
});
