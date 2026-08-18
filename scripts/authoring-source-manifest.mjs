import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, posix, relative, resolve, sep } from "node:path";

export const AUTHORING_SOURCE_MANIFEST =
  "美術資源/authoring-source-manifest.json";
export const AUTHORING_SOURCE_ROOT = "release-input";
const SHA256 = /^[0-9a-f]{64}$/u;
const ASSET_ID = /^builtin:[a-z0-9-]+$/u;
const RELEASE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]*\.glb$/u;

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function canonicalAsset(asset) {
  return {
    assetId: asset.assetId,
    logicalPath: asset.logicalPath,
    releaseAsset: asset.releaseAsset,
    sha256: asset.sha256,
    size: asset.size,
  };
}

/** candidateEpoch 不屬 payload；它只證明 payload 變更次序。 */
export function canonicalManifestPayload(manifest) {
  return JSON.stringify({
    schemaVersion: manifest.schemaVersion,
    assets: [...manifest.assets]
      .map(canonicalAsset)
      .sort((left, right) => left.assetId.localeCompare(right.assetId, "en")),
  });
}

export function manifestFingerprint(manifest) {
  return createHash("sha256")
    .update(canonicalManifestPayload(manifest))
    .digest("hex");
}

export function releaseDescriptor(manifest) {
  return {
    fingerprint: manifestFingerprint(manifest),
    manifestAsset: "authoring-source-manifest.json",
  };
}

export function validateAuthoringSourceManifest(manifest) {
  if (!isRecord(manifest)) return ["manifest must be an object"];
  const errors = [];
  const topKeys = Object.keys(manifest).sort().join(",");
  if (topKeys !== "assets,candidateEpoch,schemaVersion")
    errors.push(
      "manifest must contain only assets, candidateEpoch, and schemaVersion",
    );
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (
    !Number.isSafeInteger(manifest.candidateEpoch) ||
    manifest.candidateEpoch < 1
  )
    errors.push("candidateEpoch must be a positive integer");
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    errors.push("assets must be a non-empty array");
    return errors;
  }

  const ids = new Set();
  const paths = new Set();
  const normalizedPaths = new Set();
  const releaseAssets = new Set();
  for (const [index, asset] of manifest.assets.entries()) {
    const label = `assets[${index}]`;
    if (!isRecord(asset)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (
      Object.keys(asset).sort().join(",") !==
      "assetId,logicalPath,releaseAsset,sha256,size"
    )
      errors.push(`${label} must contain only source distribution fields`);

    if (!ASSET_ID.test(asset.assetId ?? ""))
      errors.push(`${label}.assetId is invalid`);
    else if (ids.has(asset.assetId))
      errors.push(`${label} duplicate assetId ${asset.assetId}`);
    else ids.add(asset.assetId);

    const logicalPath = asset.logicalPath;
    const canonicalPath =
      typeof logicalPath === "string" ? posix.normalize(logicalPath) : "";
    const pathSegments =
      typeof logicalPath === "string" ? logicalPath.split("/") : [];
    if (
      typeof logicalPath !== "string" ||
      logicalPath !== logicalPath.normalize("NFC") ||
      canonicalPath !== logicalPath ||
      !logicalPath.startsWith(`${AUTHORING_SOURCE_ROOT}/`) ||
      !logicalPath.endsWith(".glb") ||
      logicalPath.includes("\\") ||
      pathSegments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    )
      errors.push(
        `${label}.logicalPath is not a canonical classified GLB path`,
      );
    else {
      if (paths.has(logicalPath))
        errors.push(`${label} duplicate logicalPath ${logicalPath}`);
      paths.add(logicalPath);
      const collisionKey = logicalPath
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (normalizedPaths.has(collisionKey))
        errors.push(`${label} logicalPath name collision`);
      normalizedPaths.add(collisionKey);
    }

    if (
      !RELEASE_ASSET.test(asset.releaseAsset ?? "") ||
      basename(asset.releaseAsset) !== asset.releaseAsset
    )
      errors.push(`${label}.releaseAsset must be a flat ASCII .glb name`);
    else {
      const collisionKey = asset.releaseAsset.toLocaleLowerCase("en-US");
      if (releaseAssets.has(collisionKey))
        errors.push(`${label} releaseAsset collision`);
      releaseAssets.add(collisionKey);
    }
    if (!SHA256.test(asset.sha256 ?? ""))
      errors.push(`${label}.sha256 is invalid`);
    if (!Number.isSafeInteger(asset.size) || asset.size <= 0)
      errors.push(`${label}.size must be a positive integer`);
  }
  return errors;
}

