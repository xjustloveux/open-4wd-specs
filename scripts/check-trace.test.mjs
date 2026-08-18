import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checker = resolve(repoRoot, "scripts/check-trace.mjs");
const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "o4wd-trace-"));
  tempRoots.push(root);
  const rulesPath = join(root, "rules.json");
  writeFileSync(
    rulesPath,
    JSON.stringify({
      rules: [
        {
          id: "LEDGER-R-001",
          kind: "behavior",
          requiredLayers: ["service"],
          implementationRepos: ["open-4wd"],
          testContracts: { service: "ledger-one-service" },
        },
        {
          id: "LEDGER-R-002",
          kind: "behavior",
          requiredLayers: ["service"],
          implementationRepos: ["open-4wd-pinning"],
          testContracts: { service: "ledger-two-service" },
        },
      ],
    }),
  );
  return { root, rulesPath };
}

function writeSpec(root, directory, source) {
  const target = join(root, directory);
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "behavior.spec.ts"), source);
  return target;
}

function writeConformance(
  root,
  directory,
  { ruleId, layer = "service", contract, importHarness = true },
) {
  const target = join(root, directory);
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, "behavior.conformance.spec.ts"),
    `${importHarness ? 'import { ruleConformance } from "./rule-conformance";\n' : ""}ruleConformance({\n  ruleId: "${ruleId}",\n  layer: "${layer}",\n  contract: "${contract}",\n  boundary: () => true,\n  verify: ({ invoke }) => invoke(),\n});\n`,
  );
  return target;
}

function run(rulesPath, targets) {
  const args = [checker, "--rules", rulesPath];
  for (const target of targets) args.push("--target", target);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("single-repo mode counts only rules owned by that implementation repo", () => {
  const { root, rulesPath } = fixture();
  const main = writeConformance(root, "main", {
    ruleId: "LEDGER-R-001",
    contract: "ledger-one-service",
  });

  const result = run(rulesPath, [`open-4wd=${main}`]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /open-4wd: 1\/1/);
  assert.match(result.stdout, /覆蓋規則 1\/1/);
  assert.doesNotMatch(result.stdout, /LEDGER-R-002/);
});

test("aggregate mode combines repeated repo roots into global ownership coverage", () => {
  const { root, rulesPath } = fixture();
  const main = writeConformance(root, "main", {
    ruleId: "LEDGER-R-001",
    contract: "ledger-one-service",
  });
  const pinningScripts = writeSpec(
    root,
    "pinning-scripts",
    "// no annotation here\n",
  );
  const pinningIntegration = writeConformance(root, "pinning-integration", {
    ruleId: "LEDGER-R-002",
    contract: "ledger-two-service",
  });

  const result = run(rulesPath, [
    `open-4wd=${main}`,
    `open-4wd-pinning=${pinningScripts}`,
    `open-4wd-pinning=${pinningIntegration}`,
  ]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /open-4wd: 1\/1/);
  assert.match(result.stdout, /open-4wd-pinning: 1\/1/);
  assert.match(result.stdout, /覆蓋規則 2\/2/);
});

test("unknown annotations fail as ghost rule ids", () => {
  const { root, rulesPath } = fixture();
  const main = writeSpec(root, "main", "// 驗證規則：〔LEDGER-R-999〕\n");

  const result = run(rulesPath, [`open-4wd=${main}`]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ghost/);
  assert.match(result.stderr, /LEDGER-R-999/);
});

test("annotations from a repo outside implementationRepos fail ownership validation", () => {
  const { root, rulesPath } = fixture();
  const main = writeSpec(root, "main", "// 驗證規則：〔LEDGER-R-002〕\n");

  const result = run(rulesPath, [`open-4wd=${main}`]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ownership/);
  assert.match(result.stderr, /LEDGER-R-002/);
});

test("missing owned annotations fail the trace gate", () => {
  const { root, rulesPath } = fixture();
  const main = writeSpec(root, "main", "// no annotations\n");

  const result = run(rulesPath, [`open-4wd=${main}`]);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /缺少測試標註/u);
  assert.match(result.stderr, /LEDGER-R-001/u);
});

test("ordinary ID comments cannot satisfy a required layer", () => {
  const { root, rulesPath } = fixture();
  const main = writeSpec(root, "main", "// 驗證規則：〔LEDGER-R-001〕\n");

  const result = run(rulesPath, [`open-4wd=${main}`]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /缺少 conformance/u);
  assert.match(result.stderr, /LEDGER-R-001:service:ledger-one-service/u);
});

test("wrong conformance layer or contract fails the hard gate", () => {
  const { root, rulesPath } = fixture();
  const wrongLayer = writeConformance(root, "wrong-layer", {
    ruleId: "LEDGER-R-001",
    layer: "fold",
    contract: "ledger-one-service",
  });
  const wrongContract = writeConformance(root, "wrong-contract", {
    ruleId: "LEDGER-R-001",
    contract: "not-the-contract",
  });

  const layerResult = run(rulesPath, [`open-4wd=${wrongLayer}`]);
  const contractResult = run(rulesPath, [`open-4wd=${wrongContract}`]);

  assert.equal(layerResult.status, 1);
  assert.match(layerResult.stderr, /錯誤 conformance/u);
  assert.equal(contractResult.status, 1);
  assert.match(contractResult.stderr, /錯誤 conformance/u);
});

test("conformance requires the dedicated filename and canonical harness import", () => {
  const { root, rulesPath } = fixture();
  const ordinary = writeSpec(
    root,
    "ordinary",
    'import { ruleConformance } from "./rule-conformance";\nruleConformance({ ruleId: "LEDGER-R-001", layer: "service", contract: "ledger-one-service" });\n',
  );
  const missingImport = writeConformance(root, "missing-import", {
    ruleId: "LEDGER-R-001",
    contract: "ledger-one-service",
    importHarness: false,
  });

  const ordinaryResult = run(rulesPath, [`open-4wd=${ordinary}`]);
  const importResult = run(rulesPath, [`open-4wd=${missingImport}`]);

  assert.equal(ordinaryResult.status, 1);
  assert.match(ordinaryResult.stderr, /錯誤 conformance/u);
  assert.equal(importResult.status, 1);
  assert.match(importResult.stderr, /錯誤 conformance/u);
});

test("duplicate conformance declarations fail deterministically", () => {
  const { root, rulesPath } = fixture();
  const first = writeConformance(root, "first", {
    ruleId: "LEDGER-R-001",
    contract: "ledger-one-service",
  });
  const second = writeConformance(root, "second", {
    ruleId: "LEDGER-R-001",
    contract: "ledger-one-service",
  });

  const result = run(rulesPath, [
    `open-4wd=${first}`,
    `open-4wd=${second}`,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /重複 conformance/u);
});
