import fs from "node:fs";
import path from "node:path";
import { indexRepository } from "./indexer.js";
import { defaultDbPath } from "./store.js";
import type { IndexResult, WatchIndexOptions, WatchIndexSummary } from "./types.js";

const DEFAULT_INTERVAL_MS = 2500;

export async function watchRepository(options: WatchIndexOptions): Promise<WatchIndexSummary> {
  const root = path.resolve(options.root);
  const dbPath = path.resolve(options.dbPath ?? defaultDbPath(root));
  const intervalMs = Math.max(250, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  const maxRuns = options.maxRuns ?? Number.POSITIVE_INFINITY;
  const runs: IndexResult[] = [];
  let firstRun = true;

  while (!options.signal?.aborted && runs.length < maxRuns) {
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
    if (runs.length >= maxRuns || options.signal?.aborted) break;
    await delay(intervalMs, options.signal);
  }

  return {
    root,
    dbPath,
    runs,
    stoppedAt: new Date().toISOString()
  };
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
