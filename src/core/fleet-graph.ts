import path from "node:path";
import type { FleetSummary } from "./types.js";

export interface FleetGraphOptions {
  limit?: number;
  maxNodes?: number;
  maxEdges?: number;
}

export interface FleetGraphNode {
  id: string;
  label: string;
  group: "project" | "language" | "dependency" | "route";
  project?: string;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface FleetGraphEdge {
  source: string;
  target: string;
  type: "USES_LANGUAGE" | "DEPENDS_ON" | "PROVIDES_ROUTE" | "CALLS_ENDPOINT" | "SHARES_DEPENDENCY" | "ROUTE_OVERLAP" | "CROSS_REPO_HTTP_CALLS";
  weight: number;
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface FleetGraph {
  generatedAt: string;
  catalogPath: string;
  totals: FleetSummary["totals"] & {
    graphNodes: number;
    graphEdges: number;
    projectNodes: number;
    crossRepoEdges: number;
  };
  nodes: FleetGraphNode[];
  edges: FleetGraphEdge[];
  risks: string[];
}

export function buildFleetGraph(summary: FleetSummary, options: FleetGraphOptions = {}): FleetGraph {
  const maxNodes = clamp(options.maxNodes ?? 500, 1, 5000);
  const maxEdges = clamp(options.maxEdges ?? 1000, 1, 10000);
  const nodes = new Map<string, FleetGraphNode>();
  const edges: FleetGraphEdge[] = [];

  const addNode = (node: FleetGraphNode) => {
    if (!nodes.has(node.id)) {
      nodes.set(node.id, node);
    }
  };
  const addEdge = (edge: FleetGraphEdge) => {
    if (nodes.has(edge.source) && nodes.has(edge.target)) {
      edges.push(edge);
    }
  };

  for (const project of summary.projects) {
    const label = projectLabel(project);
    const projectId = projectNodeId(label);
    addNode({
      id: projectId,
      label,
      group: "project",
      project: label,
      metadata: {
        root: project.root,
        dbPath: project.dbPath,
        dbExists: project.dbExists,
        files: project.totals?.files ?? 0,
        symbols: project.totals?.symbols ?? 0,
        edges: project.totals?.edges ?? 0,
        indexedAt: project.indexedAt
      }
    });

    for (const language of project.languages.slice(0, 30)) {
      const languageId = `language:${language.language}`;
      addNode({ id: languageId, label: language.language, group: "language" });
      addEdge({
        source: projectId,
        target: languageId,
        type: "USES_LANGUAGE",
        weight: Math.max(1, language.symbols),
        metadata: { files: language.files, symbols: language.symbols }
      });
    }

    for (const dependency of project.dependencies.slice(0, 100)) {
      const dependencyId = dependencyNodeId(dependency);
      addNode({ id: dependencyId, label: dependency, group: "dependency" });
      addEdge({
        source: projectId,
        target: dependencyId,
        type: "DEPENDS_ON",
        weight: 1
      });
    }

    for (const route of project.routes.slice(0, 200)) {
      const routeName = endpointKey(route.method, route.path ?? route.name);
      const routeId = routeNodeId(routeName);
      addNode({ id: routeId, label: routeName, group: "route", metadata: { route: routeName } });
      addEdge({
        source: projectId,
        target: routeId,
        type: "PROVIDES_ROUTE",
        weight: 1,
        metadata: { filePath: route.filePath }
      });
    }

    for (const call of project.httpCalls.slice(0, 200)) {
      const endpoint = endpointKey(call.method, call.path ?? call.name);
      const routeId = routeNodeId(endpoint);
      addNode({ id: routeId, label: endpoint, group: "route", metadata: { route: endpoint } });
      addEdge({
        source: projectId,
        target: routeId,
        type: "CALLS_ENDPOINT",
        weight: 1,
        metadata: { filePath: call.filePath, line: call.line ?? 0 }
      });
    }
  }

  for (const dependency of summary.sharedDependencies) {
    const dependencyId = dependencyNodeId(dependency.name);
    addNode({ id: dependencyId, label: dependency.name, group: "dependency" });
    for (const project of dependency.projects) {
      addNode(projectNode(project, summary));
      addEdge({
        source: projectNodeId(project),
        target: dependencyId,
        type: "SHARES_DEPENDENCY",
        weight: dependency.count,
        metadata: { sharedWith: dependency.projects.filter((name) => name !== project) }
      });
    }
  }

  for (const overlap of summary.routeOverlaps) {
    const routeId = routeNodeId(overlap.route);
    addNode({ id: routeId, label: overlap.route, group: "route", metadata: { route: overlap.route } });
    for (const project of overlap.projects) {
      addNode(projectNode(project, summary));
      addEdge({
        source: projectNodeId(project),
        target: routeId,
        type: "ROUTE_OVERLAP",
        weight: overlap.count,
        metadata: { projects: overlap.projects }
      });
    }
  }

  for (const link of summary.serviceLinks) {
    addNode(projectNode(link.consumer, summary));
    addNode(projectNode(link.provider, summary));
    addEdge({
      source: projectNodeId(link.consumer),
      target: projectNodeId(link.provider),
      type: "CROSS_REPO_HTTP_CALLS",
      weight: Math.max(1, link.calls),
      metadata: {
        route: link.route,
        calls: link.calls,
        callFiles: link.callFiles,
        providerFiles: link.providerFiles
      }
    });
  }

  const sortedNodes = [...nodes.values()].sort(compareNodes).slice(0, maxNodes);
  const visibleNodeIds = new Set(sortedNodes.map((node) => node.id));
  const sortedEdges = edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .sort(compareEdges)
    .slice(0, maxEdges);

  return {
    generatedAt: summary.generatedAt,
    catalogPath: summary.catalogPath,
    totals: {
      ...summary.totals,
      graphNodes: sortedNodes.length,
      graphEdges: sortedEdges.length,
      projectNodes: sortedNodes.filter((node) => node.group === "project").length,
      crossRepoEdges: sortedEdges.filter((edge) => edge.type === "CROSS_REPO_HTTP_CALLS").length
    },
    nodes: sortedNodes,
    edges: sortedEdges,
    risks: summary.risks
  };
}

function projectNode(label: string, summary: FleetSummary): FleetGraphNode {
  const project = summary.projects.find((candidate) => projectLabel(candidate) === label);
  return {
    id: projectNodeId(label),
    label,
    group: "project",
    project: label,
    metadata: project
      ? {
          root: project.root,
          dbPath: project.dbPath,
          dbExists: project.dbExists,
          files: project.totals?.files ?? 0,
          symbols: project.totals?.symbols ?? 0,
          edges: project.totals?.edges ?? 0,
          indexedAt: project.indexedAt
        }
      : undefined
  };
}

function projectLabel(project: Pick<FleetSummary["projects"][number], "root" | "label">): string {
  return project.label ?? path.basename(project.root);
}

function projectNodeId(label: string): string {
  return `project:${label}`;
}

function dependencyNodeId(name: string): string {
  return `dependency:${name}`;
}

function routeNodeId(route: string): string {
  return `route:${route}`;
}

function endpointKey(method: string | undefined, routePath: string | undefined): string {
  const endpointMethod = method?.trim().toUpperCase() || "ANY";
  const endpointPath = routePath?.trim() || "/";
  return `${endpointMethod} ${endpointPath}`;
}

function compareNodes(left: FleetGraphNode, right: FleetGraphNode): number {
  return groupRank(left.group) - groupRank(right.group) || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
}

function compareEdges(left: FleetGraphEdge, right: FleetGraphEdge): number {
  return typeRank(left.type) - typeRank(right.type) || right.weight - left.weight || left.source.localeCompare(right.source) || left.target.localeCompare(right.target);
}

function groupRank(group: FleetGraphNode["group"]): number {
  return ["project", "route", "dependency", "language"].indexOf(group);
}

function typeRank(type: FleetGraphEdge["type"]): number {
  return [
    "CROSS_REPO_HTTP_CALLS",
    "ROUTE_OVERLAP",
    "SHARES_DEPENDENCY",
    "PROVIDES_ROUTE",
    "CALLS_ENDPOINT",
    "DEPENDS_ON",
    "USES_LANGUAGE"
  ].indexOf(type);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)));
}
