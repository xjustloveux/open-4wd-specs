---
id: D-20260728-01
date: 2026-07-28
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260720-01", "D-20260724-01"]
domains: ["版本部署", "資安"]
sources: ["2026-07-28 Pinning 公開列舉 API 移除"]
files: ["程式架構/interfaces.md", "程式架構/pinning-service.md", "部署資訊/open-4wd-pinning.md"]
vectors: []
deprecates: [{"item":"GET /list","kind":"replaced","replacement":"節點內部 ClusterClient.list"},{"item":"PinningProvider.listPinned","kind":"replaced","replacement":"節點內部 ClusterClient.list"},{"item":"pinning 公開 cursor／page-size schema","kind":"removed","replacement":null}]
---

# D-20260728-01｜Pinning 公開列舉 API 移除

## 背景與驅動力

Pinning 的 HTTP 與 client 契約沿用一般 CRUD 介面的完整性，提供公開 `GET /list` 與
`PinningProvider.listPinned()`；實查後沒有玩家、UGC 瀏覽或 DMCA 維運 consumer，卻會讓
任何人列舉節點完整 pin inventory。節點自己的配額與 reconcile 雖需要列舉 cluster 狀態，
但這是內部能力，不構成公開 API 的理由。

## 考慮過的選項

- 保留公開列表並加分頁或 rate limit：只能降低掃描速度，沒有解決不必要的資訊揭露——否決。
- 把列表改為 Admin token 保護：DMCA 已有專用案件資料面，產品仍沒有 pin inventory consumer——否決。
- 完整移除公開契約，只保留節點內部 cluster 列舉與專用 Admin 案件列表——採納。

## 決定

公開 `GET /list`、`PinningProvider.listPinned()`、cursor／page-size schema 及其 adapter、測試與
規格全部移除，不保留相容路由。`ClusterClient.list()` 只留在節點內部供 `/stats`、配額與
reconcile；DMCA 案件列舉只走受保護的專用 Admin API。現況契約見
[pinning-service](../程式架構/pinning-service.md)與[interfaces](../程式架構/interfaces.md)。

## 後果與影響

Pinning 公開攻擊面與資料揭露面縮小，client 介面也不再承諾沒有產品用途的能力；內部計量、
自動 pin／unpin 與 DMCA 維運不受影響。本決策部分修訂早期 pinning 架構與 HTTP v2 契約，
實作追蹤於 issue `000045`。
