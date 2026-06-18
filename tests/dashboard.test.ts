import assert from "node:assert/strict";
import type http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { indexRepository } from "../src/core/indexer.js";
import { serveDashboard } from "../src/dashboard/server.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");

test("dashboard serves graph, query, search, and report endpoints", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-dashboard-"));
  const dbPath = path.join(tmp, "memory.db");
  await indexRepository({ root: fixture, dbPath });

  let server: http.Server;
  try {
    server = await serveDashboard({ dbPath, port: 0 });
  } catch (error) {
    if (isListenPermissionError(error)) {
      t.skip("local sandbox does not permit binding a dashboard smoke-test port");
      return;
    }
    throw error;
  }

  try {
    const baseUrl = dashboardUrl(server);
    const page = await fetchText(`${baseUrl}/`);
    assert.match(page, /RepoLens MCP/);

    const schema = await fetchJson<{ totals: { files: number; symbols: number; edges: number } }>(`${baseUrl}/api/schema`);
    assert.equal(schema.totals.files, 22);
    assert.ok(schema.totals.symbols > 0);
    assert.ok(schema.totals.edges > 0);

    const graph = await fetchJson<{ nodes: unknown[]; edges: unknown[] }>(`${baseUrl}/api/graph?limit=25`);
    assert.ok(graph.nodes.length > 0);
    assert.ok(graph.edges.length > 0);

    const search = await fetchJson<{ code: unknown[]; symbols: Array<{ name: string }> }>(`${baseUrl}/api/search?q=createOrder`);
    assert.ok(search.symbols.some((symbol) => symbol.name === "createOrder"));

    const query = await fetchJson<{ rows: Array<Record<string, unknown>> }>(
      `${baseUrl}/api/query-graph?q=${encodeURIComponent("MATCH (f:Function) RETURN f.name,f.filePath LIMIT 3")}`
    );
    assert.ok(query.rows.length > 0);

    const report = await fetchText(`${baseUrl}/api/report?format=markdown&graphLimit=25`);
    assert.match(report, /# RepoLens Architecture Report/);
  } finally {
    await closeServer(server);
  }
});

function dashboardUrl(server: http.Server): string {
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.text();
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function isListenPermissionError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "EPERM");
}
