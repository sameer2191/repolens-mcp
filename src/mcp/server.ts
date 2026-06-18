import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  architectureReport,
  detectChanges,
  findDeadCode,
  findDependencyCycles,
  getArchitecture,
  getCodeSnippet,
  getGraphSchema,
  graphSnapshot,
  impactAnalysis,
  jsonBlock,
  listDecisions,
  packGraph,
  queryGraph,
  rememberDecision,
  runIndex,
  searchCode,
  searchGraph,
  semanticSearch,
  searchSymbols,
  traceSymbol,
  unpackGraph
} from "../core/api.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "repolens-mcp",
    version: "1.0.0"
  });

  server.registerTool(
    "index_repository",
    {
      description: "Index a repository into the local SQLite RepoLens graph.",
      inputSchema: {
        root: z.string().optional().describe("Repository root. Defaults to current working directory."),
        dbPath: z.string().optional().describe("Optional SQLite database path."),
        incremental: z.boolean().optional().describe("Skip unchanged files and prune removed files using existing SQLite metadata."),
        maxFileBytes: z.number().int().positive().optional().describe("Skip files larger than this size.")
      }
    },
    async ({ root, dbPath, incremental, maxFileBytes }) => text(await runIndex({ root: root ?? process.cwd(), dbPath, incremental, maxFileBytes }))
  );

  server.registerTool(
    "export_graph_package",
    {
      description: "Create a compressed, checksummed RepoLens graph package from a local SQLite graph database.",
      inputSchema: {
        outPath: z.string().describe("Destination path for the .rlgz graph package."),
        dbPath: z.string().optional(),
        label: z.string().optional()
      }
    },
    async ({ outPath, dbPath, label }) => text(await packGraph(outPath, dbPath, label))
  );

  server.registerTool(
    "import_graph_package",
    {
      description: "Import a compressed RepoLens graph package into a local SQLite graph database.",
      inputSchema: {
        packagePath: z.string().describe("Path to a .rlgz graph package."),
        dbPath: z.string().optional(),
        overwrite: z.boolean().optional()
      }
    },
    async ({ packagePath, dbPath, overwrite }) => text(await unpackGraph(packagePath, dbPath, overwrite))
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
    "get_code_snippet",
    {
      description: "Return source lines around a symbol, qualified name, file path, or path:line target.",
      inputSchema: {
        identifier: z.string().describe("Symbol name, qualified symbol name, file path, or file path with :line suffix."),
        context: z.number().int().nonnegative().max(40).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ identifier, context, dbPath }) => text(getCodeSnippet(identifier, context, dbPath))
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
    "get_graph_schema",
    {
      description: "Summarize indexed graph node labels, edge types, languages, and totals.",
      inputSchema: {
        dbPath: z.string().optional()
      }
    },
    async ({ dbPath }) => text(getGraphSchema(dbPath))
  );

  server.registerTool(
    "search_graph",
    {
      description: "Search the indexed graph structurally by name, kind, relationship, file scope, regex pattern, or degree.",
      inputSchema: {
        query: z.string().optional(),
        kind: z.string().optional(),
        namePattern: z.string().optional(),
        filePattern: z.string().optional(),
        relationship: z.string().optional(),
        minDegree: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ dbPath, ...options }) => text(searchGraph(options, dbPath))
  );

  server.registerTool(
    "semantic_search",
    {
      description: "Search indexed symbols by local semantic token overlap across names, paths, signatures, and symbol bodies.",
      inputSchema: {
        query: z.union([z.string(), z.array(z.string())]).describe("Concept query, for example ['live', 'session', 'repository']."),
        limit: z.number().int().positive().max(100).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ query, limit, dbPath }) => text(semanticSearch(query, limit, dbPath))
  );

  server.registerTool(
    "query_graph",
    {
      description: "Execute a read-only Cypher-like graph query over indexed symbols and edges. Supports MATCH node and one-hop edge patterns with simple WHERE and RETURN clauses.",
      inputSchema: {
        query: z.string().describe("Example: MATCH (a:Function)-[:CALLS]->(b) WHERE a.name = 'main' RETURN a.name,b.name LIMIT 10"),
        limit: z.number().int().positive().max(500).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ query, limit, dbPath }) => text(queryGraph(query, limit, dbPath))
  );

  server.registerTool(
    "find_dead_code",
    {
      description: "Find non-exported functions and methods with no inbound call edges.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ limit, dbPath }) => text(findDeadCode(limit, dbPath))
  );

  server.registerTool(
    "find_dependency_cycles",
    {
      description: "Find cross-cluster dependency cycles and sample edges to guide architecture refactors.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ limit, dbPath }) => text(findDependencyCycles(limit, dbPath))
  );

  server.registerTool(
    "detect_changes",
    {
      description: "Map uncommitted git changes to indexed graph impact with a simple risk classification.",
      inputSchema: {
        root: z.string().optional(),
        limit: z.number().int().positive().max(500).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ root, limit, dbPath }) => text(detectChanges(root, limit, dbPath))
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

  server.registerTool(
    "architecture_report",
    {
      description: "Generate a self-contained architecture report from the indexed graph as markdown or HTML.",
      inputSchema: {
        format: z.enum(["markdown", "html"]).default("markdown"),
        graphLimit: z.number().int().positive().max(1000).optional(),
        title: z.string().optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ format, graphLimit, title, dbPath }) => text(architectureReport({ format, graphLimit, title }, dbPath))
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
