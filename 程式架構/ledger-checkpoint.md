---
type: impl
domain: ["共識帳本"]
summary: DerivedState、partition、帳本檢查點與 sync/fork resolution
authority: null
slug: null
---

# ledger checkpoint

> 本檔是 DerivedState、partition、帳本檢查點與 sync／fork resolution 的實作 authority；總入口見 [ledger.md](ledger.md)。

## 2. DerivedState 巢狀結構（hot / cold 兩層）

**〔LEDGER-R-033〕** `matchRecords` 隨比賽數線性增長（大型社群一年可達 ~180 GB）；其餘欄位 MB-GB 量級。故 match 記錄按 **quarter 自然時間分區**：hot 永遠在小量級、cold lazy fetch。切分用 quarter（純函數、跨 peer 一致，非熱度）。

```typescript
interface DerivedState {
  economy: EconomyDerivedState;
  ugc: UgcDerivedState;
  moderation: ModerationDerivedState;
  reputation: ReputationDerivedState;
  ratings: RatingDerivedState;
  match: MatchDerivedState; // match.recentMatches 為 hot
  assetVersion: AssetVersionDerivedState; // B 軸動態 min + per-CID 版本狀態（資料系統 §4、版本規範 §19–§20）
  economyConfig: EconomyConfig; // 治理 config 現值（epoch 化）：genesis 起、config-update 依 log 序推進（ledger.md §8）；
  //   fold 至任一位置＝該位置生效值——固定費率驗證 / signer set / hot 窗皆讀此欄
  lastEventAt: ReadonlyMap<PeerId, Timestamp>; // 規則索引：各 peer 最近寫 ledger 的事件套用時鐘（共通 fold 維護；P5 creatorGone，ledger.md §6）
  coldMatchPartitions: ReadonlyMap<ColdPartitionKey, CID>; // 按 quarter 的歷史 matchRecords CID（lazy）
  derivedAt: Timestamp;
  fromCheckpoint: CID | null;
  eventsAppliedSinceCheckpoint: number;
}
type ColdPartitionKey = `${number}-Q${1 | 2 | 3 | 4}`;

interface EconomyDerivedState {
  balances: ReadonlyMap<PeerId, bigint>; // minor units
  totalMinted: bigint;
  totalBurned: bigint;
  monthMinted: bigint;
  monthStartTimestamp: Timestamp; // 月初 UTC 重置
  uploadCounts: ReadonlyMap<PeerId, { parts: number; tracks: number }>;
  firstUploadDebtUsed: ReadonlySet<PeerId>; // 首次上鏈負資產旗標（每 PeerId 一生一次，見 經濟系統 §10）
  recentMatchCombos: ReadonlyMap<string, Timestamp[]>; // comboHash → 過去 24h 結算時間
  recentPrizedMatches: ReadonlyMap<PeerId, Timestamp[]>; // per-player 過去 24h 領獎場次（有獎場數上限，經濟系統 §6.1b；checkpoint GC 同 combos）
  monthlyFlowsByMonth: ReadonlyMap<string, ReadonlyMap<PeerId, MonthlyEconomyFlow>>; // YYYY-MM；當月＋前 11 個 UTC 月
  lifetimeRoyaltyMintedByPeer: ReadonlyMap<PeerId, bigint>; // 歷來實際鑄出 royalty；永久、不 GC
  processedPaymentIntents: ReadonlySet<string>; // sponsor／maintenance 的 chain-bound signed-intent digest；永久、不 GC、缺欄 fail-closed
}
interface MonthlyEconomyFlow {
  mintedMinor: bigint;
  burnedMinor: bigint;
}

interface UgcDerivedState {
  ugcRecords: ReadonlyMap<CID, UgcRecord>;
  forkLineage: ReadonlyMap<CID, ReadonlyArray<CID>>; // 至多 2 筆 [parent, grandparent]（見 資料系統 §4 / §4.1）
  ugcUsageStats: ReadonlyMap<CID, UgcUsageStat>;
  similarityPending: ReadonlySet<CID>; // 灰區上傳待審（derive 自上傳事件相似宣告 + 未決上傳期案；經濟隔離，anti-piracy.md §5.1）
}
interface ModerationDerivedState {
  // 完整定義見 moderation.md §2
  blacklist: ReadonlySet<CID>;
  peerBlacklist: ReadonlySet<PeerId>; // CID 黑名單 / 玩家三振（純 derive）
  pendingReports: ReadonlyMap<CID | PeerId, ReportInfo[]>;
  reportsByReporter: ReadonlyMap<PeerId, ReadonlyMap<CID | PeerId, ReportInfo>>;
  reportAccuracy: ReadonlyMap<PeerId, { reports: number; successful: number }>;
  arbitrationResults: ReadonlyMap<EventId, ArbitrationResultRecord>; // 結果摘要（不存全事件；含收下該結果的 entry CID）
  pendingAttestations: ReadonlyMap<EventId, ReadonlyMap<PeerId, { result: "pass" | "reject" | "no-quorum"; passRatioX100: number; attestation: Signature }>>; // 仍待結案的案件上待採用的 attestation（moderation.md §5.6；結果收下時清除）
  convictionsByOffender: ReadonlyMap<PeerId, number>; // 規則索引：三振依據（moderation.md §5.5）
  uploadPendingConvictions: ReadonlyMap<PeerId, Timestamp[]>; // 規則索引：安全港 30 天窗（anti-piracy.md §5.1）
}
interface ReputationDerivedState {
  // 完整定義見 reputation.md §2
  scores: ReadonlyMap<PeerId, number>; // 0-1000 整數（raw；新手下限於讀點套用 getEffectiveScore，reputation.md §4）
  history: ReadonlyMap<PeerId, ReputationDelta[]>; // 最近 100 筆、僅 UI（非規則依據）
  lastMaliciousReporterAt: ReadonlyMap<PeerId, Timestamp>; // 規則索引：惡意檢舉前科（30 天 rolling）
  recentMatchGains: ReadonlyMap<
    PeerId,
    ReadonlyArray<{ at: Timestamp; delta: number }>
  >; // 規則索引：24h 比賽加分窗
  registeredAt: ReadonlyMap<PeerId, Timestamp>;
  matchCount: ReadonlyMap<PeerId, number>;
  ugcCount: ReadonlyMap<PeerId, number>;
  ugcMilestonesAwarded: ReadonlyMap<CID, number>; // per-CID 已頒發使用里程碑數，防重複加分
}
interface RatingDerivedState {
  ugcRatings: ReadonlyMap<CID, UgcRatingStat>;
  creatorMilestones: ReadonlyMap<PeerId, CreatorRatingMilestone>;
}
interface MatchDerivedState {
  recentMatches: ReadonlyMap<string, MatchRecord>; // 限近 N 個 quarter（N = EconomyConfig.hot_match_quarters，預設 2）
  settledMatchIds: ReadonlySet<string>; // match-result 冪等閘持久載體：永不逐出（完整性＝冪等閘正確性前提）；隨檢查點序列化、缺欄＝空集不播種
  trueSkillRatings: ReadonlyMap<PeerId, TrueSkillRatingX1000>; // { muX1000; sigmaX1000 } 整數定點（算式表 §20）
  /** sparse map — 未出現 = { vehicle: 1, track: 1 }；vehicle 記正式車位 entitlement、每筆購買事件 +1。本機測試車位不上鏈；track 是 codec 固定為 1 的保留欄，場地仍無可購買位數。 */
  playerSlotCounts: ReadonlyMap<PeerId, { vehicle: number; track: number }>;
  disconnectCounts: ReadonlyMap<PeerId, number>; // 規則索引：累積斷線次數
  processedDisconnectEffects: ReadonlySet<string>; // 〔LEDGER-R-096〕持久 (matchId, peerId) 去重；match-result / race-leave 共用、永不逐出
}

**〔LEDGER-R-096〕** `processedDisconnectEffects` 以 `(matchId, peerId)` 作持久冪等鍵，`match-result` 與本人自簽 `race-leave` 共用同一集合；集合是 current checkpoint 必填欄位，確定性序列化且永不逐出，避免先到的離場證明與後到的結算對同一人重複套用斷線成本。

interface AssetVersionDerivedState {
  // B 軸（版本規範 §19–§20；資料系統 §4 / §4.1）
  // 〔LEDGER-R-034〕 minSupportedByType 推導：對每道破壞牆 V（per-type）：「從 <V 升到 ≥V」的不同創作者數 ≥ DEPRECATED_TO_UNUSABLE_THRESHOLD → min 抬到 V；取滿足的最高 V；單調不降（版本規範 §19）
  minSupportedByType: ReadonlyMap<AssetType, number>; // per-type 動態最低支援版（單調 ratchet）
  versionStatusByCid: ReadonlyMap<CID, "active" | "deprecated" | "unusable">; // 純鏈上推導；yanked = client 清單（major 出貨）讀取層 overlay、不入 DerivedState（版本規範 §22）
  successorEdges: ReadonlyMap<CID, CID>; // 舊 CID → 新 CID（AssetVersionUpgradeEvent；血緣節點映射用；收件驗證見 ledger-admission.md §1）
  lineageNodeByCid: ReadonlyMap<CID, CID>; // 每個版本 CID → 穩定 lineage node；一般 upload 初始映射自身
}
interface ColdMatchPartition {
  partitionKey: ColdPartitionKey;
  matchRecords: ReadonlyMap<string, MatchRecord>;
}
```

