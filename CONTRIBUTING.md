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

Avoid committing local `.repolens` databases, graph exports containing private source metadata, generated dependency folders, or fixture data from private repositories.

## Security-Sensitive Changes

Changes that touch indexing, import resolution, file walking, graph package import/export, dashboard APIs, secret scanning, install scripts, or GitHub workflows need extra review. Include the threat model in the pull request body and add regression coverage for traversal, unsafe deserialization, unredacted secret output, or workflow permission changes when applicable.

Report vulnerabilities through the process in [SECURITY.md](SECURITY.md), not public issues.
