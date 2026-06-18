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

export interface CodexUninstallOptions {
  configPath?: string;
  serverName?: string;
  dryRun?: boolean;
}

export interface CodexUninstallResult {
  configPath: string;
  serverName: string;
  changed: boolean;
  dryRun: boolean;
  managedBlockPresent: boolean;
  reason?: string;
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

  const base = removeMcpServerSections(stripManagedBlock(existing), serverName);
  const next = upsertManagedBlock(base, block);
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

export async function uninstallCodexConfig(options: CodexUninstallOptions = {}): Promise<CodexUninstallResult> {
  const configPath = path.resolve(options.configPath ?? defaultCodexConfigPath());
  const serverName = options.serverName ?? "repolens";
  const existing = await fs.readFile(configPath, "utf8").catch(() => "");
  const managedBlockPresent = hasManagedBlock(existing);
  if (!managedBlockPresent) {
    return {
      configPath,
      serverName,
      changed: false,
      dryRun: options.dryRun ?? false,
      managedBlockPresent: false,
      reason: "No RepoLens managed block found; unmanaged MCP entries are left untouched"
    };
  }
  const next = stripManagedBlock(existing).trimEnd();
  if (!options.dryRun) {
    await fs.writeFile(configPath, next ? `${next}\n` : "");
  }
  return {
    configPath,
    serverName,
    changed: next !== existing.trimEnd(),
    dryRun: options.dryRun ?? false,
    managedBlockPresent: true
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

function stripManagedBlock(config: string): string {
  const pattern = new RegExp(`${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n?`, "g");
  return config.replace(pattern, "");
}

function removeMcpServerSections(config: string, serverName: string): string {
  const table = `mcp_servers.${serverName}`;
  const lines = config.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (match) {
      const section = match[1]?.trim() ?? "";
      skipping = section === table || section.startsWith(`${table}.`);
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
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
