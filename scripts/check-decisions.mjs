// 決策檔（ADR）驗證器＋索引生成；契約見文檔工程.md §5。
// 驗證：frontmatter 可解析／id 唯一且同檔名／date 與 id 一致／status 鏈雙向一致
//      （supersedes ↔ superseded_by）／amends 目標存在／domains 合法／sources 非空／
//      四節齊全／全檔禁 § 字符（決策檔引用一律檔級連結、章節寫「第 N 節」）。
// 另看守歷史記錄：生成索引由 check:history 驗證；本檔驗證決策檔回引目標存在性、
//      sources ↔「決策檔」回引雙向一致（歷史檔全面豁免於 check:refs，只能在此補檢）。
// INDEX.md：`--write-index` 生成；預設模式比對現存 INDEX 是否最新（過期＝紅燈）。
// CI 紅燈語意：任何違規 → exit 1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectHistory } from './history-ledger.mjs';
import { DOMAINS } from './domains.mjs';
import { parseFrontmatterBlock } from './lib.mjs';
import {
  collectVectorFamilies,
  validateDeprecations,
  validateHistoricalFiles,
  validateRelationshipAddendum,
  validateVectorFamilies,
} from './decision-metadata.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(REPO_ROOT, 'decisions');
const HISTORY = collectHistory(REPO_ROOT);
const WRITE_INDEX = process.argv.includes('--write-index');

const violations = [];
const bad = (file, msg) => violations.push(`${file}: ${msg}`);
const vectorIndex = collectVectorFamilies(REPO_ROOT);
for (const violation of vectorIndex.violations) violations.push(violation);

function parseFrontmatter(file, text) {
  const { fm, end, errors } = parseFrontmatterBlock(text);
  for (const message of errors) bad(file, message);
  if (fm === null) return null;
  return { fm, bodyStart: end + 1, lines: text.split(/\r?\n/) };
}

const entries = new Map(); // id -> { file, fm, text }
if (!fs.existsSync(DIR)) { console.error('decisions/ 不存在'); process.exit(1); }
const files = fs.readdirSync(DIR).filter(n => n.startsWith('D-') && n.endsWith('.md')).sort();
for (const name of files) {
  const text = fs.readFileSync(path.join(DIR, name), 'utf8');
  const parsed = parseFrontmatter(name, text);
  if (!parsed) continue;
  const { fm, lines, bodyStart } = parsed;
  const id = fm.id;
  if (typeof id !== 'string' || !/^D-\d{8}-\d{2}$/.test(id)) { bad(name, `id 非法：${id}`); continue; }
  if (!name.startsWith(id + '-')) bad(name, `檔名未以 ${id}- 開頭`);
  if (entries.has(id)) bad(name, `id 重複（另見 ${entries.get(id).file}）`);
  const d = id.slice(2, 10);
  const expectDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  if (fm.date !== expectDate) bad(name, `date=${fm.date} 與 id 日期 ${expectDate} 不一致`);
  if (fm.status !== 'accepted' && fm.status !== 'superseded') bad(name, `status 非法：${fm.status}`);
  if (fm.status === 'superseded' && (fm.superseded_by == null)) bad(name, 'status=superseded 但 superseded_by 為空');
  if (fm.status === 'accepted' && fm.superseded_by != null) bad(name, 'status=accepted 但 superseded_by 非空');
  for (const key of ['supersedes', 'amends', 'domains', 'sources', 'files', 'vectors', 'deprecates']) {
    if (!Array.isArray(fm[key])) bad(name, `${key} 須為 JSON 陣列`);
  }
  if (Array.isArray(fm.deprecates))
    for (const message of validateDeprecations(fm.deprecates)) bad(name, message);
  if (Array.isArray(fm.files))
    for (const message of validateHistoricalFiles(fm.files)) bad(name, message);
  if (Array.isArray(fm.vectors))
    for (const message of validateVectorFamilies(fm.vectors, vectorIndex.families)) bad(name, message);
  if (Array.isArray(fm.domains)) {
    if (fm.domains.length === 0) bad(name, 'domains 不得為空');
    for (const dm of fm.domains) if (!DOMAINS.includes(dm)) bad(name, `domains 含非法值：${dm}`);
  }
  if (Array.isArray(fm.sources) && fm.sources.length === 0) bad(name, 'sources 不得為空');
  if (text.includes('§')) bad(name, '含 § 字符（決策檔禁用；章節寫「第 N 節」、引用走檔級連結）');
  const body = lines.slice(bodyStart).join('\n');
  if (!body.includes(`# ${id}｜`)) bad(name, `缺標題行「# ${id}｜…」`);
  for (const sec of ['## 背景與驅動力', '## 考慮過的選項', '## 決定', '## 後果與影響']) {
    if (!body.includes(sec)) bad(name, `缺章節 ${sec}`);
  }
  const title = (body.match(new RegExp(`^# ${id}｜(.+)$`, 'm')) ?? [])[1] ?? '';
  entries.set(id, { file: name, fm, title, body });
}

