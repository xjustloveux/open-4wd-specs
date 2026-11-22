---
id: D-20260802-05
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260710-05", "D-20260802-04"]
domains: ["比賽房間"]
sources: ["2026-08-02 spectator policy 建房與 waiting mutation（issue 000131）"]
files: ["程式架構/matchmaking.md", "程式架構/room-runtime.md", "程式架構/spectator.md", "流程/配對.md", "流程/觀戰.md"]
vectors: []
deprecates: []
---

# D-20260802-05｜spectator policy 建房與 waiting 更新

## 背景與驅動力

Room 雖已有 `allowSpectators`、`maxSpectators` 與密碼狀態，但建房固定為允許／20／無密碼，Race Config 與 RoomPage 都無法設定。若 waiting 期允許修改，還必須固定既有 spectator 的撤銷與縮容順序，否則各端會對同一政策產生不同名冊。

## 考慮過的選項

- 只在建房設定：無法在組隊期間因應串流容量或密碼外洩。
- 修改只影響新加入者：關閉觀戰或密碼外洩時無法撤銷既有 session。
- waiting 期 host 權威修改並明確撤銷（採納）：開賽後凍結，邊界可測且不成為賽中踢人工具。

## 決定

- Race Config 以 input-only `RoomCreationAccessPolicy` 一次傳遞 `participantPassword?`、`allowSpectators`、`maxSpectators`、`spectatorPassword?`；預設為允許、20、無觀戰密碼，上限固定 50。
- public `Room` 不含任一 secret，只投影 `allowSpectators`、`maxSpectators`、`spectatorPasswordRequired`、`spectatorPolicyEpoch`。RoomService 私有持有 host 的 spectator secret。
- RoomPage 對所有角色顯示政策；只有 host 且 `state=waiting` 時可修改。每次接受的 mutation 均遞增 epoch；`match-start` 後凍結，直到該場結束回 waiting。
- 關閉觀戰，或新增／更換／移除 spectatorPassword，會移除全部既有 spectator。降低上限時依 admission sequence 從最新者移除；提高上限或放寬政策不移除。
- mutation 的密碼欄採三態：省略代表保留既有 secret、`null` 代表移除、非空字串代表新增或更換，避免只改容量時意外清除密碼。
- 受密碼保護的房間若在 waiting 發生 host succession，而新 host 沒有私有 spectator secret，必須 fail-closed：關閉觀戰並遞增 epoch；不得降級成無密碼公開觀戰。新 host 回到可編輯 waiting 狀態後可設定新政策。
- 本決策只建立政策與撤銷 primitive。角色化 RoomSession admission 與結構化拒因由 issue 000130；原子容量 reservation 由 issue 000132。

## 後果與影響

房主可在建房與 waiting 期完整控制觀戰，public state 可由所有節點驗證且不洩漏 secret；賽中不會出現政策型戰術驅逐。代價是密碼保護房的 host succession 會暫停觀戰，直到新 host 明確重設政策。
