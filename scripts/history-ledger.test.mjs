import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as historyLedger from './history-ledger.mjs';
import {
  collectHistory,
  generateHistoryIndexes,
  renderMonthIndex,
  selectHistoryNavPages,
  validateHistoryLayout,
} from './history-ledger.mjs';

function dailyDocument(date, entries) {
  return `---
type: history
domain: []
summary: ${date} 重大重構里程碑流水帳
authority: null
slug: null
---
# 歷史記錄 · ${date}

> [月份索引](${date.slice(0, 7)}.md)｜[歷史記錄](../歷史記錄.md)

## 重大重構里程碑

${entries.map(({ title, body, importance }) => {
  const marker = importance == null ? '' : `\n<!-- homepage-milestone importance=${importance} -->`;
  return `### ${date} ─ ${title}${marker}\n\n${body}`;
}).join('\n\n')}
`;
}

function historyWorkspace(t) {
  const root = mkdtempSync(join(tmpdir(), 'open4wd-history-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '歷史記錄'));
  return root;
}

function milestone({ date, title, importance = 3, line = 1, block }) {
  return {
    date,
    title,
    milestoneImportance: importance,
    file: `歷史記錄/${date}.md`,
    line,
    slug: `${date}--${title}`,
    block: block ?? `### ${date} ─ ${title}\n<!-- homepage-milestone importance=${importance} -->\n\n${title}的摘要。`,
  };
}

test('collectHistory groups canonical daily entries without changing their blocks', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄', '2026-07-28.md'),
    dailyDocument('2026-07-28', [
      { title: '第一項', body: '第一段。' },
      {
        title: '第二項',
        body: '> 決策檔：[D-20260728-06](../decisions/D-20260728-06-example.md)\n\n另見 [D-20260728-07](../decisions/D-20260728-07-example.md)。',
      },
    ]),
  );
  writeFileSync(
    join(root, '歷史記錄', '2026-07-27.md'),
    dailyDocument('2026-07-27', [{ title: '前一日', body: '前一日內容。' }]),
  );

  const history = collectHistory(root);

  assert.deepEqual(history.entries.map((entry) => entry.title), ['第一項', '第二項', '前一日']);
  assert.equal(history.days.length, 2);
  assert.equal(history.months[0].month, '2026-07');
  assert.equal(history.months[0].entryCount, 3);
  assert.match(history.entries[1].block, /^### 2026-07-28 ─ 第二項/mu);
  assert.deepEqual([...history.entries[1].backrefs], ['D-20260728-06']);
});

test('collectHistory parses an exact homepage milestone marker immediately after its heading', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄', '2026-07-28.md'),
    dailyDocument('2026-07-28', [
      { title: '首頁事件', importance: 5, body: '內容。' },
      { title: '一般事件', body: '內容。' },
    ]),
  );

  const entries = collectHistory(root).entries;

  assert.equal(entries[0].milestoneImportance, 5);
  assert.equal(entries[1].milestoneImportance, null);
});

test('validateHistoryLayout rejects malformed misplaced and duplicate milestone markers', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄', '2026-07-28.md'),
    dailyDocument('2026-07-28', [
      { title: '壞標記', body: '<!-- homepage-milestone importance=6 -->\n\n內容。' },
      { title: '放錯位置', body: '內容。\n\n<!-- homepage-milestone importance=3 -->' },
      { title: '重複', importance: 4, body: '<!-- homepage-milestone importance=4 -->\n\n內容。' },
    ]),
  );

  const result = validateHistoryLayout(root);

  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join('\n'), /importance=6/u);
  assert.match(result.errors.join('\n'), /必須緊接在條目標題後/u);
  assert.match(result.errors.join('\n'), /重複 homepage-milestone/u);
});

test('validateHistoryLayout rejects a heading date that differs from its daily filename', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄', '2026-07-27.md'),
    dailyDocument('2026-07-28', [{ title: '放錯日期', body: '內容。' }]),
  );

  const result = validateHistoryLayout(root);

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    '歷史記錄/2026-07-27.md：條目日期 2026-07-28 與檔名日期 2026-07-27 不一致',
  ]);
});

test('validateHistoryLayout rejects legacy annual ledgers and entries inside month indexes', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(join(root, '歷史記錄', '2026.md'), '# 歷史記錄 · 2026\n');
  writeFileSync(
    join(root, '歷史記錄', '2026-07.md'),
    '# 歷史記錄 · 2026-07\n\n### 2026-07-28 ─ 不應放在月份索引\n',
  );

  const result = validateHistoryLayout(root);

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    '歷史記錄/2026.md：不再允許年度正文，請改用 YYYY-MM-DD.md 每日檔',
    '歷史記錄/2026-07.md：月份索引不可包含 canonical 歷史條目',
  ]);
});

