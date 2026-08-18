---
id: D-20260722-01
date: 2026-07-22
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["版本部署"]
sources: ["2026-07-22 signaling canon 對齊輪"]
files: ["部署資訊/open-4wd-signaling.md", "程式架構/signaling-service.md", "程式參數.md", "部署資訊.md", "使用技術.md", "流程/配對.md", "程式架構.md", "部署資訊/open-4wd-turn.md"]
vectors: []
deprecates: [{"item":"signaling /match 中央配對","kind":"replaced","replacement":"GossipSub matchmaking"},{"item":"signaling Cloudflare Workers 機制細節","kind":"replaced","replacement":"Node adapter 現況與規劃中 adapter 邊界"}]
---

# D-20260722-01｜signaling canon 對齊：/match 配對藍圖除名、CF Workers 降規劃中

## 背景與驅動力

`open-4wd-signaling` 實作交付後，canon 仍是實作前的舊 provider 藍圖——設計 doc 的「spec 待更新」清單九項未回寫。本輪盤點（必改 20／ 判斷 7／ 不動 15）逐項裁決後全數執行。

## 考慮過的選項

- `/match` 中央配對照舊留 canon：實作零配對（端點不存在、`match-request` 經 WS 靜默丟棄、`match-found` 不產生），留著就是假活功能；且中央路徑有未簽章評分 POST 的已知韌性缺口。除名。
- CF Workers 自 canon 翻案移除：方向不翻案、時序標明（裁 (b)），機制細節移除、方向一句保留。

## 決定

- `/match` 中央配對藍圖自 canon 除名：配對主路徑 ＝GossipSub、開放信任集；wire 表兩列改標「型別存在、無生產使用」、KV 時序圖整圖刪除；redis 字樣（含否定句）全 corpus 清零。
- CF Workers 降「規劃中 adapter 方向」：官方部署當時現況 ＝Node 路徑（use-template 部署 repo＋docker compose、all-in-one 可與 coturn 同機）；wrangler／Durable Object／KV 機制細節自 canon 全數移除。
- 伺服器常數收斂單一權威入 [程式參數.md](../程式參數.md) 伺服器段（rate limit、liveness timeout、register 期限、payload 上限），repo 規格檔 env 表改為引用。
- 伺服器義務與安全規則補記：64 人上限伺服器強制、liveness ping／pong、未 register 不得送訊息、`peers` 保留註冊順序 ＝ 房主辨識的安全相依、peerId 唯一 ＝ 自我取代語意。
- 附帶：pinning「Go」殘影兩處修（[D-20260720-01](D-20260720-01-pinning架構A-prime.md) 改寫後的索引鏡像漏網）。

## 後果與影響

canon 與已交付實作對齊，程式流程圖同輪重繪（拓撲圖自 CF Edge 改 Node 單行程）。CF 定位兩日後即由 [D-20260724-01](D-20260724-01-signaling-v2部署拓撲.md) 更新——官方 signaling 現況改定為 Cloudflare Worker 路徑，本檔的「Node 現況」句自此僅描述當時狀態。repo 規格權威見 [部署資訊/open-4wd-signaling.md](../部署資訊/open-4wd-signaling.md)。
