---
id: D-20260708-09
date: 2026-07-08
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["UGC版權"]
sources: ["2026-07-08 里程碑 7e dmca client 側"]
files: ["算式表.md", "程式架構/anti-piracy.md", "版權.md"]
vectors: []
deprecates: []
---

# D-20260708-09｜`computeFeatureSimilarity` v1 定案：五維相對差 ppm 取 max

## 背景與驅動力

`computeFeatureSimilarity` 是共識值——70–90% 灰區與 90% 拒收門檻（[D-20260703-05](D-20260703-05-灰區similarity-pending.md)）都吃它的輸出，但 canon 原只定門檻、未定公式；里程碑 7c 因此以 `SimilarityScorer` 注入 port 懸掛（不得擅自發明——定案後改式 ＝ 硬分叉），列為裁決項。7e 收官輪以「選項 A」定案落地。

## 考慮過的選項

- **選項 A（採納）**：五維相對差 ppm 整數法、取 max。
- 其餘備選公式形：流水帳未記錄具體內容（7c 時僅記「建議形留待討論」）。

## 決定

- **公式 v1**：五維相對差（vertex／volume／surface／AABB 三軸取 max／ 重心三軸絕對值域取 max）以 ppm 整數計，`similarityX100 = max(0, 100 - floor(maxPpm / 10^4))`。
- **取 max 哲學**：由最不像的維度決定不相似度——多維各改 8% 的稀釋式洗白仍得 sim 92、照樣拒收。
- `pcaAxes`／`isMirror` 不進 v1 公式：標準化階段已對齊 ／ 翻正。
- **版本護欄**：公式綁 `fingerprintVersion`；升級後舊作品鎖原版計分、跨版放行——公式演化不成硬分叉。

## 後果與影響

公式權威落於 [算式表.md](../算式表.md)（新節；原「常數權威來源」節後移重編、活文件零引用故安全），[anti-piracy.md](../程式架構/anti-piracy.md) 補權威引用；`computeFeatureSimilarity` 成為 `SimilarityScorer` port 的預設實作（port 保留）。相似度門檻（90／70）權威仍在 [版權.md](../版權.md)。similarity 公式裁決項至此清空，全 client 同式有據。
