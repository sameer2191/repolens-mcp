# Third-Party Notices

RepoLens MCP is a local-first TypeScript project. Its npm package intentionally ships runtime JavaScript, public documentation, installers, and validation scripts; it does not vendor third-party source trees.

Direct runtime dependencies:

| Package | Use | License |
| --- | --- | --- |
| `@modelcontextprotocol/sdk` | MCP server protocol integration | MIT |
| `zod` | Runtime schema validation | MIT |

Direct development dependencies:

| Package | Use | License |
| --- | --- | --- |
| `@types/node` | Node.js type definitions | MIT |
| `fast-check` | Property-based tests | MIT |
| `typescript` | TypeScript compiler | Apache-2.0 |

Transitive dependency details are recorded in `package-lock.json`. Before publishing, maintainers should run:

```bash
npm audit --omit=dev
npm sbom --sbom-format cyclonedx --json
npm run package:check
```

Generated graph databases, graph exports, `.rlgz` graph packages, local validation workspaces, and private repository metadata are not third-party components and must not be published without manual review.

