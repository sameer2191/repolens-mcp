import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteProject, fleetGraph, fleetSummary, getProjectStatus, listProjects, runIndex } from "../src/core/api.js";

test("tracks indexed projects in the local catalog", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-catalog-"));
  const previousCatalog = process.env.REPOLENS_CATALOG;
  process.env.REPOLENS_CATALOG = path.join(tmp, "projects.json");

  try {
    const fixture = path.resolve("tests/fixtures/sample-repo");
    const dbPath = path.join(tmp, ".repolens", "fixture.db");
    const result = await runIndex({ root: fixture, dbPath, runLabel: "catalog-fixture" });

    const projects = await listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].root, fixture);
    assert.equal(projects[0].dbPath, dbPath);
    assert.equal(projects[0].label, "catalog-fixture");
    assert.equal(projects[0].symbols, result.symbols);
    assert.equal(projects[0].dbExists, true);
    assert.equal(projects[0].liveTotals?.symbols, result.symbols);

    const status = await getProjectStatus("catalog-fixture");
    assert.equal(status?.root, fixture);
    assert.equal(status?.liveTotals?.edges, result.edges);

    const deleted = await deleteProject("catalog-fixture", true);
    assert.equal(deleted.removed, 1);
    assert.ok(deleted.deletedDbFiles.includes(dbPath));
    assert.equal((await listProjects()).length, 0);
    await assert.rejects(fs.access(dbPath));
  } finally {
    if (previousCatalog === undefined) {
      delete process.env.REPOLENS_CATALOG;
    } else {
      process.env.REPOLENS_CATALOG = previousCatalog;
    }
  }
});

test("summarizes a fleet of indexed projects", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-fleet-"));
  const previousCatalog = process.env.REPOLENS_CATALOG;
  process.env.REPOLENS_CATALOG = path.join(tmp, "projects.json");

  try {
    const fixture = path.resolve("tests/fixtures/sample-repo");
    await Promise.all([
      runIndex({ root: fixture, dbPath: path.join(tmp, "service-a", ".repolens", "memory.db"), runLabel: "service-a" }),
      runIndex({ root: fixture, dbPath: path.join(tmp, "service-b", ".repolens", "memory.db"), runLabel: "service-b" })
    ]);

    const fleet = await fleetSummary();
    assert.equal(fleet.totals.projects, 2);
    assert.equal(fleet.totals.availableProjects, 2);
    assert.ok(fleet.totals.files >= 38);
    assert.ok(fleet.totals.routes >= 6);
    assert.ok(fleet.totals.httpCalls >= 4);
    assert.ok(fleet.totals.serviceLinks >= 2);
    assert.ok(fleet.projects.some((project) => project.label === "service-a" && project.routes.some((route) => route.path === "/orders")));
    assert.ok(fleet.projects.some((project) => project.label === "service-a" && project.httpCalls.some((call) => call.path === "/orders")));
    assert.ok(fleet.sharedDependencies.some((dependency) => dependency.name === "express" && dependency.count === 2));
    assert.ok(fleet.routeOverlaps.some((route) => route.route === "GET /orders" && route.count === 2));
    assert.ok(fleet.serviceLinks.some((link) => link.consumer === "service-a" && link.provider === "service-b" && link.route === "GET /orders" && link.calls >= 1));
    assert.ok(fleet.languages.some((language) => language.language === "typescript" && language.projects === 2));

    const graph = await fleetGraph({ maxNodes: 200, maxEdges: 500 });
    assert.equal(graph.totals.projects, 2);
    assert.equal(graph.totals.projectNodes, 2);
    assert.ok(graph.totals.graphNodes >= 2);
    assert.ok(graph.totals.graphEdges >= 1);
    assert.ok(graph.nodes.some((node) => node.id === "project:service-a" && node.group === "project"));
    assert.ok(graph.nodes.some((node) => node.id === "project:service-b" && node.group === "project"));
    assert.ok(graph.nodes.some((node) => node.id === "dependency:express" && node.group === "dependency"));
    assert.ok(graph.nodes.some((node) => node.id === "route:GET /orders" && node.group === "route"));
    assert.ok(graph.edges.some((edge) => edge.source === "project:service-a" && edge.target === "dependency:express" && edge.type === "DEPENDS_ON"));
    assert.ok(graph.edges.some((edge) => edge.source === "project:service-a" && edge.target === "project:service-b" && edge.type === "CROSS_REPO_HTTP_CALLS"));
    assert.ok(graph.edges.some((edge) => edge.source === "project:service-a" && edge.target === "route:GET /orders" && edge.type === "ROUTE_OVERLAP"));

    const cliPath = path.resolve("dist/src/cli.js");
    const htmlOut = path.join(tmp, "fleet.html");
    const jsonOut = path.join(tmp, "fleet.json");
    runCliFleetGraph(cliPath, htmlOut);
    runCliFleetGraph(cliPath, jsonOut);
    const html = await fs.readFile(htmlOut, "utf8");
    assert.ok(html.includes("RepoLens Fleet Graph"));
    const exportedGraph = JSON.parse(await fs.readFile(jsonOut, "utf8")) as { nodes: unknown[]; edges: unknown[]; totals: { crossRepoEdges: number } };
    assert.equal(exportedGraph.nodes.length, graph.nodes.length);
    assert.equal(exportedGraph.edges.length, graph.edges.length);
    assert.ok(exportedGraph.totals.crossRepoEdges >= 1);
  } finally {
    if (previousCatalog === undefined) {
      delete process.env.REPOLENS_CATALOG;
    } else {
      process.env.REPOLENS_CATALOG = previousCatalog;
    }
  }
});

