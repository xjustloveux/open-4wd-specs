---
id: D-20260802-07
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260710-04", "D-20260710-05", "D-20260802-05", "D-20260802-06"]
domains: ["比賽房間"]
sources: ["2026-08-02 RoomSession 角色化 admission（issue 000130）"]
files: ["程式架構/matchmaking.md", "程式架構/room-runtime.md", "程式架構/spectator.md", "流程/配對.md", "流程/觀戰.md", "美術資源/頁面線框.md"]
vectors: ["room/role-admission"]
deprecates: []
---

# D-20260802-07｜RoomSession 角色化 admission

## 背景與驅動力

外部觀戰原本只靠房碼從 discovery 取得 host，密碼與拒因沒有進入真實 signaling 接線；DataChannel 已撥通後才由 SpectatorServer 補判斷。這使 admission 時機晚於資源建立，waiting spectator 也無法加入房間。

## 考慮過的選項

- 保留 WatchPage 索源時 admission：角色與 Room lifecycle 分裂，waiting、賽後回房與 host succession 都需第二套狀態機。
- participant 滿員時自動降級 spectator：使用者意圖不明確，可能在未同意下改變能力與資料流。
- Room control session 明確指定角色（採納）：先裁決資格，再按角色建立 race mesh 或 spectator stream。

## 決定

- `joinRoom` 使用具名 `RoomJoinRequest { role: 'participant' | 'spectator'; password? }`；禁止 positional password 或容量滿時靜默換角色。
- `join-request` 必須帶 role。participant 密碼維持 D-20260710-05 的 challenge-response，明文不上行；spectator 密碼只在加密 room-control admission request 上行。
- HostRoom 分開保存 participant roster 與 spectator control sessions。spectator 可在 waiting 加入、不進 matchId roster、不 ready、不參與 host succession 或 race mesh。
- spectator 拒因為 `spectators-disabled`、`room-closed`、`spectator-full`、`wrong-password`；封鎖或重複身分仍回通用 `join-rejected`。`race-not-started` 不再是 admission 拒因。
- spectator capacity 重用 D-20260802-06 的 `CapacityReservations<PeerId>`。政策撤銷同時終止 control session 與 stream。
- `requestSpectatorSource` 不再做 admission 或接受密碼，只能為本機已驗證的 spectator RoomSession 回傳 host。host 收到 stream 撥入時再次確認該 Peer 已 admission，否則立即關閉。
- Race Config 的 participant／spectator 入口都先完成 RoomSession admission，再進共用 RoomPage。match-start 後 participant 進 RacePage；spectator 暫經 WatchPage 顯示 adapter，完整頁面生命週期合併由 issue 000134 接續。

## 後果與影響

觀戰政策在建立任何單向 stream 前已可驗證，拒因端到端保留，waiting spectator 與 participant 共用房間生命週期。代價是 room wire 與 provider API 必須一次性遷移，舊 `/watch/:roomId` 直接 admission 路徑失效。