// status 鏈雙向一致
for (const [id, e] of entries) {
  for (const t of e.fm.supersedes ?? []) {
    const target = entries.get(t);
    if (!target) { bad(e.file, `supersedes 目標不存在：${t}`); continue; }
    if (target.fm.status !== 'superseded') bad(e.file, `supersedes 目標 ${t} 非 superseded 狀態`);
    if (target.fm.superseded_by !== id) bad(target.file, `superseded_by 應為 ${id}（現為 ${target.fm.superseded_by}）`);
  }
  if (e.fm.superseded_by != null) {
    const target = entries.get(e.fm.superseded_by);
    if (!target) bad(e.file, `superseded_by 目標不存在：${e.fm.superseded_by}`);
    else if (!(target.fm.supersedes ?? []).includes(id)) bad(target.file, `supersedes 應包含 ${id}`);
  }
  for (const t of e.fm.amends ?? []) {
    if (!entries.has(t)) bad(e.file, `amends 目標不存在：${t}`);
  }
  for (const message of validateRelationshipAddendum(id, e.body, entries)) bad(e.file, message);
}

// 歷史記錄.md（＋月份索引／每日正文）的決策檔引用目標存在性
// ——歷史檔連結豁免於 check:refs，這裡補看守
{
  const histFiles = [
    path.join(REPO_ROOT, '歷史記錄.md'),
    ...HISTORY.historyFiles.map((file) => path.join(REPO_ROOT, file)),
  ];
  for (const hp of histFiles) {
    if (!fs.existsSync(hp)) continue;
    const hist = fs.readFileSync(hp, 'utf8');
    // 連結一律以「該歷史檔自身所在目錄」解析（landing 與分檔深度不同）；
    // 兩種寫法都要匹配，否則深度寫錯的那一種會因為換基準而假性通過。
    // 涵蓋歷史檔內全部 .md 連結而不只決策檔——拆分造成的深度錯誤同樣會打到
    // canon 檔連結，而 check:refs 對 type=history 全面豁免，這裡是唯一防線。
    const re = /\]\(([^)\s]+\.md)(?:#[^)\s]*)?\)/g;
    let m;
    while ((m = re.exec(hist))) {
      const target = m[1];
      if (/^https?:/.test(target)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(hp), decodeURIComponent(target)))) {
        violations.push(`${path.relative(REPO_ROOT, hp).split(path.sep).join('/')} 連結無法解析：${target}`);
      }
    }
  }
}

