import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  architectureReport,
  contextPack,
  deleteProject,
  detectChanges,
  fleetGraph,
  fleetSummary,
  findDeadCode,
  findCommunities,
  findDependencyCycles,
  getArchitecture,
  getCodeSnippet,
  getGraphSchema,
  getProjectStatus,
  graphSnapshot,
  impactAnalysis,
  ingestTraces,
  jsonBlock,
  listProjects,
  listDecisions,
  packGraph,
  queryGraph,
  rememberDecision,
  runIndex,
  scanSecrets,
  searchCode,
  searchGraph,
  semanticSearch,
  searchSymbols,
  traceSymbol,
  unpackGraph
} from "../core/api.js";
import { agentProfiles, installAgentSetup, type AgentId } from "../core/agents.js";
import type { IndexResult } from "../core/types.js";

export async function startMcpServer(): Promise<void> {
  await maybeAutoIndexOnStartup().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`RepoLens auto-index failed: ${message}\n`);
  });

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
    "list_projects",
    {
      description: "List repositories indexed through RepoLens on this machine, with latest counts and database status.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional()
      }
    },
    async ({ limit }) => text(await listProjects(limit))
  );

  server.registerTool(
    "index_status",
    {
      description: "Return the latest indexed status for a repository root, database path, label, or the most recent project.",
      inputSchema: {
        identifier: z.string().optional().describe("Repository root, database path, run label, or project folder name.")
      }
    },
    async ({ identifier }) => text(await getProjectStatus(identifier))
  );

  server.registerTool(
    "delete_project",
    {
      description: "Remove a project from the local RepoLens catalog. Optionally deletes safe .repolens SQLite graph files.",
      inputSchema: {
        identifier: z.string().describe("Repository root, database path, run label, or project folder name."),
        deleteDb: z.boolean().optional().describe("Also delete the project's .repolens SQLite database and sidecar files when the path is safe.")
      }
    },
    async ({ identifier, deleteDb }) => text(await deleteProject(identifier, deleteDb))
  );

  server.registerTool(
    "fleet_summary",
    {
      description: "Summarize all indexed RepoLens projects across the local catalog, including aggregate languages, routes, HTTP calls, inferred service links, packages, shared dependencies, and route overlaps.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional()
      }
    },
    async ({ limit }) => text(await fleetSummary(limit))
  );

  server.registerTool(
    "cross_repo_graph",
    {
      description: "Build a catalog-wide graph across indexed repositories, including shared dependencies, overlapping routes, and inferred cross-repo HTTP caller/provider edges.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional().describe("Maximum indexed projects to include from the local catalog."),
        maxNodes: z.number().int().positive().max(5000).optional().describe("Maximum nodes to return."),
        maxEdges: z.number().int().positive().max(10000).optional().describe("Maximum edges to return.")
      }
    },
    async ({ limit, maxNodes, maxEdges }) => text(await fleetGraph({ limit, maxNodes, maxEdges }))
  );

  server.registerTool(
    "agent_setup",
    {
      description: "Render or write project-local RepoLens MCP setup guidance for Codex, Claude, Gemini, Zed, OpenCode, Antigravity, Aider, KiloCode, VS Code, OpenClaw, and Kiro.",
      inputSchema: {
        targetDir: z.string().optional().describe("Project directory where setup guidance should be generated. Defaults to current working directory."),
        agents: z.array(z.enum(agentProfiles.map((profile) => profile.id) as [AgentId, ...AgentId[]])).optional().describe("Agent ids to include. Defaults to all supported agents."),
        dbPath: z.string().optional().describe("Recommended RepoLens database path in generated instructions."),
        serverName: z.string().optional().describe("MCP server name to use in snippets."),
        write: z.boolean().optional().describe("Actually write files when true. Defaults to false/dry-run.")
      }
    },
    async ({ targetDir, agents, dbPath, serverName, write }) =>
      text(
        await installAgentSetup({
          targetDir: targetDir ?? process.cwd(),
          agents,
          command: process.execPath,
          cliPath: currentCliPath(),
          dbPath,
          serverName,
          dryRun: !write
        })
      )
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
    "scan_secrets",
    {
      description: "Scan indexed source and config lines for redacted secret, token, credential, and sensitive environment patterns.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        includeTests: z.boolean().optional().describe("Include test, spec, fixture, and mock paths. Defaults to false."),
        minConfidence: z.enum(["low", "medium", "high"]).optional().describe("Minimum confidence to return. Defaults to low."),
        dbPath: z.string().optional()
      }
    },
    async ({ limit, includeTests, minConfidence, dbPath }) => text(scanSecrets({ limit, includeTests, minConfidence }, dbPath))
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
    "find_communities",
    {
      description: "Detect graph communities from weighted code relationships and return representative symbols, files, languages, cohesion, and boundary counts.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        minMembers: z.number().int().positive().max(200).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ limit, minMembers, dbPath }) => text(findCommunities(limit, minMembers, dbPath))
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
    "context_pack",
    {
      description: "Collect semantic matches, structural graph matches, code hits, snippets, and nearby edges for a development question.",
      inputSchema: {
        query: z.string(),
        limit: z.number().int().positive().max(20).optional(),
        context: z.number().int().nonnegative().max(12).optional(),
        dbPath: z.string().optional()
      }
    },
    async ({ query, limit, context, dbPath }) => text(contextPack(query, limit, context, dbPath))
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
    "ingest_traces",
    {
      description: "Ingest observed runtime HTTP, event, or symbol edges into the graph as OBSERVED_* relationships.",
      inputSchema: {
        traces: z.array(
          z.object({
            source: z.string().optional(),
            sourceFile: z.string().optional(),
            target: z.string().optional(),
            targetFile: z.string().optional(),
            type: z.enum(["http", "event", "edge"]).optional(),
            method: z.string().optional(),
            path: z.string().optional(),
            channel: z.string().optional(),
            direction: z.enum(["emit", "listen"]).optional(),
            edgeType: z.string().optional(),
            count: z.number().positive().optional(),
            observedAt: z.string().optional(),
            metadata: z.record(z.string(), z.unknown()).optional()
          })
        ),
        dbPath: z.string().optional()
      }
    },
    async ({ traces, dbPath }) => text(ingestTraces(traces, dbPath))
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

export async function maybeAutoIndexOnStartup(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Promise<IndexResult | undefined> {
  const mode = parseAutoIndexMode(env.REPOLENS_AUTO_INDEX);
  if (!mode) {
    return undefined;
  }
  const root = path.resolve(cwd, env.REPOLENS_ROOT ?? ".");
  const result = await runIndex({
    root,
    dbPath: env.REPOLENS_DB,
    incremental: mode.incremental,
    maxFileBytes: parsePositiveIntEnv(env.REPOLENS_MAX_FILE_BYTES, "REPOLENS_MAX_FILE_BYTES"),
    runLabel: env.REPOLENS_AUTO_INDEX_LABEL ?? "mcp-startup"
  });
  process.stderr.write(
    `RepoLens auto-index: ${result.mode} ${result.filesIndexed}/${result.filesDiscovered} files, ${result.symbols} symbols, ${result.edges} edges\n`
  );
  return result;
}

function parseAutoIndexMode(value: string | undefined): { incremental: boolean } | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no") {
    return undefined;
  }
  if (normalized === "full") {
    return { incremental: false };
  }
  if (normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "incremental") {
    return { incremental: true };
  }
  throw new Error("Invalid REPOLENS_AUTO_INDEX. Use 1, true, incremental, full, or 0.");
}

function parsePositiveIntEnv(value: string | undefined, name: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
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

function currentCliPath(): string {
  return process.argv[1] ?? "repolens-mcp";
}
