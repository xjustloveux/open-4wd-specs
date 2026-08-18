import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GRAPHIFY_RELEASE_REPOSITORIES = Object.freeze([
  'open-4wd',
  'open-4wd-pinning',
  'open-4wd-signaling',
  'open-4wd-turn',
]);
const OWNER = 'xjustloveux';
const TAG = /^graphify-([0-9a-f]{12})$/u;
const SHA = /^[0-9a-f]{40}$/u;
const GRAPHIFY_VERSION = '0.9.25';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function headers() {
  const result = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10' };
  if (process.env.GH_TOKEN) result.Authorization = `Bearer ${process.env.GH_TOKEN}`;
  return result;
}

function extractStoreZip(bytes) {
  const files = new Map();
  let offset = 0;
  while (offset + 4 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > bytes.length) throw new Error('truncated ZIP local header');
    const flags = bytes.readUInt16LE(offset + 6);
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const compressedSize = bytes.readUInt32LE(offset + 22);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    if ((flags & 1) !== 0 || method !== 0 || size !== compressedSize) throw new Error('site ZIP must be unencrypted store-only ZIP32');
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error('truncated ZIP member');
    const name = bytes.subarray(nameStart, nameStart + nameLength).toString('utf8').normalize('NFC');
    if (!['graph.json', 'index.html'].includes(name) || files.has(name)) throw new Error(`unexpected or duplicate site ZIP member: ${name}`);
    files.set(name, bytes.subarray(dataStart, dataEnd));
    offset = dataEnd;
  }
  if (files.size !== 2) throw new Error('site ZIP must contain exactly graph.json and index.html');
  return files;
}

function validateManifest(manifest, repository, release) {
  const full = `${OWNER}/${repository}`;
  if (manifest?.schemaVersion !== 1 || manifest.repository !== full) throw new Error('manifest repository or schema differs');
  if (!SHA.test(manifest.sourceSha) || manifest.tag !== `graphify-${manifest.sourceSha.slice(0, 12)}` || manifest.tag !== release.tag_name)
    throw new Error('manifest source SHA and exact tag differ');
  if (manifest.graphifyVersion !== GRAPHIFY_VERSION) throw new Error('manifest Graphify version differs');
  if (new Date(manifest.generatedAt).toISOString() !== manifest.generatedAt) throw new Error('manifest generatedAt is not canonical');
  if (!Number.isSafeInteger(manifest.graph?.nodes) || manifest.graph.nodes < 0 || !Number.isSafeInteger(manifest.graph?.edges) || manifest.graph.edges < 0)
    throw new Error('manifest graph summary is invalid');
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 1 || manifest.assets[0].name !== 'graphify-site.zip')
    throw new Error('manifest asset contract differs');
  if (!/^[0-9a-f]{64}$/u.test(manifest.assets[0].sha256))
    throw new Error('manifest asset digest is invalid');
  if (!Number.isSafeInteger(manifest.assets[0].size) || manifest.assets[0].size < 1) throw new Error('manifest asset size is invalid');
  return manifest;
}

async function fetchBytes(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: headers(), redirect: 'follow' });
  if (!response.ok) throw new Error(`download returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function tryRelease({ cacheRoot, fetchImpl, repository, release, runName }) {
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  if (assets.size !== 2 || !assets.has('graphify-manifest.json') || !assets.has('graphify-site.zip')) throw new Error('Release asset exact-set differs');
  const manifestBytes = await fetchBytes(fetchImpl, assets.get('graphify-manifest.json').browser_download_url);
  const manifest = validateManifest(JSON.parse(manifestBytes.toString('utf8')), repository, release);
  const siteBytes = await fetchBytes(fetchImpl, assets.get('graphify-site.zip').browser_download_url);
  const expected = manifest.assets[0];
  if (siteBytes.length !== expected.size || sha256(siteBytes) !== expected.sha256) throw new Error('site ZIP differs from manifest');
  const files = extractStoreZip(siteBytes);
  const relativeDirectory = `${runName}/${repository}`;
  const siteDirectory = join(cacheRoot, relativeDirectory);
  await mkdir(siteDirectory, { recursive: true });
  for (const [name, bytes] of files) await writeFile(join(siteDirectory, name), bytes);
  await writeFile(join(siteDirectory, 'graphify-manifest.json'), manifestBytes);
  return { repository, status: 'available', tag: manifest.tag, sourceSha: manifest.sourceSha, generatedAt: manifest.generatedAt, graph: manifest.graph, siteDirectory: relativeDirectory.replaceAll('\\', '/') };
}

export async function refreshGraphifyReleases({ cacheRoot, fetchImpl = fetch } = {}) {
  const root = resolve(cacheRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '.graphify-releases'));
  await mkdir(root, { recursive: true });
  const runName = `run-${Date.now()}`;
  const results = [];
  for (const repository of GRAPHIFY_RELEASE_REPOSITORIES) {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${repository}/releases?per_page=100`, { headers: headers() });
      if (response.status === 404) {
        results.push({ repository, status: 'private', detail: 'repository is private or inaccessible' });
        continue;
      }
      if (!response.ok) {
        results.push({ repository, status: 'fetch-failed', detail: `release listing returned HTTP ${response.status}` });
        continue;
      }
      const releases = (await response.json())
        .filter((release) => !release.draft && !release.prerelease && TAG.test(release.tag_name))
        .sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)));
      if (releases.length === 0) {
        results.push({ repository, status: 'missing', detail: 'no published graphify-* Release' });
        continue;
      }
      let accepted = null;
      const errors = [];
      for (const release of releases) {
        try {
          accepted = await tryRelease({ cacheRoot: root, fetchImpl, repository, release, runName });
          break;
        } catch (error) {
          errors.push(`${release.tag_name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      results.push(accepted ?? { repository, status: 'invalid', detail: errors.join('; ') });
    } catch (error) {
      results.push({ repository, status: 'fetch-failed', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  await writeFile(join(root, 'status.json'), `${JSON.stringify({ schemaVersion: 1, refreshedAt: new Date().toISOString(), repositories: results }, null, 2)}\n`);
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await refreshGraphifyReleases();
  console.log(JSON.stringify(results));
}
