---
id: D-20260816-12
date: 2026-08-16
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260808-03"]
domains: ["建模物理", "版本部署"]
sources: ["2026-08-16 完整 PhysicsManifest 公版零件預算"]
files: ["程式架構/builtin-assets.md", "美術資源/提示詞/零件參考圖.md", "美術資源/前端技術策略.md"]
vectors: []
deprecates: [{"item":"公版 part 單檔 104 KiB 預算","kind":"replaced","replacement":"公版 part 單檔 112 KiB 預算"}]
---

# D-20260816-12｜完整 PhysicsManifest 公版零件預算

## 背景與驅動力

武器拓撲決策把公版 part 從 100 KiB 調到 104 KiB，以容納 deterministic physics metadata。完整
current PhysicsManifest 又納入逐 collider 材質、熱、磨耗、接觸面積與拓撲描述；實際完整 payload
需要額外有界空間，而視覺網格、紋理及全套 4 MiB 預算均未改變。

## 考慮過的選項

- 刪減 support directions 或物理欄位以守 104 KiB：會犧牲特殊造型或完整驗證，否決。
- 提高視覺面數或紋理額度：與此次 metadata 需求無關，否決。
- 單檔調為 112 KiB，並限定增額只供完整 deterministic physics metadata（採納）。

## 決定

- 公版 part 單檔上限由 104 KiB 調為 112 KiB。
- 8K triangle、必要時 256² 紋理與全套公版資產 4 MiB 上限不變；超過原 100 KiB 的空間只能
  用於完整 PhysicsManifest 與 deterministic physics metadata，不得轉成視覺複雜度額度。
- CI 依 112 KiB fail closed；專案尚未發布，不保留 104 KiB 的平行 release profile。

## 後果與影響

完整 current manifest 可保留特殊造型所需的有界描述，而不以省略共識物理資料換取檔案縮小。
每檔最壞值增加 8 KiB，但全套 4 MiB 上限仍是總容量硬閘，因此不會無界擴張安裝快取。
