import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import fc from "fast-check";
import { maybeAutoIndexOnStartup, maybeStartAutoSyncOnStartup, validateMcpAgentSetupWriteRequest } from "../src/mcp/server.js";

const fixture = path.join(process.cwd(), "tests", "fixtures", "sample-repo");
const cliPath = path.join(process.cwd(), "dist", "src", "cli.js");

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonRpcMessage = { jsonrpc?: string; id?: number | string; method?: string; result?: unknown; error?: { code: number; message: string } };

class McpStdioClient {
  private buffer = "";
  private readonly messages: JsonRpcMessage[] = [];
  private readonly waiters: Array<() => void> = [];
  private nextId = 1;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline !== -1) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          this.messages.push(JSON.parse(line) as JsonRpcMessage);
        }
        newline = this.buffer.indexOf("\n");
      }
      this.wake();
    });
  }

  async initialize(): Promise<JsonRpcMessage> {
    const response = await this.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "repolens-mcp-test", version: "1.0.0" }
    });
    this.notify("notifications/initialized", {});
    return response;
  }

  async request(method: string, params: JsonValue): Promise<JsonRpcMessage> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return this.read((message) => message.id === id);
  }

  notify(method: string, params: JsonValue): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: JsonValue): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async read(predicate: (message: JsonRpcMessage) => boolean, timeoutMs = 4000): Promise<JsonRpcMessage> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(predicate);
      if (index !== -1) {
        return this.messages.splice(index, 1)[0];
      }
      await Promise.race([this.waitForMessage(), delay(Math.min(50, deadline - Date.now()))]);
    }
    throw new Error(`Timed out waiting for MCP JSON-RPC response. stderr: ${stderrFor(this.child)}`);
  }

  private waitForMessage(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private wake(): void {
    while (this.waiters.length) {
      this.waiters.shift()?.();
    }
  }
}

const childStderr = new WeakMap<ChildProcessWithoutNullStreams, string>();

async function startMcpClient(): Promise<{ child: ChildProcessWithoutNullStreams; client: McpStdioClient; close: () => Promise<void> }> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-protocol-"));
  const child = spawn(process.execPath, ["--experimental-sqlite", cliPath, "mcp"], {
    cwd: process.cwd(),
    env: { ...process.env, REPOLENS_AUTO_INDEX: "0", REPOLENS_CONFIG: path.join(tmp, "missing-config.json") },
    stdio: ["pipe", "pipe", "pipe"]
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => childStderr.set(child, `${childStderr.get(child) ?? ""}${chunk}`));
  const client = new McpStdioClient(child);

  return {
    child,
    client,
    close: async () => {
      child.stdin.end();
      const exited = await waitForExit(child, 1000);
      if (!exited) {
        child.kill("SIGTERM");
        const terminated = await waitForExit(child, 1000);
        if (!terminated) {
          child.kill("SIGKILL");
          await waitForExit(child, 1000);
        }
      }
    }
  };
}

async function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }
  return Promise.race([once(child, "exit").then(() => true), delay(timeoutMs).then(() => false)]);
}

function stderrFor(child: ChildProcessWithoutNullStreams): string {
  return childStderr.get(child)?.slice(-1200) ?? "";
}

function assertToolCallRejected(response: JsonRpcMessage): void {
  if (response.error) {
    assert.match(response.error.message, /tool|invalid|not found|required|expected|schema/i);
    return;
  }
  const result = response.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
  assert.equal(result?.isError, true, `expected tool call rejection, got ${JSON.stringify(response)}`);
}

test("MCP startup auto-index is disabled by default", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-no-config-"));
  const result = await maybeAutoIndexOnStartup({ REPOLENS_CONFIG: path.join(tmp, "missing-config.json") }, fixture);
  assert.equal(result, undefined);
});

