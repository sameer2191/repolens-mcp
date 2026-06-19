import { constants as fsConstants } from "node:fs";
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
  configPath?: string;
  configKind?: "vscode-mcp";
  hookPath?: string;
  detection?: AgentDetectionHints;
}

export interface AgentDetectionHints {
  projectPaths?: string[];
  homePaths?: string[];
  commands?: string[];
}

export interface AgentSetupOptions {
  targetDir?: string;
  agents?: AgentId[];
  detectAgents?: boolean;
  detectionHome?: string;
  pathEnv?: string;
  command: string;
  cliPath: string;
  dbPath?: string;
  serverName?: string;
  dryRun?: boolean;
  withHooks?: boolean;
}

export interface AgentSetupFile {
  path: string;
  changed: boolean;
  content: string;
  removed?: boolean;
}

export interface AgentSetupResult {
  targetDir: string;
  serverName: string;
  dryRun: boolean;
  withHooks: boolean;
  detectAgents: boolean;
  agents: AgentProfile[];
  files: AgentSetupFile[];
  guidePath: string;
}

const MANAGED_START = "<!-- >>> repolens-mcp managed >>> -->";
const MANAGED_END = "<!-- <<< repolens-mcp managed <<< -->";

export const agentProfiles: AgentProfile[] = [
  {
    id: "codex",
    label: "Codex CLI",
    configHint: ".codex/config.toml",
    instructionPath: ".codex/AGENTS.md",
    hookPath: ".codex/repolens-hooks.md",
    detection: { projectPaths: [".codex/config.toml", ".codex/AGENTS.md"], homePaths: [".codex/config.toml"], commands: ["codex"] }
  },
  {
    id: "claude",
    label: "Claude Code",
    configHint: ".mcp.json or ~/.claude/.mcp.json",
    instructionPath: "CLAUDE.md",
    hookPath: ".claude/repolens-hooks.md",
    detection: { projectPaths: [".mcp.json", "CLAUDE.md", ".claude"], homePaths: [".claude/.mcp.json", ".claude"], commands: ["claude"] }
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    configHint: ".gemini/settings.json",
    instructionPath: ".gemini/GEMINI.md",
    hookPath: ".gemini/repolens-hooks.md",
    detection: { projectPaths: [".gemini/settings.json", ".gemini/GEMINI.md"], homePaths: [".gemini/settings.json"], commands: ["gemini"] }
  },
  {
    id: "zed",
    label: "Zed",
    configHint: "settings.json context server",
    instructionPath: ".zed/repolens.md",
    hookPath: ".zed/repolens-hooks.md",
    detection: { projectPaths: [".zed", ".zed/settings.json"], homePaths: [".config/zed/settings.json"], commands: ["zed"] }
  },
  {
    id: "opencode",
    label: "OpenCode",
    configHint: "opencode.json",
    instructionPath: ".opencode/AGENTS.md",
    hookPath: ".opencode/repolens-hooks.md",
    detection: { projectPaths: ["opencode.json", ".opencode"], homePaths: [".config/opencode"], commands: ["opencode"] }
  },
  {
    id: "antigravity",
    label: "Antigravity",
    configHint: ".gemini/config/mcp_config.json",
    instructionPath: "antigravity-cli/AGENTS.md",
    hookPath: "antigravity-cli/repolens-hooks.md",
    detection: { projectPaths: ["antigravity-cli", ".gemini/config/mcp_config.json"], homePaths: [".gemini/config/mcp_config.json"], commands: ["antigravity"] }
  },
  {
    id: "aider",
    label: "Aider",
    configHint: "project conventions",
    instructionPath: "CONVENTIONS.md",
    hookPath: ".aider/repolens-hooks.md",
    detection: { projectPaths: [".aider.conf.yml", ".aider"], homePaths: [".aider.conf.yml", ".aider"], commands: ["aider"] }
  },
  {
    id: "kilocode",
    label: "KiloCode",
    configHint: "mcp_settings.json",
    instructionPath: ".kilocode/rules/repolens.md",
    hookPath: ".kilocode/rules/repolens-hooks.md",
    detection: { projectPaths: [".kilocode", "mcp_settings.json"], homePaths: [".kilocode"], commands: ["kilocode"] }
  },
  {
    id: "vscode",
    label: "VS Code",
    configHint: ".vscode/mcp.json",
    instructionPath: ".vscode/repolens-mcp.md",
    configPath: ".vscode/mcp.json",
    configKind: "vscode-mcp",
    hookPath: ".vscode/repolens-hooks.md",
    detection: { projectPaths: [".vscode", ".vscode/mcp.json"], homePaths: [".config/Code/User/settings.json"], commands: ["code"] }
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    configHint: "openclaw.json",
    instructionPath: ".openclaw/repolens.md",
    hookPath: ".openclaw/repolens-hooks.md",
    detection: { projectPaths: ["openclaw.json", ".openclaw"], homePaths: [".openclaw"], commands: ["openclaw"] }
  },
  {
    id: "kiro",
    label: "Kiro",
    configHint: ".kiro/settings/mcp.json",
    instructionPath: ".kiro/steering/repolens.md",
    hookPath: ".kiro/steering/repolens-hooks.md",
    detection: { projectPaths: [".kiro", ".kiro/settings/mcp.json"], homePaths: [".kiro"], commands: ["kiro"] }
  }
];

