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
- Clear CLI commands and MCP tools for indexing, search, architecture summaries, tracing, impact analysis, and architecture decisions.
- Browser dashboard without a bundler so the project is easy to build and inspect.
- CI that runs type-check, tests, self-indexing, and architecture output.

## Improvements To Highlight

- A small, inspectable TypeScript codebase with tests that a reviewer can understand quickly.
- Built-in ADR memory, not just structural graph search.
- Dashboard API and HTML are included in the same binary entrypoint, avoiding a separate frontend build.
- Project is intentionally honest about scope: local-first repository intelligence for TypeScript-heavy portfolios, with extensible extractors for Python, Go, Java, Rust, SQL, YAML, Markdown, and JSON.