**〔LEDGER-R-034〕** `AssetVersionDerivedState.minSupportedByType` 依每個 asset type 的破壞牆推導：跨越牆 V 的不同創作者數達 `DEPRECATED_TO_UNUSABLE_THRESHOLD` 才把 min 抬到 V；多牆取滿足條件的最高值，且 current min 單調不降。完整 predicate 見 [版本規範 §19](../版本規範.md#19-動態最低支援版dynamic-min-supported)。

### 子型別（重點）

```typescript
interface UgcUsageStat {
  totalUses: number;
  uniqueUsers: ReadonlySet<PeerId>;
  lastRoyaltyAtByPlayer: ReadonlyMap<PeerId, Timestamp>; // 每位玩家上次實際鑄出 royalty 的時間；24h 去重錨（會 GC）
  totalRoyaltyMinted: bigint;
  lastUsedAt: Timestamp; // 史上最後一次被用（單調、永不 GC）；P5 退役判定用
}
interface UgcRecord {
  cid: CID;
  author: PeerId;
  uploadType: "part" | "track";
  uploadedAt: Timestamp;
  metadata: UGCMetadata; // immutable fingerprint / parentCid；不含 presentation
  presentation: UgcPresentationMetadata;
  presentationRevision: number; // upload = 0；update 只接受 current + 1
  presentationUpdatedAt: Timestamp; // checkpoint 必填；canonical derivedAt 的 1h 冷卻錨
  maintenanceCandidateSince: Timestamp | null; // P5 退役候選（純 derive）
  retired: boolean;
  lastMaintenanceAt: Timestamp | null; // 最近 renew / unretire 事件時間（續租 grace 屏障，ledger.md §7；lastUsedAt 不受續租影響）
  sponsoredTotalMinor: bigint; // 歷來有效贊助 burn 總額；隨 checkpoint 永久保存，不是作者收入
  sponsorEventCount: number; // 歷來有效贊助事件數；同一付款人重複贊助仍逐筆計數
  lastSponsoredAt: Timestamp; // 最近有效贊助時間，單調不降；無贊助＝0
}
interface MatchRecord {
  matchId: string;
  ranking: ReadonlyArray<PeerId>; // 總名次
  rounds: ReadonlyArray<RoundResult>; // 逐回合結果
  loadouts: ReadonlyMap<PeerId, MatchParticipantLoadout>;
  matchRules: MatchRules;
  gridProof: StartGridProof; // 必填；綁 locked context、全員 commitment/reveal、gridSeed 與逐回合 slot permutation
  disconnects: ReadonlyArray<DisconnectInfo>;
  startedAt: Timestamp;
  finishedAt: Timestamp;
  settlement: MatchEconomySettlement; // canonical fold 依事件前態計算，非事件 wire 欄位
  economyOutcome: {
    status: "applied" | "not-eligible" | "monthly-hard-cap";
    mintedTotal: bigint;
  };
  settledAt: Timestamp; // state.derivedAt；所有 rolling window 的 canonical 時間
  clientVersions: ReadonlyMap<PeerId, ClientVersionInfo>; // 見 版本規範.md（事後審計用）
}
// UgcRatingStat / ExplicitVote / CreatorRatingMilestone：整數量化 rating（×100）見 ugc-rating 業務 spec
```

### Partition 切分函式（deterministic）

**〔LEDGER-R-035〕** 冷分區鍵固定使用事件 timestamp 的 UTC 年份與季度，hot window 也依同一函式切分：

```typescript
function partitionKeyOf(ts: Timestamp): ColdPartitionKey {
  // UTC year + quarter
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` as ColdPartitionKey;
}
function currentHotPartitions(
  now: Timestamp,
  hotMatchQuarters: number,
): ColdPartitionKey[] {
  /* 由 now 往回數 hotMatchQuarters 個 quarter */
}
```

**兩階段純函數性**：apply match-result 事件時**一律放進 hot**（不查當前時間）；hot/cold 切分在 **checkpoint proposer 階段**用 `consensusNow` 決定（見 [資料系統.md §9.1](../資料系統.md)）。

## 3. 帳本檢查點（LedgerCheckpoint）演算法

> **〔LEDGER-R-036〕** **帳本檢查點 ≠ 回合共識錨**：本節是**全網 ledger 狀態整併**機制（治理 signer set：初期 `N=1 → quorum 1`；`N=2` 非法；`N>=3 → floor(2N/3)+1`；每輪 `CHECKPOINT_ROUND_TIMEOUT_MS`（30 分鐘）換一位指定提案者；derived state 整併 + cold 切分，供新玩家同步 / 本地 LRU 裁剪）。檢查點的身分只看**本體**：檢查點 CID ＝本體 canonical bytes 的 CID，簽章另以**檢查點憑證**附上，不屬於身分。提案、投票與定稿公告都是帳本事件（wire 見 [ledger-admission.md §1](ledger-admission.md#1-baseevent-與簽章)）。回合錨是每回合終局的 present-roster 嚴格多數 checksum 證書，見 [資料系統.md §6](../資料系統.md)。兩者 quorum 各管各、皆正確。**本檔以下「Checkpoint」一律指帳本檢查點。**

```typescript
interface LedgerCheckpoint {
  checkpoint_version: 1;
  timestamp: Timestamp; // 提案者先定的時間；狀態以此為 fold 時鐘成形
  round: number; // floor((timestamp − 輪次起點) / CHECKPOINT_ROUND_TIMEOUT_MS)
  log_head_cids: CID[]; // previous 為 null 時 0..64，否則 1..64；按 entry CID bytes 嚴格升冪
  derived_state_cid: CID;
  previous_checkpoint_cid: CID | null; // 前一檢查點的本體 CID
  signer_set_cid: CID; // 前代 signer set 塊（本代 authority）
  signer_set_size: number;
  quorum: number; // N=1 時 1；N>=3 時 floor(2N/3)+1；N=2 非法
  proposer: PeerId;
  next_signer_set_cid: CID; // 成形後狀態的 governanceSigners 塊（下一代 authority）
}
interface SignerSignature {
  signer: PeerId;
  sig: Signature; // 對 ledgerSigningDigest(ledgerAddress, 本體) 的簽章
}
interface LedgerCheckpointCertificate {
  checkpoint_cid: CID; // 本體 CID
  signatures: SignerSignature[]; // signer 嚴格升冪、不重複、至少 quorum 份
}
```

- **〔LEDGER-R-037〕** **公開凍結前的 exact v1 baseline**：本體只接受上列 exact closed shape（恰 11 個欄位）；`checkpoint_version: 0`／`2`、單值 `log_head_cid` 與帶 `signatures` 的本體一律拒絕，不做隱式升級。`timestamp` 與 `round` 為非負安全整數；`log_head_cids` 必須 unique、最多 64 筆，且按 multiformats entry CID 的原始 bytes 升冪 canonical 排序（此排序只供序列化，與 fold total order 不同）；`previous_checkpoint_cid` 為 null（首個檢查點，狀態由創世直接成形）時可為空陣列，否則至少 1 筆。各內容 CID 必須是 canonical 形；`signer_set_size` 為 1 或 3..64 且 `quorum` 等於上式；`proposer` 為有效 PeerId。本體 canonical bytes 上限 32 KiB。
- **〔LEDGER-R-038〕** **觸發條件**：`checkpointTriggerSatisfied({ previousTimestamp, timestamp, entryCount })` 依序判定：previous 為 null → `genesis`（首個檢查點不受間隔限制）；本體 timestamp 距前一檢查點 timestamp ≥ `LEDGER_CHECKPOINT_INTERVAL_HOURS`（24）→ `interval`；距離 ≥ `LEDGER_CHECKPOINT_MIN_INTERVAL_MINUTES`（60）且 `entryCount` ≥ `LEDGER_CHECKPOINT_EARLY_ENTRY_COUNT`（6,000）→ `entry-count`；其餘不成立（常數見 [protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽)）。`entryCount` 是前一檢查點 `log_head_cids` 之後到本體 `log_head_cids` 的條目數，含無法解碼的條目與檢查點控制事件，由 DAG 決定、覆核者可自行驗證。提案、覆核與 `full-refold` 採納共用同一段候選折疊：先取條目並判定觸發，成立才以本體 timestamp 為 fold 時鐘折疊；不成立時提案回 `trigger-not-met`、覆核拒簽、`full-refold` 採納拒絕。覆核與兩種採納模式另在重算前先擋「previous 非 null 而 timestamp 距前一檢查點未滿 60 分鐘」。**仲裁時序（抽籤點 / 投票期滿 / 撤回窗）全掛在檢查點節奏上**（[moderation.md §5](moderation.md)）——檢查點停擺 = 檢舉案卡在抽籤前。
- **〔LEDGER-R-101〕** **輪次與提案者輪替**：輪次起點 `T0` 為前一檢查點的 timestamp；previous 為 null 時取本代 authority 狀態（創世）的 `derivedAt`。`roundOf(t) = floor((t − T0) / CHECKPOINT_ROUND_TIMEOUT_MS)`，`t < T0` 無輪次；本體的 `round` 必須等於 `roundOf(本體 timestamp)`。指定提案者為 `signers[(H + round) mod N]`：`signers` 為前代 signer set 依 signer set 塊的 canonical 序（PeerId 字串升冪、去重），`H` 為 `sha256(dagCbor({ domain: "open4wd-checkpoint-proposer-v1", chainId, previous }))` 前 8 bytes 的大端 uint64。三個值都以 CBOR 文字字串編碼（map 依 dag-cbor canonical 鍵序）：`chainId` 為帳本位址 `/orbitdb/<CID>` 中 base58btc 的 CID 字串；`previous` 為前一檢查點本體 CID 的 base32 字串（CIDv1 預設字串表示，`b` 開頭），previous 為 null 時編為 CBOR null。`N=1` 時指定提案者恆為唯一的 signer。本體 round 只記錄首次提出時的輪次，重提案沿用原本體（〔LEDGER-R-102〕）。各 signer 以本機時鐘判斷「現在輪到誰」，彼此不需一致：錯開只影響效率，安全性由 〔LEDGER-R-103〕 的鎖定保證。`getCheckpointRound` 回報本機時鐘所在輪次、指定提案者、輪次起訖與觸發條件（條目數以 DAG 走訪計）。
- `proposeCheckpoint`：通過共同閘門（帳本已開啟、啟動對帳完成、未隔離、沒有 ingest failure、待定稿索引已建立且其錨等於最新已採納檢查點；錨不一致時回 `stale-previous`，其餘不通過回各自的 code）後，缺投票鎖定紀錄回 `lock-store-unavailable`、非本代 signer 回 `not-signer`、處於自身重複簽署（〔LEDGER-R-105〕）回 `self-equivocation`。待定稿索引有候選本體時先走 〔LEDGER-R-102〕 的既有本體路徑；沒有候選本體、或本節點未鎖定而沒有候選本體通過覆核時，才產生新本體：本節點必須是本機時鐘所在輪次的指定提案者（否則 `not-designated`），未鎖定任何本體且未在此錨提出過本體（否則 `locked`）。之後**先定** timestamp（本機時鐘）、round 與完整 `logHeadCids` frontier，再以與覆核相同的候選折疊成形狀態（不套 `deriveStateAt` 的總時限）；觸發不成立回 `trigger-not-met`，基底或條目取不到回 `state-unavailable`。**本次 checkpoint authority 固定讀前一個已採納 checkpoint 的 derived state（首個 checkpoint 讀 genesis）**，不得讀本次 frontier 折疊後的 signer set，也不得由 options／callback 注入另一份 signer set 作 fallback。若本次窗含 `governanceSigners` 變更，仍由舊集合提案／覆核／finalize，新集合寫進本體的 `next_signer_set_cid`、自下一個 checkpoint 才取得 authority；`full-refold` 與 `quorum-follow` 採納亦同。本代與下一代 signer set 都只允許 `N=1` 或 `N>=3`，下一代不合法時回 `invalid-checkpoint`；呼叫 `splitColdMatchPartitions` 把超出 hot 範圍的 match 移到 cold partition（各 quarter 序列化為獨立 CID），並以 checkpoint `timestamp` 將 `monthlyFlowsByMonth` 裁成當月含前 11 個 UTC 月；`lifetimeRoyaltyMintedByPeer` 不裁剪。cold 塊、derived state 塊、本代與下一代 signer set 塊寫入並 pin 後組成本體，依 〔LEDGER-R-103〕 的「寫鎖 → 簽 → 寫入 `ledger-checkpoint-proposal`」投下提案者的一票；quorum 為 1 時以自己的簽章直接定稿。這兩個經濟投影都是 canonical bigint state，codec 缺欄 fail-closed，不以舊 checkpoint fallback 或 raw log 掃描補值。`N=1` 是初期單一真治理者模式，不建議同一人製造三個假身分；有獨立治理者後應升至至少三位。
- `splitColdMatchPartitions(recentMatches, previousColdCids, now, hotMatchQuarters)`：分桶 → 過期 quarter 合併既有 cold partition（IPFS content-addressed，產生新 CID）→ proposer `pinningProvider.pin` 新 cold CID。
- **〔LEDGER-R-099〕** **待定稿索引**：每個節點以最新已採納檢查點 CID 為錨（null 為創世），從錨之後的 `ledger-checkpoint-proposal` 與 `ledger-checkpoint-signature` 推出每個本體的票；索引是執行期資料，不進 `DerivedState`、不影響 `derived_state_cid`。條目依 canonical fold 順序套用，套用條件全部確定性、不讀牆鐘：提案須 schema 正確、base 單簽有效、`peerId` 等於本體 `proposer` 且屬前代 signer set、`previous_checkpoint_cid` 等於錨、`signer_set_cid`／`signer_set_size`／`quorum` 與前代 signer set 相符、`round` 等於 `roundOf(timestamp)` 且 proposer 為該輪指定提案者、`checkpointSignature` 對本體有效；提案者的簽章算一票，同一本體再次被提案冪等。符合條件的提案全部保留，其中**候選本體**為：(a) 每位提案者在此錨 canonical 順序最前的本體；(b) 任何簽署者以其在此錨 canonical 順序第一張有效票（提案事件或投票事件，取在前者）投給的本體（**升格**）。提案者的第一張票就是自己第一個本體的提案，所以提案者自己的票不會使自己的其他本體升格；每位簽署者第二張以後的票（例如人工釋放後的改投，〔LEDGER-R-104〕）都不升格。投票要求本體已保留，所以此錨的第一張有效票必為提案；候選本體數因此不超過 `2N − 1`（N 為前代 signer set 大小），索引不設過期。同一提案者 canonical 順序較晚的本體即使升格，該提案者對它的 `checkpointSignature` 仍記入其投票紀錄，作為重複簽署證據（〔LEDGER-R-105〕 的 `equivocators`）。每把金鑰只有一個實例的誠實簽署者以第一張票投過的本體一定是候選，所以分區合併後同一提案者另有 canonical 順序較前的本體時，誠實簽署者已投的本體與票仍保留在候選中。誠實提案者不會需要第二個本體：提案時已以「寫鎖 → 簽 → 寫入」投下自己的一票並鎖定，之後不再提出新本體（〔LEDGER-R-102〕）。投票須 base 單簽有效、`peerId` 屬前代 signer set、`checkpointCid` 為已保留的提案（不限候選；canonical 順序在提案之前的投票不收）、`checkpointSignature` 有效；投給尚未升格本體的票照樣記錄，本體升格時這些票一併計入。同人同本體冪等，同人投兩個本體兩票都記，作為重複簽署證據。重提案的覆核順序與投票對象（〔LEDGER-R-102〕）、可定稿與卡死（〔LEDGER-R-104〕）都只看候選本體；`signCheckpoint` 與 `finalizeCheckpoint` 對非候選本體回 `unknown-checkpoint`。非成員的提案與投票可通過准入（准入只驗事件內一致性與工作量，〔LEDGER-R-025〕），但不論即時路徑或重建都不採計。重建以同一組條目重算；採納或定稿使錨前進時索引隨之重建；衝突隔離期間索引為空；`close` 清除。同一組條目不論到達順序得到同一索引。`getPendingCheckpoints` 回傳候選本體與票（票數降序、同票本體 CID 升序；不列尚未升格的提案）、可定稿本體、本機鎖定、重複簽署者、自身重複簽署與卡死狀態；`onCheckpointVotingChange` 在保留提案、收票、升格或整體重建時通知，訂閱者拋出例外不影響帳本。
- **〔LEDGER-R-100〕** **控制事件不進業務 fold**：`ledger-checkpoint-proposal`、`ledger-checkpoint-signature` 與 `ledger-checkpoint-certificate` 三種事件在單筆 fold boundary 一律 `accepted=false`：不推進 `derivedAt`、不記 `registeredAt`／`lastEventAt`、不計入 `eventsAppliedSinceCheckpoint`、不列為 accepted entry，也不通知 `onEvent` 訂閱者。提案與投票改交待定稿索引；定稿公告改交採納佇列（〔LEDGER-R-041〕）。三者仍計入 〔LEDGER-R-038〕 的條目數。
- **〔LEDGER-R-102〕** **重提案**：待定稿索引有候選本體時，`proposeCheckpoint` 不論本節點是否為指定提案者，都先回到候選本體（〔LEDGER-R-099〕；尚未升格的提案不考慮）。本節點已鎖定（受約束的本體恰一個，〔LEDGER-R-103〕）時不寫入新票，回傳得票最多的本體（同票取本體 CID 字串較小者，`selectCheckpointVoteTarget`）、`kind: 'existing'`、`voted: false`；quorum 為 1 且本節點已有對它的票時直接定稿。本節點未鎖定時，依票數降序、同票本體 CID 字串升序逐一以與 `signCheckpoint` 相同的覆核（〔LEDGER-R-039〕）重算（略過本節點已投過、即已人工釋放的本體），投給第一個通過者（`ledger-checkpoint-signature`，`kind: 'existing'`、`voted: true`；quorum 為 1 時直接定稿）；覆核回 `stale-previous`、`not-signer`（屬本節點狀態、與本體無關）或不是 `CheckpointProtocolError` 的錯誤時，直接回報該錯誤、不再覆核其餘本體。沒有任何本體通過覆核時改走新本體路徑：本節點是本輪指定提案者就照一般提案流程產生新本體，否則回 `not-designated`（訊息列出各本體的覆核失敗碼）。因此誠實簽署者不替覆核不過的本體背書，已累積的票不會因換輪作廢，單一作惡提案者塞入的假本體也不會阻擋之後輪到的誠實提案者。
- **〔LEDGER-R-039〕** `signCheckpoint(checkpointCid)`：固定順序為共同閘門 → 缺投票鎖定紀錄回 `lock-store-unavailable` → 本體不是待定稿索引的候選本體（〔LEDGER-R-099〕）回 `unknown-checkpoint` → 非本代 signer 回 `not-signer` → 自身重複簽署回 `self-equivocation`（優先於已投票，同一金鑰另一個實例投過此本體時也要回報）→ 已投此本體回 `already-signed` → 已鎖定其他本體回 `locked` → 覆核 → 寫鎖 → 簽 → 寫入 `ledger-checkpoint-signature`。覆核先做全部不依賴重算的檢查：本體 shape → `previous_checkpoint_cid` 等於本機最新已採納 checkpoint（否則 `stale-previous`）→ 取前一 checkpoint 的治理狀態（取不到回 `state-unavailable`）→ proposer 屬於該治理狀態的 signer set，且 `signer_set_size`／`quorum`／`signer_set_cid` 與該集合相符 → 本節點屬該集合 → `round` 與 timestamp 一致 → proposer 為該輪指定提案者（否則 `not-designated`）→ timestamp 不晚於本機時鐘加 30 秒（不設下限）→ previous 非 null 時距前一檢查點至少 60 分鐘（否則 `trigger-not-met`）。全部通過才以候選折疊重算：觸發不成立回 `trigger-not-met`，重算出的 `derived_state_cid` 或 `next_signer_set_cid` 與本體不符、或下一代 signer set 大小不是 1 或至少 3 回 `recompute-mismatch`。head-set frontier 與前一 frontier 的雙向連續性在重算的條目走訪（前一 checkpoint 的 heads 到本體的 heads）中檢查，不連續即無法重算而拒簽。連續性同時要求：每個 current head 都可到達至少一個 previous head（或相等），且每個 previous head 都被至少一個 current head 到達；不得悄悄遺失 sibling branch。
- **〔LEDGER-R-103〕** **鎖定與本機鎖定紀錄**：一位 signer 對同一 previous 只投一個本體，不論輪次。本節點受約束的本體為「本機鎖定紀錄」與「索引中自己的票」的聯集，兩者都扣除鎖定紀錄中已人工釋放的本體（〔LEDGER-R-104〕）。每次投票（提案或投票事件）的順序固定為**寫鎖 → 簽 → 寫入事件**：鎖定紀錄已鎖其他本體時回 `locked`，寫鎖失敗即不簽、不寫入事件。鎖定紀錄每位 signer 一個 key `__checkpoint_vote_locks_v1__:<chainId>:<signer>`，值為 canonical dag-cbor 的 `{ version: 1, locks }`（`locks` 依 previous 排序，genesis 在前），每筆鎖定為 `{ previous, checkpoint, lockedAt, released }`；所有更新以 compare-and-swap 寫入，CAS 失敗重讀並重新判定，因此同一儲存上的並行寫入者不會對同一 previous 鎖定兩個本體。缺少鎖定紀錄時 `proposeCheckpoint`、`signCheckpoint` 與 `releaseCheckpointVoteLock` 一律 fail-closed（`lock-store-unavailable`）。啟動掃描穩定後，索引中本節點對目前錨恰有一票而本機沒有鎖定時補寫鎖定（`lockedAt` 取該票事件的 timestamp），之後刪除其他 previous 的鎖定；這一步失敗不影響帳本。瀏覽器組裝以 checkpoint control storage（同一個依 chainId 分開的 IndexedDB）承載鎖定紀錄，鎖定紀錄只借用讀寫、不負責關閉。
- **〔LEDGER-R-104〕** **卡死與人工釋放**：沒有候選本體達 quorum `Q`，且 `max(各候選本體票數) + 尚未投票的 signer 數 < Q` 時判定卡死（只計前代 signer set 成員投給候選本體的票，只投過非候選本體的 signer 算尚未投票；`N=1` 不會卡死）。卡死起點 `stall.since` 由索引依 fold 順序重播候選本體的投票紀錄求得：取卡死條件最近一次由不成立轉為成立的那筆投票事件 timestamp，因此由帳本推出、各節點一致。`releaseCheckpointVoteLock({ previousCheckpointCid, fromCheckpointCid, toCheckpointCid, confirmation })` 是受控的重複簽署，只能人工執行；在共同閘門之後依序要求：previous 為目前錨（否則 `stale-previous`）→ 判定卡死（否則 `not-stalled`）→ 本機時鐘減 `stall.since` 至少 `CHECKPOINT_LOCK_RELEASE_MIN_STALL_HOURS`（24）小時（否則 `stall-too-short`）→ from 是本節點目前唯一的綁定、本節點對此 previous 尚未釋放過、from 不是全網一致的投票對象、to 是全網一致的投票對象（得票最多、同票取本體 CID 字串較小者，計算時不排除 from；任一不符回 `release-not-allowed`）→ `confirmation` 逐字等於 `release-checkpoint-lock <previous 或 genesis> <from> -> <to>`（否則 `confirmation-mismatch`）。成功只把 from 記入本機鎖定紀錄的 `released`（沒有鎖定紀錄時先補寫 from 的鎖定再釋放），不寫帳本事件；之後由 `signCheckpoint(to)` 改投。同一 previous 每位 signer 最多釋放一次。投票對象只由索引推出，各節點一致，所以只有綁在其他本體的 signer 可以釋放，且都改投同一個本體；平票時不會有兩側同時改投對方而各自達到 quorum。治理者執行前須人工確認沒有任何本體已達 quorum（包括未公開者）。
- **〔LEDGER-R-105〕** **自身重複簽署**：索引中本節點對目前錨投過兩個以上未釋放的本體時為 `selfEquivocation`（代表同一金鑰在別處運作或外洩）；此時 `proposeCheckpoint` 與 `signCheckpoint` 回 `self-equivocation`，本機鎖定與索引票的聯集超過一個本體時亦同。`equivocators` 列出對目前錨投過兩個以上本體（含非候選本體）的所有 signer，已釋放的票仍列入。`finalizeCheckpoint` 不因自身重複簽署而阻擋；兩個不同本體都被定稿時由 〔LEDGER-R-042〕 隔離。
- `finalizeCheckpoint(checkpointCid)`：任何節點都可定稿，不需要治理金鑰。與遠端 adoption 共用 checkpoint commit queue；瀏覽器另以 Web Locks 對同一 ledger address 跨分頁序列化，無 Web Locks 的 fallback 只承諾單 runtime 序列、**不構成正確性 ／ 跨 peer 信任邊界**。通過共同閘門（不比對索引錨）後在序列化鎖內：本體已是 latest 時補做中斷的邊界推進並冪等成功；否則從索引取候選本體與票（不是候選本體回 `unknown-checkpoint`），previous 必須等於目前 latest（否則 `stale-previous`），前一 checkpoint 的治理狀態取不到回 `state-unavailable`，只保留前代 signer set 成員的簽章並依 signer 升冪排序，不足 quorum 回 `below-quorum`，整份驗證不過回 `invalid-checkpoint`，通過後裁成 quorum 份憑證（〔LEDGER-R-106〕）。取得 lock 後必重讀完整 durable control/revision，再由 storage port 對 expected control bytes 執行真 CAS；不同 intent 的 stale writer 一律拒絕。本體、憑證、conflict evidence 與 derived block 先以 content-addressed artifact 儲存；單一 control envelope 切換才授權狀態。定稿者在這個階段把自己手上已驗過的內容塊寫入本機並 pin：signer set 塊，以及本 runtime 覆核同一本體時重算出的 derived_state 塊、新成形的 cold partition 塊與下一代 signer set 塊（提案者在提案時已寫入並 pin 同一批塊），之後重建與 `deriveStateAt` 不必向網路取這個檢查點的狀態；未覆核就定稿、或覆核後重啟過的節點手上沒有這些 bytes，仍由內容儲存取得。這些內容塊的寫入或 pin 失敗不改變定稿結果。`ledger-checkpoint-certificate` 公告尚未出現在本次 heads 之後才寫入。redo 順序固定為 `journal → latest/effective pointer → boundary commit → journal clear`，pointer 前絕不授予 eviction coverage。多個節點同時定稿同一本體得到同一個檢查點 CID，採納冪等。
- **〔LEDGER-R-106〕** **憑證格式、驗證與保存**：`LedgerCheckpointCertificate` 是 canonical dag-cbor（`checkpoint_cid` 為 canonical 內容 CID、`signatures` 為 1..64 份 `{ signer, sig }`、signer 嚴格升冪），bytes 上限 16 KiB。驗證嚴格：signer set 大小為 1 或 3..64，本體的 `signer_set_size`／`quorum`／`signer_set_cid` 與前代 signer set 相符，`signatures` 依 signer 嚴格升冪、每個 signer 屬該集合、每份簽章對 `ledgerSigningDigest(ledgerAddress, 本體)` 有效且份數至少 quorum，任一不符整份拒絕。定稿與採納都接受至少 quorum 份；本機保存**第一份**驗證通過、依 signer 升冪取前 quorum 份的憑證，之後不替換：檢查點庫以 `__checkpoint_certificate_v1__:<本體 CID>` 存 canonical 憑證 bytes，並另以內容 CID 寫入內容儲存並 pin；本體與憑證都已保存才可設為 latest。各節點保存的憑證都是 canonical 且自足可驗，但不同節點可能保存不同的簽章組合，規格不宣稱跨節點 bytes 相同。定稿公告攜帶裁過的憑證簽章。`Open4wdLedger.getCheckpointCertificate(cid)` 讀本機保存的憑證。
- **〔LEDGER-R-040〕** **CheckpointStore control envelope**：`{ version, revision, latest, effective, conflictEvidenceCid, journal }` 是 exact canonical CBOR，所有 authority 欄位與 revision 由**同一次單 key `storage.compareAndSwap(expectedBytes, nextBytes)`** 線性化；只提供 `get`／`put`、或無法保證 compare-and-swap 原子性的 storage 一律 fail-closed，不得建立 CheckpointStore。IndexedDB 實作必在單一 `readwrite` transaction 內完成 read/compare/write。DB 名稱與 control key 同時帶完整 chainId，兩條鏈即使共用 origin 也不可讀寫同一 control。artifact 已存而 control CAS 失敗只留下不可見 orphan；control 已落盤但呼叫端收到 throw 時，重試若 intent 相同視為冪等成功，intent 不同則 revision mismatch。此 schema 只讀單一 control envelope，不接受分 key pointer fallback。
- **〔LEDGER-R-041〕** **遠端 adoption 與啟動 watermark**：live `ledger-checkpoint-certificate` 公告與 open 時的 historical announcement 掃描都進**獨立**有界 queue（不占 ledger fold queue）：pending+active 64、pending bytes 256 KiB、單 announcement 8 KiB、concurrency 2、retry 1、intrinsic-invalid negative LRU 256。queue 去重、negative cache 與啟動掃描的已檢查集合都以**公告鍵** `${checkpointCid}#${hex(sha256(dagCbor(signatures)))}` 為鍵：同一本體配不同簽章組合是不同的鍵，壞簽章的公告不會連帶封鎖同一本體。增量路徑改走全量 refold 時（例如分區合併後的 sibling 分支），refold 範圍內的公告同樣送入 queue。啟動 durable 掃描只讀本機保留範圍（log 自己的 eviction boundary 到目前 heads，[ledger.md §10](ledger.md#10-客戶端-storage-與同步安全邊界)）：接續最新已採納 checkpoint 的後續 checkpoint，其 CID 相依於前一代、前一代相依於自己的 `log_head_cids`，所以它的 announcement 不可能是這些 heads 的祖先，必在 boundary 之後、不可淘汰；boundary 之前的 announcement 屬可淘汰歷史，不在重啟掃描範圍。因此與已採納 checkpoint 同 previous 的 sibling，若其 announcement 已被該 checkpoint 的 `log_head_cids` 涵蓋，重啟掃描不保證再讀到它；〔LEDGER-R-042〕 的 quarantine 對這種 sibling 只在其 announcement 於 live 到達、或仍落在掃描讀取的範圍內時觸發。掃描以 backpressure 等待容量，不因超過 64 筆而丟棄；若 live 到達時 queue 已滿，必設 rescan，並反覆執行「讀 durable heads → 掃描 ／drain → 再讀 heads」，直到 heads 與 rescan flag 同時穩定才推進 watermark。前景最多等 30 秒，但逾時只讓 `open` 回應，state read、business append、propose/sign/finalize 仍 fail-closed；背景續掃至穩定後才解鎖。背景掃描失敗時記為獨立的掃描失敗狀態（不借用 ingest failure：全量 refold 治不了它），依 〔LEDGER-R-048〕 的退避間隔自行重掃，期間 reconciliation 維持 pending；前景等待期間失敗則 `open` 失敗。`close` 必 abort 等待中的 adoption／ 掃描且不得在關閉後續寫。每則 announcement 先做不依賴重算的檢查：本體 block 的 exact CID／canonical CBOR／closed shape、本體 timestamp 不晚於公告 timestamp、本體已在本機鏈上即視為已採納（保留已存的憑證）、previous 與本機鏈的關係、previous 非 null 時距前一檢查點至少 60 分鐘、proposer 屬於前一 checkpoint 治理狀態的 signer set、`round` 與 timestamp 一致、憑證依 〔LEDGER-R-106〕 驗證通過；全部通過後，`full-refold` 才以候選折疊重算（含完整觸發條件，〔LEDGER-R-038〕），兩種模式都驗 `next_signer_set_cid` 與成形後狀態的治理集合相符且大小為 1 或至少 3。重算時或其後的讀塊或 pin 失敗都進入重試，例如重算取不到 `log_head_cids` 涵蓋的 entry 或前一 checkpoint 的 derived state 塊、內容儲存回報本 checkpoint 的 derived state 塊或 signer set 塊不可得、pin 失敗。只有永久內在無效可進 negative cache：本體 block 本身 exact CID／canonical CBOR／closed shape 無效，以及 proposer、round 或憑證無效（signer set 與輪次起點由本體自己記錄的 `previous_checkpoint_cid` 決定、簽章在公告內，同一公告鍵的判定不會改變；前一 checkpoint 的治理狀態取不到時不判定、屬重試）。網路不可得、timeout、wrapper/context 不符與 retry 耗盡只算本輪有界檢查，不得永久快取或永久阻塞 watermark。
- **〔LEDGER-R-042〕** **同 previous sibling quarantine**：衝突以**本體 CID** 判定：若兩個不同本體 CID 都完整有效且 `previous_checkpoint_cid` 相同，不得 first-seen／ 最長鏈選邊；同一本體配不同簽章組合是同一個檢查點，不構成衝突。evidence 必含每個 candidate 實際驗證的完整 `{checkpointCid, signerSetCid, signers}`；`equivocatedSigners` 是兩份本機保存憑證的 signer 交集，只作證據（憑證已裁到 quorum 份，交集不保證列出所有雙投者），允許空集合（例如兩個完整有效但 signer set 互斥的 sibling）。candidate、signer set 與 signer 均 canonical 排序去重後以 content-addressed artifact 永久記錄；同一次 control commit 原子設 `conflictEvidenceCid`、把 `effective` 回到共同 previous（無 previous 則 genesis）並清除 pending journal。business fold、append、propose/sign/finalize 與後續 adoption 全 freeze，待定稿索引清空，entry transport 仍可同步保留證據。
- **〔LEDGER-R-043〕** **crash redo 與 pre-open reconciliation**：跨 Orbit log／CheckpointStore 不宣稱單一 transaction。重啟在 Orbit open **之前**先讀 control 的 conflict/effective/journal，以 effective frontier 開庫；若 journal 與 effective latest 相符，冪等 redo boundary 後以 CAS 清 journal。announcement 後、control 前 crash 由 historical scan 重驗（該 announcement 在 log 的 eviction boundary 之後，落在掃描讀取的本機保留範圍內）；control 後、boundary 前 crash 由 journal redo；任何階段都不得先淘汰未被 authority control 覆蓋的 entry。
- **Cold partition pinning 責任**：proposer 立即 pin 新 cold CID，自行定稿的覆核者 pin 自己重算出的同一批 cold CID；pinning service 訂閱 `ledger-checkpoint-certificate`、從 derived_state_cid 解出所有 `coldMatchPartitions` 值全 pin。
- **檢查點兼鏈重生錨**：帳本壞損最後手段不是注入裸 state CID，而是 `InitialCheckpointProof` 的完整來源 checkpoint chain。`parseInitialCheckpointProof` 先驗 closed descriptor 與 commitment（`checkpointCertificateCids` 與 `checkpointChainCids` 逐項對應）；`verifyInitialCheckpointProof` 逐代以當代 authority 驗憑證、previous 連續與 timestamp 嚴格遞增，authority 由本體的 `next_signer_set_cid` 推進，只有最後一代取 DerivedState 並驗其 `governanceSigners` 與 `next_signer_set_cid` 相符、log heads 與 cold partitions 齊全。`Open4wdLedgerOptions` 的 `genesisState` 與 `initialCheckpointProof` 互斥；proof 在 `open()` 連線後、任何 state 可讀前驗證，失敗清空 runtime 狀態且不得 fallback。browser composition root 由 deployment config 原樣傳遞；pinning 的 version-1 self-contained bundle 會先離線驗證、再預載 blocks。規範不變式見 [../資料系統.md §19](../資料系統.md)〔LEDGER-R-098〕。

