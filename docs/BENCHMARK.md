# Benchmark Evidence

This public benchmark summary is sanitized for package distribution. The full local validation log remains in the repository, while npm packages include only this path-neutral evidence document.

## Verification Suite

Command:

```bash
npm run verify
npm run test:skip-gate
```

Latest result:

- TypeScript build passed.
- Node test suite passed: 84 tests, 83 passing, 0 failures, 1 sandbox-only dashboard socket skip.
- Test skip gate passed with explicit policies for the dashboard sandbox socket skip and git-unavailable skips.
- Coverage includes indexing with byte and file-count budgets, project-specific `.repolens.json` language overrides, config-key/dependency/file-reference `CONFIGURES` links, opt-in JSONL diagnostics for index and watch lifecycles, broad practical language extraction, namespace/file-like import edge resolution, incremental refresh, bounded git-history hotspot collection, git-aware watch refresh, MCP startup auto-index and auto-sync wiring, MCP agent setup write guardrails, project catalog and fleet summaries, shareable fleet graph artifacts, graph package import/export, interactive graph report/export controls, code search, symbol/reference lookup, semantic and vector search, context packs, graph queries, dependency cycles, git-history hotspots, change impact, secret scanning, agent setup, Codex config safeguards, package bootstrap, installer metadata, and MCP JSON-RPC robustness.

## Package And Release Checks

Commands:

```bash
npm run audit:prod
npm run package:check
npm run installer:audit
npm sbom --sbom-format cyclonedx --json
GITHUB_REPOSITORY=sameer2191/repolens-mcp GH_TOKEN="<token>" npm run security:github
```

Current package hygiene:

- Production dependency audit reports 0 vulnerabilities.
- Package contents are limited to runtime `dist/src`, public docs, README, license/security/contributing files, `llms.txt`, scripts, server manifest, and installers.
- Compiled tests, TypeScript source, fixture data, stale compiled files without matching source, local graph memory, SQLite databases, graph packages, private validation output, and workstation paths are blocked from npm packages.
- Installer audit checks shipped shell and PowerShell installers, exercises dry-run Codex/agent setup with hook files under temporary home and target directories, and fails if dry runs write unexpected files.
- The release workflow verifies build/tests, explicit skip governance, installer audit, production audit, and package gates, generates a CycloneDX SBOM and SHA-256 checksums, creates build provenance attestations, uploads GitHub release assets, and publishes to npm with provenance.
- The release security gate checks actionable GitHub Security alerts across CodeQL, Dependabot, and secret scanning before publication and fails closed when required alert endpoints are unavailable.

## Large Workspace Benchmark

Command shape:

```bash
node --experimental-sqlite dist/src/cli.js benchmark /path/to/large-workspace \
  --db /path/to/large-workspace/.repolens/repolens-benchmark.db \
  --max-file-bytes 750000 \
  --label large-workspace-benchmark

node --experimental-sqlite dist/src/cli.js report \
  --db /path/to/large-workspace/.repolens/repolens-benchmark.db \
  --format html \
  --out /path/to/large-workspace/.repolens/repolens-benchmark-report.html

node --experimental-sqlite dist/src/cli.js export-graph \
  --db /path/to/large-workspace/.repolens/repolens-benchmark.db \
  --out /path/to/large-workspace/.repolens/repolens-benchmark-graph.html \
  --limit 1500
```

Latest large-workspace result:

- Files discovered: 853
- Files indexed: 818
- Files skipped: 35
- Symbols: 5,826
- Edges: 38,995
- Lines: 100,100
- Full index elapsed: 33,531 ms
- No-op incremental elapsed: 208 ms
- No-op incremental unchanged files: 853
- Full throughput: 24.40 files/s and 173.75 symbols/s
- No-op incremental throughput: 4,100.96 discovered files/s
- Redacted secret scan: 0 high-confidence and 0 medium-confidence findings across 61,746 indexed non-test lines.
- Interactive graph export: 1,500 nodes and 1,500 edges.
- Graph package import check restored 818 indexed files, 5,826 symbols, and 38,995 edges from the compressed graph snapshot.
