import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { DeleteProjectResult, IndexResult, ProjectRecord, ProjectStatus } from "./types.js";

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
  const projects = await readProjects();
  const next = [record, ...projects.filter((project) => !sameProject(project, record))].sort((a, b) => b.indexedAt.localeCompare(a.indexedAt));
  await writeProjects(next);
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

export async function deleteProject(identifier: string, deleteDb = false): Promise<DeleteProjectResult> {
  const projects = await readProjects();
  const matches = projects.filter((project) => projectMatches(project, identifier));
  const keep = projects.filter((project) => !projectMatches(project, identifier));
  const deletedDbFiles: string[] = [];
  const skippedDbFiles: string[] = [];

  if (deleteDb) {
    for (const project of matches) {
      const deleted = await deleteDbArtifacts(project);
      deletedDbFiles.push(...deleted.deleted);
      skippedDbFiles.push(...deleted.skipped);
    }
  }

  await writeProjects(keep);
  return {
    identifier,
    removed: matches.length,
    remaining: keep.length,
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
