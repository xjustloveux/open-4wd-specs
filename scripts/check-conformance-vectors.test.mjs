import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkConformanceRepository,
  expectedConformanceDomains,
  renderFamilyIndex,
  validateVectorDocument,
} from './check-conformance-vectors.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const validDocument = {
  family: 'ledger/example',
  spec: ['資料系統.md'],
  formatVersion: 1,
  encoding: { bytes: 'hex-lower', bigint: 'decimal-string' },
  generatedBy: 'open-4wd@0.0.0',
  vectors: [{ name: 'example', input: {}, expected: {} }],
};

test('conformance envelope accepts formatVersion 1 without an edit counter', () => {
  assert.deepEqual(validateVectorDocument(validDocument, 'ledger/example'), []);
});

test('conformance envelope rejects legacy version and fixtureRevision fields', () => {
  assert.deepEqual(
    validateVectorDocument(
      { ...validDocument, version: 3, fixtureRevision: 4 },
      'ledger/example',
    ),
    [
      'ledger/example: legacy version field is forbidden',
      'ledger/example: fixtureRevision field is forbidden',
    ],
  );
});

test('family index projects ADR backlinks from decision vector metadata', () => {
  const rendered = renderFamilyIndex(
    [validDocument],
    new Map([
      [
        'ledger/example',
        [{ id: 'D-20990101-01', file: 'D-20990101-01-example.md' }],
      ],
    ]),
  );
  assert.match(rendered, /\| 家族 \| 綁定敘述 \| 決策 \| 格式 \|/u);
  assert.match(
    rendered,
    /\[D-20990101-01\]\(\.\.\/decisions\/D-20990101-01-example\.md\)/u,
  );
});

test('landing domains follow the stable cross-domain order for registered family prefixes', () => {
  assert.deepEqual(
    expectedConformanceDomains([
      { family: 'room/session' },
      { family: 'ledger/hash' },
      { family: 'moderation/panel-draw' },
      { family: 'physics/weather-aero' },
    ]),
    ['共識帳本', '建模物理', '比賽房間', '信譽仲裁'],
  );
});

test('repository vectors and generated family index have complete metadata parity', async () => {
  assert.deepEqual(await checkConformanceRepository(repoRoot), []);
});
