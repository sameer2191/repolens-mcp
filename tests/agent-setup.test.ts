import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentConfigSnippet, installAgentSetup, uninstallAgentSetup } from "../src/core/agents.js";

test("renders multi-agent MCP config snippets", () => {
  const base = {
    serverName: "repolens",
    command: "/usr/bin/node",
    cliPath: "/repo/dist/src/cli.js",
    dbPath: ".repolens/memory.db"
  };

  const codex = agentConfigSnippet("codex", base);
  assert.match(codex, /\[mcp_servers\.repolens\]/);
  assert.match(codex, /REPOLENS_DB = "\.repolens\/memory\.db"/);

  const claude = JSON.parse(agentConfigSnippet("claude", base)) as { mcpServers: Record<string, { args: string[] }> };
  assert.deepEqual(claude.mcpServers.repolens.args, ["--experimental-sqlite", "/repo/dist/src/cli.js", "mcp"]);

  const vscode = JSON.parse(agentConfigSnippet("vscode", base)) as { servers: Record<string, { command: string }> };
  assert.equal(vscode.servers.repolens.command, "/usr/bin/node");
});

test("agent setup dry-run reports files without writing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-agents-"));
  const result = await installAgentSetup({
    targetDir: tmp,
    agents: ["codex", "claude"],
    command: "node",
    cliPath: "/repo/cli.js",
    dryRun: true
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.agents.length, 2);
  assert.ok(result.files.some((file) => file.path.endsWith("docs/repolens-agent-setup.md") && file.changed));
  assert.ok(result.files.some((file) => file.path.endsWith(".codex/AGENTS.md")));
  await assert.rejects(() => fs.readFile(path.join(tmp, "docs/repolens-agent-setup.md"), "utf8"));
});

test("agent setup writes and replaces managed instruction blocks", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-agents-"));
  const guidePath = path.join(tmp, "docs", "repolens-agent-setup.md");
  await fs.mkdir(path.dirname(guidePath), { recursive: true });
  await fs.writeFile(guidePath, "# Existing guide\n");

  await installAgentSetup({
    targetDir: tmp,
    agents: ["gemini"],
    command: "node",
    cliPath: "/repo/one.js",
    dbPath: "one.db"
  });
  await installAgentSetup({
    targetDir: tmp,
    agents: ["gemini"],
    command: "node",
    cliPath: "/repo/two.js",
    dbPath: "two.db"
  });

  const guide = await fs.readFile(guidePath, "utf8");
  const gemini = await fs.readFile(path.join(tmp, ".gemini", "GEMINI.md"), "utf8");

  assert.match(guide, /^# Existing guide/);
  assert.equal((guide.match(/repolens-mcp managed/g) ?? []).length, 2);
  assert.ok(!guide.includes("/repo/one.js"));
  assert.ok(guide.includes("/repo/two.js"));
  assert.match(gemini, /RepoLens MCP/);
  assert.match(gemini, /two\.db/);
});

test("agent setup uninstall removes managed blocks only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-agents-"));
  const guidePath = path.join(tmp, "docs", "repolens-agent-setup.md");
  await fs.mkdir(path.dirname(guidePath), { recursive: true });
  await fs.writeFile(guidePath, "# Existing guide\n\nKeep this section.\n");

  await installAgentSetup({
    targetDir: tmp,
    agents: ["codex"],
    command: "node",
    cliPath: "/repo/cli.js",
    dbPath: "memory.db"
  });
  const result = await uninstallAgentSetup({
    targetDir: tmp,
    agents: ["codex"]
  });

  const guide = await fs.readFile(guidePath, "utf8");
  await assert.rejects(() => fs.readFile(path.join(tmp, ".codex", "AGENTS.md"), "utf8"));

  assert.ok(result.files.some((file) => file.path.endsWith(".codex/AGENTS.md") && file.removed));
  assert.match(guide, /Keep this section/);
  assert.ok(!guide.includes("repolens-mcp managed"));
});
