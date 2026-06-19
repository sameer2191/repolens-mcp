# Validation Report

Date: 2026-06-19

## Environment

- Node.js: 24.5.0
- npm: 11.5.1
- Platform: macOS
- SQLite runtime: native `node:sqlite`

## Test Suite

Command:

```bash
npm run verify
npm run test:skip-gate
```

Result:

- TypeScript build passed.
- Node test suite passed: 65 tests, 64 passing, 0 failures, 1 sandbox-only dashboard socket skip.
- Test skip gate passed with explicit policies for the dashboard sandbox socket skip and git-unavailable skips.
- Covered multi-agent MCP setup rendering/dry-run/write/uninstall behavior, version/update status with npm-compatible registry checks, persistent config list/get/set/reset behavior, Codex MCP config rendering/install/uninstall safeguards including forced replacement of old unmanaged sections, project catalog list/status/delete behavior, fleet summary aggregation with inferred service links, cross-repo fleet graph generation, concurrent catalog writes, decision persistence, repository indexing, benchmark full/no-op incremental evidence, incremental refresh, removed-file pruning, watch-mode refresh, git-aware watch skipping unchanged polls and refreshing dirty worktrees, MCP startup auto-indexing and git-aware auto-sync wiring from env and persisted config, MCP stdio JSON-RPC initialization, tool listing, and invalid tool-call rejection under bounded fuzzing, graph package bootstrap from `.repolens/graph.rlgz`, index-writer locking, graph package export/import, index-time graph package writing with `--write-package`, Swift extraction, Next.js App Router route extraction, GraphQL/protobuf/tRPC/OpenAPI protocol extraction, import-resolved file edge extraction with aliases/workspace packages/relative imports, typed `INHERITS`/`IMPLEMENTS`/`USES_TYPE` relationship extraction, conservative `DATA_FLOWS` extraction, positional argument-to-parameter mapping, ambiguous callee suppression, stale data-flow edge pruning on incremental refresh, trace modes for calls/data-flow/cross-service edges, multi-ecosystem manifest extraction, package-manager lockfile extraction, Dockerfile/Kubernetes/Kustomize graph extraction, channel/event graph extraction with `EMITS` and `LISTENS_ON`, runtime trace ingestion with `OBSERVED_*` edges, symbol search, indexed reference lookup, BM25 code search with camelCase/snake_case token expansion, redacted secret scanning, semantic search, local vector search, context-pack assembly, first-class `http_call` nodes with `CALLS_HTTP_ENDPOINT`, generated `HTTP_CALLS` route-call edges, graph community detection, source snippets, graph schema including relationship patterns and label property hints, structural graph search, read-only Cypher-like graph queries including `DISTINCT`, `count`, `ORDER BY`, `SKIP`, `IN`, and numeric comparisons, relative and workspace-package import cycle resolution, git-history hotspot extraction, history-aware architecture recommendations, architecture recommendations, dead-code candidates, architecture summary, property-based resolver fuzzing, and trace behavior on fixture repositories.

## Package And Release

Commands:

```bash
npm run audit:prod
npm pack --dry-run --json
npm run package:check
npm run installer:audit
GITHUB_REPOSITORY=sameer2191/repolens-mcp GH_TOKEN="$(gh auth token)" npm run security:github
node --experimental-sqlite dist/src/cli.js demo
bash -n install.sh
pwsh -NoLogo -NoProfile -Command '$parseErrors = $null; [System.Management.Automation.Language.Parser]::ParseFile("install.ps1", [ref]$null, [ref]$parseErrors) | Out-Null; if ($parseErrors.Count) { $parseErrors; exit 1 }'
node --experimental-sqlite dist/src/cli.js agent-setup --target /tmp/repolens-agent-smoke --agents codex,claude,gemini --db .repolens/memory.db
node --experimental-sqlite dist/src/cli.js uninstall-codex --dry-run
node --experimental-sqlite dist/src/cli.js uninstall-agents --target /tmp/repolens-agent-uninstall-smoke --agents codex
node --experimental-sqlite dist/src/cli.js config set auto-index full --config /tmp/repolens-config-smoke.json
node --experimental-sqlite dist/src/cli.js config get autoIndex --config /tmp/repolens-config-smoke.json
node --experimental-sqlite dist/src/cli.js config reset auto-index --config /tmp/repolens-config-smoke.json
node --experimental-sqlite dist/src/cli.js benchmark tests/fixtures/sample-repo --db /tmp/repolens-benchmark-smoke.db --max-file-bytes 750000 --label benchmark-smoke
node --experimental-sqlite dist/src/cli.js index /tmp/repolens-write-package-smoke/repo --db /tmp/repolens-write-package-smoke/repo/.repolens/memory.db --write-package --label cli-write-package
npm sbom --sbom-format cyclonedx --json
ruby -e 'require "yaml"; Dir[".github/workflows/*.yml"].each { |file| YAML.load_file(file); puts file }'
```

Result:

