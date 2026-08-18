import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const text = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('PR/docs gate does not require LFS or download authoring master bytes', async () => {
  const [workflow, attributes] = await Promise.all([
    text('../.github/workflows/docs-ci.yml'),
    text('../.gitattributes'),
  ]);
  assert.match(attributes, /^\*\.glb binary$/mu);
  assert.doesNotMatch(attributes, /filter=lfs|git lfs/iu);
  assert.match(workflow, /lfs: false/u);
  assert.doesNotMatch(workflow, /check:authoring-source|candidate epoch|git lfs pull/iu);
});

test('docs gate installs dependencies before running the documentation tests', async () => {
  const workflow = await text('../.github/workflows/docs-ci.yml');
  const installIndex = workflow.indexOf('run: pnpm install --frozen-lockfile');
  const testIndex = workflow.indexOf('run: pnpm test:docs');

  assert.ok(installIndex >= 0, 'docs-ci 缺少 frozen-lockfile 安裝步驟');
  assert.ok(testIndex >= 0, 'docs-ci 缺少文檔測試');
  assert.ok(
    installIndex < testIndex,
    'verifyDepsBeforeRun:error 要求先安裝依賴，再執行 pnpm package script',
  );
});

test('GitHub workflow validates the contract but cannot publish authoring bytes', async () => {
  const workflow = await text('../.github/workflows/authoring-source-release.yml');
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /pull_request_target|pull_request:/u);
  assert.match(workflow, /lfs: false/u);
  assert.doesNotMatch(workflow, /lfs: true/u);
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /node --test scripts\/authoring-release\.test\.mjs/u);
  assert.doesNotMatch(workflow, /contents: write|git lfs|gh release|git tag|git push/iu);
});
