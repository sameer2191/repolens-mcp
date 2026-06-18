# Validation Report

Date: 2026-06-18

## Environment

- Node.js: 24.5.0
- npm: 11.5.1
- Platform: macOS
- SQLite runtime: native `node:sqlite`

## Test Suite

Command:

```bash
npm run verify
```

Result:

- TypeScript build passed.
- Node test suite passed: 12 tests, 0 failures.
- Covered Codex MCP config rendering/install safeguards, decision persistence, repository indexing, incremental refresh, removed-file pruning, watch-mode refresh, index-writer locking, graph package export/import, Swift extraction, multi-ecosystem manifest extraction, Dockerfile/Kubernetes/Kustomize graph extraction, channel/event graph extraction with `EMITS` and `LISTENS_ON`, symbol search, BM25 code search with camelCase/snake_case token expansion, semantic search, generated `SIMILAR_TO` / `SEMANTICALLY_RELATED` edges, generated `HTTP_CALLS` route-call edges, graph community detection, source snippets, graph schema, structural graph search, read-only Cypher-like graph queries including `DISTINCT`, `count`, `ORDER BY`, and `SKIP`, relative and workspace-package import cycle resolution, architecture recommendations, dead-code candidates, architecture summary, and trace behavior on fixture repositories.

## Self Index

Command:

```bash
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self.db --max-file-bytes 750000 --incremental
node --experimental-sqlite dist/src/cli.js architecture --db .repolens/self.db
node --experimental-sqlite dist/src/cli.js communities --db .repolens/self.db --limit 5 --min-size 4
node --experimental-sqlite dist/src/cli.js pack-graph --db .repolens/self.db --out .repolens/self.rlgz --label self-validation
node --experimental-sqlite dist/src/cli.js unpack-graph .repolens/self.rlgz --db .repolens/self-imported.db --overwrite
```

Result:

- Files discovered: 51
- Files indexed: 51
- Files skipped: 0
- Symbols: 408
- Edges: 1,249
- Lines indexed: 7,681
- Full index elapsed: 385 ms
- No-op incremental elapsed: 22 ms
- No-op incremental unchanged files: 51
- Full-text code-search rows: 6,915 `code_lines` rows and 6,915 `code_fts` rows
- Channel graph rows: 8 `channel` nodes, 2 `EMITS` edges, and 11 `LISTENS_ON` edges
- Manifest graph rows: 11 `package` nodes and 27 `dependency` nodes across npm, Python, Go, Cargo, Composer, Maven, Gradle, Dart, Elixir, Ruby, and requirements fixtures
- Infrastructure graph labels present: `container_image`, `resource`, `stage`, and `module`; `CONFIGURES` edges present.
- Graph communities: 5 sampled, including CLI/MCP/dashboard, report rendering, type model, and fixture route/client communities.
- Graph package: `.repolens/self.rlgz` (987,458 bytes from a 3,686,400-byte SQLite snapshot)
- Imported package totals: 51 files, 408 symbols, 1,249 edges
- Language mix: TypeScript, Markdown, JSON, YAML, TOML, XML, Go, Gradle, Ruby, Elixir, Dockerfile/shell fixture, Swift fixture, and unknown text files.
- Entrypoints detected: `package.json`, `server.json`, `src/cli.ts`, `src/dashboard/server.ts`, `src/index.ts`, `src/mcp/server.ts`, and fixture server files.
- Import-resolved dependency cycles: 0

## Big Repo Validation

Target: `/Users/sameer/Desktop/testing`

Command:

```bash
node --experimental-sqlite dist/src/cli.js index /Users/sameer/Desktop/testing \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --max-file-bytes 750000

node --experimental-sqlite dist/src/cli.js index /Users/sameer/Desktop/testing \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --incremental

node --experimental-sqlite dist/src/cli.js architecture \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js schema \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js semantic "live session repository" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 8

node --experimental-sqlite dist/src/cli.js communities \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 8 \
  --min-size 8

node --experimental-sqlite dist/src/cli.js cycles \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 5

node --experimental-sqlite dist/src/cli.js report \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --format html \
  --graph-limit 1000 \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-architecture-report.html

node --experimental-sqlite dist/src/cli.js report \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --format markdown \
  --graph-limit 200 \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-architecture-report.md

node --experimental-sqlite dist/src/cli.js export-graph \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 1000 \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-testing-graph.html

node --experimental-sqlite dist/src/cli.js pack-graph \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-validation.rlgz \
  --label testing-validation

node --experimental-sqlite dist/src/cli.js unpack-graph \
  /Users/sameer/Desktop/testing/.repolens/repolens-validation.rlgz \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation-imported.db \
  --overwrite
```

