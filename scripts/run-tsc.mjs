#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tscPath = path.join(repoRoot, "node_modules", "typescript", "lib", "tsc.js");
const result = spawnSync(process.execPath, [tscPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_DISABLE_COMPILE_CACHE: "1"
  },
  stdio: "inherit"
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
