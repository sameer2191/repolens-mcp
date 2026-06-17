import http from "node:http";
import path from "node:path";
import { getArchitecture, graphSnapshot, searchCode, searchSymbols } from "../core/api.js";

export interface DashboardOptions {
  dbPath?: string;
  port: number;
  host?: string;
}

export async function serveDashboard(options: DashboardOptions): Promise<http.Server> {
  const host = options.host ?? "127.0.0.1";
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    try {
      if (url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", dashboardHtml());
      } else if (url.pathname === "/api/architecture") {
        sendJson(response, getArchitecture(options.dbPath));
      } else if (url.pathname === "/api/graph") {
        sendJson(response, graphSnapshot(Number(url.searchParams.get("limit") ?? 300), options.dbPath));
      } else if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") ?? "";
        sendJson(response, {
          code: query ? searchCode(query, 20, options.dbPath) : [],
          symbols: query ? searchSymbols(query, undefined, 20, options.dbPath) : []
        });
      } else {
        send(response, 404, "text/plain; charset=utf-8", "Not found");
      }
    } catch (error) {
      send(response, 500, "application/json; charset=utf-8", JSON.stringify({ error: String(error) }));
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port, host, resolve));
  return server;
}

function sendJson(response: http.ServerResponse, body: unknown): void {
  send(response, 200, "application/json; charset=utf-8", JSON.stringify(body, null, 2));
}

function send(response: http.ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store"
  });
  response.end(body);
}

function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Codebase Memory MCP</title>
  <style>
    :root { color-scheme: light; --ink:#18212f; --muted:#657184; --line:#d7dde7; --bg:#f5f7fb; --panel:#ffffff; --accent:#0f766e; --accent2:#7c3aed; --warn:#b45309; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--ink); letter-spacing:0; }
    header { padding:22px 28px 14px; border-bottom:1px solid var(--line); background:#fff; display:flex; align-items:flex-end; justify-content:space-between; gap:18px; }
    h1 { margin:0; font-size:24px; line-height:1.1; }
    .sub { color:var(--muted); margin-top:6px; font-size:13px; }
    main { padding:22px 28px 32px; display:grid; grid-template-columns: 340px 1fr; gap:18px; }
    section, .card { background:var(--panel); border:1px solid var(--line); border-radius:8px; }
    section { padding:16px; }
    h2 { font-size:14px; margin:0 0 12px; text-transform:uppercase; color:#465163; }
    .metrics { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:12px; background:#fbfcfe; }
    .metric b { display:block; font-size:22px; }
    .metric span { color:var(--muted); font-size:12px; }
    input { width:100%; padding:10px 12px; border:1px solid var(--line); border-radius:7px; font-size:14px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    td, th { border-bottom:1px solid var(--line); padding:8px 6px; text-align:left; vertical-align:top; }
    th { color:#465163; font-size:12px; text-transform:uppercase; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:18px; }
    .list { display:flex; flex-direction:column; gap:8px; }
    .pill { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid var(--line); border-radius:999px; color:#344054; background:#fff; font-size:12px; }
    .risk { color:var(--warn); }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:#344054; overflow-wrap:anywhere; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:0; font-size:12px; }
    @media (max-width: 900px) { main { grid-template-columns:1fr; padding:16px; } header { padding:18px 16px 12px; align-items:flex-start; flex-direction:column; } .grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Codebase Memory MCP</h1>
      <div class="sub">Local SQLite memory for architecture search, symbol tracing, impact analysis, and ADRs.</div>
    </div>
    <div class="pill" id="indexed">loading</div>
  </header>
  <main>
    <aside class="list">
      <section>
        <h2>Search</h2>
        <input id="search" placeholder="Search code or symbols">
      </section>
      <section>
        <h2>Metrics</h2>
        <div class="metrics" id="metrics"></div>
      </section>
      <section>
        <h2>Risks</h2>
        <div class="list" id="risks"></div>
      </section>
    </aside>
    <div class="list">
      <section>
        <h2>Languages</h2>
        <table id="languages"></table>
      </section>
      <div class="grid">
        <section>
          <h2>Hotspots</h2>
          <div class="list" id="hotspots"></div>
        </section>
        <section>
          <h2>Entrypoints</h2>
          <div class="list" id="entrypoints"></div>
        </section>
      </div>
      <section>
        <h2>Results</h2>
        <div class="list" id="results"></div>
      </section>
    </div>
  </main>
  <script>
    const fmt = new Intl.NumberFormat();
    const metrics = document.querySelector('#metrics');
    const languages = document.querySelector('#languages');
    const risks = document.querySelector('#risks');
    const hotspots = document.querySelector('#hotspots');
    const entrypoints = document.querySelector('#entrypoints');
    const results = document.querySelector('#results');
    const indexed = document.querySelector('#indexed');
    const search = document.querySelector('#search');
    function row(label, value) { return '<div class="metric"><b>' + fmt.format(value) + '</b><span>' + label + '</span></div>'; }
    function item(text, cls='') { return '<div class="' + cls + '">' + text + '</div>'; }
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
    async function load() {
      const arch = await fetch('/api/architecture').then(r => r.json());
      indexed.textContent = 'Indexed ' + new Date(arch.indexedAt).toLocaleString();
      metrics.innerHTML = row('files', arch.totals.files) + row('symbols', arch.totals.symbols) + row('edges', arch.totals.edges) + row('lines', arch.totals.lines);
      languages.innerHTML = '<tr><th>Language</th><th>Files</th><th>Lines</th><th>Symbols</th></tr>' + arch.languages.map(l => '<tr><td>' + l.language + '</td><td>' + fmt.format(l.files) + '</td><td>' + fmt.format(l.lines) + '</td><td>' + fmt.format(l.symbols) + '</td></tr>').join('');
      risks.innerHTML = arch.risks.length ? arch.risks.map(r => item(escapeHtml(r), 'risk')).join('') : item('No obvious risk markers found.');
      hotspots.innerHTML = arch.hotspots.map(h => item('<div class="path">' + escapeHtml(h.path) + '</div><div class="sub">' + escapeHtml(h.reasons.join(', ') || 'symbol dense') + '</div>')).join('');
      entrypoints.innerHTML = arch.entrypoints.map(e => item('<div class="path">' + escapeHtml(e.path) + '</div><div class="sub">' + escapeHtml(e.reason) + '</div>')).join('');
    }
    async function doSearch() {
      const q = search.value.trim();
      if (!q) { results.innerHTML = '<div class="sub">Type to search indexed code and symbols.</div>'; return; }
      const data = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json());
      results.innerHTML = [
        ...data.symbols.map(s => item('<b>' + escapeHtml(s.kind) + '</b> ' + escapeHtml(s.name) + '<div class="path">' + escapeHtml(s.filePath) + ':' + s.startLine + '</div>')),
        ...data.code.map(c => item('<div class="path">' + escapeHtml(c.filePath) + ':' + c.line + '</div><pre>' + escapeHtml(c.text) + '</pre>'))
      ].join('') || '<div class="sub">No matches.</div>';
    }
    search.addEventListener('input', () => { clearTimeout(window.__t); window.__t = setTimeout(doSearch, 120); });
    load().catch(err => { document.body.innerHTML = '<pre>' + escapeHtml(err.stack || err) + '</pre>'; });
  </script>
</body>
</html>`;
}
