# Contributing

## Local Setup

```bash
npm install
npm run verify
```

Node 24 or newer is required because the project uses native `node:sqlite`.

## Development Loop

```bash
npm run build
node --experimental-sqlite dist/src/cli.js index .
node --experimental-sqlite dist/src/cli.js architecture
```

## Pull Request Standard

- Add or update tests for extractor behavior.
- Keep MCP tools deterministic and local-first.
- Do not add network calls to indexing.
- Do not commit `.codebase-memory/` databases.
