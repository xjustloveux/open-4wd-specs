// MkDocs 站點建置（本機執行＝日後發布 workflow 要跑的同一步）。
// 五段：① 依 frontmatter 白名單 staging corpus 與其受控本地資產 ② 併入四個 repo 的
// graphify 圖產物（依 repo 分層，避免 graph.html／GRAPH_REPORT.md 撞名）
// ③ 內嵌 Mermaid ④ 生成導覽 ⑤ 呼叫 mkdocs build。
// 白名單而非排除清單：node_modules 底下 584 個 .md 一個都沒有 corpus frontmatter，
// 排除清單會隨 repo 長大而默默失效，白名單不會。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectHistoryNavPages } from './history-ledger.mjs';
import {
  inlineCodeSpans,
  linkSpans,
  parseFrontmatterBlock,
  parseMd,
  rel,
  walkMd,
} from './lib.mjs';
import { collectReferencedSiteAssets } from './site-assets.mjs';
import { stageMarkdownAliases } from './site-markdown-aliases.mjs';
import { stageAllowlistedSourceFiles } from './site-source-files.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.resolve(REPO_ROOT, '..');
const STAGE = path.join(REPO_ROOT, '.site-src');
const GRAPH_REPOS = ['open-4wd', 'open-4wd-pinning', 'open-4wd-signaling', 'open-4wd-turn'];
const GRAPH_RELEASE_CACHE = path.join(REPO_ROOT, '.graphify-releases');
const MARKDOWN_STAGE_ALIASES = [
  { source: 'decisions/INDEX.md', stagedPath: 'decisions/decision-index.md' },
];
const REQUIRED_SITE_INPUTS = [
  path.join('美術資源', '實際使用圖', 'favicon-master.png'),
  path.join('scripts', 'search-dictionaries', 'dict.txt.big'),
  path.join('scripts', 'search-dictionaries', 'open4wd.txt'),
];