// sources ↔ 歷史條目雙向一致（決策層與流水帳層的連結，兩個方向都要成立）
// ——sources 依 README 定義＝「日期＋標題前段」的字面前綴，必須在該日條目中唯一解析。
{
  // 歷史條目：標題（日期＋名稱）＋該條目「決策檔」行回引到的 id 集合
  const histEntries = HISTORY.entries.map((entry) => ({
    file: entry.file,
    line: entry.line,
    date: entry.date,
    name: entry.title,
    backrefs: entry.backrefs,
  }));
  // 比前綴前先去空白與標點，避免全形／半形與標點差異造成假陽性
  const norm = s => String(s).replace(/[\s　`*、，,。．：:；;／/｜|「」『』《》〈〉()（）[\]【】—–─~〜+＋&＆·・…!！?？'"“”‘’%％→←⭐]/gu, '').toLowerCase();
  const resolved = new Map(); // 決策 id -> 解析到的歷史條目陣列
  for (const [id, adr] of entries) {
    const hits = [];
    for (const s of adr.fm.sources ?? []) {
      const sm = String(s).match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/);
      if (!sm) { bad(adr.file, `sources 缺日期前綴：${s}`); continue; }
      const tail = norm(sm[2]);
      if (!tail) { bad(adr.file, `sources 只有日期、缺標題前段：${s}`); continue; }
      const cands = histEntries.filter(e => e.date === sm[1] && norm(e.name).startsWith(tail));
      if (cands.length === 0) { bad(adr.file, `sources 對不上任何歷史條目（須為條目標題的字面前綴）：${s}`); continue; }
      if (cands.length > 1) { bad(adr.file, `sources 前綴同時命中 ${cands.length} 條條目、需補長到可區分：${s}`); continue; }
      hits.push(cands[0]);
      if (!cands[0].backrefs.has(id)) {
        violations.push(`${cands[0].file}:${cands[0].line} 被 ${id} 列為 sources，但該條目未以「決策檔」行回引`);
      }
    }
    resolved.set(id, hits);
  }
  for (const e of histEntries) {
    for (const id of e.backrefs) {
      if (!entries.has(id)) continue; // 目標不存在已由上一段連結看守報過
      if (!(resolved.get(id) ?? []).includes(e)) {
        violations.push(`${e.file}:${e.line} 回引 ${id}，但該決策檔的 sources 未列此條目`);
      }
    }
  }
}

// INDEX 生成／比對
function buildIndex() {
  const escapeTableCell = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const out = [];
  out.push('# 決策索引（INDEX）');
  out.push('');
  out.push('> 本檔由 `pnpm check:decisions --write-index` 生成，勿手改。依首要域分組、id 升冪；制度說明見 [README.md](README.md)。');
  out.push('');
  // 排序一律指定 locale：不帶 locale 的 localeCompare 走行程預設 collation（本機 zh-TW、
  // CI 的 LANG=C.UTF-8 → en-US-u-va-posix），同一份輸入會排出不同 INDEX、check 在 CI 假紅。
  const deprecated = [...entries.values()]
    .flatMap((entry) => (entry.fm.deprecates ?? []).map((deprecation) => ({ entry, deprecation })))
    .sort((a, b) =>
      a.entry.fm.date.localeCompare(b.entry.fm.date, 'en') ||
      a.entry.fm.id.localeCompare(b.entry.fm.id, 'en') ||
      a.deprecation.item.localeCompare(b.deprecation.item, 'en'),
    );
  out.push('## 廢止與改名索引');
  out.push('');
  out.push(`> 共 ${deprecated.length} 筆；本表只來自 ADR \`deprecates\` metadata，不從本文猜測；日期與處置關係由 \`check:decisions\` 驗證。`);
  out.push('');
  out.push('| 日期 | 項目 | 處置 | 取代方式 | 決策 |');
  out.push('|---|---|---|---|---|');
  const kindLabel = { removed: '移除', renamed: '改名', replaced: '取代' };
  for (const { entry, deprecation } of deprecated) {
    out.push(`| ${entry.fm.date} | ${escapeTableCell(deprecation.item)} | ${kindLabel[deprecation.kind]} | ${escapeTableCell(deprecation.replacement ?? '—')} | [${entry.fm.id}](${entry.file}) |`);
  }
  out.push('');
  for (const dm of DOMAINS) {
    const rows = [...entries.values()].filter(e => (e.fm.domains ?? [])[0] === dm).sort((a, b) => a.fm.id.localeCompare(b.fm.id, 'en'));
    if (rows.length === 0) continue;
    out.push(`## ${dm}（${rows.length}）`);
    out.push('');
    for (const e of rows) {
      const marks = [];
      if (e.fm.status === 'superseded') marks.push(`superseded → ${e.fm.superseded_by}`);
      if ((e.fm.supersedes ?? []).length) marks.push(`supersedes ${e.fm.supersedes.join('、')}`);
      if ((e.fm.amends ?? []).length) marks.push(`amends ${e.fm.amends.join('、')}`);
      out.push(`- [${e.fm.id}](${e.file})｜${e.title}${marks.length ? `（${marks.join('；')}）` : ''}`);
    }
    out.push('');
  }
  while (out[out.length - 1] === '') out.pop();
  return out.join('\n');
}
const INDEX_PATH = path.join(DIR, 'INDEX.md');
const wanted = buildIndex() + '\n';
if (WRITE_INDEX) {
  fs.writeFileSync(INDEX_PATH, wanted);
} else if (entries.size > 0) {
  const current = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current !== wanted) violations.push('INDEX.md 過期或缺失——執行 pnpm check:decisions --write-index 重生成');
}

console.log(JSON.stringify({
  files: files.length, parsed: entries.size,
  superseded: [...entries.values()].filter(e => e.fm.status === 'superseded').length,
  deprecations: [...entries.values()].reduce((sum, entry) => sum + (entry.fm.deprecates?.length ?? 0), 0),
  violations: violations.length, indexWritten: WRITE_INDEX,
}, null, 2));
for (const v of violations) console.log(`✗ ${v}`);
if (violations.length > 0) process.exit(1);