test('renderMonthIndex links entry titles and orders recorded days newest first', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄', '2026-07-27.md'),
    dailyDocument('2026-07-27', [{ title: '前一日', body: '內容。' }]),
  );
  writeFileSync(
    join(root, '歷史記錄', '2026-07-28.md'),
    dailyDocument('2026-07-28', [{ title: '新項目', body: '內容。' }]),
  );
  const month = collectHistory(root).months[0];

  const rendered = renderMonthIndex(month);

  assert.match(rendered, /## 2026-07-28（1 條）[\s\S]*## 2026-07-27（1 條）/u);
  assert.match(rendered, /\[新項目\]\(2026-07-28\.md#2026-07-28--新項目\)/u);
});

test('generateHistoryIndexes check mode reports stale output without writing it', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄.md'),
    `# 歷史記錄\n\n<!-- history-month-index:start -->\n<!-- history-month-index:end -->\n`,
  );
  writeFileSync(
    join(root, '總覽.md'),
    `# 總覽\n\n<!-- homepage-timeline:start -->\n<!-- homepage-timeline:end -->\n`,
  );
  writeFileSync(
    join(root, '歷史記錄', '2026-07-28.md'),
    dailyDocument('2026-07-28', [{ title: '新項目', importance: 4, body: '內容。' }]),
  );

  const checked = generateHistoryIndexes(root, { check: true });

  assert.equal(checked.ok, false);
  assert.deepEqual(checked.stale, [
    '歷史記錄.md（月份索引）',
    '總覽.md（專案時間線）',
    '歷史記錄/2026-07.md',
  ]);
  assert.equal(checked.written.length, 0);
  assert.equal(collectHistory(root).historyFiles.includes('歷史記錄/2026-07.md'), false);

  const written = generateHistoryIndexes(root);
  assert.equal(written.ok, true);
  assert.deepEqual(written.written, [
    '歷史記錄.md（月份索引）',
    '總覽.md（專案時間線）',
    '歷史記錄/2026-07.md',
  ]);
  assert.match(readFileSync(join(root, '總覽.md'), 'utf8'), /新項目/u);
  assert.equal(generateHistoryIndexes(root, { check: true }).ok, true);
});

test('generateHistoryIndexes rejects a homepage without managed timeline fences', (t) => {
  const root = historyWorkspace(t);
  writeFileSync(
    join(root, '歷史記錄.md'),
    `# 歷史記錄\n\n<!-- history-month-index:start -->\n<!-- history-month-index:end -->\n`,
  );
  writeFileSync(join(root, '總覽.md'), '# 總覽\n');
  writeFileSync(
    join(root, '歷史記錄', '2026-07-28.md'),
    dailyDocument('2026-07-28', [{ title: '新項目', importance: 4, body: '內容。' }]),
  );

  assert.throws(
    () => generateHistoryIndexes(root),
    /總覽\.md 缺 homepage-timeline 生成圍欄/u,
  );
});

test('selectHistoryNavPages keeps only month indexes and orders newest first', () => {
  const pages = [
    { path: '歷史記錄/2026-06.md', type: 'history' },
    { path: '歷史記錄/2026-07-28.md', type: 'history' },
    { path: '歷史記錄/2026-07.md', type: 'history' },
    { path: '歷史記錄/README.md', type: 'history' },
  ];

  assert.deepEqual(
    selectHistoryNavPages(pages).map((page) => page.path),
    ['歷史記錄/2026-07.md', '歷史記錄/2026-06.md'],
  );
});

test('selectHomepageMilestones keeps all twelve entries and sorts oldest first', () => {
  const entries = Array.from({ length: 12 }, (_, index) => milestone({
    date: `2026-${String(index + 1).padStart(2, '0')}-01`,
    title: `事件 ${index + 1}`,
  })).reverse();

  const selected = historyLedger.selectHomepageMilestones?.(entries);

  assert.equal(selected?.length, 12);
  assert.equal(selected?.[0].date, '2026-01-01');
  assert.equal(selected?.at(-1).date, '2026-12-01');
});