- Production dependency audit passed with `npm run audit:prod`: 0 vulnerabilities.
- Package dry run passed for `repolens-mcp@1.0.0`.
- Packed artifact: `repolens-mcp-1.0.0.tgz`, 194,979 bytes packed, 997,547 bytes unpacked, 89 runtime/doc entries.
- Package contents are scoped to `dist/src`, `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, selected public docs, `llms.txt`, scripts, `package.json`, `server.json`, `install.sh`, and `install.ps1`; compiled tests, source TypeScript, local graph memory, SQLite databases, graph packages, fixtures, private validation output, and local workstation paths are excluded.
- Package contents gate passed: 89 files inspected.
- Installer audit passed for `install.sh` dry-run setup under a temporary home and target directory. `install.ps1` dry-run audit is enforced when `pwsh` is available and in CI.
- CycloneDX SBOM generation passed with `npm sbom --sbom-format cyclonedx --json`.
- Local installer syntax check passed for `install.sh`; the script verifies Node 24, runs `npm ci`, builds the project, runs `doctor`, can apply `install-codex` with `--dry-run`/`--force` controls, and can render or write project-local setup guidance through `install-agents`.
- PowerShell installer parser check is enforced in CI for `install.ps1`; it mirrors the Unix installer's Node 24 check, npm/build flow, doctor command, Codex install/uninstall, agent install/uninstall, `-DryRun`, `-Force`, `-Db`, `-Agents`, `-Target`, and `-SkipNpm` options. Local macOS validation could not execute `pwsh` because it is not installed in this environment.
- GitHub security summary script reported 0 actionable open alerts, 0 CodeQL alerts, 0 Dependabot alerts, 0 secret-scanning alerts, 3 OpenSSF Scorecard process signals, and 0 other code-scanning alerts.
- `agent-setup` dry-run rendered the expected guide and instruction targets for Codex, Claude, and Gemini without writing files.
- `config set/get/reset` persisted startup defaults in an isolated temp config file and removed the managed key cleanly.
- `uninstall-codex --dry-run` detected the managed Codex block without writing, and `uninstall-agents` removed generated managed blocks from a temporary project target.
- `benchmark` on the fixture repository ran a full index plus no-op incremental index, returned graph totals and throughput, and reported 0 medium/high secret findings.
- `index --write-package` on the fixture repository wrote the default `.repolens/graph.rlgz` package and returned graph-package metadata in the index result.
- Dependency Review workflow added for pull requests. It uses pinned `actions/checkout` and pinned `actions/dependency-review-action@v5.0.0`, runs with read-only `contents` permission, and fails on moderate-or-higher vulnerabilities in runtime or development scopes.
- Release workflow added for version tags and manual runs. It now separates unprivileged `verify-package` work from privileged `publish` work: package verification runs install, verification, dependency audit, demo indexing, `npm pack --json`, CycloneDX SBOM generation, SHA-256 checksum generation, and artifact upload with read-only contents plus `security-events: read`; tag publishing downloads the verified artifact in a separate job with `contents: write`, `id-token: write`, and `attestations: write`.
- Release publishing calls `actions/attest-build-provenance@v2` for the tarball, SBOM, and checksum manifest, uploads GitHub release assets for tags, and publishes the tarball to npm with provenance.
- Tag release publishing now fails when `NPM_TOKEN` is missing instead of silently skipping npm publication.
- Release workflow runs `npm run release:security-gate` with `security-events: read` before packaging/publishing; the gate uses the GitHub security summary to fail on actionable CodeQL, Dependabot, or secret-scanning alerts.
- OpenSSF Scorecard workflow added with SARIF upload to GitHub code scanning.
- Live GitHub security check reported 0 open Dependabot alerts, 0 open secret-scanning alerts, and 0 open CodeQL alerts. The remaining 3 open code-scanning alerts are OpenSSF Scorecard process signals: `MaintainedID`, `CodeReviewID`, and `CIIBestPracticesID`.
- CI now also checks `npm run test:skip-gate`, `npm pack --dry-run --json`, `npm run package:check`, `npm run installer:audit`, generates a CycloneDX SBOM, and self-indexes into `.repolens/ci.db`.

## Self Index

Command:

```bash
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self.db --max-file-bytes 750000 --incremental
node --experimental-sqlite dist/src/cli.js benchmark . --db .repolens/benchmark.db --max-file-bytes 750000 --label self-benchmark
node --experimental-sqlite dist/src/cli.js architecture --db .repolens/self.db
node --experimental-sqlite dist/src/cli.js vector "local vector search" --db .repolens/self.db --limit 5
node --experimental-sqlite dist/src/cli.js references vectorSearch --db .repolens/self.db --limit 5
node --experimental-sqlite dist/src/cli.js scan-secrets --db .repolens/self.db --limit 20 --min-confidence medium
node --experimental-sqlite dist/src/cli.js communities --db .repolens/self.db --limit 5 --min-size 4
node --experimental-sqlite dist/src/cli.js pack-graph --db .repolens/self.db --out .repolens/self.rlgz --label self-validation
node --experimental-sqlite dist/src/cli.js unpack-graph .repolens/self.rlgz --db .repolens/self-imported.db --overwrite
```

Result:

- Files discovered: 81
- Files indexed: 79
- Files skipped: 2
- Symbols: 933
- Edges: 3,988
- Lines indexed: 15,823 source rows; architecture totals report 17,450 physical lines.
- Full index elapsed: 2,644 ms
- No-op incremental elapsed: 24 ms
- No-op incremental unchanged files: 81
- Benchmark command: full index 79/81 files in 2,672 ms, no-op incremental in 17 ms, 29.57 files/s full throughput, 4,764.71 discovered files/s incremental throughput, and 0 medium/high secret findings across 13,645 scanned lines.
- Full-text code-search rows: 15,823 `code_lines` rows and 15,823 `code_fts` rows
- Local vector rows: 719 `symbol_vectors` rows at 384 dimensions; `vector "local vector search"` returned `LocalVector`, `vectorSearch`, and `VectorSearchMatch` as the top three results.
- Reference lookup: `references vectorSearch` returned the API definition plus exact identifier references in `src/core/api.ts`, `src/cli.ts`, and docs.
- MCP server tools registered: 38
- Persistent config smoke test: `config set auto-index full`, `config get autoIndex`, and `config reset auto-index` worked against an isolated temp config file.
- Redacted secret scan: 0 high/medium-confidence findings across 13,645 indexed non-test lines.
- Channel graph rows: 11 `channel` nodes, 2 `EMITS` edges, and 15 `LISTENS_ON` edges
- HTTP call graph rows: 14 `http_call` nodes, 14 `CALLS_HTTP_ENDPOINT` edges, and 4 generated `HTTP_CALLS` route edges
- Type relationship rows: 425 `USES_TYPE` edges, 5 `INHERITS` edges, and 1 `IMPLEMENTS` edge.
- Data-flow graph rows: 672 conservative `DATA_FLOWS` edges from unambiguous call arguments to callee parameters.
- Import graph rows: 75 `IMPORTS_FILE` edges resolving local relative imports and package-local imports to file nodes.
- Protocol graph rows: 2 `graphql_operation` nodes, 1 `graphql_type` node, 1 `grpc_service` node, 2 `trpc_procedure` nodes, 1 `trpc_call` node, and 8 `route` nodes across fixture and app routes
- Manifest graph rows: 11 `package` nodes and 27 `dependency` nodes across npm, Python, Go, Cargo, Composer, Maven, Gradle, Dart, Elixir, Ruby, and requirements fixtures
- Lockfile graph rows: 1 `lockfile` node, 96 `locked_dependency` nodes, and 96 `LOCKS` edges from `package-lock.json`.
- Git history hotspots: architecture summaries and reports rank high-churn files, including `src/core/store.ts` at 27 commits and 3,954 changed lines, and include a history-aware recommendation before risky edits.
- MCP startup auto-index: `REPOLENS_AUTO_INDEX=1` performed an incremental startup refresh on the fixture repo, and `REPOLENS_AUTO_INDEX=full` performed a full startup rebuild through the same `runIndex` path.
- Graph package bootstrap: a missing database imported `.repolens/graph.rlgz`, reported the `bootstrapPackage` metadata, then ran an incremental refresh with unchanged files instead of rebuilding from scratch; `bootstrapPackage: false` kept the full rebuild path.
- Project catalog status: `list-projects` and `project-status repolens-mcp` returned the self graph with live totals of 79 files, 933 symbols, and 3,988 edges; the latest run discovered 81 files with 2 skipped by policy.
- Infrastructure graph labels present: `container_image`, `resource`, `stage`, and `module`; `CONFIGURES` edges present.
- Graph communities: 5 sampled, including CLI/MCP/dashboard, report rendering, type model, agent setup helpers, and fixture route/client communities.
- Graph package import: `.repolens/self.rlgz` restored the self graph snapshot successfully with checksum verification.
- Graph package: `.repolens/self.rlgz` is 1,829,065 bytes from an 8,011,776-byte SQLite snapshot, SHA-256 `74a6cd34f17f257b91369dfb4c2a4b30b9c762bc5ff8f10ec20c9dce372c9e8c`.
- Imported package totals: 79 files, 933 symbols, 3,988 edges, plus 719 persisted vector rows at 384 dimensions.
- Language mix: TypeScript, Markdown, JSON, YAML/OpenAPI, TOML, XML, GraphQL, protobuf, Go, Gradle, Ruby, Elixir, Dockerfile/shell fixture, Swift fixture, and unknown text files.
- Entrypoints detected: `package.json`, `server.json`, `src/cli.ts`, `src/dashboard/server.ts`, `src/index.ts`, `src/mcp/server.ts`, `tests/mcp-server.test.ts`, and fixture server files.
- Import-resolved dependency cycles: 0

## Big Repo Validation

Target: `/path/to/large-workspace`

Latest repeatable benchmark refresh:

```bash
node --experimental-sqlite dist/src/cli.js benchmark /path/to/large-workspace \
  --db /path/to/large-workspace/.repolens/repolens-testing-benchmark.db \
  --max-file-bytes 750000 \
  --label testing-benchmark

