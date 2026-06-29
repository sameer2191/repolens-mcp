export interface AgentHookOptions {
  serverName?: string;
  dbPath?: string;
  command?: string;
  cliPath?: string;
}

export interface AgentHookResult {
  shouldRemind: boolean;
  reason: string;
  eventName?: string;
  toolName?: string;
  query?: string;
  mcpTools: string[];
  fallbackCommand?: string;
  message?: string;
}

export type AgentHookRenderFormat = "text" | "json" | "claude-json";

const BROAD_SEARCH_TOOLS = new Set(["bash", "grep", "glob", "search", "search_code"]);
const SKIPPED_TOOLS = new Set(["read", "edit", "multiedit", "write", "notebookedit"]);
const BROAD_SHELL_PATTERN = /(^|\s)(rg|grep|ag|find|fd|ack)\b/i;

export function evaluateAgentHookInput(rawInput: string, options: AgentHookOptions = {}): AgentHookResult {
  const payload = parseHookPayload(rawInput);
  if (!payload) {
    return noReminder("No hook payload JSON was provided.");
  }
  return evaluateAgentHookPayload(payload, options);
}

export function evaluateAgentHookPayload(payload: unknown, options: AgentHookOptions = {}): AgentHookResult {
  if (!isRecord(payload)) {
    return noReminder("Hook payload must be a JSON object.");
  }

  const eventName = stringValue(payload.hook_event_name) ?? stringValue(payload.hookEventName) ?? stringValue(payload.event);
  if (eventName && eventName !== "PreToolUse") {
    return noReminder(`Ignoring ${eventName} hook event.`, eventName);
  }

  const toolName = stringValue(payload.tool_name) ?? stringValue(payload.toolName) ?? stringValue(payload.name);
  if (!toolName) {
    return noReminder("Hook payload did not include a tool name.", eventName);
  }

  const normalizedTool = toolName.toLowerCase();
  if (SKIPPED_TOOLS.has(normalizedTool)) {
    return noReminder(`Ignoring ${toolName}; direct file read and edit tools are not intercepted.`, eventName, toolName);
  }

  const toolInput = recordValue(payload.tool_input) ?? recordValue(payload.toolInput) ?? recordValue(payload.input) ?? {};
  const query = queryForTool(normalizedTool, toolInput);
  if (!query) {
    return noReminder(`Ignoring ${toolName}; no broad search query was detected.`, eventName, toolName);
  }

  const serverName = options.serverName ?? "repolens";
  const dbPath = options.dbPath ?? ".repolens/memory.db";
  const command = options.command ?? "repolens-mcp";
  const cliPath = options.cliPath;
  const mcpTools = [`${serverName}.context_pack`, `${serverName}.search_graph`, `${serverName}.get_graph_schema`];
  const fallbackParts = cliPath
    ? [command, "--experimental-sqlite", cliPath, "context-pack", query, "--db", dbPath]
    : [command, "context-pack", query, "--db", dbPath];
  const fallbackCommand = shellJoin(fallbackParts);
  const message = [
    `RepoLens context reminder for ${toolName}: ask ${mcpTools[0]} or ${mcpTools[1]} about ${JSON.stringify(query)} before broad search.`,
    `Fallback command: ${fallbackCommand}`,
    "Non-blocking: continue normally if RepoLens is unavailable."
  ].join("\n");

  return {
    shouldRemind: true,
    reason: "Broad search-like tool call detected.",
    eventName,
    toolName,
    query,
    mcpTools,
    fallbackCommand,
    message
  };
}

export function renderAgentHookResult(result: AgentHookResult, format: AgentHookRenderFormat = "text"): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  if (format === "claude-json") {
    return result.shouldRemind && result.message
      ? JSON.stringify(
          {
            hookSpecificOutput: {
              hookEventName: result.eventName ?? "PreToolUse",
              additionalContext: result.message
            }
          },
          null,
          2
        )
      : "";
  }
  return result.message ?? "";
}

function queryForTool(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === "bash") {
    const command = stringValue(input.command);
    if (!command || !BROAD_SHELL_PATTERN.test(command)) {
      return undefined;
    }
    return cleanQuery(command);
  }
  if (!BROAD_SEARCH_TOOLS.has(toolName)) {
    return undefined;
  }
  return cleanQuery(
    stringValue(input.pattern) ??
      stringValue(input.query) ??
      stringValue(input.regex) ??
      stringValue(input.glob) ??
      stringValue(input.path) ??
      stringValue(input.command)
  );
}

function parseHookPayload(rawInput: string): unknown {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function noReminder(reason: string, eventName?: string, toolName?: string): AgentHookResult {
  return {
    shouldRemind: false,
    reason,
    eventName,
    toolName,
    mcpTools: []
  };
}

function cleanQuery(value: string | undefined): string | undefined {
  const query = value?.replace(/\s+/g, " ").trim();
  if (!query) {
    return undefined;
  }
  return query.length > 160 ? `${query.slice(0, 157)}...` : query;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shellJoin(parts: string[]): string {
  return parts.map(posixShellQuote).join(" ");
}

function posixShellQuote(part: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : `'${part.replace(/'/g, "'\\''")}'`;
}
