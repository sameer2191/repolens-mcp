import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { MemoryStore } from "../src/core/store.js";

test("persists architecture decisions", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-decision-"));
  const store = new MemoryStore(path.join(tmp, "memory.db"));
  try {
    store.addDecision({
      title: "Use local SQLite",
      status: "accepted",
      body: "Keep repository memory local and inspectable.",
      tags: ["sqlite", "privacy"]
    });
    const decisions = store.listDecisions();
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].title, "Use local SQLite");
    assert.deepEqual(decisions[0].tags, ["sqlite", "privacy"]);
  } finally {
    store.close();
  }
});