Result:

- Files discovered: 852
- Files indexed: 817
- Files skipped: 35
- Symbols: 5,240
- Edges: 30,337
- Lines indexed: 96,330
- Full index elapsed: 16,276 ms
- No-op incremental elapsed: 301 ms
- No-op incremental unchanged files: 852
- No-op incremental removed files: 0
- Full-text code-search rows: 82,090 `code_lines` rows and 82,090 `code_fts` rows
- Channel graph rows: 5 `channel` nodes, 6 `EMITS` edges, and 7 `LISTENS_ON` edges
- Architecture report HTML: `/Users/sameer/Desktop/testing/.repolens/repolens-architecture-report.html` (339,475 bytes)
- Architecture report Markdown: `/Users/sameer/Desktop/testing/.repolens/repolens-architecture-report.md` (8.8 KB)
- Graph export: `/Users/sameer/Desktop/testing/.repolens/repolens-testing-graph.html` (1,000 nodes, 1,000 edges, 349,365 bytes)
- Graph package: `/Users/sameer/Desktop/testing/.repolens/repolens-validation.rlgz` (12,394,224 bytes from a 69,996,544-byte SQLite snapshot)
- Imported graph package totals: 817 files, 5,240 symbols, 30,337 edges
- Graph communities sampled: order repository, iOS load flows, access/cart clearing, auth/request helpers, address book, live-session tests, cart, and menu management communities.
- Validation DB: `/Users/sameer/Desktop/testing/.repolens/repolens-validation.db`
- Import-resolved dependency cycles: 0

Top language coverage:

| Language | Files | Lines | Symbols |
| --- | ---: | ---: | ---: |
| Swift | 212 | 42,029 | 2,627 |
| TypeScript | 404 | 40,663 | 1,472 |
| Markdown | 104 | 6,828 | 868 |
| SQL | 49 | 2,188 | 167 |
| JSON | 12 | 410 | 60 |
| Shell | 28 | 3,569 | 28 |
| JavaScript | 3 | 491 | 8 |

Graph schema:

| Kind / edge | Count |
| --- | ---: |
| Function nodes | 2,451 |
| File nodes | 816 |
| Heading nodes | 764 |
| Struct nodes | 348 |
| Class nodes | 205 |
| `CALLS` edges | 20,111 |
| `DEFINES` edges | 4,252 |
| `CALLS_LOCAL` edges | 3,163 |
| `IMPORTS` edges | 1,321 |
| `DECLARES` edges | 166 |
| `SIMILAR_TO` edges | 1,193 |
| `SEMANTICALLY_RELATED` edges | 118 |

Incremental refresh:

```bash
node --experimental-sqlite dist/src/cli.js index /Users/sameer/Desktop/testing \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --incremental
```

Confirmed a no-op incremental pass preserved 5,234 symbols and 30,324 edges while marking all 852 discovered files unchanged.

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
- 36 files skipped by size, binary, or ignore policy.
- 5 dead-code candidates sampled.

The review-signal counts are intentionally conservative; they are meant to route a human to candidate files rather than claim confirmed issues.

## Representative Tool Checks

Search:

```bash
node --experimental-sqlite dist/src/cli.js search "live session repository" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
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
node --experimental-sqlite dist/src/cli.js search-graph spring --kind dependency --db /tmp/repolens-manifest-smoke.db --limit 5
node --experimental-sqlite dist/src/cli.js search-graph tokio --kind dependency --db /tmp/repolens-manifest-smoke.db --limit 5
```

