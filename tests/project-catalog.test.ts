import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deleteProject, getProjectStatus, listProjects, runIndex } from "../src/core/api.js";

test("tracks indexed projects in the local catalog", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-catalog-"));
  const previousCatalog = process.env.REPOLENS_CATALOG;
  process.env.REPOLENS_CATALOG = path.join(tmp, "projects.json");

  try {
    const fixture = path.resolve("tests/fixtures/sample-repo");
    const dbPath = path.join(tmp, ".repolens", "fixture.db");
    const result = await runIndex({ root: fixture, dbPath, runLabel: "catalog-fixture" });

    const projects = await listProjects();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].root, fixture);
    assert.equal(projects[0].dbPath, dbPath);
    assert.equal(projects[0].label, "catalog-fixture");
    assert.equal(projects[0].symbols, result.symbols);
    assert.equal(projects[0].dbExists, true);
    assert.equal(projects[0].liveTotals?.symbols, result.symbols);

    const status = await getProjectStatus("catalog-fixture");
    assert.equal(status?.root, fixture);
    assert.equal(status?.liveTotals?.edges, result.edges);

    const deleted = await deleteProject("catalog-fixture", true);
    assert.equal(deleted.removed, 1);
    assert.ok(deleted.deletedDbFiles.includes(dbPath));
    assert.equal((await listProjects()).length, 0);
    await assert.rejects(fs.access(dbPath));
  } finally {
    if (previousCatalog === undefined) {
      delete process.env.REPOLENS_CATALOG;
    } else {
      process.env.REPOLENS_CATALOG = previousCatalog;
    }
  }
});
