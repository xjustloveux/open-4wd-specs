---
id: D-20260817-07
date: 2026-08-17
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260726-02", "D-20260802-08"]
domains: ["比賽房間", "版本部署"]
sources: ["2026-08-16 ─ ReadySet 自動開賽與逐回合晶片規則收斂"]
files: ["程式架構/matchmaking.md", "程式架構/peer-discovery.md", "程式架構/ledger.md", "流程/配對.md"]
vectors: []
deprecates: [{"item":"Quick Match discovery summary mode","kind":"removed","replacement":null},{"item":"Quick Match discovery summary rulesKey","kind":"removed","replacement":null},{"item":"MatchRules.disallowChip","kind":"replaced","replacement":"RoundConfig.disallowChip"}]
---

# D-20260817-07｜Quick Match 摘要與逐回合晶片規則收斂

## 背景與驅動力

D-20260726-02 已把禁用晶片的設定權威移到逐回合 `RoundConfig.disallowChip`，但仍暫留舊 `MatchRules.disallowChip` 的相容讀取債。D-20260802-08 則要求 Quick Match 以模式與規則預篩公開房，後續實作因而把 `mode`／`rulesKey` 複製到 discovery 摘要。專案仍在 pre-launch，這些未公開的重複欄位會讓摘要、完整 room snapshot 與逐回合設定形成多份可能漂移的權威。

## 考慮過的選項

- 保留 discovery `mode`／`rulesKey` 與外層 `MatchRules.disallowChip`，再增加同步與相容測試：延續三份 authority 與未公開 schema 債（未採）。
- 只移除 discovery 摘要欄位，繼續相容讀取外層 `disallowChip`：仍會讓新 current schema 保存過渡欄位（未採）。
- discovery 只提供選房所需的識別、容量與狀態摘要；加入後以完整房間狀態取得規則，禁用晶片只讀逐回合設定（採納）。

## 決定

- Quick Match discovery wire 移除 `mode` 與 `rulesKey`，不把完整比賽規則壓成另一份摘要 authority。
- current `MatchRules` schema、validator 與 ledger shape 移除 `disallowChip`；不再讀寫舊外層欄位。
- `RoundConfig.disallowChip` 是禁用晶片的唯一設定與執行權威，各回合可獨立決定。
- discovery 摘要只作候選房預篩；最終 eligibility 與規則仍由加入後取得並驗證的完整 room state 決定。

## 後果與影響

Quick Match 少了一層可能過期或漂移的規則摘要，逐回合晶片限制也不再背負外層相容讀取。候選房在 discovery 階段無法依完整賽制細節先行篩除，可能需要嘗試加入後才發現不合需求；這是以單一權威換取的額外一次 admission 成本。專案仍在 pre-launch，因此直接收斂 current wire 與 schema，不提供舊欄位別名或遷移層。
