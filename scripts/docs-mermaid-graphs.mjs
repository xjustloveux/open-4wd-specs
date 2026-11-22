import { encodeMarkdownLinkTarget } from './lib.mjs';

export const DOCS_MERMAID_MAX_NODES = 30;
export const DOCS_MERMAID_MAX_EDGES = 50;

function compareEdge(left, right) {
  const leftKey = `${left.from}\u0000${left.to}\u0000${left.label ?? ""}`;
  const rightKey = `${right.from}\u0000${right.to}\u0000${right.label ?? ""}`;
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function componentNodes(nodes, edges) {
  const neighbors = new Map(nodes.map((node) => [node, new Set()]));
  for (const edge of edges) {
    neighbors.get(edge.from)?.add(edge.to);
    neighbors.get(edge.to)?.add(edge.from);
  }
  const unseen = new Set(nodes);
  const components = [];
  while (unseen.size > 0) {
    const start = [...unseen].toSorted()[0];
    const stack = [start];
    const component = [];
    unseen.delete(start);
    while (stack.length > 0) {
      const current = stack.pop();
      component.push(current);
      for (const neighbor of [...(neighbors.get(current) ?? [])]
        .toSorted()
        .toReversed()) {
        if (!unseen.has(neighbor)) continue;
        unseen.delete(neighbor);
        stack.push(neighbor);
      }
    }
    components.push(component.toSorted());
  }
  return components.toSorted((left, right) =>
    left[0].localeCompare(right[0], "en"),
  );
}

function internalEdges(nodeSet, edges) {
  return edges.filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to));
}

export function partitionMermaidGraph(inputNodes, inputEdges) {
  const nodes = [...new Set(inputNodes)].toSorted();
  const nodeSet = new Set(nodes);
  const edges = inputEdges
    .filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to))
    .map((edge) => ({ ...edge }))
    .toSorted(compareEdge);
  const pageNodes = [];

  for (const component of componentNodes(nodes, edges)) {
    const componentSet = new Set(component);
    const componentEdges = internalEdges(componentSet, edges);
    if (
      component.length <= DOCS_MERMAID_MAX_NODES &&
      componentEdges.length <= DOCS_MERMAID_MAX_EDGES
    ) {
      pageNodes.push(component);
      continue;
    }

    let current = [];
    for (const node of component) {
      const candidate = [...current, node];
      const candidateEdges = internalEdges(new Set(candidate), componentEdges);
      if (
        current.length > 0 &&
        (candidate.length > DOCS_MERMAID_MAX_NODES ||
          candidateEdges.length > DOCS_MERMAID_MAX_EDGES)
      ) {
        pageNodes.push(current);
        current = [node];
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) pageNodes.push(current);
  }

  const pageOf = new Map();
  pageNodes.forEach((page, pageIndex) => {
    page.forEach((node) => pageOf.set(node, pageIndex));
  });
  const pages = pageNodes.map((page) => ({ nodes: page, edges: [] }));
  const crossPageEdges = [];
  for (const edge of edges) {
    const sourcePage = pageOf.get(edge.from);
    const targetPage = pageOf.get(edge.to);
    if (sourcePage === targetPage) pages[sourcePage].edges.push(edge);
    else crossPageEdges.push(edge);
  }
  return { pages, crossPageEdges };
}

function escapeLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function markdownLabel(id, labelOf, linkOf) {
  const label = labelOf(id);
  const link = linkOf?.(id);
  return link ? `[${label}](${encodeMarkdownLinkTarget(link)})` : `\`${label}\``;
}

export function renderMermaidGraph({ title, nodes, edges, labelOf, linkOf }) {
  const { pages, crossPageEdges } = partitionMermaidGraph(nodes, edges);
  const lines = [];
  pages.forEach((page, pageIndex) => {
    if (pages.length > 1) {
      if (lines.length > 0) lines.push("");
      lines.push(`### ${title}（${pageIndex + 1}/${pages.length}）`, "");
    }
    const ids = new Map(page.nodes.map((node, index) => [node, `n${index}`]));
    lines.push("```mermaid", "flowchart TB");
    for (const node of page.nodes)
      lines.push(`  ${ids.get(node)}["${escapeLabel(labelOf(node))}"]`);
    for (const edge of page.edges) {
      const relation =
        edge.label === undefined ? "-->" : `-->|${escapeLabel(edge.label)}|`;
      lines.push(`  ${ids.get(edge.from)} ${relation} ${ids.get(edge.to)}`);
    }
    lines.push("```");
  });

  if (crossPageEdges.length > 0) {
    lines.push(
      "",
      `#### ${title}跨頁關係`,
      "",
      "| 來源 | 目標 | 關係 |",
      "| --- | --- | --- |",
    );
    for (const edge of crossPageEdges) {
      lines.push(
        `| ${markdownLabel(edge.from, labelOf, linkOf)} | ${markdownLabel(edge.to, labelOf, linkOf)} | ${edge.label ?? "連結"} |`,
      );
    }
  }
  return lines.join("\n");
}
