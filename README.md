# RepoLens MCP

Local-first repository intelligence for AI coding agents. Index a repo into SQLite, expose architecture-aware MCP tools, and inspect code relationships in a browser dashboard.

RepoLens MCP is an original TypeScript implementation built around fast local verification, readable internals, and reviewable engineering evidence. It focuses on the workflows engineers actually need during AI-assisted development: finding code, tracing symbols, checking impact, and preserving architecture decisions.

## Why It Stands Out

- **MCP-native**: exposes 17 tools for indexing, code search, symbol search, source snippets, graph schema, structural graph search, read-only Cypher-like graph queries, dependency-cycle detection, architecture reports, architecture summaries, tracing, git-change impact, dead-code candidates, ADRs, and graph snapshots.
- **Local-first SQLite memory**: all indexed data stays in `.repolens/memory.db`.
- **Incremental refreshes**: skip unchanged files, prune removed files, and preserve the existing graph when a repo has not changed.
- **Portable graph and report artifacts**: export self-contained HTML graph snapshots and architecture reports from the CLI.
- **Operational dashboard**: browse graph previews, structural filters, schema counts, dead-code candidates, review signals, and report links without a frontend build.
- **Architecture recommendations**: turns hotspots, import-resolved dependency cycles, dead-code candidates, and review signals into concrete next steps.
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

The dashboard includes code search, graph search, graph schema tables, hotspot and boundary summaries, dead-code candidates, and one-click Markdown/HTML architecture reports.

## CLI

```bash
repolens-mcp index [repo] [--db path] [--max-file-bytes n] [--incremental]
repolens-mcp architecture [--db path]
repolens-mcp search <query> [--db path]
repolens-mcp symbols <query> [--kind function]
repolens-mcp snippet <symbol-or-path:line> [--context n]
repolens-mcp trace <symbol> [--direction inbound|outbound]
repolens-mcp impact <path-or-symbol...>
repolens-mcp schema [--db path]
repolens-mcp search-graph [query] [--kind function] [--relationship CALLS] [--min-degree n]
repolens-mcp query-graph "MATCH (a)-[:CALLS]->(b) RETURN a.name,b.name LIMIT 5"
repolens-mcp dead-code [--db path]
repolens-mcp cycles [--db path] [--limit n]
repolens-mcp changes [repo] [--db path]
repolens-mcp report [--db path] [--format markdown|html] [--graph-limit n] [--out report.html]
repolens-mcp export-graph --out graph.html [--db path]
repolens-mcp decision --title "Use SQLite" --body "Keep memory local."
repolens-mcp serve [--db path] [--port 9749]
repolens-mcp mcp
```

## MCP Tools

| Tool | Purpose |
| --- | --- |
| `index_repository` | Build or refresh the local SQLite memory. |
| `search_code` | Search indexed source lines. |
| `search_symbols` | Search functions, classes, routes, resources, headings, and package nodes. |
| `get_code_snippet` | Return source lines around a symbol, qualified name, file path, or `path:line` target. |
| `get_architecture` | Return language mix, hotspots, entrypoints, packages, and risk markers. |
| `trace_symbol` | Trace inbound or outbound graph edges around a symbol. |
| `impact_analysis` | Find adjacent symbols for changed files or symbols. |
| `get_graph_schema` | Return node labels, edge types, language coverage, and totals. |
| `search_graph` | Search structurally by query, kind, regex, relationship, file scope, or degree. |
| `query_graph` | Run a read-only Cypher-like query over symbols and one-hop edges. |
| `find_dead_code` | Find non-exported functions and methods with no inbound call edges. |
| `find_dependency_cycles` | Find import-resolved dependency cycles between architecture clusters. |
| `detect_changes` | Map uncommitted git changes to indexed graph impact. |
| `architecture_report` | Generate a markdown or HTML architecture report from the indexed graph. |
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

## Query Graph Subset

`query-graph` and `query_graph` are read-only. Supported patterns:

```cypher
MATCH (f:Function) WHERE f.name = 'main' RETURN f.name,f.filePath LIMIT 10
MATCH (a)-[r:CALLS]->(b) WHERE b.name CONTAINS 'order' RETURN a.name,b.name,r.type LIMIT 10
MATCH (a)<-[:CALLS]-(b) RETURN a.name,b.name LIMIT 10
```

Supported `WHERE` operators are `=`, `<>`, `CONTAINS`, `STARTS WITH`, and `ENDS WITH`, joined with `AND`.

## Validation

```bash
npm run verify
node --experimental-sqlite dist/src/cli.js index /path/to/big/repo --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js index /path/to/big/repo --db /tmp/memory.db --incremental
node --experimental-sqlite dist/src/cli.js architecture --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js schema --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js snippet createOrder --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js cycles --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js query-graph "MATCH (f:Function) RETURN f.name,f.filePath LIMIT 5" --db /tmp/memory.db
node --experimental-sqlite dist/src/cli.js report --db /tmp/memory.db --format html --out report.html
node --experimental-sqlite dist/src/cli.js export-graph --db /tmp/memory.db --out graph.html --limit 1000
node --experimental-sqlite dist/src/cli.js serve --db /tmp/memory.db --port 9749
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
- Import resolver for monorepos and workspace packages.
- Semantic ranking and richer cross-repo queries.
