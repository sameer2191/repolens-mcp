import assert from "node:assert/strict";
import fsSync from "node:fs";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { architectureReport, benchmarkRepository, contextPack, packGraph, unpackGraph } from "../src/core/api.js";
import { addCallEdges, addDataFlowEdges, addTypeRelationEdges, extractFromFile } from "../src/core/extractor.js";
import { indexRepository } from "../src/core/indexer.js";
import { MemoryStore } from "../src/core/store.js";
import { watchRepository } from "../src/core/watcher.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");

test("extracts Next.js app route handlers from file paths", () => {
  const extracted = extractFromFile(
    "apps/web-admin/src/app/api/orders/[id]/route.ts",
    "typescript",
    `
export async function GET() {
  return Response.json({});
}

export const POST = async () => Response.json({});
`
  );
  const routes = extracted.symbols.filter((symbol) => symbol.kind === "route");
  assert.ok(routes.some((route) => route.name === "GET /api/orders/:id" && route.metadata?.framework === "next-app-router"));
  assert.ok(routes.some((route) => route.name === "POST /api/orders/:id" && route.metadata?.path === "/api/orders/:id"));
});

test("extracts GraphQL, protobuf, tRPC, and OpenAPI protocol surfaces", () => {
  const graphql = extractFromFile(
    "schema/orders.graphql",
    "graphql",
    `
type Order { id: ID! }
query GetOrders { orders { id } }
mutation SubmitOrder { submitOrder { id } }
`
  );
  assert.ok(graphql.symbols.some((symbol) => symbol.kind === "graphql_type" && symbol.name === "type Order"));
  assert.ok(graphql.symbols.some((symbol) => symbol.kind === "graphql_operation" && symbol.name === "query GetOrders"));

  const proto = extractFromFile(
    "proto/orders.proto",
    "proto",
    `
service OrderService {
  rpc CreateOrder (CreateOrderRequest) returns (OrderReply);
}
`
  );
  assert.ok(proto.symbols.some((symbol) => symbol.kind === "grpc_service" && symbol.name === "OrderService"));
  assert.ok(proto.symbols.some((symbol) => symbol.kind === "route" && symbol.name === "RPC /OrderService/CreateOrder" && symbol.metadata?.protocol === "grpc"));

  const trpc = extractFromFile(
    "src/router.ts",
    "typescript",
    `
export const appRouter = router({
  orders: publicProcedure.query(() => []),
  createOrder: protectedProcedure.mutation(() => ({}))
});

export function useOrders() {
  return trpc.orders.useQuery();
}

const q = gql\`query Viewer { viewer { id } }\`;
`
  );
  assert.ok(trpc.symbols.some((symbol) => symbol.kind === "trpc_procedure" && symbol.name === "query orders"));
  assert.ok(trpc.symbols.some((symbol) => symbol.kind === "trpc_procedure" && symbol.name === "mutation createOrder"));
  assert.ok(trpc.symbols.some((symbol) => symbol.kind === "trpc_call" && symbol.name === "useQuery orders"));
  assert.ok(trpc.symbols.some((symbol) => symbol.kind === "graphql_operation" && symbol.name === "query Viewer"));
  assert.ok(trpc.edges.some((edge) => edge.type === "CALLS_TRPC"));
  assert.ok(trpc.edges.some((edge) => edge.type === "USES_GRAPHQL"));

  const openapi = extractFromFile(
    "openapi.yaml",
    "yaml",
    `
openapi: 3.1.0
paths:
  /orders/{id}:
    get:
      summary: Read an order
`
  );
  assert.ok(openapi.symbols.some((symbol) => symbol.kind === "route" && symbol.name === "GET /orders/:id" && symbol.metadata?.protocol === "openapi"));
});

test("captures host metadata for absolute HTTP call literals", () => {
  const extracted = extractFromFile(
    "src/client.ts",
    "typescript",
    `
export async function loadBillingOrders() {
  return fetch("https://billing.internal/orders?limit=10", { method: "POST" });
}
`
  );
  const call = extracted.symbols.find((symbol) => symbol.kind === "http_call" && symbol.metadata?.path === "/orders");
  assert.ok(call);
  assert.equal(call.metadata?.host, "billing.internal");
  assert.equal(call.metadata?.scheme, "https");
  assert.equal(call.metadata?.url, "https://billing.internal/orders");
  assert.equal(call.metadata?.urlKind, "absolute");

  const edge = extracted.edges.find((candidate) => candidate.type === "CALLS_HTTP_ENDPOINT" && candidate.target === call.qualifiedName);
  assert.ok(edge);
  assert.equal(edge.metadata?.host, "billing.internal");
  assert.equal(edge.metadata?.path, "/orders");
});