function runCliFleetGraph(cliPath: string, outPath: string): void {
  const result = spawnSync(
    process.execPath,
    ["--experimental-sqlite", cliPath, "fleet-graph", "--limit", "5", "--max-nodes", "200", "--max-edges", "500", "--out", outPath],
    {
      encoding: "utf8",
      env: process.env
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("scores fleet service links with host-aware confidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-fleet-host-"));
  const previousCatalog = process.env.REPOLENS_CATALOG;
  process.env.REPOLENS_CATALOG = path.join(tmp, "projects.json");

  try {
    const billingRoot = path.join(tmp, "billing-api");
    const inventoryRoot = path.join(tmp, "inventory-api");
    const webRoot = path.join(tmp, "web");
    await writeServiceFixture(
      billingRoot,
      "billing-api",
      `
import express from "express";
const app = express();
app.get("/orders", (_request, response) => response.json([]));
`
    );
    await writeServiceFixture(
      inventoryRoot,
      "inventory-api",
      `
import express from "express";
const app = express();
app.get("/orders", (_request, response) => response.json([]));
`
    );
    await writeServiceFixture(
      webRoot,
      "web",
      `
export async function loadBillingOrders() {
  return fetch("https://billing.internal/orders?limit=10");
}

export async function loadAnyOrders() {
  return fetch("/orders");
}
`
    );

    await Promise.all([
      runIndex({ root: billingRoot, dbPath: path.join(tmp, "billing", ".repolens", "memory.db"), runLabel: "billing-api" }),
      runIndex({ root: inventoryRoot, dbPath: path.join(tmp, "inventory", ".repolens", "memory.db"), runLabel: "inventory-api" }),
      runIndex({ root: webRoot, dbPath: path.join(tmp, "web-db", ".repolens", "memory.db"), runLabel: "web" })
    ]);

    const fleet = await fleetSummary();
    const web = fleet.projects.find((project) => project.label === "web");
    assert.ok(web?.httpCalls.some((call) => call.path === "/orders" && call.host === "billing.internal" && call.urlKind === "absolute"));

    const billingLink = fleet.serviceLinks.find((link) => link.consumer === "web" && link.provider === "billing-api" && link.route === "GET /orders");
    assert.ok(billingLink);
    assert.equal(billingLink.host, "billing.internal");
    assert.equal(billingLink.confidence, 0.95);
    assert.equal(billingLink.matchReason, "method_path_host");

    assert.equal(
      fleet.serviceLinks.find((link) => link.consumer === "web" && link.provider === "inventory-api" && link.host === "billing.internal"),
      undefined
    );
    const inventoryLink = fleet.serviceLinks.find((link) => link.consumer === "web" && link.provider === "inventory-api" && link.route === "GET /orders");
    assert.ok(inventoryLink);
    assert.equal(inventoryLink.confidence, 0.45);
    assert.equal(inventoryLink.matchReason, "method_path_ambiguous");

    const graph = await fleetGraph({ maxNodes: 200, maxEdges: 500 });
    const billingEdge = graph.edges.find((edge) => edge.source === "project:web" && edge.target === "project:billing-api" && edge.type === "CROSS_REPO_HTTP_CALLS");
    assert.ok(billingEdge);
    assert.equal(billingEdge.metadata?.host, "billing.internal");
    assert.equal(billingEdge.metadata?.confidence, 0.95);
    assert.equal(billingEdge.metadata?.matchReason, "method_path_host");
  } finally {
    if (previousCatalog === undefined) {
      delete process.env.REPOLENS_CATALOG;
    } else {
      process.env.REPOLENS_CATALOG = previousCatalog;
    }
  }
});

async function writeServiceFixture(root: string, packageName: string, source: string): Promise<void> {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: packageName, version: "1.0.0", dependencies: { express: "^4.18.0" } }, null, 2));
  await fs.writeFile(path.join(root, "src", "index.ts"), source);
}
