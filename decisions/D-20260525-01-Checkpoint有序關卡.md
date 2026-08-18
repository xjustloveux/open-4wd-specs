---
id: D-20260525-01
date: 2026-05-25
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-05-25 建模參數表複審修正"]
files: ["建模參數.md", "遊戲機制.md", "賽內機制.md", "零件與場景.md"]
vectors: []
deprecates: []
---

# D-20260525-01｜Checkpoint＝有序防抄近路關卡

## 背景與驅動力

原 spec 把 checkpoint 標成「玩法 hint／ 純 UI 變灰 ／open 軌走捷徑不阻止」——checkpoint 沒有裁判效力，防抄近路完全落空；計圈規則另留「不強制 checkpoint 順序」矛盾句。建模參數表複審（E 項）整組推翻。

## 考慮過的選項

- 維持純 UI hint：抄近路無從阻止，被推翻。
- 有序關卡制（採納）。

## 決定

- Checkpoint 改寫為**有序防抄近路關卡**：須依序點亮；跨 `FinishLine` 保留不重置。
- `loop`：**全亮才計圈**並重置；未全亮不計圈也不清除、可續補（例：已亮 1–18，下次從 19 續）。
- `linear`／`open`：未全亮不算完賽（可回頭補點）。
- open vs fixed 的差別僅在 checkpoint 之間的路徑（open 可直線抄、fixed 受走廊約束）。現況見 [建模參數.md](../建模參數.md) 與 [賽內機制.md](../賽內機制.md)。

## 後果與影響

計圈判定同步改為「正向通過且全 checkpoint 依序點亮」；防無限拖由賽程時間上限（同輪改為房間設定三件套）兜底。「依編號順序」的順序載體其後由 [D-20260612-04](D-20260612-04-節點名唯一順序extras.md) 換軌為 `track.checkpoints[]` 有序陣列——有序關卡語義不變、承載機制升級。