test('selectHomepageMilestones compresses spans into month quarter half-year and year buckets', () => {
  const cases = [
    {
      name: 'month',
      dates: ['2026-01-01', '2026-01-20', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01'],
      expectedCount: 13,
    },
    {
      name: 'quarter',
      dates: ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01', '2026-02-01'],
      expectedCount: 6,
    },
    {
      name: 'half-year',
      dates: ['2024-01-01', '2024-03-01', '2024-05-01', '2024-07-01', '2024-09-01', '2024-11-01', '2025-01-01', '2025-03-01', '2025-05-01', '2025-07-01', '2025-09-01', '2025-11-01', '2026-02-01'],
      expectedCount: 6,
    },
    {
      name: 'year',
      dates: ['2022-01-01', '2022-05-01', '2022-09-01', '2023-01-01', '2023-05-01', '2023-09-01', '2024-01-01', '2024-05-01', '2024-09-01', '2025-01-01', '2025-05-01', '2025-09-01', '2026-02-01'],
      expectedCount: 6,
    },
  ];

  for (const sample of cases) {
    const entries = sample.dates.map((date, index) => milestone({ date, title: `${sample.name}-${index}` }));
    const selected = historyLedger.selectHomepageMilestones?.(entries);
    assert.equal(selected?.length, sample.expectedCount, sample.name);
  }
});

test('selectHomepageMilestones preserves anchors and applies deterministic bucket ties', () => {
  const fillers = Array.from({ length: 10 }, (_, index) => milestone({
    date: `2026-${String(index + 3).padStart(2, '0')}-01`,
    title: `填充事件 ${index + 1}`,
    importance: index === 1 ? 5 : 2,
  }));
  const entries = [
    milestone({ date: '2026-01-01', title: '最早', importance: 1 }),
    milestone({ date: '2026-02-01', title: '較低', importance: 3 }),
    milestone({ date: '2026-02-20', title: '乙標題', importance: 4 }),
    milestone({ date: '2026-02-20', title: '甲標題', importance: 4, line: 2 }),
    milestone({ date: '2026-04-15', title: '同月較早永久錨點', importance: 5, line: 2 }),
    milestone({ date: '2026-12-31', title: '最新', importance: 1, line: 2 }),
    ...fillers,
  ];

  const selected = historyLedger.selectHomepageMilestones?.(entries);

  assert.ok(selected?.some((entry) => entry.title === '最早'));
  assert.ok(selected?.some((entry) => entry.title === '同月較早永久錨點'));
  assert.ok(selected?.some((entry) => entry.title === '最新'));
  assert.ok(selected?.some((entry) => entry.title === '乙標題'));
  assert.ok(!selected?.some((entry) => entry.title === '甲標題'));
  assert.ok(!selected?.some((entry) => entry.title === '較低'));
});

test('extractMilestoneSummary returns first prose paragraph and a stable fallback', () => {
  const prose = milestone({
    date: '2026-04-28',
    title: '企劃基線',
    importance: 5,
    block: `### 2026-04-28 ─ 企劃基線
<!-- homepage-milestone importance=5 -->

> 決策檔：[D-20260428-01](../decisions/example.md)

**動機**：建立[模組化規格](../總覽.md)，保留 \`runtime_phase\`，形成可稽核基線。

| 欄位 | 值 |
|---|---|`,
  });
  const tableOnly = milestone({
    date: '2026-04-29',
    title: '只有表格',
    block: `### 2026-04-29 ─ 只有表格
<!-- homepage-milestone importance=4 -->

> 決策檔：[D-20260429-01](../decisions/example.md)

| 欄位 | 值 |
|---|---|`,
  });

  assert.equal(
    historyLedger.extractMilestoneSummary?.(prose),
    '動機：建立模組化規格，保留 runtime_phase，形成可稽核基線。',
  );
  assert.equal(
    historyLedger.extractMilestoneSummary?.(tableOnly),
    '查看完整歷史與相關決策。',
  );
});

test('renderHomepageTimeline emits semantic managed output in chronological order', () => {
  const rendered = historyLedger.renderHomepageTimeline?.([
    milestone({ date: '2026-08-11', title: '發布鏈', importance: 5 }),
    milestone({ date: '2026-04-28', title: '企劃基線', importance: 5 }),
  ]);

  assert.match(rendered ?? '', /<!-- homepage-timeline:start -->/u);
  assert.match(rendered ?? '', /<!-- markdownlint-disable MD033 -->/u);
  assert.match(rendered ?? '', /<!-- markdownlint-enable MD033 -->/u);
  assert.match(rendered ?? '', /<section class="o4-project-timeline"/u);
  assert.match(rendered ?? '', /<ol class="o4-project-timeline__list">/u);
  assert.match(rendered ?? '', /data-importance="5"/u);
  assert.match(rendered ?? '', /data-side="left"/u);
  assert.match(rendered ?? '', /data-side="right"/u);
  assert.match(
    rendered ?? '',
    /<p class="o4-project-timeline__title"><a href="歷史記錄\/2026-04-28\.md#.*"><strong>企劃基線<\/strong><\/a><\/p>/u,
  );
  assert.doesNotMatch(rendered ?? '', /markdown=|\*\*\[/u);
  assert.match(rendered ?? '', /<!-- homepage-timeline:end -->/u);
  assert.ok((rendered ?? '').indexOf('企劃基線') < (rendered ?? '').indexOf('發布鏈'));
});
