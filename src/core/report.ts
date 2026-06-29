import type { ArchitectureSummary, Edge } from "./types.js";

export type ReportFormat = "markdown" | "html";

export interface ArchitectureReportOptions {
  format?: ReportFormat;
  graphLimit?: number;
  title?: string;
}

export interface GraphSnapshot {
  nodes: Array<{ id: string; label: string; group: string }>;
  edges: Edge[];
}

export function buildArchitectureReport(
  architecture: ArchitectureSummary,
  graph: GraphSnapshot,
  options: ArchitectureReportOptions = {}
): string {
  const format = options.format ?? "markdown";
  const title = options.title ?? "RepoLens Architecture Report";
  return format === "html"
    ? htmlReport(title, architecture, graph)
    : markdownReport(title, architecture, graph);
}

function markdownReport(title: string, architecture: ArchitectureSummary, graph: GraphSnapshot): string {
  const lines: string[] = [
    `# ${title}`,
    "",
    `Generated: ${new Date().toISOString()}`,
    `Root: ${architecture.root}`,
    `Indexed: ${architecture.indexedAt}`,
    "",
    "## Summary",
    "",
    `- Files: ${formatNumber(architecture.totals.indexedFiles)} indexed / ${formatNumber(architecture.totals.files)} discovered`,
    `- Skipped files: ${formatNumber(architecture.totals.skippedFiles)}`,
    `- Lines: ${formatNumber(architecture.totals.lines)}`,
    `- Symbols: ${formatNumber(architecture.totals.symbols)}`,
    `- Edges: ${formatNumber(architecture.totals.edges)}`,
    `- Graph snapshot: ${formatNumber(graph.nodes.length)} nodes / ${formatNumber(graph.edges.length)} edges`,
    "",
    "## Languages",
    "",
    "| Language | Files | Lines | Symbols |",
    "| --- | ---: | ---: | ---: |",
    ...architecture.languages.map((item) => `| ${item.language} | ${formatNumber(item.files)} | ${formatNumber(item.lines)} | ${formatNumber(item.symbols)} |`),
    "",
    "## Graph Schema",
    "",
    "### Node Labels",
    "",
    "| Label | Count |",
    "| --- | ---: |",
    ...architecture.nodeLabels.map((item) => `| ${item.kind} | ${formatNumber(item.count)} |`),
    "",
    "### Edge Types",
    "",
    "| Type | Count |",
    "| --- | ---: |",
    ...architecture.edgeTypes.map((item) => `| ${item.type} | ${formatNumber(item.count)} |`),
    "",
    "## Hotspots",
    "",
    ...architecture.hotspots.map((item) => `- ${item.path} - score ${item.score.toFixed(1)}${item.reasons.length ? ` (${item.reasons.join(", ")})` : ""}`),
    "",
    "## Git History Hotspots",
    "",
    ...(architecture.gitHistory.length > 0
      ? [
          "| File | Commits | Churn | Authors | Latest |",
          "| --- | ---: | ---: | ---: | --- |",
          ...architecture.gitHistory.map(
            (item) =>
              `| ${markdownCell(item.path)} | ${formatNumber(item.commits)} | ${formatNumber(item.churn)} | ${formatNumber(item.authors)} | ${markdownCell(
                [item.lastDate, item.lastSubject].filter(Boolean).join(" ")
              )} |`
          )
        ]
      : ["- No git history available."]),
    "",
    "## Top Symbols",
    "",
    "| Symbol | Kind | File | Degree | In | Out |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    ...architecture.topSymbols
      .slice(0, 15)
      .map((item) => `| ${item.name} | ${item.kind} | ${item.filePath} | ${item.degree} | ${item.inbound} | ${item.outbound} |`),
    "",
    "## Boundaries",
    "",
    "| Source | Target | Edges | Types |",
    "| --- | --- | ---: | --- |",
    ...architecture.boundaries.map((item) => `| ${item.source} | ${item.target} | ${item.edges} | ${item.sampleTypes.join(", ")} |`),
    "",
    "## Dependency Cycles",
    "",
    ...(architecture.dependencyCycles.length > 0
      ? architecture.dependencyCycles.map((item) => `- ${item.clusters.join(" -> ")} - ${formatNumber(item.edges)} edges. ${item.recommendation}`)
      : ["- No cross-cluster dependency cycles found."]),
    "",
    "## Recommendations",
    "",
    ...(architecture.recommendations.length > 0
      ? architecture.recommendations.map((item) => `- [${item.priority}] ${item.title}: ${item.detail}${item.evidence.length ? ` Evidence: ${item.evidence.join("; ")}` : ""}`)
      : ["- No recommendations found."]),
    "",
    "## Dead-Code Candidates",
    "",
    ...(architecture.deadCode.samples.length > 0
      ? architecture.deadCode.samples.map((item) => `- ${item.symbol.name} in ${item.symbol.filePath}:${item.symbol.startLine} - ${item.reason}`)
      : ["- None found in sampled results."]),
    "",
    "## Review Signals",
    "",
    ...(architecture.risks.length > 0 ? architecture.risks.map((risk) => `- ${risk}`) : ["- No risk markers found."]),
    "",
    "## Graph Samples",
    "",
    "### Nodes",
    "",
    ...graph.nodes.slice(0, 20).map((node) => `- ${node.label} (${node.group}) - ${node.id}`),
    "",
    "### Edges",
    "",
    ...graph.edges.slice(0, 20).map((edge) => `- ${edge.source} -[${edge.type}]-> ${edge.target}`)
  ];
  return `${lines.join("\n")}\n`;
}

