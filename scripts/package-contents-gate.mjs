#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";

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
  "docs/BENCHMARK.md",
  "docs/research-notes.md",
  "scripts/codeql-alert-gate.mjs",
  "scripts/clean-dist.mjs",
  "scripts/github-security-summary.mjs",
  "scripts/installer-audit.mjs",
  "scripts/package-contents-gate.mjs",
  "scripts/test-skip-gate.mjs",
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
  "docs/agent-guide.md",
  "docs/BENCHMARK.md",
  "docs/research-notes.md",
  "scripts/codeql-alert-gate.mjs",
  "scripts/clean-dist.mjs",
  "scripts/github-security-summary.mjs",
  "scripts/installer-audit.mjs",
  "scripts/package-contents-gate.mjs",
  "scripts/test-skip-gate.mjs"
]);

const allowedPrefixes = ["dist/src/"];

const forbiddenPatterns = [
  /^\.repolens\//,
  /^node_modules\//,
  /^tests\//,
  /^src\//,
  /^dist\/tests\//,
  /(^|\/)\.env(?:\.|$)/,
  /\.(?:db|db-shm|db-wal|sqlite|sqlite3|rlgz|pem|key|p12)$/i
];

const forbiddenTextPatterns = [
  { pattern: /\/Users\/[A-Za-z0-9._-]+[^\s`"'<>)]*/g, label: "macOS user-home path" },
  { pattern: /\/private\/(?:tmp|var)\/[^\s`"'<>)]*/g, label: "macOS private temp path" },
  { pattern: /\/var\/folders\/[^\s`"'<>)]*/g, label: "macOS var folders path" },
  { pattern: /Desktop\/[^\s`"'<>)]*/g, label: "local Desktop path" }
];

const textFilePattern = /\.(?:cjs|d\.ts|html|js|json|map|md|mjs|ps1|sh|toml|txt|yaml|yml)$/i;

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
const staleDistFiles = files.filter((file) => {
  const source = sourceForDistFile(file);
  return source !== undefined && !fs.existsSync(source);
});
const unexpected = files.filter((file) => {
  if (allowedExactFiles.has(file)) {
    return false;
  }
  return !allowedPrefixes.some((prefix) => file.startsWith(prefix));
});
const leakedLocalPaths = scanTextFiles(files);

if (missing.length > 0 || forbidden.length > 0 || staleDistFiles.length > 0 || unexpected.length > 0 || leakedLocalPaths.length > 0) {
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
  if (staleDistFiles.length > 0) {
    console.error("Compiled package files have no matching source file:");
    for (const file of staleDistFiles) {
      console.error(`- ${file}`);
    }
  }
  if (unexpected.length > 0) {
    console.error("Unexpected package paths found:");
    for (const file of unexpected) {
      console.error(`- ${file}`);
    }
  }
  if (leakedLocalPaths.length > 0) {
    console.error("Packed text files contain local workstation paths:");
    for (const finding of leakedLocalPaths) {
      console.error(`- ${finding.file}: ${finding.label}: ${finding.match}`);
    }
  }
  process.exit(1);
}

console.log(`Package contents gate passed: ${files.length} files inspected.`);

function scanTextFiles(files) {
  const findings = [];
  for (const file of files) {
    if (!textFilePattern.test(file) || !fs.existsSync(file)) {
      continue;
    }
    const body = fs.readFileSync(file, "utf8");
    for (const { pattern, label } of forbiddenTextPatterns) {
      pattern.lastIndex = 0;
      const matches = [...body.matchAll(pattern)];
      for (const match of matches.slice(0, 5)) {
        findings.push({ file, label, match: match[0] });
      }
    }
  }
  return findings;
}

function sourceForDistFile(file) {
  if (!file.startsWith("dist/src/")) {
    return undefined;
  }
  const sourcePath = file.slice("dist/".length);
  if (sourcePath.endsWith(".js")) {
    return sourcePath.replace(/\.js$/, ".ts");
  }
  if (sourcePath.endsWith(".js.map")) {
    return sourcePath.replace(/\.js\.map$/, ".ts");
  }
  if (sourcePath.endsWith(".d.ts")) {
    return sourcePath.replace(/\.d\.ts$/, ".ts");
  }
  return undefined;
}
