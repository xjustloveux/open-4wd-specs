---
id: D-20260810-03
date: 2026-08-10
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260531-03", "D-20260604-02", "D-20260703-08", "D-20260708-04"]
domains: ["共識帳本", "比賽房間", "資安"]
sources: ["2026-08-10 ─ 回合唯一 Consensus Anchor 與衝突失效（issue 000315）"]
files: ["資料系統.md", "流程/比賽進行.md", "流程/比賽結算.md", "賽內機制.md", "程式架構/ledger.md", "資安規範.md", "程式參數.md"]
vectors: ["ledger/race-consensus-anchor"]
deprecates: [{"item":"RaceSnapshotEvent／race-snapshot","kind":"replaced","replacement":"每回合唯一 RaceConsensusAnchorEvent"},{"item":"resolveFork／BranchInfo／FORK_RESOLUTION_*","kind":"replaced","replacement":"同回合衝突即失效"},{"item":"賽內 longest-chain winner","kind":"replaced","replacement":"唯一 anchor 與衝突失效"}]
---

# D-20260810-03｜回合唯一 Consensus Anchor 與衝突失效

## 背景與驅動力

canon 曾把 `RaceSnapshotEvent` 描述成每 60 秒延伸、分歧時可用最長鏈與 checksum 字典序選邊的快照鏈；實作的 `resolveFork` 卻沒有產品呼叫點。事件本身也沒有 state bytes、previous CID 或 ancestry，既不能量鏈長，也不能 restore/replay。把未接線規則補進產品只會創造可操控的 winner，而不是補足共識安全。

另一方面，讓每個 frame 各自鎖一次簽章仍不足以保證每回合唯一：終局幀存在小幅差異時，同一 signer 可能合法簽兩個不同 frame。需要把唯一性鎖提升到整個回合，並限制候選只能來自終局附近的有界 final tail。

## 考慮過的選項

- 接線舊 longest-chain／lexicographic-checksum：拒絕。事件沒有可計算的鏈結構，也沒有 PoW、stake 或可信時間權重；鏈長與 checksum 都可由提案者操控。
- 維持單簽時間錨，結算只看最大 timestamp：拒絕。任意一簽可移動 watcher 視圖，且不能證明回合終局共識。
- 對 majority state overwrite：拒絕。相同 input 的 state divergence 代表版本、物理決定性、資產或作弊問題，覆寫會掩蓋根因。
- 每回合 sign-once、穩定 proposer/fallback、嚴格多數唯一證書：採納。

## 決定

- 取代 spec 舊模型（無獨立 ADR）：刪除 `RaceSnapshotEvent`、`race-snapshot`、`resolveFork`、`BranchInfo` 與 `FORK_RESOLUTION_*`；不再每 60 秒寫 ledger，也不存在賽內 longest-chain winner。
- 新增每回合終局 `RaceConsensusAnchorEvent`。原始 roster 依 PeerId code-unit 排序選 proposer，逾時 deterministic fallback；候選必須是 120-frame 對齊且落在 rollback finality 之外的有界 round-end tail。
- 每個 signer 對同一 `(matchId, roundIndex)` 最多簽一份 anchor。`presentPeers` 為原始 roster 扣除已確認離場者，canonical 排序去重；證書要求嚴格多數不同 eligible signer。
- `MatchResultEvent` 寫入 `rounds[].terminalFrame` 與逐回合 `roundAnchorCids`。任一 CID 缺失、不可由 settlement frontier 到達或證書無效時，不得 `mintEligible=true`；bounded window 不提供單簽 fallback。
- 同回合兩張不同且完整有效的證書使整場 `consensus-invalid`。`RaceAbortEvidenceEvent` 保存兩張證書與重疊 signer；不選鏈、不偽裝成個人離場，也不直接造成全域信譽處罰。
- 120-frame checksum 投票若有嚴格多數，持續少數端自我驅逐；沒有嚴格多數時全端結束整場，避免對稱分割各自驅逐對方。

## 後果與影響

本決策 amends 既有賽局多數、settlement base 新鮮度與 RaceSnapshot 首播寬鬆驗證：嚴格多數不再只是賽內自理，而成為 anchor admission 與指定 CID watcher 的必要條件。開發期不保留舊事件相容層或資料 migration。

安全性由 per-round sign-once 與 quorum intersection 提供；活性代價是 proposer 分裂或拒簽可使該回合無錨、整場禁 mint。這是純 P2P、無可信裁判前提下的明確 fail-closed 邊界。
