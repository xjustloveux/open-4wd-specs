---
id: D-20260429-01
date: 2026-04-29
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-04-29 企劃書第十二次整合"]
files: ["建模參數.md", "車輛組裝.md"]
vectors: []
deprecates: [{"item":"socketType","kind":"replaced","replacement":"Mount_* 節點前綴匹配"}]
---

# D-20260429-01｜`socketType` 廢除＝Mount 前綴匹配＋canonical 尺寸 lenient 檢核

## 背景與驅動力

企劃書時代的組裝相容性靠顯式欄位 `socketType` 宣告插槽型別：零件與 chassis 各自維護一份型別標記，與 GLB 節點命名重複宣告同一件事；封閉 enum 也表達不了「型別對了但尺寸不合」的灰帶。企劃書第十二次整合時一併收斂。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以修正 ／ 收斂形式成立——條目僅一行「`socketType` 廢除 ｜ 改前綴匹配 + canonical 尺寸 lenient 檢核」。）

## 決定

- `socketType` 欄位廢除，組裝配對語義改由 GLB 節點命名的 **`Mount_*` 前綴匹配**承載：命名即介面，不再有第二套 schema 標記。
- 尺寸相容改 **canonical 尺寸 ＋lenient 檢核**：以公版 canonical 尺寸為基準做寬鬆容差檢核，而非型別硬鎖。現行匹配規則與容差門檻見 [建模參數.md](../建模參數.md)。

## 後果與影響

單一資訊源消滅了欄位與命名的雙重維護；`Mount_*` 前綴匹配自此成為組裝系統地基——後續武器方向配對（[D-20260524-04](D-20260524-04-武器方向Mount配對.md)）直接建立在 mount 節點 transform 之上。lenient 檢核其後在 [建模參數.md](../建模參數.md) 細化為分級容差（嚴謹 ／ 軟警告 ／ 拒收）。
