import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_ROOT = new URL(".", import.meta.url);

function runFixture(t, frontmatter, prepare = () => {}) {
  const workspace = mkdtempSync(join(tmpdir(), "open4wd-frontmatter-"));
  const root = join(workspace, "open-4wd-specs");
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(
    new URL("check-frontmatter.mjs", SCRIPT_ROOT),
    join(root, "scripts", "check-frontmatter.mjs"),
  );
  copyFileSync(new URL("lib.mjs", SCRIPT_ROOT), join(root, "scripts", "lib.mjs"));
  copyFileSync(
    new URL("domains.mjs", SCRIPT_ROOT),
    join(root, "scripts", "domains.mjs"),
  );
  const context = { workspace, root };
  prepare(context);
  const resolvedFrontmatter =
    typeof frontmatter === "function" ? frontmatter(context) : frontmatter;
  writeFileSync(
    join(root, "測試.md"),
    `---\n${resolvedFrontmatter}\n---\n# 測試\n`,
  );
  return spawnSync(process.execPath, ["scripts/check-frontmatter.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

const requiredFields = [
  "type: index",
  "domain: []",
  "summary: 測試文件",
].join("\n");

test("corpus frontmatter requires explicit authority and slug fields", (t) => {
  const result = runFixture(t, requiredFields);

  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /缺 authority 欄位/u);
  assert.match(output(result), /缺 slug 欄位/u);
});

test("authority cannot escape the repository through a parent segment", (t) => {
  const result = runFixture(
    t,
    `${requiredFields}\nauthority: ../outside.txt\nslug: null`,
    ({ workspace }) => writeFileSync(join(workspace, "outside.txt"), "outside"),
  );

  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /authority 必須是安全的 repo-relative 檔案路徑/u);
});

test("authority must resolve to a regular file rather than a directory", (t) => {
  const result = runFixture(
    t,
    `${requiredFields}\nauthority: authority-dir\nslug: null`,
    ({ root }) => mkdirSync(join(root, "authority-dir")),
  );

  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /authority 必須指向 repo 內既有的一般檔案/u);
});

test("absolute authority paths are rejected", (t) => {
  const result = runFixture(
    t,
    ({ workspace }) =>
      `${requiredFields}\nauthority: ${join(workspace, "outside.txt").replaceAll("\\", "/")}\nslug: null`,
    ({ workspace }) => writeFileSync(join(workspace, "outside.txt"), "outside"),
  );

  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /authority 必須是安全的 repo-relative 檔案路徑/u);
});

test("null and in-repository file authorities remain valid", (t) => {
  const nullResult = runFixture(
    t,
    `${requiredFields}\nauthority: null\nslug: null`,
  );
  const fileResult = runFixture(
    t,
    `${requiredFields}\nauthority: authority.txt\nslug: null`,
    ({ root }) => writeFileSync(join(root, "authority.txt"), "authority"),
  );

  assert.equal(nullResult.status, 0, output(nullResult));
  assert.equal(fileResult.status, 0, output(fileResult));
});
