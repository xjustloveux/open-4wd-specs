// § 引用／markdown 連結／錨點完整性檢查；契約見文檔工程.md §4。
// 零依賴（Node 標準庫）。CI 紅燈語意：非豁免來源斷引或斷鏈 > 0 → exit 1。
// 政策：history 類文件為歷史快照、出站引用／連結豁免；
//      法條引用（§512(i)）跳過；歧義引用以「節存在＋非程式流程優先」假定並標記。
// 檔案存在檢查採**大小寫精確比對**（GitHub 為 case-sensitive；Windows 本機不精確比對會漏斷鏈）。
// 本檔同時提供 CLI 與 analyzeRefs()，讓測試、文件生成與 CI 共用同一條 §／連結管線；
// 常數 md↔code 比對由 main repo 的 check:constants 經 test:scripts 在 CI 執行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  frontmatterType, htmlHrefSpans, slugify,
  walkMd, rel, parseMd, sectionMap, linkSpans, inlineCodeSpans, scanSectionRefs, makeResolver, preferCandidate,
} from './lib.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED_INDEX_START = '<!-- generated:index:start -->';
const GENERATED_INDEX_END = '<!-- generated:index:end -->';
const HOMEPAGE_TIMELINE_START = '<!-- homepage-timeline:start -->';
const HOMEPAGE_TIMELINE_END = '<!-- homepage-timeline:end -->';

function generatedIndexLineMask(lines) {
  const masked = new Set();
  let insideIndex = false;
  let insideTimeline = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.includes(GENERATED_INDEX_START)) insideIndex = true;
    if (line.includes(HOMEPAGE_TIMELINE_START)) insideTimeline = true;
    if (insideIndex || insideTimeline) masked.add(index);
    if (line.includes(GENERATED_INDEX_END)) insideIndex = false;
    if (line.includes(HOMEPAGE_TIMELINE_END)) insideTimeline = false;
  }
  return masked;
}

// 大小寫精確存在檢查（逐段對照 readdir；'..' 段＝連結逸出 repo、視為斷鏈）
function makeExistsExact(root) {
  const cache = new Map();
  const list = (dir) => {
    if (!cache.has(dir)) {
      try { cache.set(dir, new Set(fs.readdirSync(dir))); } catch { cache.set(dir, null); }
    }
    return cache.get(dir);
  };
  return (relPath) => {
    let dir = root;
    const segs = relPath.split('/').filter(s => s && s !== '.');
    if (segs.length === 0) return false;
    for (const seg of segs) {
      const entries = list(dir);
      if (!entries || !entries.has(seg)) return false;
      dir = path.join(dir, seg);
    }
    try { return fs.statSync(dir).isFile(); } catch { return false; }
  };
}

