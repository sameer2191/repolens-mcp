import fs from "node:fs/promises";
import path from "node:path";

export type AgentId =
  | "codex"
  | "claude"
  | "gemini"
  | "zed"
  | "opencode"
  | "antigravity"
  | "aider"
  | "kilocode"
  | "vscode"
  | "openclaw"
  | "kiro";

export interface AgentProfile {
  id: AgentId;
  label: string;
  configHint: string;
  instructionPath: string;
}

export interface AgentSetupOptions {
  targetDir?: string;
  agents?: AgentId[];
  command: string;
  cliPath: string;
  dbPath?: string;
  serverName?: string;
  dryRun?: boolean;
}

export interface AgentSetupFile {
  path: string;
  changed: boolean;
  content: string;
}

export interface AgentSetupResult {
  targetDir: string;
  serverName: string;
  dryRun: boolean;
  agents: AgentProfile[];
  files: AgentSetupFile[];
  guidePath: string;
}

const MANAGED_START = "<!-- >>> repolens-mcp managed >>> -->";
const MANAGED_END = "<!-- <<< repolens-mcp managed <<< -->";

export const agentProfiles: AgentProfile[] = [
  { id: "codex", label: "Codex CLI", configHint: ".codex/config.toml", instructionPath: ".codex/AGENTS.md" },
  { id: "claude", label: "Claude Code", configHint: ".mcp.json or ~/.claude/.mcp.json", instructionPath: "CLAUDE.md" },
  { id: "gemini", label: "Gemini CLI", configHint: ".gemini/settings.json", instructionPath: ".gemini/GEMINI.md" },
  { id: "zed", label: "Zed", configHint: "settings.json context server", instructionPath: ".zed/repolens.md" },
  { id: "opencode", label: "OpenCode", configHint: "opencode.json", instructionPath: ".opencode/AGENTS.md" },
  { id: "antigravity", label: "Antigravity", configHint: ".gemini/config/mcp_config.json", instructionPath: "antigravity-cli/AGENTS.md" },
  { id: "aider", label: "Aider", configHint: "project conventions", instructionPath: "CONVENTIONS.md" },
  { id: "kilocode", label: "KiloCode", configHint: "mcp_settings.json", instructionPath: ".kilocode/rules/repolens.md" },
  { id: "vscode", label: "VS Code", configHint: "mcp.json", instructionPath: ".vscode/repolens-mcp.md" },
  { id: "openclaw", label: "OpenClaw", configHint: "openclaw.json", instructionPath: ".openclaw/repolens.md" },
  { id: "kiro", label: "Kiro", configHint: ".kiro/settings/mcp.json", instructionPath: ".kiro/steering/repolens.md" }
];

export async function installAgentSetup(options: AgentSetupOptions): Promise<AgentSetupResult> {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const serverName = options.serverName ?? "repolens";
  const selected = selectAgents(options.agents);
  const files = [
    {
      relativePath: "docs/repolens-agent-setup.md",
      body: agentSetupGuide({
        profiles: selected,
        serverName,
        command: options.command,
        cliPath: options.cliPath,
        dbPath: options.dbPath ?? ".repolens/memory.db"
      })
    },
    ...selected.map((profile) => ({
      relativePath: profile.instructionPath,
      body: agentInstructionBlock({
        profile,
        serverName,
        command: options.command,
        cliPath: options.cliPath,
        dbPath: options.dbPath ?? ".repolens/memory.db"
      })
    }))
  ];

  const written: AgentSetupFile[] = [];
  for (const file of files) {
    const outPath = path.join(targetDir, file.relativePath);
    const existing = await fs.readFile(outPath, "utf8").catch(() => "");
    const content = upsertMarkdownBlock(existing, file.body);
    written.push({ path: outPath, changed: content !== existing, content });
    if (!options.dryRun && content !== existing) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, content);
    }
  }

  return {
    targetDir,
    serverName,
    dryRun: options.dryRun ?? false,
    agents: selected,
    files: written,
    guidePath: path.join(targetDir, "docs", "repolens-agent-setup.md")
  };
}

