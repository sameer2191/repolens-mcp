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
- Node test suite passed: 3 tests, 0 failures.
- Covered decision persistence, repository indexing, incremental refresh, removed-file pruning, Swift extraction, symbol search, code search, graph schema, structural graph search, dead-code candidates, architecture summary, and trace behavior on a fixture repository.

## Self Index

Command:

```bash
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js index . --db .repolens/self.db --max-file-bytes 750000 --incremental
node --experimental-sqlite dist/src/cli.js architecture --db .repolens/self.db
```

Result:

- Files discovered: 31
- Files indexed: 31
- Files skipped: 0
- Symbols: 181
- Edges: 421
- Full index elapsed: 106 ms
- No-op incremental elapsed: 15 ms
- No-op incremental unchanged files: 31
- Language mix: TypeScript, Markdown, JSON, YAML, Swift fixture, and unknown text files.
- Entrypoints detected: `package.json`, `server.json`, `src/cli.ts`, `src/dashboard/server.ts`, `src/index.ts`, `src/mcp/server.ts`, and fixture server files.

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

node --experimental-sqlite dist/src/cli.js export-graph \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 1000 \
  --out /Users/sameer/Desktop/testing/.repolens/repolens-testing-graph.html
```

Result:

- Files discovered: 852
- Files indexed: 816
- Files skipped: 36
- Symbols: 5,234
- Edges: 29,013
- Lines indexed: 96,330
- Full index elapsed: 10,531 ms
- No-op incremental elapsed: 254 ms
- No-op incremental unchanged files: 852
- No-op incremental removed files: 0
- Graph export: `/Users/sameer/Desktop/testing/.repolens/repolens-testing-graph.html`
- Graph JSON: `/Users/sameer/Desktop/testing/.repolens/repolens-testing-graph-1000.json`
- Validation DB: `/Users/sameer/Desktop/testing/.repolens/repolens-validation.db`

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

Incremental refresh:

```bash
node --experimental-sqlite dist/src/cli.js index /Users/sameer/Desktop/testing \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --max-file-bytes 750000 \
  --incremental
```

Confirmed a no-op incremental pass preserved 5,234 symbols and 29,013 edges while marking all 852 discovered files unchanged.

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
node --experimental-sqlite dist/src/cli.js search live-session \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed matches across iOS docs, live-session API tests, and web-admin route files.

Symbol lookup:

```bash
node --experimental-sqlite dist/src/cli.js symbols repository \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db \
  --limit 5
```

Confirmed repository interfaces and exported domain types under `apps/web-admin/src/lib/server/repositories`.

Graph schema:

```bash
node --experimental-sqlite dist/src/cli.js schema \
  --db /Users/sameer/Desktop/testing/.repolens/repolens-validation.db
```

Confirmed Swift, TypeScript, Markdown, SQL, JSON, shell, JavaScript, YAML, and unknown text coverage with node-label and edge-type counts.

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

The project builds, tests, indexes itself, indexes a larger mixed Swift/TypeScript workspace, exports graph artifacts, and exposes graph schema, structural search, dead-code candidates, and git-change impact through CLI/MCP paths. It remains intentionally scoped and inspectable, with a clear path to deeper parsing through future tree-sitter adapters.
