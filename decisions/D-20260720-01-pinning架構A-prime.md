---
id: D-20260720-01
date: 2026-07-20
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["版本部署"]
sources: ["2026-07-20 pinning 架構 A′ 定案"]
files: ["程式架構/pinning-service.md", "部署資訊/open-4wd-pinning.md", "程式架構/dmca.md"]
vectors: []
deprecates: [{"item":"pinning Go app 架構","kind":"replaced","replacement":"TypeScript ledger-peer app"},{"item":"DMCA notice OrbitDB collection","kind":"replaced","replacement":"節點本地 level 儲存"}]
---

# D-20260720-01｜pinning 架構 A′：Go 退場、app 收斂為 TypeScript ledger-peer

## 背景與驅動力

實作前實查主 repo 程式碼發現三缺口：「OrbitDB peer」職責純 Go 無解——`LedgerCheckpointEvent` 走帳本自身的 OrbitDB 複寫（自訂 heads／entry-fetch 協定、Admission），語意只存在於主 repo TypeScript 碼、kubo 看不懂帳本；bootstrap 門口 kubo 站不了（瀏覽器只會 `/ws`／`/wss` 與自訂 DHT protocol、kubo 走標準 IPFS DHT）；`/pin`／`/unpin` 簽章位元組未定義、無重放防護。

## 考慮過的選項

- 沿用舊 Go 技術棧藍圖：三缺口無解、或需位元組級對拷主 repo 語意，推翻（此為 spec 舊選型、無前置決策檔）。
- DMCA notice 存「OrbitDB collection」：個資絕不進 content-addressed 供應面、需真刪除與歸檔抹除，用語廢除、改節點本地。
- A′（採納；流水帳僅記裁決理由 ＝ 主 repo 可調整 ＋ 最大化去中心化，其他候選未展開）。

## 決定

- 容器仍三顆，自建 image 只剩 app（TypeScript）＝vendored 主 repo ledger＋peer-discovery＋key-manager 棧的 ledger-peer（真 OrbitDB peer＋bootstrap＋ 檢查點原生訂閱）兼管理 API；kubo／cluster 用上游官方 image；Go 退場（單語言消滅位元組對拷、砍 fork 門檻）。circuit relay 收編 app 選配（`RELAY_ENABLE` 預設開）；`BOOTSTRAP_PEER_PRIVKEY` 歸 app。
- 簽章 ＝SignedPayload 正規形：`sha256(dagCbor({nonce, payload, signer, timestamp}))`、`payload.type` 域分隔（`pinning-pin`｜`pinning-unpin`）、±30 秒容差 ＋nonce 去重。
- 授權 ＝ 白名單 ∪ 信譽閾值（讀自家 derive 的 DerivedState、不依賴外部）；配額記帳 ＝cluster pin metadata 唯一事實來源（零獨立 DB、重啟不丟帳）。
- DMCA 細部：notice 存節點本地 level；admin decision 補 `hold`（權利人訴訟通知攔停自動 restore）；反通知恢復 ＝ 每日掃描制（14 工作日跳週六日、逾期未攔停自動 re-pin、宕機補跑、admin 可提前）；收件補同信箱冷卻 ＋ 全域寄信速率上限。維運語意：DMCA 為各維運者私有法務窗口、不同步是設計特性；全網下架清單永遠走主 repo git PR 人工軌。

## 後果與影響

pinning 自架門檻與維護面大幅縮小、全棧單語言。vendored 主 repo 棧帶來的檢查點採納模式問題翌日由 [D-20260721-01](D-20260721-01-pinning-quorum-follow.md) 修正。現行公開權威為 [程式架構/pinning-service.md](../程式架構/pinning-service.md) 與 [部署資訊/open-4wd-pinning.md](../部署資訊/open-4wd-pinning.md)。