for (const profile of agentProfiles) {
  if (profile.detection) {
    Object.defineProperty(profile, "detection", { value: profile.detection, enumerable: false });
  }
}

export async function installAgentSetup(options: AgentSetupOptions): Promise<AgentSetupResult> {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const serverName = options.serverName ?? "repolens";
  const selected = await selectAgents({
    agents: options.agents,
    detectAgents: options.detectAgents,
    targetDir,
    detectionHome: options.detectionHome,
    pathEnv: options.pathEnv
  });
  const dbPath = options.dbPath ?? ".repolens/memory.db";
  const renderOptions = {
    serverName,
    command: options.command,
    cliPath: options.cliPath,
    dbPath
  };
  const hookFiles = options.withHooks
    ? [
        {
          relativePath: "docs/repolens-agent-hooks.md",
          body: agentHookGuide({
            profiles: selected,
            ...renderOptions
          })
        },
        ...selected.map((profile) => ({
          relativePath: profile.hookPath ?? profile.instructionPath,
          body: agentHookReminderBlock({
            profile,
            ...renderOptions
          })
        }))
      ]
    : [];
  const files = [
    {
      relativePath: "docs/repolens-agent-setup.md",
      body: agentSetupGuide({
        profiles: selected,
        detectAgents: options.detectAgents ?? false,
        withHooks: options.withHooks ?? false,
        ...renderOptions
      })
    },
    ...selected.map((profile) => ({
      relativePath: profile.instructionPath,
      body: agentInstructionBlock({
        profile,
        ...renderOptions
      })
    })),
    ...hookFiles
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
  for (const profile of selected.filter((item) => item.configPath && item.configKind)) {
    const outPath = path.join(targetDir, profile.configPath ?? "");
    const existing = await fs.readFile(outPath, "utf8").catch(() => "");
    const content = upsertAgentConfig(existing, profile, renderOptions);
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
    withHooks: options.withHooks ?? false,
    detectAgents: options.detectAgents ?? false,
    agents: selected,
    files: written,
    guidePath: path.join(targetDir, "docs", "repolens-agent-setup.md")
  };
}

export async function uninstallAgentSetup(options: Omit<AgentSetupOptions, "command" | "cliPath" | "dbPath">): Promise<AgentSetupResult> {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const serverName = options.serverName ?? "repolens";
  const selected = await selectAgents({
    agents: options.agents,
    detectAgents: options.detectAgents,
    targetDir,
    detectionHome: options.detectionHome,
    pathEnv: options.pathEnv
  });
  const hookPaths = options.withHooks ? ["docs/repolens-agent-hooks.md", ...selected.map((profile) => profile.hookPath ?? profile.instructionPath)] : [];
  const relativePaths = ["docs/repolens-agent-setup.md", ...selected.map((profile) => profile.instructionPath), ...hookPaths];
  const files: AgentSetupFile[] = [];

  for (const relativePath of relativePaths) {
    const outPath = path.join(targetDir, relativePath);
    const existing = await fs.readFile(outPath, "utf8").catch(() => "");
    const content = removeMarkdownBlock(existing).trimEnd();
    const removed = content.length === 0;
    const changed = content !== existing.trimEnd();
    files.push({ path: outPath, changed, content: removed ? "" : `${content}\n`, removed });
    if (!options.dryRun && changed) {
      if (removed) {
        await fs.rm(outPath, { force: true });
      } else {
        await fs.writeFile(outPath, `${content}\n`);
      }
    }
  }
  for (const profile of selected.filter((item) => item.configPath && item.configKind)) {
    const outPath = path.join(targetDir, profile.configPath ?? "");
    const existing = await fs.readFile(outPath, "utf8").catch(() => "");
    const content = removeAgentConfig(existing, profile, serverName);
    const removed = content.length === 0;
    const changed = content !== existing;
    files.push({ path: outPath, changed, content, removed });
    if (!options.dryRun && changed) {
      if (removed) {
        await fs.rm(outPath, { force: true });
      } else {
        await fs.writeFile(outPath, content);
      }
    }
  }

  return {
    targetDir,
    serverName,
    dryRun: options.dryRun ?? false,
    withHooks: options.withHooks ?? false,
    detectAgents: options.detectAgents ?? false,
    agents: selected,
    files,
    guidePath: path.join(targetDir, "docs", "repolens-agent-setup.md")
  };
}

export function agentSetupGuide(options: {
  profiles: AgentProfile[];
  serverName: string;
  command: string;
  cliPath: string;
  dbPath: string;
  detectAgents?: boolean;
  withHooks?: boolean;
}): string {
  const snippets =
    options.profiles.length > 0
      ? options.profiles
          .map((profile) => `### ${profile.label}

Config target: \`${profile.configHint}\`

\`\`\`${snippetLanguage(profile.id)}
${agentConfigSnippet(profile.id, options)}
\`\`\`
`)
          .join("\n")
      : "No agent profiles were selected. Re-run with `--agents all` to render every supported profile, or create a supported agent config and retry `--agents detected`.\n";
  const selection = options.detectAgents ? "Detected installed/project agents" : "Selected agents";

  return `# RepoLens Agent Setup

This project includes RepoLens MCP instructions for multiple coding agents. Configure the MCP server once, then ask the agent to index the repository or use the graph before broad code searches.

Server name: \`${options.serverName}\`
Database: \`${options.dbPath}\`
Selection: ${selection}

## Command

\`\`\`bash
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "mcp"])}
\`\`\`

## Agent Config Snippets

${snippets}
## Recommended Agent Behavior

- Run \`repolens-mcp index . --db ${options.dbPath}\` after clone or major branch changes.
- Prefer \`${options.serverName}.context_pack\`, \`${options.serverName}.search_graph\`, and \`${options.serverName}.trace_symbol\` before opening many files.
- Use \`${options.serverName}.get_graph_schema\` first when writing graph queries.
- Use \`${options.serverName}.detect_changes\` before risky edits.
${options.withHooks ? "\n## Optional Hook And Reminder Files\n\nThis install includes project-local, non-blocking hook/reminder files. They describe when to call RepoLens before broad searches or risky edits without automatically sending source code anywhere.\n" : ""}
`;
}

function agentHookGuide(options: {
  profiles: AgentProfile[];
  serverName: string;
  command: string;
  cliPath: string;
  dbPath: string;
}): string {
  const hookTargets = options.profiles.map((profile) => `- ${profile.label}: \`${profile.hookPath ?? profile.instructionPath}\``).join("\n");
  return `# RepoLens Agent Hook And Reminder Setup

These files are opt-in, project-local reminders for coding agents that support session prompts, hook notes, or project rules. They are intentionally non-blocking and read-only: the agent should use RepoLens context tools before broad searches, but the files do not execute code by themselves.

Server name: \`${options.serverName}\`
Database: \`${options.dbPath}\`

## Generated Targets

${hookTargets}

## Suggested Trigger Policy

- Before broad search commands, ask \`${options.serverName}.context_pack\` or \`${options.serverName}.search_graph\` for focused context.
- Before risky edits, ask \`${options.serverName}.detect_changes\` after local changes and inspect impacted symbols.
- Before graph queries, ask \`${options.serverName}.get_graph_schema\` first.
- Keep hook behavior non-blocking: if RepoLens is unavailable, continue with normal local inspection and mention the miss.

## Local Fallback Commands

\`\`\`bash
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "index", ".", "--db", options.dbPath])}
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "context-pack", "implementation target", "--db", options.dbPath])}
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "changes", ".", "--db", options.dbPath])}
\`\`\`
`;
}

function agentHookReminderBlock(options: { profile: AgentProfile; serverName: string; command: string; cliPath: string; dbPath: string }): string {
  return `# RepoLens Hook Reminder

Agent profile: ${options.profile.label}
Server name: \`${options.serverName}\`
Database: \`${options.dbPath}\`

Use this as a non-blocking project reminder:

- Before broad grep/glob/search, call \`${options.serverName}.context_pack\` with the implementation target.
- For symbol or route questions, call \`${options.serverName}.search_graph\` before opening many files.
- For call-path or impact questions, call \`${options.serverName}.trace_symbol\`, \`${options.serverName}.trace_path\`, or \`${options.serverName}.detect_changes\`.
- For custom graph queries, call \`${options.serverName}.get_graph_schema\` before \`${options.serverName}.query_graph\`.
- If the MCP server is unavailable, continue without blocking and say that RepoLens context was unavailable.

Local fallback:

\`\`\`bash
${shellJoin([options.command, "--experimental-sqlite", options.cliPath, "context-pack", "implementation target", "--db", options.dbPath])}
\`\`\`
`;
}

export function agentConfigSnippet(agent: AgentId, options: { serverName: string; command: string; cliPath: string; dbPath: string }): string {
  const args = ["--experimental-sqlite", options.cliPath, "mcp"];
  const jsonServer = mcpServerConfig({ ...options, managed: false });

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

function upsertAgentConfig(existing: string, profile: AgentProfile, options: { serverName: string; command: string; cliPath: string; dbPath: string }): string {
  switch (profile.configKind) {
    case "vscode-mcp":
      return upsertVscodeMcpConfig(existing, options);
    default:
      throw new Error(`Unsupported agent config writer for ${profile.id}.`);
  }
}

function removeAgentConfig(existing: string, profile: AgentProfile, serverName: string): string {
  if (!existing.trim()) {
    return "";
  }
  switch (profile.configKind) {
    case "vscode-mcp":
      return removeVscodeMcpConfig(existing, serverName);
    default:
      throw new Error(`Unsupported agent config remover for ${profile.id}.`);
  }
}

function upsertVscodeMcpConfig(existing: string, options: { serverName: string; command: string; cliPath: string; dbPath: string }): string {
  assertSafeServerName(options.serverName);
  const config = parseJsonObject(existing, ".vscode/mcp.json");
  const servers = jsonObjectProperty(config, "servers", ".vscode/mcp.json") ?? {};
  servers[options.serverName] = mcpServerConfig({ ...options, managed: true });
  config.servers = servers;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function removeVscodeMcpConfig(existing: string, serverName: string): string {
  assertSafeServerName(serverName);
  const config = parseJsonObject(existing, ".vscode/mcp.json");
  const servers = jsonObjectProperty(config, "servers", ".vscode/mcp.json", false);
  if (!servers || !isManagedMcpServer(servers[serverName])) {
    return existing;
  }
  delete servers[serverName];
  if (Object.keys(servers).length === 0) {
    delete config.servers;
  } else {
    config.servers = servers;
  }
  return Object.keys(config).length === 0 ? "" : `${JSON.stringify(config, null, 2)}\n`;
}

function mcpServerConfig(options: { serverName: string; command: string; cliPath: string; dbPath: string; managed?: boolean }) {
  const args = ["--experimental-sqlite", options.cliPath, "mcp"];
  return {
    command: options.command,
    args,
    env: {
      NODE_NO_WARNINGS: "1",
      REPOLENS_DB: options.dbPath,
      ...(options.managed ? { REPOLENS_MANAGED: "1" } : {})
    }
  };
}

function parseJsonObject(existing: string, label: string): Record<string, unknown> {
  if (!existing.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(existing) as unknown;
    if (isJsonObject(parsed)) {
      return parsed;
    }
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`${label} must contain a JSON object.`);
}

function jsonObjectProperty(config: Record<string, unknown>, key: string, label: string, create = true): Record<string, unknown> | undefined {
  const value = config[key];
  if (value === undefined) {
    return create ? {} : undefined;
  }
  if (!isJsonObject(value)) {
    throw new Error(`${label}.${key} must be a JSON object.`);
  }
  return { ...value };
}

function isManagedMcpServer(value: unknown): boolean {
  return isJsonObject(value) && isJsonObject(value.env) && value.env.REPOLENS_MANAGED === "1";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeServerName(serverName: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(serverName)) {
    throw new Error("Server name for generated agent config must contain only letters, numbers, underscores, or hyphens.");
  }
}

function agentInstructionBlock(options: { profile: AgentProfile; serverName: string; command: string; cliPath: string; dbPath: string }): string {
  return `# RepoLens MCP

RepoLens is available as the \`${options.serverName}\` MCP server for this project.

Use it before broad file exploration:

- \`${options.serverName}.context_pack\` for focused implementation context.
- \`${options.serverName}.search_graph\` for symbols, routes, services, packages, and protocol surfaces.
- \`${options.serverName}.trace_symbol\` to inspect inbound or outbound call paths.
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

export async function detectAgentProfiles(
  targetDir = process.cwd(),
  options: { homeDir?: string; pathEnv?: string } = {}
): Promise<AgentProfile[]> {
  const root = path.resolve(targetDir);
  const homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE;
  const pathEnv = options.pathEnv ?? process.env.PATH ?? "";
  const found: AgentProfile[] = [];
  for (const profile of agentProfiles) {
    if (await agentDetected(profile, root, homeDir, pathEnv)) {
      found.push(profile);
    }
  }
  return found;
}

async function selectAgents(options: {
  agents?: AgentId[];
  detectAgents?: boolean;
  targetDir: string;
  detectionHome?: string;
  pathEnv?: string;
}): Promise<AgentProfile[]> {
  const base = options.agents?.length ? agentProfiles.filter((profile) => new Set(options.agents).has(profile.id)) : agentProfiles;
  if (!options.detectAgents) {
    return base;
  }
  const detected = new Set((await detectAgentProfiles(options.targetDir, { homeDir: options.detectionHome, pathEnv: options.pathEnv })).map((profile) => profile.id));
  return base.filter((profile) => detected.has(profile.id));
}

async function agentDetected(profile: AgentProfile, targetDir: string, homeDir: string | undefined, pathEnv: string): Promise<boolean> {
  const detection = profile.detection;
  if (!detection) {
    return false;
  }
  if (await anyPathExists(targetDir, detection.projectPaths ?? [])) {
    return true;
  }
  if (homeDir && (await anyPathExists(homeDir, detection.homePaths ?? []))) {
    return true;
  }
  return anyCommandExists(pathEnv, detection.commands ?? []);
}

async function anyPathExists(baseDir: string, relativePaths: string[]): Promise<boolean> {
  for (const relativePath of relativePaths) {
    if (await pathExists(path.join(baseDir, relativePath))) {
      return true;
    }
  }
  return false;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function anyCommandExists(pathEnv: string, commands: string[]): Promise<boolean> {
  const searchDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of searchDirs) {
    for (const command of commands) {
      for (const suffix of suffixes) {
        if (await executablePathExists(path.join(dir, `${command}${suffix}`))) {
          return true;
        }
      }
    }
  }
  return false;
}

async function executablePathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, process.platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
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

function removeMarkdownBlock(existing: string): string {
  const pattern = new RegExp(`${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`, "g");
  return existing.replace(pattern, "");
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