Confirmed npm, Python, Go, Cargo, Composer, Maven, Gradle, Dart, Elixir, Ruby, and requirements fixtures produce `package` and `dependency` nodes, including `fastapi`, `github.com/gin-gonic/gin`, `tokio`, `laravel/framework`, `org.springframework.boot:spring-boot-starter-web`, `com.squareup.okhttp3:okhttp`, `json_annotation`, `phoenix`, and `rack`.

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

Codex setup:

```bash
node --experimental-sqlite dist/src/cli.js doctor
node --experimental-sqlite dist/src/cli.js install-codex --dry-run --db .repolens/memory.db
```

Confirmed `doctor` detected the local `~/.codex/config.toml`, reported `repolensConfigured: true` on this machine, and `install-codex --dry-run` refused to replace the existing unmanaged `mcp_servers.repolens` entry without `--force`.

Symbol lookup:

```bash
node --experimental-sqlite dist/src/cli.js symbols repository \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed repository interfaces and exported domain types under `apps/web-admin/src/lib/server/repositories`.

Semantic search and similarity edges:

```bash
node --experimental-sqlite dist/src/cli.js semantic "live session repository" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 8

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:SIMILAR_TO]->(b) RETURN a.name,b.name,r.weight LIMIT 5" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:SEMANTICALLY_RELATED]->(b) RETURN a.name,b.name,r.weight LIMIT 5" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db
```

Confirmed concept search returned live-session domain symbols, `SIMILAR_TO` returned near-duplicate token-profile links, and `SEMANTICALLY_RELATED` returned cross-symbol semantic links.

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

Source snippets:

```bash
node --experimental-sqlite dist/src/cli.js snippet getCodeSnippet \
  --db .repolens/self.db \
  --context 2

node --experimental-sqlite dist/src/cli.js snippet makeSession \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --context 1

node --experimental-sqlite dist/src/cli.js snippet 'apps/web-admin/src/lib/server/repositories/live-session-repository.ts:40' \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --context 2
```

Confirmed symbol-based snippets, Swift snippets, and `path:line` snippets with highlighted line ranges.

Graph schema:

```bash
node --experimental-sqlite dist/src/cli.js schema \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db
```

Confirmed Swift, TypeScript, Markdown, SQL, JSON, shell, JavaScript, YAML, and unknown text coverage with node-label and edge-type counts.

Read-only graph query:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (f:Function) WHERE f.filePath CONTAINS 'live-session' RETURN f.name,f.filePath LIMIT 5" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db

node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:CALLS]->(b) WHERE b.name = 'makeSession' RETURN a.name,b.name,r.type LIMIT 5" \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db
```

Confirmed node and one-hop relationship queries with `WHERE`, `RETURN`, edge aliases, and `LIMIT` on the large validation database.

HTTP route-call links:

```bash
node --experimental-sqlite dist/src/cli.js query-graph \
  "MATCH (a)-[r:HTTP_CALLS]->(b:Route) RETURN a.name,b.name,r.type LIMIT 5" \
  --db .repolens/self.db
```

Confirmed `loadOrders -> GET /orders` and `submitOrder -> POST /orders` edges in the self-validation fixture graph.

Graph communities:

```bash
node --experimental-sqlite dist/src/cli.js communities \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 8 \
  --min-size 8
```

Confirmed weighted community detection on the large validation database. The largest sampled communities had actionable labels and representative symbols such as `APIOrderRepository`, `APIAddressBookRepository`, `makeSession`, `addItem`, and `listMenuItems`, with cohesion and boundary-edge counts.

Dependency cycles:

```bash
node --experimental-sqlite dist/src/cli.js cycles \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed no relative-import or workspace-package-import cross-cluster dependency cycles in the large validation database.

Architecture report:

```bash
node --experimental-sqlite dist/src/cli.js report \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --format html \
  --graph-limit 1000 \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-architecture-report.html
```

Confirmed HTML and Markdown reports with summary metrics, language tables, graph schema counts including semantic/similarity edges, hotspots, top symbols, architecture boundaries, dependency-cycle checks, recommendations, dead-code samples, review signals, and graph samples.

Structural graph search:

```bash
node --experimental-sqlite dist/src/cli.js search-graph live-session \
  --relationship CALLS \
  --min-degree 1 \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed live-session repository files and test helpers with graph degree metrics.

