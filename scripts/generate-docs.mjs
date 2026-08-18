// 生成式索引三件套；契約與維護方式見文檔工程.md §4：
//   ① 總覽.md 檔案索引生成區塊（圍欄 <!-- generated:index:start/end --> 內；來源＝各檔 frontmatter）
//   ② docs-map.md 域導覽面板（11 域＋跨域；含域關聯 heatmap 與 per-domain 依賴子圖）
//   ③ graph.json（全 corpus 節點＋連結邊；供 graphify 取用）
// 生成物皆 derived 非權威、且不入圖（docs-map 自身排除於 nodes/edges——否則自指、--check 永遠過期）。
// `--check`＝重生成比對現存內容、不一致 exit 1（防「索引忘了更新」）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  walkMd,
  rel,
  parseFrontmatterBlock,
  slugify,
  encodeMarkdownLinkTarget,
} from "./lib.mjs";
import { analyzeRefs } from "./check-refs.mjs";
import { DOMAINS } from "./domains.mjs";
import { renderMermaidGraph } from "./docs-mermaid-graphs.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const CHECK = process.argv.includes("--check");
const CROSS = "跨域";

// ---------- 節點（完整 corpus；現行規格圖另排除歷史文件） ----------
const nodes = new Map();
for (const full of walkMd(REPO_ROOT)) {
  const r = rel(REPO_ROOT, full);
  const text = fs.readFileSync(full, "utf8");
  if (!text.startsWith("---")) {
    nodes.set(r, { type: null, domain: [], summary: null });
    continue;
  }
  const { fm } = parseFrontmatterBlock(text);
  const domain = Array.isArray(fm?.domain)
    ? fm.domain
    : Array.isArray(fm?.domains)
      ? fm.domains
      : [];
  nodes.set(r, {
    type: r.startsWith("decisions/D-") ? "decision" : (fm?.type ?? null),
    domain,
    summary: typeof fm?.summary === "string" ? fm.summary : null,
  });
}
// 生成物不入圖
nodes.delete("docs-map.md");
const graphNodes = new Map(
  [...nodes].filter(([, node]) => node.type !== "history"),
);
const { edges: rawEdges } = analyzeRefs();
const edgeKey = (e) => e.from + " " + e.to;
const edges = [
  ...new Map(
    rawEdges
      .filter((e) => graphNodes.has(e.from) && graphNodes.has(e.to))
      .map((e) => [edgeKey(e), e]),
  ).values(),
].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1));

const label = (r) => r.split("/").pop().replace(/\.md$/, "");
const primaryDomain = (n) => n.domain[0] ?? CROSS;

// ---------- ① 總覽生成區塊 ----------
function overviewBlock() {
  const groups = [
    ["規格與規則 authority", ["registry", "canon"]],
    ["實作、部署與呈現", ["impl", "deploy", "art"]],
    ["方法、索引與歷史", ["meta", "index", "history"]],
  ];
  const inScope = (r) =>
    (!r.includes("/") || r === "conformance/README.md") && r !== "總覽.md";
  const out = ["<!-- generated:index:start -->"];
  out.push(
    "<!-- 本區以下至 end 標記由 `pnpm docs:generate` 生成（來源＝各檔 frontmatter summary），勿手改。 -->",
  );
  for (const [title, types] of groups) {
    const rows = [...nodes]
      .filter(([r, n]) => inScope(r) && types.includes(n.type))
      .sort(([a], [b]) => (a < b ? -1 : 1));
    if (rows.length === 0) continue;
    out.push("", `### ${title}`, "", "| 檔案 | 說明 |", "|---|---|");
    for (const [r, n] of rows)
      out.push(`| [${r}](${encodeMarkdownLinkTarget(r)}) | ${n.summary ?? ""} |`);
  }
  out.push("", "<!-- generated:index:end -->");
  return out.join("\n");
}

