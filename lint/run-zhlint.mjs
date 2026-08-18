// zhlint 批次器：只套用「中英（混寬）之間空格」，豁免由 frontmatter type 判定。
// --fix：套用 zhlint 修正，**標題行凍結**（標題改字＝GitHub slug 變＝既建錨點連結全斷，錨點穩定優先）。
// --strict：非豁免本文殘餘 > 0 時 exit 1；凍結標題殘餘不計入。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from 'zhlint';
import { frontmatterType, isLocalToolWorkspacePath } from '../scripts/lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.argv.includes('--fix');
const STRICT = process.argv.includes('--strict');
const RULES = { rules: { spaceBetweenMixedwidthContent: true } };
const isHeading = (l) => /^#{1,6}\s/.test(l);
// frontmatter（檔首 --- 區塊）＝YAML 資料非散文：不修不入紅燈（decisions/ 等檔的中文檔名值防誤插空格）
const fmEnd = (lines) => (lines[0] === '---' ? lines.indexOf('---', 1) : -1);

const files = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const relPath = path.relative(ROOT, full).split(path.sep).join('/');
    // .site-src／site＝MkDocs 建置的暫存輸入與產物，是 corpus 副本，掃它等於重複計數
    if (ent.name === 'node_modules' || ent.name === '.venv' || ent.name === '.git' || ent.name === '.obsidian'
      || ent.name === '.site-src' || ent.name === 'site' || isLocalToolWorkspacePath(relPath)) continue;
    if (ent.isDirectory()) walk(full);
    else if (ent.name.endsWith('.md')) files.push(full);
  }
})(ROOT);

let mainCount = 0, exemptFiles = 0, fixedFiles = 0, frozenHeadings = 0;
const perFile = [];
for (const f of files.sort()) {
  const relPath = path.relative(ROOT, f).split(path.sep).join('/');
  try {
    // 生成物不受 zhlint 管（正規化權威＝生成器；fix 會與凍結比對互打）
    if (relPath === 'decisions/INDEX.md' || relPath === 'docs-map.md') { exemptFiles++; continue; }
    const text = fs.readFileSync(f, 'utf8');
    const fmT = frontmatterType(text);
    if (fmT === 'history' || fmT === 'snapshot') { exemptFiles++; continue; }
    const out = run(text, RULES);
    const n = out.validations.length;
    if (n === 0) continue;
    if (FIX && out.result && out.result !== text) {
      // 標題行凍結：fix 結果中標題行改回原文（錨點穩定性優先）
      const origLines = text.split('\n');
      const fixedLines = out.result.split('\n');
      if (origLines.length === fixedLines.length) {
        const fm = fmEnd(origLines);
        for (let i = 0; i < origLines.length; i++) {
          if ((isHeading(origLines[i]) || i <= fm) && fixedLines[i] !== origLines[i]) { fixedLines[i] = origLines[i]; frozenHeadings++; }
        }
        const finalText = fixedLines.join('\n');
        if (finalText !== text) { fs.writeFileSync(f, finalText); fixedFiles++; }
        // 殘餘計數排除標題行與 frontmatter（凍結＝刻意豁免、不入 strict 紅燈）
        const after = run(finalText, RULES).validations;
        const fl = finalText.split('\n');
        const fmA = fmEnd(fl);
        const residualList = after.filter(v => { const i = (v.line ?? 1) - 1; return !isHeading(fl[i] ?? '') && i > fmA; });
        mainCount += residualList.length;
        if (residualList.length > 0) perFile.push({ file: relPath, residual: residualList.length, lines: residualList.slice(0, 4).map(v => v.line) });
        continue;
      }
      // 行數不一致（保守不套用）→ 落到下方一般計數
    }
    // 非 fix 模式（或 fix 無變更）：殘餘一律排除標題行與 frontmatter——凍結豁免與 --fix 路徑同語意
    const lines0 = text.split('\n');
    const fm0 = fmEnd(lines0);
    const residual = out.validations.filter(v => { const i = (v.line ?? 1) - 1; return !isHeading(lines0[i] ?? '') && i > fm0; });
    if (residual.length === 0) continue;
    mainCount += residual.length;
    perFile.push({ file: relPath, residual: residual.length, lines: residual.slice(0, 4).map(v => v.line) });
  } catch (e) {
    perFile.push({ file: relPath, error: String(e).slice(0, 80) });
  }
}

perFile.sort((a, b) => (b.residual ?? 0) - (a.residual ?? 0));
console.log(JSON.stringify({
  files: files.length, fix: FIX, mainResidual: mainCount,
  exemptFiles, fixedFiles, frozenHeadings, top: perFile.slice(0, 12),
}, null, 2));
if (STRICT && mainCount > 0) process.exit(1);
