---
id: D-20260802-04
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260710-05"]
domains: ["比賽房間"]
sources: ["2026-08-02 participantPassword 建房後不可變（issue 000141）"]
files: ["程式架構/room-runtime.md", "程式架構/matchmaking.md", "流程/配對.md"]
vectors: []
deprecates: []
---

# D-20260802-04｜participantPassword 建房後不可變

## 背景與驅動力

參賽密碼若能在 waiting 中旋轉，必須裁決既有 participant 是否撤銷；保留會讓外洩密碼無法撤權，全部移除又會清掉 ready／loadout 並中斷組隊。房主繼任若傳遞明文，亦違反密碼不離開輸入端的原則。

## 考慮過的選項

- 旋轉只影響新加入者：既有 session 不撤銷，安全語意不完整。
- 旋轉即移除全部非房主 participant：安全但會破壞 waiting 組隊狀態。
- RoomId 生命週期內不可變（採納）：需要換密碼就關房並建立新 RoomId，邊界清楚。

## 決定

- participantPassword 只能在 Race Config 呼叫 `createRoom` 前設定；RoomPage 只顯示有／無，不提供新增、修改或移除入口。
- 建房／加入端先把密碼導成 verifier；challenge proof 改簽 `(nonce, verifier, joinerPeerId)`。HostRoom、RoomService 與 host succession 只保存／傳遞 verifier，不保存明文。
- public Room state 只含 `participantPasswordRequired` 與 `participantPolicyEpoch`；不含 password 或 verifier。epoch 在同一 RoomId 內固定（未設密碼 0、已設 1）。
- host succession 繼承 verifier／epoch；既有 seeded participant 免密重掛。若要變更 participantPassword，必須關閉舊房並重建新 RoomId。
- spectatorPassword 是獨立 waiting policy，不受本決策凍結，後續由 issue 000131 定義。

## 後果與影響

不再需要定義密碼旋轉對既有 participant 的局部撤銷；RoomId 本身成為 policy 生命週期邊界。代價是房主不能原地修補外洩密碼，必須重建房間。D-20260710-05 的挑戰-應答與 PeerId 綁定保留，但 proof 素材與 succession 保存形改為 verifier。