Dead-code candidates:

```bash
node --experimental-sqlite dist/src/cli.js dead-code \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 8
```

Confirmed non-exported Swift candidates with zero inbound call edges.

Graph export:

```bash
node --experimental-sqlite dist/src/cli.js export-graph \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 1000 \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-testing-graph.html
```

Confirmed 1,000 nodes and 1,000 edges in the exported HTML graph. A matching JSON artifact was written to `/Users/sameer/Desktop/testing/.repolens/repolens-testing-graph-1000.json`.

Graph package exchange:

```bash
node --experimental-sqlite dist/src/cli.js pack-graph \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-validation.rlgz \
  --label testing-validation

node --experimental-sqlite dist/src/cli.js unpack-graph \
  /Users/sameer/Desktop/testing/.repolens/repolens-validation.rlgz \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation-imported.db \
  --overwrite
```

Confirmed the package exporter created a checksummed `.rlgz` artifact and the importer restored a graph with 817 files, 5,240 symbols, and 30,337 edges.

Watch mode:

```bash
node --experimental-sqlite dist/src/cli.js watch /Users/sameer/Desktop/testing \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --interval-ms 250 \
  --runs 2
```

Confirmed two watch-mode incremental passes over the large validation database preserved 5,240 symbols and 30,337 edges. A concurrent package export and watch refresh also completed after adding SQLite connection-level busy timeouts.

Index lock:

```bash
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self-lock-check-2.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self-lock-check-2.db --max-file-bytes 750000 --incremental
```

Confirmed overlapping index writers on a fresh database no longer interleave; one run completed and the other returned a clear RepoLens index-lock message.

Dashboard routes:

```bash
node --experimental-sqlite dist/src/cli.js serve \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --port 9750

curl --fail http://127.0.0.1:9750/api/schema
curl --fail 'http://127.0.0.1:9750/api/communities?limit=2&minSize=4'
curl --fail 'http://127.0.0.1:9750/api/search-graph?q=live-session&relationship=CALLS&limit=3'
curl --fail 'http://127.0.0.1:9750/api/semantic?q=live%20session%20repository&limit=3'
curl --fail 'http://127.0.0.1:9750/api/query-graph?q=MATCH%20(f%3AFunction)%20WHERE%20f.filePath%20CONTAINS%20%27live-session%27%20RETURN%20f.name%2Cf.filePath%20LIMIT%203'
curl --fail 'http://127.0.0.1:9750/api/dead-code?limit=3'
curl --fail 'http://127.0.0.1:9750/api/cycles?limit=5'
curl --fail 'http://127.0.0.1:9750/api/snippet?id=makeSession&context=1'
curl --fail 'http://127.0.0.1:9750/api/report?format=markdown&graphLimit=50'
curl --fail http://127.0.0.1:9750/
```

Confirmed the dashboard served the validation database, returned graph-community rows, returned the 817-file / 5,240-symbol / 30,337-edge schema, returned live-session graph matches, returned semantic search rows, returned read-only graph query rows, returned Swift dead-code candidates, returned an empty import-resolved cycle list, returned a highlighted Swift snippet for `makeSession`, generated an 8,992-byte Markdown report response, and served the 19,109-byte HTML dashboard shell.

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
node --experimental-sqlite dist/src/cli.js changes /Users/sameer/Desktop/projects/repolens-mcp \
  --db .repolens/self.db \
  --limit 10
```

Confirmed modified files map back to indexed symbols and produced a medium risk classification for the current local change set.

## Conclusion

The project builds, tests, indexes itself, indexes a larger mixed Swift/TypeScript workspace, exports graph artifacts, packages and imports SQLite graph snapshots, serves a local graph dashboard, and exposes graph schema, structural search, semantic search, generated similarity/semantic edges, read-only graph queries, import-resolved dependency cycles, architecture recommendations, dead-code candidates, reports, watch-mode refresh, and git-change impact through CLI/MCP paths. It remains intentionally scoped and inspectable, with a clear path to deeper parsing through future tree-sitter adapters.
