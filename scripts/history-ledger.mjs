import fs from 'node:fs';
import path from 'node:path';
import { slugify } from './lib.mjs';

export const DAY_FILE_RE = /^(?<date>\d{4}-\d{2}-\d{2})\.md$/u;
export const MONTH_FILE_RE = /^(?<month>\d{4}-\d{2})\.md$/u;
export const YEAR_FILE_RE = /^\d{4}\.md$/u;
export const ENTRY_RE = /^### (?<date>\d{4}-\d{2}-\d{2})[^─]*─\s*(?<title>.+)$/u;
export const HOMEPAGE_MILESTONE_MARKER_RE = /^<!-- homepage-milestone importance=(?<importance>[1-5]) -->$/u;
export const HOMEPAGE_TIMELINE_LIMIT = 12;
const HOMEPAGE_MILESTONE_CANDIDATE_RE = /homepage-milestone/u;

const compareChronologically = (left, right) =>
  left.date.localeCompare(right.date) ||
  left.file.localeCompare(right.file) ||
  left.line - right.line;

const compareMilestoneRank = (left, right) =>
  right.milestoneImportance - left.milestoneImportance ||
  right.date.localeCompare(left.date) ||
  left.title.localeCompare(right.title, 'zh-Hant') ||
  left.file.localeCompare(right.file) ||
  left.line - right.line;

function milestoneBucket(entry, monthSpan) {
  const year = Number(entry.date.slice(0, 4));
  const month = Number(entry.date.slice(5, 7));
  if (monthSpan <= 12) return entry.date.slice(0, 7);
  if (monthSpan <= 24) return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  if (monthSpan <= 36) return `${year}-H${month <= 6 ? 1 : 2}`;
  return String(year);
}

export function selectHomepageMilestones(entries, { limit = HOMEPAGE_TIMELINE_LIMIT } = {}) {
  const marked = entries
    .filter((entry) => Number.isInteger(entry.milestoneImportance) && entry.milestoneImportance >= 1 && entry.milestoneImportance <= 5)
    .sort(compareChronologically);
  if (marked.length <= limit) return marked;

  const first = marked[0];
  const last = marked.at(-1);
  const startYear = Number(first.date.slice(0, 4));
  const startMonth = Number(first.date.slice(5, 7));
  const endYear = Number(last.date.slice(0, 4));
  const endMonth = Number(last.date.slice(5, 7));
  const monthSpan = (endYear - startYear) * 12 + endMonth - startMonth;
  const bucketWinners = new Map();
  for (const entry of marked) {
    const bucket = milestoneBucket(entry, monthSpan);
    const current = bucketWinners.get(bucket);
    if (!current || compareMilestoneRank(entry, current) < 0) bucketWinners.set(bucket, entry);
  }

  const selected = new Map();
  const retain = (entry) => selected.set(`${entry.file}:${entry.line}`, entry);
  for (const entry of bucketWinners.values()) retain(entry);
  for (const entry of marked.filter((candidate) => candidate.milestoneImportance === 5)) retain(entry);
  retain(first);
  retain(last);
  return [...selected.values()].sort(compareChronologically);
}

export function extractMilestoneSummary(entry) {
  const paragraphs = entry.block.replace(/\r\n/gu, '\n').split(/\n\s*\n/gu);
  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (lines.some((line) =>
      line.startsWith('#') ||
      line.startsWith('>') ||
      line.startsWith('|') ||
      line.startsWith('<!--') ||
      line.startsWith('```') ||
      /^[-+*]\s/u.test(line) ||
      /^\d+\.\s/u.test(line))) continue;
    const plain = lines.join(' ')
      .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
      .replace(/\*\*|__/gu, '')
      .replace(/`/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();
    if (!plain) continue;
    const codePoints = [...plain];
    return codePoints.length <= 160 ? plain : `${codePoints.slice(0, 159).join('').trimEnd()}…`;
  }
  return '查看完整歷史與相關決策。';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderHomepageTimeline(entries) {
  const ordered = [...entries].sort(compareChronologically);
  const lines = [
    '<!-- homepage-timeline:start -->',
    '<!-- 本區以下至 end 標記由 `pnpm history:generate` 生成，請勿手動編輯。 -->',
    '<!-- markdownlint-disable MD033 -->',
    '',
    '## 專案沿革',
    '',
    '從目前最早可稽核的企劃基線一路走到現在；完整流水帳與所有技術細節見 [歷史記錄](歷史記錄.md)。',
    '',
    '<section class="o4-project-timeline" aria-labelledby="專案沿革">',
    '<ol class="o4-project-timeline__list">',
  ];
  let currentYear = null;
  let eventIndex = 0;
  for (const entry of ordered) {
    const year = entry.date.slice(0, 4);
    if (year !== currentYear) {
      currentYear = year;
      lines.push(
        `<li class="o4-project-timeline__year" aria-label="${year}"><span>${year}</span></li>`,
      );
    }
    const side = eventIndex % 2 === 0 ? 'left' : 'right';
    const href = `${entry.file}#${entry.slug}`;
    lines.push(
      `<li class="o4-project-timeline__item" data-importance="${entry.milestoneImportance}" data-side="${side}">`,
      `<time class="o4-project-timeline__date" datetime="${entry.date}">${entry.date.replaceAll('-', '.')}</time>`,
      `<p class="o4-project-timeline__title"><a href="${escapeHtml(href)}"><strong>${escapeHtml(entry.title)}</strong></a></p>`,
      `<p>${escapeHtml(extractMilestoneSummary(entry))}</p>`,
      '</li>',
    );
    eventIndex += 1;
  }
  lines.push(
    '</ol>',
    '</section>',
    '<!-- markdownlint-enable MD033 -->',
    '',
    '<!-- homepage-timeline:end -->',
  );
  return lines.join('\n');
}