const rmrf = p => fs.rmSync(p, { recursive: true, force: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const projectHistoricalPlaceholderLinks = (text, type) => {
  if (type !== 'history' && type !== 'snapshot') return { text, demoted: 0 };
  const parsed = parseMd(text);
  const projectedLines = [...parsed.lines];
  let demoted = 0;
  for (let lineIndex = 0; lineIndex < parsed.lines.length; lineIndex++) {
    if (parsed.inFence[lineIndex]) continue;
    const line = parsed.lines[lineIndex];
    const codeSpans = inlineCodeSpans(line);
    const replacements = linkSpans(line)
      .filter((span) => span.target === '--')
      .filter((span) => line[span.start - 1] !== '!')
      .filter((span) => !codeSpans.some((code) => span.start >= code.start && span.end <= code.end));
    for (const span of replacements.sort((a, b) => b.start - a.start)) {
      projectedLines[lineIndex] = `${projectedLines[lineIndex].slice(0, span.start)}${span.text}${projectedLines[lineIndex].slice(span.end)}`;
      demoted++;
    }
  }
  return { text: demoted ? projectedLines.join('\n') : text, demoted };
};

const projectHomepageTimelineLinks = (text) => {
  const startMarker = '<!-- homepage-timeline:start -->';
  const endMarker = '<!-- homepage-timeline:end -->';
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) return { text, projected: 0 };
  const regionEnd = end + endMarker.length;
  const region = text.slice(start, regionEnd);
  let projected = 0;
  const rewritten = region.replace(
    /href="([^"#]+)\.md(#[^"]+)"/gu,
    (_whole, pathname, fragment) => {
      projected++;
      return `href="${pathname}.html${fragment}"`;
    },
  );
  return {
    text: `${text.slice(0, start)}${rewritten}${text.slice(regionEnd)}`,
    projected,
  };
};

// ---------- ① corpus ----------
rmrf(STAGE);
for (const input of REQUIRED_SITE_INPUTS) {
  if (!fs.existsSync(path.join(REPO_ROOT, input))) {
    throw new Error(`缺少站點必要輸入：${input}`);
  }
}
let staged = 0;
const stagedSources = [];
for (const full of walkMd(REPO_ROOT)) {
  const r = rel(REPO_ROOT, full);
  if (r.startsWith('.site-src/') || r.startsWith('site/')) continue;
  const text = fs.readFileSync(full, 'utf8');
  // 上站條件：有 corpus frontmatter，或屬 decisions/（自有 schema、check-decisions 驗）
  if (!text.startsWith('---') && !r.startsWith('decisions/')) continue;
  copy(full, path.join(STAGE, r));
  stagedSources.push(full);
  staged++;
}
// 只發布已上站 Markdown 實際引用的受控本地資產；缺檔或越界一律 fail closed。
const { copied: stagedAssets } = collectReferencedSiteAssets({
  repoRoot: REPO_ROOT,
  stageRoot: STAGE,
  markdownFiles: stagedSources,
});
// repo 管理原始檔只允許 exact allowlist；原始 Markdown 保留 GitHub 可解析的路徑，
// 僅在 staging 副本改寫到非隱藏發布路徑（MkDocs 會排除 .github）。
const { copied: stagedSourcesFiles } = stageAllowlistedSourceFiles({
  repoRoot: REPO_ROOT,
  stageRoot: STAGE,
  markdownFiles: stagedSources,
  manifestFile: path.join(REPO_ROOT, 'scripts', 'site-source-files.json'),
});
// 保留 repo 來源檔名與入站連結，只在建置副本避開 README.md／INDEX.md 都輸出
// index.html 的 Windows 大小寫碰撞。
const { aliased: stagedMarkdownAliases } = stageMarkdownAliases({
  repoRoot: REPO_ROOT,
  stageRoot: STAGE,
  markdownFiles: stagedSources,
  aliases: MARKDOWN_STAGE_ALIASES,
});
// 歷史來源保持原樣；所有既有 staging rewrite 完成後，才把精確的舊占位 target
// 降級為純文字，避免後續步驟從 canonical 來源覆寫這層發布投影。
let stagedHistoricalPlaceholders = 0;
for (const full of walkMd(STAGE)) {
  const text = fs.readFileSync(full, 'utf8');
  const { fm } = parseFrontmatterBlock(text);
  const projected = projectHistoricalPlaceholderLinks(text, fm?.type);
  if (!projected.demoted) continue;
  fs.writeFileSync(full, projected.text, 'utf8');
  stagedHistoricalPlaceholders += projected.demoted;
}
// 首頁＝總覽：在 staging-only 連結改寫後複製，確保 index.md 與總覽.md 行為一致。
// 原檔保留，8 處指向 總覽.md 的連結因此仍可解析。根層 README.md 已由
// lib.mjs 的 walkMd 排除，不會進 staging 或與 index.md 爭 MkDocs 目錄 index。
const landing = path.join(STAGE, '總覽.md');
let stagedHomepageTimelineLinks = 0;
if (fs.existsSync(landing)) {
  const source = fs.readFileSync(landing, 'utf8');
  const projected = projectHomepageTimelineLinks(source);
  fs.writeFileSync(landing, projected.text, 'utf8');
  stagedHomepageTimelineLinks = projected.projected;
  fs.copyFileSync(landing, path.join(STAGE, 'index.md'));
}

// favicon-master.png 是核准的唯一品牌原圖；站點檔名只存在於衍生 staging。
copy(
  path.join(REPO_ROOT, '美術資源', '實際使用圖', 'favicon-master.png'),
  path.join(STAGE, 'assets', 'open4wd-favicon.png'),
);

// ---------- ② graphify 圖產物 ----------
const graphRoot = path.join(STAGE, 'graph');
fs.mkdirSync(graphRoot, { recursive: true });
const graphRows = [];
let releaseStatus = new Map();
const releaseStatusPath = path.join(GRAPH_RELEASE_CACHE, 'status.json');
if (fs.existsSync(releaseStatusPath)) {
  const parsed = JSON.parse(fs.readFileSync(releaseStatusPath, 'utf8'));
  releaseStatus = new Map((parsed.repositories ?? []).map(row => [row.repository, row]));
}
const graphSummary = graphPath => {
  if (!fs.existsSync(graphPath)) return { nodes: null, edges: null };
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  return { nodes: graph.nodes?.length ?? null, edges: (graph.links ?? graph.edges)?.length ?? null };
};
const localViewer = (dest, repo, summary) => {
  fs.writeFileSync(path.join(dest, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${repo} Graphify</title>
<style>body{font:16px system-ui;max-width:70rem;margin:auto;padding:2rem}input{width:100%;padding:.6rem}</style>
<h1>${repo} knowledge graph</h1><p>${summary.nodes ?? 0} nodes · ${summary.edges ?? 0} edges</p>
<input id="q" placeholder="Filter node"><ol id="r"></ol><script type="module">const g=await fetch('./graph.json').then(r=>r.json()),q=document.querySelector('#q'),o=document.querySelector('#r');function d(){const t=q.value.toLowerCase();o.replaceChildren(...g.nodes.filter(n=>!t||String(n.label??n.name??n.id).toLowerCase().includes(t)).slice(0,200).map(n=>{const l=document.createElement('li');l.textContent=String(n.label??n.name??n.id);return l}))}q.oninput=d;d()</script>`, 'utf8');
};
for (const repo of GRAPH_REPOS) {
  const dest = path.join(graphRoot, repo);
  let entry = null;
  let status = 'missing';
  let summary = { nodes: null, edges: null };
  let generatedAt = null;
  const remote = releaseStatus.get(repo);
  if (remote?.status === 'available') {
    const source = path.resolve(GRAPH_RELEASE_CACHE, remote.siteDirectory);
    const cachePrefix = `${path.resolve(GRAPH_RELEASE_CACHE)}${path.sep}`;
    if (source.startsWith(cachePrefix) && fs.existsSync(path.join(source, 'index.html')) && fs.existsSync(path.join(source, 'graph.json'))) {
      for (const name of ['index.html', 'graph.json', 'graphify-manifest.json']) {
        if (fs.existsSync(path.join(source, name))) copy(path.join(source, name), path.join(dest, name));
      }
      entry = 'index.html';
      status = `Release ${remote.tag}`;
      summary = remote.graph;
      generatedAt = remote.generatedAt;
    }
  }
  if (!entry) {
    const out = path.join(WORKSPACE, repo, 'graphify-out');
    const graphPath = path.join(out, 'graph.json');
    summary = graphSummary(graphPath);
    const drill = path.join(out, 'drill');
    if (fs.existsSync(drill) && fs.existsSync(path.join(drill, 'index.html'))) {
      for (const name of fs.readdirSync(drill)) if (name.endsWith('.html')) copy(path.join(drill, name), path.join(dest, name));
      entry = 'index.html';
      status = '本機 sibling';
    } else if (fs.existsSync(path.join(out, 'graph.html'))) {
      copy(path.join(out, 'graph.html'), path.join(dest, 'graph.html'));
      entry = 'graph.html';
      status = '本機 sibling';
    } else if (fs.existsSync(graphPath)) {
      copy(graphPath, path.join(dest, 'graph.json'));
      localViewer(dest, repo, summary);
      entry = 'index.html';
      status = '本機 sibling';
    } else {
      status = remote?.status ?? 'missing';
    }
  }
  let files = 0;
  let mb = '0.0';
  if (entry && fs.existsSync(dest)) {
    const files = fs.readdirSync(dest);
    const bytes = files.reduce((a, f) => a + fs.statSync(path.join(dest, f)).size, 0);
    graphRows.push({ repo, entry, files: files.length, mb: (bytes / 1048576).toFixed(1), status, summary, generatedAt });
  } else {
    graphRows.push({ repo, entry, files, mb, status, summary, generatedAt });
  }
}
// GRAPH_REPORT.md 刻意不搬：它沒有 corpus frontmatter，進站等於在 corpus 樹裡多一份
// 不受 check:frontmatter 管的 .md；圖頁本身已是入口。
if (graphRows.length) {
  const rows = graphRows.map(g => {
    const label = g.entry ? `[${g.repo}](${g.repo}/${g.entry})` : g.repo;
    return `| ${label} | ${g.status} | ${g.summary.nodes ?? '—'} | ${g.summary.edges ?? '—'} | ${g.generatedAt ?? '—'} | ${g.files} | ${g.mb} MB |`;
  }).join('\n');
  fs.writeFileSync(path.join(graphRoot, 'index.md'), `---
type: index
domain: []
summary: graphify 知識圖導覽（derived view、非權威）
authority: null
slug: null
---
# 知識圖

> **derived view**：由 graphify 從各 repo 原始碼生成，權威為原始碼本身與 [程式架構.md](../程式架構.md)。

| Repo | 來源狀態 | 節點 | 邊 | 產生時間 | 檔數 | 大小 |
|---|---|---:|---:|---|---:|---:|
${rows}

Release 聚合只接受固定四 repo allowlist、exact tag 與通過 digest 驗證的固定 assets；各 repo 獨立取最新有效版本，不要求版本對齊。缺少、私有／不可達、抓取失敗或 manifest 無效都會保留狀態列，不阻斷 canon 文檔。
`, 'utf8');
}

// ---------- ③ mermaid（自架，取代 Material 的 CDN 動態載入） ----------
// Material 的 bundle 只在 window.mermaid 未定義時才去抓 unpkg；先載本地這份即接管。
// 自架的理由：站要能離線看、CSP 姿態一致、版本必須釘死（unpkg 用的是浮動的 mermaid@11）。
const MERMAID_SRC = path.join(REPO_ROOT, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
if (!fs.existsSync(MERMAID_SRC)) {
  console.error('缺 node_modules/mermaid——先跑 pnpm install');
  process.exit(1);
}
copy(MERMAID_SRC, path.join(STAGE, 'assets', 'mermaid.min.js'));
for (const asset of ['mermaid-init.js', 'site.css']) {
  copy(path.join(REPO_ROOT, 'scripts', 'site-assets', asset), path.join(STAGE, 'assets', asset));
}

// ---------- ④ 導覽（照 corpus 既有的檔案結構生成） ----------
// 只解 MkDocs 自動導覽的兩個毛病，不重新分類——corpus 建立時的目錄結構本身就是分類，
// 細項多的主題早已各自成資料夾。
//   ① 排序：自動導覽按檔名 Unicode 碼位排，對中文等同隨機。改依 frontmatter 的 type
//      排出「canon → 表 → 流程 → 實作」的閱讀動線，同 type 內再按中文排序。
//   ② 重複：X.md 與同名資料夾 X/ 會各成一項。改把 X.md 收為該段第一項＝該段的入口頁。
const TYPE_ORDER = ['canon', 'registry', 'flow', 'impl', 'impl-flow', 'deploy', 'art', 'index', 'meta', 'snapshot', 'history'];
// 資料夾段落的呈現順序（未列到的照名稱排在其後）。
const SECTION_ORDER = ['流程', '程式架構', '美術資源', '部署資訊', '歷史記錄'];
// 特定段落內釘底的子分類；只影響 menu 投影，不改動 corpus 目錄。
const NESTED_SECTION_LAST = new Map([
  ['美術資源', ['提示詞']],
]);
// 根層釘底：這幾份不是主題文檔——待辦集散、對外英文說明、生成式導覽面板，
// 放在規格之後才不會插在閱讀動線中間。順序即此陣列順序。
const ROOT_LAST = ['其他.md', 'ABOUT.en.md', 'docs-map.md'];

const pages = [];
for (const full of walkMd(STAGE)) {
  const r = rel(STAGE, full);
  const { fm } = parseFrontmatterBlock(fs.readFileSync(full, 'utf8'));
  pages.push({ path: r, type: fm?.type ?? null });
}
const take = (pred) => {
  const hit = pages.filter(pred);
  for (const p of hit) pages.splice(pages.indexOf(p), 1);
  return hit;
};
const rank = p => { const t = TYPE_ORDER.indexOf(p.type); return t < 0 ? TYPE_ORDER.length : t; };
const sortPages = list => list.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, 'zh-Hant'));

const home = take(p => p.path === 'index.md');            // 總覽的複本＝站根
take(p => p.path === '總覽.md');                          // 原檔仍在站上供既有連結解析，不重複列出
const conformance = take(p => p.path.startsWith('conformance/'));
const graph = take(p => p.path.startsWith('graph/'));
const decisions = take(p => p.path.startsWith('decisions/'));

// 有子資料夾的主題：X.md 當入口頁、X/ 底下依 type 排；再深一層（如 程式架構/程式流程/）自成子段。
const sections = new Map();
for (const name of new Set(pages.filter(p => p.path.includes('/')).map(p => p.path.split('/')[0]))) {
  const own = take(p => p.path === `${name}.md`);
  const inside = take(p => p.path.startsWith(`${name}/`));
  const directPages = inside.filter(p => p.path.split('/').length === 2);
  // 歷史正文仍會完整上站供月份索引連入，但側欄只列月份，避免每日檔淹沒全站導覽。
  const direct = name === '歷史記錄' ? selectHistoryNavPages(directPages) : sortPages(directPages);
  const nested = new Map();
  for (const p of inside.filter(p => p.path.split('/').length > 2)) {
    const sub = p.path.split('/')[1];
    (nested.get(sub) ?? nested.set(sub, []).get(sub)).push(p);
  }
  sections.set(name, { own, direct, nested });
}

const q = s => `"${String(s).replace(/"/g, '\\"')}"`;
const nav = ['nav:'];
const direct = list => {
  for (const p of list) nav.push(`  - ${q(typeof p === 'string' ? p : p.path)}`);
};
for (const p of home) nav.push(`  - ${q(p.path)}`);
direct(sortPages(conformance));
direct(sortPages(graph));
// 根層文檔：先 type 序，再把 ROOT_LAST 名單釘到最後（依名單順序）。
const pinned = ROOT_LAST.indexOf.bind(ROOT_LAST);
const rootPages = sortPages(pages).sort((a, b) => {
  const ia = pinned(a.path), ib = pinned(b.path);
  if (ia < 0 && ib < 0) return 0;                 // 兩者都不釘底＝維持 type 序
  if (ia < 0) return -1;
  if (ib < 0) return 1;
  return ia - ib;
});
for (const p of rootPages) nav.push(`  - ${q(p.path)}`);
const orderedSections = [...sections.keys()].sort((a, b) => {
  const ia = SECTION_ORDER.indexOf(a), ib = SECTION_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b, 'zh-Hant');
});
const appendSection = name => {
  const s = sections.get(name);
  nav.push(`  - ${q(name)}:`);
  for (const p of [...s.own, ...s.direct]) nav.push(`      - ${q(p.path)}`);
  const nestedLast = NESTED_SECTION_LAST.get(name) ?? [];
  const nested = [...s.nested].sort((a, b) => {
    const ia = nestedLast.indexOf(a[0]), ib = nestedLast.indexOf(b[0]);
    if (ia < 0 && ib < 0) return a[0].localeCompare(b[0], 'zh-Hant');
    if (ia < 0) return -1;
    if (ib < 0) return 1;
    return ia - ib;
  });
  for (const [sub, list] of nested) {
    const sorted = sortPages(list);
    if (sorted.length === 1 && sorted[0].path.endsWith('/README.md')) {
      nav.push(`      - ${q(sorted[0].path)}`);
      continue;
    }
    nav.push(`      - ${q(sub)}:`);
    for (const p of sorted) nav.push(`          - ${q(p.path)}`);
  }
};
for (const name of orderedSections.filter(name => name !== '歷史記錄')) appendSection(name);
const flat = (title, list) => { if (!list.length) return;
  nav.push(`  - ${q(title)}:`);
  for (const p of list) nav.push(`      - ${q(typeof p === 'string' ? p : p.path)}`); };
// 決策檔依 id 排序＝時間序，索引與制度說明置頂。
flat('決策記錄', [
  ...decisions.filter(p => !/\/D-\d{8}/.test(p.path)).map(p => p.path).sort(),
  ...decisions.filter(p => /\/D-\d{8}/.test(p.path)).map(p => p.path).sort(),
]);
if (sections.has('歷史記錄')) appendSection('歷史記錄');
const buildConfig = path.join(REPO_ROOT, 'mkdocs.build.yml');
fs.writeFileSync(buildConfig, [
  '# 由 scripts/build-site.mjs 生成，勿手改；設定本體在 mkdocs.yml。',
  'INHERIT: ./mkdocs.yml',
  ...nav,
  '',
].join('\n'), 'utf8');

// ---------- ⑤ mkdocs ----------
const navCount = nav.filter(l => /- "[^"]+\.md"/.test(l)).length;
console.log(`staged ${staged} md＋${stagedAssets} assets＋${stagedSourcesFiles} source files＋${stagedMarkdownAliases} md alias＋${stagedHistoricalPlaceholders} historical placeholders＋${stagedHomepageTimelineLinks} homepage links｜graph repos ${graphRows.length}｜mermaid 已內嵌｜nav ${navCount} 項`);
if (process.argv.includes('--stage-only')) process.exit(0);
execFileSync('mkdocs', ['build', '--clean', '-f', 'mkdocs.build.yml'], { cwd: REPO_ROOT, stdio: 'inherit' });
