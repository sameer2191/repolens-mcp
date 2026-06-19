import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, getVersionStatus } from "../src/core/version.js";

test("compares semantic versions for update checks", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.0-beta.1", "1.2.0"), -1);
  assert.equal(compareVersions("v2.0.0", "1.9.9"), 1);
});

test("reports local package version without remote registry access", async () => {
  const status = await getVersionStatus();

  assert.equal(status.packageName, "repolens-mcp");
  assert.match(status.installedVersion, /^\d+\.\d+\.\d+/);
  assert.equal(status.registry.checked, false);
  assert.equal(status.updateCommand, "npm install -g repolens-mcp@latest");
});

test("rejects non-http registry URLs", async () => {
  await assert.rejects(
    () => getVersionStatus({ checkRemote: true, registryUrl: "file:///tmp/repolens" }),
    /http or https/
  );
});

test("checks an npm-compatible registry for the latest release", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://registry.example.test/repolens-mcp");
    return new Response(JSON.stringify({ "dist-tags": { latest: "9.9.9" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  try {
    const status = await getVersionStatus({
      checkRemote: true,
      registryUrl: "https://registry.example.test",
      timeoutMs: 1000
    });

    assert.equal(status.registry.checked, true);
    assert.equal(status.registry.latestVersion, "9.9.9");
    assert.equal(status.registry.updateAvailable, true);
    assert.equal(status.registry.error, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