function parseDailyFile(repoRoot, fileName) {
  const filePath = path.join(repoRoot, '歷史記錄', fileName);
  const relativeFile = `歷史記錄/${fileName}`;
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headings = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(ENTRY_RE);
    if (match) headings.push({ index, match });
  }
  const slugCounts = new Map();
  return headings.map(({ index, match }, position) => {
    const end = headings[position + 1]?.index ?? lines.length;
    const entryLines = lines.slice(index, end);
    const block = entryLines.join('\n').trimEnd();
    const baseSlug = slugify(lines[index].slice(4));
    const slugOccurrence = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, slugOccurrence + 1);
    const backrefs = new Set();
    for (const decisionLine of block.matchAll(/^>\s*決策檔：(.*)$/gmu)) {
      for (const backref of decisionLine[1].matchAll(/\[(D-\d{8}-\d{2})\]/gu)) {
        backrefs.add(backref[1]);
      }
    }
    const markerOffsets = entryLines
      .map((line, offset) => ({ line, offset }))
      .filter(({ line }) => HOMEPAGE_MILESTONE_CANDIDATE_RE.test(line));
    const markerErrors = [];
    let milestoneImportance = null;
    if (markerOffsets.length > 1) {
      markerErrors.push(`${relativeFile}:${index + 1}：條目「${match.groups.title.trim()}」重複 homepage-milestone 標記`);
    } else if (markerOffsets.length === 1) {
      const marker = markerOffsets[0];
      const markerMatch = marker.line.match(HOMEPAGE_MILESTONE_MARKER_RE);
      if (!markerMatch) {
        markerErrors.push(`${relativeFile}:${index + marker.offset + 1}：無效 homepage-milestone 標記「${marker.line.trim()}」`);
      } else if (marker.offset !== 1) {
        markerErrors.push(`${relativeFile}:${index + marker.offset + 1}：homepage-milestone 必須緊接在條目標題後`);
      } else {
        milestoneImportance = Number(markerMatch.groups.importance);
      }
    }
    return {
      date: match.groups.date,
      title: match.groups.title.trim(),
      backrefs,
      file: relativeFile,
      line: index + 1,
      markerErrors,
      milestoneImportance,
      block,
      slug: slugOccurrence === 0 ? baseSlug : `${baseSlug}-${slugOccurrence}`,
    };
  });
}

export function collectHistory(repoRoot) {
  const historyDir = path.join(repoRoot, '歷史記錄');
  const fileNames = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).sort().reverse() : [];
  const dayFiles = fileNames.filter((name) => DAY_FILE_RE.test(name));
  const entries = dayFiles.flatMap((name) => parseDailyFile(repoRoot, name));
  const days = dayFiles.map((fileName) => {
    const date = fileName.match(DAY_FILE_RE).groups.date;
    const dayEntries = entries.filter((entry) => entry.file === `歷史記錄/${fileName}`);
    return { date, file: `歷史記錄/${fileName}`, entries: dayEntries, entryCount: dayEntries.length };
  });
  const monthMap = new Map();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    if (!monthMap.has(month)) monthMap.set(month, []);
    monthMap.get(month).push(day);
  }
  const months = [...monthMap]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([month, monthDays]) => ({
      month,
      file: `歷史記錄/${month}.md`,
      days: monthDays,
      dayCount: monthDays.length,
      entryCount: monthDays.reduce((sum, day) => sum + day.entryCount, 0),
    }));
  return {
    entries,
    days,
    months,
    historyFiles: fileNames.map((name) => `歷史記錄/${name}`),
  };
}

