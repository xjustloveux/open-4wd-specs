// corpus frontmatter 驗證；契約見文檔工程.md §3。
// 範圍：全 corpus .md，僅排除 decisions/（自有 schema、由 check-decisions 驗）。
// 驗證：frontmatter 存在且可解析／type enum／domain 11 域白名單／summary 非空且禁 § 禁連結語法／
//      authority／slug 欄位必備；authority 為 null 或 repo 內一般檔案；slug 為 null 或 ASCII slug／資料夾↔type 一致。
// CI 紅燈語意：任何違規 → exit 1。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOMAINS } from './domains.mjs';
import { walkMd, rel, parseFrontmatterBlock } from './lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = ['canon', 'registry', 'flow', 'impl', 'impl-flow', 'index', 'history', 'snapshot', 'deploy', 'art', 'meta'];
const FOLDER_TYPE = [
  ['程式架構/程式流程/', 'impl-flow'],
  ['程式架構/', 'impl'],
  ['流程/', 'flow'],
  ['部署資訊/', 'deploy'],
  ['美術資源/', 'art'],
  ['歷史記錄/', 'history'],
];

const violations = [];
const bad = (file, msg) => violations.push(`${file}: ${msg}`);

function isSafeRepoRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\')) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (path.posix.normalize(value) !== value) return false;
  return value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

function isRegularFileInsideRepo(value) {
  try {
    const real = fs.realpathSync(path.resolve(REPO_ROOT, value));
    const relative = path.relative(REPO_ROOT, real);
    const inside = relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    return inside && fs.statSync(real).isFile();
  } catch {
    return false;
  }
}

let checked = 0;
const byType = new Map();
for (const full of walkMd(REPO_ROOT)) {
  const r = rel(REPO_ROOT, full);
  if (r.startsWith('decisions/')) continue; // decisions 自有 schema（check-decisions 驗）
  checked++;
  const text = fs.readFileSync(full, 'utf8');
  const { fm, errors } = parseFrontmatterBlock(text);
  for (const message of errors) bad(r, message);
  if (fm === null) continue;
  if (!TYPES.includes(fm.type)) bad(r, `type 非法：${fm.type}`);
  else byType.set(fm.type, (byType.get(fm.type) ?? 0) + 1);
  if (!Array.isArray(fm.domain)) bad(r, 'domain 須為 JSON 陣列');
  else for (const d of fm.domain) if (!DOMAINS.includes(d)) bad(r, `domain 含非法值：${d}`);
  if (typeof fm.summary !== 'string' || !fm.summary.trim()) bad(r, 'summary 不得為空');
  else {
    if (fm.summary.includes('§')) bad(r, 'summary 禁用 § 字符');
    if (fm.summary.includes('](')) bad(r, 'summary 禁用連結語法');
  }
  if (!Object.hasOwn(fm, 'authority')) bad(r, '缺 authority 欄位');
  else if (fm.authority !== null) {
    if (!isSafeRepoRelativePath(fm.authority))
      bad(r, `authority 必須是安全的 repo-relative 檔案路徑：${fm.authority}`);
    else if (!isRegularFileInsideRepo(fm.authority))
      bad(r, `authority 必須指向 repo 內既有的一般檔案：${fm.authority}`);
  }
  if (!Object.hasOwn(fm, 'slug')) bad(r, '缺 slug 欄位');
  else if (fm.slug !== null && (typeof fm.slug !== 'string' || !/^[a-z0-9-]+$/.test(fm.slug)))
    bad(r, `slug 非 ASCII slug：${fm.slug}`);
  const folderRule = FOLDER_TYPE.find(([prefix]) => r.startsWith(prefix));
  if (folderRule && fm.type !== folderRule[1]) bad(r, `資料夾 ${folderRule[0]} 內 type 應為 ${folderRule[1]}（現為 ${fm.type}）`);
}

console.log(JSON.stringify({ checked, violations: violations.length, byType: Object.fromEntries([...byType].sort()) }, null, 2));
for (const v of violations) console.log(`✗ ${v}`);
if (violations.length > 0) process.exit(1);
