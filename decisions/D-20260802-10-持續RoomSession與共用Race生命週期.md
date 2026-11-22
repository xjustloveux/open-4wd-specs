---
id: D-20260802-10
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260710-04", "D-20260727-03", "D-20260802-07", "D-20260802-09"]
domains: ["比賽房間", "前端主題"]
sources: ["2026-08-02 持續 RoomSession 與共用 Race 生命週期（issue 000134）"]
files: ["程式架構.md", "流程/觀戰.md", "程式架構/spectator.md", "程式架構/room-runtime.md", "程式架構/seo.md", "美術資源/頁面線框.md", "美術資源/前端技術策略.md"]
vectors: []
deprecates: [{"item":"/watch route","kind":"replaced","replacement":"/room/:roomId 與 /race/:sessionId"}]
---

# D-20260802-10｜持續 RoomSession 與共用 Race 生命週期

## 背景與驅動力

participant 與 spectator 雖已在 room-control admission 階段具名，但前端仍以 RacePage／WatchPage 兩套頁面承擔 scene、viewport、HUD、camera、chat 與終局。分頁刷新又會遺失 RoomService 的記憶體 session，使正式 `/race/:sessionId` 無法重新驗證角色與 active match。這讓 URL、頁面與連線生命週期持續分岔。

## 考慮過的選項

- 保留 `/watch/:id`，以 wrapper 共用部分元件：降低短期搬移量，但仍保留兩套路由與終局，否決。
- 把角色放進 route 或 query：重新整理方便，但 URL 不能證明 admission，且會洩漏角色選擇，否決。
- 以持續 RoomSession 驅動共用 RoomPage／RacePage（採納）：route 只定位 room，角色與 active match 每次都由已驗 session 決定。

## 決定

- participant／spectator admission 成功後都進 `/room/:roomId`；match-start 後都進 `/race/:sessionId`。移除 `/watch` route、redirect、safe-link 與 SEO metadata，不保留角色 URL alias。
- RacePage 依 `RoomSession.role` 選 adapter。participant 啟動決定性 race session、輸入、技能與 race chat；spectator 使用 `SpectatorRaceAdapter` 接 snapshot、HUD、換場、共用相機控制、spectator chat 與 session-end，不啟動本機物理或 participant input。
- bootstrap 在 sessionStorage 只保存此分頁的最小 admission hint：RoomId、role、必要 secret，以及可選 matchId／startedAt。刷新後必須重做 room-control admission；active match 只有在 host live room 仍非 waiting／closed，且以 live roster、stored startedAt、live matchRules 重算出相同 matchId 時才能恢復。
- RoomPage 只有在 provider 確認存在同 RoomId 的持久 hint 時才重建 session；正常延遲送達的訂閱不得被誤判成 reload recovery。聊天在權威 room view 到達後才連線。
- `result-ready` 進共用 `/result/:matchId`；`source-unavailable`、`pre-race-cancelled` 或主動離場回原 `/room/:roomId`。其餘全場異常先在共用 RacePage 顯示具體原因與回房入口。

## 後果與影響

RoomPage 與 RacePage 成為角色共用的唯一 UI 生命週期，觀戰不再複製 3D scene 與 route。sessionStorage 只是恢復提示，不是資格或 host 狀態真相；錯誤、過期或被竄改的 hint 會 fail-closed 並清除。淘汰者仍是 participant，只切 spectator UI，不重新 admission 或改 URL。
