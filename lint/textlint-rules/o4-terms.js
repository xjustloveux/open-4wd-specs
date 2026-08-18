// 用語鐵則 lint；規則契約見文檔工程.md §2。
// 只掃散文文字節點（Str）——code fence／inline code 自動豁免（程式識別符不誤報）。
// 規則來源：文檔工程.md §2（黑名單=全域 vs 封鎖清單=個人；no-mvp-staging）。
'use strict';

const TERMS = [
  { re: /封鎖名單/g, msg: '用語鐵則：不存在「封鎖名單」——個人層用「封鎖清單」、全域層用「黑名單」' },
  { re: /個人[的]?黑名單|黑名單[（(]個人/g, msg: '用語鐵則：個人層應為「封鎖清單」（黑名單保留給全域帳本推導）' },
  { re: /全域[的]?封鎖清單/g, msg: '用語鐵則：全域層應為「黑名單」（封鎖清單保留給個人本地）' },
  { re: /(?<![\w.])MVP(?!\w)/g, msg: 'no-mvp-staging 鐵則：開源專案不分 MVP 階段，禁用此措辭' },
  { re: /(?<![\w.])v1\.x/g, msg: 'no-mvp-staging 鐵則：禁用 v1.x 分階段措辭' },
];

module.exports = function o4Terms(context) {
  const { Syntax, RuleError, getSource, report } = context;
  // 歷史／快照豁免機器判定：frontmatter type: history|snapshot（合法記載廢除用語）；.textlintignore 為第二道保險
  let exemptDoc = false;
  return {
    [Syntax.Document](node) {
      const raw = getSource(node);
      exemptDoc = /^---\r?\n[\s\S]{0,600}?^type:\s*(history|snapshot)\s*$/m.test(raw);
    },
    [Syntax.Str](node) {
      if (exemptDoc) return;
      const text = getSource(node);
      for (const t of TERMS) {
        t.re.lastIndex = 0;
        let m;
        while ((m = t.re.exec(text))) {
          // 禁令語境豁免：宣告禁令的句子本身（「不分 MVP…」「禁用…措辭」）合法提及禁詞
          const around = text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30);
          if (/不分|禁用|勿用|不得使用|這類措辭/.test(around)) continue;
          report(node, new RuleError(t.msg, { index: m.index }));
        }
      }
    },
  };
};
