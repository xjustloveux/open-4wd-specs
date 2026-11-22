---
id: D-20260802-08
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260726-02", "D-20260731-02", "D-20260802-06"]
domains: ["比賽房間", "版本部署"]
sources: ["2026-08-02 Quick Match 加入既有公開房（issue 000138）", "2026-08-12 公開房公告 lease 抗背景節流"]
files: ["程式架構/matchmaking.md", "程式架構/room-runtime.md", "程式架構/peer-discovery.md", "流程/配對.md", "美術資源/頁面線框.md"]
vectors: ["room/quick-match-selection", "room/capacity-reservations"]
deprecates: [{"item":"matchmaking/v1 match-request／match-offer","kind":"replaced","replacement":"rooms topic 的 RoomId 廣告"},{"item":"MatchmakerPoller","kind":"replaced","replacement":"公開房查詢與加入"}]
---

# D-20260802-08｜Quick Match 加入既有公開房

## 背景與驅動力

既有 canon 與 runtime 以陌生玩家互發 `match-request`、由 PeerId 字典序較小者建立預設房，再以 `match-offer` 邀請對方。產品語意則是讓玩家快速加入其他玩家已建立的公開房；舊流程會錯置房主、賽制與房間 access policy，也使沒有候選房時憑空建立使用者未選擇的房。

## 考慮過的選項

- 保留兩 peer 撮合並建立新房：不符合加入既有房的產品語意，棄。
- 先搜尋既有房，逾時再自動建房：會讓同一操作產生兩種不同責任與政策，棄。
- 只搜尋既有公開房，admission 失敗持續搜尋至逾時（採納）：房主、賽制與政策都有單一權威。

## 決定

- Quick Match 只選擇既有 `visibility=public`、`quickMatchEnabled=true`、無 participantPassword、仍在 waiting 且有 participant 空位的房；版本、模式與規則必須相容。
- `visibility` 與 `quickMatchEnabled` 是明確建房政策，不得由是否設定 participantPassword 推導。
- 房間公告包含最新 player count／state、client version、模式／規則與現有 participant displayRating 的決定性中位數。rating 窗口初始 ±5，每 10 秒 +5，上限 ±30；候選依 rating 距離、現有人數較多、RoomId 排序。
- 公告／presence 名目每 30 秒刷新，lease 固定 120 秒並以絕對下一刷新 deadline 防延遲 callback 追趕 burst；頁面回 visible 立即補刷新。此餘裕涵蓋一分鐘級背景 timer throttling 的一次漏拍與網路延遲，接收端仍以 300 秒硬上限防超長自報 lease 滯留。
- 公告只做預篩。選中後走一般 participant admission；房主以最新 roster 與 `CapacityReservations<PeerId>` 原子重驗最後席次。競爭失敗回 discovery 輪詢。
- 無候選時持續搜尋到 `quickMatchTimeout`；逾時提示且不得建立 fallback 房。取消／dispose 不得留下房間、presence 或 reservation。
- 移除 `matchmaking/v1` 的 `match-request`／`match-offer` 協議與 `MatchmakerPoller` 接線；Quick Match 以 rooms topic 的 `RoomId` 廣告完成。

## 後果與影響

Quick Match 成功後沿用既有 host、RoomId、MatchConfig 與 RoomAccessPolicy，公開房公告也成為可驗證的明確契約。房間清單可能短暫過期，因此 host admission 必須保留最終權威；多位玩家搶最後一席時只有 reservation 成功者可進房，其餘繼續搜尋。

本決策修訂 D-20260726-02 中「Quick Match 使用 standard 預設建房／新請求」的敘述：Quick Match 仍以 standard 作候選需求，但只加入相容的既有房，不再建立預設房或發出配對請求。D-20260731-02 的 topic namespace 契約移除固定 matchmaking topic，rooms 與各動態 topic 的 chain scope／驗簽規則不變。D-20260802-06 的共用容量 primitive 正式擴及 participant admission。