node --experimental-sqlite dist/src/cli.js report \
  --db /path/to/large-workspace/.repolens/repolens-testing-benchmark.db \
  --format html \
  --out /path/to/large-workspace/.repolens/repolens-testing-benchmark-report.html

node --experimental-sqlite dist/src/cli.js export-graph \
  --db /path/to/large-workspace/.repolens/repolens-testing-benchmark.db \
  --out /path/to/large-workspace/.repolens/repolens-testing-benchmark-graph.html \
  --limit 1500

node --experimental-sqlite dist/src/cli.js pack-graph \
  --db /path/to/large-workspace/.repolens/repolens-testing-benchmark.db \
  --out /path/to/large-workspace/.repolens/repolens-testing-benchmark-graph.rlgz \
  --label testing-benchmark

node --experimental-sqlite dist/src/cli.js unpack-graph \
  /path/to/large-workspace/.repolens/repolens-testing-benchmark-graph.rlgz \
  --db /path/to/large-workspace/.repolens/repolens-testing-benchmark-import-check.db \
  --overwrite
```

Latest benchmark result:

- Benchmark DB: `/path/to/large-workspace/.repolens/repolens-testing-benchmark.db`
- Files discovered: 853
- Files indexed: 818
- Files skipped: 35
- Symbols: 5,812
- Edges: 38,645
- Lines: 100,100
- Full index elapsed: 16,484 ms
- No-op incremental elapsed: 233 ms
- No-op incremental unchanged files: 853
- Throughput: 49.62 files/s and 352.58 symbols/s for full indexing; 3,660.94 discovered files/s for no-op incremental indexing.
- Redacted secret scan: 0 high-confidence and 0 medium-confidence findings across 61,746 indexed non-test lines.
- Graph export: `/path/to/large-workspace/.repolens/repolens-testing-benchmark-graph.html` (1,500 nodes, 1,500 edges)
- HTML report: `/path/to/large-workspace/.repolens/repolens-testing-benchmark-report.html`
- Graph package: `/path/to/large-workspace/.repolens/repolens-testing-benchmark-graph.rlgz` (10,955,684 bytes from a 73,871,360-byte SQLite snapshot, SHA-256 `6be8fdf102af01114dfa5ddc49f5923935aa597be1887a57c29460a78831ebf0`)
- Imported benchmark graph package totals: 818 indexed files, 5,812 symbols, and 38,645 edges.

Command:

```bash
node --experimental-sqlite dist/src/cli.js index /path/to/large-workspace \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --max-file-bytes 750000