## 4. Sync 與 Fork Resolution

### 4.1 有界 entry sync 與本機持久化

- **〔LEDGER-R-044〕** Orbit entry 使用獨立 IndexedDB blockstore `open4wd/ledger/entries`；不得與 Helia/Bitswap 內容 blockstore 共用，也不得以 shared `getAll()` 計算 entry quota。derived state／cold CID 等內容塊仍走 Helia blockstore。
- 遠端 head 的直接 pubsub／stream bytes 在 `Entry.decode` 前套單筆、per-source、global fixed-window 與 queue bytes/messages 四層 admission。缺少的 `next` ancestor 只可向送來該 authenticated head 的 peer 走 length-framed `/open4wd/orbit-entry-fetch/1/<orbit-address>`；先讀 4-byte length header、超過 `LEDGER_ENTRY_BLOCK_MAX_BYTES` 即 abort stream，不配置 payload、不落盤；完整 payload decode 後還須驗 `entry.hash === requested CID`，不符整次 join 回滾。**任何情況都不回退到 Helia/Bitswap 抓 Orbit entry。**
- **〔LEDGER-R-045〕** remote join 必須接到目前任一 head 或 finalized checkpoint boundary；isolated fork 拒絕。head metadata 在 JSON parse 前限制 65,536 bytes，解析後最多 64 heads；`next` 是因果鏈、`refs` 只作 skip pointer 且不 traversal。
- **〔LEDGER-R-046〕** remote join 與 local `commitPrepared(finalEntryBytes, cid)` 都先經 canonical Admission validator 再 staged；production local write 不得呼叫 `db.add(event)`／`Log.append` 重建 entry。entry/index/heads 三層 commit 任一失敗會逆序 rollback。rollback 自身失敗會在獨立 durable integrity storage 寫 poison marker，本 runtime 與下一次重啟皆 fail-closed，直到使用者執行明確的本機 ledger cache rebuild/drop；不得把半套 log 繼續同步。
- **〔LEDGER-R-047〕** quota eviction 只刪 finalized-checkpoint-covered entry，且呼叫專屬 entry blockstore 的真 `delete`。重啟不信任可偽造的 coverage side metadata：從本地 finalized boundary 沿 `next` 重建，逐 entry 驗 CID／Orbit identity 簽章 ／custom access-controller；boundary 缺失、ancestor bytes 損壞或鏈不一致即拒開。因沒有獨立 coverage version/checksum 檔，亦沒有「竄改 metadata 便取得淘汰權」的信任面。

