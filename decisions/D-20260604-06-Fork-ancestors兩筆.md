---
id: D-20260604-06
date: 2026-06-04
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["UGC版權"]
sources: ["2026-06-04 UGC機制 審視"]
files: ["UGC機制.md", "版權.md", "流程/衍生.md", "資料系統.md", "程式參數.md"]
vectors: []
deprecates: [{"item":"FORK_DEPTH_MAX","kind":"replaced","replacement":"兩筆 ancestors 與 parent 邊逐跳上溯"}]
---

# D-20260604-06｜Fork `ancestors` 收斂為至多兩筆、`FORK_DEPTH_MAX` 移除

## 背景與驅動力

[UGC機制.md](../UGC機制.md) 逐題審視（8 題）。per-record `ancestors` 原為全鏈清單，隨 fork 鏈深線性增長——每筆 record 抄一份完整血緣 ＝ 儲存膨脹，且需要 `FORK_DEPTH_MAX` 深度上限來封頂。另 Stage 1 對違規材質指派原採整包拒收，把可修復的問題直接擋在上傳門外。

## 考慮過的選項

- （流水帳未記錄替代方案；本決策以修正 ／ 收斂 ／ 翻案形式成立）

## 決定

- **`ancestors` 收斂為至多 2 筆 ＝`[parent, grandparent]`**（恰為 royalty maxDepth − 1，本人即 record 自身）；更深血緣靠 `parent` 邊逐跳上溯重建（`ForkTreeDerivedState`）。
- **移除 `FORK_DEPTH_MAX`**：`ancestors` 不再隨鏈深增長、無儲存膨脹；深鏈由每次 fork 燒幣（50／500）經濟自限，毋須協定層深度上限。
- **違規材質處置改三階段**：Stage 1 自動剃除違規指派（變未指派）→ Stage 2 重指派 → Stage 3 嚴格拒收殘留。

## 後果與影響

三層分潤 70／20／10（[D-20260531-02](D-20260531-02-三層分潤702010.md)）只需兩層祖先即可結算，兩筆封頂與其精確對齊；治理若把 `revShare.maxDepth` 調大於 3，舊 record 曾祖以上層靠 `parent` 邊回推補齊即可。剃除模型把拒收留給 Stage 3 殘留，上傳期改走引導修復。落點跨 [版權.md](../版權.md)、[衍生.md](../流程/衍生.md)、[資料系統.md](../資料系統.md)、[程式參數.md](../程式參數.md)。