test("extracts typed inheritance, implementation, and usage edges", () => {
  const content = `
export interface Order {
  id: string;
}

export interface PersistedOrder extends Order {
  savedAt: Date;
}

export interface OrderRepository {
  save(order: Order): PersistedOrder;
}

export class BaseRepository {}

export class MemoryOrderRepository extends BaseRepository implements OrderRepository {
  save(order: Order): PersistedOrder {
    return { ...order, savedAt: new Date() };
  }
}

export function serializeOrder(input: Partial<Order>): PersistedOrder {
  return { id: input.id ?? "new", savedAt: new Date() };
}
`;
  const extracted = extractFromFile("src/repository.ts", "typescript", content);
  const edges = addTypeRelationEdges(extracted.symbols, new Map([["src/repository.ts", content]]));
  const symbol = (name: string) => extracted.symbols.find((item) => item.name === name)?.qualifiedName;

  assert.ok(edges.some((edge) => edge.type === "INHERITS" && edge.source === symbol("PersistedOrder") && edge.target === symbol("Order")));
  assert.ok(edges.some((edge) => edge.type === "INHERITS" && edge.source === symbol("MemoryOrderRepository") && edge.target === symbol("BaseRepository")));
  assert.ok(edges.some((edge) => edge.type === "IMPLEMENTS" && edge.source === symbol("MemoryOrderRepository") && edge.target === symbol("OrderRepository")));
  assert.ok(edges.some((edge) => edge.type === "USES_TYPE" && edge.source === symbol("serializeOrder") && edge.target === symbol("Order")));
  assert.ok(!edges.some((edge) => edge.type === "IMPLEMENTS" && edge.source === symbol("BaseRepository")));
});

test("extracts conservative function argument data-flow edges", () => {
  const content = `
export function persistOrder(order: Order, actor: User) {
  return { order, actor };
}

export function checkout(cart: Cart, currentUser: User) {
  const order = buildOrder(cart);
  return persistOrder(order, currentUser);
}
`;
  const extracted = extractFromFile("src/flow.ts", "typescript", content);
  const edges = addDataFlowEdges(extracted.symbols, new Map([["src/flow.ts", content]]));
  const checkout = extracted.symbols.find((symbol) => symbol.name === "checkout")?.qualifiedName;
  const persistOrder = extracted.symbols.find((symbol) => symbol.name === "persistOrder")?.qualifiedName;
  const flow = edges.find((edge) => edge.source === checkout && edge.target === persistOrder && edge.type === "DATA_FLOWS");

  assert.ok(flow);
  assert.deepEqual(flow.metadata?.mappings, [
    { argument: "order", parameter: "order" },
    { argument: "currentUser", parameter: "actor" }
  ]);
});

test("keeps data-flow mappings positional and suppresses ambiguous targets", () => {
  const sourceContent = `
export function save(status: string, order: Order) {
  return order;
}

export function checkout(order: Order) {
  return save("draft", order);
}
`;
  const otherContent = `
export function save(order: Order) {
  return order;
}
`;
  const source = extractFromFile("src/source.ts", "typescript", sourceContent);
  const other = extractFromFile("src/other.ts", "typescript", otherContent);
  const symbols = [...source.symbols, ...other.symbols];
  const edges = addDataFlowEdges(
    symbols,
    new Map([
      ["src/source.ts", sourceContent],
      ["src/other.ts", otherContent]
    ])
  );
  const checkout = symbols.find((symbol) => symbol.filePath === "src/source.ts" && symbol.name === "checkout")?.qualifiedName;
  const localSave = symbols.find((symbol) => symbol.filePath === "src/source.ts" && symbol.name === "save")?.qualifiedName;
  const remoteSave = symbols.find((symbol) => symbol.filePath === "src/other.ts" && symbol.name === "save")?.qualifiedName;
  const flow = edges.find((edge) => edge.source === checkout && edge.target === localSave && edge.type === "DATA_FLOWS");

  assert.deepEqual(flow?.metadata?.mappings, [{ argument: "order", parameter: "order" }]);
  assert.ok(!edges.some((edge) => edge.source === checkout && edge.target === remoteSave && edge.type === "DATA_FLOWS"));
});

test("resolves receiver method calls from constructor-assigned class instances", () => {
  const content = `
export class MemoryOrderRepository {
  save(order: Order) {
    return order;
  }
}

export class AuditRepository {
  save(order: Order) {
    return order;
  }
}

export function checkout(order: Order) {
  const repo = new MemoryOrderRepository();
  return repo.save(order);
}
`;
  const extracted = extractFromFile("src/repository.ts", "typescript", content);
  const edges = addCallEdges(extracted.symbols, new Map([["src/repository.ts", content]]));
  const checkout = extracted.symbols.find((symbol) => symbol.name === "checkout")?.qualifiedName;
  const memorySave = extracted.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "save" && symbol.metadata?.parentClass === "MemoryOrderRepository")?.qualifiedName;
  const auditSave = extracted.symbols.find((symbol) => symbol.kind === "method" && symbol.name === "save" && symbol.metadata?.parentClass === "AuditRepository")?.qualifiedName;
  const typedEdge = edges.find((edge) => edge.source === checkout && edge.target === memorySave && edge.type === "CALLS_LOCAL");

  assert.ok(memorySave);
  assert.ok(auditSave);
  assert.ok(typedEdge);
  assert.equal(typedEdge.metadata?.resolution, "receiver_type");
  assert.equal(typedEdge.metadata?.receiver, "repo");
  assert.equal(typedEdge.metadata?.receiverType, "MemoryOrderRepository");
  assert.ok(!edges.some((edge) => edge.source === checkout && edge.target === auditSave));
});

