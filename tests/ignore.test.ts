import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRepoIgnoreMatcher } from "../src/core/ignore.js";
import { indexRepository } from "../src/core/indexer.js";
import { MemoryStore } from "../src/core/store.js";

test("matches .repolensignore-style glob and negation rules", () => {
  const matcher = createRepoIgnoreMatcher(`
# generated output
generated/
src/skip-*.ts
!src/skip-keep.ts
`);

  assert.equal(matcher.shouldIgnore("generated/drop.ts"), true);
  assert.equal(matcher.shouldIgnore("generated", true), true);
  assert.equal(matcher.shouldIgnore("src/skip-me.ts"), true);
  assert.equal(matcher.shouldIgnore("src/skip-keep.ts"), false);
  assert.equal(matcher.shouldIgnore("src/keep.ts"), false);
});

test("bounds .repolensignore rule volume", () => {
  assert.throws(() => createRepoIgnoreMatcher(Array.from({ length: 2001 }, (_, index) => `generated-${index}/`).join("\n")), /rule limit/);
  assert.throws(() => createRepoIgnoreMatcher(`${"a".repeat(501)}\n`), /character limit/);
});

test("honors .repolensignore while indexing repositories", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-ignore-"));
  const repo = path.join(tmp, "repo");
  const dbPath = path.join(tmp, "memory.db");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.mkdir(path.join(repo, "generated"), { recursive: true });
  await fs.writeFile(
    path.join(repo, ".repolensignore"),
    ["generated/", "src/skip-*.ts", "!src/skip-keep.ts", ""].join("\n")
  );
  await fs.writeFile(path.join(repo, "src", "keep.ts"), "export function keep() { return 1; }\n");
  await fs.writeFile(path.join(repo, "src", "skip-me.ts"), "export function skipMe() { return 2; }\n");
  await fs.writeFile(path.join(repo, "src", "skip-keep.ts"), "export function includeMe() { return 3; }\n");
  await fs.writeFile(path.join(repo, "generated", "drop.ts"), "export function drop() { return 4; }\n");

  await indexRepository({ root: repo, dbPath });
  const store = new MemoryStore(dbPath);
  try {
    const functions = store.searchGraph({ kind: "function", query: "" }).map((match) => match.symbol.name);
    assert.ok(functions.includes("keep"));
    assert.ok(functions.includes("includeMe"));
    assert.ok(!functions.includes("skipMe"));
    assert.ok(!functions.includes("drop"));
    assert.ok(!store.listFiles().some((file) => file.path === ".repolensignore"));
  } finally {
    store.close();
  }
});