node --experimental-sqlite dist/src/cli.js index /path/to/large-workspace \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --incremental

node --experimental-sqlite dist/src/cli.js architecture \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js schema \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js semantic "live session repository" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 8

node --experimental-sqlite dist/src/cli.js vector "live session repository" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5

node --experimental-sqlite dist/src/cli.js references getLiveSessionRepository \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:DATA_FLOWS]->(b) WHERE a.filePath CONTAINS 'live-session' RETURN a.name,b.name,r.type LIMIT 8" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js communities \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 8 \
  --min-size 8

node --experimental-sqlite dist/src/cli.js cycles \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5

node --experimental-sqlite dist/src/cli.js scan-secrets \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 25 \
  --min-confidence medium

node --experimental-sqlite dist/src/cli.js scan-secrets \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 10 \
  --min-confidence high

node --experimental-sqlite dist/src/cli.js report \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --format html \
  --graph-limit 160 \
  --out /path/to/large-workspace/.repolens/repolens-architecture-report.html

node --experimental-sqlite dist/src/cli.js report \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --format markdown \
  --graph-limit 160 \
  --out /path/to/large-workspace/.repolens/repolens-architecture-report.md

node --experimental-sqlite dist/src/cli.js export-graph \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 1000 \
  --out /path/to/large-workspace/.repolens/repolens-testing-graph.html

node --experimental-sqlite dist/src/cli.js export-graph \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --format json \
  --limit 1000 \
  --out /path/to/large-workspace/.repolens/repolens-testing-graph-1000.json

node --experimental-sqlite dist/src/cli.js pack-graph \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --out /path/to/large-workspace/.repolens/repolens-validation.rlgz \
  --label testing-validation

node --experimental-sqlite dist/src/cli.js unpack-graph \
  /path/to/large-workspace/.repolens/repolens-validation.rlgz \
  --db /path/to/large-workspace/.repolens/repolens-validation-imported.db \
  --overwrite
