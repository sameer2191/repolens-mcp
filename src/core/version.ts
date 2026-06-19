import fs from "node:fs/promises";

export interface VersionStatusOptions {
  checkRemote?: boolean;
  registryUrl?: string;
  timeoutMs?: number;
}

export interface VersionStatus {
  packageName: string;
  installedVersion: string;
  nodeVersion: string;
  updateCommand: string;
  npxCommand: string;
  registry: {
    checked: boolean;
    url?: string;
    latestVersion?: string;
    updateAvailable?: boolean;
    error?: string;
  };
}

const packageJsonUrl = new URL("../../../package.json", import.meta.url);
const defaultRegistryUrl = "https://registry.npmjs.org";

export async function getVersionStatus(options: VersionStatusOptions = {}): Promise<VersionStatus> {
  const { name, version } = await readPackageMetadata();
  const registryUrl = normalizeRegistryUrl(options.registryUrl ?? process.env.REPOLENS_NPM_REGISTRY ?? defaultRegistryUrl);
  const status: VersionStatus = {
    packageName: name,
    installedVersion: version,
    nodeVersion: process.version,
    updateCommand: `npm install -g ${name}@latest`,
    npxCommand: `npx ${name}@latest --help`,
    registry: {
      checked: false,
      url: registryUrl
    }
  };

  if (!options.checkRemote) {
    return status;
  }

  try {
    const latestVersion = await fetchLatestVersion(name, registryUrl, options.timeoutMs ?? 3000);
    status.registry = {
      checked: true,
      url: registryUrl,
      latestVersion,
      updateAvailable: compareVersions(latestVersion, version) > 0
    };
  } catch (error) {
    status.registry = {
      checked: true,
      url: registryUrl,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  return status;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) {
      return a.parts[index] > b.parts[index] ? 1 : -1;
    }
  }
  if (a.prerelease === b.prerelease) {
    return 0;
  }
  if (!a.prerelease) {
    return 1;
  }
  if (!b.prerelease) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

async function readPackageMetadata(): Promise<{ name: string; version: string }> {
  const parsed = JSON.parse(await fs.readFile(packageJsonUrl, "utf8")) as { name?: unknown; version?: unknown };
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error("package.json must include string name and version fields.");
  }
  return { name: parsed.name, version: parsed.version };
}

async function fetchLatestVersion(name: string, registryUrl: string, timeoutMs: number): Promise<string> {
  const url = `${registryUrl}/${encodePackageName(name)}`;
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json, application/json" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { "dist-tags"?: { latest?: unknown } };
  const latest = body["dist-tags"]?.latest;
  if (typeof latest !== "string" || latest.length === 0) {
    throw new Error("npm registry response did not include dist-tags.latest.");
  }
  return latest;
}

function normalizeRegistryUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Registry URL must use http or https.");
  }
  return parsed.toString().replace(/\/+$/, "");
}

export function encodePackageName(name: string): string {
  return name.startsWith("@") ? name.replaceAll("/", "%2f") : encodeURIComponent(name);
}

function parseVersion(value: string): { parts: [number, number, number]; prerelease: string } {
  const [core, prerelease = ""] = value.replace(/^v/, "").split("-", 2);
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  return {
    parts: [parts[0] || 0, parts[1] || 0, parts[2] || 0],
    prerelease
  };
}
