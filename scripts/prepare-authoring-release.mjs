import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareAuthoringRelease } from './authoring-release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const explicitSourceSha = option('--source-sha', null);
const sourceSha = explicitSourceSha ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const sourceManifest = JSON.parse(
  await readFile(resolve(root, '美術資源', 'authoring-source-manifest.json'), 'utf8'),
);
const manifest = await prepareAuthoringRelease({
  inputDirectory: option('--input', resolve(root, 'release-input')),
  outputDirectory: option('--output', resolve(root, 'release-output')),
  sourceSha,
  sourceManifest,
});
console.log(JSON.stringify({ tag: manifest.tag, inputs: manifest.inputs.length, assets: manifest.releaseAssets.length }));