test("indexes data-flow edges and removes stale data-flow edges incrementally", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-data-flow-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(
    path.join(repo, "src", "flow.ts"),
    `
export function persistOrder(order: Order) {
  return order;
}

export function checkout(order: Order) {
  return persistOrder(order);
}
`
  );

  await indexRepository({ root: repo, dbPath });
  let store = new MemoryStore(dbPath);
  try {
    const schema = store.graphSchema();
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "DATA_FLOWS"));
    const dataFlow = store.queryGraph("MATCH (a)-[r:DATA_FLOWS]->(b) WHERE b.name = 'persistOrder' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(dataFlow.rows.some((row) => row["a.name"] === "checkout" && row["b.name"] === "persistOrder" && row["r.type"] === "DATA_FLOWS"));
    const trace = store.traceSymbol("checkout", "outbound", 2, { mode: "data_flow", parameterName: "order" });
    assert.ok(trace.some((edge) => edge.type === "DATA_FLOWS" && edge.target.includes("persistOrder")));
    assert.ok(trace.every((edge) => edge.type === "DATA_FLOWS"));
  } finally {
    store.close();
  }

  await fs.writeFile(
    path.join(repo, "src", "flow.ts"),
    `
export function persistOrder(order: Order) {
  return order;
}

export function checkout(order: Order) {
  return order;
}
`
  );

  await indexRepository({ root: repo, dbPath, incremental: true });
  store = new MemoryStore(dbPath);
  try {
    const stale = store.queryGraph("MATCH (a)-[r:DATA_FLOWS]->(b) RETURN a.name,b.name,r.type LIMIT 5");
    assert.equal(stale.rows.length, 0);
  } finally {
    store.close();
  }
});

