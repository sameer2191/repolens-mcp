#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  architectureReport,
  benchmarkRepository,
  configGet,
  configList,
  configReset,
  configSet,
  contextPack,
  deleteDecision,
  deleteProject,
  detectChanges,
  fleetGraph,
  fleetSummary,
  findDeadCode,
  findCommunities,
  findDependencyCycles,
  findReferences,
  getArchitecture,
  getCodeSnippet,
  getGraphSchema,
  getProjectStatus,
  getVersionStatus,
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
  runWatch,
  scanSecrets,
  searchCode,
  searchGraph,
  semanticSearch,
  searchSymbols,
  traceSymbol,
  updateDecision,
  unpackGraph,
  vectorSearch
} from "./core/api.js";
import { agentProfiles, installAgentSetup, uninstallAgentSetup, type AgentId } from "./core/agents.js";
import type { ReportFormat } from "./core/report.js";
import type { TraceDirection, TraceMode } from "./core/types.js";
import { codexDoctor, installCodexConfig, uninstallCodexConfig } from "./core/codex.js";
import { defaultDbPath } from "./core/store.js";
import { serveDashboard } from "./dashboard/server.js";
import { startMcpServer } from "./mcp/server.js";

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Map<string, string | boolean>;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "index": {
      const root = path.resolve(args.positional[0] ?? process.cwd());
      const result = await runIndex({
        root,
        dbPath: stringFlag(args, "db"),
        incremental: args.flags.has("incremental") ? true : undefined,
        maxFileBytes: numberFlag(args, "max-file-bytes"),
        runLabel: stringFlag(args, "label"),
        bootstrapPackage: booleanFlag(args, "no-bootstrap") ? false : stringFlag(args, "bootstrap-package"),
        writePackage: writePackageFlag(args)
      });
      print(result);
      break;
    }
    case "version":
      print(await getVersionStatus({ checkRemote: booleanFlag(args, "check"), registryUrl: stringFlag(args, "registry"), timeoutMs: numberFlag(args, "timeout-ms") }));
      break;
    case "update-check":
    case "check-update":
      print(await getVersionStatus({ checkRemote: true, registryUrl: stringFlag(args, "registry"), timeoutMs: numberFlag(args, "timeout-ms") }));
      break;
    case "watch": {
      const root = path.resolve(args.positional[0] ?? process.cwd());
      const controller = new AbortController();
      process.once("SIGINT", () => controller.abort());
      process.once("SIGTERM", () => controller.abort());
      const summary = await runWatch({
        root,
        dbPath: stringFlag(args, "db"),
        intervalMs: numberFlag(args, "interval-ms"),
        maxRuns: numberFlag(args, "runs"),
        maxPolls: numberFlag(args, "polls"),
        gitAware: booleanFlag(args, "git-aware"),
        maxFileBytes: numberFlag(args, "max-file-bytes"),
        runLabel: stringFlag(args, "label"),
        signal: controller.signal,
        onResult: (result) => process.stderr.write(`${jsonBlock({ event: "indexed", ...result })}\n`),
        onSkip: (event) => process.stderr.write(`${jsonBlock({ event: "skipped", ...event })}\n`)
      });
      print(summary);
      break;
    }
    case "benchmark": {
      const root = path.resolve(args.positional[0] ?? process.cwd());
      print(
        await benchmarkRepository({
          root,
          dbPath: stringFlag(args, "db"),
          maxFileBytes: numberFlag(args, "max-file-bytes"),
          runLabel: stringFlag(args, "label"),
          bootstrapPackage: booleanFlag(args, "no-bootstrap") ? false : stringFlag(args, "bootstrap-package"),
          secretScan: booleanFlag(args, "no-secret-scan") ? false : undefined,
          secretScanLimit: numberFlag(args, "secret-limit")
        })
      );
      break;
    }
    case "list-projects":
    case "projects":
      print(await listProjects(numberFlag(args, "limit")));
      break;
    case "project-status":
    case "index-status":
      print(await getProjectStatus(args.positional[0] ?? stringFlag(args, "project")));
      break;
    case "delete-project":
      print(await deleteProject(required(args.positional[0] ?? stringFlag(args, "project"), "project"), booleanFlag(args, "delete-db")));
      break;
    case "fleet-summary":
    case "fleet":
      print(await fleetSummary(numberFlag(args, "limit")));
      break;
    case "fleet-graph":
    case "cross-repo":
      print(
        await fleetGraph({
          limit: numberFlag(args, "limit"),
          maxNodes: numberFlag(args, "max-nodes"),
          maxEdges: numberFlag(args, "max-edges")
        })
      );
      break;
    case "config":
      print(handleConfigCommand(args));
      break;
    case "architecture":
      print(getArchitecture(stringFlag(args, "db")));
      break;
    case "search":
      print({
        code: searchCode(required(args.positional[0], "query"), numberFlag(args, "limit"), stringFlag(args, "db")),
        symbols: searchSymbols(required(args.positional[0], "query"), undefined, numberFlag(args, "limit"), stringFlag(args, "db"))
      });
      break;
    case "scan-secrets":
    case "secrets":
      print(
        scanSecrets(
          {
            limit: numberFlag(args, "limit"),
            includeTests: booleanFlag(args, "include-tests"),
            minConfidence: secretConfidenceFlag(args)
          },
          stringFlag(args, "db")
        )
      );
      break;
    case "symbols":
      print(searchSymbols(required(args.positional[0], "query"), stringFlag(args, "kind"), numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "snippet":
      print(getCodeSnippet(required(args.positional[0], "symbol or path:line"), numberFlag(args, "context"), stringFlag(args, "db")));
      break;
    case "references":
    case "refs":
      print(findReferences(required(args.positional[0], "symbol"), numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "trace":
      print(
        traceSymbol(
          required(args.positional[0], "symbol"),
          traceDirectionFlag(args),
          numberFlag(args, "depth"),
          stringFlag(args, "db"),
          {
            mode: traceModeFlag(args),
            edgeTypes: commaListFlag(args, "edge-types"),
            includeTests: args.flags.has("include-tests") ? true : args.flags.has("exclude-tests") ? false : undefined,
            parameterName: stringFlag(args, "parameter")
          }
        )
      );
      break;
    case "impact":
      print(impactAnalysis(args.positional, numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "schema":
      print(getGraphSchema(stringFlag(args, "db")));
      break;
    case "communities":
      print(findCommunities(numberFlag(args, "limit"), numberFlag(args, "min-size"), stringFlag(args, "db")));
      break;
    case "search-graph":
      print(
        searchGraph(
          {
            query: args.positional[0],
            kind: stringFlag(args, "kind"),
            namePattern: stringFlag(args, "name-pattern"),
            filePattern: stringFlag(args, "file-pattern"),
            relationship: stringFlag(args, "relationship"),
            minDegree: numberFlag(args, "min-degree"),
            limit: numberFlag(args, "limit"),
            offset: numberFlag(args, "offset")
          },
          stringFlag(args, "db")
        )
      );
      break;
    case "semantic":
      print(semanticSearch(required(args.positional[0], "query"), numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "vector":
    case "vector-search":
      print(vectorSearch(required(args.positional[0], "query"), numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "context-pack":
      print(contextPack(required(args.positional[0], "query"), numberFlag(args, "limit"), numberFlag(args, "context"), stringFlag(args, "db")));
      break;
    case "query-graph":
      print(queryGraph(required(args.positional[0], "query"), numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "dead-code":
      print(findDeadCode(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "cycles":
      print(findDependencyCycles(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "ingest-traces":
      print(ingestTraces(await readTraceInput(required(args.positional[0] ?? stringFlag(args, "input"), "trace JSON or file")), stringFlag(args, "db")));
      break;
    case "changes":
      print(detectChanges(args.positional[0] ? path.resolve(args.positional[0]) : undefined, numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "decision": {
      const title = required(stringFlag(args, "title") ?? args.positional[0], "title");
      const body = required(stringFlag(args, "body") ?? args.positional.slice(1).join(" "), "body");
      print(
        rememberDecision(
          {
            title,
            body,
            status: decisionStatusFlag(args) ?? "accepted",
            tags: decisionTagsFlag(args) ?? []
          },
          stringFlag(args, "db")
        )
      );
      break;
    }
    case "decision-update":
    case "update-decision":
      print(updateDecision(requiredNumber(args.positional[0] ?? stringFlag(args, "id"), "decision id"), decisionPatch(args), stringFlag(args, "db")));
      break;
    case "decision-delete":
    case "delete-decision":
      print(deleteDecision(requiredNumber(args.positional[0] ?? stringFlag(args, "id"), "decision id"), stringFlag(args, "db")));
      break;
    case "decisions":
      print(listDecisions(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "graph":
      print(graphSnapshot(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "report": {
      const format = (stringFlag(args, "format") as ReportFormat | undefined) ?? (stringFlag(args, "out")?.endsWith(".html") ? "html" : "markdown");
      const body = architectureReport(
        {
          format,
          graphLimit: numberFlag(args, "graph-limit"),
          title: stringFlag(args, "title")
        },
        stringFlag(args, "db")
      );
      const out = stringFlag(args, "out");
      if (out) {
        const outPath = path.resolve(out);
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, body);
        print({ out: outPath, format });
      } else {
        process.stdout.write(body);
      }
      break;
    }
    case "export-graph": {
      const out = path.resolve(required(stringFlag(args, "out") ?? args.positional[0], "out"));
      const graph = graphSnapshot(numberFlag(args, "limit"), stringFlag(args, "db")) as {
        nodes: Array<{ id: string; label: string; group: string }>;
        edges: Array<{ source: string; target: string; type: string; weight?: number }>;
      };
      await fs.mkdir(path.dirname(out), { recursive: true });
      if (out.endsWith(".html")) {
        await fs.writeFile(out, staticGraphHtml(graph));
      } else {
        await fs.writeFile(out, JSON.stringify(graph, null, 2));
      }
      print({ out, nodes: graph.nodes.length, edges: graph.edges.length });
      break;
    }
    case "pack-graph":
      print(await packGraph(path.resolve(required(stringFlag(args, "out") ?? args.positional[0], "out")), stringFlag(args, "db"), stringFlag(args, "label")));
      break;
    case "unpack-graph":
      print(await unpackGraph(path.resolve(required(args.positional[0] ?? stringFlag(args, "package"), "package")), stringFlag(args, "db"), booleanFlag(args, "overwrite")));
      break;
    case "serve": {
      const port = numberFlag(args, "port") ?? 9749;
      const server = await serveDashboard({ dbPath: stringFlag(args, "db"), port });
      const address = server.address();
      const url = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : `http://127.0.0.1:${port}`;
      console.error(`Dashboard: ${url}`);
      break;
    }
    case "doctor":
      print(await codexDoctor(currentCliPath(), process.execPath, stringFlag(args, "config"), stringFlag(args, "name") ?? "repolens"));
      break;
    case "install-codex":
      print(
        await installCodexConfig({
          configPath: stringFlag(args, "config"),
          serverName: stringFlag(args, "name"),
          command: stringFlag(args, "command") ?? process.execPath,
          cliPath: stringFlag(args, "cli") ?? currentCliPath(),
          dbPath: stringFlag(args, "db"),
          dryRun: booleanFlag(args, "dry-run"),
          force: booleanFlag(args, "force")
        })
      );
      break;
    case "uninstall-codex":
      print(
        await uninstallCodexConfig({
          configPath: stringFlag(args, "config"),
          serverName: stringFlag(args, "name") ?? "repolens",
          dryRun: booleanFlag(args, "dry-run")
        })
      );
      break;
    case "agent-setup":
      print(
        await installAgentSetup({
          targetDir: stringFlag(args, "target") ?? process.cwd(),
          agents: agentList(stringFlag(args, "agents")),
          command: stringFlag(args, "command") ?? process.execPath,
          cliPath: stringFlag(args, "cli") ?? currentCliPath(),
          dbPath: stringFlag(args, "db"),
          serverName: stringFlag(args, "name") ?? "repolens",
          withHooks: booleanFlag(args, "with-hooks"),
          dryRun: true
        })
      );
      break;
    case "install-agents":
      print(
        await installAgentSetup({
          targetDir: stringFlag(args, "target") ?? process.cwd(),
          agents: agentList(stringFlag(args, "agents")),
          command: stringFlag(args, "command") ?? process.execPath,
          cliPath: stringFlag(args, "cli") ?? currentCliPath(),
          dbPath: stringFlag(args, "db"),
          serverName: stringFlag(args, "name") ?? "repolens",
          withHooks: booleanFlag(args, "with-hooks"),
          dryRun: booleanFlag(args, "dry-run")
        })
      );
      break;
    case "uninstall-agents":
      print(
        await uninstallAgentSetup({
          targetDir: stringFlag(args, "target") ?? process.cwd(),
          agents: agentList(stringFlag(args, "agents")),
          serverName: stringFlag(args, "name") ?? "repolens",
          withHooks: booleanFlag(args, "with-hooks"),
          dryRun: booleanFlag(args, "dry-run")
        })
      );
      break;
    case "mcp":
      await startMcpServer();
      break;
    case "demo": {
      const root = await createDemoRepo();
      const dbPath = defaultDbPath(root);
      const result = await runIndex({ root, dbPath });
      print({ ...result, try: [`repolens-mcp architecture --db ${dbPath}`, `repolens-mcp serve --db ${dbPath}`] });
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case "":
      process.stdout.write(help());
      break;
    default:
      throw new Error(`Unknown command '${args.command}'. Run repolens-mcp help.`);
  }
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "", ...rest] = argv;
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
    } else if (rest[index + 1] && !rest[index + 1].startsWith("--")) {
      flags.set(key, rest[index + 1]);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }
  return { command, positional, flags };
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function numberFlag(args: ParsedArgs, name: string): number | undefined {
  const value = stringFlag(args, name);
  return value ? Number(value) : undefined;
}

function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function writePackageFlag(args: ParsedArgs): string | undefined {
  const value = args.flags.get("write-package");
  if (value === true) {
    return ".repolens/graph.rlgz";
  }
  return typeof value === "string" ? value : undefined;
}

function commaListFlag(args: ParsedArgs, name: string): string[] | undefined {
  const value = stringFlag(args, name);
  return value?.split(",").map((item) => item.trim()).filter(Boolean);
}

function secretConfidenceFlag(args: ParsedArgs): "low" | "medium" | "high" | undefined {
  const value = stringFlag(args, "min-confidence");
  if (!value) {
    return undefined;
  }
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error("Invalid --min-confidence. Use one of: low, medium, high.");
}

function traceDirectionFlag(args: ParsedArgs): TraceDirection {
  const value = stringFlag(args, "direction") ?? "outbound";
  if (value === "inbound" || value === "outbound" || value === "both") {
    return value;
  }
  throw new Error("Invalid --direction. Use one of: inbound, outbound, both.");
}

function traceModeFlag(args: ParsedArgs): TraceMode | undefined {
  const value = stringFlag(args, "mode");
  if (!value) {
    return undefined;
  }
  if (value === "all" || value === "calls" || value === "data_flow" || value === "cross_service") {
    return value;
  }
  throw new Error("Invalid --mode. Use one of: all, calls, data_flow, cross_service.");
}

function decisionStatusFlag(args: ParsedArgs): "proposed" | "accepted" | "superseded" | undefined {
  const value = stringFlag(args, "status");
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "superseded") {
    return value;
  }
  throw new Error("Invalid --status. Use one of: proposed, accepted, superseded.");
}

function decisionTagsFlag(args: ParsedArgs): string[] | undefined {
  if (!args.flags.has("tags")) {
    return undefined;
  }
  return (stringFlag(args, "tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function decisionPatch(args: ParsedArgs): {
  title?: string;
  status?: "proposed" | "accepted" | "superseded";
  body?: string;
  tags?: string[];
} {
  const patch = {
    title: stringFlag(args, "title"),
    status: decisionStatusFlag(args),
    body: stringFlag(args, "body"),
    tags: decisionTagsFlag(args)
  };
  if (patch.title === undefined && patch.status === undefined && patch.body === undefined && patch.tags === undefined) {
    throw new Error("Missing decision update fields. Use --title, --status, --body, or --tags.");
  }
  return patch;
}

function agentList(value: string | undefined): AgentId[] | undefined {
  if (!value || value === "all") {
    return undefined;
  }
  const known = new Set(agentProfiles.map((profile) => profile.id));
  return value.split(",").map((item) => {
    const agent = item.trim() as AgentId;
    if (!known.has(agent)) {
      throw new Error(`Unknown agent '${item}'. Use one of: all, ${[...known].join(", ")}`);
    }
    return agent;
  });
}

function handleConfigCommand(args: ParsedArgs): unknown {
  const action = args.positional[0] ?? "list";
  const configPath = stringFlag(args, "config");
  if (action === "list") {
    return configList(configPath);
  }
  if (action === "path") {
    return configList(configPath).path;
  }
  if (action === "get") {
    return configGet(required(args.positional[1], "config key"), configPath);
  }
  if (action === "set") {
    return configSet(required(args.positional[1], "config key"), required(args.positional[2], "config value"), configPath);
  }
  if (action === "reset") {
    return configReset(args.positional[1], configPath);
  }
  throw new Error("Unknown config action. Use list, path, get, set, or reset.");
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required ${name}`);
  }
  return value;
}

function requiredNumber(value: string | undefined, name: string): number {
  const raw = required(value, name);
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: expected a positive integer`);
  }
  return parsed;
}

function print(value: unknown): void {
  process.stdout.write(`${jsonBlock(value)}\n`);
}

async function readTraceInput(input: string) {
  const raw = await fs.readFile(path.resolve(input), "utf8").catch(() => input);
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as { traces?: unknown }).traces)) {
    return (parsed as { traces: unknown[] }).traces;
  }
  throw new Error("Trace input must be a JSON array or an object with a traces array.");
}

function currentCliPath(): string {
  return path.resolve(process.argv[1] ?? "repolens-mcp");
}

async function createDemoRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repolens-demo-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "demo-service", dependencies: { express: "^5.0.0" } }, null, 2)
  );
  await fs.writeFile(
    path.join(root, "src", "server.ts"),
    `import express from "express";
const app = express();
export function health() { return { ok: true }; }
app.get("/health", (_req, res) => res.json(health()));
`
  );
  await fs.writeFile(path.join(root, "README.md"), "# Demo service\n\n## Architecture\n\nTiny Express API.\n");
  return root;
}

function help(): string {
  return `repolens-mcp

Usage:
  repolens-mcp index [repo] [--db path] [--max-file-bytes n] [--incremental] [--label name] [--bootstrap-package graph.rlgz] [--no-bootstrap] [--write-package [graph.rlgz]]
  repolens-mcp version [--check] [--registry url] [--timeout-ms n]
  repolens-mcp update-check [--registry url] [--timeout-ms n]
  repolens-mcp benchmark [repo] [--db path] [--max-file-bytes n] [--label name] [--bootstrap-package graph.rlgz] [--no-bootstrap] [--no-secret-scan] [--secret-limit n]
  repolens-mcp list-projects [--limit n]
  repolens-mcp project-status [root-or-db-or-label]
  repolens-mcp delete-project <root-or-db-or-label> [--delete-db]
  repolens-mcp fleet-summary [--limit n]
  repolens-mcp fleet-graph [--limit n] [--max-nodes n] [--max-edges n]
  repolens-mcp config list|get|set|reset|path [key] [value] [--config path]
  repolens-mcp architecture [--db path]
  repolens-mcp search <query> [--db path] [--limit n]
  repolens-mcp scan-secrets [--db path] [--limit n] [--min-confidence low|medium|high] [--include-tests]
  repolens-mcp symbols <query> [--kind function] [--db path]
  repolens-mcp snippet <symbol-or-path:line> [--context n] [--db path]
  repolens-mcp references <symbol> [--db path] [--limit n]
  repolens-mcp trace <symbol> [--direction inbound|outbound|both] [--mode all|calls|data_flow|cross_service] [--edge-types A,B] [--parameter name] [--include-tests|--exclude-tests] [--depth n] [--db path]
  repolens-mcp impact <path-or-symbol...> [--db path]
  repolens-mcp schema [--db path]
  repolens-mcp communities [--db path] [--limit n] [--min-size n]
  repolens-mcp watch [repo] [--db path] [--interval-ms n] [--runs n] [--polls n] [--git-aware] [--max-file-bytes n] [--label name]
  repolens-mcp search-graph [query] [--kind function] [--relationship CALLS] [--name-pattern wildcard] [--file-pattern src/] [--min-degree n] [--db path]
  repolens-mcp semantic "meaningful concept query" [--db path] [--limit n]
  repolens-mcp vector "meaningful concept query" [--db path] [--limit n]
  repolens-mcp context-pack "meaningful concept query" [--db path] [--limit n] [--context n]
  repolens-mcp query-graph "MATCH (a)-[:CALLS]->(b) RETURN a.name,b.name LIMIT 5" [--db path]
  repolens-mcp dead-code [--db path] [--limit n]
  repolens-mcp cycles [--db path] [--limit n]
  repolens-mcp ingest-traces traces.json [--db path]
  repolens-mcp changes [repo] [--db path] [--limit n]
  repolens-mcp decision --title "ADR title" --body "Decision body" [--tags a,b]
  repolens-mcp decision-update <id> [--title "New title"] [--status proposed|accepted|superseded] [--body "Updated body"] [--tags a,b] [--db path]
  repolens-mcp decision-delete <id> [--db path]
  repolens-mcp decisions [--db path]
  repolens-mcp graph [--db path]
  repolens-mcp report [--db path] [--format markdown|html] [--graph-limit n] [--out report.html]
  repolens-mcp export-graph --out graph.html [--db path] [--limit n]
  repolens-mcp pack-graph --out graph.rlgz [--db path] [--label name]
  repolens-mcp unpack-graph graph.rlgz [--db path] [--overwrite]
  repolens-mcp serve [--db path] [--port 9749]
  repolens-mcp doctor [--config ~/.codex/config.toml] [--name repolens]
  repolens-mcp install-codex [--db .repolens/memory.db] [--dry-run] [--force] [--config ~/.codex/config.toml]
  repolens-mcp uninstall-codex [--dry-run] [--config ~/.codex/config.toml]
  repolens-mcp agent-setup [--target .] [--agents all|codex,claude,gemini,zed,opencode,antigravity,aider,kilocode,vscode,openclaw,kiro] [--db .repolens/memory.db] [--with-hooks]
  repolens-mcp install-agents [--target .] [--agents all|codex,claude,gemini,zed,opencode,antigravity,aider,kilocode,vscode,openclaw,kiro] [--dry-run] [--with-hooks]
  repolens-mcp uninstall-agents [--target .] [--agents all|codex,claude,gemini,zed,opencode,antigravity,aider,kilocode,vscode,openclaw,kiro] [--dry-run] [--with-hooks]
  repolens-mcp mcp
  repolens-mcp demo
`;
}

function staticGraphHtml(graph: { nodes: Array<{ id: string; label: string; group: string }>; edges: Array<{ source: string; target: string; type: string; weight?: number }> }): string {
  const payload = JSON.stringify(graph).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RepoLens Graph</title>
  <style>
    :root { color-scheme: light; --bg:#f7f9fc; --ink:#172033; --muted:#667085; --line:#d5dce8; --panel:#fff; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; color:var(--ink); background:var(--bg); letter-spacing:0; }
    header { height:72px; display:flex; justify-content:space-between; align-items:center; gap:18px; padding:16px 22px; background:var(--panel); border-bottom:1px solid var(--line); }
    h1 { margin:0; font-size:20px; line-height:1.1; }
    .sub { color:var(--muted); font-size:13px; margin-top:4px; }
    main { display:grid; grid-template-columns: 1fr 320px; min-height:calc(100vh - 72px); }
    canvas { width:100%; height:calc(100vh - 72px); display:block; background:#fbfcff; }
    aside { border-left:1px solid var(--line); background:var(--panel); padding:16px; overflow:auto; }
    input { width:100%; border:1px solid var(--line); border-radius:8px; padding:10px 12px; font-size:14px; }
    .row { border-bottom:1px solid var(--line); padding:10px 0; }
    .label { font-weight:700; font-size:13px; overflow-wrap:anywhere; }
    .meta { color:var(--muted); font-size:12px; margin-top:3px; overflow-wrap:anywhere; }
    @media (max-width: 820px) { main { grid-template-columns:1fr; } aside { border-left:0; border-top:1px solid var(--line); } canvas { height:62vh; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>RepoLens Graph</h1>
      <div class="sub" id="counts"></div>
    </div>
    <div class="sub">self-contained artifact</div>
  </header>
  <main>
    <canvas id="graph"></canvas>
    <aside>
      <input id="filter" placeholder="Filter nodes">
      <div id="list"></div>
    </aside>
  </main>
  <script>
    const graph = ${payload};
    const canvas = document.querySelector('#graph');
    const ctx = canvas.getContext('2d');
    const filter = document.querySelector('#filter');
    const list = document.querySelector('#list');
    const counts = document.querySelector('#counts');
    const colors = ['#0f766e', '#7c3aed', '#2563eb', '#b45309', '#be123c', '#047857', '#475569', '#9333ea'];
    const groupColor = new Map();
    const nodes = graph.nodes.map((node, index) => ({ ...node, x: 120 + (index % 32) * 22, y: 100 + Math.floor(index / 32) * 22, vx: 0, vy: 0 }));
    const byId = new Map(nodes.map(node => [node.id, node]));
    const edges = graph.edges.map(edge => ({ ...edge, sourceNode: byId.get(edge.source), targetNode: byId.get(edge.target) })).filter(edge => edge.sourceNode && edge.targetNode);
    counts.textContent = nodes.length.toLocaleString() + ' nodes, ' + edges.length.toLocaleString() + ' edges';
    function color(group) {
      if (!groupColor.has(group)) groupColor.set(group, colors[groupColor.size % colors.length]);
      return groupColor.get(group);
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width * devicePixelRatio));
      canvas.height = Math.max(320, Math.floor(rect.height * devicePixelRatio));
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    function tick() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      for (const edge of edges) {
        const dx = edge.targetNode.x - edge.sourceNode.x;
        const dy = edge.targetNode.y - edge.sourceNode.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (dist - 90) * 0.0008;
        edge.sourceNode.vx += dx * force;
        edge.sourceNode.vy += dy * force;
        edge.targetNode.vx -= dx * force;
        edge.targetNode.vy -= dy * force;
      }
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < Math.min(nodes.length, i + 90); j += 1) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const dist = Math.max(8, Math.hypot(dx, dy));
          const force = 18 / (dist * dist);
          a.vx -= dx * force; a.vy -= dy * force;
          b.vx += dx * force; b.vy += dy * force;
        }
      }
      for (const node of nodes) {
        node.vx += (w / 2 - node.x) * 0.0008;
        node.vy += (h / 2 - node.y) * 0.0008;
        node.x = Math.min(w - 16, Math.max(16, node.x + node.vx));
        node.y = Math.min(h - 16, Math.max(16, node.y + node.vy));
        node.vx *= 0.84;
        node.vy *= 0.84;
      }
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.lineWidth = 0.75;
      ctx.strokeStyle = 'rgba(71, 85, 105, 0.16)';
      for (const edge of edges) {
        ctx.beginPath();
        ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y);
        ctx.lineTo(edge.targetNode.x, edge.targetNode.y);
        ctx.stroke();
      }
      for (const node of nodes) {
        ctx.fillStyle = color(node.group);
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.group === 'file' ? 3.2 : 4.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    function frame() {
      for (let i = 0; i < 2; i += 1) tick();
      draw();
      requestAnimationFrame(frame);
    }
    function renderList() {
      const q = filter.value.trim().toLowerCase();
      const visible = nodes.filter(node => !q || node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q)).slice(0, 80);
      list.innerHTML = visible.map(node => '<div class="row"><div class="label">' + escapeHtml(node.label) + '</div><div class="meta">' + escapeHtml(node.group + ' - ' + node.id) + '</div></div>').join('');
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    addEventListener('resize', () => { resize(); draw(); });
    filter.addEventListener('input', renderList);
    resize();
    renderList();
    frame();
  </script>
</body>
</html>`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