export function validateHistoryLayout(repoRoot) {
  const history = collectHistory(repoRoot);
  const errors = [];
  const historyDir = path.join(repoRoot, '歷史記錄');
  const fileNames = fs.existsSync(historyDir) ? fs.readdirSync(historyDir).sort() : [];
  for (const fileName of fileNames.filter((name) => YEAR_FILE_RE.test(name))) {
    errors.push(`歷史記錄/${fileName}：不再允許年度正文，請改用 YYYY-MM-DD.md 每日檔`);
  }
  for (const fileName of fileNames.filter((name) => MONTH_FILE_RE.test(name))) {
    const text = fs.readFileSync(path.join(historyDir, fileName), 'utf8');
    if (text.split(/\r?\n/u).some((line) => ENTRY_RE.test(line))) {
      errors.push(`歷史記錄/${fileName}：月份索引不可包含 canonical 歷史條目`);
    }
  }
  for (const day of history.days) {
    for (const entry of day.entries) {
      errors.push(...entry.markerErrors);
      if (entry.date !== day.date) {
        errors.push(`${day.file}：條目日期 ${entry.date} 與檔名日期 ${day.date} 不一致`);
      }
    }
  }
  return { valid: errors.length === 0, errors, history };
}

export function renderMonthIndex(month) {
  const lines = [
    '---',
    'type: history',
    'domain: []',
    `summary: ${month.month} 重大重構里程碑索引`,
    'authority: null',
    'slug: null',
    '---',
    `# 歷史記錄 · ${month.month}`,
    '',
    '> [歷史記錄](../歷史記錄.md) 的月份索引；本檔由 `pnpm history:generate` 生成，請勿手動編輯。',
  ];
  for (const day of month.days) {
    lines.push('', `## ${day.date}（${day.entryCount} 條）`, '');
    for (const entry of day.entries) {
      lines.push(`- [${entry.title}](${day.date}.md#${entry.slug})`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderLandingMonthTable(months) {
  const lines = [
    '<!-- history-month-index:start -->',
    '<!-- 本區以下至 end 標記由 `pnpm history:generate` 生成，請勿手動編輯。 -->',
    '',
    '| 年月 | 分檔 | 有記錄日 | 條目 |',
    '|---|---|---:|---:|',
  ];
  for (const month of months) {
    lines.push(`| ${month.month} | [歷史記錄/${month.month}.md](歷史記錄/${month.month}.md) | ${month.dayCount} | ${month.entryCount} |`);
  }
  lines.push('', '<!-- history-month-index:end -->');
  return lines.join('\n');
}

export function selectHistoryNavPages(pages) {
  return pages
    .filter((page) => MONTH_FILE_RE.test(path.posix.basename(page.path)))
    .sort((left, right) => right.path.localeCompare(left.path));
}

function replaceManagedBlock(text, { start, end, wanted, missingMessage }) {
  const startAt = text.indexOf(start);
  const endAt = text.indexOf(end);
  const duplicateStart = startAt >= 0 && text.indexOf(start, startAt + start.length) >= 0;
  const duplicateEnd = endAt >= 0 && text.indexOf(end, endAt + end.length) >= 0;
  if (startAt < 0 || endAt < startAt || duplicateStart || duplicateEnd) {
    throw new Error(missingMessage);
  }
  return `${text.slice(0, startAt)}${wanted}${text.slice(endAt + end.length)}`;
}

function replaceManagedMonthTable(landingText, months) {
  return replaceManagedBlock(landingText, {
    start: '<!-- history-month-index:start -->',
    end: '<!-- history-month-index:end -->',
    wanted: renderLandingMonthTable(months),
    missingMessage: '歷史記錄.md 缺 history-month-index 生成圍欄',
  });
}

function replaceManagedHomepageTimeline(homepageText, entries) {
  return replaceManagedBlock(homepageText, {
    start: '<!-- homepage-timeline:start -->',
    end: '<!-- homepage-timeline:end -->',
    wanted: renderHomepageTimeline(selectHomepageMilestones(entries)),
    missingMessage: '總覽.md 缺 homepage-timeline 生成圍欄',
  });
}

export function generateHistoryIndexes(repoRoot, { check = false } = {}) {
  const validation = validateHistoryLayout(repoRoot);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  const landingPath = path.join(repoRoot, '歷史記錄.md');
  const landingText = fs.readFileSync(landingPath, 'utf8');
  const homepagePath = path.join(repoRoot, '總覽.md');
  const homepageText = fs.readFileSync(homepagePath, 'utf8');
  const artifacts = [
    {
      name: '歷史記錄.md（月份索引）',
      filePath: landingPath,
      wanted: replaceManagedMonthTable(landingText, validation.history.months),
    },
    {
      name: '總覽.md（專案時間線）',
      filePath: homepagePath,
      wanted: replaceManagedHomepageTimeline(homepageText, validation.history.entries),
    },
    ...validation.history.months.map((month) => ({
      name: `歷史記錄/${month.month}.md`,
      filePath: path.join(repoRoot, '歷史記錄', `${month.month}.md`),
      wanted: renderMonthIndex(month),
    })),
  ];
  const stale = [];
  const written = [];
  for (const artifact of artifacts) {
    const current = fs.existsSync(artifact.filePath) ? fs.readFileSync(artifact.filePath, 'utf8') : null;
    if (current === artifact.wanted) continue;
    if (check) stale.push(artifact.name);
    else {
      fs.writeFileSync(artifact.filePath, artifact.wanted, 'utf8');
      written.push(artifact.name);
    }
  }
  return { ok: stale.length === 0, stale, written };
}
