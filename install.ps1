param(
  [switch]$InstallCodex,
  [switch]$InstallAgents,
  [switch]$UninstallCodex,
  [switch]$UninstallAgents,
  [switch]$DryRun,
  [switch]$Force,
  [switch]$SkipNpm,
  [string]$Db = $(if ($env:REPOLENS_DB) { $env:REPOLENS_DB } else { ".repolens/memory.db" }),
  [string]$Agents = "all",
  [string]$Target = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

function Show-Usage {
  @"
RepoLens MCP local installer

Usage:
  .\install.ps1 [-InstallCodex] [-InstallAgents] [-UninstallCodex] [-UninstallAgents] [-DryRun] [-Force] [-Db path] [-Agents list] [-Target dir] [-SkipNpm]

Options:
  -InstallCodex     Add or update the managed Codex MCP config block after build.
  -InstallAgents    Generate project-local RepoLens guidance for supported coding agents.
  -UninstallCodex   Remove only the managed RepoLens Codex MCP config block.
  -UninstallAgents  Remove managed RepoLens blocks from generated agent guidance.
  -DryRun           Show setup changes without writing them where supported.
  -Force            Replace an existing unmanaged Codex server entry.
  -Db path          MCP database path to place in generated setup.
  -Agents list      Comma-separated agents for -InstallAgents, or "all".
  -Target dir       Project directory for -InstallAgents output. Defaults to this repo.
  -SkipNpm          Skip npm ci and only run the build/doctor steps.
"@
}

function Invoke-Step {
  param(
    [string]$Command,
    [string[]]$Arguments
  )
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $Command $($Arguments -join ' ')"
  }
}

if ($args -contains "-Help" -or $args -contains "--help" -or $args -contains "/?") {
  Show-Usage
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is required. Install Node 24 or newer, then rerun .\install.ps1."
}

$nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
if ($nodeMajor -lt 24) {
  $nodeVersion = & node -v
  throw "Node 24 or newer is required. Current version: $nodeVersion"
}

if (-not $SkipNpm) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required when -SkipNpm is not set."
  }
  Push-Location $PSScriptRoot
  try {
    Invoke-Step "npm" @("ci")
  } finally {
    Pop-Location
  }
}

Push-Location $PSScriptRoot
try {
  Invoke-Step "npm" @("run", "build")
} finally {
  Pop-Location
}

$cliPath = Join-Path $PSScriptRoot "dist/src/cli.js"
Invoke-Step "node" @("--experimental-sqlite", $cliPath, "doctor")

if ($InstallCodex) {
  $codexArgs = @("--experimental-sqlite", $cliPath, "install-codex", "--db", $Db)
  if ($DryRun) { $codexArgs += "--dry-run" }
  if ($Force) { $codexArgs += "--force" }
  Invoke-Step "node" $codexArgs
}

if ($InstallAgents) {
  $agentArgs = @("--experimental-sqlite", $cliPath, "install-agents", "--target", $Target, "--agents", $Agents, "--db", $Db)
  if ($DryRun) { $agentArgs += "--dry-run" }
  Invoke-Step "node" $agentArgs
}

if ($UninstallCodex) {
  $codexArgs = @("--experimental-sqlite", $cliPath, "uninstall-codex")
  if ($DryRun) { $codexArgs += "--dry-run" }
  Invoke-Step "node" $codexArgs
}

if ($UninstallAgents) {
  $agentArgs = @("--experimental-sqlite", $cliPath, "uninstall-agents", "--target", $Target, "--agents", $Agents)
  if ($DryRun) { $agentArgs += "--dry-run" }
  Invoke-Step "node" $agentArgs
}

if (-not $InstallCodex -and -not $InstallAgents -and -not $UninstallCodex -and -not $UninstallAgents) {
  @"

RepoLens MCP built successfully.

Next steps:
  .\install.ps1 -InstallCodex -DryRun
  .\install.ps1 -InstallCodex
  .\install.ps1 -InstallAgents -DryRun
  .\install.ps1 -UninstallAgents -DryRun
  node --experimental-sqlite "$cliPath" index .
  node --experimental-sqlite "$cliPath" serve
"@
} else {
  "RepoLens MCP setup finished."
}
