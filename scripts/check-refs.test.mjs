import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeRefs } from "./check-refs.mjs";

function corpusDocument(body) {
  return `---
type: index
domain: []
summary: 引用測試
authority: null
slug: null
---
# 引用測試

${body}
`;
}

test("existing directory without a published index is a broken link", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "來源.md"), corpusDocument("[目錄](target/)"));
  mkdirSync(join(root, "target"));
  writeFileSync(join(root, "target", "內容.md"), corpusDocument("內容"));

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.brokenPath, 1);
  assert.equal(result.linkStats.verified, 0);
  assert.deepEqual(
    result.linkFindings.map(({ source, target, status }) => ({
      source,
      target,
      status,
    })),
    [
      {
        source: "來源.md",
        target: "target/",
        status: "path-not-found",
      },
    ],
  );
});

test("existing file targets remain valid", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "asset.txt"), "asset");
  writeFileSync(join(root, "來源.md"), corpusDocument("[資產](asset.txt)"));

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.brokenPath, 0);
  assert.equal(result.linkStats.verified, 1);
  assert.deepEqual(result.linkFindings, []);
  assert.equal("deferred" in result.secStats, false);
  assert.equal("deferred" in result.linkStats, false);
});

test("local Markdown destinations must percent-encode spaces", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "含 空格.md"), corpusDocument("## 7. 內容"));
  writeFileSync(join(root, "來源.md"), corpusDocument("[錯誤](含 空格.md) [正確 §7](含%20空格.md#7-內容)"));

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.brokenPath, 1);
  assert.equal(result.linkStats.verified, 1);
  assert.equal(result.linkFindings[0]?.status, "unencoded-space");
  assert.equal(result.secStats.broken, 0);
});

test("a Markdown filename label must match its leaf target", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "分冊"));
  writeFileSync(join(root, "分冊", "實際權威.md"), corpusDocument("## 7. 內容"));
  writeFileSync(
    join(root, "來源.md"),
    corpusDocument("[舊導覽.md §7](分冊/實際權威.md#7-內容)"),
  );

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.labelMismatch, 1);
  assert.equal(result.linkStats.verified, 0);
  assert.equal(result.linkFindings[0]?.status, "label-target-mismatch");
});

test("retired semantic labels cannot hide a renamed leaf target", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "ui-frontend.md"), corpusDocument("內容"));
  writeFileSync(join(root, "建模參數.md"), corpusDocument("內容"));
  writeFileSync(
    join(root, "來源.md"),
    corpusDocument(
      "[前端技術策略](ui-frontend.md) [前端技術策略.md `o4-card`](ui-frontend.md) [命名慣例](建模參數.md)",
    ),
  );

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.labelMismatch, 3);
  assert.deepEqual(
    result.linkFindings.map(({ status }) => status),
    ["label-target-mismatch", "label-target-mismatch", "label-target-mismatch"],
  );
});

test("ledger facade sections 1 through 5 cannot remain authority targets", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "程式架構"));
  writeFileSync(
    join(root, "程式架構", "ledger.md"),
    corpusDocument("## 1. 導覽\n\n## 2. 導覽\n\n## 6. 現行權威"),
  );
  writeFileSync(
    join(root, "來源.md"),
    corpusDocument(
      "[ledger.md §1](程式架構/ledger.md)；純文字仍引用 ledger.md §2。",
    ),
  );

  const result = analyzeRefs(root);

  assert.equal(result.facadeSectionFindings.length, 2);
  assert.deepEqual(
    result.facadeSectionFindings.map(({ section }) => section),
    [1, 2],
  );
});

test("active canon rejects retired parameter-table names but decisions preserve history", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "來源.md"), corpusDocument("程式參數表仍是權威。"));
  mkdirSync(join(root, "decisions"));
  writeFileSync(
    join(root, "decisions", "D-TEST.md"),
    corpusDocument("建模參數表是當時名稱。"),
  );

  const result = analyzeRefs(root);

  assert.deepEqual(result.retiredNameFindings, [
    { source: "來源.md", line: 10, retiredName: "程式參數表" },
  ]);
});

test("raw anchor hrefs are validated without turning managed timeline links into graph edges", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "來源.md"),
    corpusDocument(`<!-- homepage-timeline:start -->
<a class="milestone" href="目標.md#目標">目標</a>
<!-- homepage-timeline:end -->`),
  );
  writeFileSync(join(root, "目標.md"), corpusDocument("# 目標"));

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.verified, 1);
  assert.deepEqual(result.linkFindings, []);
  assert.deepEqual(result.edges, []);
});

test("a broken raw anchor href fails link validation", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-check-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "來源.md"), corpusDocument('<a href="missing.md">缺檔</a>'));

  const result = analyzeRefs(root);

  assert.equal(result.linkStats.brokenPath, 1);
  assert.equal(result.linkFindings[0]?.target, "missing.md");
});
