import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandRuleContracts,
  validateRuleContractJoin,
} from "./rule-contract-schema.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("generated rules join every canon anchor to a complete enforcement contract", () => {
  const generated = spawnSync(
    process.execPath,
    ["scripts/generate-rules.mjs", "--check"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.equal(generated.status, 0, generated.stdout + generated.stderr);

  const registry = JSON.parse(
    readFileSync(resolve(repoRoot, "rules.json"), "utf8"),
  );
  const byId = new Map(registry.rules.map((rule) => [rule.id, rule]));

  assert.deepEqual(byId.get("LEDGER-R-090").implementationRepos, [
    "open-4wd-pinning",
  ]);
  assert.deepEqual(byId.get("LEDGER-R-089").implementationRepos, ["open-4wd"]);
  assert.equal(
    registry.rules.every(
      (rule) =>
        ["reject", "derive", "behavior", "invariant", "calibration"].includes(
          rule.kind,
        ) &&
        Array.isArray(rule.requiredLayers) &&
        rule.requiredLayers.length > 0 &&
        Array.isArray(rule.implementationRepos) &&
        rule.implementationRepos.length > 0 &&
        rule.requiredLayers.every(
          (layer) => typeof rule.testContracts?.[layer] === "string",
        ),
    ),
    true,
  );
});

test("rule generation rejects empty excerpts and multiple primary anchors on one line", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "open4wd-rule-anchors-"));
  writeFileSync(
    join(fixtureRoot, "rule-contracts.json"),
    JSON.stringify({
      rules: [
        {
          id: "PHYS-R-001",
          kind: "invariant",
          requiredLayers: ["runtime"],
          implementationRepos: ["open-4wd"],
          testContracts: { runtime: "physics-anchor" },
        },
        {
          id: "TRACK-R-001",
          kind: "invariant",
          requiredLayers: ["runtime"],
          implementationRepos: ["open-4wd"],
          testContracts: { runtime: "track-anchor" },
        },
      ],
    }),
  );
  writeFileSync(
    join(fixtureRoot, "bad.md"),
    "**〔PHYS-R-001〕** **〔TRACK-R-001〕**\n",
  );

  const generated = spawnSync(
    process.execPath,
    ["scripts/generate-rules.mjs", "--check", "--root", fixtureRoot],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const output = generated.stdout + generated.stderr;

  assert.equal(generated.status, 1, output);
  assert.match(output, /一行至多一個主錨/u);
  assert.match(output, /excerpt 不得為空/u);
});

const contract = (overrides = {}) => ({
  id: "LEDGER-R-001",
  kind: "reject",
  requiredLayers: ["admission"],
  implementationRepos: ["open-4wd"],
  testContracts: { admission: "ledger-address-admission" },
  ...overrides,
});

test("rule contracts reject unknown enums, repos, and mismatched layer keys", () => {
  const invalid = [
    contract({ kind: "description" }),
    contract({ requiredLayers: ["ui"] }),
    contract({ implementationRepos: ["unknown-repo"] }),
    contract({ testContracts: { fold: "wrong-layer" } }),
  ];

  for (const item of invalid) {
    assert.throws(() => expandRuleContracts({ rules: [item] }));
  }
});

test("each rule contract requires exactly one implementation owner", () => {
  assert.throws(
    () =>
      expandRuleContracts({
        rules: [
          contract({
            implementationRepos: ["open-4wd", "open-4wd-pinning"],
          }),
        ],
      }),
    /implementationRepos 必須恰有一個 owner/u,
  );
});

test("rule contracts require unique IDs and globally unique test contracts", () => {
  assert.throws(() =>
    expandRuleContracts({ rules: [contract(), contract()] }),
  );
  assert.throws(() =>
    expandRuleContracts({
      rules: [
        contract(),
        contract({
          id: "LEDGER-R-002",
          testContracts: { admission: "ledger-address-admission" },
        }),
      ],
    }),
  );
});

test("calibration metadata is required only for calibration rules", () => {
  assert.throws(() =>
    expandRuleContracts({ rules: [contract({ kind: "calibration" })] }),
  );
  assert.throws(() =>
    expandRuleContracts({
      rules: [
        contract({
          calibration: {
            vectors: ["battery-drain-11-minute"],
            acceptedRange: { min: 10, max: 13 },
          },
        }),
      ],
    }),
  );
  assert.doesNotThrow(() =>
    expandRuleContracts({
      rules: [
        contract({
          kind: "calibration",
          calibration: {
            vectors: ["battery-drain-11-minute"],
            acceptedRange: { min: 10, max: 13 },
          },
        }),
      ],
    }),
  );
});

test("canon anchors and structural contracts must form an exact set", () => {
  const contracts = expandRuleContracts({ rules: [contract()] });
  assert.throws(() =>
    validateRuleContractJoin(new Set(["LEDGER-R-002"]), contracts),
  );
  assert.doesNotThrow(() =>
    validateRuleContractJoin(new Set(["LEDGER-R-001"]), contracts),
  );
});
