import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type AutoIndexMode = "off" | "incremental" | "full";

export interface RepoLensConfig {
  autoIndex?: AutoIndexMode;
  autoSync?: boolean;
  autoSyncIntervalMs?: number;
  root?: string;
  dbPath?: string;
  maxFileBytes?: number;
  autoIndexLabel?: string;
  bootstrapPackage?: string | false;
}

export interface ConfigResult {
  path: string;
  config: RepoLensConfig;
}

const keyAliases = new Map<string, keyof RepoLensConfig>([
  ["autoindex", "autoIndex"],
  ["auto-index", "autoIndex"],
  ["auto_index", "autoIndex"],
  ["autosync", "autoSync"],
  ["auto-sync", "autoSync"],
  ["auto_sync", "autoSync"],
  ["autosyncintervalms", "autoSyncIntervalMs"],
  ["auto-sync-interval-ms", "autoSyncIntervalMs"],
  ["auto_sync_interval_ms", "autoSyncIntervalMs"],
  ["root", "root"],
  ["repo", "root"],
  ["db", "dbPath"],
  ["dbpath", "dbPath"],
  ["db-path", "dbPath"],
  ["db_path", "dbPath"],
  ["maxfilebytes", "maxFileBytes"],
  ["max-file-bytes", "maxFileBytes"],
  ["max_file_bytes", "maxFileBytes"],
  ["autoindexlabel", "autoIndexLabel"],
  ["auto-index-label", "autoIndexLabel"],
  ["auto_index_label", "autoIndexLabel"],
  ["bootstrap", "bootstrapPackage"],
  ["bootstrappackage", "bootstrapPackage"],
  ["bootstrap-package", "bootstrapPackage"],
  ["bootstrap_package", "bootstrapPackage"]
]);

export function repoLensConfigPath(configPath?: string): string {
  return path.resolve(configPath ?? process.env.REPOLENS_CONFIG ?? path.join(os.homedir(), ".config", "repolens-mcp", "config.json"));
}

export function loadRepoLensConfig(configPath?: string): RepoLensConfig {
  const resolved = repoLensConfigPath(configPath);
  if (!fs.existsSync(resolved)) {
    return {};
  }
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`RepoLens config must be a JSON object: ${resolved}`);
  }
  return normalizeConfig(parsed as Record<string, unknown>);
}

export function readRepoLensConfig(configPath?: string): ConfigResult {
  const resolved = repoLensConfigPath(configPath);
  return { path: resolved, config: loadRepoLensConfig(resolved) };
}

export function getRepoLensConfigValue(key: string, configPath?: string): ConfigResult & { key: keyof RepoLensConfig; value: RepoLensConfig[keyof RepoLensConfig] | undefined } {
  const normalizedKey = normalizeConfigKey(key);
  const result = readRepoLensConfig(configPath);
  return { ...result, key: normalizedKey, value: result.config[normalizedKey] };
}

export function setRepoLensConfigValue(key: string, value: string, configPath?: string): ConfigResult {
  const resolved = repoLensConfigPath(configPath);
  const normalizedKey = normalizeConfigKey(key);
  const config = loadRepoLensConfig(resolved);
  config[normalizedKey] = parseConfigValue(normalizedKey, value) as never;
  writeConfig(resolved, config);
  return { path: resolved, config };
}

export function resetRepoLensConfigValue(key?: string, configPath?: string): ConfigResult {
  const resolved = repoLensConfigPath(configPath);
  if (!key) {
    writeConfig(resolved, {});
    return { path: resolved, config: {} };
  }
  const normalizedKey = normalizeConfigKey(key);
  const config = loadRepoLensConfig(resolved);
  delete config[normalizedKey];
  writeConfig(resolved, config);
  return { path: resolved, config };
}

export function configValueFromEnvOrConfig(envValue: string | undefined, configValue: string | number | boolean | undefined): string | undefined {
  if (envValue !== undefined) {
    return envValue;
  }
  if (configValue === undefined) {
    return undefined;
  }
  return String(configValue);
}

function writeConfig(configPath: string, config: RepoLensConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(sortConfig(config), null, 2)}\n`);
}

function normalizeConfig(input: Record<string, unknown>): RepoLensConfig {
  const config: RepoLensConfig = {};
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeConfigKey(key);
    config[normalizedKey] = normalizeRawConfigValue(normalizedKey, value) as never;
  }
  return config;
}

function normalizeRawConfigValue(key: keyof RepoLensConfig, value: unknown): RepoLensConfig[keyof RepoLensConfig] {
  if (typeof value === "string") {
    return parseConfigValue(key, value);
  }
  if (key === "autoIndex" && typeof value === "boolean") {
    return value ? "incremental" : "off";
  }
  if (key === "autoSync" && typeof value === "boolean") {
    return value;
  }
  if (key === "autoSyncIntervalMs" && typeof value === "number") {
    return parsePositiveInteger(value, "autoSyncIntervalMs");
  }
  if (key === "maxFileBytes" && typeof value === "number") {
    return parsePositiveInteger(value, "maxFileBytes");
  }
  if (key === "bootstrapPackage" && value === false) {
    return false;
  }
  throw new Error(`Invalid RepoLens config value for ${key}`);
}

function parseConfigValue(key: keyof RepoLensConfig, value: string): RepoLensConfig[keyof RepoLensConfig] {
  const trimmed = value.trim();
  if (key === "autoIndex") {
    const normalized = trimmed.toLowerCase();
    if (["0", "false", "off", "no"].includes(normalized)) return "off";
    if (["1", "true", "on", "yes", "incremental"].includes(normalized)) return "incremental";
    if (normalized === "full") return "full";
    throw new Error("autoIndex must be off, incremental, or full");
  }
  if (key === "autoSync") {
    const normalized = trimmed.toLowerCase();
    if (["0", "false", "off", "no"].includes(normalized)) return false;
    if (["1", "true", "on", "yes"].includes(normalized)) return true;
    throw new Error("autoSync must be on or off");
  }
  if (key === "autoSyncIntervalMs") {
    return parsePositiveInteger(Number(trimmed), "autoSyncIntervalMs");
  }
  if (key === "maxFileBytes") {
    return parsePositiveInteger(Number(trimmed), "maxFileBytes");
  }
  if (key === "bootstrapPackage" && ["0", "false", "off", "no"].includes(trimmed.toLowerCase())) {
    return false;
  }
  if (!trimmed) {
    throw new Error(`${key} cannot be empty`);
  }
  return trimmed;
}

function parsePositiveInteger(value: number, key: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function normalizeConfigKey(key: string): keyof RepoLensConfig {
  const normalized = key.trim().replace(/[^A-Za-z0-9_-]/g, "").toLowerCase();
  const mapped = keyAliases.get(normalized);
  if (!mapped) {
    throw new Error(`Unknown RepoLens config key: ${key}`);
  }
  return mapped;
}

function sortConfig(config: RepoLensConfig): RepoLensConfig {
  const sorted: RepoLensConfig = {};
  for (const key of ["autoIndex", "autoSync", "autoSyncIntervalMs", "root", "dbPath", "maxFileBytes", "autoIndexLabel", "bootstrapPackage"] as const) {
    if (config[key] !== undefined) {
      sorted[key] = config[key] as never;
    }
  }
  return sorted;
}
