#!/usr/bin/env node

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

if (!repository) {
  fail("GITHUB_REPOSITORY is required.");
}
if (!token) {
  fail("GITHUB_TOKEN or GH_TOKEN is required.");
}

const alerts = await listOpenCodeScanningAlerts(repository);
const codeqlAlerts = alerts.filter((alert) => alert.tool?.name === "CodeQL");

if (codeqlAlerts.length > 0) {
  console.error(`Found ${codeqlAlerts.length} open CodeQL alert(s). Resolve them before publishing a release:`);
  for (const alert of codeqlAlerts) {
    console.error(`- ${alert.rule?.id ?? "unknown-rule"}: ${alert.html_url}`);
  }
  process.exit(1);
}

console.log("CodeQL alert gate passed: 0 open CodeQL alerts.");

async function listOpenCodeScanningAlerts(repo) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`${apiUrl}/repos/${repo}/code-scanning/alerts`);
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28"
      }
    });
    if (!response.ok) {
      const body = await response.text();
      fail(`Failed to list code-scanning alerts: HTTP ${response.status} ${body}`);
    }
    const pageAlerts = await response.json();
    if (!Array.isArray(pageAlerts)) {
      fail("GitHub returned an unexpected code-scanning alerts response.");
    }
    all.push(...pageAlerts);
    if (pageAlerts.length < 100) {
      return all;
    }
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
