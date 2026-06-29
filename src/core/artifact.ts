import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzip, createGunzip } from "node:zlib";
import { promisify } from "node:util";
import { sha256 } from "./hash.js";
import { defaultDbPath, MemoryStore } from "./store.js";
import type { GraphPackageExportResult, GraphPackageImportResult } from "./types.js";

const gzipAsync = promisify(gzip);
const MAGIC = "REPOLENS_GRAPH_PACKAGE_V1";
const MAX_GRAPH_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_GRAPH_HEADER_BYTES = 16 * 1024;
const MAX_GRAPH_SQLITE_BYTES = 512 * 1024 * 1024;

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
  const packageStats = await fs.stat(packagePath).catch(() => null);
  if (!packageStats?.isFile()) {
    throw new Error(`No graph package found at ${packagePath}`);
  }
  if (packageStats.size > MAX_GRAPH_PACKAGE_BYTES) {
    throw new Error(`RepoLens graph package is ${packageStats.size} bytes, which exceeds the ${MAX_GRAPH_PACKAGE_BYTES} byte package limit.`);
  }
  const payload = await fs.readFile(packagePath);
  const newline = payload.indexOf(10);
  if (newline < 0) {
    throw new Error("Invalid RepoLens graph package: missing header");
  }
  if (newline > MAX_GRAPH_HEADER_BYTES) {
    throw new Error(`Invalid RepoLens graph package: header exceeds ${MAX_GRAPH_HEADER_BYTES} bytes.`);
  }
  const header = parseGraphPackageHeader(payload.subarray(0, newline).toString("utf8"));
  if (header.magic !== MAGIC) {
    throw new Error("Invalid RepoLens graph package: unsupported format");
  }
  if (!Number.isSafeInteger(header.sqliteBytes) || header.sqliteBytes <= 0 || header.sqliteBytes > MAX_GRAPH_SQLITE_BYTES) {
    throw new Error(`Invalid RepoLens graph package: sqliteBytes must be between 1 and ${MAX_GRAPH_SQLITE_BYTES}.`);
  }
  const sqlite = await gunzipBounded(payload.subarray(newline + 1), header.sqliteBytes);
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
  const tmpDbPath = path.join(path.dirname(dbPath), `.repolens-import-${process.pid}-${Date.now()}.db`);
  try {
    await fs.writeFile(tmpDbPath, sqlite, { flag: "wx" });
    const store = new MemoryStore(tmpDbPath);
    let totals: GraphPackageImportResult["totals"];
    try {
      const schema = store.graphSchema();
      totals = schema.totals;
    } finally {
      store.close();
    }
    if (options.overwrite) {
      await removeSqliteFiles(dbPath);
    }
    await fs.rename(tmpDbPath, dbPath);
    return {
      packagePath,
      dbPath,
      ...(header.label ? { label: header.label } : {}),
      createdAt: header.createdAt,
      sqliteBytes: sqlite.byteLength,
      sha256: header.sha256,
      totals
    };
  } finally {
    await removeSqliteFiles(tmpDbPath);
  }
}

function parseGraphPackageHeader(raw: string): GraphPackageHeader {
  const parsed = JSON.parse(raw) as Partial<GraphPackageHeader>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid RepoLens graph package: header must be a JSON object.");
  }
  if (parsed.magic !== MAGIC) {
    throw new Error("Invalid RepoLens graph package: unsupported format");
  }
  if (typeof parsed.createdAt !== "string" || typeof parsed.sourceDbPath !== "string") {
    throw new Error("Invalid RepoLens graph package: missing source metadata.");
  }
  if (parsed.label !== undefined && typeof parsed.label !== "string") {
    throw new Error("Invalid RepoLens graph package: label must be a string.");
  }
  if (typeof parsed.sqliteBytes !== "number") {
    throw new Error("Invalid RepoLens graph package: sqliteBytes must be a number.");
  }
  if (typeof parsed.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(parsed.sha256)) {
    throw new Error("Invalid RepoLens graph package: sha256 must be a hex digest.");
  }
  return parsed as GraphPackageHeader;
}

async function gunzipBounded(payload: Buffer, maxOutputBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      gunzip.destroy();
      reject(error);
    };

    gunzip.on("data", (chunk: Buffer) => {
      total += chunk.byteLength;
      if (total > maxOutputBytes) {
        fail(new Error(`Invalid RepoLens graph package: decompressed sqlite exceeds declared size ${maxOutputBytes}.`));
        return;
      }
      chunks.push(chunk);
    });
    gunzip.on("error", (error) => fail(error));
    gunzip.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, total));
    });
    gunzip.end(payload);
  });
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
