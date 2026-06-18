import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { DeleteProjectResult, FleetProjectSummary, FleetSummary, IndexResult, Language, ProjectRecord, ProjectStatus, SymbolNode } from "./types.js";

interface CatalogFile {
  version: 1;
  projects: ProjectRecord[];
}

export function catalogPath(): string {
  return path.resolve(process.env.REPOLENS_CATALOG ?? path.join(os.homedir(), ".cache", "repolens-mcp", "projects.json"));
}

export async function recordProjectIndex(result: IndexResult, label?: string): Promise<ProjectRecord> {
  const record: ProjectRecord = {
    root: path.resolve(result.root),
    dbPath: path.resolve(result.dbPath),
    ...(label ? { label } : {}),
    indexedAt: result.indexedAt,
    mode: result.mode,
    filesDiscovered: result.filesDiscovered,
    filesIndexed: result.filesIndexed,
    filesSkipped: result.filesSkipped,
    symbols: result.symbols,
    edges: result.edges,
    elapsedMs: result.elapsedMs
  };
  await withCatalogLock(async () => {
    const projects = await readProjects();
    const next = [record, ...projects.filter((project) => !sameProject(project, record))].sort((a, b) => b.indexedAt.localeCompare(a.indexedAt));
    await writeProjects(next);
  });
  return record;
}

export async function listProjects(limit = 50): Promise<ProjectStatus[]> {
  const projects = (await readProjects()).sort((a, b) => b.indexedAt.localeCompare(a.indexedAt)).slice(0, clamp(limit, 1, 500));
  return Promise.all(projects.map(projectStatusForRecord));
}

export async function getProjectStatus(identifier?: string): Promise<ProjectStatus | null> {
  const projects = await readProjects();
  const record = identifier ? findProject(projects, identifier) : projects.sort((a, b) => b.indexedAt.localeCompare(a.indexedAt))[0];
  return record ? projectStatusForRecord(record) : null;
}

export async function fleetSummary(limit = 50): Promise<FleetSummary> {
  const records = (await readProjects()).sort((a, b) => b.indexedAt.localeCompare(a.indexedAt)).slice(0, clamp(limit, 1, 500));
  const projects = await Promise.all(records.map(fleetProjectForRecord));
  const available = projects.filter((project) => project.dbExists && project.totals);
  const languageMap = new Map<Language, { language: Language; files: number; symbols: number; projects: Set<string> }>();
  const dependencyProjects = new Map<string, Set<string>>();
  const routeProjects = new Map<string, Set<string>>();

  for (const project of projects) {
    const projectName = projectLabel(project);
    for (const language of project.languages) {
      const current = languageMap.get(language.language) ?? { language: language.language, files: 0, symbols: 0, projects: new Set<string>() };
      current.files += language.files;
      current.symbols += language.symbols;
      current.projects.add(projectName);
      languageMap.set(language.language, current);
    }
    for (const dependency of project.dependencies) {
      const current = dependencyProjects.get(dependency) ?? new Set<string>();
      current.add(projectName);
      dependencyProjects.set(dependency, current);
    }
    for (const route of project.routes) {
      const routeKey = `${route.method ?? "ANY"} ${route.path ?? route.name}`.trim();
      const current = routeProjects.get(routeKey) ?? new Set<string>();
      current.add(projectName);
      routeProjects.set(routeKey, current);
    }
  }

  const risks = [
    ...projects.filter((project) => !project.dbExists).map((project) => `${projectLabel(project)} database missing`),
    ...projects.flatMap((project) => project.risks.map((risk) => `${projectLabel(project)}: ${risk}`))
  ];

  return {
    generatedAt: new Date().toISOString(),
    catalogPath: catalogPath(),
    totals: {
      projects: projects.length,
      availableProjects: available.length,
      files: sum(available, (project) => project.totals?.files ?? 0),
      symbols: sum(available, (project) => project.totals?.symbols ?? 0),
      edges: sum(available, (project) => project.totals?.edges ?? 0),
      routes: sum(projects, (project) => project.routes.length),
      packages: new Set(projects.flatMap((project) => project.packages)).size,
      dependencies: new Set(projects.flatMap((project) => project.dependencies)).size
    },
    projects,
    languages: [...languageMap.values()]
      .map((language) => ({ language: language.language, files: language.files, symbols: language.symbols, projects: language.projects.size }))
      .sort((a, b) => b.symbols - a.symbols || b.files - a.files || a.language.localeCompare(b.language)),
    sharedDependencies: [...dependencyProjects.entries()]
      .map(([name, projectSet]) => ({ name, projects: [...projectSet].sort(), count: projectSet.size }))
      .filter((dependency) => dependency.count > 1)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 50),
    routeOverlaps: [...routeProjects.entries()]
      .map(([route, projectSet]) => ({ route, projects: [...projectSet].sort(), count: projectSet.size }))
      .filter((route) => route.count > 1)
      .sort((a, b) => b.count - a.count || a.route.localeCompare(b.route))
      .slice(0, 50),
    risks
  };
}

