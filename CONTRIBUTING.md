# Contributing

RepoLens MCP is a local-first repository intelligence tool. Contributions should keep the graph model reviewable, deterministic, and safe for private codebases.

## Development

Use Node.js 24 or newer.

```bash
npm ci
npm run build
npm test
npm run verify
```

Run focused tests while developing, then run `npm run verify` before opening a pull request.

## Pull Requests

Pull requests should include:

- A clear problem statement.
- Tests or a validation note for behavior changes.
- Documentation updates for new CLI flags, MCP tools, graph fields, or security behavior.
- Screenshots or generated report paths when dashboard or report output changes.
- `npm run package:check` when package contents, shipped docs, install files, or release behavior changes.

Avoid committing local `.repolens` databases, graph exports containing private source metadata, generated dependency folders, or fixture data from private repositories.

Use pull requests for changes that affect published behavior. The protected `main` branch is expected to keep `verify` and CodeQL `Analyze` green before merge.

## Commit Sign-Offs

Substantial code, workflow, release, or documentation changes should include a Developer Certificate of Origin sign-off. See [DCO.md](DCO.md).

```bash
git commit -s
```

## Security-Sensitive Changes

Changes that touch indexing, import resolution, file walking, graph package import/export, dashboard APIs, secret scanning, install scripts, or GitHub workflows need extra review. Include the threat model in the pull request body and add regression coverage for traversal, unsafe deserialization, unredacted secret output, or workflow permission changes when applicable.

Report vulnerabilities through the process in [SECURITY.md](SECURITY.md), not public issues.

## Package Boundary

The npm package is intentionally limited to runtime JavaScript, user-facing docs, governance notices, the server manifest, the installer, and license/security files. Before publishing or changing the `files` list, run:

```bash
npm run build
npm run package:check
npm run audit:prod
```

The package contents gate fails if local graph memory, SQLite databases, graph packages, private fixture folders, source TypeScript, or test output would be published.

## GitHub Security Checks

Maintainers with repository access can run:

```bash
GITHUB_REPOSITORY=sameer2191/repolens-mcp GH_TOKEN="$(gh auth token)" npm run security:github
```

Use this before release or security-sensitive pull requests to distinguish actionable CodeQL, Dependabot, and secret-scanning alerts from OpenSSF Scorecard process signals.
