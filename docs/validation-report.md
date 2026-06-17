# Validation Report

Date: 2026-06-17

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
- Node test suite passed: 2 tests, 0 failures.
- Covered decision persistence, repository indexing, symbol search, code search, architecture summary, and trace behavior on a fixture repository.

## Self Index

Command:

```bash
node --experimental-sqlite dist/src/cli.js index . --db .codebase-memory/self.db --max-file-bytes 750000
node --experimental-sqlite dist/src/cli.js architecture --db .codebase-memory/self.db
```

Result:

- Files discovered: 29
- Files indexed: 29
- Files skipped: 0
- Symbols: 149
- Edges: 331
- Elapsed: 38 ms
- Language mix: TypeScript, Markdown, JSON, YAML, unknown text files.
- Entrypoints detected: `package.json`, `server.json`, `src/cli.ts`, `src/dashboard/server.ts`, `src/index.ts`, `src/mcp/server.ts`.

## Big Repo Validation

Target: `/Users/sameer/Desktop/testing`

Command:

```bash
node --experimental-sqlite dist/src/cli.js index /Users/sameer/Desktop/testing \
  --db /Users/sameer/Desktop/testing/.codebase-memory/codebase-memory-mcp-validation.db \
  --max-file-bytes 750000

node --experimental-sqlite dist/src/cli.js architecture \
  --db /Users/sameer/Desktop/testing/.codebase-memory/codebase-memory-mcp-validation.db
```

Result:

- Files discovered: 854
- Files indexed: 604
- Files skipped: 250
- Symbols: 2,653
- Edges: 31,023
- Lines indexed: 54,301
- Elapsed: 2,324 ms

Top language coverage:

| Language | Files | Lines | Symbols |
| --- | ---: | ---: | ---: |
| TypeScript | 404 | 40,663 | 1,515 |
| Markdown | 104 | 6,828 | 868 |
| Shell | 28 | 3,569 | 28 |
| SQL | 49 | 2,188 | 167 |
| JavaScript | 3 | 491 | 11 |
| JSON | 12 | 410 | 60 |

Representative hotspots:

- `packages/backend-contracts/src/index.ts`
- `apps/web-admin/src/lib/server/repositories/live-session-repository.ts`
- `apps/web-admin/src/lib/server/repositories/order-repository.ts`
- `apps/web-admin/src/lib/server/repositories/courier-repository.ts`
- `apps/web-admin/src/lib/server/mux/live-streams.ts`

Representative entrypoints:

- `apps/web-admin/src/lib/integrations/supabase-server.ts`
- `package.json`
- `packages/backend-contracts/src/index.ts`
- `packages/shared-types/src/index.ts`
- `src/main.jsx`

Review signals:

- 81 task markers.
- 337 sensitive-key-like text matches to review.
- 250 files skipped by size, binary, or ignore policy.

The review-signal counts are intentionally conservative; they are meant to route a human to candidate files rather than claim confirmed issues.

## Representative Tool Checks

Search:

```bash
node --experimental-sqlite dist/src/cli.js search live-session \
  --db /Users/sameer/Desktop/testing/.codebase-memory/codebase-memory-mcp-validation.db \
  --limit 5
```

Confirmed matches across iOS docs, live-session API tests, and web-admin route files.

Symbol lookup:

```bash
node --experimental-sqlite dist/src/cli.js symbols repository \
  --db /Users/sameer/Desktop/testing/.codebase-memory/codebase-memory-mcp-validation.db \
  --limit 5
```

Confirmed repository interfaces and exported domain types under `apps/web-admin/src/lib/server/repositories`.

Trace:

```bash
node --experimental-sqlite dist/src/cli.js trace listOrders \
  --direction inbound \
  --db .codebase-memory/self.db \
  --depth 2
```

Confirmed inbound links from the fixture server file to the `listOrders` symbol.

## Conclusion

The project builds, tests, indexes itself, and indexes a larger local application workspace. The implementation is intentionally scoped and inspectable, with a clear path to deeper parsing through future tree-sitter adapters.
