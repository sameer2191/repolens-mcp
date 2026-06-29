import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import fc from "fast-check";
import { unpackGraph } from "../src/core/api.js";
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

test("generated import traversal payloads cannot escape resolver roots", () => {
  const symbols = [
    fileSymbol("src/consumer.ts"),
    fileSymbol("src/safe.ts"),
    fileSymbol("packages/pkg/src/index.ts"),
    packageSymbol("@local/pkg", "packages/pkg/package.json"),
    fileSymbol("secret.ts")
  ];
  const traversalPayloads = [
    "@/../secret",
    "@alias/../secret",
    "src/../secret",
    "apps/../secret",
    "packages/../secret",
    "services/../secret",
    "@local/pkg/../../secret",
    "@/safe/../../secret",
    "src/safe/../../secret"
  ];
  const validImports = [
    "@/safe",
    "@alias/safe",
    "@local/pkg"
  ];
  const fileContents = new Map([
    [
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "@alias/*": ["src/*"]
          }
        }
      })
    ],
    [
      "src/consumer.ts",
      [...traversalPayloads, ...validImports].map((specifier, index) => `import value${index} from "${specifier}";`).join("\n")
    ],
    ["src/safe.ts", `export default "safe";`],
    ["packages/pkg/src/index.ts", `export default "package";`],
    ["secret.ts", `export default "hidden";`]
  ]);

  const edges = buildResolvedImportEdges(symbols, fileContents);

  assert.ok(!edges.some((edge) => edge.target === "secret.ts:file"));
  assert.ok(edges.some((edge) => edge.metadata?.import === "@/safe" && edge.target === "src/safe.ts:file"));
  assert.ok(edges.some((edge) => edge.metadata?.import === "@alias/safe" && edge.target === "src/safe.ts:file"));
  assert.ok(edges.some((edge) => edge.metadata?.import === "@local/pkg" && edge.target === "packages/pkg/src/index.ts:file"));
});

test("import resolver fuzzing blocks generated traversal payloads", () => {
  const symbols = [
    fileSymbol("src/consumer.ts"),
    fileSymbol("src/safe.ts"),
    fileSymbol("apps/safe.ts"),
    fileSymbol("packages/pkg/src/index.ts"),
    fileSymbol("services/safe.ts"),
    packageSymbol("@local/pkg", "packages/pkg/package.json"),
    fileSymbol("secret.ts")
  ];

  fc.assert(
    fc.property(traversalSpecifierArbitrary(), (specifier) => {
      const fileContents = new Map([
        [
          "tsconfig.json",
          JSON.stringify({
            compilerOptions: {
              baseUrl: ".",
              paths: {
                "@alias/*": ["src/*"]
              }
            }
          })
        ],
        ["src/consumer.ts", `import value from "${specifier}";\nvalue;`],
        ["src/safe.ts", `export default "safe";`],
        ["apps/safe.ts", `export default "safe";`],
        ["packages/pkg/src/index.ts", `export default "package";`],
        ["services/safe.ts", `export default "safe";`],
        ["secret.ts", `export default "hidden";`]
      ]);

      const edges = buildResolvedImportEdges(symbols, fileContents);

      assert.ok(!edges.some((edge) => edge.target === "secret.ts:file"));
    }),
    { numRuns: 250, seed: 20260618 }
  );
});

