import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDiagnosticsPath } from "../src/core/diagnostics.js";
import { indexRepository } from "../src/core/indexer.js";
import { watchRepository } from "../src/core/watcher.js";

const fixture = path.resolve("tests/fixtures/sample-repo");

test("indexRepository writes opt-in JSONL diagnostics without source content", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-diagnostics-index-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  const diagnosticsPath = path.join(repo, ".repolens", "diagnostics.jsonl");
  await fs.cp(fixture, repo, { recursive: true });

  const result = await indexRepository({ root: repo, dbPath, diagnosticsPath });
  const events = await readDiagnostics(diagnosticsPath);
  const eventNames = events.map((event) => event.event);

  assert.ok(eventNames.includes("index.start"));
  assert.ok(eventNames.includes("index.walk"));
  assert.ok(eventNames.includes("index.rebuild"));
  assert.ok(eventNames.includes("index.finish"));
  const finish = events.find((event) => event.event === "index.finish");
  assert.equal(finish?.filesIndexed, result.filesIndexed);
  assert.equal(finish?.symbols, result.symbols);
  assert.equal(finish?.edges, result.edges);

  const body = await fs.readFile(diagnosticsPath, "utf8");
  assert.equal(body.includes("return orders.length"), false);
});

test("watchRepository records watch lifecycle diagnostics", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-diagnostics-watch-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  const diagnosticsPath = path.join(repo, ".repolens", "diagnostics.jsonl");
  await fs.cp(fixture, repo, { recursive: true });

  const summary = await watchRepository({ root: repo, dbPath, diagnosticsPath, intervalMs: 250, maxRuns: 1 });
  const events = await readDiagnostics(diagnosticsPath);
  const eventNames = events.map((event) => event.event);

  assert.equal(summary.runs.length, 1);
  assert.ok(eventNames.includes("watch.start"));
  assert.ok(eventNames.includes("watch.indexed"));
  assert.ok(eventNames.includes("watch.stop"));
  assert.ok(eventNames.includes("index.finish"));
  assert.equal(events.find((event) => event.event === "watch.stop")?.runs, 1);
});

test("diagnostics path accepts true and false-like settings", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-diagnostics-path-"));
  assert.equal(resolveDiagnosticsPath("true", tmp), path.join(tmp, ".repolens", "diagnostics.jsonl"));
  assert.equal(resolveDiagnosticsPath("off", tmp), undefined);
});

test("diagnostics path must stay inside the repository root", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-diagnostics-boundary-"));
  const repo = path.join(tmp, "repo");
  await fs.mkdir(repo, { recursive: true });

  assert.equal(resolveDiagnosticsPath(".repolens/diagnostics.jsonl", repo), path.join(repo, ".repolens", "diagnostics.jsonl"));
  assert.throws(() => resolveDiagnosticsPath("../outside.jsonl", repo), /inside the repository root/);
  assert.throws(() => resolveDiagnosticsPath(path.join(tmp, "outside.jsonl"), repo), /inside the repository root/);
});

async function readDiagnostics(filePath: string): Promise<Array<Record<string, unknown>>> {
  return (await fs.readFile(filePath, "utf8"))
    .trim()
    .split(/\n+/)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
