import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  collectAmendedBy,
  collectVectorFamilies,
  validateDeprecations,
  validateHistoricalFiles,
  validateRelationshipAddendum,
  validateVectorFamilies,
} from "./decision-metadata.mjs";
import { DOMAINS } from "./domains.mjs";

test("all document tooling shares one ordered domain registry", () => {
  assert.deepEqual(DOMAINS, [
    "共識帳本",
    "經濟",
    "UGC版權",
    "材質",
    "建模物理",
    "比賽房間",
    "信譽仲裁",
    "版本部署",
    "資安",
    "前端主題",
    "治理營運",
  ]);
});

test("relationship addenda require a dated header and a reverse frontmatter relation", () => {
  const entries = new Map([
    ["D-20260801-01", { fm: { amends: [], supersedes: [] } }],
    ["D-20260802-01", { fm: { amends: ["D-20260801-01"], supersedes: [] } }],
  ]);
  const body = [
    "# D-20260801-01｜Earlier decision",
    "",
    "> **2026-08-02 關聯追補**：相關條款由 [D-20260802-01](D-20260802-01-later.md) 修訂。",
    "",
    "## 背景與驅動力",
  ].join("\n");

  assert.deepEqual(validateRelationshipAddendum("D-20260801-01", body, entries), []);
  assert.notDeepEqual(
    validateRelationshipAddendum(
      "D-20260801-01",
      body.replace("2026-08-02 關聯追補", "關聯追補"),
      entries,
    ),
    [],
  );
  assert.notDeepEqual(
    validateRelationshipAddendum(
      "D-20260801-01",
      body,
      new Map([
        ["D-20260801-01", { fm: { amends: [], supersedes: [] } }],
        ["D-20260802-01", { fm: { amends: [], supersedes: [] } }],
      ]),
    ),
    [],
  );
});

test("relationship addenda accept one dated block per later date, in ascending order", () => {
  const entries = new Map([
    ["D-20260801-01", { fm: { amends: [], supersedes: [] } }],
    ["D-20260802-01", { fm: { amends: ["D-20260801-01"], supersedes: [] } }],
    ["D-20260802-02", { fm: { amends: ["D-20260801-01"], supersedes: [] } }],
    ["D-20260905-01", { fm: { amends: ["D-20260801-01"], supersedes: [] } }],
  ]);
  const first = [
    "> **2026-08-02 關聯追補**：甲條款由 [D-20260802-01](D-20260802-01-a.md) 修訂。",
    "> 乙條款由 [D-20260802-02](D-20260802-02-b.md) 修訂。",
  ];
  const second = ["> **2026-09-05 關聯追補**：丙條款由 [D-20260905-01](D-20260905-01-c.md) 修訂。"];
  const body = (...blocks) =>
    [
      "# D-20260801-01｜Earlier decision",
      "",
      ...blocks.flatMap((block) => [...block, ""]),
      "## 背景與驅動力",
    ].join("\n");
  const check = (text) => validateRelationshipAddendum("D-20260801-01", text, entries);

  assert.deepEqual(check(body(first, second)), []);
  assert.deepEqual(check(body(first)), []);
  // 較晚的日期排在前面
  assert.match(check(body(second, first)).join("\n"), /日期先後/u);
  // 同一個日期拆成兩則
  assert.match(check(body([first[0]], [first[0].replace("甲", "乙").replace("02-01", "02-02")])).join("\n"), /日期先後/u);
  // 每一則各自比對日期：第二則連到別的日期的決策
  assert.match(
    check(body(first, [second[0].replace("D-20260905-01](D-20260905-01", "D-20260802-01](D-20260802-01")])).join("\n"),
    /關聯追補日期 2026-09-05 必須等於目標 D-20260802-01 的日期 2026-08-02/u,
  );
  // 每一則都要連結後續決策
  assert.match(check(body(first, ["> **2026-09-05 關聯追補**：丙條款已修訂。"])).join("\n"), /至少須連結/u);
  // 同一份後續決策出現在兩則裡時，其中一則的日期一定對不上
  assert.notDeepEqual(
    check(body(first, [second[0] + "另見 [D-20260802-01](D-20260802-01-a.md)。"])),
    [],
  );
  // 追補之外不得再出現追補標頭（例如放在四節之間）
  assert.match(
    check(body(first) + "\n\n本文。\n\n" + second[0] + "\n").join("\n"),
    /必須緊接 H1/u,
  );
  // 兩則之間必須空一行
  assert.match(check(body([...first, ...second])).join("\n"), /必須緊接 H1/u);
});

