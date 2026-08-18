import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
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
