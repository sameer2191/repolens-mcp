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
- Clear CLI commands and MCP tools for Codex setup checks, indexing, graph package exchange, BM25 code search, semantic search, source snippets, graph schema, graph community detection, structural graph search, read-only Cypher-like graph queries with `DISTINCT`, `count`, `ORDER BY`, and `SKIP`, Docker/Kubernetes/Kustomize infrastructure graph extraction, channel/event graph extraction, route-call linking, relative and workspace-package import cycle detection, architecture reports, architecture summaries, tracing, impact analysis, dead-code candidates, git-change impact, and architecture decisions.
- Incremental indexing skips unchanged files, prunes removed files, and avoids call-edge rebuilds when there is no repository delta.
- Watch mode keeps the graph fresh with polling-based incremental refreshes while preserving deterministic CLI behavior for tests and automation.
- Browser dashboard without a bundler so the project is easy to build and inspect.
- Dashboard APIs expose architecture, graph schema, graph search, semantic search, read-only graph queries, source snippets, import-resolved dependency cycles, dead-code candidates, graph previews, code search, and live Markdown/HTML architecture reports from the same local server.
- Self-contained graph and architecture report exports for sharing HTML or Markdown artifacts without running a server, plus compressed checksummed `.rlgz` graph packages for reusing a SQLite graph without reindexing.
- CI that runs type-check, tests, self-indexing, and architecture output.

## Improvements To Highlight

- A small, inspectable TypeScript codebase with tests that a reviewer can understand quickly.
- Codex setup is explicit and reviewable through `doctor` and `install-codex --dry-run`, with safeguards around existing unmanaged MCP entries.
- Built-in ADR memory, not just structural graph search.
- Dashboard API and HTML are included in the same binary entrypoint, avoiding a separate frontend build while still exposing graph exploration, schema counts, review signals, dead-code samples, and report links.
- Swift extraction and big-repo validation now cover a mixed mobile/web monorepo, not only TypeScript services.
- Structural graph search, BM25 source search with code-aware token expansion, Docker/Kubernetes infrastructure nodes, channel/event edges, route-call edges, deterministic graph communities, dependency-free semantic search, read-only Cypher-like graph queries, graph schema summaries, dependency-cycle detection, dead-code candidates, git-diff impact mapping, watch indexing, and portable graph/package exports are first-class workflows.
- Indexing now writes local `SIMILAR_TO` and `SEMANTICALLY_RELATED` edges without external embeddings or network calls.
- Architecture reports combine metrics, language mix, schema counts, hotspots, boundaries, import-resolved cycle checks, recommendations, dead-code samples, review signals, and a graph preview into one shareable artifact.
- A no-op incremental run on the large validation repo completed in 273 ms while preserving a 5,234-symbol, 30,324-edge graph.
- Project is intentionally honest about scope: it is not a 158-language static C engine, but it is local-first, readable, easy to modify, and validated against a large real workspace.
