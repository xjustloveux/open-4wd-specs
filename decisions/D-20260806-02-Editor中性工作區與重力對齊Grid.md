---
id: D-20260806-02
date: 2026-08-06
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260713-02"]
domains: ["前端主題", "建模物理"]
sources: ["2026-08-06 ─ Editor 改採中性工作區與重力對齊 Grid（issue 000213）"]
files: ["程式架構/editor.md", "美術資源/美術方向.md"]
vectors: []
deprecates: []
---

# D-20260806-02｜Editor 中性工作區與重力對齊 Grid

## 背景與驅動力

[D-20260713-02](D-20260713-02-美術方向工坊翻案.md) 將整體介面定為專業迷你四驅工坊，初版
Editor 因而加入調整墊、零件盒與工作台背板。然而這些家具會遮擋 UGC 幾何、掛點與路線判讀，
也可能進入 picking、framing 或被誤認為可編輯內容。

## 考慮過的選項

- 保留完整工坊家具：延續網站氛圍，但犧牲 Editor 的幾何判讀與中立背景。
- 保留少量裝飾：折衷視覺，仍留下內容／舞台邊界不清的問題。
- Editor viewport 改 neutral＋低對比 grid，工坊方向留在 viewport 外殼與其他頁面：採納。

## 決定

Editor viewport 使用中性 PBR 與低對比輔助 grid，不放 workshop 實體家具。Grid 是純舞台輔助，
不得進入 content、picking 或 framing；其法線依合法重力反方向對齊，包含反平行與任意重力方向，
並以微小偏移避免 z-fighting。

## 後果與影響

此決策部分修訂工坊美術方向的適用範圍，不否定網站與其他頁面的工坊識別。Editor 優先服務
幾何、掛載標記、route 與任意重力方向的可讀性；輔助 grid 不形成 UGC 或物理權威。
