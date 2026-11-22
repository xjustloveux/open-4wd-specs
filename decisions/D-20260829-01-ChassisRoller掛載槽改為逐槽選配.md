---
id: D-20260829-01
date: 2026-08-29
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260730-02"]
domains: ["UGC版權", "建模物理"]
sources: ["2026-08-29 ─ Chassis roller 掛載槽改為逐槽選配"]
files: ["建模參數/零件與共用介面.md", "編輯器操作.md", "車輛組裝.md"]
vectors: []
deprecates: []
---

# D-20260829-01｜Chassis roller 掛載槽改為逐槽選配

## 背景與驅動力

既有匯入政策會替每個 chassis 自動建立六個 `Mount_Roller_*`，驗證與組裝也把六槽視為必要介面。但實際底盤可能完全沒有 roller 位置，或只具備其中若干位置；自動補齊會製造模型並未提供的裝配能力，也讓作者誤以為必須安排六槽。

## 考慮過的選項

- 保留六槽必備，只允許作者把不用的槽移到模型內：仍會宣告不存在的安裝能力，棄。
- 依 mesh 外觀猜測 roller 位置：不可決定性且可能誤判特殊造型，棄。
- 將六個標準名稱保留為候選，但實際存在性由 GLB authored empty 決定（採納）。

## 決定

- Chassis 首次匯入只自動建立 12 個必要 mount：canonical 9 個加 Motor / Chip / Weapon 3 個。
- `Mount_Roller_FL`、`FR`、`CL`、`CR`、`RL`、`RR` 是六個合法候選，實際數量可為 0–6。來源已有者保留；缺少者不自動補齊、不產生缺件 finding。
- Stage 2 提供每個 roller 候選的新增與移除；新增使用既有候選 offset 作初始位置，作者仍須依實際模型調整位置與 +X hinge 朝向。
- `auto_chassis_mounts.roller` 只序列化實際存在的槽。組裝只接受 chassis 已解析出的 roller mount；loadout 指定不存在的槽時視為無效組裝，不得回退到模板候選位置。
- current canonical 重開、fork 與既有來源保留實際 authored 槽，不新增 schema 版本或 migration。專案仍為 pre-launch，未發布的中間資料不承擔相容性義務。

## 後果與影響

沒有 roller 的底盤可合法完成編輯與測試，具有少量 roller 的底盤也只暴露真實槽位。編輯器仍顯示六個候選列供作者逐一建立，但 viewport、驗證、烘焙與 runtime resolver 只處理實際存在的節點。