function htmlReport(title: string, architecture: ArchitectureSummary, graph: GraphSnapshot): string {
  const graphPayload = JSON.stringify({
    nodes: graph.nodes,
    edges: graph.edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type, weight: edge.weight ?? 1 }))
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; --bg:#f6f8fb; --ink:#18212f; --muted:#657184; --line:#d7dde7; --panel:#fff; --accent:#0f766e; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; color:var(--ink); background:var(--bg); letter-spacing:0; }
    header { padding:24px 28px 18px; background:#fff; border-bottom:1px solid var(--line); }
    h1 { margin:0; font-size:26px; line-height:1.1; }
    h2 { font-size:14px; text-transform:uppercase; color:#465163; margin:0 0 12px; }
    main { padding:22px 28px 34px; display:grid; grid-template-columns: minmax(0, 1.1fr) minmax(340px, .9fr); gap:18px; }
    section { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .sub { color:var(--muted); font-size:13px; margin-top:6px; overflow-wrap:anywhere; }
    .metrics { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:10px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:12px; background:#fbfcfe; }
    .metric b { display:block; font-size:22px; }
    .metric span { color:var(--muted); font-size:12px; }
    table { width:100%; border-collapse:collapse; font-size:13px; }
    td, th { padding:8px 6px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { color:#465163; font-size:12px; text-transform:uppercase; }
    .stack { display:flex; flex-direction:column; gap:18px; }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; overflow-wrap:anywhere; }
    canvas { width:100%; height:420px; display:block; border:1px solid var(--line); border-radius:8px; background:#fbfcff; }
    input { width:100%; border:1px solid var(--line); border-radius:8px; padding:9px 10px; font-size:14px; }
    button { min-height:34px; padding:7px 11px; border:1px solid var(--line); border-radius:7px; background:#fff; color:#263447; font-size:13px; cursor:pointer; }
    button:hover { border-color:#9aa8bb; }
    .toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
    .graph-tools { display:grid; grid-template-columns:minmax(0, 1fr) auto; gap:10px; margin-top:10px; align-items:start; }
    .legend { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px; }
    .legend-item { display:inline-flex; align-items:center; gap:6px; padding:4px 7px; border:1px solid var(--line); border-radius:999px; font-size:12px; color:#344054; background:#fff; }
    .swatch { width:9px; height:9px; border-radius:50%; display:inline-block; }
    .node-detail { min-height:78px; border:1px solid var(--line); border-radius:8px; padding:10px; background:#fbfcfe; margin-top:10px; }
    @media (max-width: 980px) { main { grid-template-columns:1fr; padding:16px; } .metrics, .graph-tools { grid-template-columns:1fr; } header { padding:20px 16px 14px; } }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">Root: ${escapeHtml(architecture.root)}</div>
    <div class="sub">Indexed: ${escapeHtml(architecture.indexedAt)} | Generated: ${escapeHtml(new Date().toISOString())}</div>
  </header>
  <main>
    <div class="stack">
      <section>
        <h2>Summary</h2>
        <div class="metrics">
          ${metric("Indexed files", architecture.totals.indexedFiles)}
          ${metric("Symbols", architecture.totals.symbols)}
          ${metric("Edges", architecture.totals.edges)}
          ${metric("Lines", architecture.totals.lines)}
          ${metric("Skipped", architecture.totals.skippedFiles)}
          ${metric("Graph nodes", graph.nodes.length)}
        </div>
      </section>
      <section>
        <h2>Graph Explorer</h2>
        <canvas id="graph"></canvas>
        <div class="graph-tools">
          <input id="graph-filter" placeholder="Filter visible nodes">
          <div class="toolbar">
            <button id="graph-pause" type="button">Pause</button>
            <button id="graph-fit" type="button">Fit</button>
          </div>
        </div>
        <div class="node-detail" id="graph-detail"><div class="sub">Hover or click a node to inspect it.</div></div>
        <div class="legend" id="graph-legend"></div>
      </section>
      <section>
        <h2>Languages</h2>
        ${table(["Language", "Files", "Lines", "Symbols"], architecture.languages.map((item) => [item.language, item.files, item.lines, item.symbols]))}
      </section>
      <section>
        <h2>Top Symbols</h2>
        ${table(["Symbol", "Kind", "File", "Degree"], architecture.topSymbols.slice(0, 15).map((item) => [item.name, item.kind, item.filePath, item.degree]))}
      </section>
    </div>
    <div class="stack">
      <section>
        <h2>Node Labels</h2>
        ${table(["Label", "Count"], architecture.nodeLabels.map((item) => [item.kind, item.count]))}
      </section>
      <section>
        <h2>Edge Types</h2>
        ${table(["Type", "Count"], architecture.edgeTypes.map((item) => [item.type, item.count]))}
      </section>
      <section>
        <h2>Hotspots</h2>
        ${list(architecture.hotspots.map((item) => `${item.path} - ${item.score.toFixed(1)}${item.reasons.length ? ` (${item.reasons.join(", ")})` : ""}`))}
      </section>
      <section>
        <h2>Git History</h2>
        ${
          architecture.gitHistory.length
            ? table(
                ["File", "Commits", "Churn", "Authors", "Latest"],
                architecture.gitHistory.map((item) => [
                  item.path,
                  item.commits,
                  item.churn,
                  item.authors,
                  [item.lastDate, item.lastSubject].filter(Boolean).join(" ")
                ])
              )
            : list([])
        }
      </section>
      <section>
        <h2>Boundaries</h2>
        ${table(["Source", "Target", "Edges"], architecture.boundaries.map((item) => [item.source, item.target, item.edges]))}
      </section>
      <section>
        <h2>Dependency Cycles</h2>
        ${list(architecture.dependencyCycles.map((item) => `${item.clusters.join(" -> ")} - ${formatNumber(item.edges)} edges - ${item.recommendation}`))}
      </section>
      <section>
        <h2>Recommendations</h2>
        ${list(architecture.recommendations.map((item) => `[${item.priority}] ${item.title}: ${item.detail}`))}
      </section>
      <section>
        <h2>Dead-Code Candidates</h2>
        ${list(architecture.deadCode.samples.map((item) => `${item.symbol.name} - ${item.symbol.filePath}:${item.symbol.startLine}`))}
      </section>
      <section>
        <h2>Review Signals</h2>
        ${list(architecture.risks)}
      </section>
    </div>
  </main>
  <script>
    const graph = ${graphPayload};
    const canvas = document.querySelector('#graph');
    const ctx = canvas.getContext('2d');
    const graphFilter = document.querySelector('#graph-filter');
    const graphDetail = document.querySelector('#graph-detail');
    const graphLegend = document.querySelector('#graph-legend');
    const graphPause = document.querySelector('#graph-pause');
    const graphFit = document.querySelector('#graph-fit');
    const nodes = graph.nodes.map((node, index) => ({ ...node, x: 48 + (index % 36) * 18, y: 54 + Math.floor(index / 36) * 18, vx: 0, vy: 0, degree: 0, visible: true }));
    const byId = new Map(nodes.map(node => [node.id, node]));
    const edges = graph.edges.map(edge => ({ ...edge, sourceNode: byId.get(edge.source), targetNode: byId.get(edge.target) })).filter(edge => edge.sourceNode && edge.targetNode);
    for (const edge of edges) { edge.sourceNode.degree += 1; edge.targetNode.degree += 1; }
    const colors = new Map();
    const palette = ['#0f766e', '#7c3aed', '#2563eb', '#b45309', '#be123c', '#475569'];
    let paused = false;
    let hovered = null;
    let selected = null;
    function color(group) { if (!colors.has(group)) colors.set(group, palette[colors.size % palette.length]); return colors.get(group); }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    }
    function renderLegend() {
      const counts = new Map();
      for (const node of nodes) counts.set(node.group, (counts.get(node.group) || 0) + 1);
      graphLegend.innerHTML = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([group, count]) => '<span class="legend-item"><span class="swatch" style="background:' + color(group) + '"></span>' + escapeHtml(group) + ' ' + count.toLocaleString() + '</span>').join('');
    }
    function renderDetail(node) {
      if (!node) {
        graphDetail.innerHTML = '<div class="sub">Hover or click a node to inspect it.</div>';
        return;
      }
      graphDetail.innerHTML = '<b>' + escapeHtml(node.label) + '</b><div class="sub">' + escapeHtml(node.group) + ' - degree ' + node.degree.toLocaleString() + '</div><div class="path">' + escapeHtml(node.id) + '</div>';
    }
    function applyFilter() {
      const q = graphFilter.value.trim().toLowerCase();
      for (const node of nodes) node.visible = !q || node.label.toLowerCase().includes(q) || node.id.toLowerCase().includes(q) || String(node.group).toLowerCase().includes(q);
      if (selected && !selected.visible) selected = null;
      renderDetail(selected || hovered);
    }
    function nearestNode(event) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best = null;
      let bestDistance = 16;
      for (const node of nodes) {
        if (!node.visible) continue;
        const distance = Math.hypot(node.x - x, node.y - y);
        if (distance < bestDistance) {
          best = node;
          bestDistance = distance;
        }
      }
      return best;
    }
    function fitVisible() {
      const visible = nodes.filter(node => node.visible);
      if (!visible.length) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const minX = Math.min(...visible.map(node => node.x));
      const maxX = Math.max(...visible.map(node => node.x));
      const minY = Math.min(...visible.map(node => node.y));
      const maxY = Math.max(...visible.map(node => node.y));
      const scale = Math.min((w - 40) / Math.max(1, maxX - minX), (h - 40) / Math.max(1, maxY - minY), 1.8);
      for (const node of visible) {
        node.x = 20 + (node.x - minX) * scale;
        node.y = 20 + (node.y - minY) * scale;
        node.vx = 0;
        node.vy = 0;
      }
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(320, Math.floor(rect.width * devicePixelRatio));
      canvas.height = Math.max(320, Math.floor(rect.height * devicePixelRatio));
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    function step() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      for (const edge of edges) {
        if (!edge.sourceNode.visible || !edge.targetNode.visible) continue;
        const dx = edge.targetNode.x - edge.sourceNode.x, dy = edge.targetNode.y - edge.sourceNode.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = (dist - 76) * 0.0006;
        edge.sourceNode.vx += dx * force; edge.sourceNode.vy += dy * force;
        edge.targetNode.vx -= dx * force; edge.targetNode.vy -= dy * force;
      }
      for (const node of nodes) {
        if (!node.visible) continue;
        node.vx += (w / 2 - node.x) * 0.0008;
        node.vy += (h / 2 - node.y) * 0.0008;
        node.x = Math.min(w - 10, Math.max(10, node.x + node.vx));
        node.y = Math.min(h - 10, Math.max(10, node.y + node.vy));
        node.vx *= 0.86; node.vy *= 0.86;
      }
    }
    function draw() {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      for (const edge of edges) {
        if (!edge.sourceNode.visible || !edge.targetNode.visible) continue;
        const active = edge.sourceNode === hovered || edge.targetNode === hovered || edge.sourceNode === selected || edge.targetNode === selected;
        ctx.strokeStyle = active ? 'rgba(15,118,110,.55)' : 'rgba(71,85,105,.16)';
        ctx.lineWidth = active ? 1.6 : 0.8;
        ctx.beginPath(); ctx.moveTo(edge.sourceNode.x, edge.sourceNode.y); ctx.lineTo(edge.targetNode.x, edge.targetNode.y); ctx.stroke();
      }
      for (const node of nodes) {
        if (!node.visible) continue;
        const active = node === hovered || node === selected;
        ctx.fillStyle = color(node.group);
        ctx.beginPath(); ctx.arc(node.x, node.y, (node.group === 'file' ? 3 : 4.5) + Math.min(4, node.degree / 35) + (active ? 2 : 0), 0, Math.PI * 2); ctx.fill();
        if (active) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#111827';
          ctx.stroke();
          ctx.fillStyle = '#111827';
          ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(node.label.slice(0, 42), node.x + 8, node.y - 8);
        }
      }
    }
    function frame() { if (!paused) for (let i = 0; i < 2; i += 1) step(); draw(); requestAnimationFrame(frame); }
    addEventListener('resize', resize);
    graphFilter.addEventListener('input', applyFilter);
    graphPause.addEventListener('click', () => { paused = !paused; graphPause.textContent = paused ? 'Resume' : 'Pause'; });
    graphFit.addEventListener('click', fitVisible);
    canvas.addEventListener('mousemove', event => { hovered = nearestNode(event); if (!selected) renderDetail(hovered); });
    canvas.addEventListener('mouseleave', () => { hovered = null; if (!selected) renderDetail(null); });
    canvas.addEventListener('click', event => { selected = nearestNode(event); renderDetail(selected); });
    resize();
    renderLegend();
    frame();
  </script>
</body>
</html>`;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><b>${escapeHtml(formatNumber(value))}</b><span>${escapeHtml(label)}</span></div>`;
}

function table(headers: string[], rows: Array<Array<string | number>>): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(typeof cell === "number" ? formatNumber(cell) : cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function list(items: string[]): string {
  return items.length > 0
    ? `<ul>${items.map((item) => `<li class="path">${escapeHtml(item)}</li>`).join("")}</ul>`
    : `<div class="sub">None.</div>`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function markdownCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
