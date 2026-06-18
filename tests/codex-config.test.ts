import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { codexManagedBlock, hasMcpServer, installCodexConfig, uninstallCodexConfig, upsertManagedBlock } from "../src/core/codex.js";

test("renders a Codex MCP config block for RepoLens", () => {
  const block = codexManagedBlock({
    serverName: "repolens",
    command: "/opt/homebrew/bin/node",
    cliPath: "/repo/dist/src/cli.js",
    dbPath: ".repolens/memory.db"
  });

  assert.match(block, /\[mcp_servers\.repolens\]/);
  assert.match(block, /"--experimental-sqlite"/);
  assert.match(block, /"\/repo\/dist\/src\/cli\.js"/);
  assert.match(block, /\[mcp_servers\.repolens\.env\]/);
  assert.match(block, /REPOLENS_DB = "\.repolens\/memory\.db"/);
});

test("upserts a single managed RepoLens block", () => {
  const first = codexManagedBlock({ serverName: "repolens", command: "node", cliPath: "/one.js", dbPath: "one.db" });
  const second = codexManagedBlock({ serverName: "repolens", command: "node", cliPath: "/two.js", dbPath: "two.db" });
  const initial = "model = \"gpt-5\"\n";
  const withFirst = upsertManagedBlock(initial, first);
  const withSecond = upsertManagedBlock(withFirst, second);

  assert.equal((withSecond.match(/repolens-mcp managed/g) ?? []).length, 2);
  assert.ok(!withSecond.includes("/one.js"));
  assert.ok(withSecond.includes("/two.js"));
});

test("installCodexConfig refuses to replace unmanaged server without force", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-codex-"));
  const configPath = path.join(tmp, "config.toml");
  await fs.writeFile(configPath, "[mcp_servers.repolens]\ncommand = \"node\"\n");

  const result = await installCodexConfig({
    configPath,
    command: "node",
    cliPath: "/repo/cli.js",
    dbPath: "memory.db"
  });
  const content = await fs.readFile(configPath, "utf8");

  assert.equal(result.changed, false);
  assert.equal(result.alreadyConfigured, true);
  assert.match(result.reason ?? "", /already exists/);
  assert.equal(content, "[mcp_servers.repolens]\ncommand = \"node\"\n");
});

test("installCodexConfig writes a managed block with force or dry run", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-codex-"));
  const configPath = path.join(tmp, "config.toml");

  const dryRun = await installCodexConfig({
    configPath,
    command: "node",
    cliPath: "/repo/cli.js",
    dbPath: "memory.db",
    dryRun: true
  });
  assert.equal(dryRun.changed, true);
  await assert.rejects(() => fs.readFile(configPath, "utf8"));

  const installed = await installCodexConfig({
    configPath,
    command: "node",
    cliPath: "/repo/cli.js",
    dbPath: "memory.db"
  });
  const content = await fs.readFile(configPath, "utf8");

  assert.equal(installed.changed, true);
  assert.equal(hasMcpServer(content, "repolens"), true);
  assert.match(content, /REPOLENS_DB = "memory\.db"/);
});

test("installCodexConfig force replaces unmanaged repolens sections", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-codex-"));
  const configPath = path.join(tmp, "config.toml");
  await fs.writeFile(
    configPath,
    [
      'model = "gpt-5"',
      "",
      "[mcp_servers.repolens]",
      'command = "old-node"',
      'args = ["old.js"]',
      "",
      "[mcp_servers.repolens.env]",
      'REPOLENS_DB = "old.db"',
      "",
      "[mcp_servers.other]",
      'command = "other"'
    ].join("\n")
  );

  await installCodexConfig({
    configPath,
    command: "node",
    cliPath: "/repo/cli.js",
    dbPath: "memory.db",
    force: true
  });
  const content = await fs.readFile(configPath, "utf8");

  assert.equal((content.match(/\[mcp_servers\.repolens\]/g) ?? []).length, 1);
  assert.equal((content.match(/\[mcp_servers\.repolens\.env\]/g) ?? []).length, 1);
  assert.ok(!content.includes("old-node"));
  assert.ok(!content.includes("old.db"));
  assert.match(content, /\[mcp_servers\.other\]/);
  assert.match(content, /REPOLENS_DB = "memory\.db"/);
});

test("uninstallCodexConfig removes only managed RepoLens block", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-codex-"));
  const configPath = path.join(tmp, "config.toml");
  await installCodexConfig({
    configPath,
    command: "node",
    cliPath: "/repo/cli.js",
    dbPath: "memory.db"
  });
  await fs.appendFile(configPath, '\n[mcp_servers.other]\ncommand = "other"\n');

  const result = await uninstallCodexConfig({ configPath });
  const content = await fs.readFile(configPath, "utf8");

  assert.equal(result.changed, true);
  assert.equal(hasMcpServer(content, "repolens"), false);
  assert.match(content, /\[mcp_servers\.other\]/);
});
