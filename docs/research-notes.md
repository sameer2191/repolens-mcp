# Research Notes

External benchmark snapshot reviewed during product research.

## Inventory

- 1,702 files in the cloned repository.
- 35,572,936 total lines counted across non-git files.
- Largest line-count buckets are vendored/generated assets, especially SQLite, Nomic vectors, tree-sitter grammars, and parser outputs.
- Hand-authored product logic is concentrated in `src/`, `internal/cbm/`, `scripts/`, `pkg/`, `tests/`, and `graph-ui/`.

## Benchmark Findings

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
- Clear CLI commands and MCP tools for Codex setup checks, persistent config, 11-agent setup guidance, graph package bootstrap, optional MCP startup auto-indexing, git-aware MCP auto-sync, indexing, repeatable full/incremental benchmarks, project inventory/status, fleet summaries with inferred service links, cross-repo fleet graphs, graph package exchange, BM25 code search, reference lookup, typed inheritance/implementation/use/data-flow edges, redacted secret scanning, semantic search, local vector search, context packs, source snippets, graph schema with relationship patterns and label properties, graph community detection, structural graph search, read-only Cypher-like graph queries with `DISTINCT`, `count`, `ORDER BY`, and `SKIP`, runtime trace ingestion, import-resolved file graph edges, multi-ecosystem manifest and lockfile extraction, Docker/Kubernetes/Kustomize infrastructure graph extraction, channel/event graph extraction, GraphQL/gRPC/tRPC/OpenAPI protocol extraction, route-call linking, relative and workspace-package import cycle detection, architecture reports, architecture summaries, git-history hotspots, tracing, impact analysis, dead-code candidates, git-change impact, and architecture decisions.
- Incremental indexing skips unchanged files, prunes removed files, and avoids call-edge rebuilds when there is no repository delta.
- Watch mode keeps the graph fresh with polling-based incremental refreshes while preserving deterministic CLI behavior for tests and automation; git-aware auto-sync skips unchanged HEAD/status polls during long-running MCP sessions.
- Browser dashboard without a bundler so the project is easy to build and inspect.
- Dashboard APIs expose architecture, fleet summaries, graph schema relationship/property hints, graph search, semantic search, local vector search, reference lookup, read-only graph queries, source snippets, import-resolved dependency cycles, dead-code candidates, graph previews, code search, and live Markdown/HTML architecture reports from the same local server.
- Self-contained graph and architecture report exports for sharing HTML or Markdown artifacts without running a server, plus compressed checksummed `.rlgz` graph packages for reusing a SQLite graph without reindexing. A successful index can write a fresh package with `--write-package`, and a missing database can bootstrap from `.repolens/graph.rlgz` before the incremental pass.
- CI runs explicit test-skip governance, type-check, tests, production dependency audit, package dry-run, package contents gating, installer dry-run auditing, CycloneDX SBOM generation, self-indexing, and architecture output; separate workflows cover OpenSSF Scorecard and release build-provenance attestations.
- `llms.txt`, `docs/agent-guide.md`, and `docs/BENCHMARK.md` provide concise agent-facing operating instructions, sanitized validation evidence, and local-data boundaries in the npm package.
- Executable `agent-hook` / `hook-augment` support turns broad-search hook payloads into non-blocking RepoLens context reminders while skipping direct Read/Edit/Write tools; `--with-query` can opt in to local graph metadata matches when the maintainer wants DB-backed augmentation. Claude Code setup can also merge a managed local PreToolUse hook entry using exec-form `command` plus `args`, avoiding shell parsing and preserving unrelated hooks.
- `install.ps1` mirrors the Unix installer for Windows users, and `scripts/github-security-summary.mjs` gives maintainers a repeatable GitHub Security tab summary that separates actionable alerts from Scorecard process signals.
- The release workflow separates unprivileged verify/package work from privileged attestation, GitHub release, and npm publish work.

## Improvements To Highlight

- A small, inspectable TypeScript codebase with tests that a reviewer can understand quickly.
- Codex setup is explicit and reviewable through `doctor` and `install-codex --dry-run`, with safeguards around existing unmanaged MCP entries.
- Multi-agent setup is explicit, reversible, and reviewable through `agent-setup`, `install-agents --dry-run`, and `uninstall-agents --dry-run`, generating project-local instructions and config snippets for Codex, Claude, Gemini, Zed, OpenCode, Antigravity, Aider, KiloCode, VS Code, OpenClaw, and Kiro.
- Built-in ADR memory, not just structural graph search.
- Dashboard API and HTML are included in the same binary entrypoint, avoiding a separate frontend build while still exposing graph exploration, fleet service links, schema counts, relationship patterns, label property hints, review signals, dead-code samples, and report links.
- Swift extraction and big-repo validation now cover a mixed mobile/web monorepo, not only TypeScript services.
- Structural graph search, BM25 source search with code-aware token expansion, reference lookup, typed inheritance/implementation/use edges, conservative data-flow edges, persistent startup config, redacted secret scanning, context packs for agents, multi-agent setup guidance, graph package bootstrap, optional startup auto-indexing, git-aware auto-sync, repeatable benchmark output, import-resolved local file edges, multi-ecosystem package/dependency nodes, resolved lockfile dependency nodes, project inventory/status, fleet summaries with cross-project service links, cross-repo graphing, runtime trace ingestion, Docker/Kubernetes infrastructure nodes, channel/event edges, first-class HTTP call nodes, GraphQL/gRPC/tRPC/OpenAPI protocol nodes, route-call edges, deterministic graph communities, dependency-free semantic search, persisted local vector search, read-only Cypher-like graph queries, graph schema relationship/property summaries, dependency-cycle detection, dead-code candidates, git-history hotspots, git-diff impact mapping with per-file blast radius, watch indexing, and portable graph/package exports are first-class workflows.
- Indexing now writes local `SIMILAR_TO` and `SEMANTICALLY_RELATED` edges plus deterministic symbol vectors without external embeddings or network calls.
- Architecture reports combine metrics, language mix, schema counts, structural hotspots, git-history churn, boundaries, import-resolved cycle checks, recommendations, dead-code samples, review signals, and a graph preview into one shareable artifact; the live schema API additionally exposes relationship patterns and label property hints for query authors.
- A repeatable benchmark run on the large validation repo completed a full index in 16,484 ms and a no-op incremental index in 233 ms while preserving a 5,812-symbol, 38,645-edge graph with 153 Next.js route nodes, 653 resolved import edges, 5,957 type-use edges, 976 data-flow edges, and 387 locked dependencies.
- Redacted secret scans returned 0 high/medium-confidence findings across the RepoLens self graph and the large validation workspace.
- The package contents gate blocks local graph memory, SQLite databases, graph packages, tests, source TypeScript, private validation output, and local workstation paths from the published npm artifact; installer audits check dry-run setup paths before the scripts ship.
- Test skips are governed through a source-scanning gate so new skips cannot appear without an explicit file, reason, guard, and expected count.
- Maintainer security checks can now summarize live CodeQL, Dependabot, secret-scanning, and Scorecard state without manually clicking through GitHub.
- Project is intentionally honest about scope: it is not a 158-language static C engine, but it is local-first, readable, easy to modify, and validated against a large real workspace.
