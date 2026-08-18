---
id: D-20260731-01
date: 2026-07-31
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260724-01"]
domains: ["版本部署"]
sources: ["2026-07-31 signaling 開發期 baseline 裁決"]
files: ["部署資訊/open-4wd-signaling.md", "程式架構/signaling-service.md", "程式架構/peer-discovery.md", "程式架構/interfaces.md"]
vectors: []
deprecates: []
---

# D-20260731-01｜signaling 開發期 baseline 重設為 v1

## 背景與驅動力

[D-20260724-01](D-20260724-01-signaling-v2部署拓撲.md) 以「scoped signed v2」描述
從全域 lobby 草案改為每個 `room:<code>`／`match:<digest>` 獨立 session、signed envelope、
nonce replay guard 與 WSS／GossipSub 共用語意的重構。該重構的安全與並行邊界正確，但數字
`2` 把未發布的開發草案誤當成已存在的第一代相容契約。

目前主程式與 signaling repo 皆仍為 `0.0.0`，沒有發布 tag；公版 signaling repo 是零
secrets、永不直接部署的模板，官方 deploy repo 與 `signal.open4wd.org` 服務亦尚未建立。
因此沒有舊 client、外部自架服務、持久 signaling 資料或公開 wire contract 需要與新版並存。
較晚的 [D-20260725-01](D-20260725-01-版本後繼邏輯核與首道破壞牆.md) 已確立公開凍結前
baseline 維持 `1`、不得為未部署的 v2／v3 製造虛假歷史，本案將該原則套用至 signaling。

## 考慮過的選項

- 保留 v2：可避免一次性正名，但會把內部開發順序永久誤寫成公開協定歷史，否決。
- v1／v2 雙讀與遷移：沒有相容對象，反而增加 parser、topic、測試與安全分支，否決。
- 保留 scoped signed 設計、公開前重設為唯一 v1 baseline（採納）。

## 決定

- D-20260724-01 的 scoped session、signed envelope、nonce replay guard、closed SDP／ICE DTO、
  單一 active WSS＋Gossip fallback 與跨 transport 去重全部保留；本決策只修訂其版本命名。
- signaling 的首次公開 wire baseline 為 `v1`：payload discriminator 使用 `signal-v1`，
  topic 使用 v1，介面契約由 `SignalingProvider` 承載並以數值 `interfaceVersion = 1` 起始，
  不再把版本號寫進 TypeScript 介面名稱。
- 配合鏈隔離收口，GossipSub signaling topic 的目標形為
  `/open4wd/<chainId>/signaling/v1/<canonical-scope>`；`chainId` 必須由 `ledgerAddress`
  決定性推導，不新增第二個可漂移的部署欄位。
- 不保留 `signal-v2` reader、不做 v1／v2 dual publish、不建立 migration 或 fallback 至
  全域 lobby。既有 fixtures、conformance vectors 與 vendored copies 在同一修復批次直接
  重產／同步。
- 首次公開凍結後，只有真實不相容 wire 格式已存在且需要與 v1 區隔時，才可升為 v2，並須
  另立 ADR、相容策略與 vectors。

## 後果與影響

`open-4wd`、`open-4wd-signaling` 與 current canon 必須在首次本機多人測試前原子切換；
周邊 repo 依既定順序 re-vendor。開發期既有本機資料與測試工件不視為遷移對象，可依既有
首次測試 reset 規則重建。D-20260724-01 保留為當日設計演進的歷史記錄，其 scoped signed
架構仍有效，但其中「v2」名稱由本決策修訂為初始 v1。
