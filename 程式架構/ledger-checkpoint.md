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
- `proposeCheckpoint`：通過共同閘門（帳本已開啟、啟動對帳完成、未隔離、沒有 ingest failure、待定稿索引已建立且其錨等於最新已採納檢查點；錨不一致時回 `stale-previous`，其餘不通過回各自的 code）後，缺投票鎖定紀錄回 `lock-store-unavailable`、非本代 signer 回 `not-signer`、處於自身重複簽署（〔LEDGER-R-105〕）回 `self-equivocation`。待定稿索引有候選本體時先走 〔LEDGER-R-102〕 的既有本體路徑；沒有候選本體、或本節點未鎖定而沒有候選本體通過覆核時，才產生新本體：本節點必須是本機時鐘所在輪次的指定提案者（否則 `not-designated`），未鎖定任何本體且未在此錨提出過本體（否則 `locked`）。之後**先定** timestamp（本機時鐘）、round 與完整 `logHeadCids` frontier，再以與覆核相同的候選折疊成形狀態（不套 `deriveStateAt` 的總時限）；觸發不成立回 `trigger-not-met`，基底或條目取不到回 `state-unavailable`。**本次 checkpoint authority 固定讀前一個已採納 checkpoint 的 derived state（首個 checkpoint 讀 genesis）**，不得讀本次 frontier 折疊後的 signer set，也不得由 options／callback 注入另一份 signer set 作 fallback。若本次窗含 `governanceSigners` 變更，仍由舊集合提案／覆核／finalize，新集合寫進本體的 `next_signer_set_cid`、自下一個 checkpoint 才取得 authority；`full-refold` 與 `quorum-follow` 採納亦同。本代與下一代 signer set 都只允許 `N=1` 或 `N>=3`，下一代不合法時回 `invalid-checkpoint`；呼叫 `splitColdMatchPartitions` 把超出 hot 範圍的 match 移到 cold partition（各 quarter 序列化為獨立 CID），並以 checkpoint `timestamp` 將 `monthlyFlowsByMonth` 裁成當月含前 11 個 UTC 月；`lifetimeRoyaltyMintedByPeer` 不裁剪。cold 塊、derived state 塊、本代與下一代 signer set 塊寫入並 pin 後組成本體，本體也先以內容塊寫入並 pin，再依 〔LEDGER-R-103〕 的「寫鎖 → 簽 → 寫入 `ledger-checkpoint-proposal`」投下提案者的一票；quorum 為 1 時以自己的簽章直接定稿。提案事件寫入失敗時鎖定不撤。本節點已鎖定、而待定稿索引沒有保留鎖定的本體時，`proposeCheckpoint` 先嘗試重送：由內容塊取回鎖定的本體，它是本節點對目前錨提出的本體時，重簽同一本體並重寫提案事件（quorum 為 1 時接著定稿），回 `kind: 'proposed'`、`voted: true`，不產生新本體、不改鎖定紀錄。本體塊取不到、鎖定的不是本節點對此錨提出的本體，或本機保留範圍已有本節點對同一本體寫出、事件簽章有效的提案事件時不重寫，回到一般流程（沒有候選本體時回 `not-designated` 或 `locked`）；保留範圍因目前 heads 含有不經過邊界的分支而無法界定時，視為沒有既有提案。這兩個經濟投影都是 canonical bigint state，codec 缺欄 fail-closed，不以舊 checkpoint fallback 或 raw log 掃描補值。`N=1` 是初期單一真治理者模式，不建議同一人製造三個假身分；有獨立治理者後應升至至少三位。
- `splitColdMatchPartitions(recentMatches, previousColdCids, now, hotMatchQuarters)`：分桶 → 過期 quarter 合併既有 cold partition（IPFS content-addressed，產生新 CID）→ proposer `pinningProvider.pin` 新 cold CID。
- **〔LEDGER-R-099〕** **待定稿索引**：每個節點以最新已採納檢查點 CID 為錨（null 為創世），從錨之後的 `ledger-checkpoint-proposal` 與 `ledger-checkpoint-signature` 推出每個本體的票；索引是執行期資料，不進 `DerivedState`、不影響 `derived_state_cid`。條目依 canonical fold 順序套用，套用條件全部確定性、不讀牆鐘：提案須 schema 正確、base 單簽有效、`peerId` 等於本體 `proposer` 且屬前代 signer set、`previous_checkpoint_cid` 等於錨、`signer_set_cid`／`signer_set_size`／`quorum` 與前代 signer set 相符、`round` 等於 `roundOf(timestamp)` 且 proposer 為該輪指定提案者、`checkpointSignature` 對本體有效；提案者的簽章算一票，同一本體再次被提案冪等。符合條件的提案全部保留，其中**候選本體**為：(a) 每位提案者在此錨 canonical 順序最前的本體；(b) 任何簽署者以其在此錨 canonical 順序第一張有效票（提案事件或投票事件，取在前者）投給的本體（**升格**）。提案者的第一張票就是自己第一個本體的提案，所以提案者自己的票不會使自己的其他本體升格；每位簽署者第二張以後的票（例如人工釋放後的改投，〔LEDGER-R-104〕）都不升格。投票要求本體已保留，所以此錨的第一張有效票必為提案；候選本體數因此不超過 `2N − 1`（N 為前代 signer set 大小），索引不設過期。同一提案者 canonical 順序較晚的本體即使升格，該提案者對它的 `checkpointSignature` 仍記入其投票紀錄，作為重複簽署證據（〔LEDGER-R-105〕 的 `equivocators`）。每把金鑰只有一個實例的誠實簽署者以第一張票投過的本體一定是候選，所以分區合併後同一提案者另有 canonical 順序較前的本體時，誠實簽署者已投的本體與票仍保留在候選中。誠實提案者不會需要第二個本體：提案時已以「寫鎖 → 簽 → 寫入」投下自己的一票並鎖定，之後不再提出新本體（〔LEDGER-R-102〕）。投票須 base 單簽有效、`peerId` 屬前代 signer set、`checkpointCid` 為已保留的提案（不限候選；canonical 順序在提案之前的投票不收）、`checkpointSignature` 有效；投給尚未升格本體的票照樣記錄，本體升格時這些票一併計入。同人同本體冪等，同人投兩個本體兩票都記，作為重複簽署證據。重提案的覆核順序與投票對象（〔LEDGER-R-102〕）、可定稿與卡死（〔LEDGER-R-104〕）都只看候選本體；`signCheckpoint` 與 `finalizeCheckpoint` 對非候選本體回 `unknown-checkpoint`。非成員的提案與投票可通過准入（准入只驗事件內一致性與工作量，〔LEDGER-R-025〕），但不論即時路徑或重建都不採計。重建以同一組條目重算；採納或定稿使錨前進時索引隨之重建；衝突隔離期間索引為空；`close` 清除。同一組條目不論到達順序得到同一索引。`getPendingCheckpoints` 回傳候選本體與票（票數降序、同票本體 CID 升序；不列尚未升格的提案）、可定稿本體、本機鎖定、重複簽署者、自身重複簽署與卡死狀態；`onCheckpointVotingChange` 在保留提案、收票、升格或整體重建時通知，訂閱者拋出例外不影響帳本。
- **〔LEDGER-R-100〕** **控制事件不進業務 fold**：`ledger-checkpoint-proposal`、`ledger-checkpoint-signature` 與 `ledger-checkpoint-certificate` 三種事件在單筆 fold boundary 一律 `accepted=false`：不推進 `derivedAt`、不記 `registeredAt`／`lastEventAt`、不計入 `eventsAppliedSinceCheckpoint`、不列為 accepted entry，也不通知 `onEvent` 訂閱者。提案與投票改交待定稿索引；定稿公告改交採納佇列（〔LEDGER-R-041〕）。三者仍計入 〔LEDGER-R-038〕 的條目數。
- **〔LEDGER-R-102〕** **重提案**：待定稿索引有候選本體時，`proposeCheckpoint` 不論本節點是否為指定提案者，都先回到候選本體（〔LEDGER-R-099〕；尚未升格的提案不考慮）。本節點已鎖定（受約束的本體恰一個，〔LEDGER-R-103〕）時不寫入新票，回傳得票最多的本體（同票取本體 CID 字串較小者，`selectCheckpointVoteTarget`）、`kind: 'existing'`、`voted: false`；quorum 為 1 且本節點已有對它的票時直接定稿。本節點未鎖定時，依票數降序、同票本體 CID 字串升序逐一以與 `signCheckpoint` 相同的覆核（〔LEDGER-R-039〕）重算（略過本節點已投過、即已人工釋放的本體），投給第一個通過者（`ledger-checkpoint-signature`，`kind: 'existing'`、`voted: true`；quorum 為 1 時直接定稿）；覆核回 `stale-previous`、`not-signer`（屬本節點狀態、與本體無關）或不是 `CheckpointProtocolError` 的錯誤時，直接回報該錯誤、不再覆核其餘本體。沒有任何本體通過覆核時改走新本體路徑：本節點是本輪指定提案者就照一般提案流程產生新本體，否則回 `not-designated`（訊息列出各本體的覆核失敗碼）。因此誠實簽署者不替覆核不過的本體背書，已累積的票不會因換輪作廢，單一作惡提案者塞入的假本體也不會阻擋之後輪到的誠實提案者。
- **〔LEDGER-R-039〕** `signCheckpoint(checkpointCid)`：固定順序為共同閘門 → 缺投票鎖定紀錄回 `lock-store-unavailable` → 本體不是待定稿索引的候選本體（〔LEDGER-R-099〕）回 `unknown-checkpoint` → 非本代 signer 回 `not-signer` → 自身重複簽署回 `self-equivocation`（優先於已投票，同一金鑰另一個實例投過此本體時也要回報）→ 已投此本體回 `already-signed` → 已鎖定其他本體回 `locked` → 覆核 → 寫鎖 → 簽 → 寫入 `ledger-checkpoint-signature`。已鎖定的就是此本體、而索引沒有本節點的票時（前次投票事件沒有寫進帳本），不回 `locked`，照常覆核並重寫同一本體的投票。覆核先做全部不依賴重算的檢查：本體 shape → `previous_checkpoint_cid` 等於本機最新已採納 checkpoint（否則 `stale-previous`）→ 取前一 checkpoint 的治理狀態（取不到回 `state-unavailable`）→ proposer 屬於該治理狀態的 signer set，且 `signer_set_size`／`quorum`／`signer_set_cid` 與該集合相符 → 本節點屬該集合 → `round` 與 timestamp 一致 → proposer 為該輪指定提案者（否則 `not-designated`）→ timestamp 不晚於本機時鐘加 30 秒（不設下限）→ previous 非 null 時距前一檢查點至少 60 分鐘（否則 `trigger-not-met`）。全部通過才以候選折疊重算：觸發不成立回 `trigger-not-met`，重算出的 `derived_state_cid` 或 `next_signer_set_cid` 與本體不符、或下一代 signer set 大小不是 1 或至少 3 回 `recompute-mismatch`。head-set frontier 與前一 frontier 的雙向連續性在重算的條目走訪（前一 checkpoint 的 heads 到本體的 heads）中檢查，不連續即無法重算而拒簽。連續性同時要求：每個 current head 都可到達至少一個 previous head（或相等），且每個 previous head 都被至少一個 current head 到達；不得悄悄遺失 sibling branch。
- **〔LEDGER-R-103〕** **鎖定與本機鎖定紀錄**：一位 signer 對同一 previous 只投一個本體，不論輪次。本節點受約束的本體為「本機鎖定紀錄」與「索引中自己的票」的聯集，兩者都扣除鎖定紀錄中已人工釋放的本體（〔LEDGER-R-104〕）。每次投票（提案或投票事件）的順序固定為**寫鎖 → 簽 → 寫入事件**：鎖定紀錄已鎖其他本體時回 `locked`，寫鎖失敗即不簽、不寫入事件。提案與投票事件的寫入不經 Admission outbox（[ledger-admission.md](ledger-admission.md) 〔LEDGER-R-109〕）：寫入失敗時不留待送出紀錄、鎖定不撤，之後只重送同一本體（提案見 `proposeCheckpoint`，投票見 〔LEDGER-R-039〕），對同一本體重寫鎖定冪等。鎖定紀錄每位 signer 一個 key `__checkpoint_vote_locks_v1__:<chainId>:<signer>`，值為 canonical dag-cbor 的 `{ version: 1, locks }`（`locks` 依 previous 排序，genesis 在前），每筆鎖定為 `{ previous, checkpoint, lockedAt, released }`；所有更新以 compare-and-swap 寫入，CAS 失敗重讀並重新判定，因此同一儲存上的並行寫入者不會對同一 previous 鎖定兩個本體。缺少鎖定紀錄時 `proposeCheckpoint`、`signCheckpoint` 與 `releaseCheckpointVoteLock` 一律 fail-closed（`lock-store-unavailable`）。啟動掃描穩定後，索引中本節點對目前錨恰有一票而本機沒有鎖定時補寫鎖定（`lockedAt` 取該票事件的 timestamp），之後刪除其他 previous 的鎖定；這一步失敗不影響帳本。瀏覽器組裝以 checkpoint control storage（同一個依 chainId 分開的 IndexedDB）承載鎖定紀錄，鎖定紀錄只借用讀寫、不負責關閉。
- **〔LEDGER-R-104〕** **卡死與人工釋放**：沒有候選本體達 quorum `Q`，且 `max(各候選本體票數) + 尚未投票的 signer 數 < Q` 時判定卡死（只計前代 signer set 成員投給候選本體的票，只投過非候選本體的 signer 算尚未投票；`N=1` 不會卡死）。卡死起點 `stall.since` 由索引依 fold 順序重播候選本體的投票紀錄求得：取卡死條件最近一次由不成立轉為成立的那筆投票事件 timestamp，因此由帳本推出、各節點一致。`releaseCheckpointVoteLock({ previousCheckpointCid, fromCheckpointCid, toCheckpointCid, confirmation })` 是受控的重複簽署，只能人工執行；在共同閘門之後依序要求：previous 為目前錨（否則 `stale-previous`）→ 判定卡死（否則 `not-stalled`）→ 本機時鐘減 `stall.since` 至少 `CHECKPOINT_LOCK_RELEASE_MIN_STALL_HOURS`（24）小時（否則 `stall-too-short`）→ from 是本節點目前唯一的綁定、本節點對此 previous 尚未釋放過、from 不是全網一致的投票對象、to 是全網一致的投票對象（得票最多、同票取本體 CID 字串較小者，計算時不排除 from；任一不符回 `release-not-allowed`）→ `confirmation` 逐字等於 `release-checkpoint-lock <previous 或 genesis> <from> -> <to>`（否則 `confirmation-mismatch`）。成功只把 from 記入本機鎖定紀錄的 `released`（沒有鎖定紀錄時先補寫 from 的鎖定再釋放），不寫帳本事件；之後由 `signCheckpoint(to)` 改投。同一 previous 每位 signer 最多釋放一次。投票對象只由索引推出，各節點一致，所以只有綁在其他本體的 signer 可以釋放，且都改投同一個本體；平票時不會有兩側同時改投對方而各自達到 quorum。治理者執行前須人工確認沒有任何本體已達 quorum（包括未公開者）。
- **〔LEDGER-R-105〕** **自身重複簽署**：索引中本節點對目前錨投過兩個以上未釋放的本體時為 `selfEquivocation`（代表同一金鑰在別處運作或外洩）；此時 `proposeCheckpoint` 與 `signCheckpoint` 回 `self-equivocation`，本機鎖定與索引票的聯集超過一個本體時亦同。`equivocators` 列出對目前錨投過兩個以上本體（含非候選本體）的所有 signer，已釋放的票仍列入。`finalizeCheckpoint` 不因自身重複簽署而阻擋；兩個不同本體都被定稿時由 〔LEDGER-R-042〕 隔離。
- **執行者**：`proposeCheckpoint`、`signCheckpoint` 與 `releaseCheckpointVoteLock` 只由常駐治理簽署工具呼叫，瀏覽器不簽（〔GSIGN-R-001〕）；工具的同步閘、主迴圈、錯誤碼處置、halt 與人工釋放前置見 [governance-signer.md](governance-signer.md)。
- `finalizeCheckpoint(checkpointCid)`：任何節點都可定稿，不需要治理金鑰。與遠端 adoption 共用 checkpoint commit queue；瀏覽器另以 Web Locks 對同一 ledger address 跨分頁序列化，無 Web Locks 的 fallback 只承諾單 runtime 序列、**不構成正確性 ／ 跨 peer 信任邊界**。通過共同閘門（不比對索引錨）後在序列化鎖內：本體已是 latest 時補做中斷的邊界推進、送一輪待送出的定稿公告並冪等成功；否則從索引取候選本體與票（不是候選本體回 `unknown-checkpoint`），previous 必須等於目前 latest（否則 `stale-previous`），前一 checkpoint 的治理狀態取不到回 `state-unavailable`，只保留前代 signer set 成員的簽章並依 signer 升冪排序，不足 quorum 回 `below-quorum`，整份驗證不過回 `invalid-checkpoint`，通過後裁成 quorum 份憑證（〔LEDGER-R-106〕）。取得 lock 後必重讀完整 durable control/revision，再由 storage port 對 expected control bytes 執行真 CAS；不同 intent 的 stale writer 一律拒絕。本體、憑證、conflict evidence 與 derived block 先以 content-addressed artifact 儲存；單一 control envelope 切換才授權狀態。定稿者在這個階段把自己手上已驗過的內容塊寫入本機並 pin：signer set 塊，以及本 runtime 覆核同一本體時重算出的 derived_state 塊、新成形的 cold partition 塊與下一代 signer set 塊（提案者在提案時已寫入並 pin 同一批塊），之後重建與 `deriveStateAt` 不必向網路取這個檢查點的狀態；未覆核就定稿、或覆核後重啟過的節點手上沒有這些 bytes，仍由內容儲存取得。這些內容塊的寫入或 pin 失敗不改變定稿結果。提交順序固定為：(1) 對本體 `log_head_cids` 做邊界的唯讀驗證，失敗時定稿失敗且不留下任何持久變更；(2) 內容塊、本體與憑證存檔；(3) 以同一次 control CAS 寫入邊界推進紀錄（journal）並把本體加入公告待送出清單（〔LEDGER-R-040〕）；(4) `latest/effective pointer`；(5) boundary commit；(6) journal clear；(7) 寫 `ledger-checkpoint-certificate` 公告；(8) 重建。pointer 前絕不授予 eviction coverage。公告待送出清單已滿時第 (3) 步以 `announcement-backlog-full` 失敗，control 與邊界不變。第 (5) 步之後完成推進紀錄失敗時 rollback 邊界並回錯，推進紀錄與公告待送出留著；之後由公告重送的那一輪在送出前補做邊界推進（見下一條），對同一本體再次定稿也會補做。採納端在 boundary commit 之後失敗時同樣 rollback 並保留推進紀錄，由同一則公告再次處理時補做（〔LEDGER-R-041〕）。多個節點同時定稿同一本體得到同一個檢查點 CID，採納冪等。
- **定稿公告的寫入與重送**：公告在邊界推進完成之後才寫入；寫入失敗不改變定稿結果，本體留在公告待送出清單，由帳本自行重送，不需要再次呼叫定稿。送出以「輪」為單位，在 checkpoint commit queue 內執行（與定稿、採納互斥），背景重送同一時間至多排入一輪。清單非空的每一輪送出前，邊界推進紀錄所指的本體已是 latest 而紀錄尚未完成時（定稿或採納在 latest 寫入之後失敗、邊界已 rollback），先補做邊界推進並完成紀錄，待定稿索引的錨不是該檢查點時再以它重建；補做失敗時該輪記為失敗、依退避再試，重建失敗則依 〔LEDGER-R-048〕 進入 ingest failure、該輪繼續。清單為空時不補做：採納端的同型情形由同一則公告再次處理或背景重掃收斂（〔LEDGER-R-041〕）；限制是那則公告未落盤時，要等對方再送或重啟。接著依清單由舊到新：本機保留範圍已有同一本體、且憑證有效的公告就只移除該筆紀錄，否則以已保存的憑證寫出公告後移除。既有公告的憑證有效，指公告 timestamp 不早於本體 timestamp，且簽章依 〔LEDGER-R-106〕 以本體前一代的 signer set 驗證通過（不要求與本機保存的憑證是同一組簽章）；本體或前一代的治理狀態在本機讀不到而無從驗證時不算有效，照常寫出公告。既有公告的驗證結果以條目為單位記住，記住期間同一條目不重驗；每一輪新驗的量有上限（累計達 128 份簽章就不再開始驗下一則），還沒驗到的公告在這一輪不算有效，留待之後各輪。記住的結果只存在記憶體：每一輪判定完只留下仍在保留範圍、所屬本體這一輪仍要判定的條目（本體已離開清單、或本節點已為它寫出公告的不留），另以 `LRU_ENTRY_LIMIT` 為筆數上限，清單送完、`close` 與開庫失敗時清除。公告寫入成功而該筆紀錄移除失敗時，在紀錄移除之前，同一執行期之後各輪只重試移除、不再為該本體寫出公告。限制：憑證有效的既有公告在某一輪還沒被驗到、或無從驗證時，該輪照常寫出公告，寫入成功時保留範圍內多一則同本體的公告（採納時冪等）；重啟後記住的結果與「已寫出」的記錄都不在，同樣的情形會再寫一則。某一筆送不出時該輪停下，其後的不送（其他節點須先採納前一代才能採納下一代）。保留範圍因目前 heads 含有不經過邊界的分支而無法界定時，視為沒有既有公告並照常寫出（重複的公告在採納時冪等）；其他讀取失敗不視為沒有公告，該輪記為失敗。觸發時機：定稿提交完成後與本體已是 latest 的補做（同一次呼叫內）；開庫後啟動掃描達成 stable watermark 而清單非空；一輪失敗後依 `LEDGER_RECOVERY_RETRY_DELAYS_MS` 退避（獨立計數與計時器，〔LEDGER-R-048〕）；採納新檢查點並完成邊界推進之後（不等退避到期）；定稿的提交段（邊界唯讀驗證到完成推進紀錄）失敗而清單非空時（不打斷既有退避）。任何一輪把清單送完即把失敗次數歸零。第 (3) 步成功而第 (4) 步失敗時清單已含該本體，它的公告照常送出，公告回到本機後依 〔LEDGER-R-041〕 的採納流程完成。公告是控制事件、不讀業務狀態：寫入不經 Admission outbox，也不受 ingest failure 與啟動對帳的 business readiness gate 限制；衝突隔離期間不送也不補做、清單保留（〔LEDGER-R-042〕）。`close` 撤除計時器，進行中的一輪在兩筆之間停下。待送出的情形由 `getRecoveryStatus` 的 `pendingAnnouncement` 回報（[ledger.md §11](ledger.md#11-ledgerapi)）。限制：清單中某一筆的憑證在本機取不到時，該輪以 `certificate-unavailable` 記為失敗並依退避重試，不會跳過它送較新的公告，也沒有自動放棄或人工移除的入口（issue 001567）。
- **〔LEDGER-R-106〕** **憑證格式、驗證與保存**：`LedgerCheckpointCertificate` 是 canonical dag-cbor（`checkpoint_cid` 為 canonical 內容 CID、`signatures` 為 1..64 份 `{ signer, sig }`、signer 嚴格升冪），bytes 上限 16 KiB。驗證嚴格：signer set 大小為 1 或 3..64，本體的 `signer_set_size`／`quorum`／`signer_set_cid` 與前代 signer set 相符，`signatures` 依 signer 嚴格升冪、每個 signer 屬該集合、每份簽章對 `ledgerSigningDigest(ledgerAddress, 本體)` 有效且份數至少 quorum，任一不符整份拒絕。定稿與採納都接受至少 quorum 份；本機保存**第一份**驗證通過、依 signer 升冪取前 quorum 份的憑證，之後不替換：檢查點庫以 `__checkpoint_certificate_v1__:<本體 CID>` 存 canonical 憑證 bytes，並另以內容 CID 寫入內容儲存並 pin；本體與憑證都已保存才可設為 latest。各節點保存的憑證都是 canonical 且自足可驗，但不同節點可能保存不同的簽章組合，規格不宣稱跨節點 bytes 相同。定稿公告攜帶裁過的憑證簽章。`Open4wdLedger.getCheckpointCertificate(cid)` 讀本機保存的憑證。
- **〔LEDGER-R-040〕** **CheckpointStore control envelope**：`{ version, revision, latest, effective, conflictEvidenceCid, journal, announcementPending }` 七欄是 exact canonical CBOR，所有 authority 欄位與 revision 由**同一次單 key `storage.compareAndSwap(expectedBytes, nextBytes)`** 線性化；只提供 `get`／`put`、或無法保證 compare-and-swap 原子性的 storage 一律 fail-closed，不得建立 CheckpointStore。IndexedDB 實作必在單一 `readwrite` transaction 內完成 read/compare/write。DB 名稱與 control key 同時帶完整 chainId，兩條鏈即使共用 origin 也不可讀寫同一 control。artifact 已存而 control CAS 失敗只留下不可見 orphan；control 已落盤但呼叫端收到 throw 時，重試若 intent 相同視為冪等成功，intent 不同則 revision mismatch。此 schema 只讀單一 control envelope，不接受分 key pointer fallback；欄位集合不符（缺欄或多欄）或欄位值不合法的 bytes 以 `invalid checkpoint control` 拒絕。`latest` 是最後一個已採納的檢查點，只由採納或定稿前進，衝突隔離不使它後退，log 的淘汰邊界以它為準（`getEvictionBoundary`）；`effective` 是狀態基底（`getLatest`），沒有衝突隔離時兩者相同。`announcementPending` 是定稿公告尚未確認送出的本體 CID 清單：依加入順序由舊到新、不重複、至多 24 筆。定稿的邊界推進紀錄在同一次 CAS 把本體加到清單最後（此時憑證必須已保存；本體已在清單內時位置不變）；清單已滿而本體不在其中時該次寫入以 `announcement-backlog-full` 拒絕，control 不變、不丟棄較早的紀錄。確認送出後以 CAS 依 CID 移除，CID 不在清單內時不寫入。採納與補做的推進紀錄不動清單；`setLatest`、journal clear 與衝突紀錄也不動它。帳本在記憶體保留清單的快照供狀態回報，於開庫、每一輪送出與定稿失敗時更新。
- **〔LEDGER-R-041〕** **遠端 adoption 與啟動 watermark**：live `ledger-checkpoint-certificate` 公告與 open 時的 historical announcement 掃描都進**獨立**有界 queue（不占 ledger fold queue）：pending+active 64、pending bytes 256 KiB、單 announcement 8 KiB、concurrency 2、retry 1、intrinsic-invalid negative LRU 256。queue 去重、negative cache 與啟動掃描的已檢查集合都以**公告鍵** `${checkpointCid}#${hex(sha256(dagCbor(signatures)))}` 為鍵：同一本體配不同簽章組合是不同的鍵，壞簽章的公告不會連帶封鎖同一本體。增量路徑改走全量 refold 時（例如分區合併後的 sibling 分支），refold 範圍內的公告同樣送入 queue。進入 queue 的來源另有一種：遠端送來、因本機切面容量被拒而未落盤的公告（條件見 〔LEDGER-R-046〕）。它與落盤的公告使用同一個公告鍵、同一組 queue 上限與 negative cache、同一個採納流程（先驗憑證與 signer set，再重算）；它不寫入 log、不進 log 視圖，不留下可供啟動掃描或背景重掃讀取的條目，queue 沒有收下時直接丟棄，不要求重掃；採納完成前重啟也不留痕跡。這些情形都要等對方再送一次。採納後邊界推進、切面縮小，對方重送的同一筆公告與同批祖先照常落盤；公告回到 queue 時本體已是 latest，不再推進邊界。未落盤而已採納的檢查點，重啟時由檢查點庫帶回，不依賴掃描。啟動 durable 掃描只讀本機保留範圍（log 自己的 eviction boundary 到目前 heads，[ledger.md §10](ledger.md#10-客戶端-storage-與同步安全邊界)）：接續最新已採納 checkpoint 的後續 checkpoint，其 CID 相依於前一代、前一代相依於自己的 `log_head_cids`，所以它的 announcement 不可能是這些 heads 的祖先，必在 boundary 之後、不可淘汰；boundary 之前的 announcement 屬可淘汰歷史，不在重啟掃描範圍。因此與已採納 checkpoint 同 previous 的 sibling，若其 announcement 已被該 checkpoint 的 `log_head_cids` 涵蓋，重啟掃描不保證再讀到它；〔LEDGER-R-042〕 的 quarantine 對這種 sibling 只在其 announcement 於 live 到達、或仍落在掃描讀取的範圍內時觸發。掃描以 backpressure 等待容量，不因超過 64 筆而丟棄；啟動對帳完成前，落盤的公告在 live 到達時沒有被 queue 收下，必設 rescan，並反覆執行「讀 durable heads → 掃描 ／drain → 再讀 heads」，直到 heads 與 rescan flag 同時穩定才推進 watermark。前景最多等 30 秒，但逾時只讓 `open` 回應，state read、business append、propose/sign/finalize 仍 fail-closed；背景續掃至穩定後才解鎖。背景掃描失敗時記為獨立的掃描失敗狀態（不借用 ingest failure：全量 refold 治不了它），依 〔LEDGER-R-048〕 的退避間隔自行重掃，期間 reconciliation 維持 pending；前景等待期間失敗則 `open` 失敗。`close` 必 abort 等待中的 adoption／ 掃描且不得在關閉後續寫。每則 announcement 先做不依賴重算的檢查：本體 block 的 exact CID／canonical CBOR／closed shape、本體 timestamp 不晚於公告 timestamp、本體已在本機鏈上即視為已採納（保留已存的憑證；但它就是 latest、而檢查點庫仍有指向它的待完成邊界推進紀錄時，代表前次採納在寫入 latest 之後、推進完成之前中斷，此時比照 `finalizeCheckpoint` 補做邊界推進並完成紀錄，待定稿索引的錨不是該檢查點時再以該檢查點重建；讀取推進紀錄、邊界推進或完成紀錄失敗回重試，推進紀錄保留，同一公告再次處理時繼續補做；重建失敗不回重試，公告仍視為已採納，並依 〔LEDGER-R-048〕 標記 ingest failure、按退避重試。沒有指向它的推進紀錄時直接視為已採納，不補做也不重建）、previous 與本機鏈的關係、previous 非 null 時距前一檢查點至少 60 分鐘、proposer 屬於前一 checkpoint 治理狀態的 signer set、`round` 與 timestamp 一致、憑證依 〔LEDGER-R-106〕 驗證通過；全部通過後，`full-refold` 才以候選折疊重算（含完整觸發條件，〔LEDGER-R-038〕），兩種模式都驗 `next_signer_set_cid` 與成形後狀態的治理集合相符且大小為 1 或至少 3。之後的提交順序兩種模式相同：先對本體 `log_head_cids` 做邊界的唯讀驗證（同 previous 的 sibling 不推進邊界，不做這一步），失敗回重試且不留下任何持久變更；通過後才 pin 內容塊、存本體與憑證，並依 `journal → latest/effective pointer → boundary commit → journal clear` 提交，最後重建。latest 寫入之後、boundary commit 之前被中止（帳本關閉）時推進紀錄留著，由重啟時的 journal redo 補做（〔LEDGER-R-043〕）；boundary commit 之後完成推進紀錄失敗時 rollback 邊界並回重試，推進紀錄留著，由上述補做完成。重算時或其後的讀塊或 pin 失敗都進入重試，例如重算取不到 `log_head_cids` 涵蓋的 entry 或前一 checkpoint 的 derived state 塊、內容儲存回報本 checkpoint 的 derived state 塊或 signer set 塊不可得、檢查點 heads 不能成為本機邊界、pin 失敗。只有永久內在無效可進 negative cache：本體 block 本身 exact CID／canonical CBOR／closed shape 無效，以及 proposer、round 或憑證無效（signer set 與輪次起點由本體自己記錄的 `previous_checkpoint_cid` 決定、簽章在公告內，同一公告鍵的判定不會改變；前一 checkpoint 的治理狀態取不到時不判定、屬重試）。網路不可得、timeout、wrapper/context 不符與 retry 耗盡只算本輪有界檢查，不得永久快取或永久阻塞 watermark。**背景重掃**：落盤的公告重試用盡而離開 queue 或因容量無法再排重試，或啟動掃描不在進行中時落盤的公告只因 queue 容量被拒，帳本排一輪背景重掃：依 〔LEDGER-R-048〕 的退避間隔排定（第一輪也等第一個間隔），同一時間至多一輪；重讀本機保留範圍，把其中的公告以 backpressure 送入同一個 queue 並等處理完。這一輪期間又有落盤的公告重試用盡、因容量被拒或讀取失敗，就依退避排下一輪，否則停止並把次數歸零。背景重掃不設 reconciliation pending、不影響 state read 與 business append；採納照常先驗憑證與 signer set，negative cache 內的公告不重驗；`close` 撤除，不反映在 `getRecoveryStatus`。採納回 `rejected` 不觸發重掃。未落盤的公告不在保留範圍內，重試用盡或被拒收時背景重掃讀不到它，要等對方再送。限制：背景重掃不設總次數上限，落盤的公告若一直無法採納，重掃以最長的退避間隔持續，到該公告離開本機保留範圍為止（issue 001564）。
- **〔LEDGER-R-042〕** **同 previous sibling quarantine**：衝突以**本體 CID** 判定：若兩個不同本體 CID 都完整有效且 `previous_checkpoint_cid` 相同，不得 first-seen／ 最長鏈選邊；同一本體配不同簽章組合是同一個檢查點，不構成衝突。evidence 必含每個 candidate 實際驗證的完整 `{checkpointCid, signerSetCid, signers}`；`equivocatedSigners` 是兩份本機保存憑證的 signer 交集，只作證據（憑證已裁到 quorum 份，交集不保證列出所有雙投者），允許空集合（例如兩個完整有效但 signer set 互斥的 sibling）。candidate、signer set 與 signer 均 canonical 排序去重後以 content-addressed artifact 永久記錄；同一次 control commit 原子設 `conflictEvidenceCid`、把 `effective` 回到共同 previous（無 previous 則 genesis）並清除 pending journal；`latest` 與公告待送出清單維持不變。business fold、append、propose/sign/finalize 與後續 adoption 全 freeze，待定稿索引清空，交給 log 的保留判定依據（〔LEDGER-R-110〕）撤除，並由隔離後的重建維持為無，待送出的公告保留但不送，entry transport 仍可同步保留證據。log 已授予的淘汰邊界不隨 `effective` 後退，重啟後亦同（〔LEDGER-R-043〕）。隔離沒有解除程序：重啟後仍是隔離，恢復方式是鏈重生（[../資料系統.md §19](../資料系統.md)）。
- **〔LEDGER-R-043〕** **crash redo 與 pre-open reconciliation**：跨 Orbit log／CheckpointStore 不宣稱單一 transaction。重啟在 Orbit open **之前**先讀 control 的 conflict、`latest` 與 journal，以 `latest`（最後一個已採納的檢查點，即 log 的淘汰邊界，〔LEDGER-R-040〕）的 frontier 開庫，尚未採納任何檢查點時以創世開庫；若 journal 與 `latest` 相符，冪等 redo boundary 後以 CAS 清 journal。狀態基底另取 `effective`，由帳本在重建時讀取。衝突隔離使 `effective` 退回共同 previous，`latest` 不後退，所以重啟後 log 仍以隔離前最後採納的檢查點為邊界開庫，不以 `effective` 的 heads 開庫（那些 entry 可能已被淘汰）。定稿與採納都把邊界的唯讀驗證排在 control 寫入之前，新寫入的 `latest` 所指檢查點的 heads 都通過過本機的這項驗證。採納者在落盤的 announcement 之後、control 之前 crash，由 historical scan 重驗（該 announcement 在 log 的 eviction boundary 之後，落在掃描讀取的本機保留範圍內）；定稿者的公告在 control 之後才寫，control 後、公告前 crash 由公告待送出清單在啟動掃描達成 stable watermark 之後補送；control 後、boundary 前 crash 由 journal redo；任何階段都不得先淘汰未被 authority control 覆蓋的 entry。
- **Cold partition pinning 責任**：proposer 立即 pin 新 cold CID，自行定稿的覆核者 pin 自己重算出的同一批 cold CID；pinning service 訂閱 `ledger-checkpoint-certificate`、從 derived_state_cid 解出所有 `coldMatchPartitions` 值全 pin。
- **檢查點兼鏈重生錨**：帳本壞損最後手段不是注入裸 state CID，而是 `InitialCheckpointProof` 的完整來源 checkpoint chain。`parseInitialCheckpointProof` 先驗 closed descriptor 與 commitment（`checkpointCertificateCids` 與 `checkpointChainCids` 逐項對應）；`verifyInitialCheckpointProof` 逐代以當代 authority 驗憑證、previous 連續與 timestamp 嚴格遞增，authority 由本體的 `next_signer_set_cid` 推進，只有最後一代取 DerivedState 並驗其 `governanceSigners` 與 `next_signer_set_cid` 相符、log heads 與 cold partitions 齊全。`Open4wdLedgerOptions` 的 `genesisState` 與 `initialCheckpointProof` 互斥；proof 在 `open()` 連線後、任何 state 可讀前驗證，失敗清空 runtime 狀態且不得 fallback。browser composition root 由 deployment config 原樣傳遞；pinning 的 version-1 self-contained bundle 會先離線驗證、再預載 blocks。規範不變式見 [../資料系統.md §19](../資料系統.md)〔LEDGER-R-098〕。

## 4. Sync 與 Fork Resolution

### 4.1 有界 entry sync 與本機持久化

- **〔LEDGER-R-044〕** Orbit entry 使用獨立 IndexedDB blockstore `open4wd/ledger/entries`；不得與 Helia/Bitswap 內容 blockstore 共用，也不得以 shared `getAll()` 計算 entry quota。derived state／cold CID 等內容塊仍走 Helia blockstore。
- 遠端 head 的直接 pubsub／stream bytes 在 `Entry.decode` 前套單筆、per-source、global fixed-window 與 queue bytes/messages 四層 admission。缺少的 `next` ancestor 只可向送來該 authenticated head 的 peer 走 length-framed `/open4wd/orbit-entry-fetch/1/<orbit-address>`；先讀 4-byte length header、超過 `LEDGER_ENTRY_BLOCK_MAX_BYTES` 即 abort stream，不配置 payload、不落盤；完整 payload decode 後還須驗 `entry.hash === requested CID`，不符整次 join 回滾。**任何情況都不回退到 Helia/Bitswap 抓 Orbit entry。**
- **〔LEDGER-R-045〕** **檢查點切面**：條目是否屬於本機 log 視圖，只依 DAG 與最新已採納檢查點 K 判定。切面集合 S ＝ K 的 `log_head_cids`，加上「**每一個** parent 都在 S、且時鐘符合 〔LEDGER-R-107〕」的條目，反覆擴張到不再增加；K 的 heads 本身是 S 成員，不再檢查它們的 parent。尚無檢查點、或 K 的 `log_head_cids` 為空（首個檢查點）時，S 從創世起算：沒有 parent、時鐘為 1 的條目都是根（可以有多個）；有非空 heads 的檢查點之後，沒有 parent 的條目一律以 `stale-parent` 拒絕。遠端 join 與本機 `commitPrepared` 走同一個判定：條目的每個 parent 必須在 S，或是同一批中已判定有效的祖先，否則以 `stale-parent` 拒絕；同一批的祖先依拓撲順序逐筆判定，任一筆違規整批不落盤。走訪祖先時，不在 S 的 parent 屬下列情形之一即立即以 `stale-parent` 拒絕，不讀取它、也不向來源抓取它或更早的祖先：parent 是孤兒、已被 K 涵蓋、本機 index 有它的紀錄，或本機提交時本機條目儲存沒有它。其餘不在 S 的 parent 當作同一批的祖先：本機條目儲存有就讀本機，沒有時遠端 join 向送來該 head 的 peer 抓取，抓取失敗則整次 join 以抓取錯誤結束（不是 `stale-parent`）、不落盤。K 有 heads 時，取得的祖先時鐘不大於 K heads 的最小時鐘就不可能進入 S，走訪即以 `stale-parent` 停下。條目能否加入 S 的判定（parent 是否在 S 或同批、時鐘是否相符）不讀本機 index、不依到達順序、也不因重啟而不同；會影響收或不收的 index 讀取只有上述走訪的提早拒絕，另在 heads／index 的整理與提交時的 rollback 快照讀取。**孤兒** ＝ 本機已有、但既不在 S 也不在 K 涵蓋範圍內的條目（例如採納 K 之前收下的晚到分支，以及合併過它的條目）：不在 log 視圖、不轉交 `onUpdate`、不得當 parent，從 heads 與 index 移除，可被淘汰；切面變動產生新孤兒時以 canonical 順序通知訂閱者。孤兒集合不隨條目儲存的淘汰更新，淘汰之後與上述定義可能有出入：已淘汰的孤兒在同一執行期仍列為孤兒，重啟後不再列出；涵蓋範圍中段的條目被淘汰後重啟，缺口之前仍在本機的已涵蓋條目無法再確認已涵蓋，會被列為孤兒，之後有人重送它時不再當作已存在而略過，改走一般判定而被拒：它的 parent 仍在本機或它沒有 parent 時為 `stale-parent`；parent 已不在本機時，遠端 join 先向來源抓取該 parent，抓不到即以抓取錯誤結束。S 與 heads 只由 K 與 DAG 求出，不受這兩種出入影響；已知的影響限於孤兒清單、孤兒通知與重送時回報的結果（issue 001560）。S 內條目不可淘汰。S 的本機上限分為業務上限 `LEDGER_CUT_BUSINESS_ENTRY_LIMIT`（9,000）與硬上限 `LRU_ENTRY_LIMIT`（10,000）：一批條目（本機提交的一筆，或遠端 join 的 head 加上同批祖先）加入後 S 不超過業務上限時照常收下；超過業務上限時只收保留批次，且加入後不得超過硬上限（〔LEDGER-R-110〕）；其餘以容量錯誤 `cut-full` 拒絕、整批不落盤，其中遠端送來的定稿公告另依 〔LEDGER-R-046〕 處理。容量判定排在條目有效性判定之後。heads 恆等於 S 的極大元素：本機 prepare 的 `next`、heads 交換送出的條目與 join 寫回的 heads 都取 S 的極大元素，不沿用 storage 的舊 heads，孤兒 heads 不會累積；heads metadata 上限 65,536 bytes、最多 64 heads；`next` 是因果鏈、`refs` 只作 skip pointer 且不 traversal。
- **〔LEDGER-R-107〕** **確定性時鐘與 clock id**：條目 `clock.time` 必須恰等於所有 parent 的 `clock.time` 最大值加 1，沒有 parent 時為 1，不符以 `clock-mismatch` 拒絕；判定所需的 parent 依 〔LEDGER-R-045〕 必在 S 或同一批暫存中，各節點結論相同。`clock.id` 必須等於條目簽章金鑰 `key`、`clock.time` 至少為 1，這兩項屬 canonical validator 的形狀檢查，違反回 `invalid-entry-shape`（〔LEDGER-R-046〕）；custom access-controller 另要求 `key` 等於 `identity` 所指 identity 的 `publicKey`，不符即拒絕且不再驗 identity（〔LEDGER-R-074〕）。誠實寫入端以 S 的極大元素為 parents、時鐘取其最大值加 1，`clock.id` 是自己的 Orbit identity 公鑰。
- **〔LEDGER-R-110〕** **檢查點控制事件的保留額度**：一批條目加入後 S 會超過業務上限時（〔LEDGER-R-045〕），只有**保留批次**可以收下，且加入後不得超過硬上限；例外是開庫重建、邊界推進、邊界 rollback 後的重新判定，以及提交後把已判定的條目加入 S，這四種情形不做保留判定、只以硬上限為界（〔LEDGER-R-108〕）。保留批次的條件是批次中**每一筆**條目都同時符合：事件型別為 `ledger-checkpoint-proposal` 或 `ledger-checkpoint-signature`；事件的 `peerId` 屬於本機目前檢查點錨的前代 signer set；提案的本體 `previous_checkpoint_cid` 等於該錨，投票的 `checkpointCid` 是待定稿索引已保留的提案（〔LEDGER-R-099〕）；S 中尚無相同事件內容（事件鍵，定義見 〔LEDGER-R-049〕）的檢查點控制條目，同一批內也不得重複。批次內只要有一筆不符（例如夾帶業務條目的祖先），整批都不是保留批次。定稿公告不屬保留類別，被容量拒絕時依 〔LEDGER-R-046〕 交給採納流程。判定依據（錨、錨的 `log_head_cids`、本代簽署者，以及即時查詢待定稿索引是否保留某提案）由帳本層在每次重建待定稿索引時提供給 log，衝突隔離時撤除，並由隔離後的重建維持為無；未提供、或其錨的 heads 與 log 目前的邊界不一致時（例如定稿或採納途中），沒有保留類別，超過業務上限一律拒絕。事件型別與事件鍵的檢查由 log 層自行執行，不依賴提供的判定依據。本機提交與遠端 join 適用同一判定。容量錯誤的代碼為 `cut-full`，另附 `zone`：加入後超過硬上限時為 `reserved`（不論批次類別），未超過硬上限而超過業務上限且不屬保留批次時為 `business`。保留判定只決定條目是否佔用保留區，不改變條目有效性、待定稿索引與檢查點有效性。兩個上限是本機容量規則，不參與共識，但各節點應使用相同的值。限制：這條規則目前保證的是一位簽署者時，切面超過業務上限後仍可提案與定稿；三位以上簽署者時，滿載下不保證收得齊票，擴編到三位以上之前必須完成後續設計（issue 001566）。硬上限也滿時檢查點控制事件同樣被拒（issue 001563）。
- **〔LEDGER-R-046〕** remote join 與 local `commitPrepared(finalEntryBytes, cid)` 都先經 canonical Admission validator 再 staged；production local write 不得呼叫 `db.add(event)`／`Log.append` 重建 entry。entry/index/heads 三層 commit 任一失敗會逆序 rollback。rollback 自身失敗會在獨立 durable integrity storage 寫 poison marker，本 runtime 與下一次重啟皆 fail-closed，直到使用者執行明確的本機 ledger cache rebuild/drop；不得把半套 log 繼續同步。切面容量拒絕以固定代碼 `cut-full` 回報（〔LEDGER-R-045〕、〔LEDGER-R-110〕），判定排在 canonical validator、access-controller、條目簽章與切面判定之後。遠端 join 的一批條目，切面容量是第一個不通過的檢查時（排在其後的 heads 上限與儲存層提交尚未執行），整批照舊不落盤；其中的 `ledger-checkpoint-certificate` 條目交給帳本層，依 〔LEDGER-R-041〕 送進採納佇列，由採納流程驗證憑證。交出不寫入條目儲存、index、heads 或切面，也不觸發 log 的更新通知。只有切面容量是第一個不通過的檢查時才交出：因其他任何原因被拒的批次一律不交出，本機寫入的條目與其他型別的條目也不交出。
- **〔LEDGER-R-047〕** quota eviction 只刪 finalized-checkpoint-covered entry，且呼叫專屬 entry blockstore 的真 `delete`。重啟不信任可偽造的 coverage side metadata：從本地 finalized boundary 沿 `next` 重建，逐 entry 驗 CID／Orbit identity 簽章 ／custom access-controller；boundary 缺失、ancestor bytes 損壞或鏈不一致即拒開。因沒有獨立 coverage version/checksum 檔，亦沒有「竄改 metadata 便取得淘汰權」的信任面。
- **〔LEDGER-R-108〕** **開庫、涵蓋範圍還原與邊界推進套用同一切面規則**：開庫重建逐筆驗 CID、access-controller 與簽章後，以 〔LEDGER-R-045〕 的閉包求 S：index 寫入 S 成員、heads 寫入 S 的極大元素，未選入且不在涵蓋範圍的條目成為孤兒、不使開庫失敗；呼叫端注入條目儲存時，同樣由儲存的 heads 與 K heads 求 S 並整理 heads 與 index。涵蓋範圍還原（〔LEDGER-R-047〕）同時檢查時鐘：K heads 與仍在本機的祖先，parent 都在本機時須恰等於最大值加 1，有 parent 已淘汰時須大於每個仍在本機的 parent，沒有 parent 時須為 1；違反即開庫失敗，錯誤代碼 `covered-clock-mismatch`，不遷移、不自動清除既有本機資料。邊界推進時，候選檢查點 K' 的 `log_head_cids` 必須都在目前的 S，否則以 `checkpoint-outside-cut` 拒絕為無效檢查點；S' ＝ K' heads 在 S 內的閉包，掉出且不被 K' 涵蓋的條目成為新孤兒。boundary commit 同步替換 S、孤兒、涵蓋集合與 boundary，rollback 一併還原並把其間提交的條目依還原後的 S 重新判定；heads 與 index 的整理在 commit 後排入 database 佇列，整理完成前 prepare 與 heads 交換已依 S 取值。推進邊界後立即重啟與不重啟得到相同的 S、heads 與孤兒。開庫重建、邊界推進與提交後把已判定的條目加入 S，只以硬上限 `LRU_ENTRY_LIMIT` 為界，不受業務上限影響（〔LEDGER-R-045〕、〔LEDGER-R-110〕）。區間走訪（`entriesBetween`、`retained`、`entriesAfter` 與邊界推進的連續性走訪）只接受 S 與涵蓋範圍內的條目，碰到其他條目以 `traversal-outside-cut` 停下，不往歷史走到配額或缺塊。
- **條目有效性的已知限制**：切面與時鐘規則決定條目是否有效，不決定同一檢查點間隔內各事件的先後；依賴「先到先贏」的領域規則，在一個檢查點間隔內仍可能讓較晚寫入的事件排在前面，影響由各領域規則自行處理（issue 001529）。重新建立的事件（〔LEDGER-R-109〕）在尚未採納該檢查點的節點上可能與原條目短暫同時有效，期間 fold 會把同一事件套用兩次，採納後 refold 收斂（issue 001552、issue 001573）。`onEvent` 以事件鍵去重（〔LEDGER-R-049〕），但在該條所列的限制下同一事件仍可能通知多於一次，訂閱者必須冪等。以條目 CID 作引用的紀錄，在被引用的條目重新建立後可能指向已成孤兒的舊條目（issue 001572）。

- **〔LEDGER-R-048〕** `syncFromCheckpoint`：取 effective latest checkpoint（無則從 genesis/log 重建）；已有 checkpoint 而其 derived_state 塊讀不到時重建失敗，不退回 genesis 重放（checkpoint 之前的 entry 可能已被本機淘汰），這一種失敗以固定 code `checkpoint-state-unavailable` 回報（內容儲存在期限內沒有交回該塊，含逾時）→ 載已驗 derived_state（hot + coldMatchPartitions 的 **CID map**，cold 本體不載）→ 從 `log_head_cids` 完整 frontier fold 後續 DAG。遠端 checkpoint announcement 的下載 ／ 驗證 ／adoption 已由 [§3](#3-帳本檢查點ledgercheckpoint演算法) 獨立 queue 接線；不可直接把未驗 pinning 內容設為 latest。live update 必保留完整 LogEntry metadata；每次以 stable durable heads 抓取 catch-up batch，只有整批 canonical key 都嚴格大於上一折疊 key 時才增量 apply。若 production frontier continuity 拒絕 sibling growth（例如 `P→A` 已 fold 後 `P→B` 到達，`[A]→[A,B]` 不是連續增量），則在同一 state queue 對 stable full DAG refold；其他 storage／integrity error 仍進 ingest recovery，不得被誤當 reorg。event timestamp 只做收件 ／ 守門，不得拿來決定 fold order。增量 apply 若在 durable log commit 後失敗，runtime 立即標記 ingest failure、跳過同批排隊通知並 full refold；恢復完成前 state reads／business writes fail-closed，重啟亦可由 durable log replay。recovery refold 失敗後有三種時機會再重建，每次都是 state queue 中的單一工作、彼此不並行：ingest failure 期間有新 entry 到達與退避計時器到期共用同一個 single-flight 排程（已排入 queue 時不重複排），失敗計入退避；checkpoint 採納或定稿後的重建是另一個 queue 工作，不經 single-flight；它失敗時定稿或採納的結果不變（checkpoint 已提交），在同一個 queue 工作內標記 ingest failure，之後依退避表排下一次重試並計入失敗次數；已有待執行的重試時不改變它、也不計入。ingest failure 期間到達的定稿公告（落盤的與 〔LEDGER-R-046〕 交出的未落盤公告）照常送進採納佇列；到達的業務 entry 仍不折疊，之後由重建或 〔LEDGER-R-049〕 的 coverage 處理。任何一次成功的全量重建（recovery、明確同步、採納或定稿後）都把重建範圍內的定稿公告送進採納佇列；啟動掃描進行中時由掃描負責，不重複送。增量路徑改走的全量重建不在此限：啟動掃描進行中也把範圍內的公告送進佇列，由已檢查的公告鍵避免重複。**`open` 時狀態塊取不到**：`checkpoint-state-unavailable` 發生在 `open` 的初始重建時，`open` 仍回成功，runtime 在同一個 queue 工作內標記 ingest failure，依下述退避表向內容儲存重取，取到後由成功的重建恢復；期間啟動掃描照常進行，到達的定稿公告照常送進採納佇列。初始重建的其他失敗（checkpoint 之後的 entry 走訪失敗、狀態塊無法解碼、control 或儲存層錯誤）照舊使 `open` 失敗。以這種方式開庫時，notified baseline（〔LEDGER-R-049〕）到第一次成功的重建才建立：恢復前到達的 entry 併入 baseline、不通知，恢復前先被採納的 checkpoint 所涵蓋的 entry 亦同。限制：最新 checkpoint 的狀態塊一直取不到時，runtime 停在 ingest recovery（業務讀寫 fail-closed、狀態可由 `getRecoveryStatus` 看到、以最長的退避間隔持續重取），接續它的下一個 checkpoint 也無法採納（採納需要前一代的治理狀態）；由較新的 checkpoint 重新啟動與清空重同步的入口尚未提供（issue 001527）。正式的內容儲存埠對底層讀取錯誤同樣回報為取不到，本機內容儲存損毀時因此停在 recovery 而不是 `open` 失敗（issue 001571）。瀏覽器組裝目前在這種狀態下仍以啟動失敗處理並關閉帳本，治理簽署工具照常啟動（issue 001570；[governance-signer.md](governance-signer.md) 第 8 節）。退避表另有兩個使用者，各自獨立計數與計時器：定稿公告的重送（`finalizeCheckpoint` 條之後的說明）與採納的背景重掃（〔LEDGER-R-041〕）。退避間隔依連續失敗次數為 1 秒、5 秒、30 秒、2 分鐘，之後固定 5 分鐘，不設總次數上限；新 entry 觸發的重試不得早於目前的退避間隔，避免每筆 entry 都引發一次全量重建。任何一次成功的重建（含採納後、定稿後與明確 `syncFromCheckpoint`）都在同一個 queue 工作內清除 ingest failure、補發積欠通知並把退避歸零；補發時訂閱者拋出例外視同該次重建失敗。計時器在 `close` 與 `open` 失敗時清除，回呼只對排定它的那一代 runtime 生效。退避是本機排程政策，不參與共識；目前狀態由 `getRecoveryStatus` 提供給介面。
- **〔LEDGER-R-049〕** **accepted／pending／notified 分離**：只有 decode 成功、非檢查點控制事件（〔LEDGER-R-100〕）、未來時戳排除、所有 timeless signature／`foldGuard` 通過，且 `applyEvent` 實際執行未拋錯的 entry 才列為 accepted；獨立 `pendingNotificationEntries: Map<hash, LogEntry>` 保留 accepted-but-unnotified payload，`notified hashes` 記本 runtime 已送過的集合，不得把「decode 成功」直接當通知資格。startup reconciliation／conflict quarantine／ingest failure 任一未安全時，remote business entry 可先進 tentative derived state 與 pending map，但 `onEvent` 必為零；stable watermark、conflict/ingest 均已清除後，必在同一 state queue 依 canonical order flush pending，每筆 entry 恰處理一次，處理後移出 pending 並標 notified。flush 時以**事件鍵**辨認同一事件：事件鍵是 entry 承載的整個事件值以 dag-cbor 編碼後的 SHA-256（涵蓋型別、內容、timestamp、發出者與簽章，不含 entry 的 parents、時鐘與 Admission 資料），與 [ledger-admission.md](ledger-admission.md) 〔LEDGER-R-109〕 寫入器比對重新建立的事件、〔LEDGER-R-110〕 保留批次判定所用的是同一個定義。同一事件已由另一筆 entry 通知過時不再呼叫訂閱者，該 entry 照樣移出 pending 並標 notified；事件鍵算不出來時照常通知。這只影響通知，fold 照常處理每一筆 entry。runtime 以兩個世代保存已通知的事件鍵：世代在重建所見的 checkpoint 錨改變時輪替（目前世代成為前一個、原本的前一個移出），再次遇到的鍵留到目前世代；每個世代以 `LRU_ENTRY_LIMIT` 為上限，滿了即提前輪替，所以總數有界，新事件的通知不受影響；集合只存在記憶體。若有效遠端 checkpoint 的完整 DAG／derived state 已驗證一致，coverage 取**該次 checkpoint-time fold 實際回傳的 accepted entries** 中、本 runtime 尚未通知過的 entry：已在 pending 的保留；不在 pending 的（本機從未折疊，例如 ingest failure 期間到達）以該次 fold 驗過的 payload 列入 pending；已在 notified 集合內的不列入。不得以 raw frontier membership／head-set 可達性代替，也不得為通知另跑一次 fold 而引入不同規則。採納在寫入 latest 之前把該次重算回傳的 accepted entries（含 payload）暫存在記憶體，以 checkpoint CID 為鍵並記下它的前一代；至多保留 4 代，超過時捨棄最舊的一代。之後任何以 checkpoint 為基底的重建（採納後的重建、latest 寫入後中斷的補做、ingest recovery 的重建、明確同步）在換上新的 accepted 集合前於 state queue 取用基底那一代，以及沿前一代連續往回、尚未取用的各代（它們同樣被這個基底涵蓋），並標記 coverage；該次重建成功後釋放取用的各代，基底不在暫存內的重建不取用。進入衝突隔離時清除暫存。因此在本條所列限制內，同一執行期內到達、並被已採納的 checkpoint 折入狀態的事件至少通知一次，結果不取決於採納與 ingest recovery 的先後，前一代的重建尚未成功就採納下一代時亦同；post-checkpoint replay window 即使為空仍可保留確實已折入 checkpoint state 的 payload 直到 stable flush。這項補通知只對 `full-refold` 有效，`quorum-follow` 沒有重算結果、不補。例如 `E.timestamp > checkpoint.timestamp` 時 E 雖在 raw DAG 仍不屬 coverage、不得通知。一般 full refold 若 entry 不再 accepted 且無上述 coverage 即從 pending 移除；永久無效 ／ 掃描轉 conflict 會清掉相應或全部 tentative pending，永不補送；`close`／open failure 同步清除 accepted、pending、coverage（含採納暫存）、notified、已通知事件鍵與 baseline，遲到 scan 不得 flush。open 前 durable history 在第一次成功的 refold 建為 notified baseline，不偽裝成 live event；baseline 尚未建立時取用的 coverage 併入 baseline、不通知，重啟後也不補發。已知限制（訂閱者須冪等，且不得假設通知順序等於帳本順序）：(1) 事件鍵移出之後（連續兩次錨前進期間都沒有再出現，或因上限提前輪替）或 runtime 重啟之後，同一事件再以另一筆 entry 到達時會再通知一次；(2) baseline 內的 entry 沒有通知過，其事件鍵不在集合內，同一事件之後以另一筆 entry 到達時通知一次；(3) 已通知的 entry 若在之後的 refold 中不再 accepted 而離開 notified 集合，之後被 checkpoint 涵蓋時，其事件鍵仍在集合內就不再通知，已移出則再通知一次；(4) 本機 live 驗證未收、但 checkpoint-time fold 接受的 entry，被涵蓋時會通知；(5) 同一次 flush 內依 canonical order，補上的 entry 可能晚於較新的已送出通知，跨次送出不保證等於帳本順序；(6) 採納暫存至多 4 代，連續採納超過 4 代而其間沒有任何一次重建成功時，被捨棄的各代所涵蓋而未通知的 entry 不補通知；(7) pending 超過 `LRU_ENTRY_LIMIT` 時，由最早列入的開始捨棄已不在 accepted 集合、只靠 coverage 留著的 entry，這些 entry 不補通知。accepted replay map 仍隨 checkpoint/prune 完整替換，pending object buffer 則獨立保留未送 payload，上限同 production `LRU_ENTRY_LIMIT=10,000`：超過時依限制 (7) 捨棄，不因此進入 ingest failure，accepted 集合本身超過同一上限時仍 fail-closed；flush、一般 refold、conflict、checkpoint coverage 完成與 close 都會裁剪，因此不形成無界 buffer。
- **Cold partition 不主動下載**：新玩家只查最近資料；查到 cold 時 `getMatchRecord` lazy fetch（顯示 loading）。
- **〔LEDGER-R-050〕** **Orbit multi-head 與 full-DAG fold**：切面 S 內的 sibling 都保留（〔LEDGER-R-045〕），不以 arrival order 刪 branch；`entriesBetween(previousHeads, currentHeads)` 走 current frontier 可達的完整 DAG、在 previous frontier 截止並驗上列雙向連續性。共識 fold total order 固定為 `clock.time` 升冪 → `clock.id` 依 JavaScript UTF-16 code-unit 升冪 → entry CID 原始 bytes 升冪；這是對 Orbit equal-clock 行為的明確強化。read-only active-head 僅供展示，不得作共識裁切；同一 entry 集合不論到達順序，fold bytes／derived CID 必須相同。回合 anchor 衝突另走 `consensus-invalid`，不提供可挪用至 ledger sibling 的 winner 規則。