export async function deleteProject(identifier: string, deleteDb = false): Promise<DeleteProjectResult> {
  const deletedDbFiles: string[] = [];
  const skippedDbFiles: string[] = [];
  let removed = 0;
  let remaining = 0;

  await withCatalogLock(async () => {
    const projects = await readProjects();
    const matches = projects.filter((project) => projectMatches(project, identifier));
    const keep = projects.filter((project) => !projectMatches(project, identifier));
    removed = matches.length;
    remaining = keep.length;

    if (deleteDb) {
      for (const project of matches) {
        const deleted = await deleteDbArtifacts(project);
        deletedDbFiles.push(...deleted.deleted);
        skippedDbFiles.push(...deleted.skipped);
      }
    }

    await writeProjects(keep);
  });

  return {
    identifier,
    removed,
    remaining,
    deletedDbFiles: [...new Set(deletedDbFiles)].sort(),
    skippedDbFiles: [...new Set(skippedDbFiles)].sort()
  };
}

async function projectStatusForRecord(record: ProjectRecord): Promise<ProjectStatus> {
  const dbExists = await fileExists(record.dbPath);
  if (!dbExists) {
    return { ...record, dbExists, staleReason: "database file is missing" };
  }
  try {
    const store = new MemoryStore(record.dbPath);
    try {
      return { ...record, dbExists, liveTotals: store.graphSchema().totals };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      ...record,
      dbExists,
      staleReason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fleetProjectForRecord(record: ProjectRecord): Promise<FleetProjectSummary> {
  const status = await projectStatusForRecord(record);
  const risks = [
    ...(status.staleReason ? [status.staleReason] : []),
    ...(status.filesSkipped > 0 ? [`${status.filesSkipped} files skipped in latest index`] : [])
  ];

  if (!status.dbExists || !status.liveTotals) {
    return {
      root: status.root,
      dbPath: status.dbPath,
      ...(status.label ? { label: status.label } : {}),
      indexedAt: status.indexedAt,
      dbExists: status.dbExists,
      languages: [],
      routes: [],
      packages: [],
      dependencies: [],
      risks
    };
  }

  try {
    const store = new MemoryStore(status.dbPath);
    try {
      const schema = store.graphSchema();
      const routes = store.searchGraph({ kind: "route", limit: 200 }).map((match) => routeSummary(match.symbol));
      const packages = uniqueNames(store.searchGraph({ kind: "package", limit: 200 }).map((match) => match.symbol.name));
      const dependencies = uniqueNames(store.searchGraph({ kind: "dependency", limit: 200 }).map((match) => match.symbol.name));
      return {
        root: status.root,
        dbPath: status.dbPath,
        ...(status.label ? { label: status.label } : {}),
        indexedAt: status.indexedAt,
        dbExists: true,
        totals: schema.totals,
        languages: schema.languages,
        routes,
        packages,
        dependencies,
        risks
      };
    } finally {
      store.close();
    }
  } catch (error) {
    return {
      root: status.root,
      dbPath: status.dbPath,
      ...(status.label ? { label: status.label } : {}),
      indexedAt: status.indexedAt,
      dbExists: status.dbExists,
      totals: status.liveTotals,
      languages: [],
      routes: [],
      packages: [],
      dependencies: [],
      risks: [...risks, error instanceof Error ? error.message : String(error)]
    };
  }
}

function routeSummary(symbol: SymbolNode): FleetProjectSummary["routes"][number] {
  return {
    name: symbol.name,
    method: metadataString(symbol, "method") ?? symbol.name.split(/\s+/)[0],
    path: metadataString(symbol, "path"),
    filePath: symbol.filePath
  };
}

function metadataString(symbol: SymbolNode, key: string): string | undefined {
  const value = symbol.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function deleteDbArtifacts(project: ProjectRecord): Promise<{ deleted: string[]; skipped: string[] }> {
  const dbPath = path.resolve(project.dbPath);
  if (!isSafeProjectDbPath(project.root, dbPath)) {
    return { deleted: [], skipped: [dbPath] };
  }

  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    try {
      if (await fileExists(candidate)) {
        await fs.rm(candidate, { force: true });
        deleted.push(candidate);
      }
    } catch {
      // Keep catalog deletion deterministic; failed file cleanup is reported as skipped.
      skipped.push(candidate);
    }
  }
  return { deleted, skipped };
}

function isSafeProjectDbPath(root: string, dbPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const defaultPath = path.resolve(defaultDbPath(resolvedRoot));
  const repoRepolensDir = path.join(resolvedRoot, ".repolens") + path.sep;
  return dbPath === defaultPath || dbPath.startsWith(repoRepolensDir) || dbPath.includes(`${path.sep}.repolens${path.sep}`);
}

function findProject(projects: ProjectRecord[], identifier: string): ProjectRecord | undefined {
  return projects.find((project) => projectMatches(project, identifier));
}

function projectMatches(project: ProjectRecord, identifier: string): boolean {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return false;
  }
  const resolved = path.resolve(trimmed);
  return project.root === resolved || project.dbPath === resolved || project.label === trimmed || path.basename(project.root) === trimmed;
}

function sameProject(left: ProjectRecord, right: ProjectRecord): boolean {
  return left.root === right.root && left.dbPath === right.dbPath;
}

function projectLabel(project: Pick<ProjectRecord, "root" | "label">): string {
  return project.label ?? path.basename(project.root);
}

function uniqueNames(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

async function readProjects(): Promise<ProjectRecord[]> {
  try {
    const raw = await fs.readFile(catalogPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<CatalogFile>;
    return Array.isArray(parsed.projects) ? parsed.projects.filter(isProjectRecord) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeProjects(projects: ProjectRecord[]): Promise<void> {
  const filePath = catalogPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload: CatalogFile = { version: 1, projects };
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function withCatalogLock<T>(fn: () => Promise<T>): Promise<T> {
  const filePath = catalogPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  const started = Date.now();
  let handle: fs.FileHandle | null = null;

  while (!handle) {
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      await removeStaleLock(lockPath);
      if (Date.now() - started > 5000) {
        throw new Error(`Timed out waiting for RepoLens catalog lock at ${lockPath}`);
      }
      await delay(25);
    }
  }

  try {
    return await fn();
  } finally {
    await handle.close().catch(() => undefined);
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const stats = await fs.stat(lockPath);
    if (Date.now() - stats.mtimeMs > 30_000) {
      await fs.rm(lockPath, { force: true });
    }
  } catch {
    // Another process may have released the lock between open attempts.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isProjectRecord(value: unknown): value is ProjectRecord {
  const record = value as ProjectRecord;
  return Boolean(record && typeof record.root === "string" && typeof record.dbPath === "string" && typeof record.indexedAt === "string");
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
}
