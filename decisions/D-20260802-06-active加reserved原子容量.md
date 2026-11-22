---
id: D-20260802-06
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260802-05"]
domains: ["比賽房間"]
sources: ["2026-08-02 active + reserved 原子容量（issue 000132）"]
files: ["程式架構/matchmaking.md", "程式架構/room-runtime.md", "程式架構/spectator.md", "流程/觀戰.md"]
vectors: ["room/capacity-reservations"]
deprecates: []
---

# D-20260802-06｜active + reserved 原子容量

## 背景與驅動力

SpectatorServer 原先先以已完成登記的 spectatorCount 檢查容量，再非同步開通道。兩個請求可同時看見最後一格仍空並一起放行；`maxPendingOpens` 只限制半開總量，不能代表房間容量。

## 考慮過的選項

- 只降低 `maxPendingOpens`：仍無法把半開請求綁到房間容量。
- 開通道完成後再踢超額者：會建立不應存在的 transport，且結果受完成順序影響。
- admission 前取得一次性容量 reservation（採納）：成功轉 active，所有失敗路徑釋放。

## 決定

- 唯一放行條件為 `active + reserved < maxSpectators`；檢查與保留必須是同一個同步原子操作。
- reservation 在 `openChannel` 前取得。成功後 commit 成 active；開通道失敗、拒絕或 dispose 必須 release；當前 active channel close 才 deactivate。
- 相同 PeerId 重連替換既有 active session，不新增名額；同一 PeerId 的兩個 concurrent reservations 不得同時存在。
- `maxPendingOpens` 保留為獨立 DoS 背壓，先後順序不得讓它取代房間容量。
- generic `CapacityReservations<Key>` 放在 matchmaking domain，後續 participant Quick Match reservation 必須重用同一 primitive，而不是另寫一套計數。

## 後果與影響

併發加入不能超過房主設定上限，半開失敗也不會永久吃掉名額；同身分重連仍可在滿房時替換。代價是所有 async admission 路徑都必須明確 settle reservation，漏掉任何 release 都會 fail-closed 佔住容量。