test("indexes a TypeScript repo with symbols, routes, search, and architecture", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-test-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await indexRepository({ root: fixture, dbPath });

  assert.equal(result.mode, "full");
  assert.equal(result.filesIndexed, 22);
  assert.equal(result.filesUnchanged, 0);
  assert.equal(result.filesRemoved, 0);
  assert.ok(result.symbols >= 14);
  assert.ok(result.edges >= 12);

  const store = new MemoryStore(dbPath);
  try {
    const symbols = store.searchSymbols("createOrder");
    assert.ok(symbols.some((symbol) => symbol.name === "createOrder"));

    const snippet = store.getCodeSnippet("createOrder", 1);
    assert.equal(snippet?.symbol?.name, "createOrder");
    assert.ok(snippet?.lines.some((line) => line.highlight && line.text.includes("createOrder")));

    const references = store.findReferences("createOrder", 20);
    assert.ok(references.some((reference) => reference.kind === "definition" && reference.filePath === "src/orders.ts"));
    assert.ok(references.some((reference) => reference.kind === "reference" && reference.filePath === "src/server.ts"));

    const lineSnippet = store.getCodeSnippet("src/orders.ts:8", 1);
    assert.equal(lineSnippet?.filePath, "src/orders.ts");
    assert.ok(lineSnippet?.lines.some((line) => line.line === 8 && line.highlight));

    const absoluteLineSnippet = store.getCodeSnippet(`${path.join(fixture, "src", "orders.ts")}:8`, 1);
    assert.equal(absoluteLineSnippet?.filePath, "src/orders.ts");
    assert.ok(absoluteLineSnippet?.lines.some((line) => line.line === 8 && line.highlight));

    const outsideFile = path.join(tmp, "outside-secret.txt");
    await fs.writeFile(outsideFile, "SHOULD_NOT_BE_READ\n");
    assert.equal(store.getCodeSnippet(`${outsideFile}:1`, 0), null);
    assert.equal(store.getCodeSnippet("../outside-secret.txt:1", 0), null);

    const code = store.searchCode("app.get");
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

    const callTrace = store.traceSymbol("createOrder", "inbound", 2, { mode: "calls" });
    assert.ok(callTrace.length > 0);
    assert.ok(callTrace.every((edge) => edge.type === "CALLS" || edge.type === "CALLS_LOCAL"));

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
    assert.ok(schema.nodeLabels.some((label) => label.kind === "graphql_operation"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "graphql_type"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "grpc_service"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "DEFINES"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "CALLS_HTTP_ENDPOINT"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "CONFIGURES"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "EMITS"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "LISTENS_ON"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "USES_TYPE"));
    assert.ok(schema.relationshipPatterns.some((pattern) => pattern.sourceKind === "function" && pattern.type === "CALLS" && pattern.targetKind === "function"));
    assert.ok(schema.relationshipPatterns.some((pattern) => pattern.type === "HTTP_CALLS" && pattern.targetKind === "route"));
    const functionProperties = schema.labelProperties.find((label) => label.kind === "function")?.properties ?? [];
    assert.ok(functionProperties.some((property) => property.name === "qualifiedName" && property.source === "column" && property.type === "string"));
    const routeProperties = schema.labelProperties.find((label) => label.kind === "route")?.properties ?? [];
    assert.ok(routeProperties.some((property) => property.name === "method" && property.source === "metadata" && property.type === "string"));
    assert.ok(routeProperties.some((property) => property.name === "path" && property.source === "metadata" && property.type === "string"));

    const typeUsage = store.queryGraph("MATCH (a)-[r:USES_TYPE]->(b) WHERE b.name = 'Order' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(typeUsage.rows.some((row) => row["b.name"] === "Order" && row["r.type"] === "USES_TYPE"));

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

    const dependencyMatches = store.searchGraph({ kind: "dependency", query: "commons-lang3" });
    assert.ok(dependencyMatches.some((match) => match.symbol.name === "org.apache.commons:commons-lang3"));
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

    const vectorMatches = store.vectorSearch("create order total", 5);
    assert.ok(vectorMatches.some((match) => match.symbol.name === "createOrder"));
    assert.ok(vectorMatches[0]?.vector.dimensions === 384);
    assert.ok(vectorMatches[0]?.vector.nonZero > 0);
    assert.ok(vectorMatches.some((match) => match.matchedTokens.includes("order")));

    const nodeQuery = store.queryGraph("MATCH (f:Function) WHERE f.name = 'createOrder' RETURN f.name,f.filePath LIMIT 5");
    assert.equal(nodeQuery.rows[0]?.["f.name"], "createOrder");
    assert.equal(nodeQuery.rows[0]?.["f.filePath"], "src/orders.ts");

    const inQuery = store.queryGraph("MATCH (s) WHERE s.kind IN ['function', 'method'] RETURN s.kind LIMIT 10");
    assert.ok(inQuery.rows.length > 0);
    assert.ok(inQuery.rows.every((row) => row["s.kind"] === "function" || row["s.kind"] === "method"));

    const orNodeQuery = store.queryGraph("MATCH (s) WHERE s.kind = 'route' OR s.kind = 'http_call' RETURN s.kind LIMIT 50");
    const orNodeKinds = new Set(orNodeQuery.rows.map((row) => row["s.kind"]));
    assert.ok(orNodeKinds.has("route"));
    assert.ok(orNodeKinds.has("http_call"));
    assert.ok(orNodeQuery.rows.every((row) => row["s.kind"] === "route" || row["s.kind"] === "http_call"));

    const numericQuery = store.queryGraph("MATCH (f:Function) WHERE f.startLine > 1 RETURN f.name,f.startLine LIMIT 10");
    assert.ok(numericQuery.rows.length > 0);
    assert.ok(numericQuery.rows.every((row) => Number(row["f.startLine"]) > 1));

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

    const orEdgeQuery = store.queryGraph("MATCH (a)-[r]->(b) WHERE r.type = 'HTTP_CALLS' OR r.type = 'CALLS_HTTP_ENDPOINT' RETURN a.name,b.name,r.type LIMIT 20");
    const orEdgeTypes = new Set(orEdgeQuery.rows.map((row) => row["r.type"]));
    assert.ok(orEdgeTypes.has("HTTP_CALLS"));
    assert.ok(orEdgeTypes.has("CALLS_HTTP_ENDPOINT"));
    assert.ok(orEdgeQuery.rows.every((row) => row["r.type"] === "HTTP_CALLS" || row["r.type"] === "CALLS_HTTP_ENDPOINT"));

    const precedenceQuery = store.queryGraph(
      "MATCH (s) WHERE s.kind = 'function' AND s.name = 'loadOrders' OR s.kind = 'function' AND s.name = 'createOrder' RETURN s.name ORDER BY s.name LIMIT 5"
    );
    assert.deepEqual(precedenceQuery.rows.map((row) => row["s.name"]), ["createOrder", "loadOrders"]);

    const weightedEdgeQuery = store.queryGraph("MATCH (a)-[r]->(b) WHERE r.weight >= 0.7 RETURN a.name,b.name,r.weight LIMIT 10");
    assert.ok(weightedEdgeQuery.rows.length > 0);
    assert.ok(weightedEdgeQuery.rows.every((row) => Number(row["r.weight"]) >= 0.7));

    const httpQuery = store.queryGraph("MATCH (a)-[r:HTTP_CALLS]->(b:Route) WHERE b.name CONTAINS '/orders' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(httpQuery.rows.some((row) => row["a.name"] === "loadOrders" && row["r.type"] === "HTTP_CALLS"));

    const httpCallMatches = store.searchGraph({ kind: "http_call", query: "/orders" });
    assert.ok(httpCallMatches.some((match) => match.symbol.name === "GET /orders" && match.symbol.filePath === "src/client.ts"));
    const httpEndpointQuery = store.queryGraph("MATCH (a)-[r:CALLS_HTTP_ENDPOINT]->(b) WHERE b.name CONTAINS '/orders' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(httpEndpointQuery.rows.some((row) => row["a.name"] === "loadOrders" && row["r.type"] === "CALLS_HTTP_ENDPOINT"));
    const crossServiceTrace = store.traceSymbol("loadOrders", "outbound", 2, { mode: "cross_service" });
    assert.ok(crossServiceTrace.some((edge) => edge.type === "CALLS_HTTP_ENDPOINT"));
    assert.ok(crossServiceTrace.every((edge) => ["HTTP_CALLS", "CALLS_HTTP_ENDPOINT", "OBSERVED_HTTP_CALLS", "EMITS", "LISTENS_ON", "OBSERVED_EMITS", "OBSERVED_LISTENS_ON"].includes(edge.type)));

    assert.ok(store.searchGraph({ kind: "graphql_operation", query: "GetOrders" }).some((match) => match.symbol.name === "query GetOrders"));
    assert.ok(store.searchGraph({ kind: "graphql_type", query: "Order" }).some((match) => match.symbol.name === "type Order"));
    assert.ok(store.searchGraph({ kind: "grpc_service", query: "OrderService" }).some((match) => match.symbol.name === "OrderService"));
    assert.ok(store.searchGraph({ kind: "route", query: "OrderService" }).some((match) => match.symbol.name === "RPC /OrderService/CreateOrder"));
    assert.ok(store.searchGraph({ kind: "route", query: "openapi" }).some((match) => match.symbol.metadata?.protocol === "openapi"));
    assert.ok(store.searchGraph({ kind: "route", query: "/orders/:id" }).some((match) => match.symbol.name === "GET /orders/:id"));

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

    const pack = contextPack("createOrder", 8, 1, dbPath);
    assert.ok(pack.semantic.some((match) => match.symbol.name === "createOrder"));
    assert.ok(pack.vector.some((match) => match.symbol.name === "createOrder"));
    assert.ok(pack.code.some((match) => match.text.includes("createOrder")));
    assert.ok(pack.snippets.some((snippet) => snippet.symbol?.name === "createOrder"));
    assert.ok(pack.edges.length > 0);

    assert.throws(() => store.queryGraph("MATCH (f) DELETE f RETURN f.name"), /read-only/);
    assert.throws(() => store.queryGraph("MATCH (f:Function) WHERE f.startLine > RETURN f.name"), /> requires a numeric WHERE value/);
    assert.throws(() => store.queryGraph("MATCH (s) WHERE s.kind = 'function' OR RETURN s.name"), /Unsupported WHERE condition/);

    const swiftSymbols = store.searchGraph({ kind: "class", filePattern: "ios" });
    assert.ok(swiftSymbols.some((match) => match.symbol.name === "CheckoutViewModel"));

    const deadCode = store.findDeadCode();
    assert.ok(deadCode.some((candidate) => candidate.symbol.name === "normalizeOrder"));

    const markdownReport = architectureReport({ graphLimit: 50 }, dbPath);
    assert.match(markdownReport, /# RepoLens Architecture Report/);
    assert.match(markdownReport, /## Graph Schema/);
    assert.match(markdownReport, /submitOrder/);

    const htmlReport = architectureReport({ format: "html", graphLimit: 50 }, dbPath);
    assert.match(htmlReport, /<!doctype html>/);
    assert.match(htmlReport, /RepoLens Architecture Report/);
    assert.match(htmlReport, /CheckoutViewModel/);
  } finally {
    store.close();
  }
});

test("benchmarks full and incremental indexing with graph evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-benchmark-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await benchmarkRepository({
    root: fixture,
    dbPath,
    maxFileBytes: 750000,
    runLabel: "benchmark-fixture"
  });

  assert.equal(result.root, fixture);
  assert.equal(result.dbPath, dbPath);
  assert.equal(result.fullIndex.mode, "full");
  assert.equal(result.incrementalIndex.mode, "incremental");
  assert.equal(result.fullIndex.filesIndexed, 22);
  assert.equal(result.incrementalIndex.filesUnchanged, 22);
  assert.ok(result.fullIndex.symbols > 0);
  assert.ok(result.fullIndex.edges > 0);
  assert.equal(result.architecture.totals.symbols, result.fullIndex.symbols);
  assert.ok(result.architecture.languages.some((item) => item.language === "typescript"));
  assert.ok(result.throughput.fullFilesPerSecond > 0);
  assert.ok(result.throughput.incrementalFilesPerSecond > 0);
  assert.equal(result.secretScan?.findings, 0);
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
    assert.ok(store.searchSymbols("createOrder").some((symbol) => symbol.name === "createOrder"));
  } finally {
    store.close();
  }
});