export function validateCandidateTransition(base, current) {
  const errors = [
    ...validateAuthoringSourceManifest(base).map((error) => `base: ${error}`),
    ...validateAuthoringSourceManifest(current).map(
      (error) => `current: ${error}`,
    ),
  ];
  if (errors.length > 0) return errors;
  const changed = manifestFingerprint(base) !== manifestFingerprint(current);
  if (!changed && base.candidateEpoch !== current.candidateEpoch)
    errors.push(
      "candidateEpoch must not change when canonical payload is unchanged",
    );
  if (changed && current.candidateEpoch !== base.candidateEpoch + 1)
    errors.push(
      "candidateEpoch must increment exactly once when canonical payload changes",
    );
  return errors;
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function glbFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (
        entry.isFile() &&
        entry.name.toLocaleLowerCase("en-US").endsWith(".glb")
      )
        files.push(path);
    }
  }
  await walk(root);
  return files;
}

const VARIANT_SUFFIX = new Map([
  ["speed", "01"],
  ["heavy", "02"],
  ["control", "03"],
]);
const TRACK_ID = new Map([
  ["track-snowy-field", "builtin:track-01"],
  ["track-urban-circuit", "builtin:track-02"],
  ["track-jungle-mud", "builtin:track-03"],
]);

function assetIdForSource(path) {
  const stem = basename(path, ".glb");
  const part =
    /^part-(chassis|body|tire|motor|battery|roller|chip)-(speed|heavy|control)$/u.exec(
      stem,
    );
  if (part !== null) return `builtin:${part[1]}-${VARIANT_SUFFIX.get(part[2])}`;
  if (stem === "part-weapon-speed") return "builtin:weapon-01";
  if (stem === "part-weapon-ugc-blade") return "builtin:weapon-02";
  if (stem === "part-weapon-control") return "builtin:weapon-03";
  const trackId = TRACK_ID.get(stem);
  if (trackId !== undefined) return trackId;
  throw new Error(`source path has no stable assetId mapping: ${path}`);
}

/** 第一次建立 manifest 時由既定分類命名推導；後續 manifest 本身為 source authority。 */
export async function deriveAuthoringSourceManifest(
  repositoryRoot,
  candidateEpoch = 1,
) {
  const root = resolve(repositoryRoot);
  const assets = [];
  for (const path of await glbFiles(join(root, AUTHORING_SOURCE_ROOT))) {
    const logicalPath = relative(root, path).split(sep).join("/");
    const info = await stat(path);
    assets.push({
      assetId: assetIdForSource(path),
      logicalPath,
      releaseAsset: basename(path),
      sha256: await sha256File(path),
      size: info.size,
    });
  }
  const manifest = { schemaVersion: 1, candidateEpoch, assets };
  const errors = validateAuthoringSourceManifest(manifest);
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return manifest;
}

export async function inspectAuthoringSourceTree(repositoryRoot, manifest) {
  const validation = validateAuthoringSourceManifest(manifest);
  if (validation.length > 0) throw new Error(validation.join("\n"));
  const root = resolve(repositoryRoot);
  const expectedPaths = new Set(
    manifest.assets.map((asset) => asset.logicalPath),
  );
  const actualPaths = (await glbFiles(join(root, AUTHORING_SOURCE_ROOT))).map(
    (path) => relative(root, path).split(sep).join("/"),
  );
  const unlisted = actualPaths.filter((path) => !expectedPaths.has(path));
  const missing = [...expectedPaths].filter(
    (path) => !actualPaths.includes(path),
  );
  if (unlisted.length > 0 || missing.length > 0)
    throw new Error(
      [
        ...unlisted.map((path) => `unlisted GLB: ${path}`),
        ...missing.map((path) => `missing GLB: ${path}`),
      ].join("\n"),
    );

  const actual = [];
  for (const asset of manifest.assets) {
    const path = join(root, asset.logicalPath);
    const info = await stat(path);
    if (info.size !== asset.size || (await sha256File(path)) !== asset.sha256)
      throw new Error(`${asset.assetId} actual bytes differ from manifest`);
    actual.push(asset.assetId);
  }
  return { actual: actual.sort() };
}