// ---------- ② docs-map.md ----------
function docsMap() {
  const out = [];
  out.push(
    "---",
    "type: index",
    "domain: []",
    "summary: 文檔域導覽面板（生成物；依 frontmatter domain 分組＋依賴圖）",
    "authority: null",
    "slug: null",
    "---",
    "",
  );
  out.push("# 文檔域導覽（docs-map）", "");
  out.push(
    "> 生成物（`pnpm docs:generate`）、**非權威**——權威在各檔本身與 [總覽.md](總覽.md)。依 frontmatter `domain` 分組；「跨域」＝domain 空集合；決策檔僅計數（明細見 [decisions/INDEX.md](decisions/INDEX.md)）。",
    "",
  );

  // 域關聯 heatmap（primary domain 間有向連結數；排除 decision 與無 frontmatter 檔）
  const counted = new Map();
  for (const e of edges) {
    const a = graphNodes.get(e.from);
    const b = graphNodes.get(e.to);
    if (!a?.type || !b?.type || a.type === "decision" || b.type === "decision")
      continue;
    const da = primaryDomain(a);
    const db = primaryDomain(b);
    if (da === db) continue;
    const key = da + " " + db;
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }
  const allDomains = [...DOMAINS, CROSS];
  const memberOf = (d) =>
    [...graphNodes]
      .filter(
        ([, n]) =>
          n.type &&
          n.type !== "decision" &&
          (d === CROSS ? n.domain.length === 0 : n.domain.includes(d)),
      )
      .sort(([a], [b]) => (a < b ? -1 : 1));
  const domainHeading = (domain) =>
    `${domain}（${memberOf(domain).length} 檔）`;
  const domainLink = (domain) =>
    `[${domain}](#${slugify(domainHeading(domain))})`;
  out.push(
    "## 域關聯總圖",
    "",
    "列＝引用來源、欄＝引用目標；數字是 current canon 文件間的有向連結數，歷史與決策檔不計。",
    "",
    `| 來源 \\ 目標 | ${allDomains.map(domainLink).join(" | ")} |`,
    `| --- | ${allDomains.map(() => "---:").join(" | ")} |`,
  );
  for (const from of allDomains) {
    out.push(
      `| ${domainLink(from)} | ${allDomains
        .map((to) => (from === to ? "—" : String(counted.get(`${from} ${to}`) ?? 0)))
        .join(" | ")} |`,
    );
  }
  out.push("");

  for (const d of allDomains) {
    const members = memberOf(d);
    if (members.length === 0) continue;
    const decisionCount = [...graphNodes].filter(
      ([, n]) =>
        n.type === "decision" &&
        (d === CROSS ? n.domain.length === 0 : n.domain.includes(d)),
    ).length;
    out.push(
      `## ${domainHeading(d)}`,
      "",
      "| 檔案 | type | 說明 |",
      "|---|---|---|",
    );
    for (const [r, n] of members)
      out.push(`| [${r}](${encodeMarkdownLinkTarget(r)}) | ${n.type} | ${n.summary ?? ""} |`);
    if (decisionCount > 0)
      out.push(
        "",
        `決策檔 ${decisionCount} 筆——見 [decisions/INDEX.md](decisions/INDEX.md)。`,
      );
    const memberSet = new Set(members.map(([r]) => r));
    const local = edges.filter(
      (e) => memberSet.has(e.from) && memberSet.has(e.to),
    );
    if (local.length > 0) {
      const graphNodes = [
        ...new Set(local.flatMap((edge) => [edge.from, edge.to])),
      ].toSorted();
      out.push(
        "",
        renderMermaidGraph({
          title: `${d}依賴圖`,
          nodes: graphNodes,
          edges: local,
          labelOf: label,
          linkOf: encodeMarkdownLinkTarget,
        }),
      );
    }
    out.push("");
  }
  while (out[out.length - 1] === "") out.pop();
  return out.join("\n") + "\n";
}

// ---------- ③ graph.json ----------
function graphJson() {
  const nodeList = [...graphNodes]
    .map(([id, n]) => ({
      id,
      type: n.type,
      domain: n.domain,
      summary: n.summary,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return `${JSON.stringify({ generatedBy: "docs:generate", nodes: nodeList, edges }, null, 2)}\n`;
}

// ---------- 套用／比對 ----------
const START = "<!-- generated:index:start -->";
const END = "<!-- generated:index:end -->";
const overviewPath = path.join(REPO_ROOT, "總覽.md");
const overviewText = fs.readFileSync(overviewPath, "utf8");
const startAt = overviewText.indexOf(START);
const endAt = overviewText.indexOf(END);
if (startAt < 0 || endAt < 0) {
  console.error("總覽.md 缺生成圍欄標記");
  process.exit(1);
}
const eol = overviewText.includes("\r\n") ? "\r\n" : "\n";
const block = overviewBlock().split("\n").join(eol);
const newOverview =
  overviewText.slice(0, startAt) +
  block +
  overviewText.slice(endAt + END.length);

const artifacts = [
  ["總覽.md（生成區塊）", overviewPath, newOverview],
  ["docs-map.md", path.join(REPO_ROOT, "docs-map.md"), docsMap()],
  ["graph.json", path.join(REPO_ROOT, "graph.json"), graphJson()],
];
const stale = [];
for (const [name, filePath, wanted] of artifacts) {
  const current = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : null;
  if (current === wanted) continue;
  if (CHECK) stale.push(name);
  else fs.writeFileSync(filePath, wanted);
}
console.log(
  JSON.stringify(
    {
      mode: CHECK ? "check" : "write",
      nodes: nodes.size,
      edges: edges.length,
      stale,
    },
    null,
    2,
  ),
);
if (CHECK && stale.length > 0) {
  console.log("過期——執行 pnpm docs:generate 重生成");
  process.exit(1);
}
