// Specs 文檔檢查共用庫：corpus 走訪、標題/§ 解析、GitHub slug、目標解析。
// 零依賴（Node 標準庫）。本檔為 scripts/check-refs.mjs 與相關 docs tests 的單一權威。
import fs from 'node:fs';
import path from 'node:path';

// 政策：歷史快照類＝出站引用／連結／術語豁免；其餘 corpus 全數納入檢查。
export const SOURCE_EXEMPT = new Set(['歷史記錄.md']);
export function isExemptSource(relPath) { return SOURCE_EXEMPT.has(relPath.split('/').pop()); }

const LOCAL_TOOL_WORKSPACE_ROOTS = Object.freeze([
  '.agents',
  '.claude',
  '.superpowers',
  'docs/superpowers',
]);

export function isLocalToolWorkspacePath(relPath) {
  const normalized = String(relPath).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  return LOCAL_TOOL_WORKSPACE_ROOTS.some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

export function walkMd(root) {
  // 根層的 repo 管理檔不算 corpus 成員：agent 指令檔與 README 服務的是「這個 repo」
  // 而非文檔本身。README 因此不進生成式索引、也不進靜態站；它仍受 lint 三件套管轄
  // （那些走 glob），指向它的連結也仍可驗（check:refs 對非 corpus 目標退回磁碟檢查）。
  const repoLevelFiles = new Set(['AGENTS.override.md', 'CLAUDE.local.md', 'README.md']);
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const relPath = path.relative(root, full).split(path.sep).join('/');
      // .site-src／site＝MkDocs 建置的暫存輸入與產物（scripts/build-site.mjs）。
      // 兩者都是 corpus 的副本，掃進來會產生重複違規並污染生成式索引。
      if (ent.name === '.git' || ent.name === 'node_modules' || ent.name === '.venv' || ent.name === '.obsidian'
        || ent.name === '.site-src' || ent.name === 'site' || isLocalToolWorkspacePath(relPath)) continue;
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name.endsWith('.md') && !(dir === root && repoLevelFiles.has(ent.name))) out.push(full);
    }
  }
  return out.sort();
}

export function rel(root, file) { return path.relative(root, file).split(path.sep).join('/'); }

// GitHub 錨點 slug（近似：小寫、去標點〔保留字母/數字/-/_〕、空格→-；重複由呼叫端 -n）
export function slugify(text) {
  let s = text.trim().toLowerCase();
  s = s.replace(/<[^>]+>/g, '').replace(/`/g, '');
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  let out = '';
  for (const ch of s) {
    if (/[\p{L}\p{N}]/u.test(ch)) out += ch;
    else if (ch === ' ' || ch === '\t') out += '-';
    else if (ch === '-' || ch === '_') out += ch;
  }
  return out;
}

export function parseMd(text) {
  const lines = text.split(/\r?\n/);
  const inFence = new Array(lines.length).fill(false);
  const headings = [];
  let fence = false;
  const slugCount = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) { inFence[i] = true; fence = !fence; continue; }
    inFence[i] = fence;
    if (fence) continue;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const textPart = h[2].trim();
      const num = textPart.match(/^(\d+(?:\.\d+)*)[.、）)]?\s/);
      let slug = slugify(textPart);
      const n = slugCount.get(slug) ?? 0;
      slugCount.set(slug, n + 1);
      if (n > 0) slug = `${slug}-${n}`;
      headings.push({ line: i, level: h[1].length, text: textPart, num: num ? num[1] : null, slug });
    }
  }
  return { lines, inFence, headings };
}

export function sectionMap(headings) {
  const m = new Map();
  for (const h of headings) if (h.num && !m.has(h.num)) m.set(h.num, h);
  return m;
}

// 行內 code span（`...`）範圍——示例語法不當真連結
export function inlineCodeSpans(line) {
  const spans = [];
  const re = /`[^`]*`/g;
  let m;
  while ((m = re.exec(line))) spans.push({ start: m.index, end: m.index + m[0].length });
  return spans;
}

export function linkSpans(line) {
  const spans = [];
  const re = /\[([^\]]*)\]\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(line))) spans.push({ start: m.index, end: m.index + m[0].length, text: m[1], target: m[2] });
  return spans;
}

/** 將本機 Markdown link destination 的空格轉成 CommonMark／GitHub 可辨識的形式。 */
export function encodeMarkdownLinkTarget(target) {
  return target.replaceAll(' ', '%20');
}

// Raw HTML anchor links are used by the generated homepage timeline. Keep this
// extractor intentionally narrow: only <a ... href="..."> navigation belongs
// to the Markdown link integrity contract.
export function htmlHrefSpans(line) {
  const spans = [];
  const re = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>/giu;
  let match;
  while ((match = re.exec(line))) {
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      target: match[2],
    });
  }
  return spans;
}

export const ALIAS = new Map([
  ['經濟', '經濟系統.md'],
  ['信譽', '信譽系統.md'],
  ['建模', '建模參數.md'],
]);

