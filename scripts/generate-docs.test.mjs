import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeRefs } from "./check-refs.mjs";
import { rel, walkMd } from "./lib.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_NAMES = [
  "generate-docs.mjs",
  "docs-mermaid-graphs.mjs",
  "check-refs.mjs",
  "domains.mjs",
  "lib.mjs",
];

function document(type, summary, body) {
  return `---
type: ${type}
domain: []
summary: ${summary}
authority: null
slug: null
---
${body}
`;
}

function runGenerator(root, ...args) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts", "generate-docs.mjs"), ...args],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
}

test("corpus walker excludes root-local tool workspaces", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-docs-corpus-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(
    join(root, "canon.md"),
    document("system", "正式規範", "# 正式規範"),
  );
  for (const toolRoot of [".agents", ".claude", ".superpowers"]) {
    const workspace = join(root, toolRoot, "plans");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "local.md"), "# Local tool file");
  }
  const superpowersDocs = join(root, "docs", "superpowers", "plans");
  mkdirSync(superpowersDocs, { recursive: true });
  writeFileSync(join(superpowersDocs, "local.md"), "# Local plan");

  assert.deepEqual(
    walkMd(root).map((file) => rel(root, file)),
    ["canon.md"],
  );
});

test("one write converges and generated index links stay out of graph edges", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-docs-single-pass-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "流程"));
  mkdirSync(join(root, "docs", "superpowers", "plans"), { recursive: true });
  for (const name of SCRIPT_NAMES)
    copyFileSync(join(REPO_ROOT, "scripts", name), join(root, "scripts", name));

  writeFileSync(
    join(root, "總覽.md"),
    document(
      "index",
      "總覽",
      `# 總覽

[手寫入口](流程/手寫.md)

<!-- generated:index:start -->
<!-- generated:index:end -->`,
    ),
  );
  writeFileSync(
    join(root, "流程", "手寫.md"),
    document("flow", "手寫流程", "# 手寫流程"),
  );
  writeFileSync(
    join(root, "自動.md"),
    document("meta", "自動索引文件", "# 自動索引文件"),
  );
  writeFileSync(
    join(root, "歷史.md"),
    document("history", "歷史記錄", "# 歷史記錄\n\n[舊參照](自動.md)"),
  );
  writeFileSync(
    join(root, "docs", "superpowers", "plans", "local-plan.md"),
    document("meta", "本機計畫", "# 本機計畫"),
  );
  writeFileSync(
    join(root, "AGENTS.override.md"),
    "<!-- managed-by: open-4wd-workflow -->\n",
  );
  writeFileSync(
    join(root, "CLAUDE.local.md"),
    "<!-- managed-by: open-4wd-workflow -->\n",
  );

  const write = runGenerator(root);
  assert.equal(write.status, 0, write.stderr || write.stdout);

  const check = runGenerator(root, "--check");
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const graph = JSON.parse(readFileSync(join(root, "graph.json"), "utf8"));
  const docsMap = readFileSync(join(root, "docs-map.md"), "utf8");
  assert.match(docsMap, /^## 域關聯總圖$/mu);
  assert.match(docsMap, /^\| 來源 \\ 目標 \|/mu);
  assert.doesNotMatch(docsMap, /^### 域關聯總圖（/mu);
  assert.ok(
    graph.edges.some(
      (edge) => edge.from === "總覽.md" && edge.to === "流程/手寫.md",
    ),
    "hand-authored overview edge must remain",
  );
  assert.ok(
    !graph.edges.some(
      (edge) => edge.from === "總覽.md" && edge.to === "自動.md",
    ),
    "generated navigation edge must be excluded",
  );
  assert.ok(
    !graph.nodes.some(
      (node) =>
        node.id === "AGENTS.override.md" || node.id === "CLAUDE.local.md",
    ),
    "project-scoped agent instructions must stay outside the specification corpus",
  );
  assert.ok(
    !graph.nodes.some(
      (node) => node.id === "docs/superpowers/plans/local-plan.md",
    ),
    "local Superpowers plans must stay outside the specification corpus",
  );
  assert.ok(
    !graph.nodes.some((node) => node.type === "history"),
    "history documents must stay outside the current-canon graph",
  );
  assert.ok(
    !graph.edges.some((edge) => edge.from === "歷史.md"),
    "history references must stay outside current-canon graph edges",
  );
});

test("generated index links are validated even though they are not graph edges", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-docs-link-validation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "流程"));
  writeFileSync(
    join(root, "總覽.md"),
    document(
      "index",
      "總覽",
      `# 總覽

[手寫入口](流程/手寫.md)

<!-- generated:index:start -->
[自動索引文件](自動.md)
<!-- generated:index:end -->`,
    ),
  );
  writeFileSync(
    join(root, "流程", "手寫.md"),
    document("flow", "手寫流程", "# 手寫流程"),
  );
  writeFileSync(
    join(root, "自動.md"),
    document("meta", "自動索引文件", "# 自動索引文件"),
  );

  const analysis = analyzeRefs(root);
  assert.equal(analysis.linkStats.total, 2);
  assert.equal(analysis.linkStats.verified, 2);
  assert.deepEqual(analysis.edges, [{ from: "總覽.md", to: "流程/手寫.md" }]);
});
