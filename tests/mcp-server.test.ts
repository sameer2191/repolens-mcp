import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { maybeAutoIndexOnStartup } from "../src/mcp/server.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");

test("MCP startup auto-index is disabled by default", async () => {
  const result = await maybeAutoIndexOnStartup({}, fixture);
  assert.equal(result, undefined);
});

test("MCP startup auto-index indexes the configured repository", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-auto-index-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await maybeAutoIndexOnStartup(
    {
      REPOLENS_AUTO_INDEX: "1",
      REPOLENS_DB: dbPath,
      REPOLENS_MAX_FILE_BYTES: "750000",
      REPOLENS_AUTO_INDEX_LABEL: "startup-test"
    },
    fixture
  );

  assert.equal(result?.mode, "incremental");
  assert.equal(result?.root, fixture);
  assert.equal(result?.dbPath, dbPath);
  assert.ok((result?.symbols ?? 0) > 0);

  const fullResult = await maybeAutoIndexOnStartup(
    {
      REPOLENS_AUTO_INDEX: "full",
      REPOLENS_DB: dbPath
    },
    fixture
  );
  assert.equal(fullResult?.mode, "full");
});
