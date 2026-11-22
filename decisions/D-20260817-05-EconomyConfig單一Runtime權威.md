---
id: D-20260817-05
date: 2026-08-17
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260627-01"]
domains: ["治理營運"]
sources: ["2026-08-17 EconomyConfig 收斂為單一 runtime authority"]
files: ["程式參數.md","程式架構/system-constants.md","流程/治理事件.md"]
vectors: []
deprecates: [{"item":"ECONOMY_CONFIG_DEFAULTS","kind":"replaced","replacement":"src/economy/config.ts GENESIS_ECONOMY_CONFIG"},{"item":"system-constants EconomyConfig interface","kind":"replaced","replacement":"src/economy/config.ts EconomyConfig"},{"item":"system-constants RevShareConfig","kind":"replaced","replacement":"EconomyConfig.revShare"},{"item":"system-constants ForkDetectionConfig","kind":"replaced","replacement":"EconomyConfig.forkDetection"}]
---

# D-20260817-05｜EconomyConfig 收斂為單一 runtime authority

## 背景與驅動力

治理兩軌確立後，真正的 `EconomyConfig` 已由 economy domain 負責驗證、genesis、ledger fold 與讀取；system-constants 仍留有另一份 epoch、金額型別及欄位形狀不同的完整預設物件，只為兩項跨層測試而存在。這份影子模型不能被 runtime 使用，也無法可靠證明完整 config 沒有漂移。

## 考慮過的選項

- 讓 runtime 改讀 system-constants 物件：會反轉現行 domain authority，且必須把不相容型別與欄位重新接入 ledger（未採）。
- 保留兩份模型並擴大逐欄同步測試：持續負擔雙重 schema，任何新增欄位都要同步兩份不相容物件（未採）。
- 只保留 runtime `EconomyConfig`／`GENESIS_ECONOMY_CONFIG`，在其消費與驗證層測試不變式（採納）。

## 決定

`src/economy/config.ts` 的 `EconomyConfig`、`GENESIS_ECONOMY_CONFIG` 與 fold 後的 `DerivedState.economyConfig` 是唯一 config authority。system-constants 不再輸出完整 config shape 或 genesis defaults；治理 signer 數量的純 quorum helper可獨立保留。rev-share、signer set 與所有其他治理欄位直接由 runtime schema、validation 與 economy／ledger tests 驗證。

## 後果與影響

新增或調整治理欄位只修改一份型別與 genesis 物件，不再同步影子模型。Pinning 的 vendored source 必須保持相同邊界。專案仍在 pre-launch，因此直接移除未公開 export，不提供別名或遷移層。
