import http from "node:http";
import { architectureReport, findCommunities, findDeadCode, findDependencyCycles, findReferences, fleetSummary, getArchitecture, getCodeSnippet, getGraphSchema, graphSnapshot, queryGraph, searchCode, searchGraph, semanticSearch, searchSymbols, vectorSearch } from "../core/api.js";

export interface DashboardOptions {
  dbPath?: string;
  port: number;
  host?: string;
}

export async function serveDashboard(options: DashboardOptions): Promise<http.Server> {
  const host = options.host ?? "127.0.0.1";
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
    try {
      if (url.pathname === "/") {
        send(response, 200, "text/html; charset=utf-8", dashboardHtml());
      } else if (url.pathname === "/api/architecture") {
        sendJson(response, getArchitecture(options.dbPath));
      } else if (url.pathname === "/api/schema") {
        sendJson(response, getGraphSchema(options.dbPath));
      } else if (url.pathname === "/api/graph") {
        sendJson(response, graphSnapshot(numberParam(url, "limit") ?? 400, options.dbPath));
      } else if (url.pathname === "/api/search-graph") {
        sendJson(
          response,
          searchGraph(
            {
              query: url.searchParams.get("q") ?? undefined,
              kind: url.searchParams.get("kind") ?? undefined,
              relationship: url.searchParams.get("relationship") ?? undefined,
              filePattern: url.searchParams.get("file") ?? undefined,
              minDegree: numberParam(url, "minDegree"),
              limit: numberParam(url, "limit") ?? 25
            },
            options.dbPath
          )
        );
      } else if (url.pathname === "/api/query-graph") {
        const query = url.searchParams.get("q") ?? "";
        sendJson(response, query ? queryGraph(query, numberParam(url, "limit"), options.dbPath) : { query, columns: [], rows: [], limit: 0 });
      } else if (url.pathname === "/api/semantic") {
        const query = url.searchParams.get("q") ?? "";
        sendJson(response, query ? semanticSearch(query, numberParam(url, "limit") ?? 25, options.dbPath) : []);
      } else if (url.pathname === "/api/vector") {
        const query = url.searchParams.get("q") ?? "";
        sendJson(response, query ? vectorSearch(query, numberParam(url, "limit") ?? 25, options.dbPath) : []);
      } else if (url.pathname === "/api/communities") {
        sendJson(response, findCommunities(numberParam(url, "limit") ?? 12, numberParam(url, "minSize") ?? 4, options.dbPath));
      } else if (url.pathname === "/api/dead-code") {
        sendJson(response, findDeadCode(numberParam(url, "limit") ?? 25, options.dbPath));
      } else if (url.pathname === "/api/cycles") {
        sendJson(response, findDependencyCycles(numberParam(url, "limit") ?? 25, options.dbPath));
      } else if (url.pathname === "/api/fleet") {
        sendJson(response, await fleetSummary(numberParam(url, "limit") ?? 50));
      } else if (url.pathname === "/api/report") {
        const format = url.searchParams.get("format") === "html" ? "html" : "markdown";
        const body = architectureReport({ format, graphLimit: numberParam(url, "graphLimit") ?? 300 }, options.dbPath);
        send(response, 200, format === "html" ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8", body);
      } else if (url.pathname === "/api/search") {
        const query = url.searchParams.get("q") ?? "";
        sendJson(response, {
          code: query ? searchCode(query, 20, options.dbPath) : [],
          symbols: query ? searchSymbols(query, undefined, 20, options.dbPath) : []
        });
      } else if (url.pathname === "/api/references") {
        const identifier = url.searchParams.get("id") ?? "";
        sendJson(response, identifier ? findReferences(identifier, numberParam(url, "limit") ?? 50, options.dbPath) : []);
      } else if (url.pathname === "/api/snippet") {
        const identifier = url.searchParams.get("id") ?? "";
        sendJson(response, identifier ? getCodeSnippet(identifier, numberParam(url, "context"), options.dbPath) : null);
      } else {
        send(response, 404, "text/plain; charset=utf-8", "Not found");
      }
    } catch (error) {
      send(response, 500, "application/json; charset=utf-8", dashboardErrorBody());
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, host);
  });
  return server;
}

