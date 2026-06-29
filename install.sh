#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PATH="${REPOLENS_DB:-.repolens/memory.db}"
INSTALL_CODEX=0
INSTALL_AGENTS=0
UNINSTALL_CODEX=0
UNINSTALL_AGENTS=0
AGENTS="all"
TARGET_DIR="$ROOT_DIR"
WITH_HOOKS=0
DRY_RUN=0
FORCE=0
SKIP_NPM=0

usage() {
  cat <<'USAGE'
RepoLens MCP local installer

Usage:
  ./install.sh [--install-codex] [--install-agents] [--uninstall-codex] [--uninstall-agents] [--with-hooks] [--dry-run] [--force] [--db path] [--agents list] [--target dir] [--skip-npm]

Options:
  --install-codex  Add or update the managed Codex MCP config block after build.
  --install-agents Generate project-local RepoLens guidance for supported coding agents.
  --uninstall-codex
                   Remove only the managed RepoLens Codex MCP config block.
  --uninstall-agents
                   Remove managed RepoLens blocks from generated agent guidance.
  --dry-run        Show setup changes without writing them where supported.
  --force          Replace an existing unmanaged Codex server entry.
  --db path        MCP database path to place in generated setup.
  --agents list    Comma-separated agents for --install-agents, or "all".
  --target dir     Project directory for --install-agents output. Defaults to this repo.
  --with-hooks     Include opt-in hook/reminder files for agent install/uninstall.
  --skip-npm       Skip npm ci and only run the build/doctor steps.
  -h, --help       Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-codex)
      INSTALL_CODEX=1
      shift
      ;;
    --install-agents)
      INSTALL_AGENTS=1
      shift
      ;;
    --uninstall-codex)
      UNINSTALL_CODEX=1
      shift
      ;;
    --uninstall-agents)
      UNINSTALL_AGENTS=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --db)
      DB_PATH="${2:-}"
      if [[ -z "$DB_PATH" ]]; then
        echo "Missing value for --db" >&2
        exit 2
      fi
      shift 2
      ;;
    --agents)
      AGENTS="${2:-}"
      if [[ -z "$AGENTS" ]]; then
        echo "Missing value for --agents" >&2
        exit 2
      fi
      shift 2
      ;;
    --target)
      TARGET_DIR="${2:-}"
      if [[ -z "$TARGET_DIR" ]]; then
        echo "Missing value for --target" >&2
        exit 2
      fi
      shift 2
      ;;
    --with-hooks)
      WITH_HOOKS=1
      shift
      ;;
    --skip-npm)
      SKIP_NPM=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 24 or newer, then rerun ./install.sh." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [[ "$NODE_MAJOR" -lt 24 ]]; then
  echo "Node 24 or newer is required. Current version: $(node -v)" >&2
  exit 1
fi

if [[ "$SKIP_NPM" -eq 0 ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required when --skip-npm is not set." >&2
    exit 1
  fi
  (cd "$ROOT_DIR" && npm ci)
fi

(cd "$ROOT_DIR" && npm run build)

CLI_PATH="$ROOT_DIR/dist/src/cli.js"
node --experimental-sqlite "$CLI_PATH" doctor

if [[ "$INSTALL_CODEX" -eq 1 ]]; then
  args=(--db "$DB_PATH")
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  if [[ "$FORCE" -eq 1 ]]; then
    args+=(--force)
  fi
  node --experimental-sqlite "$CLI_PATH" install-codex "${args[@]}"
fi

if [[ "$INSTALL_AGENTS" -eq 1 ]]; then
  args=(--target "$TARGET_DIR" --agents "$AGENTS" --db "$DB_PATH")
  if [[ "$WITH_HOOKS" -eq 1 ]]; then
    args+=(--with-hooks)
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  node --experimental-sqlite "$CLI_PATH" install-agents "${args[@]}"
fi

if [[ "$UNINSTALL_CODEX" -eq 1 ]]; then
  args=()
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  node --experimental-sqlite "$CLI_PATH" uninstall-codex "${args[@]}"
fi

if [[ "$UNINSTALL_AGENTS" -eq 1 ]]; then
  args=(--target "$TARGET_DIR" --agents "$AGENTS")
  if [[ "$WITH_HOOKS" -eq 1 ]]; then
    args+=(--with-hooks)
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  node --experimental-sqlite "$CLI_PATH" uninstall-agents "${args[@]}"
fi

if [[ "$INSTALL_CODEX" -eq 0 && "$INSTALL_AGENTS" -eq 0 && "$UNINSTALL_CODEX" -eq 0 && "$UNINSTALL_AGENTS" -eq 0 ]]; then
  cat <<EOF

RepoLens MCP built successfully.

Next steps:
  ./install.sh --install-codex --dry-run
  ./install.sh --install-codex
  ./install.sh --install-agents --dry-run
  ./install.sh --install-agents --with-hooks --dry-run
  ./install.sh --uninstall-agents --dry-run
  node --experimental-sqlite "$CLI_PATH" index .
  node --experimental-sqlite "$CLI_PATH" serve
EOF
else
  echo "RepoLens MCP setup finished."
fi
