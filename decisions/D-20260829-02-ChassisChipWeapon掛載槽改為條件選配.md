---
id: D-20260829-02
date: 2026-08-29
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260730-02", "D-20260811-02", "D-20260829-01"]
domains: ["UGC版權", "建模物理"]
sources: ["2026-08-29 ─ Chassis Chip／Weapon 掛載槽改為條件選配"]
files: ["建模參數/零件與共用介面.md", "編輯器操作.md", "車輛組裝.md", "零件與場景.md", "流程/UGC上傳.md", "程式參數/protocol.md"]
vectors: []
deprecates: []
---

# D-20260829-02｜Chassis Chip／Weapon 掛載槽改為條件選配

## 背景與驅動力

車輛組裝已允許無晶片無武器、有晶片無武器與有晶片有武器三種配置，但 chassis 匯入、驗證與 Canonical PhysicsManifest 仍強制 `Mount_Chip` 與 `Mount_Weapon` 同時存在。這讓不提供晶片或武器能力的底盤無法表達真實裝配介面，也使匯出在任何合法選配 mount 缺少時於 manifest 建立階段失敗。

## 考慮過的選項

- 保留兩槽必備、只允許 loadout 留空：底盤仍宣告實際不存在的裝配能力，棄。
- Chip 與 Weapon 完全獨立選配：會允許無晶片卻有武器槽的無效狀態，與組裝規則衝突，棄。
- 兩槽皆選配，但 Weapon 依賴 Chip；編輯器以級聯移除維持合法狀態（採納）。

## 決定

- Chassis 必要 mount 收斂為 10 個：canonical 9 個加 `Mount_Motor`。
- `Mount_Chip` 與 `Mount_Weapon` 都是合法候選槽，只序列化實際存在者；`Mount_Weapon` 存在時 `Mount_Chip` 必須存在。
- Stage 2 沒有 Chip 時禁用新增 Weapon；移除 Chip 時若 Weapon 存在，兩槽在同一筆可復原交易中一起移除。外部 GLB 若帶 Weapon 卻缺 Chip，Stage 3 拒收而不靜默補槽。
- Canonical PhysicsManifest 從實際 scene graph 建立 10 個必要 mount 加實際存在的 Chip／Weapon／roller 選配 mount；驗證端以相同依賴規則 fail closed。
- current canonical 重開、fork 與既有來源保留實際 authored 槽，不新增 schema 版本或 migration。專案仍為 pre-launch，未發布的中間資料不承擔相容性義務。

## 後果與影響

底盤可準確表達「無晶片無武器」、「有晶片無武器」與「有晶片有武器」三種能力；「無晶片有武器」在編輯器操作與 Stage 3 都被阻止。匯出、獨立 admission、組裝 resolver 與 runtime 共用相同的實際 mount 集合，不再因缺少合法選配槽而中斷。
