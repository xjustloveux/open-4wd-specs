---
id: D-20260802-09
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260727-03", "D-20260802-01", "D-20260802-07"]
domains: ["比賽房間", "前端主題"]
sources: ["2026-08-02 Race 與 Result 路由識別分層（issue 000140）"]
files: ["程式架構.md", "美術資源/頁面線框.md", "流程/比賽結算.md", "程式架構/audio-system.md"]
vectors: []
deprecates: [{"item":"local-test matchId sentinel","kind":"replaced","replacement":"local session id"},{"item":"/race/:id/result","kind":"replaced","replacement":"獨立 result route"},{"item":"舊 Race／Result 路由參數 alias 與 migration parser","kind":"replaced","replacement":"分層識別的 current routes"}]
---

# D-20260802-09｜Race 與 Result 路由識別分層

## 背景與驅動力

共用 RacePage／ResultPage 已定案，但路由把頁面定位鍵直接叫作 matchId；本機測試沒有可上鏈 matchId，只能以 `local-test` 保留字冒充。正式 RacePage 又跨多回合，URL 若綁 matchId 會跳過既有 RoomSession，讓頁面、房間與帳本識別混成同一層。

## 考慮過的選項

- 保留 `local-test` sentinel：最省改動，但持續讓非帳本值佔用 matchId 欄位，否決。
- 正式與本機各建一套 race／result route：型別清楚但違反共用頁與一頁一路由，否決。
- 以 route-context key 分層，resolver 依不相交格式收窄（採納）：頁面共用，domain id 不再被 URL 參數名稱錯置。

## 決定

- RacePage 唯一路由為 `/race/:sessionId`。正式 sessionId 是 RoomId，解析至現存 RoomSession 再取得 matchId；本機 sessionId 是新的 `local-session-<uuid>`。
- ResultPage 唯一路由為 `/result/:resultId`。正式 resultId 是 64 位小寫 matchId digest；本機 resultId 是新的 `local-result-<uuid>`。
- 本機結果只存於 session-scoped 本機結果儲存；重新整理可依 resultId 還原，缺資料回 Race Config。local id 不得送往 ledger provider。
- local session、local result、RoomId 與 matchId 四種格式互不接受。移除 `local-test` sentinel、巢狀 `/race/:id/result`、舊參數 alias、redirect 與 migration parser。

## 後果與影響

Route key 只負責資料定位；RoomId、matchId 與本機 opaque id 保持各自 domain 語意。正式賽重新整理仍須由持續 RoomSession 驗證，正式結果可由 ledger 恢復；本機結果只保證目前瀏覽器 session。Race／Result 的 BGM、SEO noindex、視覺 fixture 與頁面輸入名稱同步改為新路由，不保留兩套生命週期。
