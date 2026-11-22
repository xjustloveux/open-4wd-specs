---
type: impl
domain: ["比賽房間", "前端主題"]
summary: SPA shell、Race Config、Race／Result identity 與 RoomSession 恢復契約
authority: null
slug: null
---
# Race routing 實作契約

> **本檔角色**：`src/race-routing/` 的 implementation authority。完整 route inventory
> 仍由 [程式架構.md §13](../程式架構.md) 持有；本檔只承載 route 判定與頁面生命週期細節。

> **一般頁首導覽**：左側品牌在所有非沉浸頁固定回 `/`；中間導覽只依 route family
> 切換。公開 family（`/`、公告、UGC、About、Help、DMCA、Login、Creator、Settings）
> 顯示「公告／UGC／關於／說明」，玩家 family（Home、Garage、Race Config、Editor、Inbox、
> Room、Result）顯示「Home／Garage／Race Config／Editor／UGC／Inbox」。`/ugc/**` 固定是公開
> shell，玩家導覽中的 UGC 只是入口。右側公開「進入遊戲」恆顯示，依解鎖狀態導向
> Login／Home；Identity 導向 Login／本人 Creator。餘額不在 App Shell，只有本人 Creator
> 頁可讀取。參賽者與觀戰者共用 Race 沉浸 shell，角色由已驗 RoomSession 決定。

> **Race Config 入口狀態**：`/race-config` 不使用 `?mode=local`。一般狀態不帶產品 History State；本機入口以 Browser History State `{ mode: 'local', track?, loadout? }` 傳入偏好資產。頁面只接受驗證後的產品欄位，並在一般／本機狀態間重設互動模型；URL 始終保持 `/race-config`。

> **共用比賽與結果 route identity**：`/race/:sessionId` 的正式分支只接受 canonical RoomId，並由既有 RoomSession 取得真正 matchId；本機分支只接受 `local-session-<uuid>`。`/result/:resultId` 的正式分支只接受 64 位小寫 matchId digest；本機分支只接受 `local-result-<uuid>`，只讀 session-scoped 本機摘要儲存，缺資料即回 `/race-config`。route key 只定位頁面資料，不冒充 Match／Round／Race domain id；不保留 `local-test` sentinel、巢狀 result route 或舊參數 alias。兩種分支共用 `RacePage`／`ResultPage` 與 race runtime。E2E harness／fixture 專用控制只屬測試基礎設施，不是產品 route、History State 或 UI 合約。

> **持續 RoomSession 與角色共用頁**：participant／spectator admission 成功後都先進 `/room/:roomId`，match-start 後都進同一 `/race/:sessionId`。RacePage 從已驗 RoomSession 取角色：participant 啟動決定性 race session；spectator 由 `SpectatorRaceAdapter` 接 snapshot、HUD、換場與終局。角色不放入 URL，且不保留 `/watch` alias。重新整理只保存最小 session admission hint，再向房主重做 admission；active match 必須由 host 現況重算出相同 matchId 才恢復。

> **可驗 Result 生命週期**：正常完賽只有在 MatchResult 鏈上確認後才產生結果導頁。spectator-stream 的 `result-ready` 只給 matchId／RoomId context，RacePage 先與 RoomSession 比對，ResultPage 再從 ledger 讀 verified MatchRecord；驗證失敗回原房。角色共用公開結果，participant 才有再戰操作；RoomSession 保留到使用者手動返回。

> **語系前綴變體**：可索引頁另接受 `/<lang>/` 前綴 URL（SSG / SEO 門牌，[程式架構/seo.md §6](seo.md)）——前綴下掛**同一組頁面路由**（prerender 需在前綴 URL 產出全內容；router 級 redirect 會輸出空殼），語系由 `detectLang` 讀 URL 決定；瀏覽器端 App 殼於首個 NavigationEnd **snap-back 剝前綴**（replaceUrl、query 保留）→ 導向無前綴路由；**站內導航一律無前綴**（語系切換為 JSON 動態、與路由無關，[語系清單.md §6/§9](../語系清單.md)）。
