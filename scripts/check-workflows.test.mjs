import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const CHECKER = fileURLToPath(new URL("check-workflows.mjs", import.meta.url));

function runWorkflow(t, workflow) {
  const root = mkdtempSync(join(tmpdir(), "open4wd-workflows-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workflowPath = join(root, ".github", "workflows", "ci.yml");
  mkdirSync(dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, workflow);
  return spawnSync(process.execPath, [CHECKER, root], {
    cwd: root,
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test("mutable external Action tags are rejected", (t) => {
  const result = runWorkflow(
    t,
    "jobs:\n  test:\n    steps:\n      - uses: actions/checkout@v4\n",
  );

  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /外部 Action 必須鎖定 40 位 commit SHA/u);
  assert.match(output(result), /actions\/checkout@v4/u);
});

test("commit-pinned and local Actions are accepted", (t) => {
  const result = runWorkflow(
    t,
    [
      "jobs:",
      "  test:",
      "    steps:",
      "      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2",
      "      - uses: ./actions/local",
      "",
    ].join("\n"),
  );

  assert.equal(result.status, 0, output(result));
});

test("docs test entrypoint includes repository-local issue maintenance contracts", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageJson.scripts["test:docs"],
    /scripts\/issue-maintenance\.test\.mjs/u,
  );
});
