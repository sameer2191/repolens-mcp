import assert from "node:assert/strict";
import test from "node:test";
import { compareVersions, encodePackageName, getVersionStatus } from "../src/core/version.js";

test("compares semantic versions for update checks", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareVersions("1.2.0-beta.1", "1.2.0"), -1);
  assert.equal(compareVersions("v2.0.0", "1.9.9"), 1);
});

test("reports local package version without remote registry access", async () => {
  const status = await getVersionStatus();

  assert.equal(status.packageName, "@sameermir/repolens-mcp");
  assert.match(status.installedVersion, /^\d+\.\d+\.\d+/);
  assert.equal(status.registry.checked, false);
  assert.equal(status.updateCommand, "npm install -g @sameermir/repolens-mcp@latest");
});

test("rejects non-http registry URLs", async () => {
  await assert.rejects(
    () => getVersionStatus({ checkRemote: true, registryUrl: "file:///tmp/repolens" }),
    /http or https/
  );
});

test("encodes every slash in scoped package names for registry URLs", () => {
  assert.equal(encodePackageName("@scope/pkg"), "@scope%2fpkg");
  assert.equal(encodePackageName("@scope/pkg/extra"), "@scope%2fpkg%2fextra");
});

test("checks an npm-compatible registry for the latest release", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://registry.example.test/@sameermir%2frepolens-mcp");
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
