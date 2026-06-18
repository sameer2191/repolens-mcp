# Research Notes

Reference project reviewed: `DeusData/codebase-memory-mcp` at `e599df1d563c1e9b0b2fc8c6b12ee85934ade1c5`.

## Inventory

- 1,702 files in the cloned repository.
- 35,572,936 total lines counted across non-git files.
- Largest line-count buckets are vendored/generated assets, especially SQLite, Nomic vectors, tree-sitter grammars, and parser outputs.
- Hand-authored product logic is concentrated in `src/`, `internal/cbm/`, `scripts/`, `pkg/`, `tests/`, and `graph-ui/`.

## What The Reference Optimizes For

- Single static C binary with vendored parsers.
- Broad language coverage through tree-sitter grammar generation.
- MCP JSON-RPC over stdio plus CLI mode.
- SQLite graph store with nodes, edges, file hashes, project summaries, and query helpers.
- Multi-pass indexing pipeline: discover, structure, load sources, extract definitions, resolve imports/calls/usages, semantic edges, tests, HTTP links, git history, and artifact export.
- Optional graph UI served locally.
- Serious release hygiene: install scripts, package-manager wrappers, CI, security scans, CodeQL, Scorecard, and release workflows.

## RepoLens Design Choices

RepoLens MCP is not a fork or a drop-in static C replacement. It is an original TypeScript implementation that keeps the broader local repository-intelligence idea while optimizing for readability, maintainability, MCP integration, and fast local verification:

- Node 24 plus native SQLite for a dependency-light local graph store.
- Stable MCP SDK v1 package rather than the pre-alpha v2 branch.
- Clear CLI commands and MCP tools for indexing, search, graph schema, structural graph search, architecture reports, architecture summaries, tracing, impact analysis, dead-code candidates, git-change impact, and architecture decisions.
- Incremental indexing skips unchanged files, prunes removed files, and avoids call-edge rebuilds when there is no repository delta.
- Browser dashboard without a bundler so the project is easy to build and inspect.
- Self-contained graph and architecture report exports for sharing HTML or Markdown artifacts without running a server.
- CI that runs type-check, tests, self-indexing, and architecture output.

## Improvements To Highlight

- A small, inspectable TypeScript codebase with tests that a reviewer can understand quickly.
- Built-in ADR memory, not just structural graph search.
- Dashboard API and HTML are included in the same binary entrypoint, avoiding a separate frontend build.
- Swift extraction and big-repo validation now cover a mixed mobile/web monorepo, not only TypeScript services.
- Structural graph search, graph schema summaries, dead-code candidates, git-diff impact mapping, and portable graph exports are first-class CLI/MCP workflows.
- Architecture reports combine metrics, language mix, schema counts, hotspots, boundaries, dead-code samples, review signals, and a graph preview into one shareable artifact.
- A no-op incremental run on the large validation repo completed in 254 ms while preserving a 5,234-symbol, 29,013-edge graph.
- Project is intentionally honest about scope: it is not a 158-language static C engine, but it is local-first, readable, easy to modify, and validated against a large real workspace.
