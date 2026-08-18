import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { validateAuthoringSourceManifest } from "./authoring-source-manifest.mjs";

const SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ASSET_ID = /^builtin:[a-z0-9-]+$/u;
const RELEASE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const DIRECT_EXTENSIONS = new Set([".glb"]);
const IMAGE_EXTENSIONS = new Set([".png"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".flac"]);
const ZIP_UTF8 = 0x0800;

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let bit = 0; bit < 8; bit += 1)
    current =
      (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  return current >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function walkFiles(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(full);
      else
        throw new Error(
          `release input must contain only regular files: ${full}`,
        );
    }
  }
  await walk(root);
  return files;
}

function canonicalLogicalPath(root, path) {
  const logical = relative(root, path).split(sep).join("/").normalize("NFC");
  if (
    logical === "" ||
    logical.startsWith("/") ||
    logical.includes("\\") ||
    logical
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  )
    throw new Error(`non-canonical release input path: ${logical}`);
  return logical;
}

function writeZip(entries) {
  if (entries.length > 0xffff)
    throw new Error("archive contains too many files for deterministic ZIP32");
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const content = entry.bytes;
    if (content.length > 0xffffffff)
      throw new Error(`archive member exceeds ZIP32 limit: ${entry.path}`);
    const checksum = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(ZIP_UTF8, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(ZIP_UTF8, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + content.length;
    if (offset > 0xffffffff) throw new Error("archive exceeds ZIP32 limit");
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function validateSourceSha(sourceSha) {
  const normalized = String(sourceSha).trim().toLowerCase();
  if (!SHA.test(normalized))
    throw new Error(
      "source SHA must be an exact 40-character lowercase Git SHA",
    );
  return normalized;
}

export async function prepareAuthoringRelease({
  inputDirectory,
  outputDirectory,
  sourceSha,
  sourceManifest,
}) {
  const input = resolve(inputDirectory);
  const output = resolve(outputDirectory);
  const sourceCommit = validateSourceSha(sourceSha);
  if (sourceManifest === undefined)
    throw new Error("authoring source manifest is required");
  const sourceErrors = validateAuthoringSourceManifest(sourceManifest);
  if (sourceErrors.length > 0)
    throw new Error(
      `invalid authoring source manifest:\n${sourceErrors.join("\n")}`,
    );
  const inputInfo = await stat(input).catch(() => null);
  if (inputInfo === null || !inputInfo.isDirectory())
    throw new Error(`release input directory not found: ${input}`);
  await mkdir(output, { recursive: true });
  const existing = await readdir(output);
  if (existing.length > 0)
    throw new Error(`release output directory must be empty: ${output}`);

  const directNames = new Set();
  const sourceEntries = [];
  const grouped = { images: [], audio: [] };
  const sourceByLogicalPath = new Map(
    sourceManifest.assets.map((asset) => [
      asset.logicalPath.replace(/^release-input\//u, ""),
      asset,
    ]),
  );
  const matchedSourceIds = new Set();
  for (const full of await walkFiles(input)) {
    const extension = extname(full).toLocaleLowerCase("en-US");
    const logicalPath = canonicalLogicalPath(input, full);
    const info = await stat(full);
    const sourceEntry = {
      assetId: null,
      logicalPath,
      size: info.size,
      sha256: await sha256File(full),
      releaseAsset: null,
      archivePath: null,
    };
    if (DIRECT_EXTENSIONS.has(extension)) {
      const declared = sourceByLogicalPath.get(logicalPath);
      if (declared === undefined)
        throw new Error(
          `GLB is missing from the authoring source manifest: ${logicalPath}`,
        );
      if (declared !== undefined) {
        if (
          declared.releaseAsset !== basename(full) ||
          declared.sha256 !== sourceEntry.sha256 ||
          declared.size !== sourceEntry.size
        )
          throw new Error(
            `GLB differs from the authoring source manifest: ${logicalPath}`,
          );
        sourceEntry.assetId = declared.assetId;
        matchedSourceIds.add(declared.assetId);
      }
      const releaseAsset = basename(full);
      const collision = releaseAsset.toLocaleLowerCase("en-US");
      if (directNames.has(collision))
        throw new Error(`flat release asset collision: ${releaseAsset}`);
      directNames.add(collision);
      sourceEntry.releaseAsset = releaseAsset;
      await copyFile(full, join(output, releaseAsset));
    } else if (IMAGE_EXTENSIONS.has(extension)) {
      sourceEntry.releaseAsset = "authoring-images.zip";
      sourceEntry.archivePath = logicalPath;
      grouped.images.push({ path: logicalPath, bytes: await readFile(full) });
    } else if (AUDIO_EXTENSIONS.has(extension)) {
      sourceEntry.releaseAsset = "authoring-audio.zip";
      sourceEntry.archivePath = logicalPath;
      grouped.audio.push({ path: logicalPath, bytes: await readFile(full) });
    } else {
      throw new Error(`unsupported release input extension: ${logicalPath}`);
    }
    sourceEntries.push(sourceEntry);
  }
  if (matchedSourceIds.size !== sourceManifest.assets.length)
    throw new Error(
      "release input does not cover the authoring source manifest exact set",
    );
  if (sourceEntries.length === 0)
    throw new Error("release input must contain at least one asset");
  for (const [group, releaseAsset] of [
    [grouped.images, "authoring-images.zip"],
    [grouped.audio, "authoring-audio.zip"],
  ]) {
    if (group.length > 0)
      await writeFile(
        join(output, releaseAsset),
        writeZip(group.sort((a, b) => a.path.localeCompare(b.path, "en"))),
      );
  }

  sourceEntries.sort((a, b) =>
    a.logicalPath.localeCompare(b.logicalPath, "en"),
  );
  const releaseAssets = [];
  for (const name of (await readdir(output)).sort((a, b) =>
    a.localeCompare(b, "en"),
  )) {
    const full = join(output, name);
    const info = await stat(full);
    releaseAssets.push({
      name,
      size: info.size,
      sha256: await sha256File(full),
    });
  }
  const manifest = {
    schemaVersion: 1,
    releaseSeries: "authoring-source",
    sourceCommit,
    tag: `authoring-source-${sourceCommit.slice(0, 12)}`,
    inputs: sourceEntries,
    releaseAssets,
  };
  await writeFile(
    join(output, "authoring-release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(output, "SHA256SUMS"),
    `${releaseAssets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n")}\n`,
  );
  return manifest;
}

export async function verifyPreparedAuthoringRelease(outputDirectory) {
  const output = resolve(outputDirectory);
  const manifest = JSON.parse(
    await readFile(join(output, "authoring-release-manifest.json"), "utf8"),
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.releaseSeries !== "authoring-source"
  )
    throw new Error("invalid prepared authoring release manifest");
  validateSourceSha(manifest.sourceCommit);
  if (manifest.tag !== `authoring-source-${manifest.sourceCommit.slice(0, 12)}`)
    throw new Error(
      "prepared authoring release tag differs from source commit",
    );
  if (!Array.isArray(manifest.inputs) || manifest.inputs.length === 0)
    throw new Error(
      "prepared authoring release inputs must be a non-empty array",
    );
  if (
    !Array.isArray(manifest.releaseAssets) ||
    manifest.releaseAssets.length === 0
  )
    throw new Error(
      "prepared authoring release assets must be a non-empty array",
    );
  const releaseNames = new Set();
  for (const [index, asset] of manifest.releaseAssets.entries()) {
    if (
      asset === null ||
      typeof asset !== "object" ||
      Array.isArray(asset) ||
      Object.keys(asset).sort().join(",") !== "name,sha256,size" ||
      !RELEASE_ASSET.test(asset.name ?? "") ||
      basename(asset.name ?? "") !== asset.name ||
      asset.name === "SHA256SUMS" ||
      asset.name === "authoring-release-manifest.json" ||
      !SHA256.test(asset.sha256 ?? "") ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0
    )
      throw new Error(
        `prepared authoring release asset is invalid at index ${index}`,
      );
    const collisionKey = asset.name.toLocaleLowerCase("en-US");
    if (releaseNames.has(collisionKey))
      throw new Error(
        `prepared authoring release asset is duplicated: ${asset.name}`,
      );
    releaseNames.add(collisionKey);
  }
  const inputPaths = new Set();
  for (const [index, input] of manifest.inputs.entries()) {
    const extension = extname(input?.logicalPath ?? "").toLocaleLowerCase(
      "en-US",
    );
    const logicalPath = input?.logicalPath;
    const canonicalPath =
      typeof logicalPath === "string"
        ? canonicalLogicalPath(".", logicalPath)
        : "";
    const direct = DIRECT_EXTENSIONS.has(extension);
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).sort().join(",") !==
        "archivePath,assetId,logicalPath,releaseAsset,sha256,size" ||
      canonicalPath !== logicalPath ||
      !SHA256.test(input.sha256 ?? "") ||
      !Number.isSafeInteger(input.size) ||
      input.size <= 0 ||
      !RELEASE_ASSET.test(input.releaseAsset ?? "") ||
      !releaseNames.has(input.releaseAsset.toLocaleLowerCase("en-US")) ||
      (direct &&
        (!ASSET_ID.test(input.assetId ?? "") || input.archivePath !== null)) ||
      (!direct &&
        (input.assetId !== null || input.archivePath !== input.logicalPath))
    )
      throw new Error(
        `prepared authoring release input is invalid at index ${index}`,
      );
    const collisionKey = input.logicalPath.toLocaleLowerCase("en-US");
    if (inputPaths.has(collisionKey))
      throw new Error(
        `prepared authoring release input is duplicated: ${input.logicalPath}`,
      );
    inputPaths.add(collisionKey);
  }
  const actual = (await readdir(output)).sort();
  const expected = [
    "SHA256SUMS",
    "authoring-release-manifest.json",
    ...manifest.releaseAssets.map(({ name }) => name),
  ].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("prepared release asset set mismatch");
  for (const asset of manifest.releaseAssets) {
    const full = join(output, asset.name);
    const info = await stat(full);
    if (info.size !== asset.size || (await sha256File(full)) !== asset.sha256)
      throw new Error(
        `prepared release asset differs from manifest: ${asset.name}`,
      );
  }
  const sums = await readFile(join(output, "SHA256SUMS"), "utf8");
  const expectedSums = `${manifest.releaseAssets.map((asset) => `${asset.sha256}  ${asset.name}`).join("\n")}\n`;
  if (sums !== expectedSums)
    throw new Error("SHA256SUMS differs from release manifest");
  return manifest;
}
