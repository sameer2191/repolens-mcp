import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { indexRepository } from "./indexer.js";
import { defaultDbPath } from "./store.js";
import type { GitWatchFingerprint, IndexResult, WatchIndexOptions, WatchIndexSummary } from "./types.js";

const DEFAULT_INTERVAL_MS = 2500;
const GIT_COMMAND_TIMEOUT_MS = 2000;
const execFileAsync = promisify(execFile);

export async function watchRepository(options: WatchIndexOptions): Promise<WatchIndexSummary> {
  const root = path.resolve(options.root);
  const dbPath = path.resolve(options.dbPath ?? defaultDbPath(root));
  const intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxRuns = options.maxRuns ?? Number.POSITIVE_INFINITY;
  const maxPolls = options.maxPolls ?? Number.POSITIVE_INFINITY;
  const runs: IndexResult[] = [];
  const skippedPolls: WatchIndexSummary["skippedPolls"] = [];
  let firstRun = !options.skipInitialRun;
  let polls = 0;
  let lastFingerprint = options.gitAware && options.skipInitialRun ? await gitFingerprint(root) : undefined;

  while (!options.signal?.aborted && runs.length < maxRuns && polls < maxPolls) {
    polls += 1;
    const fingerprint = options.gitAware ? await gitFingerprint(root) : undefined;
    if (options.gitAware && !firstRun && fingerprint && lastFingerprint?.key === fingerprint.key) {
      const event = {
        root,
        checkedAt: new Date().toISOString(),
        reason: "git-unchanged" as const,
        fingerprint
      };
      skippedPolls.push(event);
      options.onSkip?.(event);
      if (runs.length >= maxRuns || options.signal?.aborted || polls >= maxPolls) break;
      await delay(intervalMs, options.signal);
      continue;
    }

    const shouldIncremental = firstRun ? fs.existsSync(dbPath) || options.incremental === true : true;
    const result = await indexRepository({
      root,
      dbPath,
      incremental: shouldIncremental,
      maxFileBytes: options.maxFileBytes,
      includeHidden: options.includeHidden,
      runLabel: options.runLabel
    });
    runs.push(result);
    options.onResult?.(result);
    firstRun = false;
    if (options.gitAware) {
      lastFingerprint = (await gitFingerprint(root)) ?? fingerprint;
    }
    if (runs.length >= maxRuns || options.signal?.aborted) break;
    await delay(intervalMs, options.signal);
  }

  return {
    root,
    dbPath,
    runs,
    polls,
    skippedPolls,
    stoppedAt: new Date().toISOString()
  };
}

async function gitFingerprint(root: string): Promise<GitWatchFingerprint | undefined> {
  const gitRootOutput = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined);
  const gitRoot = gitRootOutput?.trim();
  if (!gitRoot) {
    return undefined;
  }

  const [head, status, tracked] = await Promise.all([
    git(root, ["rev-parse", "--verify", "HEAD"]).then((value) => value.trim()).catch(() => "(unborn)"),
    git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    git(root, ["ls-files", "-z"])
  ]);
  const statusHash = crypto.createHash("sha256").update(status).digest("hex");
  const trackedFiles = tracked.split("\0").filter(Boolean).length;
  const key = crypto.createHash("sha256").update([gitRoot, head, statusHash, String(trackedFiles)].join("\0")).digest("hex");
  return { gitRoot, head, statusHash, trackedFiles, key };
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: GIT_COMMAND_TIMEOUT_MS
  });
  return stdout;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}
