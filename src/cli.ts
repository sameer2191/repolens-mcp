#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
  rememberDecision,
  runIndex,
  searchCode,
  searchGraph,
  searchSymbols,
  traceSymbol
} from "./core/api.js";
import type { ReportFormat } from "./core/report.js";
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
        incremental: booleanFlag(args, "incremental"),
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
    case "snippet":
      print(getCodeSnippet(required(args.positional[0], "symbol or path:line"), numberFlag(args, "context"), stringFlag(args, "db")));
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
    case "schema":
      print(getGraphSchema(stringFlag(args, "db")));
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
    case "dead-code":
      print(findDeadCode(numberFlag(args, "limit"), stringFlag(args, "db")));
      break;
    case "cycles":
      print(findDependencyCycles(numberFlag(args, "limit"), stringFlag(args, "db")));
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
  repolens-mcp index [repo] [--db path] [--max-file-bytes n] [--incremental]
  repolens-mcp architecture [--db path]
  repolens-mcp search <query> [--db path] [--limit n]
  repolens-mcp symbols <query> [--kind function] [--db path]
  repolens-mcp snippet <symbol-or-path:line> [--context n] [--db path]
  repolens-mcp trace <symbol> [--direction inbound|outbound] [--depth n] [--db path]
  repolens-mcp impact <path-or-symbol...> [--db path]
  repolens-mcp schema [--db path]
  repolens-mcp search-graph [query] [--kind function] [--relationship CALLS] [--name-pattern regex] [--file-pattern src/] [--min-degree n] [--db path]
  repolens-mcp dead-code [--db path] [--limit n]
  repolens-mcp cycles [--db path] [--limit n]
  repolens-mcp changes [repo] [--db path] [--limit n]
  repolens-mcp decision --title "ADR title" --body "Decision body" [--tags a,b]
  repolens-mcp decisions [--db path]
  repolens-mcp graph [--db path]
  repolens-mcp report [--db path] [--format markdown|html] [--graph-limit n] [--out report.html]
  repolens-mcp export-graph --out graph.html [--db path] [--limit n]
  repolens-mcp serve [--db path] [--port 9749]
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
