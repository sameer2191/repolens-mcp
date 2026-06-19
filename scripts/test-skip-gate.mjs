#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const allowedSkips = [
  {
    file: "tests/dashboard.test.ts",
    reason: "local sandbox does not permit binding a dashboard smoke-test port",
    guard: "isListenPermissionError(error)",
    expectedCount: 1
  },
  {
    file: "tests/indexer.test.ts",
    reason: "git is not available",
    guard: "git.status !== 0",
    expectedCount: 3
  }
];

const sourceRoots = ["tests", "src", "scripts"];
const allowedByKey = new Map(allowedSkips.map((skip) => [skipKey(skip.file, skip.reason), skip]));
const seen = new Map();
const findings = [];

for (const file of sourceRoots.flatMap((dir) => listFiles(path.join(root, dir)))) {
  const relative = path.relative(root, file);
  const body = fs.readFileSync(file, "utf8");
  for (const occurrence of findSkipCalls(body)) {
    const allowed = allowedByKey.get(skipKey(relative, occurrence.reason));
    if (!allowed) {
      findings.push(`${relative}:${occurrence.line}: unexpected skip reason: ${occurrence.reason}`);
      continue;
    }
    const nearby = body.slice(Math.max(0, occurrence.index - 220), occurrence.index);
    if (!nearby.includes(allowed.guard)) {
      findings.push(`${relative}:${occurrence.line}: allowed skip is missing guard: ${allowed.guard}`);
      continue;
    }
    seen.set(skipKey(relative, occurrence.reason), (seen.get(skipKey(relative, occurrence.reason)) ?? 0) + 1);
  }
}

for (const allowed of allowedSkips) {
  const count = seen.get(skipKey(allowed.file, allowed.reason)) ?? 0;
  if (count !== allowed.expectedCount) {
    findings.push(`${allowed.file}: expected ${allowed.expectedCount} allowed skip(s) for "${allowed.reason}", found ${count}`);
  }
}

if (findings.length > 0) {
  console.error("Test skip gate failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Test skip gate passed: ${allowedSkips.length} skip policies, ${sumSeen()} allowed skip calls.`);

function findSkipCalls(body) {
  const calls = [];
  const pattern = /\b(?:[A-Za-z_$][\w$]*\.)?skip\s*\(\s*(["'`])([^"'`]+)\1/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    calls.push({
      index: match.index,
      line: lineForIndex(body, match.index),
      reason: match[2]
    });
  }
  return calls;
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineForIndex(body, index) {
  return body.slice(0, index).split("\n").length;
}

function skipKey(file, reason) {
  return `${file}\0${reason}`;
}

function sumSeen() {
  let total = 0;
  for (const count of seen.values()) {
    total += count;
  }
  return total;
}
