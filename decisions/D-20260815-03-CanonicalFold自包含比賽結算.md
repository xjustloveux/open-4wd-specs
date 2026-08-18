---
id: D-20260815-03
date: 2026-08-15
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260703-07", "D-20260703-08", "D-20260708-05", "D-20260709-01", "D-20260710-06", "D-20260802-11", "D-20260810-03"]
domains: ["共識帳本", "經濟", "比賽房間", "版本部署", "資安"]
sources: ["2026-08-15 ─ Canonical fold 自包含比賽結算（issue 000537）"]
files: ["資料系統.md", "經濟系統.md", "流程/比賽進行.md", "流程/比賽結算.md", "程式架構/economy.md", "程式架構/ledger.md", "賽內機制.md", "部署資訊/open-4wd-pinning.md"]
vectors: ["ledger/admission-v1", "ledger/match-result-quorum", "ledger/race-consensus-anchor"]
deprecates: [{"item":"MatchResultEvent.economySettlement","kind":"replaced","replacement":"canonical fold 位置的 DerivedState 結算"},{"item":"MatchResultEvent.baseLogHeadCids／roundAnchorCids","kind":"replaced","replacement":"每回合內嵌 RaceConsensusAnchorEvent"},{"item":"verifySettlement","kind":"replaced","replacement":"canonical fold 純函數重算"},{"item":"結算 frontier／payout wire","kind":"replaced","replacement":"由 fold 位置唯一推導"}]
---

# D-20260815-03｜Canonical fold 自包含比賽結算

## 背景與驅動力

OrbitDB public-write ledger 允許節點直接 append 已超過 live 時戳窗的事件。舊模型只在首播 live gate 依事件指定的 `baseLogHeadCids` 回查歷史 state、驗證 anchor CID 與重算事件內 `economySettlement`；timeless fold 則只驗名單、loadout 與外層多簽。攻擊者因此可用自控 roster 與語法合法的假 anchor/base，讓舊時戳事件跳過 live 重算，再由 reducer 直接套用自選 payout。舊月硬頂也只在「套用前已達頂」時擋住事件，未把本次 incoming mint 納入判定。

根因不是單一漏判，而是 D-20260703-08 的 live-only 回查、D-20260708-05 的 timeless 邊界與 D-20260709-01 的事後硬頂組合後，沒有形成歷史 append 可安全重放的完整 trust model。

## 考慮過的選項

- 把 `deriveStateAt(baseLogHeadCids)` 搬進 fold：拒絕。fold 不可執行外部／非同步查詢，也不能讓事件自行選擇其經濟前態。
- 把 `economyConfigEpoch` 或 rating snapshot 寫進事件：拒絕。這仍讓事件選擇計算基準，並擴大可操控與同步面。
- 保留事件 payout，再以更多 bounds 防守：拒絕。bounds 無法證明金額來自 canonical 前態，且容易再次漏掉跨欄位聚合。
- MatchResult 只承載可聯署事實，canonical fold 於事件位置以前態重算：採納。

## 決定

- `MatchResultEvent` 移除 `economySettlement`、`baseLogHeadCids` 與 `roundAnchorCids`；提案、review 與 takeover 同步移除 frontier／payout。外層 roster 多簽只背書比賽事實。
- 每回合改內嵌 `RaceConsensusAnchorEvent | null`。非 null 證書須驗 match、round、terminal tail、anchor 時間、當時 present roster、chain-domain 多簽，以及與外層 start-grid proof 相同的 `gridContextDigest + gridSeed`。anchor 不重複完整 commitment/reveal proof，確保 8 人 × 5 回合 × 全簽事件仍低於 65,536-byte admission 上限。
- 經濟 reducer 以事件 canonical 位置的 `DerivedState` 為唯一權威，讀取當時 `economyConfig`、state-derived UGC rating、rolling windows 與 UGC lineage，純函數產生 settlement；事件不能提供或覆寫金額。
- economy、reputation 與相關 rolling windows 統一使用單調 `state.derivedAt`，不使用可倒填的事件時間。ordinary genesis 將公開 receipt 的正整數 `genesisTimestamp` 注入 `derivedAt` 與 UTC 月錨；正式部署與 pinning replica 缺值或不一致時 fail closed。rebirth 延續 checkpoint state。
- 月硬頂採 incoming-inclusive 判定：`monthMinted + incomingMint > month_hard_cap_minor` 時不入帳。事件仍留下 `MatchRecord` 與 `economyOutcome: monthly-hard-cap`，且 reputation、TrueSkill、斷線效果與 `settledMatchIds` 只套用一次。
- 專案仍為 pre-launch，不提供舊 wire、checkpoint 或本機資料的 dual-read／migration。

## 後果與影響

歷史 append 與 live 首播走同一組自包含 timeless 證明；任何節點重放同一 canonical log 都由相同前態算出相同 payout。移除 frontier 暖身、重算 LRU 與事件 payout 後，收件路徑更小，也不再因本機同步速度產生 settlement accept/defer 差異。

代價是 MatchResult 變大，且缺任一回合 anchor 的場次仍可記錄競技結果但 `mintEligible=false`。尺寸回歸測試鎖定正式上限；若未來擴大 roster、回合數或 proof，必須先重新評估 wire 大小，不得提高 admission 上限掩蓋重複資料。
