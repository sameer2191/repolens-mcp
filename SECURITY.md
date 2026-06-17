# Security Policy

## Local-First Data Model

RepoLens MCP reads source files from repositories you explicitly index and stores derived metadata in a local SQLite database. It does not send repository content to a hosted service.

## Sensitive Files

The default walker ignores common generated, binary, dependency, cache, and `.repolens` directories. You should still review results from:

```bash
repolens-mcp architecture
repolens-mcp search secret
repolens-mcp search api_key
```

before committing any generated memory artifacts.

## Reporting

Open a private security advisory or contact the maintainer if you find a vulnerability involving secret exposure, unsafe file traversal, or MCP tool behavior.
