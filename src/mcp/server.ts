import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getArchitecture,
  graphSnapshot,
  impactAnalysis,
  jsonBlock,
  listDecisions,
  rememberDecision,
  runIndex,
  searchCode,
  searchSymbols,
  traceSymbol
} from "../core/api.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "codebase-memory-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "index_repository",
    {
      description: "Index a repository into the local SQLite codebase memory.",
      inputSchema: {
        root: z.string().optional().describe("Repository root. Defaults to current working directory."),
        dbPath: z.string().optional().describe("Optional SQLite database path."),
        maxFileBytes: z.number().int().positive().optional().describe("Skip files larger than this size.")
      }
    },
    async ({ root, dbPath, maxFileBytes }) => text(await runIndex({ root: root ?? process.cwd(), dbPath, maxFileBytes }))
  );

  server.registerTool(
    "search_code",
    {
      description: "Search indexed source lines.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(100).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ query, limit, dbPath }) => text(searchCode(query, limit, dbPath))
  );

  server.registerTool(
    "search_symbols",
    {
      description: "Search indexed functions, classes, routes, resources, headings, and package nodes.",
      inputSchema: {
        query: z.string(),
        kind: z.string().optional(),
        limit: z.number().int().positive().max(100).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ query, kind, limit, dbPath }) => text(searchSymbols(query, kind, limit, dbPath))
  );

  server.registerTool(
    "get_architecture",
    {
      description: "Return architecture totals, languages, hotspots, entrypoints, packages, and risk markers.",
      inputSchema: {
        dbPath: z.string().optional()
      }
    },
    async ({ dbPath }) => text(getArchitecture(dbPath))
  );

  server.registerTool(
    "trace_symbol",
    {
      description: "Trace inbound or outbound graph edges for a symbol.",
      inputSchema: {
        name: z.string(),
        direction: z.enum(["inbound", "outbound"]).default("outbound"),
        depth: z.number().int().positive().max(5).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ name, direction, depth, dbPath }) => text(traceSymbol(name, direction, depth, dbPath))
  );

  server.registerTool(
    "impact_analysis",
    {
      description: "Find symbols adjacent to changed file paths or symbol names.",
      inputSchema: {
        items: z.array(z.string()).min(1),
        limit: z.number().int().positive().max(100).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ items, limit, dbPath }) => text(impactAnalysis(items, limit, dbPath))
  );

  server.registerTool(
    "remember_decision",
    {
      description: "Persist an architecture decision record in the local memory database.",
      inputSchema: {
        title: z.string(),
        status: z.enum(["proposed", "accepted", "superseded"]).default("accepted"),
        body: z.string(),
        tags: z.array(z.string()).default([]),
        dbPath: z.string().optional()
      }
    },
    async ({ title, status, body, tags, dbPath }) => text(rememberDecision({ title, status, body, tags }, dbPath))
  );

  server.registerTool(
    "list_decisions",
    {
      description: "List persisted architecture decision records.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ limit, dbPath }) => text(listDecisions(limit, dbPath))
  );

  server.registerTool(
    "graph_snapshot",
    {
      description: "Export a compact graph snapshot for dashboards or reviews.",
      inputSchema: {
        limit: z.number().int().positive().max(1000).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ limit, dbPath }) => text(graphSnapshot(limit, dbPath))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function text(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: jsonBlock(value)
      }
    ]
  };
}