export function agentSetupGuide(options: {
  profiles: AgentProfile[];
  serverName: string;
  command: string;
  cliPath: string;
  dbPath: string;
}): string {
  const snippets = options.profiles
    .map((profile) => `### ${profile.label}

Config target: \`${profile.configHint}\`

\`\`\`${snippetLanguage(profile.id)}
${agentConfigSnippet(profile.id, options)}
\`\`\`
`)
    .join("\n");

  return `# RepoLens Agent Setup

This project includes RepoLens MCP instructions for multiple coding agents. Configure the MCP server once, then ask the agent to index the repository or use the graph before broad code searches.

Server name: \`${options.serverName}\`
Database: \`${options.dbPath}\`

## Command

\`\`\`bash
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "mcp"])}
\`\`\`

## Agent Config Snippets

${snippets}
## Recommended Agent Behavior

- Run \`repolens-mcp index . --db ${options.dbPath}\` after clone or major branch changes.
- Prefer \`${options.serverName}.context_pack\`, \`${options.serverName}.search_graph\`, and \`${options.serverName}.trace_path\` before opening many files.
- Use \`${options.serverName}.get_graph_schema\` first when writing graph queries.
- Use \`${options.serverName}.detect_changes\` before risky edits.
`;
}

export function agentConfigSnippet(agent: AgentId, options: { serverName: string; command: string; cliPath: string; dbPath: string }): string {
  const args = ["--experimental-sqlite", options.cliPath, "mcp"];
  const jsonServer = {
    command: options.command,
    args,
    env: {
      NODE_NO_WARNINGS: "1",
      REPOLENS_DB: options.dbPath
    }
  };

  switch (agent) {
    case "codex":
      return `[mcp_servers.${options.serverName}]
command = ${JSON.stringify(options.command)}
args = ${JSON.stringify(args)}
startup_timeout_sec = 120

[mcp_servers.${options.serverName}.env]
NODE_NO_WARNINGS = "1"
REPOLENS_DB = ${JSON.stringify(options.dbPath)}`;
    case "claude":
    case "gemini":
    case "antigravity":
      return JSON.stringify({ mcpServers: { [options.serverName]: jsonServer } }, null, 2);
    case "vscode":
      return JSON.stringify({ servers: { [options.serverName]: jsonServer } }, null, 2);
    case "zed":
      return JSON.stringify({ context_servers: { [options.serverName]: { command: { path: options.command, args } } } }, null, 2);
    case "opencode":
      return JSON.stringify({ mcp: { [options.serverName]: { type: "local", command: [options.command, ...args] } } }, null, 2);
    case "kilocode":
    case "openclaw":
    case "kiro":
      return JSON.stringify({ mcpServers: { [options.serverName]: jsonServer } }, null, 2);
    case "aider":
      return `# Add this project instruction file to Aider context:
/read CONVENTIONS.md

# Then run RepoLens from a shell when needed:
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "index", ".", "--db", options.dbPath])}`;
  }
}

function agentInstructionBlock(options: { profile: AgentProfile; serverName: string; command: string; cliPath: string; dbPath: string }): string {
  return `# RepoLens MCP

RepoLens is available as the \`${options.serverName}\` MCP server for this project.

Use it before broad file exploration:

- \`${options.serverName}.context_pack\` for focused implementation context.
- \`${options.serverName}.search_graph\` for symbols, routes, services, packages, and protocol surfaces.
- \`${options.serverName}.trace_path\` to inspect inbound or outbound call paths.
- \`${options.serverName}.query_graph\` for read-only graph queries.
- \`${options.serverName}.detect_changes\` before risky edits.

Local commands:

\`\`\`bash
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "index", ".", "--db", options.dbPath])}
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "serve", "--db", options.dbPath])}
\`\`\`

Agent profile: ${options.profile.label}
Config target: \`${options.profile.configHint}\`
`;
}

function selectAgents(agents?: AgentId[]): AgentProfile[] {
  if (!agents || agents.length === 0) {
    return agentProfiles;
  }
  const requested = new Set(agents);
  return agentProfiles.filter((profile) => requested.has(profile.id));
}

function upsertMarkdownBlock(existing: string, body: string): string {
  const block = `${MANAGED_START}
${body.trim()}
${MANAGED_END}
`;
  const pattern = new RegExp(`${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`);
  if (pattern.test(existing)) {
    return existing.replace(pattern, block);
  }
  const trimmed = existing.trimEnd();
  return trimmed ? `${trimmed}\n\n${block}` : block;
}

function snippetLanguage(agent: AgentId): string {
  return agent === "codex" ? "toml" : agent === "aider" ? "bash" : "json";
}

function shellJoin(parts: string[]): string {
  return parts.map((part) => (/^[A-Za-z0-9_./:=@-]+$/.test(part) ? part : JSON.stringify(part))).join(" ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
