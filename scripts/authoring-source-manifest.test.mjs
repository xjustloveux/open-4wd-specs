import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  inspectAuthoringSourceTree,
  manifestFingerprint,
  releaseDescriptor,
  validateAuthoringSourceManifest,
  validateCandidateTransition,
} from "./authoring-source-manifest.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bytesA = Buffer.from("authoring-a");
const bytesB = Buffer.from("authoring-b");

const manifest = (overrides = {}) => ({
  schemaVersion: 1,
  candidateEpoch: 1,
  assets: [
    {
      assetId: "builtin:a",
      logicalPath: "release-input/parts/a/a.glb",
      releaseAsset: "a.glb",
      sha256: sha(bytesA),
      size: bytesA.length,
    },
    {
      assetId: "builtin:b",
      logicalPath: "release-input/tracks/b/b.glb",
      releaseAsset: "b.glb",
      sha256: sha(bytesB),
      size: bytesB.length,
    },
  ],
  ...overrides,
});

test("manifest validates a minimal source-only contract and derives stable release identity", () => {
  const current = manifest();
  assert.deepEqual(validateAuthoringSourceManifest(current), []);
  const reordered = { ...current, assets: [...current.assets].reverse() };
  assert.equal(manifestFingerprint(reordered), manifestFingerprint(current));
  assert.deepEqual(releaseDescriptor(current), {
    fingerprint: manifestFingerprint(current),
    manifestAsset: "authoring-source-manifest.json",
  });
});

test("manifest rejects duplicate identity, flat-name collisions, traversal, and non-canonical names", () => {
  const duplicate = manifest();
  duplicate.assets[1] = {
    ...duplicate.assets[1],
    assetId: duplicate.assets[0].assetId,
    releaseAsset: "A.glb",
    logicalPath: "release-input/parts/../a.glb",
  };
  const errors = validateAuthoringSourceManifest(duplicate);
  assert.ok(errors.some((error) => error.includes("duplicate assetId")));
  assert.ok(errors.some((error) => error.includes("releaseAsset collision")));
  assert.ok(errors.some((error) => error.includes("logicalPath")));
});

test("candidate epoch changes exactly once iff canonical payload changes", () => {
  const base = manifest();
  assert.deepEqual(validateCandidateTransition(base, manifest()), []);
  assert.ok(
    validateCandidateTransition(base, manifest({ candidateEpoch: 2 })).some(
      (error) => error.includes("must not change"),
    ),
  );
  const changed = manifest({
    candidateEpoch: 2,
    assets: base.assets.map((asset, index) =>
      index === 0 ? { ...asset, releaseAsset: "a-renamed.glb" } : asset,
    ),
  });
  assert.deepEqual(validateCandidateTransition(base, changed), []);
  assert.ok(
    validateCandidateTransition(base, { ...changed, candidateEpoch: 1 }).some(
      (error) => error.includes("must increment"),
    ),
  );
});

test("source inspection requires exact bytes and fails closed on set/hash drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "open4wd-authoring-manifest-"));
  const current = manifest();
  for (const asset of current.assets) {
    const path = join(root, asset.logicalPath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, asset.assetId === "builtin:a" ? bytesA : bytesB);
  }
  const result = await inspectAuthoringSourceTree(root, current);
  assert.deepEqual(result, { actual: ["builtin:a", "builtin:b"] });
  await writeFile(
    join(root, current.assets[1].logicalPath),
    Buffer.from("drift"),
  );
  await assert.rejects(
    inspectAuthoringSourceTree(root, current),
    /actual bytes differ/u,
  );
  await writeFile(join(root, current.assets[1].logicalPath), bytesB);
  await writeFile(join(root, "release-input/tracks/extra.glb"), bytesA);
  await assert.rejects(
    inspectAuthoringSourceTree(root, current),
    /unlisted GLB/u,
  );
});
