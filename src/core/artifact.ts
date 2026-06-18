import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzip, gunzip } from "node:zlib";
import { promisify } from "node:util";
import { sha256 } from "./hash.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { GraphPackageExportResult, GraphPackageImportResult } from "./types.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const MAGIC = "REPOLENS_GRAPH_PACKAGE_V1";

interface GraphPackageHeader {
  magic: typeof MAGIC;
  createdAt: string;
  sourceDbPath: string;
  label?: string;
  sqliteBytes: number;
  sha256: string;
}

export async function exportGraphPackage(options: { dbPath?: string; outPath: string; label?: string }): Promise<GraphPackageExportResult> {
  const sourceDbPath = resolveDbPath(options.dbPath);
  await assertReadableFile(sourceDbPath, "database");
  const outPath = path.resolve(options.outPath);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-pack-"));
  const snapshotPath = path.join(tmpDir, "graph.db");
  try {
    const store = new MemoryStore(sourceDbPath);
    try {
      store.snapshotTo(snapshotPath);
    } finally {
      store.close();
    }

    const sqlite = await fs.readFile(snapshotPath);
    const compressed = await gzipAsync(sqlite, { level: 9 });
    const header: GraphPackageHeader = {
      magic: MAGIC,
      createdAt: new Date().toISOString(),
      sourceDbPath,
      ...(options.label ? { label: options.label } : {}),
      sqliteBytes: sqlite.byteLength,
      sha256: sha256(sqlite)
    };
    const packageBody = Buffer.concat([Buffer.from(`${JSON.stringify(header)}\n`, "utf8"), compressed]);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, packageBody);
    return {
      outPath,
      sourceDbPath,
      ...(options.label ? { label: options.label } : {}),
      createdAt: header.createdAt,
      sqliteBytes: sqlite.byteLength,
      compressedBytes: compressed.byteLength,
      packageBytes: packageBody.byteLength,
      sha256: header.sha256
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function importGraphPackage(options: { packagePath: string; dbPath?: string; overwrite?: boolean }): Promise<GraphPackageImportResult> {
  const packagePath = path.resolve(options.packagePath);
  const dbPath = resolveDbPath(options.dbPath);
  const payload = await fs.readFile(packagePath);
  const newline = payload.indexOf(10);
  if (newline < 0) {
    throw new Error("Invalid RepoLens graph package: missing header");
  }
  const header = JSON.parse(payload.subarray(0, newline).toString("utf8")) as GraphPackageHeader;
  if (header.magic !== MAGIC) {
    throw new Error("Invalid RepoLens graph package: unsupported format");
  }
  const sqlite = await gunzipAsync(payload.subarray(newline + 1));
  const actualHash = sha256(sqlite);
  if (actualHash !== header.sha256) {
    throw new Error(`Invalid RepoLens graph package: checksum mismatch ${actualHash} != ${header.sha256}`);
  }
  if (sqlite.byteLength !== header.sqliteBytes) {
    throw new Error(`Invalid RepoLens graph package: size mismatch ${sqlite.byteLength} != ${header.sqliteBytes}`);
  }
  if (!options.overwrite && (await fileExists(dbPath))) {
    throw new Error(`Database already exists at ${dbPath}. Pass overwrite to replace it.`);
  }
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  if (options.overwrite) {
    await removeSqliteFiles(dbPath);
  }
  await fs.writeFile(dbPath, sqlite);

  const store = new MemoryStore(dbPath);
  try {
    const schema = store.graphSchema();
    return {
      packagePath,
      dbPath,
      ...(header.label ? { label: header.label } : {}),
      createdAt: header.createdAt,
      sqliteBytes: sqlite.byteLength,
      sha256: header.sha256,
      totals: schema.totals
    };
  } finally {
    store.close();
  }
}

function resolveDbPath(dbPath: string | undefined): string {
  const root = path.resolve(process.cwd());
  return path.resolve(dbPath ?? process.env.REPOLENS_DB ?? defaultDbPath(root));
}

async function assertReadableFile(filePath: string, label: string): Promise<void> {
  const stats = await fs.stat(filePath).catch(() => null);
  if (!stats?.isFile()) {
    throw new Error(`No ${label} found at ${filePath}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  return Boolean(await fs.stat(filePath).catch(() => null));
}

async function removeSqliteFiles(dbPath: string): Promise<void> {
  await Promise.all([
    fs.rm(dbPath, { force: true }),
    fs.rm(`${dbPath}-shm`, { force: true }),
    fs.rm(`${dbPath}-wal`, { force: true })
  ]);
}