test("index can write a reusable graph package", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-index-package-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(repo, ".repolens", "memory.db");
  const packagePath = path.join(repo, ".repolens", "graph.rlgz");
  const importedDbPath = path.join(tmp, "imported.db");
  await fs.cp(fixture, repo, { recursive: true });

  const result = await indexRepository({ root: repo, dbPath, runLabel: "index-package", writePackage: ".repolens/graph.rlgz" });
  assert.equal(result.graphPackage?.outPath, packagePath);
  assert.equal(result.graphPackage?.label, "index-package");
  assert.ok(result.graphPackage.packageBytes > 0);

  const imported = await unpackGraph(packagePath, importedDbPath);
  assert.equal(imported.totals.files, result.filesIndexed);
  assert.equal(imported.totals.symbols, result.symbols);
  assert.equal(imported.totals.edges, result.edges);
});

test("bootstraps a missing database from a default graph package", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-bootstrap-"));
  const repo = path.join(tmp, "repo");
  await fs.cp(fixture, repo, { recursive: true });
  const seedDbPath = path.join(tmp, "seed.db");
  await indexRepository({ root: repo, dbPath: seedDbPath });

  const packagePath = path.join(repo, ".repolens", "graph.rlgz");
  await packGraph(packagePath, seedDbPath, "bootstrap-fixture");

  const bootDbPath = path.join(tmp, "bootstrapped.db");
  const result = await indexRepository({ root: repo, dbPath: bootDbPath });
  assert.equal(result.mode, "incremental");
  assert.equal(result.bootstrapPackage?.label, "bootstrap-fixture");
  assert.equal(result.bootstrapPackage?.dbPath, bootDbPath);
  assert.ok(result.filesUnchanged > 0);
  assert.ok(result.symbols >= 14);

  const noBootstrapDbPath = path.join(tmp, "no-bootstrap.db");
  const noBootstrap = await indexRepository({ root: repo, dbPath: noBootstrapDbPath, bootstrapPackage: false });
  assert.equal(noBootstrap.mode, "full");
  assert.equal(noBootstrap.bootstrapPackage, undefined);
});

