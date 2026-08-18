---
type: impl
domain: ["比賽房間", "資安"]
summary: 身分分域收藏清單、公開房間衍生狀態與授權通關來源
authority: null
slug: null
---

# player-favorites（玩家收藏與授權通關來源）

> **本檔角色**：定義單向、本機、身分分域的玩家收藏清單，以及只從已驗簽公開房間公告
> 衍生的狀態。房間端如何消費收藏快照見 [room-runtime.md](room-runtime.md)。本功能不是好友
> 關係，沒有好友請求、互相關係、通知、私訊或社交圖譜。

## 1. 收藏資料

`FavoritePlayer` 為 `{ peerId, nicknameSnapshot, addedAt, note? }`。資料存於 sealed identity
container 的 `favorites` domain，隨 PeerId 加密分域；不上鏈、不廣播、不跨裝置自動同步，對方
不會知道自己被收藏。上限為 `UI.social.FAVORITES_MAX = 200`；第 201 筆拒絕並要求玩家手動
整理，不以 FIFO 自動淘汰。重複加入只更新本機快照，不增加筆數。

解碼會檢查陣列、欄位界線、重複 PeerId 與上限。container 或 blocklist 無法安全讀取時，
`FavoritesService.list()` fail closed 回空清單。自己與已封鎖 PeerId 不可加入；讀取時再次過濾
封鎖清單。封鎖成功後另呼叫收藏清理鉤，但即使清理儲存失敗，封鎖判定仍優先。

## 2. 公開房間衍生狀態

狀態只讀 `RoomDiscoveryTable` 已接受的 `room-announce` 與 `room-presence`：公告已先經 topic
payload、簽章、時戳、nonce 與房主歸屬驗證。只採 `visibility=public`；私人房、其他線上活動與
mesh 分區皆不可推測。

UI 三態為：

- `public-room`：在公開 waiting 房，附 `roomId` 與 `trackId`；
- `racing`：公告為 preloading／racing／settling，附同樣可驗證識別；
- `not-in-public-room`：目前 discovery snapshot 沒有可證明的公開房資料。

最後一態不得翻譯成「離線」。若同 PeerId 同時出現在多筆有效公告，先取公告時間較新者，再以
RoomId 排序決定，避免網路到達順序造成不穩定 UI。

## 3. Provider 與 UI

`AppDataProviders.favorites` 是頁面的唯一資料入口，提供 `list/add/remove`。Home 顯示收藏及公開
房間入口；Room 成員列、Result 排名與 Creator 公開頁提供加入／移除；Settings 隱私分類提供
清單管理。UI 用語固定為「收藏清單／Favorites／お気に入り／收藏」，不得稱為好友。

## 4. 授權通關邊界

RoomPage 的 waiting 房主可從目前收藏清單建立一個預設空集合的授權快照，並可明確全選後保存。
provider 在交給 RoomService 前再次驗證每個 PeerId 都是目前收藏且沒有重複。後續收藏增刪不自動
改寫已保存的房間快照。

授權通關只略過 participant 或 spectator 的 OPAQUE 密碼證明；仍先執行封鎖、房間狀態、重複
身分、容量 reservation、版本與 wire 驗證。名單只存在目前 `HostRoom` 記憶體，不進 public
`Room`、wire、sessionStorage、RoomSession resume 或 succession envelope。相同 host runtime
的頁面導覽不影響名單；完整 reload、host loss 或房主繼任都建立空名單，避免舊授權移交或雙權威。

## 5. 測試重點

- 199／200 可加入，201 拒絕且不淘汰舊資料；
- 自己、封鎖者、損壞 favorites 或不可讀 blocklist fail closed；
- 私人公告不產生狀態，waiting 與 racing 投影分離；
- participant／spectator 授權只略過 OPAQUE，封鎖與容量仍拒絕；
- 非 waiting 更新拒絕，新 HostRoom 不承接舊名單；
- Room UI 預設空集合、全選需明確操作。
