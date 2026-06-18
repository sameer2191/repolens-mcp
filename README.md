# RepoLens MCP

Local-first repository intelligence for AI coding agents. Index a repo into SQLite, expose architecture-aware MCP tools, and inspect code relationships in a browser dashboard.

RepoLens MCP is an original TypeScript implementation built around fast local verification, readable internals, and reviewable engineering evidence. It focuses on the workflows engineers actually need during AI-assisted development: finding code, tracing symbols, checking impact, and preserving architecture decisions.

## Why It Stands Out

- **MCP-native**: exposes 13 tools for indexing, code search, symbol search, graph schema, structural graph search, architecture summaries, tracing, git-change impact, dead-code candidates, ADRs, and graph snapshots.
- **Local-first SQLite memory**: all indexed data stays in `.repolens/memory.db`.
- **Incremental refreshes**: skip unchanged files, prune removed files, and preserve the existing graph when a repo has not changed.
- **Portable graph artifacts**: export a self-contained HTML graph or JSON snapshot from the CLI.
- **Wide practical coverage**: TypeScript, JavaScript, Swift, Python, Go, Java, Rust, SQL, YAML, Markdown, JSON, and shell-oriented project files.
- **Validation evidence**: tests, CI, CodeQL, docs, local dashboard, and a big-repo validation workflow.
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
repolens-mcp index [repo] [--db path] [--max-file-bytes n] [--incremental]
repolens-mcp architecture [--db path]
repolens-mcp search <query> [--db path]
repolens-mcp symbols <query> [--kind function]
repolens-mcp trace <symbol> [--direction inbound|outbound]
repolens-mcp impact <path-or-symbol...>
repolens-mcp schema [--db path]
repolens-mcp search-graph [query] [--kind function] [--relationship CALLS]
repolens-mcp dead-code [--db path]
repolens-mcp changes [repo] [--db path]
repolens-mcp export-graph --out graph.html [--db path]
repolens-mcp decision --title "Use SQLite" --body "Keep memory local."
repolens-mcp serve [--port 9749]
repolens-mcp mcp
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
| `get_graph_schema` | Return node labels, edge types, language coverage, and totals. |
| `search_graph` | Search structurally by query, kind, regex, relationship, file scope, or degree. |
| `find_dead_code` | Find non-exported functions and methods with no inbound call edges. |
| `detect_changes` | Map uncommitted git changes to indexed graph impact. |
| `remember_decision` | Persist an ADR-style architecture decision. |
| `list_decisions` | Retrieve saved decisions. |
| `graph_snapshot` | Export compact graph data for dashboards or reviews. |

## Supported Extraction

The extractor is intentionally compact and extensible:

- TypeScript and JavaScript: classes, interfaces, types, functions, const functions, imports, Express-style routes.
- Swift: classes, structs, enums, protocols, actors, functions, and imports.
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
node --experimental-sqlite dist/src/cli.js index /path/to/big/repo --db /tmp/memory.db --incremental
node --experimental-sqlite dist/src/cli.js architecture --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js schema --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js export-graph --db /tmp/memory.db --out graph.html --limit 1000
```

The repo includes `docs/research-notes.md` with source-research notes and the design decisions behind this implementation.
It also includes `docs/validation-report.md` with the local self-index and `/Users/sameer/Desktop/testing` big-repo validation results.

## MCP Client Config

```json
{
  "mcpServers": {
    "repolens-mcp": {
      "command": "npx",
      "args": ["-y", "repolens-mcp", "mcp"],
      "env": {
        "REPOLENS_DB": ".repolens/memory.db"
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
- Import resolver for monorepos and workspace packages.
- Semantic ranking and richer cross-repo queries.
