---
id: D-20260516-02
date: 2026-05-16
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-05-16 Motor / Battery 新模型 + 8 Skill enum"]
files: ["建模參數.md", "算式表.md", "遊戲機制.md"]
vectors: []
deprecates: [{"item":"slipstream skill","kind":"replaced","replacement":"aero 物理自然湧現"},{"item":"lock_steer skill","kind":"removed","replacement":null},{"item":"Combat stat","kind":"replaced","replacement":"weapon 動能模型"}]
---

# D-20260516-02｜Skill enum 8 種＋Stats 8 項

## 背景與驅動力

技能與能力值清單在同日 Motor / Battery 重構（[D-20260516-01](D-20260516-01-Motor-Battery能量模型.md)）中一併收斂：`slipstream` 在 aero 模型下屬自然湧現現象、不該是顯式技能；`lock_steer` 鎖他人轉向違反設計；`Combat` stat 沒有自己的公式支撐、職能與武器動能模型重疊。

## 考慮過的選項

- 保留原清單（含 `slipstream`／`lock_steer`／`Combat`）：三者各有上述硬傷。
- 8 種 skill＋8 項 Stats 定形（採納）。

## 決定

- Skill enum 定 **8 種**：移除 `slipstream`（aero 自然湧現）、`lock_steer`（違反設計）。
- Stats 定 **8 項**：移除 `Combat`（由 weapon 動能模型替代）。現行清單見 [算式表.md](../算式表.md) 與 [遊戲機制.md](../遊戲機制.md)。

## 後果與影響

`Combat` 的職能翌日由武器動能比例公式接手（[D-20260517-01](D-20260517-01-武器分支樹Mount單層.md)）；技能槽其後於 2026-05-25 複審把 `weapon_trigger` 改名 `weapon`（passive 武器也占槽、只是不觸發），enum 成員本身未再增刪，8＋8 沿用至今。
