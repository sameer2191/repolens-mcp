import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getRepoLensConfigValue, readRepoLensConfig, resetRepoLensConfigValue, setRepoLensConfigValue } from "../src/core/config.js";

test("persists RepoLens config values with aliases and reset support", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-config-"));
  const configPath = path.join(tmp, "config.json");

  let result = setRepoLensConfigValue("auto-index", "true", configPath);
  assert.equal(result.config.autoIndex, "incremental");

  result = setRepoLensConfigValue("max-file-bytes", "750000", configPath);
  assert.equal(result.config.maxFileBytes, 750000);

  result = setRepoLensConfigValue("auto-index-limit", "1200", configPath);
  assert.equal(result.config.autoIndexFileLimit, 1200);

  result = setRepoLensConfigValue("auto-sync", "true", configPath);
  assert.equal(result.config.autoSync, true);

  result = setRepoLensConfigValue("auto-sync-interval-ms", "1250", configPath);
  assert.equal(result.config.autoSyncIntervalMs, 1250);

  result = setRepoLensConfigValue("bootstrap-package", "off", configPath);
  assert.equal(result.config.bootstrapPackage, false);

  result = setRepoLensConfigValue("auto-index-file-limit", "off", configPath);
  assert.equal(result.config.autoIndexFileLimit, false);

  const loaded = readRepoLensConfig(configPath);
  assert.equal(loaded.path, configPath);
  assert.equal(loaded.config.autoIndex, "incremental");
  assert.equal(loaded.config.autoSync, true);
  assert.equal(loaded.config.autoSyncIntervalMs, 1250);
  assert.equal(loaded.config.maxFileBytes, 750000);
  assert.equal(loaded.config.autoIndexFileLimit, false);
  assert.equal(loaded.config.bootstrapPackage, false);

  const value = getRepoLensConfigValue("autoIndex", configPath);
  assert.equal(value.key, "autoIndex");
  assert.equal(value.value, "incremental");

  const resetOne = resetRepoLensConfigValue("max_file_bytes", configPath);
  assert.equal(resetOne.config.maxFileBytes, undefined);
  assert.equal(resetOne.config.autoIndex, "incremental");

  const resetAll = resetRepoLensConfigValue(undefined, configPath);
  assert.deepEqual(resetAll.config, {});
});
