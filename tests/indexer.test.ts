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

  assert.equal(result.filesIndexed, 4);
  assert.ok(result.symbols >= 9);
  assert.ok(result.edges >= 8);

  const store = new MemoryStore(dbPath);
  try {
    const symbols = store.searchSymbols("createOrder");
    assert.equal(symbols[0]?.name, "createOrder");

    const code = store.searchCode("/orders");
    assert.ok(code.some((match) => match.text.includes("app.get")));

    const arch = store.architecture(fixture);
    assert.equal(arch.languages[0]?.language, "typescript");
    assert.ok(arch.entrypoints.some((entry) => entry.path.includes("server.ts")));

    const trace = store.traceSymbol("createOrder", "inbound", 2);
    assert.ok(trace.some((edge) => edge.source.includes("server.ts")));
  } finally {
    store.close();
  }
});
