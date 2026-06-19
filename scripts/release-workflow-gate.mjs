#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const workflowsDir = path.join(".github", "workflows");
const releaseWorkflow = path.join(workflowsDir, "release.yml");
const pinnedActionRef = /^[^@\s]+@[0-9a-f]{40}$/i;
const failures = [];

for (const entry of fs.readdirSync(workflowsDir)) {
  if (!entry.endsWith(".yml") && !entry.endsWith(".yaml")) {
    continue;
  }
  const workflowPath = path.join(workflowsDir, entry);
  const body = fs.readFileSync(workflowPath, "utf8");
  for (const match of body.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/gm)) {
    const action = match[1].replace(/^["']|["']$/g, "");
    if (action.startsWith("./") || action.startsWith("docker://")) {
      continue;
    }
    if (!pinnedActionRef.test(action)) {
      failures.push(`${workflowPath}: unpinned action reference ${action}`);
    }
  }
}

const release = fs.readFileSync(releaseWorkflow, "utf8");
const requiredSnippets = [
  ["pinned cosign installer", "sigstore/cosign-installer@ba7bc0a3fef59531c69a25acd34668d6d3fe6f22"],
  ["OIDC permission for keyless signing", "id-token: write"],
  ["attestation permission", "attestations: write"],
  ["keyless blob signing", "cosign sign-blob --yes --bundle"],
  ["Sigstore bundle subject attestation", "*.sigstore.json"],
  ["Sigstore bundles uploaded to releases", "checksums.txt.sigstore.json"],
  ["npm token fail-closed release behavior", "NPM_TOKEN is required for tag releases"]
];

for (const [label, snippet] of requiredSnippets) {
  if (!release.includes(snippet)) {
    failures.push(`${releaseWorkflow}: missing ${label}`);
  }
}

if (failures.length > 0) {
  console.error("Release workflow gate failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Release workflow gate passed: pinned actions and Sigstore release bundles are enforced.");
