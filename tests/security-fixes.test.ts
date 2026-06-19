import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
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

test("GitHub security release gate fails closed when alert endpoints are unavailable", async () => {
  type SecuritySummaryModule = {
    runSecuritySummary: (options: Record<string, unknown>) => Promise<number>;
  };
  const { runSecuritySummary } = (await import(
    pathToFileURL(path.join(process.cwd(), "scripts/github-security-summary.mjs")).href
  )) as SecuritySummaryModule;
  const stdout: string[] = [];
  const stderr: string[] = [];

  const result = await runSecuritySummary({
    apiUrl: "https://api.example.test",
    repository: "sameer/repolens-mcp",
    token: "test-token",
    failOnActionable: true,
    fetchImpl: async (input: URL | string) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname.endsWith("/code-scanning/alerts") || pathname.endsWith("/secret-scanning/alerts")) {
        return new Response("[]", { headers: { "content-type": "application/json" } });
      }
      if (pathname.endsWith("/dependabot/alerts")) {
        return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), {
          status: 403,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      });
    },
    output: {
      log: (message = "") => stdout.push(String(message)),
      error: (message = "") => stderr.push(String(message))
    }
  });

  assert.equal(result, 1);
  assert.match(stdout.join("\n"), /Unavailable alert endpoints/);
  assert.match(stdout.join("\n"), /Dependabot: HTTP 403/);
  assert.match(stderr.join("\n"), /could not verify every actionable alert endpoint/);
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
