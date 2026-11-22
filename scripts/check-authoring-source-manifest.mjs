import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AUTHORING_SOURCE_MANIFEST,
  inspectAuthoringSourceTree,
  releaseDescriptor,
  validateAuthoringSourceManifest,
  validateCandidateTransition,
} from "./authoring-source-manifest.mjs";

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  if (args[index + 1] === undefined)
    throw new Error(`${flag} requires a value`);
  return args[index + 1];
};

export async function checkAuthoringSourceManifest(
  args,
  repositoryRoot = process.cwd(),
) {
  const manifestPath = resolve(
    repositoryRoot,
    valueAfter(args, "--manifest") ?? AUTHORING_SOURCE_MANIFEST,
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const errors = validateAuthoringSourceManifest(manifest);
  const basePath = valueAfter(args, "--base");
  if (basePath !== undefined) {
    const base = JSON.parse(
      await readFile(resolve(repositoryRoot, basePath), "utf8"),
    );
    errors.push(...validateCandidateTransition(base, manifest));
  }
  const samePath = valueAfter(args, "--assert-same");
  if (samePath !== undefined) {
    const other = JSON.parse(
      await readFile(resolve(repositoryRoot, samePath), "utf8"),
    );
    if (
      other.candidateEpoch !== manifest.candidateEpoch ||
      releaseDescriptor(other).fingerprint !==
        releaseDescriptor(manifest).fingerprint
    )
      errors.push(
        "comparison manifest does not describe the same desired state",
      );
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));

  if (args.includes("--list-paths")) {
    return manifest.assets.map((asset) => asset.logicalPath).join(",");
  }
  if (args.includes("--upload-tsv")) {
    return manifest.assets
      .map((asset) => `${asset.logicalPath}\t${asset.releaseAsset}`)
      .join("\n");
  }

  const sources = await inspectAuthoringSourceTree(repositoryRoot, manifest);
  const result = {
    ...releaseDescriptor(manifest),
    candidateEpoch: manifest.candidateEpoch,
    sourceCount: manifest.assets.length,
    actualCount: sources.actual.length,
  };
  const outputPath = valueAfter(args, "--output");
  if (outputPath !== undefined)
    await writeFile(
      resolve(repositoryRoot, outputPath),
      `${JSON.stringify(result, null, 2)}\n`,
    );
  return JSON.stringify(result, null, 2);
}

async function main() {
  process.stdout.write(
    `${await checkAuthoringSourceManifest(process.argv.slice(2))}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main().catch((error) => {
    console.error(
      `check-authoring-source-manifest: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
