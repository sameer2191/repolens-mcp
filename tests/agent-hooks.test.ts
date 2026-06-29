import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAgentHookInput, evaluateAgentHookPayload, renderAgentHookResult } from "../src/core/agent-hooks.js";

test("agent hook suggests RepoLens context before broad Grep use", () => {
  const result = evaluateAgentHookPayload(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "createOrder", path: "src" }
    },
    { serverName: "repolens", dbPath: ".repolens/memory.db", command: "node", cliPath: "/repo/dist/src/cli.js" }
  );

  assert.equal(result.shouldRemind, true);
  assert.equal(result.toolName, "Grep");
  assert.equal(result.query, "createOrder");
  assert.deepEqual(result.mcpTools.slice(0, 2), ["repolens.context_pack", "repolens.search_graph"]);
  assert.match(result.fallbackCommand ?? "", /context-pack createOrder --db \.repolens\/memory\.db/);
  assert.match(renderAgentHookResult(result), /Non-blocking/);
});

test("agent hook shell-quotes fallback commands with hook-controlled queries", () => {
  const result = evaluateAgentHookPayload(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "$(touch /tmp/pwn); `whoami`\nnext" }
    },
    { dbPath: "db $(rm).sqlite", command: "/usr/bin/node", cliPath: "/repo path/dist/src/cli.js" }
  );

  assert.equal(result.shouldRemind, true);
  assert.match(result.fallbackCommand ?? "", /'\/repo path\/dist\/src\/cli\.js'/);
  assert.match(result.fallbackCommand ?? "", /'\$\(touch \/tmp\/pwn\); `whoami` next'/);
  assert.match(result.fallbackCommand ?? "", /'db \$\(rm\)\.sqlite'/);
  assert.doesNotMatch(result.fallbackCommand ?? "", /"\$\(/);
});

test("agent hook detects broad shell searches", () => {
  const result = evaluateAgentHookPayload({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "rg \"agent setup\" src tests" }
  });

  assert.equal(result.shouldRemind, true);
  assert.equal(result.toolName, "Bash");
  assert.match(result.query ?? "", /rg/);
  assert.match(result.message ?? "", /RepoLens context reminder/);
});

test("agent hook skips direct read and edit tools", () => {
  for (const tool_name of ["Read", "Edit", "Write", "MultiEdit"]) {
    const result = evaluateAgentHookPayload({ hook_event_name: "PreToolUse", tool_name, tool_input: { file_path: "src/core/store.ts" } });
    assert.equal(result.shouldRemind, false);
    assert.match(result.reason, /not intercepted/);
  }
});

test("agent hook fails open for malformed or unrelated payloads", () => {
  const invalid = evaluateAgentHookInput("{not-json");
  assert.equal(invalid.shouldRemind, false);
  assert.match(invalid.reason, /No hook payload/);

  const postTool = evaluateAgentHookPayload({ hook_event_name: "PostToolUse", tool_name: "Grep", tool_input: { pattern: "createOrder" } });
  assert.equal(postTool.shouldRemind, false);

  const narrowBash = evaluateAgentHookPayload({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test" } });
  assert.equal(narrowBash.shouldRemind, false);
});

test("agent hook can render json for machine-readable hook logs", () => {
  const result = evaluateAgentHookPayload({ tool_name: "Glob", tool_input: { pattern: "**/*.ts" } });
  const rendered = JSON.parse(renderAgentHookResult(result, "json")) as { shouldRemind: boolean; query: string };

  assert.equal(rendered.shouldRemind, true);
  assert.equal(rendered.query, "**/*.ts");
});

test("agent hook can render Claude hook additional context", () => {
  const result = evaluateAgentHookPayload({
    hook_event_name: "PreToolUse",
    tool_name: "Grep",
    tool_input: { pattern: "checkout" }
  });
  const rendered = JSON.parse(renderAgentHookResult(result, "claude-json")) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };

  assert.equal(rendered.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(rendered.hookSpecificOutput.additionalContext, /context reminder/);
  assert.match(rendered.hookSpecificOutput.additionalContext, /checkout/);
});
