---
id: D-20260612-03
date: 2026-06-12
status: superseded
supersedes: []
superseded_by: D-20260627-02
amends: []
domains: ["材質"]
sources: ["2026-06-12 材質表 複審（第二輪）"]
files: ["材質表.md"]
vectors: []
deprecates: []
---

# D-20260612-03｜材質廢止＝append-only、永不物理刪除

## 背景與驅動力

「刪除材質」在 permissionless 網路上不可驗證執行，且舊資產以 CID 鎖死、其 GLB extras 永久引用既有材質 id——物理刪除必然砸壞已上鏈內容。需要一個與內容尋址相容的廢止模型。

## 考慮過的選項

- 物理刪除：不可行（上述兩問題）。
- append-only 標記制（採納）：清單只增不減，廢止 ＝ 標記。

## 決定

材質清單 **append-only、永不物理刪除**；廢止 ＝ 驗證層 `DEPRECATED_MATERIAL_IDS` 標記 ＋Stage 2 不可選 ＋Stage 3 拒新上鏈，隨 client minor 出貨。

## 後果與影響

append-only 原則自此不變並由後繼決策承繼；但本輪未閉合「已上鏈舊資產怎麼辦」的下游語意（是否強制換公版、是否影響配對），該缺口由 [D-20260627-02](D-20260627-02-材質廢止絕版品模型.md) 重訂並**完整取代本檔的廢止流程**。