test("indexes package-manager lockfiles as resolved dependency graph nodes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-lockfiles-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.mkdir(repo, { recursive: true });
  await fs.writeFile(
    path.join(repo, "package-lock.json"),
    JSON.stringify(
      {
        name: "lock-demo",
        lockfileVersion: 3,
        packages: {
          "": { name: "lock-demo", version: "1.0.0" },
          "node_modules/express": { version: "4.18.3" },
          "node_modules/@scope/toolkit": { version: "2.1.0" }
        }
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(repo, "pnpm-lock.yaml"),
    [
      "lockfileVersion: '9.0'",
      "packages:",
      "  express@4.18.3:",
      "    resolution: {integrity: sha512-demo}",
      "  /@scope/toolkit@2.1.0:",
      "    resolution: {integrity: sha512-demo}"
    ].join("\n")
  );
  await fs.writeFile(
    path.join(repo, "yarn.lock"),
    [
      "# yarn lockfile v1",
      '"left-pad@^1.3.0":',
      '  version "1.3.0"',
      '  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"'
    ].join("\n")
  );
  await fs.writeFile(
    path.join(repo, "Cargo.lock"),
    [
      "[[package]]",
      'name = "serde"',
      'version = "1.0.203"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"'
    ].join("\n")
  );
  await fs.writeFile(path.join(repo, "go.sum"), "github.com/gin-gonic/gin v1.10.0 h1:abc\ngithub.com/gin-gonic/gin v1.10.0/go.mod h1:def\n");
  await fs.writeFile(
    path.join(repo, "Gemfile.lock"),
    [
      "GEM",
      "  remote: https://rubygems.org/",
      "  specs:",
      "    rack (3.0.9)",
      "      nio4r (~> 2.0)"
    ].join("\n")
  );
  await fs.writeFile(
    path.join(repo, "composer.lock"),
    JSON.stringify(
      {
        packages: [{ name: "symfony/http-foundation", version: "v7.1.0" }],
        "packages-dev": [{ name: "phpunit/phpunit", version: "11.1.3" }]
      },
      null,
      2
    )
  );

  const result = await indexRepository({ root: repo, dbPath });
  assert.equal(result.filesIndexed, 7);

  const store = new MemoryStore(dbPath);
  try {
    const schema = store.graphSchema();
    assert.ok(schema.nodeLabels.some((label) => label.kind === "lockfile"));
    assert.ok(schema.nodeLabels.some((label) => label.kind === "locked_dependency"));
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "LOCKS"));

    const lockfiles = store.searchGraph({ kind: "lockfile", limit: 20 });
    assert.equal(lockfiles.length, 7);
    assert.ok(lockfiles.some((match) => match.symbol.metadata?.packageManager === "npm"));
    assert.ok(lockfiles.some((match) => match.symbol.metadata?.packageManager === "bundler"));

    const dependencies = store.searchGraph({ kind: "locked_dependency", limit: 50 });
    const names = new Set(dependencies.map((match) => match.symbol.name));
    assert.ok(names.has("express"));
    assert.ok(names.has("@scope/toolkit"));
    assert.ok(names.has("left-pad"));
    assert.ok(names.has("serde"));
    assert.ok(names.has("github.com/gin-gonic/gin"));
    assert.ok(names.has("rack"));
    assert.ok(names.has("symfony/http-foundation"));

    const query = store.queryGraph("MATCH (a)-[r:LOCKS]->(b) WHERE b.name = 'express' RETURN a.name,b.name,r.type LIMIT 5");
    assert.ok(query.rows.some((row) => row["a.name"] === "package-lock.json" && row["r.type"] === "LOCKS"));
  } finally {
    store.close();
  }
});

