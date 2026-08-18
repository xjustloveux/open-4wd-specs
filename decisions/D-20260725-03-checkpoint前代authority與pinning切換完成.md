---
id: D-20260725-03
date: 2026-07-25
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260721-01", "D-20260724-01"]
domains: ["版本部署"]
sources: ["2026-07-25 checkpoint signer rotation 與 pinning 完整接線 review"]
files: ["程式架構/ledger.md", "程式架構/pinning-service.md", "部署資訊/open-4wd-pinning.md"]
vectors: []
deprecates: []
---

# D-20260725-03｜checkpoint 前代 authority 與 pinning 切換完成

## 背景與驅動力

[D-20260721-01](D-20260721-01-pinning-quorum-follow.md) 已採納
`quorum-follow`，但當時主 repo 模式、re-vendor、pinning config 與領域事件窗 E2E
尚未完成；[D-20260724-01](D-20260724-01-signaling-v2部署拓撲.md) 因此如實記錄
runtime 仍是 `full-refold`。本次完整 review 另發現本地 checkpoint 三法與
`full-refold` 會誤讀本代 frontier 折疊後的 signer set，使 signer rotation 形成自我授權，
與既有 `prevEpoch` 治理信任邊界不一致。

## 考慮過的選項

- 以本代 derived state 的 signer set 驗證本代 checkpoint：新成員可授權納入自己的事件，
  破壞治理信任鏈，棄。
- 將 authority 固定為前一個已採納 checkpoint state，首代固定讀 genesis（採納）。

## 決定

- `proposeCheckpoint`、覆核、finalize、`full-refold` 與 `quorum-follow` 均以
  **前一個已採納 checkpoint state** 的 signer set 驗證本代；第一個 checkpoint 讀
  genesis。
- 本代 derived state 內的新 signer set 只授權下一個 checkpoint，不得回頭授權本代。
- pinning 啟動時將固定排序的 `GOVERNANCE_SIGNERS` 寫入 genesis，runtime 明確切換為
  `quorum-follow`。
- 完成 re-vendor 與「來源端包含 pinning replica 未知 reducer」領域事件窗 E2E，解除
  D-20260721-01 記錄的純 core 過渡限制。

## 後果與影響

checkpoint signer rotation 現與 `ConfigUpdateEvent` 的 `prevEpoch` 原則一致，兩種採納
模式不再允許自我授權。D-20260721-01 與 D-20260724-01 保留各自裁決日的真實狀態；
本裁決記錄其後的信任邊界補充與實作完成點。現況權威見
[程式架構/ledger.md](../程式架構/ledger.md) 與
[程式架構/pinning-service.md](../程式架構/pinning-service.md)。