```

Result:

- Files discovered: 853
- Files indexed: 818
- Files skipped: 35
- Symbols: 5,812
- Edges: 38,634
- Lines indexed: 100,100
- Full index elapsed: 19,291 ms
- No-op incremental elapsed: 275 ms
- No-op incremental unchanged files: 853
- No-op incremental removed files: 0
- Full-text code-search rows: 85,063 `code_lines` rows and 85,063 `code_fts` rows
- Local vector rows: 4,558 `symbol_vectors` rows at 384 dimensions.
- Reference lookup returned the `getLiveSessionRepository` definition in `apps/web-admin/src/lib/server/repositories/live-session-repository.ts` plus exact route and test references under `apps/web-admin/src/app/api/...`.
- Type relationship graph rows: 5,957 `USES_TYPE` edges, 99 `IMPLEMENTS` edges, and 1 `INHERITS` edge. Live-session samples include `parseSort -> LiveSessionFeedSort`, `enforceLifecycleRules -> LiveSession`, and repository classes implementing repository interfaces.
- Data-flow graph rows: 976 conservative `DATA_FLOWS` edges. Live-session samples include `getValidatedComment -> getById`, `requestJson -> parseJsonSafe`, `toDomainFromSupabase -> parseCount`, and `filterFeedSessions -> normalizedStatuses`.
- Channel graph rows: 5 `channel` nodes, 6 `EMITS` edges, and 7 `LISTENS_ON` edges
- Import graph rows: 642 `IMPORTS_FILE` edges resolving local relative, source-root, workspace-package, and path-alias imports.
- HTTP route/call graph rows: 153 Next.js `route` nodes, 30 `http_call` nodes, 30 `CALLS_HTTP_ENDPOINT` edges, and 20 generated `HTTP_CALLS` route edges
- Lockfile graph rows: 1 `lockfile` node, 387 `locked_dependency` nodes, and 387 `LOCKS` edges from `pnpm-lock.yaml`.
- Architecture report HTML: `/path/to/large-workspace/.repolens/repolens-architecture-report.html` (62,527 bytes)
- Architecture report Markdown: `/path/to/large-workspace/.repolens/repolens-architecture-report.md` (11,772 bytes)
- Graph export: `/path/to/large-workspace/.repolens/repolens-testing-graph.html` (1,000 nodes, 1,000 edges, 348,985 bytes)
- Graph export JSON: `/path/to/large-workspace/.repolens/repolens-testing-graph-1000.json` (1,000 nodes, 1,000 edges, 428,932 bytes)
- Graph package: `/path/to/large-workspace/.repolens/repolens-validation.rlgz` (14,184,723 bytes from an 81,072,128-byte SQLite snapshot, SHA-256 `a18d45eae59a1c377b26267904cb5c120301049bab9712b8f9fa18ab2411c053`)
- Imported graph package totals: 818 indexed files, 5,812 symbols, 38,634 edges, plus 4,558 persisted vector rows at 384 dimensions.
- Redacted secret scan: 0 high-confidence and 0 medium-confidence findings across 61,746 indexed non-test lines.
- Graph communities sampled: order repository, iOS load flows, access/cart clearing, auth/request helpers, address book, live-session tests, cart, and menu management communities.
- Validation DB: `/path/to/large-workspace/.repolens/repolens-validation.db`
- Import-resolved dependency cycles: 0
- Git history hotspots: architecture summaries rank `src/styles/global.css`, `apps/ios/NewAppiOS/Views/ConsumerHomeView.swift`, `apps/ios/NewAppiOS/Views/RestaurantProfileView.swift`, and other high-churn files with commit counts, churn, author count, and latest subject.
- Dashboard smoke check: `serve --db /path/to/large-workspace/.repolens/repolens-validation.db --port 9759` served `/api/schema`, `/api/query-graph` for `DATA_FLOWS`, and `/api/architecture`; sandboxed local networking required approval for the bind and curl checks.

Top language coverage:

| Language | Files | Lines | Symbols |
| --- | ---: | ---: | ---: |
| Swift | 212 | 42,029 | 2,627 |
| TypeScript | 404 | 40,663 | 1,655 |
| Markdown | 104 | 6,828 | 868 |
| YAML | 4 | 3,888 | 392 |
| SQL | 49 | 2,188 | 167 |
| JSON | 12 | 410 | 60 |
| Shell | 28 | 3,569 | 28 |
| JavaScript | 3 | 491 | 8 |

Graph schema:

| Kind / edge | Count |
| --- | ---: |
| Function nodes | 2,451 |
| File nodes | 818 |
| Heading nodes | 764 |
| Locked dependency nodes | 387 |
| Struct nodes | 348 |
| Class nodes | 205 |
| Route nodes | 153 |
| Lockfile nodes | 1 |
| `CALLS` edges | 20,111 |
| `USES_TYPE` edges | 5,957 |
| `DEFINES` edges | 4,435 |
| `CALLS_LOCAL` edges | 3,163 |
| `IMPORTS` edges | 1,321 |
| `SIMILAR_TO` edges | 1,194 |
| `DATA_FLOWS` edges | 976 |
| `IMPORTS_FILE` edges | 642 |
| `LOCKS` edges | 387 |
| `DECLARES` edges | 167 |
| `SEMANTICALLY_RELATED` edges | 118 |
| HTTP call nodes | 30 |
| `CALLS_HTTP_ENDPOINT` edges | 30 |
| `HTTP_CALLS` edges | 20 |
| `IMPLEMENTS` edges | 99 |
| `INHERITS` edges | 1 |

Incremental refresh:

```bash
node --experimental-sqlite dist/src/cli.js index /path/to/large-workspace \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --incremental
```

Confirmed a no-op incremental pass preserved 5,812 symbols and 38,634 edges while marking all 853 discovered files unchanged.

Representative hotspots:

- `apps/ios/NewAppiOS/Views/DesignSystem.swift`
- `packages/backend-contracts/src/index.ts`
- `apps/ios/NewAppiOS/Views/ConsumerExploreReelsView.swift`
- `apps/ios/NewAppiOS/Views/ConsumerHomeView.swift`
- `apps/ios/NewAppiOS/Views/RestaurantProfileView.swift`
- `apps/web-admin/src/lib/server/repositories/live-session-repository.ts`

Representative entrypoints:

- `apps/web-admin/src/lib/integrations/supabase-server.ts`
- `package.json`
- `packages/backend-contracts/src/index.ts`
- `packages/shared-types/src/index.ts`
- `src/main.jsx`

Review signals:

- 83 task markers.
- 436 sensitive-key-like text matches to review.
- 35 files skipped by size, binary, or ignore policy.
- 5 dead-code candidates sampled.

The review-signal counts are intentionally conservative; they are meant to route a human to candidate files rather than claim confirmed issues.

## Representative Tool Checks

Search:

```bash
node --experimental-sqlite dist/src/cli.js search "live session repository" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed BM25-ranked matches across live-session repository tests and the main `LiveSessionRepository` interface.

The fixture suite also verifies code-aware ranking by searching for `create order` and finding the `createOrder` source line, then confirms incremental deletion prunes stale full-text rows for removed files.

Infrastructure graph checks:

```bash
node --experimental-sqlite dist/src/cli.js search-graph orders-api \
  --kind resource \
  --db /tmp/repolens-iac-smoke.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:CONFIGURES]->(b) WHERE b.name CONTAINS 'orders-api' RETURN a.name,b.name,r.type LIMIT 5" \
  --db /tmp/repolens-iac-smoke.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:IMPORTS]->(b) WHERE a.name STARTS WITH 'Kustomization' RETURN a.name,b.name,r.type LIMIT 5" \
  --db /tmp/repolens-iac-smoke.db
```

Confirmed the fixture graph exposes `Deployment/orders-api`, `Service/orders-api`, Dockerfile container images, a `CONFIGURES` edge from the deployment to `ghcr.io/example/orders-api:1.2.3`, and a Kustomization `IMPORTS` edge to `deployment.yaml`.

Manifest dependency graph checks:

```bash
node --experimental-sqlite dist/src/cli.js search-graph orders --kind package --db /tmp/repolens-manifest-smoke.db --limit 30
node --experimental-sqlite dist/src/cli.js search-graph fastapi --kind dependency --db /tmp/repolens-manifest-smoke.db --limit 5
node --experimental-sqlite dist/src/cli.js search-graph commons-lang3 --kind dependency --db /tmp/repolens-manifest-smoke.db --limit 5
node --experimental-sqlite dist/src/cli.js search-graph tokio --kind dependency --db /tmp/repolens-manifest-smoke.db --limit 5
```

