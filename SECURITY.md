# Security Policy

## Supported Versions

The `main` branch and the latest GitHub release receive security fixes. Older prerelease snapshots, local generated graph packages, and fixture repositories are not supported.

## Local-First Data Model

RepoLens MCP reads source files from repositories you explicitly index and stores derived metadata in a local SQLite database. It does not send repository content to a hosted service.

RepoLens is designed to run as a local MCP tool. Treat any generated database, graph export, context pack, or dashboard artifact as derived source-code metadata, and do not publish those artifacts until they have been reviewed for secrets and private business logic.

## Sensitive Files

The default walker ignores common generated, binary, dependency, cache, and `.repolens` directories. You should still review results from:

```bash
repolens-mcp architecture
repolens-mcp search secret
repolens-mcp search api_key
```

before committing any generated memory artifacts.

## Published Package Boundary

The npm package is restricted to runtime JavaScript, public documentation, the server manifest, installer, license, contribution guide, and security policy. The CI package gate checks the dry-run tarball and blocks local graph artifacts such as `.repolens/`, SQLite database files, WAL/shm sidecars, graph packages, and legacy local memory folders.

Run this before publishing or reviewing release-file changes:

```bash
npm run build
npm run package:check
npm run audit:prod
```

Release publishing also runs dependency audit and CodeQL alert gates before package creation. Tag releases publish npm provenance from a separate privileged job and fail if `NPM_TOKEN` is missing.

Tag releases attach keyless Sigstore bundles for the npm tarball, CycloneDX SBOM, and checksum manifest. After downloading a release asset and its matching `.sigstore.json` bundle, verify the bundle with:

```bash
cosign verify-blob repolens-mcp-<version>.tgz \
  --bundle repolens-mcp-<version>.tgz.sigstore.json \
  --certificate-identity-regexp "https://github.com/sameer2191/repolens-mcp/.github/workflows/release.yml@refs/tags/v.*" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## GitHub Security Summary

Maintainers can summarize the live GitHub Security tab state with:

```bash
GITHUB_REPOSITORY=sameer2191/repolens-mcp GH_TOKEN="$(gh auth token)" npm run security:github
```

Use `-- --format json` for automation or `-- --fail-on-actionable` to exit non-zero when CodeQL, Dependabot, or secret-scanning alerts are open. OpenSSF Scorecard alerts are reported separately as process signals so they are visible without being confused with code vulnerabilities.

## Reporting A Vulnerability

Use GitHub's private vulnerability reporting for this repository when available:

https://github.com/sameer2191/repolens-mcp/security/advisories/new

You can also review the published policy at:

https://github.com/sameer2191/repolens-mcp/security/policy

If the private reporting flow is unavailable, open a private security advisory from the Security tab. Do not file public issues for suspected vulnerabilities until disclosure is coordinated.

Please include:

- Affected version or commit SHA.
- Operating system and Node.js version.
- Whether the issue affects indexing, graph export, MCP tool responses, generated artifacts, or installation.
- A minimal reproduction using a public fixture or redacted repository layout.
- Any evidence of secret exposure, unsafe path traversal, command execution, or unauthorized file reads.

## Response Targets

Expected maintainer response targets:

- Acknowledge new reports within 72 hours.
- Triage severity and reproducibility within 7 days.
- Publish fixes or mitigations for confirmed high-impact issues as soon as practical.
- Request a CVE or GitHub Security Advisory when the issue affects released packages or published artifacts.

## Scope

In scope:

- Secret exposure through indexing, search, context packs, dashboards, graph exports, or MCP resources.
- Path traversal or symlink behavior that reads files outside the selected repository root.
- Unsafe handling of runtime traces, package manifests, Docker/Kubernetes files, or generated memory artifacts.
- Installation, release, or CI workflow behavior that could compromise published packages or artifacts.

Out of scope:

- Findings that require indexing repositories you do not have permission to inspect.
- Vulnerabilities in third-party dependencies unless RepoLens uses them in a way that creates an additional exploit path.
- Denial-of-service reports based only on intentionally indexing very large generated folders without an ignore rule.
