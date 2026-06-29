#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

if (!isWindows) {
  requireCommand("bash", "install.sh audit requires bash on Unix-like hosts.");
  run("bash", ["-n", "install.sh"], { cwd: root });
  auditUnixInstaller();
} else {
  console.log("Skipping install.sh audit on Windows.");
}

if (commandExists("pwsh")) {
  auditPowerShellInstaller();
} else if (process.env.CI) {
  throw new Error("pwsh is required in CI so install.ps1 is syntax-checked and dry-run audited.");
} else {
  console.log("Skipping install.ps1 dry-run audit because pwsh is not installed.");
}

console.log("Installer audit passed.");

function auditUnixInstaller() {
  const scope = createAuditScope("repolens-install-sh-");
  const homeBefore = listFiles(scope.home);
  const targetBefore = listFiles(scope.target);
  run(
    "bash",
    [
      "install.sh",
      "--skip-npm",
      "--install-codex",
      "--install-agents",
      "--dry-run",
      "--with-hooks",
      "--target",
      scope.target,
      "--agents",
      "codex,claude,gemini",
      "--db",
      ".repolens/audit.db"
    ],
    { cwd: root, env: scope.env }
  );
  assertNoNewFiles(scope.home, homeBefore, "install.sh dry-run HOME");
  assertNoNewFiles(scope.target, targetBefore, "install.sh dry-run target");
}

function auditPowerShellInstaller() {
  const parseCommand =
    "$parseErrors = $null; " +
    "[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'install.ps1'), [ref]$null, [ref]$parseErrors) | Out-Null; " +
    "if ($parseErrors.Count) { $parseErrors | Format-List | Out-String | Write-Error; exit 1 }";
  run("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", parseCommand], { cwd: root });

  const scope = createAuditScope("repolens-install-ps1-");
  run("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString() | Out-Null"], {
    cwd: root,
    env: scope.env
  });
  const homeBefore = listFiles(scope.home);
  const targetBefore = listFiles(scope.target);
  run(
    "pwsh",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(root, "install.ps1"),
      "-SkipNpm",
      "-InstallCodex",
      "-InstallAgents",
      "-DryRun",
      "-WithHooks",
      "-Target",
      scope.target,
      "-Agents",
      "codex,claude,gemini",
      "-Db",
      ".repolens/audit.db"
    ],
    { cwd: root, env: scope.env }
  );
  assertNoNewFiles(scope.home, homeBefore, "install.ps1 dry-run HOME");
  assertNoNewFiles(scope.target, targetBefore, "install.ps1 dry-run target");
}

function createAuditScope(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const home = path.join(dir, "home");
  const target = path.join(dir, "target");
  const npmCache = path.join(dir, "npm-cache");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  return {
    home,
    target,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      REPOLENS_CONFIG: path.join(home, ".config", "repolens-mcp", "config.json"),
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      NO_UPDATE_NOTIFIER: "1",
      POWERSHELL_TELEMETRY_OPTOUT: "1"
    }
  };
}

function assertNoNewFiles(dir, before, label) {
  const previous = new Set(before);
  const entries = listFiles(dir);
  const added = entries.filter((entry) => !previous.has(entry));
  if (added.length > 0) {
    throw new Error(`${label} wrote unexpected files:\n${added.map((entry) => `- ${entry}`).join("\n")}`);
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const entries = [];
  walk(dir, entries, dir);
  return entries.sort();
}

function walk(current, entries, rootDir) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, entries, rootDir);
    } else {
      entries.push(path.relative(rootDir, fullPath));
    }
  }
}

function requireCommand(command, message) {
  if (!commandExists(command)) {
    throw new Error(message);
  }
}

function commandExists(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: "ignore" });
  return result.status === 0;
}

function run(command, args, options) {
  execFileSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit"
  });
}