Confirmed npm, Python, Go, Cargo, Composer, Maven, Gradle, Dart, Elixir, Ruby, and requirements fixtures produce `package` and `dependency` nodes, including `fastapi`, `github.com/gin-gonic/gin`, `tokio`, `laravel/framework`, `org.apache.commons:commons-lang3`, `com.squareup.okhttp3:okhttp`, `json_annotation`, `phoenix`, and `rack`.

Channel/event graph checks:

```bash
node --experimental-sqlite dist/src/cli.js search-graph order.created \
  --kind channel \
  --db /tmp/repolens-channel-smoke.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:EMITS]->(b:Channel) WHERE b.name = 'order.created' RETURN a.name,b.name,r.type LIMIT 5" \
  --db /tmp/repolens-channel-smoke.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:LISTENS_ON]->(b:Channel) WHERE b.name = 'checkoutSubmitted' RETURN a.name,b.name,r.type LIMIT 5" \
  --db /tmp/repolens-channel-smoke.db
```

Confirmed the fixture graph exposes `order.created` and `checkoutSubmitted` channel nodes, an `EMITS` edge from `notifyOrderCreated`, a `LISTENS_ON` edge from `onOrderCreated`, and Swift NotificationCenter `EMITS`/`LISTENS_ON` edges for checkout submission.

Agent and Codex setup:

```bash
node --experimental-sqlite dist/src/cli.js doctor
node --experimental-sqlite dist/src/cli.js install-codex --dry-run --db .repolens/memory.db
node --experimental-sqlite dist/src/cli.js agent-setup \
  --target /tmp/repolens-agent-smoke \
  --agents codex,claude,gemini \
  --db .repolens/memory.db
```

Confirmed `doctor` detected the local `~/.codex/config.toml`, reported `repolensConfigured: true` and `managedBlockPresent: true` on this machine, and the repaired `install-codex --force` path replaced the prior unmanaged block without duplicate TOML sections. Confirmed `agent-setup` dry-run rendered the shared guide plus Codex, Claude, and Gemini instruction files without writing to the target directory, and `uninstall-agents` removed managed blocks from a temporary target.

Symbol lookup:

```bash
node --experimental-sqlite dist/src/cli.js symbols repository \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed repository interfaces and exported domain types under `apps/web-admin/src/lib/server/repositories`.

Type relationship graph:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:USES_TYPE]->(b) WHERE a.filePath CONTAINS 'live-session' RETURN a.name,b.name,r.type LIMIT 8" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:IMPLEMENTS]->(b) RETURN a.name,b.name,r.type LIMIT 8" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:INHERITS]->(b) RETURN a.name,b.name,r.type LIMIT 8" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db
```

Confirmed typed graph queries returned live-session type-use edges such as `parseSort -> LiveSessionFeedSort` and `enforceLifecycleRules -> LiveSession`, repository implementation edges such as `APIAddressBookRepository -> AddressBookRepository`, and inheritance edges such as `LiveSessionFeedItem -> LiveSession`.

Data-flow graph:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:DATA_FLOWS]->(b) WHERE a.filePath CONTAINS 'live-session' RETURN a.name,b.name,r.type LIMIT 8" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db
```

Confirmed data-flow queries returned live-session argument-flow edges such as `getValidatedComment -> getById`, `requestJson -> parseJsonSafe`, `toDomainFromSupabase -> parseCount`, `countReactionsSupabase -> getMemoryReactionCount`, and `filterFeedSessions -> normalizedStatuses`.

Reference lookup:

```bash
node --experimental-sqlite dist/src/cli.js references getLiveSessionRepository \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed the indexed lookup returned the live-session repository definition, the import site in the consumer feed route, the invocation line in that route, and mocked references in route tests.

Semantic search and similarity edges:

```bash
node --experimental-sqlite dist/src/cli.js semantic "live session repository" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 8

node --experimental-sqlite dist/src/cli.js vector "live session repository" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:SIMILAR_TO]->(b) RETURN a.name,b.name,r.weight LIMIT 5" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:SEMANTICALLY_RELATED]->(b) RETURN a.name,b.name,r.weight LIMIT 5" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db
```

Confirmed concept search returned live-session domain symbols, vector search ranked `getLiveSessionRepository`, `getLiveSessionCommentRepository`, and `getLiveSessionLikeRepository` at the top with all query tokens matched, `SIMILAR_TO` returned near-duplicate token-profile links, and `SEMANTICALLY_RELATED` returned cross-symbol semantic links.

Read-only graph query clauses:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (f:Function) RETURN count(f) AS functions LIMIT 5" \
  --db /tmp/repolens-iac-smoke.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (f:Function) RETURN DISTINCT f.name ORDER BY f.name SKIP 1 LIMIT 5" \
  --db /tmp/repolens-iac-smoke.db