test("source-root and package import fuzzing resolves only expected files", () => {
  fc.assert(
    fc.property(safeSpecifierArbitrary(), ({ specifier, targetPath }) => {
      fc.pre(targetPath !== "src/consumer.ts");
      const symbols = [
        fileSymbol("src/consumer.ts"),
        fileSymbol(targetPath),
        packageSymbol("@local/pkg", "packages/pkg/package.json")
      ];
      const fileContents = new Map([
        [
          "tsconfig.json",
          JSON.stringify({
            compilerOptions: {
              baseUrl: ".",
              paths: {
                "@alias/*": ["src/*"]
              }
            }
          })
        ],
        ["src/consumer.ts", `import value from "${specifier}";\nvalue;`],
        [targetPath, `export default "safe";`]
      ]);

      const edges = buildResolvedImportEdges(symbols, fileContents);

      assert.deepEqual(
        edges.map((edge) => edge.target),
        [`${targetPath}:file`]
      );
    }),
    { numRuns: 200, seed: 20260619 }
  );
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

test("code snippets only read indexed files inside the latest repository root", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-snippet-boundary-"));
  const repo = path.join(tmp, "repo");
  const outside = path.join(tmp, "outside-secret.txt");
  await fs.mkdir(path.join(repo, "src"), { recursive: true });
  await fs.writeFile(path.join(repo, "src", "index.ts"), "export const safe = true;\n");
  await fs.writeFile(outside, "outside secret\n");

  const store = new MemoryStore(path.join(tmp, "memory.db"));
  try {
    store.recordRun(repo, null, new Date().toISOString());
    store.insertFile({
      path: "src/index.ts",
      language: "typescript",
      bytes: 26,
      lines: 1,
      sha256: "safe",
      skipped: false
    });
    store.insertCodeLines("src/index.ts", ["export const safe = true;"]);

    assert.equal(store.getCodeSnippet(`${outside}:1`), null);
    assert.equal(store.getCodeSnippet("../outside-secret.txt:1"), null);
    assert.equal(store.getCodeSnippet("src/index.ts:1")?.lines[0]?.text, "export const safe = true;");
  } finally {
    store.close();
  }
});

test("GitHub security summary validates response-controlled pagination URLs", async () => {
  const script = await fs.readFile(path.join(process.cwd(), "scripts", "github-security-summary.mjs"), "utf8");

  assert.ok(script.includes('response.headers.get("link")'));
  assert.ok(script.includes("paginationParametersFromLink"));
  assert.ok(script.includes("nextUrl.origin !== expected.origin"));
  assert.ok(script.includes("nextUrl.pathname !== expected.pathname"));
  assert.ok(script.includes('for (const key of ["after", "before", "page"])'));
  assert.ok(!script.includes("url = new URL(next)"));
});

test("MCP server manifest pins npx package resolution", async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), "server.json"), "utf8")) as { command?: string; args?: string[] };

  assert.equal(manifest.command, "npx");
  assert.ok(manifest.args?.some((arg) => /^repolens-mcp@\d+\.\d+\.\d+$/.test(arg)));
  assert.ok(!manifest.args?.includes("repolens-mcp"));
});

test("graph package import rejects oversized sqlite payload declarations before decompression", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-package-boundary-"));
  const packagePath = path.join(tmp, "huge.rlgz");
  const header = {
    magic: "REPOLENS_GRAPH_PACKAGE_V1",
    createdAt: new Date().toISOString(),
    sourceDbPath: "/tmp/source.db",
    sqliteBytes: 512 * 1024 * 1024 + 1,
    sha256: "0".repeat(64)
  };
  await fs.writeFile(packagePath, `${JSON.stringify(header)}\nnot-a-gzip-payload`);

  await assert.rejects(() => unpackGraph(packagePath, path.join(tmp, "out.db")), /sqliteBytes/);
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

function packageSymbol(name: string, filePath: string): SymbolNode {
  return {
    filePath,
    language: "json",
    kind: "package",
    name,
    qualifiedName: `${filePath}:${name}`,
    startLine: 1,
    endLine: 1
  };
}

const safeSegmentArbitrary = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/);

function safeSubpathArbitrary(): fc.Arbitrary<string> {
  return fc.array(safeSegmentArbitrary, { minLength: 1, maxLength: 4 }).map((segments) => segments.join("/"));
}

function traversalSubpathArbitrary(): fc.Arbitrary<string> {
  return fc
    .array(fc.oneof(safeSegmentArbitrary, fc.constantFrom("..", ".")), { minLength: 1, maxLength: 5 })
    .filter((segments) => segments.some((segment) => segment === ".." || segment === "."))
    .map((segments) => segments.join("/"));
}

function traversalSpecifierArbitrary(): fc.Arbitrary<string> {
  return fc
    .tuple(fc.constantFrom("@/", "@alias/", "src/", "apps/", "packages/", "services/", "@local/pkg/"), traversalSubpathArbitrary())
    .map(([prefix, subpath]) => `${prefix}${subpath}`);
}

function safeSpecifierArbitrary(): fc.Arbitrary<{ specifier: string; targetPath: string }> {
  return fc
    .tuple(fc.constantFrom("@/", "@alias/", "src/", "apps/", "services/", "@local/pkg/"), safeSubpathArbitrary())
    .map(([prefix, subpath]) => {
      if (prefix === "@/" || prefix === "@alias/") {
        return { specifier: `${prefix}${subpath}`, targetPath: `src/${subpath}.ts` };
      }
      if (prefix === "@local/pkg/") {
        return { specifier: `${prefix}${subpath}`, targetPath: `packages/pkg/${subpath}.ts` };
      }
      return { specifier: `${prefix}${subpath}`, targetPath: `${prefix}${subpath}.ts` };
    });
}