function numberParam(url: URL, name: string): number | undefined {
  const value = url.searchParams.get(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sendJson(response: http.ServerResponse, body: unknown): void {
  send(response, 200, "application/json; charset=utf-8", JSON.stringify(body, null, 2));
}

export function dashboardErrorBody(): string {
  return JSON.stringify({ error: "Internal server error" });
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
  <title>RepoLens MCP</title>
  <style>
    :root { color-scheme: light; --ink:#18212f; --muted:#657184; --line:#d7dde7; --bg:#f5f7fb; --panel:#ffffff; --soft:#fbfcfe; --accent:#0f766e; --accent2:#6d28d9; --warn:#b45309; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; background:var(--bg); color:var(--ink); letter-spacing:0; }
    header { padding:20px 28px 14px; border-bottom:1px solid var(--line); background:#fff; display:flex; align-items:flex-end; justify-content:space-between; gap:18px; }
    h1 { margin:0; font-size:24px; line-height:1.1; }
    h2 { font-size:13px; margin:0 0 12px; text-transform:uppercase; color:#465163; }
    a { color:var(--accent); text-decoration:none; }
    a:hover { text-decoration:underline; }
    main { padding:18px 28px 30px; display:grid; grid-template-columns: 360px minmax(0, 1fr); gap:18px; }
    section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:14px; }
    .sub { color:var(--muted); margin-top:6px; font-size:13px; }
    .stack { display:flex; flex-direction:column; gap:12px; }
    .grid { display:grid; grid-template-columns: 1fr 1fr; gap:12px; }
    .wide-grid { display:grid; grid-template-columns: 1.1fr .9fr; gap:12px; align-items:start; }
    .metrics { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:12px; background:var(--soft); }
    .metric b { display:block; font-size:21px; line-height:1.1; }
    .metric span { color:var(--muted); font-size:12px; }
    label { display:block; color:#465163; font-size:12px; margin-bottom:5px; }
    input, select, textarea { width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:7px; font-size:14px; background:#fff; color:var(--ink); }
    textarea { min-height:78px; resize:vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
    button, .button { display:inline-flex; justify-content:center; align-items:center; min-height:34px; padding:7px 11px; border:1px solid var(--line); border-radius:7px; background:#fff; color:#263447; font-size:13px; cursor:pointer; }
    button.primary, .button.primary { background:var(--accent); color:#fff; border-color:var(--accent); }
    button:hover, .button:hover { border-color:#9aa8bb; text-decoration:none; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    td, th { border-bottom:1px solid var(--line); padding:7px 6px; text-align:left; vertical-align:top; }
    th { color:#465163; font-size:11px; text-transform:uppercase; }
    .list { display:flex; flex-direction:column; gap:8px; }
    .pill { display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid var(--line); border-radius:999px; color:#344054; background:#fff; font-size:12px; }
    .risk { color:var(--warn); }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; color:#344054; overflow-wrap:anywhere; }
    .result { border-bottom:1px solid var(--line); padding:8px 0; }
    .result:last-child { border-bottom:0; }
    .toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    pre { white-space:pre-wrap; overflow-wrap:anywhere; margin:0; font-size:12px; }
    canvas { width:100%; height:430px; display:block; border:1px solid var(--line); border-radius:8px; background:#fbfcff; }
    @media (max-width: 980px) { main { grid-template-columns:1fr; padding:16px; } header { padding:18px 16px 12px; align-items:flex-start; flex-direction:column; } .grid, .wide-grid { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>RepoLens MCP</h1>
      <div class="sub">Local SQLite repository intelligence with graph search, reports, tracing, and impact analysis.</div>
    </div>
    <div class="toolbar">
      <a class="button" href="/api/report?format=markdown&graphLimit=300" target="_blank">Markdown Report</a>
      <a class="button primary" href="/api/report?format=html&graphLimit=600" target="_blank">HTML Report</a>
      <div class="pill" id="indexed">loading</div>
    </div>
  </header>
  <main>
    <aside class="stack">
      <section>
        <h2>Code Search</h2>
        <div class="stack">
          <input id="search" placeholder="Search code or symbols">
          <button id="references-run" type="button">Find References</button>
        </div>
      </section>
      <section>
        <h2>Semantic Search</h2>
        <div class="stack">
          <input id="semantic-query" placeholder="live session repository">
          <button class="primary" id="semantic-run" type="button">Search Meaning</button>
          <button id="vector-run" type="button">Vector Search</button>
        </div>
      </section>
      <section>
        <h2>Graph Search</h2>
        <div class="stack">
          <div><label for="graph-query">Query</label><input id="graph-query" placeholder="symbol, file, signature"></div>
          <div class="grid">
            <div><label for="graph-kind">Kind</label><input id="graph-kind" placeholder="function, class"></div>
            <div><label for="graph-rel">Relationship</label><select id="graph-rel"><option value="">Any</option><option>CALLS</option><option>CALLS_LOCAL</option><option>CALLS_HTTP_ENDPOINT</option><option>HTTP_CALLS</option><option>DEFINES</option><option>IMPORTS</option><option>DECLARES</option></select></div>
          </div>
          <div class="grid">
            <div><label for="graph-file">File scope</label><input id="graph-file" placeholder="src/, apps/ios"></div>
            <div><label for="graph-degree">Min degree</label><input id="graph-degree" type="number" min="0" placeholder="0"></div>
          </div>
          <button class="primary" id="graph-run" type="button">Search Graph</button>
        </div>
      </section>
      <section>
        <h2>Query Graph</h2>
        <div class="stack">
          <textarea id="cypher-query">MATCH (a:Function)-[:CALLS]->(b) RETURN a.name,b.name,e.type LIMIT 10</textarea>
          <button class="primary" id="cypher-run" type="button">Run Query</button>
        </div>
      </section>
      <section>
        <h2>Metrics</h2>
        <div class="metrics" id="metrics"></div>
      </section>
      <section>
        <h2>Fleet Service Links</h2>
        <div class="list" id="fleet-links"></div>
      </section>
      <section>
        <h2>Review Signals</h2>
        <div class="list" id="risks"></div>
      </section>
      <section>
        <h2>Recommendations</h2>
        <div class="list" id="recommendations"></div>
      </section>
      <section>
        <h2>Dead-Code Candidates</h2>
        <div class="list" id="dead-code"></div>
      </section>
    </aside>
    <div class="stack">
      <section>
        <h2>Graph Preview</h2>
        <canvas id="graph-canvas"></canvas>
      </section>
      <div class="wide-grid">
        <section>
          <h2>Languages</h2>
          <table id="languages"></table>
        </section>
        <section>
          <h2>Graph Schema</h2>
          <div class="grid">
            <table id="node-labels"></table>
            <table id="edge-types"></table>
          </div>
        </section>
      </div>
      <div class="grid">
        <section>
          <h2>Hotspots</h2>
          <div class="list" id="hotspots"></div>
        </section>
        <section>
          <h2>Boundaries</h2>
          <div class="list" id="boundaries"></div>
        </section>
      </div>
      <section>
        <h2>Dependency Cycles</h2>
        <div class="list" id="cycles"></div>
      </section>
      <section>
        <h2>Communities</h2>
        <div class="list" id="communities"></div>
      </section>
      <section>
        <h2>Results</h2>
        <div class="list" id="results"><div class="sub">Use code search or graph search.</div></div>
      </section>
    </div>
  </main>
  <script>
    const fmt = new Intl.NumberFormat();
    const metrics = document.querySelector('#metrics');
    const languages = document.querySelector('#languages');
    const risks = document.querySelector('#risks');
    const fleetLinks = document.querySelector('#fleet-links');
    const recommendations = document.querySelector('#recommendations');
    const deadCode = document.querySelector('#dead-code');
    const hotspots = document.querySelector('#hotspots');
    const boundaries = document.querySelector('#boundaries');
    const cycles = document.querySelector('#cycles');
    const communities = document.querySelector('#communities');
    const results = document.querySelector('#results');
    const indexed = document.querySelector('#indexed');
    const search = document.querySelector('#search');
    const referencesRun = document.querySelector('#references-run');
    const semanticRun = document.querySelector('#semantic-run');
    const vectorRun = document.querySelector('#vector-run');
    const semanticQuery = document.querySelector('#semantic-query');
    const nodeLabels = document.querySelector('#node-labels');
    const edgeTypes = document.querySelector('#edge-types');
    const graphRun = document.querySelector('#graph-run');
    const graphQuery = document.querySelector('#graph-query');
    const graphKind = document.querySelector('#graph-kind');
    const graphRel = document.querySelector('#graph-rel');
    const graphFile = document.querySelector('#graph-file');
    const graphDegree = document.querySelector('#graph-degree');
    const cypherRun = document.querySelector('#cypher-run');
    const cypherQuery = document.querySelector('#cypher-query');
    const canvas = document.querySelector('#graph-canvas');
    const ctx = canvas.getContext('2d');
    let graphState = { nodes: [], edges: [] };

    function metric(label, value) { return '<div class="metric"><b>' + fmt.format(value) + '</b><span>' + label + '</span></div>'; }
    function item(text, cls='') { return '<div class="' + cls + '">' + text + '</div>'; }
    function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
    function table(headers, rows) {
      return '<tr>' + headers.map(h => '<th>' + escapeHtml(h) + '</th>').join('') + '</tr>' + rows.map(row => '<tr>' + row.map(cell => '<td>' + escapeHtml(cell) + '</td>').join('') + '</tr>').join('');
    }
    function params(values) {
      const url = new URLSearchParams();
      Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== null && String(value).trim() !== '') url.set(key, String(value).trim()); });
      return url.toString();
    }
    async function load() {
      const [arch, schema, graph, dead, communityRows, fleet] = await Promise.all([
        fetch('/api/architecture').then(r => r.json()),
        fetch('/api/schema').then(r => r.json()),
        fetch('/api/graph?limit=500').then(r => r.json()),
        fetch('/api/dead-code?limit=8').then(r => r.json()),
        fetch('/api/communities?limit=8&minSize=4').then(r => r.json()),
        fetch('/api/fleet?limit=20').then(r => r.json())
      ]);
      indexed.textContent = 'Indexed ' + new Date(arch.indexedAt).toLocaleString();
      metrics.innerHTML = metric('files', arch.totals.files) + metric('symbols', arch.totals.symbols) + metric('edges', arch.totals.edges) + metric('lines', arch.totals.lines);
      fleetLinks.innerHTML = fleet.serviceLinks.length
        ? fleet.serviceLinks.slice(0, 8).map(link => item('<b>' + escapeHtml(link.consumer) + ' -> ' + escapeHtml(link.provider) + '</b><div class="sub">' + escapeHtml(link.route) + (link.host ? ' via ' + escapeHtml(link.host) : '') + ' - ' + fmt.format(link.calls) + ' call' + (link.calls === 1 ? '' : 's') + (Number.isFinite(link.confidence) ? ' - confidence ' + Math.round(link.confidence * 100) + '%' : '') + (link.matchReason ? ' - ' + escapeHtml(link.matchReason) : '') + '</div><div class="path">' + escapeHtml(link.callFiles.join(' | ')) + '</div>')).join('')
        : item(fleet.totals.projects ? 'No cross-project service links found.' : 'No catalog projects indexed yet.');
      languages.innerHTML = table(['Language', 'Files', 'Lines', 'Symbols'], arch.languages.map(l => [l.language, fmt.format(l.files), fmt.format(l.lines), fmt.format(l.symbols)]));
      nodeLabels.innerHTML = table(['Label', 'Count'], schema.nodeLabels.slice(0, 12).map(n => [n.kind, fmt.format(n.count)]));
      edgeTypes.innerHTML = table(['Type', 'Count'], schema.edgeTypes.map(e => [e.type, fmt.format(e.count)]));
      risks.innerHTML = arch.risks.length ? arch.risks.map(r => item(escapeHtml(r), 'risk')).join('') : item('No review signals found.');
      recommendations.innerHTML = arch.recommendations.length ? arch.recommendations.map(r => item('<b>' + escapeHtml(r.priority.toUpperCase()) + '</b> ' + escapeHtml(r.title) + '<div class="sub">' + escapeHtml(r.detail) + '</div><div class="path">' + escapeHtml(r.evidence.join(' | ')) + '</div>')).join('') : item('No recommendations found.');
      deadCode.innerHTML = dead.length ? dead.map(c => item('<b>' + escapeHtml(c.symbol.name) + '</b><div class="path">' + escapeHtml(c.symbol.filePath) + ':' + c.symbol.startLine + '</div><div class="sub">' + escapeHtml(c.reason) + '</div>')).join('') : item('No candidates found.');
      hotspots.innerHTML = arch.hotspots.map(h => item('<div class="path">' + escapeHtml(h.path) + '</div><div class="sub">score ' + h.score.toFixed(1) + ' - ' + escapeHtml(h.reasons.join(', ') || 'symbol dense') + '</div>')).join('');
      boundaries.innerHTML = arch.boundaries.length ? arch.boundaries.map(b => item('<b>' + escapeHtml(b.source) + ' -> ' + escapeHtml(b.target) + '</b><div class="sub">' + fmt.format(b.edges) + ' edges - ' + escapeHtml(b.sampleTypes.join(', ')) + '</div>')).join('') : item('No cross-boundary graph edges found.');
      cycles.innerHTML = arch.dependencyCycles.length ? arch.dependencyCycles.map(c => item('<b>' + escapeHtml(c.clusters.join(' -> ')) + '</b><div class="sub">' + fmt.format(c.edges) + ' internal cycle edges</div><div class="path">' + escapeHtml(c.recommendation) + '</div>')).join('') : item('No cross-cluster dependency cycles found.');
      communities.innerHTML = communityRows.length ? communityRows.map(c => item('<b>' + escapeHtml(c.label) + '</b><div class="sub">' + fmt.format(c.members) + ' members - cohesion ' + c.cohesion.toFixed(2) + ' - ' + fmt.format(c.internalEdges) + ' internal edges</div><div class="path">' + escapeHtml(c.files.slice(0, 4).join(' | ')) + '</div><div class="sub">' + escapeHtml(c.representativeSymbols.slice(0, 4).map(s => s.name).join(', ')) + '</div>')).join('') : item('No graph communities found.');
      graphState = prepareGraph(graph);
      resizeGraph();
      drawGraph();
    }
    async function doSearch() {
      const q = search.value.trim();
      if (!q) { results.innerHTML = '<div class="sub">Use code search or graph search.</div>'; return; }
      const data = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json());
      results.innerHTML = [
        ...data.symbols.map(s => item('<b>' + escapeHtml(s.kind) + '</b> ' + escapeHtml(s.name) + '<div class="path">' + escapeHtml(s.filePath) + ':' + s.startLine + '</div>')),
        ...data.code.map(c => item('<div class="path">' + escapeHtml(c.filePath) + ':' + c.line + '</div><pre>' + escapeHtml(c.text) + '</pre>'))
      ].join('') || '<div class="sub">No matches.</div>';
    }
    async function doReferences() {
      const q = search.value.trim();
      if (!q) { results.innerHTML = '<div class="sub">Enter a symbol or identifier.</div>'; return; }
      const data = await fetch('/api/references?' + params({ id: q, limit: 50 })).then(r => r.json());
      results.innerHTML = data.map(ref => item('<b>' + escapeHtml(ref.kind) + '</b> <span class="sub">score ' + ref.score.toFixed(2) + '</span><div class="path">' + escapeHtml(ref.filePath) + ':' + ref.line + '</div><pre>' + escapeHtml(ref.text) + '</pre><div class="sub">' + escapeHtml(ref.reason) + '</div>')).join('') || '<div class="sub">No references.</div>';
    }
    async function doSemanticSearch() {
      const q = semanticQuery.value.trim();
      if (!q) { results.innerHTML = '<div class="sub">Enter a semantic query.</div>'; return; }
      const data = await fetch('/api/semantic?' + params({ q, limit: 30 })).then(r => r.json());
      results.innerHTML = data.map(match => item('<b>' + escapeHtml(match.symbol.name) + '</b> <span class="sub">' + escapeHtml(match.symbol.kind) + ' score ' + match.score.toFixed(3) + '</span><div class="path">' + escapeHtml(match.symbol.filePath) + ':' + match.symbol.startLine + '</div><div class="sub">' + escapeHtml(match.reasons.join(' | ')) + '</div>')).join('') || '<div class="sub">No semantic matches.</div>';
    }
    async function doVectorSearch() {
      const q = semanticQuery.value.trim();
      if (!q) { results.innerHTML = '<div class="sub">Enter a vector query.</div>'; return; }
      const data = await fetch('/api/vector?' + params({ q, limit: 30 })).then(r => r.json());
      results.innerHTML = data.map(match => item('<b>' + escapeHtml(match.symbol.name) + '</b> <span class="sub">' + escapeHtml(match.symbol.kind) + ' vector ' + match.score.toFixed(3) + '</span><div class="path">' + escapeHtml(match.symbol.filePath) + ':' + match.symbol.startLine + '</div><div class="sub">' + escapeHtml(match.reasons.join(' | ')) + '</div><div class="sub">' + fmt.format(match.vector.nonZero) + ' nonzero / ' + fmt.format(match.vector.dimensions) + ' dims</div>')).join('') || '<div class="sub">No vector matches.</div>';
    }
    async function doGraphSearch() {
      const query = params({ q: graphQuery.value, kind: graphKind.value, relationship: graphRel.value, file: graphFile.value, minDegree: graphDegree.value, limit: 30 });
      const data = await fetch('/api/search-graph?' + query).then(r => r.json());
      results.innerHTML = data.map(match => item('<b>' + escapeHtml(match.symbol.name) + '</b> <span class="sub">' + escapeHtml(match.symbol.kind) + '</span><div class="path">' + escapeHtml(match.symbol.filePath) + ':' + match.symbol.startLine + '</div><div class="sub">degree ' + fmt.format(match.degree) + ' - inbound ' + fmt.format(match.inbound) + ' - outbound ' + fmt.format(match.outbound) + '</div>')).join('') || '<div class="sub">No graph matches.</div>';
    }
    async function doCypherQuery() {
      const data = await fetch('/api/query-graph?' + params({ q: cypherQuery.value, limit: 50 })).then(r => r.json());
      if (data.error) { results.innerHTML = item(escapeHtml(data.error), 'risk'); return; }
      if (!data.rows.length) { results.innerHTML = '<div class="sub">No query rows.</div>'; return; }
      results.innerHTML = data.rows.map(row => item(data.columns.map(column => '<div><b>' + escapeHtml(column) + '</b>: <span class="path">' + escapeHtml(row[column]) + '</span></div>').join(''))).join('');
    }
    function prepareGraph(graph) {
      const nodes = graph.nodes.map((node, index) => ({ ...node, x: 40 + (index % 36) * 20, y: 46 + Math.floor(index / 36) * 20, vx: 0, vy: 0 }));
      const byId = new Map(nodes.map(node => [node.id, node]));
      return { nodes, edges: graph.edges.map(edge => ({ ...edge, sourceNode: byId.get(edge.source), targetNode: byId.get(edge.target) })).filter(edge => edge.sourceNode && edge.targetNode) };
    }
    function resizeGraph() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width * devicePixelRatio));
      canvas.height = Math.max(320, Math.floor(rect.height * devicePixelRatio));
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    function drawGraph() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      for (let step = 0; step < 2; step += 1) {
        for (const edge of graphState.edges) {
          const dx = edge.targetNode.x - edge.sourceNode.x, dy = edge.targetNode.y - edge.sourceNode.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const force = (dist - 82) * 0.0006;
          edge.sourceNode.vx += dx * force; edge.sourceNode.vy += dy * force;
          edge.targetNode.vx -= dx * force; edge.targetNode.vy -= dy * force;
        }
        for (const node of graphState.nodes) {
          node.vx += (w / 2 - node.x) * 0.0008;
          node.vy += (h / 2 - node.y) * 0.0008;
          node.x = Math.min(w - 10, Math.max(10, node.x + node.vx));
          node.y = Math.min(h - 10, Math.max(10, node.y + node.vy));
          node.vx *= 0.86; node.vy *= 0.86;
        }
      }
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(71,85,105,.16)';
      for (const edge of graphState.edges) { ctx.beginPath(); ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y); ctx.lineTo(edge.targetNode.x, edge.targetNode.y); ctx.stroke(); }
      const palette = { file:'#475569', function:'#0f766e', class:'#6d28d9', struct:'#2563eb', heading:'#b45309', route:'#be123c', http_call:'#0891b2' };
      for (const node of graphState.nodes) {
        ctx.fillStyle = palette[node.group] || '#64748b';
        ctx.beginPath(); ctx.arc(node.x, node.y, node.group === 'file' ? 3 : 4.4, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(drawGraph);
    }
    search.addEventListener('input', () => { clearTimeout(window.__t); window.__t = setTimeout(doSearch, 120); });
    referencesRun.addEventListener('click', doReferences);
    semanticRun.addEventListener('click', doSemanticSearch);
    vectorRun.addEventListener('click', doVectorSearch);
    graphRun.addEventListener('click', doGraphSearch);
    cypherRun.addEventListener('click', doCypherQuery);
    window.addEventListener('resize', resizeGraph);
    load().catch(err => { document.body.innerHTML = '<pre>' + escapeHtml(err.stack || err) + '</pre>'; });
  </script>
</body>
</html>`;
}
