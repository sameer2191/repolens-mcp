# Codebase Memory MCP

Local-first repository memory for AI coding agents. Index a codebase into SQLite, expose it through MCP tools, and inspect the architecture in a browser dashboard.

This project is inspired by `DeusData/codebase-memory-mcp`, but it is a clean TypeScript implementation focused on being easy to audit, extend, test, and demo.

## Why It Stands Out

- **MCP-native**: exposes tools for indexing, code search, symbol search, architecture summaries, tracing, impact analysis, ADR memory, and graph snapshots.
- **Local-first SQLite memory**: all indexed data stays in `.codebase-memory/memory.db`.
- **Recruiter-friendly proof**: tests, CI, CodeQL, docs, local dashboard, and a big-repo validation workflow.
- **Architecture decisions built in**: persist ADR-style decisions next to the code graph.
- **No frontend build required**: the dashboard is served by the CLI.

## Quick Start

```bash
npm install
npm run build
node --experimental-sqlite dist/src/cli.js index .
node --experimental-sqlite dist/src/cli.js architecture
node --experimental-sqlite dist/src/cli.js serve
```

Then open `http://127.0.0.1:9749`.

## CLI

```bash
codebase-memory-mcp index [repo] [--db path] [--max-file-bytes n]
codebase-memory-mcp architecture [--db path]
codebase-memory-mcp search <query> [--db path]
codebase-memory-mcp symbols <query> [--kind function]
codebase-memory-mcp trace <symbol> [--direction inbound|outbound]
codebase-memory-mcp impact <path-or-symbol...>
codebase-memory-mcp decision --title "Use SQLite" --body "Keep memory local."
codebase-memory-mcp serve [--port 9749]
codebase-memory-mcp mcp
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `index_repository` | Build or refresh the local SQLite memory. |
| `search_code` | Search indexed source lines. |
| `search_symbols` | Search functions, classes, routes, resources, headings, and package nodes. |
| `get_architecture` | Return language mix, hotspots, entrypoints, packages, and risk markers. |
| `trace_symbol` | Trace inbound or outbound graph edges around a symbol. |
| `impact_analysis` | Find adjacent symbols for changed files or symbols. |
| `remember_decision` | Persist an ADR-style architecture decision. |
| `list_decisions` | Retrieve saved decisions. |
| `graph_snapshot` | Export compact graph data for dashboards or reviews. |

## Supported Extraction

The extractor is intentionally compact and extensible:

- TypeScript and JavaScript: classes, interfaces, types, functions, const functions, imports, Express-style routes.
- Python: classes, functions, imports, route decorators.
- Go, Java, Rust: common functions, types, classes, traits, structs, imports.
- SQL: created tables, views, indexes, functions, procedures.
- YAML: Kubernetes-like resources from `kind` and `metadata.name`.
- Markdown: headings as knowledge nodes.
- JSON: `package.json` package and dependency nodes.

## Validation

```bash
npm run verify
node --experimental-sqlite dist/src/cli.js index /path/to/big/repo --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js architecture --db /tmp/memory.db
```

The repo includes `docs/upstream-review.md` with the upstream inventory and the design decisions for this rebuild.
It also includes `docs/validation-report.md` with the local self-index and `/Users/sameer/Desktop/testing` big-repo validation results.

## MCP Client Config

```json
{
  "mcpServers": {
    "codebase-memory-mcp": {
      "command": "npx",
      "args": ["-y", "codebase-memory-mcp", "mcp"],
      "env": {
        "CODEBASE_MEMORY_DB": ".codebase-memory/memory.db"
      }
    }
  }
}
```

## Architecture

```mermaid
flowchart LR
  Repo["Repository files"] --> Walker["Ignore-aware walker"]
  Walker --> Extractor["Language extractors"]
  Extractor --> Store["SQLite memory"]
  Store --> MCP["MCP tools"]
  Store --> CLI["CLI"]
  Store --> Dashboard["Local dashboard"]
  MCP --> Agent["AI coding agent"]
```

## Roadmap

- Tree-sitter adapters for deeper language parsing.
- Incremental indexing keyed by file hash.
- Git diff ingestion for richer impact analysis.
- Import resolver for monorepos and workspace packages.
- Exportable HTML architecture reports.