test("MCP startup auto-index indexes the configured repository", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-auto-index-"));
  const dbPath = path.join(tmp, "memory.db");
  const result = await maybeAutoIndexOnStartup(
    {
      REPOLENS_AUTO_INDEX: "1",
      REPOLENS_ROOT: fixture,
      REPOLENS_DB: dbPath,
      REPOLENS_MAX_FILE_BYTES: "750000",
      REPOLENS_MAX_FILES: "1000",
      REPOLENS_CONFIG: path.join(tmp, "missing-config.json"),
      REPOLENS_AUTO_INDEX_LABEL: "startup-test"
    },
    process.cwd()
  );

  assert.equal(result?.mode, "incremental");
  assert.equal(result?.root, fixture);
  assert.equal(result?.dbPath, dbPath);
  assert.ok((result?.symbols ?? 0) > 0);

  const fullResult = await maybeAutoIndexOnStartup(
    {
      REPOLENS_AUTO_INDEX: "full",
      REPOLENS_ROOT: fixture,
      REPOLENS_DB: dbPath,
      REPOLENS_CONFIG: path.join(tmp, "missing-config.json")
    },
    process.cwd()
  );
  assert.equal(fullResult?.mode, "full");
  assert.equal(fullResult?.root, fixture);
});

test("MCP startup auto-index honors the configured file-count limit", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-auto-index-limit-"));
  await assert.rejects(
    () =>
      maybeAutoIndexOnStartup(
        {
          REPOLENS_AUTO_INDEX: "1",
          REPOLENS_ROOT: fixture,
          REPOLENS_DB: path.join(tmp, "memory.db"),
          REPOLENS_MAX_FILES: "1",
          REPOLENS_CONFIG: path.join(tmp, "missing-config.json")
        },
        process.cwd()
      ),
    /exceeds maxFiles 1/
  );
});

test("MCP startup auto-index reads persistent RepoLens config", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-config-auto-index-"));
  const dbPath = path.join(tmp, "memory.db");
  const configPath = path.join(tmp, "config.json");
  await fs.writeFile(
    configPath,
    JSON.stringify(
      {
        autoIndex: "incremental",
        root: fixture,
        dbPath,
        maxFileBytes: 750000,
        maxFiles: 1000,
        autoIndexLabel: "config-startup-test"
      },
      null,
      2
    )
  );

  const result = await maybeAutoIndexOnStartup({ REPOLENS_CONFIG: configPath }, process.cwd());

  assert.equal(result?.mode, "incremental");
  assert.equal(result?.root, fixture);
  assert.equal(result?.dbPath, dbPath);
  assert.ok((result?.symbols ?? 0) > 0);
});

test("MCP startup auto-sync is disabled by default and can start from env", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-auto-sync-"));
  const disabled = maybeStartAutoSyncOnStartup({ REPOLENS_CONFIG: path.join(tmp, "missing-config.json") }, fixture);
  assert.equal(disabled, undefined);

  const enabled = maybeStartAutoSyncOnStartup(
    {
      REPOLENS_AUTO_SYNC: "1",
      REPOLENS_AUTO_INDEX: "1",
      REPOLENS_AUTO_SYNC_INTERVAL_MS: "250",
      REPOLENS_AUTO_SYNC_POLLS: "1",
      REPOLENS_ROOT: fixture,
      REPOLENS_DB: path.join(tmp, "memory.db"),
      REPOLENS_CONFIG: path.join(tmp, "missing-config.json")
    },
    process.cwd()
  );
  assert.ok(enabled);
  enabled.abort();
});

test("MCP agent_setup write requests stay inside the server cwd", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-agent-write-"));
  assert.equal(validateMcpAgentSetupWriteRequest({ targetDir: "docs", write: true }, tmp, {}), path.join(tmp, "docs"));
  assert.equal(validateMcpAgentSetupWriteRequest({ targetDir: path.dirname(tmp), write: false, withHooks: true }, tmp, {}), path.dirname(tmp));
  assert.throws(
    () => validateMcpAgentSetupWriteRequest({ targetDir: path.dirname(tmp), write: true }, tmp, {}),
    /inside the MCP server working directory/
  );
});