```

Confirmed aggregate counts and stable distinct ordered pagination through the CLI.

Project catalog checks:

```bash
env REPOLENS_CATALOG=/tmp/repolens-project-catalog-smoke.json node --experimental-sqlite dist/src/cli.js index tests/fixtures/sample-repo --db /tmp/repolens-project-catalog/.repolens/smoke.db --max-file-bytes 750000
env REPOLENS_CATALOG=/tmp/repolens-project-catalog-smoke.json node --experimental-sqlite dist/src/cli.js list-projects
env REPOLENS_CATALOG=/tmp/repolens-project-catalog-smoke.json node --experimental-sqlite dist/src/cli.js project-status sample-repo
env REPOLENS_CATALOG=/tmp/repolens-project-catalog-smoke.json node --experimental-sqlite dist/src/cli.js delete-project sample-repo --delete-db
```

Confirmed the isolated catalog listed the fixture project, returned live totals of 22 files, 93 symbols, and 134 edges from the SQLite graph, then removed the catalog entry and safely deleted `/tmp/repolens-project-catalog/.repolens/smoke.db`.

Fleet summary checks:

```bash
env REPOLENS_CATALOG=/tmp/repolens-fleet-smoke-locked.json node --experimental-sqlite dist/src/cli.js index tests/fixtures/sample-repo --db /tmp/repolens-fleet-smoke-locked/service-a/.repolens/memory.db --max-file-bytes 750000 --label service-a
env REPOLENS_CATALOG=/tmp/repolens-fleet-smoke-locked.json node --experimental-sqlite dist/src/cli.js index tests/fixtures/sample-repo --db /tmp/repolens-fleet-smoke-locked/service-b/.repolens/memory.db --max-file-bytes 750000 --label service-b
env REPOLENS_CATALOG=/tmp/repolens-fleet-smoke-locked.json node --experimental-sqlite dist/src/cli.js fleet-summary --limit 5
env REPOLENS_CATALOG=/tmp/repolens-fleet-smoke-locked.json node --experimental-sqlite dist/src/cli.js fleet-graph --limit 5 --max-nodes 200 --max-edges 500
```

Confirmed parallel catalog writes retained both labeled projects. `fleet-summary` returned 2 projects, 44 files, 186 symbols, 268 edges, 6 routes, 4 HTTP calls, 4 inferred service links, shared dependency overlap including `express`, and route overlaps including `GET /orders` and `POST /orders`. `fleet-graph` returned project nodes, dependency nodes, route nodes, `DEPENDS_ON` edges, `ROUTE_OVERLAP` edges, and `CROSS_REPO_HTTP_CALLS` edges between the indexed fixture projects.

Runtime trace ingestion checks:

```bash
node --experimental-sqlite dist/src/cli.js index tests/fixtures/sample-repo --db /tmp/repolens-trace-smoke.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js ingest-traces '[{"type":"http","source":"submitOrder","sourceFile":"src/client.ts","method":"POST","path":"/orders","count":3},{"type":"event","source":"notifyOrderCreated","sourceFile":"src/client.ts","channel":"order.created","direction":"emit","count":2}]' --db /tmp/repolens-trace-smoke.db
node --experimental-sqlite dist/src/cli.js query-graph "MATCH (a)-[r:OBSERVED_HTTP_CALLS]->(b:Route) RETURN a.name,b.name,r.type LIMIT 5" --db /tmp/repolens-trace-smoke.db
node --experimental-sqlite dist/src/cli.js query-graph "MATCH (a)-[r:OBSERVED_EMITS]->(b:Channel) RETURN a.name,b.name,r.type LIMIT 5" --db /tmp/repolens-trace-smoke.db
```

Confirmed two observed traces inserted one `OBSERVED_HTTP_CALLS` edge from `submitOrder` to `POST /orders` and one `OBSERVED_EMITS` edge from `notifyOrderCreated` to `order.created`, with no unresolved traces.

Context-pack checks:

```bash
node --experimental-sqlite dist/src/cli.js context-pack "create order" --db /tmp/repolens-trace-smoke.db --limit 3 --context 1
```

Confirmed the context pack returned `createOrder` as the top semantic and vector match, BM25 code hits, source snippets, and adjacent graph edges in one response.

Source snippets:

```bash
node --experimental-sqlite dist/src/cli.js snippet getCodeSnippet \
  --db .repolens/self.db \
  --context 2

node --experimental-sqlite dist/src/cli.js snippet makeSession \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --context 1

node --experimental-sqlite dist/src/cli.js snippet 'apps/web-admin/src/lib/server/repositories/live-session-repository.ts:40' \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --context 2
```

Confirmed symbol-based snippets, Swift snippets, and `path:line` snippets with highlighted line ranges.

Graph schema:

```bash
node --experimental-sqlite dist/src/cli.js schema \
  --db /path/to/large-workspace/.repolens/repolens-validation.db
```

Confirmed Swift, TypeScript, Markdown, SQL, JSON, shell, JavaScript, YAML, and unknown text coverage with node-label counts, edge-type counts, relationship patterns, and label property hints.

Read-only graph query:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (f:Function) WHERE f.filePath CONTAINS 'live-session' RETURN f.name,f.filePath LIMIT 5" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:CALLS]->(b) WHERE b.name = 'makeSession' RETURN a.name,b.name,r.type LIMIT 5" \
  --db /path/to/large-workspace/.repolens/repolens-validation.db
```

Confirmed node and one-hop relationship queries with `WHERE`, `RETURN`, edge aliases, and `LIMIT` on the large validation database.

HTTP route-call links:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:CALLS_HTTP_ENDPOINT]->(b) RETURN a.name,b.name,r.type LIMIT 5" \
  --db .repolens/self.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:HTTP_CALLS]->(b:Route) RETURN a.name,b.name,r.type LIMIT 5" \
  --db .repolens/self.db
```

Confirmed literal HTTP calls are stored as `http_call` nodes with `CALLS_HTTP_ENDPOINT` edges, and `loadOrders -> GET /orders` plus `submitOrder -> POST /orders` direct route edges are present in the self-validation fixture graph.

Graph communities:

```bash
node --experimental-sqlite dist/src/cli.js communities \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 8 \
  --min-size 8
```

Confirmed weighted community detection on the large validation database. The largest sampled communities had actionable labels and representative symbols such as `APIOrderRepository`, `APIAddressBookRepository`, `makeSession`, `addItem`, and `listMenuItems`, with cohesion and boundary-edge counts.

Dependency cycles:

```bash
node --experimental-sqlite dist/src/cli.js cycles \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed no relative-import or workspace-package-import cross-cluster dependency cycles in the large validation database.

