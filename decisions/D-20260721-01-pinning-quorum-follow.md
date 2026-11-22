---
id: D-20260721-01
date: 2026-07-21
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260720-01"]
domains: ["版本部署"]
sources: ["2026-07-21 pinning 檢查點採納模式定案"]
files: ["程式架構/pinning-service.md"]
vectors: []
deprecates: []
---

# D-20260721-01｜pinning 檢查點採納模式：quorum-follow 輕跟隨

## 背景與驅動力

pinning 公版實作 e2e 揭露兩個獨立缺口。其一治理 trust root 缺失：`startLedgerNode` 未供給 signer set、genesis `governanceSigners` 為空集，檢查點提案與遠端採納同閘被擋——已以 `getSignerSet` seam＋ 部署 config `GOVERNANCE_SIGNERS` 注入修復（預設空 ＝fail-closed）。其二採納第二道閘：vendored 採納路徑實為「全窗重摺、逐位比對 canonical derived state」的驗證者語意，需要全域 registry appliers，pinning 僅有 core appliers——含領域事件的真實窗必被拒；原 spec「derived state 解碼白拿」描述與實碼不符。

## 考慮過的選項

- vendored 全 registry appliers：逐位重現使 applier 集成為共識關鍵元件——任何領域 applier 改版即令舊版 pinning 節點採納停擺，社群自架被迫 lockstep 跟版（對開源運營最糟）、vendor 面持續膨脹。棄。
- quorum-follow 跟隨者模式（使用者核可 (d) 案，採納）。

## 決定

- 主 repo 帳本新增一級採納模式旋鈕：`full-refold`（客戶端驗證者語意、現行預設）｜`quorum-follow`（跟隨者：驗多簽 quorum → 解碼白拿 → 自採納 state 讀下一 epoch `governanceSigners` 鏈式推進信任根；epoch 單調 ＋prev 鏈接防回滾）；pinning 節點切用 `quorum-follow`。
- 信任模型取捨明文化：放棄 pinning 端拜占庭偵測——客戶端仍全驗證，爆炸半徑只剩垃圾 pin、受配額約束；回歸原 spec 的跟隨者語意。
- 過渡期：pinning 僅採納純 core 可重現窗（e2e 負向控制釘住、README 記限制）。

## 後果與影響

社群 pinning 節點不再被 applier 改版跑步機綁死。主 repo 落地後尚有 re-vendor、config 切換與領域事件窗 e2e 補案；至 [D-20260724-01](D-20260724-01-signaling-v2部署拓撲.md) 時 runtime 仍維持 `full-refold`、`quorum-follow` 為已核准的待切換目標。模式權威見 [程式架構/pinning-service.md](../程式架構/pinning-service.md)。