test("each relationship addendum target must exist, be later, and point back by amends or supersedes", () => {
  const addendum = (date, targetId) =>
    [
      "# D-20260801-01｜Earlier decision",
      "",
      `> **${date} 關聯追補**：相關條款由 [${targetId}](${targetId}-x.md) 修訂。`,
      "",
      "## 背景與驅動力",
    ].join("\n");
  const entries = new Map([
    ["D-20260801-01", { fm: { amends: [], supersedes: [] } }],
    // 較早的決策即使回指本檔、日期也對得上，仍不得當成追補目標。
    ["D-20260701-01", { fm: { amends: ["D-20260801-01"], supersedes: [] } }],
    // 以 supersedes 回指同樣成立。
    ["D-20260802-01", { fm: { amends: [], supersedes: ["D-20260801-01"] } }],
    // 沒有 amends／supersedes 欄位的目標：視為沒有回指。
    ["D-20260803-01", { fm: {} }],
    ["D-20260801-02", { fm: { amends: ["D-20260801-01"], supersedes: [] } }],
  ]);
  const check = (date, targetId) =>
    validateRelationshipAddendum("D-20260801-01", addendum(date, targetId), entries);

  assert.deepEqual(check("2026-08-02", "D-20260802-01"), []);
  // 同一天、序號較大的決策也算較後。
  assert.deepEqual(check("2026-08-01", "D-20260801-02"), []);
  assert.deepEqual(check("2026-07-01", "D-20260701-01"), ["關聯追補只能指向較後的 ADR：D-20260701-01"]);
  assert.deepEqual(check("2026-08-01", "D-20260801-01").slice(0, 1), [
    "關聯追補只能指向較後的 ADR：D-20260801-01",
  ]);
  assert.deepEqual(check("2026-08-09", "D-20260809-01"), ["關聯追補目標不存在：D-20260809-01"]);
  assert.deepEqual(check("2026-08-03", "D-20260803-01"), [
    "關聯追補目標 D-20260803-01 的 amends 或 supersedes 未回指 D-20260801-01",
  ]);
});

test("the reverse amends relation lists every later decision once, in id order", () => {
  const entries = new Map([
    ["D-20260905-01", { fm: { id: "D-20260905-01", amends: ["D-20260801-01", "D-20260801-02"] } }],
    ["D-20260801-01", { fm: { id: "D-20260801-01", amends: [] } }],
    ["D-20260801-02", { fm: { id: "D-20260801-02" } }],
    ["D-20260802-01", { fm: { id: "D-20260802-01", amends: ["D-20260801-01", "D-20260801-01"] } }],
    ["D-20260803-02", { fm: { id: "D-20260803-02", amends: ["D-20260801-01"] } }],
    // supersedes 不算修訂：被取代的決策已經以 superseded 標示。
    ["D-20260803-01", { fm: { id: "D-20260803-01", amends: [], supersedes: ["D-20260801-02"] } }],
  ]);
  const reverse = collectAmendedBy(entries);
  assert.deepEqual(reverse.get("D-20260801-01"), ["D-20260802-01", "D-20260803-02", "D-20260905-01"]);
  assert.deepEqual(reverse.get("D-20260801-02"), ["D-20260905-01"]);
  assert.equal(reverse.has("D-20260905-01"), false);
  assert.equal(reverse.size, 2);
});

test("deprecations accept empty metadata and exact removed, renamed, or replaced entries", () => {
  assert.deepEqual(validateDeprecations([]), []);
  assert.deepEqual(
    validateDeprecations([
      { item: "legacyField", kind: "removed", replacement: null },
      { item: "oldName", kind: "renamed", replacement: "newName" },
      { item: "old model", kind: "replaced", replacement: "current model" },
    ]),
    [],
  );
});

test("deprecations reject malformed, duplicate, and underspecified entries", () => {
  const invalid = [
    null,
    "legacyField",
    { item: "", kind: "removed", replacement: null },
    { item: "legacy", kind: "unknown", replacement: null },
    { item: "legacy", kind: "renamed", replacement: null },
    { item: "legacy", kind: "removed", replacement: "new" },
    { item: "legacy", kind: "removed", replacement: null, extra: true },
  ];
  for (const entry of invalid) assert.notDeepEqual(validateDeprecations([entry]), []);
  assert.notDeepEqual(
    validateDeprecations([
      { item: "same", kind: "removed", replacement: null },
      { item: "same", kind: "removed", replacement: null },
    ]),
    [],
  );
});

test("historical files accept a safe repo-relative path even when it no longer exists", () => {
  assert.deepEqual(validateHistoricalFiles(["removed/legacy-file.md"]), []);
});

test("historical files reject duplicates and unsafe or non-normalized paths", () => {
  const invalid = [
    [""],
    ["same.md", "same.md"],
    ["/absolute.md"],
    ["C:/absolute.md"],
    ["folder\\file.md"],
    ["../outside.md"],
    ["folder/../outside.md"],
    ["./file.md"],
    ["folder//file.md"],
  ];

  for (const files of invalid) {
    assert.notDeepEqual(
      validateHistoricalFiles(files),
      [],
      `必須拒絕 ${JSON.stringify(files)}`,
    );
  }
});

function writeVector(root, relativePath, family) {
  const target = join(root, "conformance", relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify({ family, vectors: [] })}\n`);
}

test("a vector family ID resolves to exactly one conformance file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-vector-family-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeVector(root, "ledger/signing-digest.vectors.json", "ledger/signing-digest");

  const index = collectVectorFamilies(root);

  assert.deepEqual(index.violations, []);
  assert.deepEqual(validateVectorFamilies(["ledger/signing-digest"], index.families), []);
});

test("vector metadata rejects paths, duplicates, unknown families, and duplicate definitions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-vector-family-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeVector(root, "room/first.vectors.json", "room/role-admission");
  writeVector(root, "room/second.vectors.json", "room/role-admission");
  const index = collectVectorFamilies(root);

  assert.notDeepEqual(index.violations, []);
  assert.notDeepEqual(
    validateVectorFamilies(
      ["conformance/room/first.vectors.json"],
      index.families,
    ),
    [],
  );
  assert.notDeepEqual(
    validateVectorFamilies(
      ["room/missing-family"],
      index.families,
    ),
    [],
  );
  assert.notDeepEqual(
    validateVectorFamilies(
      ["room/role-admission", "room/role-admission"],
      index.families,
    ),
    [],
  );
});
