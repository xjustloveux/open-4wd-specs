import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatterBlock } from './lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- conformance-family-index:start -->';
const END = '<!-- conformance-family-index:end -->';
const ENCODING = { bytes: 'hex-lower', bigint: 'decimal-string' };
const CONFORMANCE_DOMAIN_BY_PREFIX = new Map([
  ['ledger', '共識帳本'],
  ['physics', '建模物理'],
  ['room', '比賽房間'],
  ['moderation', '信譽仲裁'],
]);

export function expectedConformanceDomains(documents) {
  const presentPrefixes = new Set(documents.map(({ family }) => family.split('/')[0]));
  return [...CONFORMANCE_DOMAIN_BY_PREFIX]
    .filter(([prefix]) => presentPrefixes.has(prefix))
    .map(([, domain]) => domain);
}

async function walkVectorFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkVectorFiles(target)));
    else if (entry.isFile() && entry.name.endsWith('.vectors.json')) files.push(target);
  }
  return files.sort();
}

export function validateVectorDocument(document, expectedFamily) {
  const label = expectedFamily;
  const violations = [];
  if (document.family !== expectedFamily)
    violations.push(`${label}: family must match its repository path`);
  if (document.formatVersion !== 1)
    violations.push(`${label}: formatVersion must be 1`);
  if (Object.hasOwn(document, 'version'))
    violations.push(`${label}: legacy version field is forbidden`);
  if (Object.hasOwn(document, 'fixtureRevision'))
    violations.push(`${label}: fixtureRevision field is forbidden`);
  if (
    !Array.isArray(document.spec) ||
    document.spec.length === 0 ||
    document.spec.some((path) => typeof path !== 'string' || path.length === 0)
  )
    violations.push(`${label}: spec must be a non-empty path list`);
  if (JSON.stringify(document.encoding) !== JSON.stringify(ENCODING))
    violations.push(`${label}: encoding metadata is incomplete`);
  if (typeof document.generatedBy !== 'string' || !/^[^@\s]+@[^@\s]+$/u.test(document.generatedBy))
    violations.push(`${label}: generatedBy must identify generator and version`);
  if (
    !Array.isArray(document.vectors) ||
    document.vectors.length === 0 ||
    document.vectors.some((vector) => typeof vector?.name !== 'string' || vector.name.length === 0)
  )
    violations.push(`${label}: vectors must contain named cases`);
  else if (new Set(document.vectors.map(({ name }) => name)).size !== document.vectors.length)
    violations.push(`${label}: vector names must be unique`);
  return violations;
}

const linkedSpec = (path) => `[${path}](../${path.replaceAll('\\', '/')})`;

const linkedDecision = ({ id, file }) => `[${id}](../decisions/${file})`;

export function renderFamilyIndex(documents, decisionRefs = new Map()) {
  const rows = documents
    .toSorted((left, right) => left.family.localeCompare(right.family, 'en'))
    .map(
      (document) =>
        `| \`${document.family}\` | ${document.spec.map(linkedSpec).join('／')} | ${(decisionRefs.get(document.family) ?? []).map(linkedDecision).join('／') || '—'} | format v1 |`,
    );
  return [
    START,
    '| 家族 | 綁定敘述 | 決策 | 格式 |',
    '| --- | --- | --- | --- |',
    ...rows,
    END,
  ].join('\n');
}

export async function readDecisionVectorRefs(root = repoRoot) {
  const directory = join(root, 'decisions');
  const refs = new Map();
  for (const file of (await readdir(directory)).filter((name) => /^D-.*\.md$/u.test(name)).sort()) {
    const { fm } = parseFrontmatterBlock(await readFile(join(directory, file), 'utf8'));
    if (!fm || !Array.isArray(fm.vectors)) continue;
    for (const family of fm.vectors) {
      const entries = refs.get(family) ?? [];
      entries.push({ id: fm.id, file });
      refs.set(family, entries);
    }
  }
  return refs;
}

function replaceFamilyIndex(readme, rendered) {
  const managed = new RegExp(`${START}[\\s\\S]*?${END}`, 'u');
  if (managed.test(readme)) return readme.replace(managed, rendered);
  const heading = '## 家族索引';
  const start = readme.indexOf(heading);
  if (start < 0) throw new Error('conformance README 缺少家族索引標題');
  return `${readme.slice(0, start)}${heading}\n\n${rendered}\n`;
}

export async function readConformanceDocuments(root = repoRoot) {
  const directory = join(root, 'conformance');
  const documents = [];
  for (const file of await walkVectorFiles(directory)) {
    const path = relative(directory, file).split(sep).join('/');
    const expectedFamily = path.replace(/\.vectors\.json$/u, '');
    documents.push({
      file,
      expectedFamily,
      document: JSON.parse(await readFile(file, 'utf8')),
    });
  }
  return documents;
}

export async function checkConformanceRepository(root = repoRoot) {
  const entries = await readConformanceDocuments(root);
  const violations = [];
  const families = new Set();
  for (const { expectedFamily, document } of entries) {
    violations.push(...validateVectorDocument(document, expectedFamily));
    if (families.has(document.family)) violations.push(`${document.family}: duplicate family`);
    families.add(document.family);
    for (const specPath of Array.isArray(document.spec) ? document.spec : []) {
      if (
        specPath.includes('\\') ||
        specPath.startsWith('/') ||
        /^[A-Za-z]:/u.test(specPath) ||
        specPath.split('/').includes('..')
      ) {
        violations.push(`${expectedFamily}: unsafe spec path ${specPath}`);
        continue;
      }
      try {
        if (!(await stat(join(root, specPath))).isFile())
          violations.push(`${expectedFamily}: spec is not a file ${specPath}`);
      } catch {
        violations.push(`${expectedFamily}: missing spec ${specPath}`);
      }
    }
  }
  const readmePath = join(root, 'conformance', 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const { fm: landingMetadata } = parseFrontmatterBlock(readme);
  const documents = entries.map(({ document }) => document);
  const knownPrefixes = new Set(CONFORMANCE_DOMAIN_BY_PREFIX.keys());
  for (const prefix of new Set(documents.map(({ family }) => family.split('/')[0]))) {
    if (!knownPrefixes.has(prefix))
      violations.push(`conformance/README.md: family prefix has no landing domain mapping: ${prefix}`);
  }
  if (
    JSON.stringify(landingMetadata?.domain) !==
    JSON.stringify(expectedConformanceDomains(documents))
  )
    violations.push('conformance/README.md: landing domains do not match registered families');
  const expected = renderFamilyIndex(
    documents,
    await readDecisionVectorRefs(root),
  );
  if (!readme.includes(expected)) violations.push('conformance/README.md: generated family index is stale');
  return violations;
}

export async function writeConformanceIndex(root = repoRoot) {
  const entries = await readConformanceDocuments(root);
  const readmePath = join(root, 'conformance', 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const rendered = renderFamilyIndex(
    entries.map(({ document }) => document),
    await readDecisionVectorRefs(root),
  );
  await writeFile(readmePath, replaceFamilyIndex(readme, rendered));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) {
    await writeConformanceIndex();
    console.log('conformance family index generated');
  } else {
    const violations = await checkConformanceRepository();
    if (violations.length > 0) {
      for (const violation of violations) console.error(violation);
      process.exitCode = 1;
    } else {
      console.log('conformance vector metadata and family index verified');
    }
  }
}
