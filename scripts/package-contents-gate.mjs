#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const requiredFiles = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "llms.txt",
  "server.json",
  "install.sh",
  "install.ps1",
  "docs/agent-guide.md",
  "docs/research-notes.md",
  "docs/validation-report.md",
  "scripts/codeql-alert-gate.mjs",
  "scripts/github-security-summary.mjs",
  "scripts/package-contents-gate.mjs",
  "dist/src/cli.js",
  "dist/src/mcp/server.js"
];

const allowedExactFiles = new Set([
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "llms.txt",
  "server.json",
  "install.sh",
  "install.ps1",
  "package.json",
  "scripts/codeql-alert-gate.mjs",
  "scripts/github-security-summary.mjs",
  "scripts/package-contents-gate.mjs"
]);

const allowedPrefixes = ["dist/src/", "docs/"];

const forbiddenPatterns = [
  /^\.repolens\//,
  /^node_modules\//,
  /^tests\//,
  /^src\//,
  /^dist\/tests\//,
  /(^|\/)\.env(?:\.|$)/,
  /\.(?:db|db-shm|db-wal|sqlite|sqlite3|rlgz|pem|key|p12)$/i
];

let parsed;
try {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  parsed = JSON.parse(output);
} catch (error) {
  console.error("Failed to inspect npm package contents.");
  if (error instanceof Error) {
    console.error(error.message);
  }
  process.exit(1);
}

const packument = Array.isArray(parsed) ? parsed[0] : undefined;
const files = packument?.files?.map((file) => file.path).sort();
if (!Array.isArray(files) || files.length === 0) {
  console.error("npm pack returned no package file list.");
  process.exit(1);
}

const fileSet = new Set(files);
const missing = requiredFiles.filter((file) => !fileSet.has(file));
const forbidden = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));
const unexpected = files.filter((file) => {
  if (allowedExactFiles.has(file)) {
    return false;
  }
  return !allowedPrefixes.some((prefix) => file.startsWith(prefix));
});

if (missing.length > 0 || forbidden.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) {
    console.error("Required package files are missing:");
    for (const file of missing) {
      console.error(`- ${file}`);
    }
  }
  if (forbidden.length > 0) {
    console.error("Forbidden local or sensitive artifacts would be published:");
    for (const file of forbidden) {
      console.error(`- ${file}`);
    }
  }
  if (unexpected.length > 0) {
    console.error("Unexpected package paths found:");
    for (const file of unexpected) {
      console.error(`- ${file}`);
    }
  }
  process.exit(1);
}

console.log(`Package contents gate passed: ${files.length} files inspected.`);