Architecture report:

```bash
node --experimental-sqlite dist/src/cli.js report \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --format html \
  --graph-limit 1000 \
  --out /path/to/large-workspace/.repolens/repolens-architecture-report.html
```

Confirmed HTML and Markdown reports with summary metrics, language tables, graph schema counts including semantic/similarity edges, structural hotspots, git-history hotspots, top symbols, architecture boundaries, dependency-cycle checks, history-aware recommendations, dead-code samples, review signals, and graph samples.

Structural graph search:

```bash
node --experimental-sqlite dist/src/cli.js search-graph live-session \
  --relationship CALLS \
  --min-degree 1 \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed live-session repository files and test helpers with graph degree metrics.

Dead-code candidates:

```bash
node --experimental-sqlite dist/src/cli.js dead-code \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 8
```

Confirmed non-exported Swift candidates with zero inbound call edges.

Graph export:

```bash
node --experimental-sqlite dist/src/cli.js export-graph \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --limit 1000 \
  --out /path/to/large-workspace/.repolens/repolens-testing-graph.html
```

Confirmed 1,000 nodes and 1,000 edges in the exported HTML graph. A matching JSON artifact was written to `/path/to/large-workspace/.repolens/repolens-testing-graph-1000.json`.

Graph package exchange:

```bash
node --experimental-sqlite dist/src/cli.js pack-graph \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --out /path/to/large-workspace/.repolens/repolens-validation.rlgz \
  --label testing-validation

node --experimental-sqlite dist/src/cli.js unpack-graph \
  /path/to/large-workspace/.repolens/repolens-validation.rlgz \
  --db /path/to/large-workspace/.repolens/repolens-validation-imported.db \
  --overwrite
```

Confirmed the package exporter created a checksummed `.rlgz` artifact and the importer restored a graph with 818 indexed files, 5,812 symbols, and 38,634 edges.

Watch mode:

```bash
node --experimental-sqlite dist/src/cli.js watch /path/to/large-workspace \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --interval-ms 250 \
  --runs 2
```

Confirmed two watch-mode incremental passes over the large validation database preserved the graph. The refreshed validation database currently contains 5,812 symbols and 38,634 edges. A concurrent package export and watch refresh also completed after adding SQLite connection-level busy timeouts.

Index lock:

```bash
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self-lock-check-2.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self-lock-check-2.db --max-file-bytes 750000 --incremental
```

Confirmed overlapping index writers on a fresh database no longer interleave; one run completed and the other returned a clear RepoLens index-lock message.

Dashboard routes:

```bash
node --experimental-sqlite dist/src/cli.js serve \
  --db /path/to/large-workspace/.repolens/repolens-validation.db \
  --port 9759

curl --fail http://127.0.0.1:9759/api/schema
curl --fail 'http://127.0.0.1:9759/api/query-graph?q=MATCH%20(a)-%5Br%3ADATA_FLOWS%5D-%3E(b)%20RETURN%20a.name%2Cb.name%2Cr.type%20LIMIT%203'
curl --fail http://127.0.0.1:9759/api/architecture
```

Confirmed the dashboard served the validation database, returned the 818-indexed-file / 5,812-symbol / 38,634-edge schema, returned `DATA_FLOWS` rows through `/api/query-graph`, and returned the architecture summary through `/api/architecture`. Sandboxed local networking required approval for the bind and curl checks.

Trace:

```bash
node --experimental-sqlite dist/src/cli.js trace listOrders \
  --direction inbound \
  --db .repolens/self.db \
  --depth 2
```

Confirmed inbound links from the fixture server file to the `listOrders` symbol.

Git-change impact:

```bash
node --experimental-sqlite dist/src/cli.js changes /path/to/repolens-mcp \
  --db .repolens/self.db \
  --limit 10
```

Confirmed modified files map back to indexed symbols and produced a medium risk classification for the current local change set, with per-file blast-radius details, relationship counts, symbol-kind summaries, and risk reasons.

## Conclusion

The project builds, tests, indexes itself, benchmarks full and no-op incremental graph creation, indexes a larger mixed Swift/TypeScript workspace, exports graph artifacts, bootstraps missing databases from shared graph packages, packages and imports SQLite graph snapshots, serves a local graph dashboard, tracks indexed projects through a lock-protected local catalog, summarizes indexed fleets across languages/routes/HTTP calls/dependencies with inferred service links, generates cross-repo fleet graphs for shared dependencies, route overlaps, and consumer/provider HTTP edges, runs redacted secret scans, ingests runtime traces as observed graph edges, assembles context packs for agent workflows, renders and removes managed multi-agent MCP setup guidance, supports explicit MCP startup auto-indexing through env vars or persistent local config, and exposes graph schema with relationship patterns and label property hints, structural search, indexed reference lookup, typed inheritance/implementation/use relationships, semantic search, local vector search, generated similarity/semantic edges, read-only graph queries, focused trace modes for calls/data flow/cross-service edges, import-resolved dependency cycles, architecture recommendations, git-history hotspots, dead-code candidates, reports, watch-mode refresh, and git-change impact through CLI/MCP paths. GitHub security posture now includes branch protection, private vulnerability reporting, CodeQL/Scorecard/Dependabot/secret scanning, property-based resolver fuzzing, MCP JSON-RPC robustness fuzzing, a package contents gate for release artifacts, and a release gate that blocks publication on open CodeQL alerts. It remains intentionally scoped and inspectable, with a clear path to deeper parsing through future tree-sitter adapters.
