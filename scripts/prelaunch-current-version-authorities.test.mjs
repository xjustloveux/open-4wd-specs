import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPrelaunchActiveCanonCorpus,
  checkPrelaunchAuthorityContent,
  checkRepositoryPrelaunchCanon,
  isPrelaunchActiveCanonPath,
} from "./prelaunch-current-version-authorities.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const registry = {
  authorities: [{ id: "owned", file: "current.md", pattern: "Owned v(\\d+)" }],
  forbiddenCurrentLabels: [
    { id: "fixture", file: "current.md", pattern: "fixture-v[2-9]" },
  ],
  activeCanonCorpus: {
    excludePrefixes: ["decisions/", "歷史記錄/"],
    excludeFiles: ["歷史記錄.md"],
    thirdPartyAllowlist: [{ id: "relay", pattern: "\\bCircuit Relay v2\\b" }],
    forbiddenLabels: [
      {
        id: "physics",
        pattern: "\\bPhysicsManifest\\s+v(?:[2-9]|[1-9][0-9]+)\\b",
      },
    ],
  },
};

test("pre-launch owned v2 current canon is rejected", () => {
  assert.deepEqual(
    checkPrelaunchAuthorityContent(
      registry,
      new Map([["current.md", "Owned v2"]]),
    ),
    ["owned: pre-launch current baseline is 2"],
  );
});

test("third-party v2 and UUID v4 do not affect an owned v1 authority", () => {
  assert.deepEqual(
    checkPrelaunchAuthorityContent(
      registry,
      new Map([["current.md", "Owned v1; Circuit Relay v2; UUID v4"]]),
    ),
    [],
  );
});

test("active canon corpus rejects owned v2 labels outside authority files", () => {
  assert.deepEqual(
    checkPrelaunchActiveCanonCorpus(
      registry,
      new Map([
        ["程式架構/example.md", "Current PhysicsManifest v9 is accepted."],
        [
          "程式架構/transport.md",
          "Circuit Relay v2 remains the external standard.",
        ],
      ]),
    ),
    ["physics: 程式架構/example.md:1 active internal v2+ label remains"],
  );
});

test("active canon path filter excludes decisions and history only", () => {
  assert.equal(
    isPrelaunchActiveCanonPath(registry, "程式架構/example.md"),
    true,
  );
  assert.equal(
    isPrelaunchActiveCanonPath(registry, "decisions/D-example.md"),
    false,
  );
  assert.equal(
    isPrelaunchActiveCanonPath(registry, "歷史記錄/2026-08-18.md"),
    false,
  );
  assert.equal(isPrelaunchActiveCanonPath(registry, "歷史記錄.md"), false);
});

test("current specs canon matches the pre-launch authority registry", async () => {
  assert.deepEqual(await checkRepositoryPrelaunchCanon(), []);
});

test("registry covers every Open4WD-owned pre-launch current baseline family", async () => {
  const registry = JSON.parse(
    await readFile(
      join(repoRoot, "scripts", "prelaunch-current-version-authorities.json"),
      "utf8",
    ),
  );
  const authorityIds = new Set(registry.authorities.map(({ id }) => id));

  assert.deepEqual(
    [
      "asset-schema-current",
      "physics-manifest-current",
      "saved-state-current",
      "builtin-assets-current",
      "checkpoint-current",
      "graphify-release-manifest-current",
      "unified-db-current",
    ].filter((id) => !authorityIds.has(id)),
    [],
  );
});

test("pre-launch version authority gate is part of the package and CI checks", async () => {
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  );
  const workflow = await readFile(
    join(repoRoot, ".github", "workflows", "docs-ci.yml"),
    "utf8",
  );

  assert.match(packageJson.scripts.check, /pnpm run check:prelaunch-versions/u);
  assert.match(workflow, /^\s*run:\s*pnpm check:prelaunch-versions\s*$/mu);
});
