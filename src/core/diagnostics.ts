import fs from "node:fs";
import path from "node:path";

const DEFAULT_DIAGNOSTICS_FILE = path.join(".repolens", "diagnostics.jsonl");
const FALSE_VALUES = new Set(["0", "false", "off", "no", "none", "disabled"]);
const TRUE_VALUES = new Set(["1", "true", "on", "yes"]);
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_LENGTH = 25;
const MAX_OBJECT_KEYS = 50;

export type DiagnosticsPathSetting = string | false | undefined;

export interface DiagnosticsSink {
  readonly path?: string;
  emit(event: string, payload?: Record<string, unknown>): void;
}

export function createDiagnosticsSink(options: {
  root: string;
  diagnosticsPath?: DiagnosticsPathSetting;
  env?: NodeJS.ProcessEnv;
}): DiagnosticsSink {
  const outputPath = resolveDiagnosticsPath(options.diagnosticsPath, options.root, options.env);
  if (!outputPath) {
    return disabledDiagnosticsSink;
  }
  return new JsonlDiagnosticsSink(outputPath);
}

export function diagnosticsSettingFromEnvOrConfig(
  envValue: string | undefined,
  configValue: string | false | undefined
): DiagnosticsPathSetting {
  if (envValue !== undefined) {
    return normalizeDiagnosticsSetting(envValue);
  }
  return configValue;
}

export function resolveDiagnosticsPath(setting: DiagnosticsPathSetting, root: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const rawSetting = setting !== undefined ? setting : normalizeDiagnosticsSetting(env.REPOLENS_DIAGNOSTICS);
  if (rawSetting === false || rawSetting === undefined) {
    return undefined;
  }

  const trimmed = rawSetting.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (FALSE_VALUES.has(normalized)) {
    return undefined;
  }
  const configuredPath = TRUE_VALUES.has(normalized) ? DEFAULT_DIAGNOSTICS_FILE : trimmed;
  return path.resolve(root, configuredPath);
}

export function normalizeDiagnosticsSetting(value: string | false | undefined): DiagnosticsPathSetting {
  if (value === false || value === undefined) {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || FALSE_VALUES.has(trimmed.toLowerCase())) {
    return false;
  }
  return trimmed;
}

export function diagnosticErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error) };
}

const disabledDiagnosticsSink: DiagnosticsSink = {
  emit() {
    return;
  }
};

class JsonlDiagnosticsSink implements DiagnosticsSink {
  readonly path: string;
  private warningWritten = false;

  constructor(outputPath: string) {
    this.path = outputPath;
  }

  emit(event: string, payload: Record<string, unknown> = {}): void {
    try {
      fs.mkdirSync(path.dirname(this.path), { recursive: true });
      const record = {
        ts: new Date().toISOString(),
        pid: process.pid,
        event,
        ...sanitizeRecord(payload)
      };
      fs.appendFileSync(this.path, `${JSON.stringify(record)}\n`, "utf8");
    } catch (error) {
      if (!this.warningWritten) {
        this.warningWritten = true;
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`RepoLens diagnostics disabled after write failure: ${message}\n`);
      }
    }
  }
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record).slice(0, MAX_OBJECT_KEYS)) {
    const safeValue = sanitizeValue(value, 0);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }
  return sanitized;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...` : value;
  }
  if (depth >= 4) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
  }
  const object = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(object).slice(0, MAX_OBJECT_KEYS)) {
    const safeValue = sanitizeValue(nested, depth + 1);
    if (safeValue !== undefined) {
      sanitized[key] = safeValue;
    }
  }
  return sanitized;
}
