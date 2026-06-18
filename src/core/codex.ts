import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MANAGED_START = "# >>> repolens-mcp managed >>>";
const MANAGED_END = "# <<< repolens-mcp managed <<<";

export interface CodexInstallOptions {
  configPath?: string;
  serverName?: string;
  command: string;
  cliPath: string;
  dbPath?: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface CodexInstallResult {
  configPath: string;
  serverName: string;
  changed: boolean;
  dryRun: boolean;
  alreadyConfigured: boolean;
  reason?: string;
  block: string;
}

export interface CodexDoctorResult {
  node: string;
  cliPath: string;
  configPath: string;
  configExists: boolean;
  repolensConfigured: boolean;
  managedBlockPresent: boolean;
  recommendedCommand: string;
}

export async function installCodexConfig(options: CodexInstallOptions): Promise<CodexInstallResult> {
  const configPath = path.resolve(options.configPath ?? defaultCodexConfigPath());
  const serverName = options.serverName ?? "repolens";
  const block = codexManagedBlock({
    serverName,
    command: options.command,
    cliPath: options.cliPath,
    dbPath: options.dbPath ?? ".repolens/memory.db"
  });
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  const hasManaged = hasManagedBlock(existing);
  const hasServer = hasMcpServer(existing, serverName);

  if (hasServer && !hasManaged && !options.force) {
    return {
      configPath,
      serverName,
      changed: false,
      dryRun: options.dryRun ?? false,
      alreadyConfigured: true,
      reason: `mcp_servers.${serverName} already exists; pass --force to replace it with a RepoLens managed block`,
      block
    };
  }

  const next = upsertManagedBlock(existing, block);
  if (options.dryRun) {
    return {
      configPath,
      serverName,
      changed: next !== existing,
      dryRun: true,
      alreadyConfigured: hasServer,
      block
    };
  }

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, next);
  return {
    configPath,
    serverName,
    changed: next !== existing,
    dryRun: false,
    alreadyConfigured: hasServer,
    block
  };
}

export async function codexDoctor(cliPath: string, command: string, configPath = defaultCodexConfigPath(), serverName = "repolens"): Promise<CodexDoctorResult> {
  const resolvedConfigPath = path.resolve(configPath);
  const existing = await fs.readFile(resolvedConfigPath, "utf8").catch(() => "");
  return {
    node: process.version,
    cliPath,
    configPath: resolvedConfigPath,
    configExists: existing.length > 0,
    repolensConfigured: hasMcpServer(existing, serverName),
    managedBlockPresent: hasManagedBlock(existing),
    recommendedCommand: `repolens-mcp install-codex --db .repolens/memory.db`
  };
}

export function codexManagedBlock(options: { serverName: string; command: string; cliPath: string; dbPath: string }): string {
  const args = ["--experimental-sqlite", options.cliPath, "mcp"];
  return `${MANAGED_START}
[mcp_servers.${options.serverName}]
command = ${tomlString(options.command)}
args = ${tomlArray(args)}
startup_timeout_sec = 120

[mcp_servers.${options.serverName}.env]
NODE_NO_WARNINGS = "1"
REPOLENS_DB = ${tomlString(options.dbPath)}
${MANAGED_END}
`;
}

export function upsertManagedBlock(config: string, block: string): string {
  const normalizedBlock = block.endsWith("\n") ? block : `${block}\n`;
  const pattern = new RegExp(`${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`);
  if (pattern.test(config)) {
    return config.replace(pattern, normalizedBlock);
  }
  const trimmed = config.trimEnd();
  return trimmed ? `${trimmed}\n\n${normalizedBlock}` : normalizedBlock;
}

export function hasMcpServer(config: string, serverName: string): boolean {
  return new RegExp(`^\\s*\\[mcp_servers\\.${escapeRegExp(serverName)}\\]\\s*$`, "m").test(config);
}

export function hasManagedBlock(config: string): boolean {
  return config.includes(MANAGED_START) && config.includes(MANAGED_END);
}

function defaultCodexConfigPath(): string {
  return path.join(os.homedir(), ".codex", "config.toml");
}

function tomlArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
