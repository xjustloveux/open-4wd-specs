import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AUTHORING_SOURCE_MANIFEST,
  deriveAuthoringSourceManifest,
  inspectAuthoringSourceTree,
  validateAuthoringSourceManifest,
} from './authoring-source-manifest.mjs';

export function renderAuthoringSourceManifest(manifest) {
  return `${JSON.stringify(
    {
      schemaVersion: manifest.schemaVersion,
      candidateEpoch: manifest.candidateEpoch,
      assets: [...manifest.assets]
        .map(({ assetId, logicalPath, releaseAsset, sha256, size }) => ({
          assetId,
          logicalPath,
          releaseAsset,
          sha256,
          size,
        }))
        .sort((left, right) => left.assetId.localeCompare(right.assetId, 'en')),
    },
    null,
    2,
  )}\n`;
}

export async function generateAuthoringSourceManifest(repositoryRoot, { check = false } = {}) {
  const path = resolve(repositoryRoot, AUTHORING_SOURCE_MANIFEST);
  let currentText;
  try {
    currentText = await readFile(path, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT' || check) throw error;
  }
  const manifest =
    currentText === undefined
      ? await deriveAuthoringSourceManifest(repositoryRoot, 1)
      : JSON.parse(currentText);
  const errors = validateAuthoringSourceManifest(manifest);
  if (errors.length > 0) throw new Error(errors.join('\n'));
  await inspectAuthoringSourceTree(repositoryRoot, manifest);
  const rendered = renderAuthoringSourceManifest(manifest);
  if (check && rendered !== currentText)
    throw new Error(`${AUTHORING_SOURCE_MANIFEST} is not deterministic; run generator`);
  if (!check && rendered !== currentText) await writeFile(path, rendered);
  return rendered;
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  await generateAuthoringSourceManifest(process.cwd(), { check: process.argv.includes('--check') })
    .then(() => process.stdout.write('authoring source manifest is deterministic\n'))
    .catch((error) => {
      console.error(
        `generate-authoring-source-manifest: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