export function analyzeRefs(specsRoot = REPO_ROOT) {
  // ---------- 1. 載入 corpus ----------
  const files = walkMd(specsRoot);
  const corpus = new Map();
  for (const f of files) {
    const r = rel(specsRoot, f);
    const text = fs.readFileSync(f, 'utf8');
    const parsed = parseMd(text);
    // 歷史／快照豁免＝frontmatter type 機器判定（項 6 rekey；取代硬編檔名）
    corpus.set(r, {
      ...parsed,
      sections: sectionMap(parsed.headings),
      fmType: frontmatterType(text),
      generatedIndexLines: generatedIndexLineMask(parsed.lines),
    });
  }
  const allRel = [...corpus.keys()];
  const resolve = makeResolver(allRel);
  const existsExact = makeExistsExact(specsRoot);

  // 檔案拆分後，active canon 不得再用已退役的導覽頁舊名描述權威。
  // ADR 與歷史快照保留當時決策文字，不納入現行命名契約。
  const retiredNameFindings = [];
  const retiredNames = ['程式參數表', '建模參數表'];
  for (const [r, doc] of corpus) {
    if (
      doc.fmType === 'history' ||
      doc.fmType === 'snapshot' ||
      r.startsWith('decisions/')
    ) continue;
    for (let i = 0; i < doc.lines.length; i++) {
      for (const retiredName of retiredNames) {
        if (doc.lines[i].includes(retiredName)) {
          retiredNameFindings.push({ source: r, line: i + 1, retiredName });
        }
      }
    }
  }

  // ledger.md 的 §1–§5 只保留穩定導覽；規則引用必須直達拆分後 leaf，
  // 否則章節存在檢查會把「存在但非 authority」的 façade 誤判為有效。
  const facadeSectionFindings = [];
  for (const [r, doc] of corpus) {
    if (
      doc.fmType === 'history' ||
      doc.fmType === 'snapshot' ||
      r.startsWith('decisions/')
    ) continue;
    for (let i = 0; i < doc.lines.length; i++) {
      for (const match of doc.lines[i].matchAll(/\bledger\.md\s*§\s*([1-5])(?=\D|$)/gu)) {
        facadeSectionFindings.push({
          source: r,
          line: i + 1,
          section: Number(match[1]),
        });
      }
    }
  }

  // ---------- 2. § 引用驗證 ----------
  const secFindings = [];
  const secStats = { total: 0, exemptSkipped: 0, legalSkipped: 0, verified: 0, broken: 0, ambiguousAssumed: 0 };
  for (const [r, doc] of corpus) {
    if (doc.fmType === 'history' || doc.fmType === 'snapshot') {
      for (const line of doc.lines) secStats.exemptSkipped += (line.match(/§\s?\d/g) ?? []).length;
      continue;
    }
    for (let i = 0; i < doc.lines.length; i++) {
      const line = doc.lines[i];
      if (!line.includes('§')) continue;
      const refs = scanSectionRefs(line);
      // 行內已明確出現過的檔案目標（連結 href／檔名 token），供接續繼承與「疑指」判斷
      const lineTargets = [];
      for (const s of linkSpans(line)) {
        const raw = (s.target ?? '').split('#')[0];
        if (raw && !/^https?:|^mailto:/.test(raw)) {
          const res = resolve(r, raw, 'file');
          if (res.status === 'ok') lineTargets.push({ at: s.start, rel: res.relPath });
        }
      }
      let prevFileTarget = null, prevEnd = -1;
      for (const ref of refs) {
        if (ref.kind !== 'ref') { secStats.legalSkipped++; prevEnd = ref.index + 4; continue; }
        secStats.total++;
        const rec = { source: r, line: i + 1, num: ref.num, rangeEnd: ref.rangeEnd, kind: ref.tokenKind, inFence: doc.inFence[i] };
        let targetRel = null, assumed = null, sameFileFallback = false;

        if (ref.insideLink && ref.spanTarget && !/^https?:|^mailto:/.test(ref.spanTarget)) {
          const raw = ref.spanTarget.split('#')[0];
          if (raw) {
            const res = resolve(r, raw, 'file');
            if (res.status === 'ok') targetRel = res.relPath;
          } else targetRel = r;
        }
        if (!targetRel && (ref.tokenKind === 'file' || ref.tokenKind === 'alias')) {
          const res = resolve(r, ref.targetToken, 'file');
          if (res.status === 'ok') targetRel = res.relPath;
          else if (res.status === 'ambiguous') {
            targetRel = preferCandidate(res.candidates, ref.num, corpus);
            assumed = `歧義取 ${targetRel}`;
            secStats.ambiguousAssumed++;
          } else {
            rec.status = 'target-file-not-found'; rec.detail = (res.tried ?? []).join(' | ');
            secStats.broken++;
            secFindings.push(rec); prevEnd = ref.endIndex; continue;
          }
        }
        if (!targetRel && (ref.tokenKind === 'same-file' || ref.tokenKind === 'maybe-basename')) {
          const gap = line.slice(Math.max(prevEnd, 0), ref.index);
          if (prevFileTarget && prevEnd >= 0 && /^[\s,、/／+＋與和&·・]*$/.test(gap)) {
            targetRel = prevFileTarget; assumed = '清單接續';
          } else if (ref.tokenKind === 'maybe-basename') {
            let res = resolve(r, ref.targetToken, 'maybe-basename');
            // 黏著剝離：見/依/自/與… 黏在檔名前
            if (res.mode === 'same-file-fallback') {
              for (let k = 1; k <= 3 && k < ref.targetToken.length - 1; k++) {
                const tryTok = ref.targetToken.slice(k);
                const r2 = resolve(r, tryTok, 'maybe-basename');
                // 排除超通用檔名（「本流程」剝成 流程.md 之類的誤導）
                if (r2.status === 'ok' && r2.mode === 'basename' && r2.relPath !== '流程.md') { res = r2; assumed = `黏著剝離「${ref.targetToken}」→${tryTok}`; break; }
                if (r2.status === 'ambiguous') { res = r2; break; }
              }
            }
            if (res.status === 'ok') { targetRel = res.relPath; if (res.mode === 'same-file-fallback') sameFileFallback = true; }
            else if (res.status === 'ambiguous') {
              targetRel = preferCandidate(res.candidates, ref.num, corpus);
              assumed = `歧義取 ${targetRel}`;
              secStats.ambiguousAssumed++;
            }
          } else {
            targetRel = r;
          }
        }
        if (!targetRel) { targetRel = r; sameFileFallback = ref.tokenKind !== 'same-file'; }
        rec.target = targetRel;
        if (assumed) rec.assumed = assumed;
        if (sameFileFallback) rec.sameFileFallback = true;
        const tdoc = corpus.get(targetRel);
        const nums = [ref.num, ...(ref.rangeEnd ? [ref.rangeEnd] : [])];
        const missing = nums.filter(n => !tdoc.sections.has(n));
        if (missing.length === 0) { rec.status = 'ok'; secStats.verified++; }
        else {
          rec.status = 'section-missing'; rec.detail = `缺 §${missing.join('、§')}`;
          // same-file 落空：行內先前明確檔案若持有該節 → 標「疑指」
          if ((sameFileFallback || ref.tokenKind === 'same-file') && targetRel === r) {
            const earlier = lineTargets.filter(t => t.at < ref.index);
            const holder = earlier.reverse().find(t => nums.every(n => corpus.get(t.rel)?.sections.has(n)));
            if (holder) rec.detail += `；疑指 ${holder.rel}（該檔有此節）`;
          }
          secStats.broken++;
          secFindings.push(rec);
        }
        prevFileTarget = (ref.insideLink || ref.tokenKind === 'file' || ref.tokenKind === 'alias' || (targetRel !== r)) ? targetRel : prevFileTarget;
        prevEnd = ref.endIndex;
      }
    }
  }

  // ---------- 3. 連結與錨點驗證（歷史快照類來源豁免）＋連結圖收集（docs-map／graphify 資料源） ----------
  const linkFindings = [];
  const edges = [];
  const linkStats = { total: 0, external: 0, verified: 0, brokenPath: 0, brokenAnchor: 0, labelMismatch: 0, exemptSkipped: 0 };
  for (const [r, doc] of corpus) {
    const exempt = doc.fmType === 'history' || doc.fmType === 'snapshot';
    for (let i = 0; i < doc.lines.length; i++) {
      if (doc.inFence[i]) continue;
      const codeSpans = inlineCodeSpans(doc.lines[i]);
      const links = [
        ...linkSpans(doc.lines[i]).map((span) => ({ ...span, kind: 'markdown' })),
        ...htmlHrefSpans(doc.lines[i]).map((span) => ({ ...span, kind: 'html' })),
      ]
        .sort((a, b) => a.start - b.start);
      for (const s of links) {
        if (codeSpans.some(c => s.start >= c.start && s.start < c.end)) continue; // 行內 code 示例
        const target = s.target.trim();
        if (exempt) { linkStats.exemptSkipped++; continue; }
        if (target.includes(' ')) {
          linkStats.total++;
          linkStats.brokenPath++;
          linkFindings.push({ source: r, line: i + 1, target, status: 'unencoded-space' });
          continue;
        }
        if (!target || target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
          if (target) { linkStats.total++; linkStats.external++; }
          continue;
        }
        linkStats.total++;
        const [rawPath, fragment] = target.split('#');
        let targetRel = r;
        if (rawPath) {
          const baseDir = r.split('/').slice(0, -1).join('/');
          targetRel = path.posix.normalize(path.posix.join(baseDir, decodeURIComponent(rawPath)));
        }
        const exists = corpus.has(targetRel) || existsExact(targetRel);
        if (!exists) {
          linkStats.brokenPath++;
          linkFindings.push({ source: r, line: i + 1, target, status: 'path-not-found' });
          continue;
        }
        if (s.kind === 'markdown' && rawPath.toLowerCase().endsWith('.md')) {
          const labelFile = s.text.trim().match(/(?:^|[/\\])([^/\\]+\.md)(?=\s*(?:§|$))/u)?.[1];
          const targetFile = path.posix.basename(targetRel);
          const semanticLabel = s.text.trim();
          const retiredSemanticLabel =
            r !== 'docs-map.md' &&
            !doc.generatedIndexLines.has(i) &&
            (/^前端技術策略(?:\.md)?(?:\s|$)/u.test(semanticLabel) || semanticLabel === '命名慣例');
          if ((labelFile && labelFile !== targetFile) || retiredSemanticLabel) {
            linkStats.labelMismatch++;
            linkFindings.push({
              source: r,
              line: i + 1,
              target,
              status: 'label-target-mismatch',
              detail: retiredSemanticLabel
                ? `退役語意標籤「${semanticLabel}」不得隱藏 leaf target`
                : `${labelFile} != ${targetFile}`,
            });
            continue;
          }
        }
        if (fragment && corpus.has(targetRel)) {
          const ok = corpus.get(targetRel).headings.some(h => h.slug === fragment.toLowerCase());
          if (!ok) {
            linkStats.brokenAnchor++;
            linkFindings.push({ source: r, line: i + 1, target, status: 'anchor-not-found' });
            continue;
          }
        }
        linkStats.verified++;
        if (
          corpus.has(targetRel) &&
          targetRel !== r &&
          !doc.generatedIndexLines.has(i)
        )
          edges.push({ from: r, to: targetRel });
      }
    }
  }

  return { files, corpus, secFindings, secStats, linkFindings, linkStats, retiredNameFindings, facadeSectionFindings, edges };
}

