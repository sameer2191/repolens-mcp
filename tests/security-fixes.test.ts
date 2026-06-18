import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dashboardErrorBody } from "../src/dashboard/server.js";
import { buildResolvedImportEdges } from "../src/core/import-resolver.js";
import { MemoryStore } from "../src/core/store.js";
import type { SymbolNode } from "../src/core/types.js";

test("dashboard API errors return a generic message", () => {
  const body = dashboardErrorBody();

  assert.equal(body, JSON.stringify({ error: "Internal server error" }));
  assert.ok(!body.includes("query_graph"));
  assert.ok(!body.includes("Error:"));
});

test("tsconfig JSON comments do not corrupt comment markers inside strings", () => {
  const symbols = [fileSymbol("src/consumer.ts"), fileSymbol("src/generated/client.ts")];
  const fileContents = new Map([
    [
      "tsconfig.json",
      `{
        // The parser should strip this comment.
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@generated/*": ["src//generated/*"], // The string value keeps its double slash.
          },
        },
      }`
    ],
    ["src/consumer.ts", `import { makeClient } from "@generated/client";\nmakeClient();`],
    ["src/generated/client.ts", `export function makeClient() { return {}; }`]
  ]);

  const edges = buildResolvedImportEdges(symbols, fileContents);

  assert.ok(
    edges.some(
      (edge) =>
        edge.source === "src/consumer.ts:file" &&
        edge.target === "src/generated/client.ts:file" &&
        edge.type === "IMPORTS_FILE" &&
        edge.metadata?.resolver === "path-alias" &&
        edge.metadata?.configFile === "tsconfig.json"
    )
  );
});

test("path alias wildcards reject traversal fragments", () => {
  const symbols = [fileSymbol("src/consumer.ts"), fileSymbol("secret.ts")];
  const fileContents = new Map([
    [
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@/*": ["src/*"]
          }
        }
      })
    ],
    ["src/consumer.ts", `import { secret } from "@/../secret";\nsecret();`],
    ["secret.ts", `export function secret() { return "hidden"; }`]
  ]);

  const edges = buildResolvedImportEdges(symbols, fileContents);

  assert.ok(!edges.some((edge) => edge.target === "secret.ts:file"));
});

test("graph search name patterns are bounded wildcards, not raw regexes", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-name-pattern-"));
  const store = new MemoryStore(path.join(tmp, "memory.db"));
  try {
    store.insertFile({
      path: "src/orders.ts",
      language: "typescript",
      bytes: 80,
      lines: 3,
      sha256: "orders",
      skipped: false
    });
    store.insertSymbol({
      filePath: "src/orders.ts",
      language: "typescript",
      kind: "function",
      name: "createOrder",
      qualifiedName: "src/orders.ts:createOrder",
      startLine: 1,
      endLine: 3
    });

    assert.equal(store.searchGraph({ kind: "function", namePattern: "(a+)+$" }).length, 0);
    assert.equal(store.searchGraph({ kind: "function", namePattern: "create*" }).length, 1);
  } finally {
    store.close();
  }
});

function fileSymbol(filePath: string): SymbolNode {
  return {
    filePath,
    language: "typescript",
    kind: "file",
    name: filePath,
    qualifiedName: `${filePath}:file`,
    startLine: 1,
    endLine: 1
  };
}
