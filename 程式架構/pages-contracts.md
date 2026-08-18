---
type: impl
domain: ["前端主題", "比賽房間"]
summary: 路由頁面、AppDataProviders、O4Viewport 與 RaceSession 的資料入口契約
authority: null
slug: null
---
# Pages contracts 實作契約

> **本檔角色**：`src/pages/` 與 `src/pages/contracts/` 的 implementation authority。
> 頁面 route、元件資料 shape 與 fallback 維持現況；視覺規格由美術與主題文件持有。

## 1. 頁面構圖層

`pages/` 實作 [程式架構.md §13](../程式架構.md) 的 22 個 route 構圖層，每頁獨立設計；
editor 與 settings 的自帶頁除外。頁面不得繞過 contracts 直接抓取領域內部狀態。

## 2. 唯一資料入口

`pages/contracts/` 是頁面唯一資料入口，包含十四域 `AppDataProviders` façade、
`O4Viewport` 場景描述子、`RaceSession` 迴圈契約與
`createOpen4wdApp` 組裝形。假 provider 與真實作必須保持同型別互換；真實作只由
bootstrap、viewport 與 race-runtime 注入。

## 3. 責任連結

- UI 元件、token、RWD 與 a11y：[ui-frontend.md](ui-frontend.md)
- Bootstrap 真件接線：[bootstrap.md](bootstrap.md)
- 比賽／結果 route identity：[race-routing.md](race-routing.md)
- 頁面視覺與互動線框：[../美術資源/頁面線框.md](../美術資源/頁面線框.md)
