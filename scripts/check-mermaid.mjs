// Mermaid 圖語法驗證；契約見文檔工程.md §4。
// Mermaid 是執行期解析的 DSL——寫進 .md 當下沒有任何東西會說語法對不對，錯誤要等
// 讀者開啟頁面才以「圖不見了」的形式浮現（GitHub 與靜態站皆然）。這支把它拉回寫入期。
//
// 需要 DOM：mermaid 內部的 DOMPurify 在純 Node 會以 addHook is not a function 失敗，
// 因此以 jsdom 提供最小 window/document。注意 Node 24 的 globalThis.navigator 唯讀，
// 不可覆寫（覆寫會在 import 階段直接拋錯）。
// CI 紅燈語意：任一張圖解析失敗 → exit 1。
//
// 已知界線（2026-07-27 實測，16 種圖型全通過；新圖型出現時先看這裡）：
//   ‧ 只驗語法（parse），不驗渲染。parse 過但畫不出來的情形本檢查抓不到——jsdom 沒有
//     SVG 量測 API（getBBox 等），render 在此環境跑不起來，只能靠建站後人工看。
//   ‧ 若訊息形如「<某物> is not defined」而該圖在瀏覽器渲染正常，那是 jsdom 缺全域
//     而非語法錯誤（已知兩例：navigator、Option）。補在上面的全域區、不要改圖。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { walkMd, rel } from './lib.mjs';
import {
  containsMermaidPolicyNumber,
  isAllowedMermaidPolicyExample,
} from './mermaid-policy.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FENCE_OPEN = /^```mermaid\s*$/;
const FENCE_CLOSE = /^```\s*$/;

/** 逐檔抽出 mermaid 圍欄；回傳含檔名與起始行，讓錯誤訊息可直接跳轉。 */
function collectDiagrams() {
  const out = [];
  for (const full of walkMd(REPO_ROOT)) {
    const r = rel(REPO_ROOT, full);
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    let buffer = null;
    let startLine = 0;
    for (let i = 0; i < lines.length; i++) {
      if (buffer === null) {
        if (FENCE_OPEN.test(lines[i])) { buffer = []; startLine = i + 2; }
        continue;
      }
      if (FENCE_CLOSE.test(lines[i])) {
        out.push({ file: r, line: startLine, source: buffer.join('\n') });
        buffer = null;
        continue;
      }
      buffer.push(lines[i]);
    }
    if (buffer !== null) out.push({ file: r, line: startLine, source: buffer.join('\n'), unterminated: true });
  }
  return out;
}

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// mermaid 的 sequence 解析器在處理 box 的顏色時用 new Option(...) 借瀏覽器解析色值；
// 少了這個全域會以「Option is not defined」誤報成語法錯誤（實際在瀏覽器渲染正常）。
// 不覆寫 globalThis.navigator——Node 24 起它是唯讀，賦值會在 import 階段直接拋錯。
globalThis.Option = dom.window.Option;

const mermaidModule = await import('mermaid');
const mermaid = mermaidModule.default ?? mermaidModule;
mermaid.initialize({ startOnLoad: false });

const diagrams = collectDiagrams();
const violations = [];
const byType = new Map();

for (const d of diagrams) {
  if (d.unterminated) {
    violations.push(`${d.file}:${d.line} mermaid 圍欄未關閉`);
    continue;
  }
  const kind = (d.source.trim().split(/\s+/)[0] || '?').replace(/^%%\{.*/, 'directive');
  byType.set(kind, (byType.get(kind) ?? 0) + 1);
  for (const [index, rawLine] of d.source.split('\n').entries()) {
    if (
      containsMermaidPolicyNumber(rawLine) &&
      !isAllowedMermaidPolicyExample(d.file, rawLine)
    ) {
      violations.push(`${d.file}:${d.line + index} Mermaid 標籤含數值門檻；請移至圖下正文`);
    }
  }
  try {
    await mermaid.parse(d.source);
  } catch (err) {
    const first = String(err?.message ?? err).split('\n').find(l => l.trim()) ?? '';
    violations.push(`${d.file}:${d.line} ${first.trim().slice(0, 160)}`);
  }
}

console.log(JSON.stringify({
  diagrams: diagrams.length,
  violations: violations.length,
  byType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])),
}, null, 2));
for (const v of violations) console.log(`✗ ${v}`);
if (violations.length > 0) process.exit(1);
