---
id: D-20260810-02
date: 2026-08-10
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260531-03", "D-20260710-06", "D-20260802-03"]
domains: ["共識帳本", "比賽房間", "信譽仲裁"]
sources: ["2026-08-10 ─ MatchResult 固定名單門檻與離場存證"]
files: ["程式架構/ledger.md", "流程/比賽結算.md", "流程/比賽進行.md", "程式架構/reputation.md", "程式架構/matchmaking.md"]
vectors: ["ledger/match-result-quorum"]
deprecates: []
---

# D-20260810-02｜MatchResult 固定名單門檻與離場存證

## 背景與驅動力

既有 MatchResult 只在 `disconnects.reason === "network"` 時以 original active roster 計 quorum；提案者可把同一離場改填 `voluntary`，先縮小分母再由少數簽章定稿，搶先污染持久 `settledMatchIds`、經濟與評分。直接把所有離場都改為固定名單嚴格多數可堵住少數偽造，卻留下惡意多數拒簽即可作廢落後場次的活性限制。

純 P2P 少數觀察不能證明「某人未送訊息」或「某人惡意拒簽」這類負面事實；把少數自陳直接變成第三人全域處罰，會重新打開投毒面。

## 考慮過的選項

- 讓 voluntary leave proof 縮小 MatchResult 分母：拒絕。不同 membership view 可形成不相交證書。
- 讓剩餘少數直接產生具全域處罰的 disconnect event：拒絕。少數無法客觀證明第三人的離線原因。
- 引入可信裁判、時間權威或託管保證金：首版不採，會改變去中心化與部署信任模型。
- 固定原始名單 quorum，另拆本人自簽成本與零處罰存證：採納。

## 決定

- **〔LEDGER-R-095〕** `MatchResultEvent` 的 quorum 一律為 `floor(unique(ranking ∪ disconnects.peerId).size / 2) + 1`；`disconnects.reason` 不得影響分母。signer 仍只限非 forfeit 完賽者。live、timeless fold admission 與結算交換共用同一公式。
- 新增標準單簽 `RaceLeaveEvent`（`race-leave`）：只由 `BaseEvent.peerId` 本人簽署，綁 `matchId`、`roundIndex` 與 `reason: voluntary`；立即效果僅本人 `disconnectCounts +1` 與 `frequent-disconnect -5`，不產生排名、TrueSkill、經濟或完賽效果，也不縮小 MatchResult quorum。
- **〔LEDGER-R-096〕** `RaceLeaveEvent` 與 `MatchResultEvent.disconnects` 共用持久 `(matchId, peerId)` 離場效果去重集；兩事件任一到達順序或重播都只計次／扣分一次，正式 MatchResult 的其餘效果仍正常套用。
- 新增標準單簽、零業務 reducer 的 `RaceAbortEvidenceEvent`（`race-abort-evidence`），有界保存回報者簽名涵蓋的 frame checksum 摘要、已收訊息 digest 與本機觀察；只供本機避配、診斷、重複行為統計與未來仲裁，不改全域信譽、斷線數、評分或經濟。
- 無 MatchResult quorum 時整場仍 fail-closed。首版接受惡意多數可作廢單場的殘餘風險。

## 後果與影響

本決策 amends 既有多數 quorum、鏈上確認與三平面分割決策：network removal certificate 的安全理由擴張為所有離場 reason-independent，不能再由提案者選擇門檻。本人自簽離場證明補的是「可驗自我成本」，不是第三人缺席證明；中止證據則刻意沒有全域處罰權。

`processedDisconnectEffects` 與 `settledMatchIds` 同為完整性索引，永不逐出並隨 checkpoint 決定性序列化。其線性成長是首版為冪等與到達順序無關所接受的成本。
