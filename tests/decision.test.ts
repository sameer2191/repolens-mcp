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

test("updates and deletes architecture decisions", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "memory-decision-update-"));
  const store = new MemoryStore(path.join(tmp, "memory.db"));
  try {
    const decision = store.addDecision({
      title: "Use local SQLite",
      status: "proposed",
      body: "Evaluate local storage for repository memory.",
      tags: ["sqlite"]
    });

    const updated = store.updateDecision(decision.id!, {
      status: "accepted",
      body: "Keep repository memory local and inspectable.",
      tags: ["sqlite", "privacy"]
    });

    assert.ok(updated);
    assert.equal(updated.title, "Use local SQLite");
    assert.equal(updated.status, "accepted");
    assert.equal(updated.body, "Keep repository memory local and inspectable.");
    assert.deepEqual(updated.tags, ["sqlite", "privacy"]);
    assert.equal(updated.createdAt, decision.createdAt);

    assert.equal(store.updateDecision(9999, { status: "superseded" }), null);
    assert.deepEqual(store.deleteDecision(9999), { id: 9999, deleted: false });
    assert.deepEqual(store.deleteDecision(decision.id!), { id: decision.id!, deleted: true });
    assert.equal(store.listDecisions().length, 0);
  } finally {
    store.close();
  }
});
