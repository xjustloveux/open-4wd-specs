---
type: impl
domain: ["經濟", "UGC版權", "比賽房間", "版本部署"]
summary: 站點組裝、正式 provider、derived registry 與 runtime 接線契約
authority: null
slug: null
---
# Bootstrap 實作契約

> **本檔角色**：`src/bootstrap/` 的 implementation authority。它只下放原有組裝責任，
> 不改 provider trust、事件驗證、資產來源、wire 或 release gate。

## 1. Derived registry 與收件鏈

站點依既有順序組裝
`economy → ugc-fork → ugc-rating → reputation → moderation → matchmaking → anti-piracy`；
順序是共識的一部分。live 收件驗證總組合維持 match-result 的 matchId／roster 綁定、loadout
參與證明、既有三道驗證、仲裁 panel-signature-set、blacklist 與評分背書，並維護 state 同步
鏡像與指紋索引。

## 2. Browser runtime 與資產來源

瀏覽器真埠工廠負責 Helia 動態 import，關閉時 ledger 先、Helia 後。統一 `asset-source`
解析 `builtin:`、`local:` 與 CID 三路來源，維持 CID LRU 記帳與 in-flight 合流；
viewport、race 與 extras 使用同一位元組來源。

## 3. App 組裝與 provider 邊界

`createOpen4wdApp` 以 dependency injection 組裝，`raceSessionFactory` 由
`race-runtime` 提供真件。十四域真 `AppDataProviders` 的網路互動面一律走傳輸埠；
未接線時回 `errors.p2p.offline`。Quick Match 由 room-runtime 消費 room discovery
snapshot，再走一般 participant admission。

只有 ledger／genesis 是部署 trust root。signaling、bootstrap 等 provider 候選只可在 runtime
由玩家設定、當次 invite 或 community registry 取得，不寫入 build profile。

## 4. 導覽

- 模組主幹與開發階段：[程式架構.md §3](../程式架構.md)
- 抽象介面：[interfaces.md](interfaces.md)
- 房間 runtime：[room-runtime.md](room-runtime.md)
- 比賽 runtime 與 route identity：[race-routing.md](race-routing.md)
