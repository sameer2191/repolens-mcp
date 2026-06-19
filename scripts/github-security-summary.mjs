#!/usr/bin/env node

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const format = getArgValue("--format") ?? "text";
const failOnActionable = process.argv.includes("--fail-on-actionable");

if (!repository) {
  fail("GITHUB_REPOSITORY is required, for example sameer2191/repolens-mcp.");
}
if (!token) {
  fail("GITHUB_TOKEN or GH_TOKEN is required.");
}
if (!["text", "json"].includes(format)) {
  fail("--format must be text or json.");
}

const [codeScanning, dependabot, secretScanning] = await Promise.all([
  listAlerts("/code-scanning/alerts", "code scanning"),
  listAlerts("/dependabot/alerts", "Dependabot"),
  listAlerts("/secret-scanning/alerts", "secret scanning")
]);

const codeqlAlerts = codeScanning.items.filter((alert) => alert.tool?.name === "CodeQL");
const scorecardAlerts = codeScanning.items.filter((alert) => alert.tool?.name === "Scorecard");
const otherCodeScanningAlerts = codeScanning.items.filter(
  (alert) => alert.tool?.name !== "CodeQL" && alert.tool?.name !== "Scorecard"
);

const summary = {
  repository,
  generatedAt: new Date().toISOString(),
  actionableOpenAlerts: codeqlAlerts.length + dependabot.items.length + secretScanning.items.length,
  codeqlOpen: codeqlAlerts.length,
  dependabotOpen: dependabot.items.length,
  secretScanningOpen: secretScanning.items.length,
  scorecardOpen: scorecardAlerts.length,
  otherCodeScanningOpen: otherCodeScanningAlerts.length,
  unavailable: [codeScanning, dependabot, secretScanning]
    .filter((result) => result.unavailable)
    .map((result) => result.unavailable),
  scorecardRules: summarizeRules(scorecardAlerts),
  otherCodeScanningRules: summarizeRules(otherCodeScanningAlerts),
  actionableAlerts: {
    codeql: summarizeAlerts(codeqlAlerts),
    dependabot: summarizeAlerts(dependabot.items),
    secretScanning: summarizeAlerts(secretScanning.items)
  }
};

if (format === "json") {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printTextSummary(summary);
}

if (failOnActionable && summary.actionableOpenAlerts > 0) {
  process.exitCode = 1;
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function listAlerts(path, label) {
  const all = [];
  let url = new URL(`${apiUrl}/repos/${repository}${path}`);
  url.searchParams.set("state", "open");
  url.searchParams.set("per_page", "100");
  for (;;) {
    url.searchParams.set("state", "open");
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28"
      }
    });
    if (response.status === 403 || response.status === 404) {
      return {
        items: [],
        unavailable: {
          label,
          status: response.status,
          reason: trimBody(await response.text())
        }
      };
    }
    if (!response.ok) {
      const body = await response.text();
      fail(`Failed to list ${label} alerts: HTTP ${response.status} ${body}`);
    }
    const pageAlerts = await response.json();
    if (!Array.isArray(pageAlerts)) {
      fail(`GitHub returned an unexpected ${label} alerts response.`);
    }
    all.push(...pageAlerts);
    const next = getNextLink(response.headers.get("link"));
    if (!next) {
      return { items: all };
    }
    url = new URL(next);
  }
}

function getNextLink(linkHeader) {
  if (!linkHeader) {
    return undefined;
  }
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function summarizeRules(alerts) {
  const counts = new Map();
  for (const alert of alerts) {
    const tool = alert.tool?.name ?? "unknown-tool";
    const rule = alert.rule?.id ?? alert.secret_type ?? alert.security_advisory?.ghsa_id ?? "unknown-rule";
    const key = `${tool}:${rule}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rule, count]) => ({ rule, count }));
}

function summarizeAlerts(alerts) {
  return alerts.slice(0, 20).map((alert) => ({
    rule: alert.rule?.id ?? alert.secret_type ?? alert.security_advisory?.ghsa_id ?? "unknown-rule",
    severity: alert.rule?.security_severity_level ?? alert.security_advisory?.severity ?? alert.severity ?? null,
    url: alert.html_url ?? alert.url ?? null
  }));
}

function printTextSummary(summary) {
  console.log(`GitHub security summary for ${summary.repository}`);
  console.log(`Generated: ${summary.generatedAt}`);
  console.log("");
  console.log(`Actionable open alerts: ${summary.actionableOpenAlerts}`);
  console.log(`- CodeQL: ${summary.codeqlOpen}`);
  console.log(`- Dependabot: ${summary.dependabotOpen}`);
  console.log(`- Secret scanning: ${summary.secretScanningOpen}`);
  console.log(`Process/code-scanning signals: ${summary.scorecardOpen + summary.otherCodeScanningOpen}`);
  console.log(`- OpenSSF Scorecard: ${summary.scorecardOpen}`);
  console.log(`- Other code scanning: ${summary.otherCodeScanningOpen}`);
  if (summary.scorecardRules.length > 0) {
    console.log("");
    console.log("Scorecard rules:");
    for (const rule of summary.scorecardRules) {
      console.log(`- ${rule.rule}: ${rule.count}`);
    }
  }
  if (summary.otherCodeScanningRules.length > 0) {
    console.log("");
    console.log("Other code-scanning rules:");
    for (const rule of summary.otherCodeScanningRules) {
      console.log(`- ${rule.rule}: ${rule.count}`);
    }
  }
  if (summary.unavailable.length > 0) {
    console.log("");
    console.log("Unavailable alert endpoints:");
    for (const item of summary.unavailable) {
      console.log(`- ${item.label}: HTTP ${item.status}`);
    }
  }
}

function trimBody(body) {
  return body.replace(/\s+/g, " ").trim().slice(0, 240);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
