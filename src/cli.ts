#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getArchitecture, graphSnapshot, impactAnalysis, jsonBlock, listDecisions, rememberDecision, runIndex, searchCode, searchSymbols, traceSymbol } from "./core/api.js";
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
        maxFileBytes: numberFlag(args, "max-file-bytes")
      });
      print(result);
      break;
    }
    case "architecture":
      print(getArchitecture(stringFlag(args, "db")));
      break;
    case "search":
      print({
        code: searchCode(required(args.positional[0], "query"), numberFlag(args, "limit"), stringFlag(args, "db")),
        symbols: searchSymbols(required(args.positional[0], "query"), undefined, numberFlag(args, "limit"), stringFlag(args, "db"))
      });
      break;
    case "symbols":
      print(searchSymbols(required(args.positional[0], "query"), stringFlag(args, "kind"), numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "trace":
      print(
        traceSymbol(
          required(args.positional[0], "symbol"),
          (stringFlag(args, "direction") as "inbound" | "outbound" | undefined) ?? "outbound",
          numberFlag(args, "depth"),
          stringFlag(args, "db")
        )
      );
      break;
    case "impact":
      print(impactAnalysis(args.positional, numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "decision": {
      const title = required(stringFlag(args, "title") ?? args.positional[0], "title");
      const body = required(stringFlag(args, "body") ?? args.positional.slice(1).join(" "), "body");
      print(
        rememberDecision(
          {
            title,
            body,
            status: (stringFlag(args, "status") as "proposed" | "accepted" | "superseded" | undefined) ?? "accepted",
            tags: (stringFlag(args, "tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean)
          },
          stringFlag(args, "db")
        )
      );
      break;
    }
    case "decisions":
      print(listDecisions(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "graph":
      print(graphSnapshot(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "serve": {
      const port = numberFlag(args, "port") ?? 9749;
      const server = await serveDashboard({ dbPath: stringFlag(args, "db"), port });
      const address = server.address();
      const url = typeof address === "object" && address ? `http://127.0.0.1:${address.port}` : `http://127.0.0.1:${port}`;
      console.error(`Dashboard: ${url}`);
      break;
    }
    case "mcp":
      await startMcpServer();
      break;
    case "demo": {
      const root = await createDemoRepo();
      const dbPath = defaultDbPath(root);
      const result = await runIndex({ root, dbPath });
      print({ ...result, try: [`codebase-memory-mcp architecture --db ${dbPath}`, `codebase-memory-mcp serve --db ${dbPath}`] });
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case "":
      process.stdout.write(help());
      break;
    default:
      throw new Error(`Unknown command '${args.command}'. Run codebase-memory-mcp help.`);
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

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required ${name}`);
  }
  return value;
}

function print(value: unknown): void {
  process.stdout.write(`${jsonBlock(value)}\n`);
}

async function createDemoRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codebase-memory-demo-"));
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
  return `codebase-memory-mcp

Usage:
  codebase-memory-mcp index [repo] [--db path] [--max-file-bytes n]
  codebase-memory-mcp architecture [--db path]
  codebase-memory-mcp search <query> [--db path] [--limit n]
  codebase-memory-mcp symbols <query> [--kind function] [--db path]
  codebase-memory-mcp trace <symbol> [--direction inbound|outbound] [--depth n] [--db path]
  codebase-memory-mcp impact <path-or-symbol...> [--db path]
  codebase-memory-mcp decision --title "ADR title" --body "Decision body" [--tags a,b]
  codebase-memory-mcp decisions [--db path]
  codebase-memory-mcp graph [--db path]
  codebase-memory-mcp serve [--db path] [--port 9749]
  codebase-memory-mcp mcp
  codebase-memory-mcp demo
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
