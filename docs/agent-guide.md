# Agent Guide

RepoLens MCP gives coding agents a local graph of the repository they are changing. Use it to gather architecture context, find references, trace impact, and produce reviewable evidence before editing code.

## Fast Start

```bash
npm ci
npm run build
node --experimental-sqlite dist/src/cli.js index . --db .repolens/memory.db
node --experimental-sqlite dist/src/cli.js architecture --db .repolens/memory.db
```

For MCP clients:

```bash
node --experimental-sqlite dist/src/cli.js mcp
```

For Codex setup checks:

```bash
node --experimental-sqlite dist/src/cli.js doctor
node --experimental-sqlite dist/src/cli.js install-codex --dry-run
```

## Before Editing

1. Run `index` or `benchmark` for the target repository.
2. Use `architecture`, `schema`, `communities`, or `fleet-summary` to understand the project shape.
3. Use `search`, `symbols`, `references`, `trace`, `cycles`, and `context-pack` for focused code context.
4. Use `changes` after edits to map uncommitted files back to graph impact.

## Useful MCP Tools

- `index_repository`: build or refresh the local SQLite graph.
- `benchmark_repository`: run full and no-op incremental indexing with graph totals and throughput.
- `search_code`: find source lines with code-aware BM25 ranking.
- `find_references`: find indexed definition and reference lines.
- `trace_symbol` / `trace_path`: walk call, data-flow, or cross-service relationships.
- `context_pack`: combine semantic, vector, graph, search, snippets, and nearby edges.
- `get_architecture`: summarize languages, hotspots, packages, entrypoints, risks, and recommendations.
- `scan_secrets`: return redacted high-signal secret findings from indexed lines.
- `architecture_report`: generate Markdown or HTML reports.
- `export_graph_package` / `import_graph_package`: share or bootstrap local graph snapshots.

## Big-Repo Validation Pattern

Use a dedicated database and artifact folder for large repositories:

```bash
mkdir -p .repolens
node --experimental-sqlite dist/src/cli.js benchmark /path/to/repo --db .repolens/benchmark.db --label validation
node --experimental-sqlite dist/src/cli.js report --db .repolens/benchmark.db --format html --out .repolens/report.html
node --experimental-sqlite dist/src/cli.js export-graph --db .repolens/benchmark.db --out .repolens/graph.html --limit 1500
node --experimental-sqlite dist/src/cli.js pack-graph --db .repolens/benchmark.db --out .repolens/graph.rlgz --label validation
```

Record the indexed file count, skipped file count, symbol count, edge count, benchmark times, secret-scan result, and artifact paths in the validation notes.

## Security Boundaries

RepoLens is local-first, but generated outputs are still derived code metadata.

- Do not commit `.repolens/`, SQLite database files, WAL/shm sidecars, graph packages, or local memory folders.
- Do not paste raw private source snippets into public issues or pull requests.
- Run `scan-secrets` before sharing reports or graph exports from private repositories.
- Run `npm run package:check` before publishing package changes.

## PR Evidence

For behavior changes, include:

- Focused test commands.
- `npm run verify` result.
- Documentation updates for CLI, MCP, graph schema, dashboard, or security behavior.
- Package boundary validation when package contents changed.
- Report or graph artifact paths when output behavior changed.
