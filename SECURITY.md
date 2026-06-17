# Security Policy

## Local-First Data Model

Codebase Memory MCP reads source files from repositories you explicitly index and stores derived metadata in a local SQLite database. It does not send repository content to a hosted service.

## Sensitive Files

The default walker ignores common generated, binary, dependency, cache, and `.codebase-memory` directories. You should still review results from:

```bash
codebase-memory-mcp architecture
codebase-memory-mcp search secret
codebase-memory-mcp search api_key
```

before committing any generated memory artifacts.

## Reporting

Open a private security advisory or contact the maintainer if you find a vulnerability involving secret exposure, unsafe file traversal, or MCP tool behavior.