test("MCP agent_setup executable hook writes require explicit opt-in", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-mcp-agent-hooks-"));
  assert.throws(
    () => validateMcpAgentSetupWriteRequest({ targetDir: ".", write: true, withHooks: true }, tmp, {}),
    /REPOLENS_ALLOW_MCP_HOOK_WRITES=1/
  );
  assert.equal(
    validateMcpAgentSetupWriteRequest({ targetDir: ".", write: true, withHooks: true }, tmp, { REPOLENS_ALLOW_MCP_HOOK_WRITES: "1" }),
    tmp
  );
});

test("MCP stdio JSON-RPC initializes and lists registered tools", async () => {
  const { child, client, close } = await startMcpClient();
  try {
    const initialized = await client.initialize();
    assert.equal(initialized.error, undefined, stderrFor(child));
    assert.equal(typeof (initialized.result as { protocolVersion?: unknown }).protocolVersion, "string");

    const tools = await client.request("tools/list", {});
    assert.equal(tools.error, undefined, stderrFor(child));
    const list = (tools.result as { tools?: Array<{ name: string }> }).tools ?? [];
    assert.equal(list.length, 38);
    assert.ok(list.some((tool) => tool.name === "index_repository"));
    assert.ok(list.some((tool) => tool.name === "benchmark_repository"));
    assert.ok(list.some((tool) => tool.name === "version_status"));
    assert.ok(list.some((tool) => tool.name === "trace_path"));
    assert.ok(list.some((tool) => tool.name === "scan_secrets"));
  } finally {
    await close();
  }
});

test("MCP stdio JSON-RPC rejects fuzzed invalid tool calls without exiting", async () => {
  const { child, client, close } = await startMcpClient();
  try {
    await client.initialize();

    const unknownCalls = fc.sample(
      fc.record({
        suffix: fc.string({ maxLength: 24 }),
        arguments: fc.dictionary(
          fc.string({ minLength: 1, maxLength: 16 }),
          fc.oneof(fc.string({ maxLength: 48 }), fc.integer({ min: -20, max: 20 }), fc.boolean(), fc.constant(null)),
          { maxKeys: 4 }
        )
      }),
      { numRuns: 16, seed: 20260618 }
    );
    for (const call of unknownCalls) {
      const response = await client.request("tools/call", { name: `fuzz_${call.suffix}`, arguments: call.arguments });
      assertToolCallRejected(response);
    }

    const invalidKnownCalls = fc.sample(
      fc.oneof(
        fc.record({
          name: fc.constant("trace_path"),
          arguments: fc.record({
            name: fc.string({ maxLength: 12 }),
            direction: fc.string({ maxLength: 12 }).filter((value) => value !== "inbound" && value !== "outbound" && value !== "both")
          })
        }),
        fc.record({
          name: fc.constant("scan_secrets"),
          arguments: fc.record({
            minConfidence: fc.string({ maxLength: 12 }).filter((value) => value !== "low" && value !== "medium" && value !== "high"),
            limit: fc.integer({ min: -20, max: 0 })
          })
        }),
        fc.record({
          name: fc.constant("index_repository"),
          arguments: fc.record({
            root: fc.string({ maxLength: 16 }),
            maxFileBytes: fc.integer({ min: -50, max: 0 })
          })
        }),
        fc.record({
          name: fc.constant("agent_setup"),
          arguments: fc.record({
            agents: fc.array(fc.constant("unknown-agent"), { minLength: 1, maxLength: 2 })
          })
        })
      ),
      { numRuns: 24, seed: 20260618 }
    );
    for (const call of invalidKnownCalls) {
      const response = await client.request("tools/call", { name: call.name, arguments: call.arguments });
      assertToolCallRejected(response);
    }

    const stillAlive = await client.request("tools/list", {});
    assert.equal(stillAlive.error, undefined, stderrFor(child));
    assert.equal(((stillAlive.result as { tools?: unknown[] }).tools ?? []).length, 38);
  } finally {
    await close();
  }
});