// ---------- CLI（specs CI／本機 pnpm check:refs） ----------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { files, corpus, secFindings, secStats, linkFindings, linkStats, retiredNameFindings, facadeSectionFindings } = analyzeRefs();
  // 標題 slug 檔內唯一：撞名時錨點只能靠 -n 去重後綴定位，該後綴的形式各家 Markdown
  // 實作不一致（靜態站與 GitHub 可能分歧），且目錄會出現多個同名項目。
  const dupSlugs = [];
  for (const [r, doc] of corpus) {
    const seen = new Map();
    for (const h of doc.headings) {
      const base = slugify(h.text);
      const first = seen.get(base);
      if (first === undefined) seen.set(base, h.line);
      else dupSlugs.push({ source: r, line: h.line, text: h.text, base, firstLine: first });
    }
  }
  const summary = {
    corpus: { files: files.length, headings: [...corpus.values()].reduce((a, d) => a + d.headings.length, 0) },
    sectionRefs: secStats,
    links: linkStats,
    duplicateHeadingSlugs: dupSlugs.length,
    retiredNames: retiredNameFindings.length,
    facadeSectionTargets: facadeSectionFindings.length,
    mainBroken: secFindings.length + linkFindings.length + dupSlugs.length + retiredNameFindings.length + facadeSectionFindings.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  // headings 的 line 為 0-based（lib.mjs parseMd），輸出時對齊其餘 findings 的 1-based
  for (const d of dupSlugs) {
    console.log(`✗ ${d.source}:${d.line + 1} 標題 slug 與 L${d.firstLine + 1} 撞名（#${d.base}）：「${d.text}」——請改為檔內唯一`);
  }
  for (const f of secFindings) {
    console.log(`✗ ${f.source}:${f.line} §${f.num}${f.rangeEnd ? '–' + f.rangeEnd : ''} → ${f.target ?? ''}【${f.status}${f.detail ? '：' + f.detail : ''}】`);
  }
  for (const f of linkFindings) {
    console.log(`✗ ${f.source}:${f.line} → ${f.target}【${f.status}${f.detail ? '：' + f.detail : ''}】`);
  }
  for (const f of retiredNameFindings) {
    console.log(`✗ ${f.source}:${f.line} 含退役名稱「${f.retiredName}」`);
  }
  for (const f of facadeSectionFindings) {
    console.log(`✗ ${f.source}:${f.line} ledger.md §${f.section} 是導覽 façade，請直指權威 leaf`);
  }
  if (summary.mainBroken > 0) process.exit(1);
}