function verLt(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// § 掃描：
// - range 僅接受緊鄰 dash（§14–26／§14–§26），「§2.3 -100」不視為範圍
// - 法條引用（§512(i)、U.S.C. §512）→ kind 'legal'，跳過驗證
// - 連結文字內的 § → 附 spanTarget（以 href 解析目標檔）
export function scanSectionRefs(line) {
  const refs = [];
  const spans = linkSpans(line);
  const re = /§\s?(\d+(?:\.\d+)*)/g;
  let m;
  let skipUntil = -1; // 範圍引用（§1–§7）的尾端 § 不重複視為獨立引用
  while ((m = re.exec(line))) {
    const idx = m.index;
    if (idx < skipUntil) continue;
    const before = line.slice(0, idx);
    const after = line.slice(idx + m[0].length);
    if (after.startsWith('(') || /U\.?S\.?C|RFC\s*\d+\s*$/i.test(before.slice(-15))) {
      refs.push({ num: m[1], kind: 'legal', index: idx });
      continue;
    }
    if (/^[a-z]/i.test(after)) { refs.push({ num: m[1], kind: 'letter-sub', index: idx }); continue; }
    if (/伺服器元件依賴分析\s*$/.test(before)) { refs.push({ num: m[1], kind: 'external-doc', index: idx }); continue; }
    let range = after.match(/^[–\-—]§?(\d+(?:\.\d+)*)/);
    if (range && verLt(range[1], m[1])) range = null; // 「§8.3-2」條目式標記非範圍
    if (range) skipUntil = idx + m[0].length + range[0].length;
    let targetToken = null, tokenKind = 'same-file';
    const fileTok = before.match(/([A-Za-z0-9_\-./\\一-鿿]+\.md)`?\s*(?:的)?\s*$/);
    if (fileTok) { targetToken = fileTok[1]; tokenKind = 'file'; }
    else {
      const zhTok = before.match(/([一-鿿A-Za-z0-9\-]{2,})\s*$/);
      if (zhTok && ALIAS.has(zhTok[1])) { targetToken = ALIAS.get(zhTok[1]); tokenKind = 'alias'; }
      else if (zhTok) { targetToken = zhTok[1]; tokenKind = 'maybe-basename'; }
    }
    const span = spans.find(s => idx >= s.start && idx < s.end);
    refs.push({
      num: m[1], rangeEnd: range ? range[1] : null, targetToken, tokenKind,
      index: idx, endIndex: idx + m[0].length + (range ? range[0].length : 0),
      insideLink: !!span, spanTarget: span ? span.target : null, kind: 'ref',
    });
  }
  return refs;
}

export function makeResolver(allRel) {
  const byBase = new Map();
  const add = (k, r) => { if (!byBase.has(k)) byBase.set(k, []); byBase.get(k).push(r); };
  for (const r of allRel) {
    const base = r.split('/').pop();
    add(base, r);
    add(base.replace(/\.md$/, '') + ' noext', r);
  }
  return function resolve(sourceRel, token, tokenKind) {
    if (tokenKind === 'same-file') return { status: 'ok', relPath: sourceRel, mode: 'same-file' };
    let t;
    try {
      t = decodeURIComponent(String(token)).replace(/\\/g, '/').replace(/^\.\//, '');
    } catch {
      return { status: 'not-found', tried: [String(token)] };
    }
    if (tokenKind === 'maybe-basename') {
      const c = byBase.get(token + ' noext') ?? [];
      if (c.length === 1) return { status: 'ok', relPath: c[0], mode: 'basename' };
      if (c.length > 1) return { status: 'ambiguous', candidates: c };
      return { status: 'ok', relPath: sourceRel, mode: 'same-file-fallback' };
    }
    if (t.includes('/')) {
      const baseDir = sourceRel.split('/').slice(0, -1).join('/');
      const joined = path.posix.normalize(path.posix.join(baseDir, t));
      if (allRel.includes(joined)) return { status: 'ok', relPath: joined, mode: 'path' };
      const fromRoot = path.posix.normalize(t);
      if (allRel.includes(fromRoot)) return { status: 'ok', relPath: fromRoot, mode: 'path-root' };
      return { status: 'not-found', tried: [joined, fromRoot] };
    }
    const c = byBase.get(t) ?? [];
    if (c.length === 1) return { status: 'ok', relPath: c[0], mode: 'basename' };
    if (c.length > 1) return { status: 'ambiguous', candidates: c };
    return { status: 'not-found', tried: [t] };
  };
}

// 歧義偏好：節存在者優先；仍多者偏好非 程式架構/程式流程/（跨檔引用慣例指實作主檔）
export function preferCandidate(candidates, num, corpus) {
  const withSec = candidates.filter(c => corpus.get(c)?.sections.has(num));
  const pool = withSec.length ? withSec : candidates;
  const nonFlow = pool.filter(c => !c.startsWith('程式架構/程式流程/'));
  return (nonFlow.length ? nonFlow : pool)[0];
}

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// frontmatter type 速讀（歷史／快照豁免的機器判定鍵；完整解析用 parseFrontmatterBlock）
export function frontmatterType(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return null;
  const m = /^type:\s*(\S+)\s*$/m.exec(text.slice(0, end));
  return m ? m[1] : null;
}

// frontmatter（檔首 --- 區塊）解析——刻意扁平子集：`key: value`／JSON 形陣列／null。
// 解析器即規範：能解析的才是合法寫法（decisions 驗證器與 corpus frontmatter 共用、零 YAML 依賴）。
export function parseFrontmatterBlock(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return { fm: null, end: -1, errors: ['缺 frontmatter 起始 ---'] };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { fm: null, end: -1, errors: ['frontmatter 未閉合'] };
  const fm = {};
  const errors = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (!m) { errors.push(`frontmatter 第 ${i + 1} 行無法解析：${line.slice(0, 40)}`); continue; }
    const [, key, raw] = m;
    if (raw.startsWith('[')) {
      try { fm[key] = JSON.parse(raw); } catch { errors.push(`${key} 陣列非 JSON 形：${raw.slice(0, 60)}`); fm[key] = []; }
    } else if (raw === 'null' || raw === '') fm[key] = null;
    else fm[key] = raw.trim();
  }
  return { fm, end, errors };
}
