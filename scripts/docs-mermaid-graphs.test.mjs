import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCS_MERMAID_MAX_EDGES,
  DOCS_MERMAID_MAX_NODES,
  partitionMermaidGraph,
  renderMermaidGraph,
} from "./docs-mermaid-graphs.mjs";

test("small generated graphs use top-to-bottom layout without pagination", () => {
  const rendered = renderMermaidGraph({
    title: "範例",
    nodes: ["a", "b"],
    edges: [{ from: "a", to: "b" }],
    labelOf: (id) => id.toUpperCase(),
  });

  assert.match(rendered, /```mermaid\nflowchart TB/);
  assert.doesNotMatch(rendered, /跨頁關係|1\/1/);
});

test("oversized connected graphs split deterministically and preserve every edge once", () => {
  const nodes = Array.from(
    { length: DOCS_MERMAID_MAX_NODES + 2 },
    (_, index) => `node-${String(index).padStart(2, "0")}`,
  );
  const edges = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    edges.push({ from: nodes[index], to: nodes[index + 1] });
  }
  for (let index = 1; index < DOCS_MERMAID_MAX_EDGES + 8; index += 1) {
    edges.push({ from: nodes[0], to: nodes[(index % (nodes.length - 1)) + 1] });
  }

  const first = partitionMermaidGraph(nodes, edges);
  const second = partitionMermaidGraph(
    [...nodes].reverse(),
    [...edges].reverse(),
  );
  assert.deepEqual(second, first);
  assert.ok(first.pages.length > 1);
  for (const page of first.pages) {
    assert.ok(page.nodes.length <= DOCS_MERMAID_MAX_NODES);
    assert.ok(page.edges.length <= DOCS_MERMAID_MAX_EDGES);
  }

  const represented = [
    ...first.pages.flatMap((page) => page.edges),
    ...first.crossPageEdges,
  ].map((edge) => `${edge.from}->${edge.to}`);
  assert.deepEqual(
    represented.toSorted(),
    edges.map((edge) => `${edge.from}->${edge.to}`).toSorted(),
  );

  const rendered = renderMermaidGraph({
    title: "大型圖",
    nodes,
    edges,
    labelOf: (id) => id,
    linkOf: (id) => `${id}.md`,
  });
  assert.match(rendered, /### 大型圖（1\//);
  assert.match(rendered, /#### 大型圖跨頁關係/);
  assert.match(rendered, /\[node-00\]\(node-00\.md\)/);
});