test("scans indexed lines for redacted secret findings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-secrets-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "tests"), { recursive: true });
  const awsKey = "AKIA1234567890ABCDEF";
  const githubToken = "ghp_abcdefghijklmnopqrstuvwxyzABCDEFGH1234";
  const password = "correct-horse-battery-staple";
  const openAiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
  await fs.writeFile(
    path.join(repo, "src", "config.ts"),
    [
      `export const awsAccessKey = "${awsKey}";`,
      `export const gh = "${githubToken}";`,
      `export const databasePassword = "${password}";`,
      `export const placeholder = "your_api_key_here";`,
      "export const apiKey = process.env.API_KEY;"
    ].join("\n")
  );
  await fs.writeFile(path.join(repo, "tests", "config.test.ts"), `const token = "${openAiKey}";\n`);

  await indexRepository({ root: repo, dbPath });
  const store = new MemoryStore(dbPath);
  try {
    const scan = store.scanSecrets({ limit: 20 });
    const serialized = JSON.stringify(scan);
    assert.ok(scan.scannedLines > 0);
    assert.ok(scan.findings.some((finding) => finding.kind === "aws_access_key"));
    assert.ok(scan.findings.some((finding) => finding.kind === "github_token"));
    assert.ok(scan.findings.some((finding) => finding.kind === "sensitive_assignment" && finding.label === "databasePassword"));
    assert.ok(scan.findings.some((finding) => finding.kind === "sensitive_reference" && finding.confidence === "low"));
    assert.ok(scan.findings.every((finding) => !finding.filePath.startsWith("tests/")));
    assert.ok(scan.risks.some((risk) => risk.includes("high-severity secret patterns")));
    assert.equal(serialized.includes(awsKey), false);
    assert.equal(serialized.includes(githubToken), false);
    assert.equal(serialized.includes(password), false);
    assert.equal(serialized.includes("your_api_key_here"), false);

    const mediumOnly = store.scanSecrets({ minConfidence: "medium", limit: 20 });
    assert.ok(mediumOnly.findings.every((finding) => finding.confidence === "medium" || finding.confidence === "high"));
    assert.ok(!mediumOnly.findings.some((finding) => finding.kind === "sensitive_reference"));

    const withTests = store.scanSecrets({ includeTests: true, minConfidence: "high", limit: 20 });
    assert.ok(withTests.findings.some((finding) => finding.kind === "openai_key" && finding.filePath === "tests/config.test.ts"));
    assert.equal(JSON.stringify(withTests).includes(openAiKey), false);

    const limited = store.scanSecrets({ includeTests: true, limit: 1 });
    assert.equal(limited.findings.length, 1);
    assert.ok(limited.totals.findings > limited.findings.length);
    assert.ok(limited.risks.some((risk) => risk.includes("showing 1 of")));
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

test("git-aware watch skips unchanged polls and refreshes dirty worktrees", async (t) => {
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status !== 0) {
    t.skip("git is not available");
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-git-watch-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.cp(fixture, repo, { recursive: true });
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  spawnSync("git", ["init", repo], { encoding: "utf8" });
  runGit("config", "user.email", "repolens@example.test");
  runGit("config", "user.name", "RepoLens Test");
  runGit("add", ".");
  runGit("commit", "-m", "initial graph");

  const observed: string[] = [];
  const skipped: string[] = [];
  let dirtied = false;
  const summary = await watchRepository({
    root: repo,
    dbPath,
    intervalMs: 250,
    maxRuns: 2,
    maxPolls: 4,
    gitAware: true,
    onResult: (result) => observed.push(result.mode),
    onSkip: () => {
      skipped.push("git-unchanged");
      if (!dirtied) {
        dirtied = true;
        fsSync.appendFileSync(path.join(repo, "src", "orders.ts"), "\nexport function watchModeChange() { return orders.length; }\n");
      }
    }
  });

  assert.equal(summary.runs.length, 2);
  assert.deepEqual(observed, ["full", "incremental"]);
  assert.equal(skipped.length, 1);
  assert.equal(summary.skippedPolls.length, 1);
  assert.ok(summary.polls >= 3);
  assert.equal(summary.runs[1]?.mode, "incremental");
  const store = new MemoryStore(dbPath);
  try {
    assert.ok(store.searchSymbols("watchModeChange", "function", 5).some((match) => match.name === "watchModeChange"));
  } finally {
    store.close();
  }
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

test("indexes resolved local import file edges for aliases and workspace packages", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-import-edges-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.mkdir(path.join(repo, "packages", "api", "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "packages", "domain", "src"), { recursive: true });
  await fs.writeFile(
    path.join(repo, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@domain/*": ["packages/domain/src/*"]
          }
        }
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(repo, "package.json"), JSON.stringify({ name: "import-edge-root", workspaces: ["packages/*"] }, null, 2));
  await fs.writeFile(path.join(repo, "packages", "api", "package.json"), JSON.stringify({ name: "@demo/api" }, null, 2));
  await fs.writeFile(path.join(repo, "packages", "domain", "package.json"), JSON.stringify({ name: "@demo/domain" }, null, 2));
  await fs.writeFile(
    path.join(repo, "packages", "api", "src", "index.ts"),
    [
      `import { priceOrder } from "@domain/order";`,
      `import { domainName } from "@demo/domain";`,
      "export function handleOrder() { return priceOrder() + domainName.length; }"
    ].join("\n")
  );
  await fs.writeFile(path.join(repo, "packages", "domain", "src", "index.ts"), `export const domainName = "domain";\n`);
  await fs.writeFile(
    path.join(repo, "packages", "domain", "src", "order.ts"),
    [`import { handleOrder } from "../../api/src/index";`, "export function priceOrder() { return handleOrder ? 42 : 0; }"].join("\n")
  );

  await indexRepository({ root: repo, dbPath });
  const store = new MemoryStore(dbPath);
  try {
    const schema = store.graphSchema();
    assert.ok(schema.edgeTypes.some((edgeType) => edgeType.type === "IMPORTS_FILE"));

    const importRows = store.queryGraph(
      "MATCH (a)-[r:IMPORTS_FILE]->(b) RETURN a.filePath,b.filePath,r.type LIMIT 20"
    ).rows;
    assert.ok(
      importRows.some(
        (row) =>
          row["a.filePath"] === "packages/api/src/index.ts" &&
          row["b.filePath"] === "packages/domain/src/order.ts" &&
          row["r.type"] === "IMPORTS_FILE"
      )
    );
    assert.ok(
      importRows.some(
        (row) =>
          row["a.filePath"] === "packages/api/src/index.ts" &&
          row["b.filePath"] === "packages/domain/src/index.ts" &&
          row["r.type"] === "IMPORTS_FILE"
      )
    );
    assert.ok(
      importRows.some(
        (row) =>
          row["a.filePath"] === "packages/domain/src/order.ts" &&
          row["b.filePath"] === "packages/api/src/index.ts" &&
          row["r.type"] === "IMPORTS_FILE"
      )
    );

    const cycles = store.dependencyCycles();
    assert.equal(cycles.length, 1);
    assert.deepEqual(cycles[0].clusters, ["packages/api", "packages/domain"]);
    assert.ok(cycles[0].sampleEdges.some((edge) => edge.type === "IMPORTS_FILE"));
  } finally {
    store.close();
  }
});

test("adds git history hotspots to architecture summaries", async (t) => {
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status !== 0) {
    t.skip("git is not available");
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-git-history-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  spawnSync("git", ["init", repo], { encoding: "utf8" });
  runGit("config", "user.email", "repolens@example.test");
  runGit("config", "user.name", "RepoLens Test");
  await fs.writeFile(path.join(repo, "src", "orders.ts"), "export function createOrder() { return 1; }\n");
  await fs.writeFile(path.join(repo, "src", "checkout.ts"), "export function checkout() { return true; }\n");
  runGit("add", ".");
  runGit("commit", "-m", "initial graph");
  await fs.appendFile(path.join(repo, "src", "orders.ts"), "export function cancelOrder() { return 0; }\n");
  runGit("add", ".");
  runGit("commit", "-m", "expand orders");

  await indexRepository({ root: repo, dbPath });
  const store = new MemoryStore(dbPath);
  try {
    const arch = store.architecture(repo);
    const history = arch.gitHistory.find((item) => item.path === "src/orders.ts");
    assert.ok(history);
    assert.equal(history.commits, 2);
    assert.equal(history.authors, 1);
    assert.ok(history.churn >= 2);
    assert.equal(history.lastSubject, "expand orders");
    assert.ok(arch.recommendations.some((item) => item.title === "Inspect high-churn files before risky edits"));

    const markdownReport = architectureReport({ graphLimit: 20 }, dbPath);
    assert.match(markdownReport, /## Git History Hotspots/);
    assert.match(markdownReport, /src\/orders\.ts/);
  } finally {
    store.close();
  }
});

test("detects git change blast radius with per-file details", async (t) => {
  const git = spawnSync("git", ["--version"], { encoding: "utf8" });
  if (git.status !== 0) {
    t.skip("git is not available");
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-change-impact-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.cp(fixture, repo, { recursive: true });
  const runGit = (...args: string[]) => {
    const result = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  spawnSync("git", ["init", repo], { encoding: "utf8" });
  runGit("config", "user.email", "repolens@example.test");
  runGit("config", "user.name", "RepoLens Test");
  runGit("add", ".");
  runGit("commit", "-m", "initial graph");
  await indexRepository({ root: repo, dbPath });

  await fs.appendFile(path.join(repo, "src", "orders.ts"), "\nexport function cancelOrder() { return orders.pop(); }\n");
  await fs.writeFile(path.join(repo, "src", "draft.ts"), "export function draftOnly() { return true; }\n");

  const store = new MemoryStore(dbPath);
  try {
    const impact = store.detectChanges(repo, 20);
    assert.deepEqual(impact.changedFiles, ["src/draft.ts", "src/orders.ts"]);
    assert.equal(impact.summary.changedFileCount, 2);
    assert.equal(impact.summary.indexedChangedFileCount, 1);
    assert.ok(impact.summary.impactedItemCount > 0);
    assert.ok(impact.summary.directEdgeCount > 0);
    assert.ok(impact.summary.topSymbolKinds.some((kind) => kind.kind === "function"));

    const orders = impact.changedFileDetails.find((file) => file.path === "src/orders.ts");
    assert.ok(orders);
    assert.match(orders.status, /modified/);
    assert.equal(orders.indexed, true);
    assert.ok(orders.symbols > 0);
    assert.ok(orders.directEdges > 0);
    assert.ok(orders.edgeTypes.some((edgeType) => edgeType.type === "DEFINES"));

    const draft = impact.changedFileDetails.find((file) => file.path === "src/draft.ts");
    assert.ok(draft);
    assert.equal(draft.status, "untracked");
    assert.equal(draft.indexed, false);
    assert.equal(draft.risk, "medium");
    assert.ok(impact.signals.some((signal) => signal.includes("not present in the current graph")));
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
