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
  assert.equal(result.withHooks, false);
  assert.equal(result.agents.length, 2);
  assert.ok(result.files.some((file) => file.path.endsWith("docs/repolens-agent-setup.md") && file.changed));
  assert.ok(result.files.some((file) => file.path.endsWith(".codex/AGENTS.md")));
  assert.ok(!result.files.some((file) => file.path.endsWith("repolens-hooks.md")));
  await assert.rejects(() => fs.readFile(path.join(tmp, "docs/repolens-agent-setup.md"), "utf8"));
});

test("agent setup can render opt-in hook reminder files", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-agent-hooks-"));
  const result = await installAgentSetup({
    targetDir: tmp,
    agents: ["claude", "gemini"],
    command: "node",
    cliPath: "/repo path/cli.js",
    dbPath: ".repolens/memory $(rm).db",
    withHooks: true,
    dryRun: true
  });

  const hookGuide = result.files.find((file) => file.path.endsWith("docs/repolens-agent-hooks.md"))?.content ?? "";
  assert.equal(result.withHooks, true);
  assert.ok(result.files.some((file) => file.path.endsWith("docs/repolens-agent-hooks.md") && file.changed));
  assert.ok(result.files.some((file) => file.path.endsWith(".claude/repolens-hooks.md") && file.content.includes("context_pack")));
  assert.ok(result.files.some((file) => file.path.endsWith(".claude/repolens-hooks.md") && file.content.includes("hook-augment")));
  assert.ok(result.files.some((file) => file.path.endsWith(".claude/repolens-hooks.md") && file.content.includes("--claude")));
  assert.ok(result.files.some((file) => file.path.endsWith("docs/repolens-agent-hooks.md") && file.content.includes("without querying or mutating")));
  assert.ok(result.files.some((file) => file.path.endsWith("docs/repolens-agent-hooks.md") && file.content.includes("--with-query")));
  assert.match(hookGuide, /'\/repo path\/cli\.js'/);
  assert.match(hookGuide, /'\.repolens\/memory \$\(rm\)\.db'/);
  assert.ok(result.files.some((file) => file.path.endsWith(".gemini/repolens-hooks.md") && file.content.includes("non-blocking")));
  await assert.rejects(() => fs.readFile(path.join(tmp, "docs/repolens-agent-hooks.md"), "utf8"));
});

test("agent setup uninstall removes managed hook reminders when requested", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-agent-hooks-"));

  await installAgentSetup({
    targetDir: tmp,
    agents: ["claude"],
    command: "node",
    cliPath: "/repo/cli.js",
    withHooks: true
  });
  const hookPath = path.join(tmp, ".claude", "repolens-hooks.md");
  assert.match(await fs.readFile(hookPath, "utf8"), /RepoLens Hook Reminder/);

  const result = await uninstallAgentSetup({
    targetDir: tmp,
    agents: ["claude"],
    withHooks: true
  });

  assert.ok(result.files.some((file) => file.path.endsWith(".claude/repolens-hooks.md") && file.removed));
  assert.ok(result.files.some((file) => file.path.endsWith("docs/repolens-agent-hooks.md") && file.removed));
  await assert.rejects(() => fs.readFile(hookPath, "utf8"));
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

test("agent setup installs and uninstalls project-local VS Code MCP config", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-vscode-agent-"));
  const configPath = path.join(tmp, ".vscode", "mcp.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        servers: {
          existing: {
            command: "other-tool",
            args: ["mcp"]
          }
        }
      },
      null,
      2
    )
  );

  const dryRun = await installAgentSetup({
    targetDir: tmp,
    agents: ["vscode"],
    command: "node",
    cliPath: "/repo/one.js",
    dbPath: "one.db",
    dryRun: true
  });
  assert.ok(dryRun.files.some((file) => file.path.endsWith(".vscode/mcp.json") && file.changed));
  assert.equal((JSON.parse(await fs.readFile(configPath, "utf8")) as { servers: Record<string, unknown> }).servers.repolens, undefined);

  await installAgentSetup({
    targetDir: tmp,
    agents: ["vscode"],
    command: "node",
    cliPath: "/repo/one.js",
    dbPath: "one.db"
  });
  await installAgentSetup({
    targetDir: tmp,
    agents: ["vscode"],
    command: "node",
    cliPath: "/repo/two.js",
    dbPath: "two.db"
  });

  const installed = JSON.parse(await fs.readFile(configPath, "utf8")) as {
    servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };
  assert.equal(installed.servers.existing.command, "other-tool");
  assert.equal(installed.servers.repolens.command, "node");
  assert.deepEqual(installed.servers.repolens.args, ["--experimental-sqlite", "/repo/two.js", "mcp"]);
  assert.equal(installed.servers.repolens.env?.REPOLENS_DB, "two.db");
  assert.equal(installed.servers.repolens.env?.REPOLENS_MANAGED, "1");

  const result = await uninstallAgentSetup({
    targetDir: tmp,
    agents: ["vscode"]
  });
  const uninstalled = JSON.parse(await fs.readFile(configPath, "utf8")) as { servers: Record<string, unknown> };
  assert.ok(result.files.some((file) => file.path.endsWith(".vscode/mcp.json") && file.changed && !file.removed));
  assert.ok("existing" in uninstalled.servers);
  assert.equal(uninstalled.servers.repolens, undefined);
});

test("agent setup leaves unmanaged VS Code MCP entries untouched on uninstall", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-vscode-unmanaged-"));
  const configPath = path.join(tmp, ".vscode", "mcp.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        servers: {
          repolens: {
            command: "custom-node",
            args: ["custom.js", "mcp"]
          }
        }
      },
      null,
      2
    ) + "\n"
  );

  const result = await uninstallAgentSetup({
    targetDir: tmp,
    agents: ["vscode"]
  });
  const current = JSON.parse(await fs.readFile(configPath, "utf8")) as { servers: Record<string, { command: string }> };

  assert.ok(result.files.some((file) => file.path.endsWith(".vscode/mcp.json") && !file.changed));
  assert.equal(current.servers.repolens.command, "custom-node");
});