- **〔LEDGER-R-048〕** `syncFromCheckpoint`：取 effective latest checkpoint（無則從 genesis/log 重建）；已有 checkpoint 而其 derived_state 塊讀不到時重建失敗，不退回 genesis 重放（checkpoint 之前的 entry 可能已被本機淘汰）→ 載已驗 derived_state（hot + coldMatchPartitions 的 **CID map**，cold 本體不載）→ 從 `log_head_cids` 完整 frontier fold 後續 DAG。遠端 checkpoint announcement 的下載 ／ 驗證 ／adoption 已由 [§3](#3-帳本檢查點ledgercheckpoint演算法) 獨立 queue 接線；不可直接把未驗 pinning 內容設為 latest。live update 必保留完整 LogEntry metadata；每次以 stable durable heads 抓取 catch-up batch，只有整批 canonical key 都嚴格大於上一折疊 key 時才增量 apply。若 production frontier continuity 拒絕 sibling growth（例如 `P→A` 已 fold 後 `P→B` 到達，`[A]→[A,B]` 不是連續增量），則在同一 state queue 對 stable full DAG refold；其他 storage／integrity error 仍進 ingest recovery，不得被誤當 reorg。event timestamp 只做收件 ／ 守門，不得拿來決定 fold order。增量 apply 若在 durable log commit 後失敗，runtime 立即標記 ingest failure、跳過同批排隊通知並 full refold；恢復完成前 state reads／business writes fail-closed，重啟亦可由 durable log replay。recovery refold 失敗後有三種時機會再重建，每次都是 state queue 中的單一工作、彼此不並行：ingest failure 期間有新 entry 到達與退避計時器到期共用同一個 single-flight 排程（已排入 queue 時不重複排），失敗計入退避；checkpoint 採納或定稿後的重建是另一個 queue 工作，不經 single-flight；它失敗時定稿或採納的結果不變（checkpoint 已提交），在同一個 queue 工作內標記 ingest failure，之後依退避表排下一次重試並計入失敗次數；已有待執行的重試時不改變它、也不計入。ingest failure 期間到達的 checkpoint announcement 目前不會被送進採納流程，採納後的重建只在 announcement 於失敗前已進入採納流程、或由啟動掃描送入時發生。退避間隔依連續失敗次數為 1 秒、5 秒、30 秒、2 分鐘，之後固定 5 分鐘，不設總次數上限；新 entry 觸發的重試不得早於目前的退避間隔，避免每筆 entry 都引發一次全量重建。任何一次成功的重建（含採納後、定稿後與明確 `syncFromCheckpoint`）都在同一個 queue 工作內清除 ingest failure、補發積欠通知並把退避歸零；補發時訂閱者拋出例外視同該次重建失敗。計時器在 `close` 與 `open` 失敗時清除，回呼只對排定它的那一代 runtime 生效。退避是本機排程政策，不參與共識；目前狀態由 `getRecoveryStatus` 提供給介面。
- **〔LEDGER-R-049〕** **accepted／pending／notified 分離**：只有 decode 成功、非檢查點控制事件（〔LEDGER-R-100〕）、未來時戳排除、所有 timeless signature／`foldGuard` 通過，且 `applyEvent` 實際執行未拋錯的 entry 才列為 accepted；獨立 `pendingNotificationEntries: Map<hash, LogEntry>` 保留 accepted-but-unnotified payload，`notified hashes` 記本 runtime 已送過的集合，不得把「decode 成功」直接當通知資格。startup reconciliation／conflict quarantine／ingest failure 任一未安全時，remote business entry 可先進 tentative derived state 與 pending map，但 `onEvent` 必為零；stable watermark、conflict/ingest 均已清除後，必在同一 state queue 依 canonical order flush pending，每筆恰一次，送出後移出 pending 並標 notified。若有效遠端 checkpoint 的完整 DAG／derived state 已驗證一致，coverage 只能取**該次 checkpoint-time fold 實際回傳的 accepted entries** 與當前 pending 的交集；不得以 raw frontier membership／head-set 可達性代替，也不得為通知另跑一次 fold 而引入不同規則。adoption 只在 durable control/boundary commit 完成後、rebuild 前於 state queue 標記這份 accepted coverage，因此 post-checkpoint replay window 即使為空仍可保留確實已折入 checkpoint state 的 payload 直到 stable flush；例如 `E.timestamp > checkpoint.timestamp` 時 E 雖在 raw DAG 仍不屬 coverage、不得通知。一般 full refold 若 entry 不再 accepted 且無上述 coverage 即從 pending 移除；永久無效 ／ 掃描轉 conflict 會清掉相應或全部 tentative pending，永不補送；`close`／open failure 同步清除 accepted、pending、coverage、notified 與 baseline，遲到 scan 不得 flush。open 前 durable history 在第一次 refold 建為 notified baseline，不偽裝成 live event。accepted replay map 仍隨 checkpoint/prune 完整替換，pending object buffer 則獨立保留未送 payload，但硬上限同 production `LRU_ENTRY_LIMIT=10,000`，超過即 fail-closed；flush、一般 refold、conflict、checkpoint coverage 完成與 close 都會裁剪，因此不形成無界 buffer。
- **Cold partition 不主動下載**：新玩家只查最近資料；查到 cold 時 `getMatchRecord` lazy fetch（顯示 loading）。
- **〔LEDGER-R-050〕** **Orbit multi-head 與 full-DAG fold**：所有已連到任一 verified head／checkpoint boundary 的 sibling 都保留，不以 arrival order 刪 branch；`entriesBetween(previousHeads, currentHeads)` 走 current frontier 可達的完整 DAG、在 previous frontier 截止並驗上列雙向連續性。共識 fold total order 固定為 `clock.time` 升冪 → `clock.id` 依 JavaScript UTF-16 code-unit 升冪 → entry CID 原始 bytes 升冪；這是對 Orbit equal-clock 行為的明確強化。read-only active-head 僅供展示，不得作共識裁切；同一 entry 集合不論到達順序，fold bytes／derived CID 必須相同。回合 anchor 衝突另走 `consensus-invalid`，不提供可挪用至 ledger sibling 的 winner 規則。
