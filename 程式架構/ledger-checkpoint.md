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
  arbitrationResults: ReadonlyMap<EventId, ArbitrationResultRecord>; // 結果摘要（不存全事件）
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

> **〔LEDGER-R-036〕** **帳本檢查點 ≠ 回合共識錨**：本節是**全網 ledger 狀態整併**機制（治理 signer set：初期 `N=1 → quorum 1`；`N=2` 非法；`N>=3 → floor(2N/3)+1`、30 分鐘 expiry、derived state 整併 + cold 切分，供新玩家同步 / 本地 LRU 裁剪）。回合錨是每回合終局的 present-roster 嚴格多數 checksum 證書，見 [資料系統.md §6](../資料系統.md)。兩者 quorum 各管各、皆正確。**本檔以下「Checkpoint」一律指帳本檢查點。**

```typescript
interface LedgerCheckpoint {
  checkpoint_version: 1;
  timestamp: Timestamp;
  log_head_cids: CID[]; // 1..64；按 entry CID bytes 升冪；不得重複
  derived_state_cid: CID;
  previous_checkpoint_cid: CID | null; // 鏈狀
  signer_set_cid: CID;
  signer_set_size: number;
  quorum: number; // N=1 時 1；N>=3 時 floor(2N/3)+1；N=2 非法
  proposer: PeerId;
  signatures: Signature[];
}
interface LedgerCheckpointProposal {
  proposalId: string;
  checkpoint: Omit<LedgerCheckpoint, "signatures">;
  proposer: PeerId;
  proposerSignature: Signature;
  expiresAt: Timestamp;
}
```

- **〔LEDGER-R-038〕** **提案觸發**：任一治理 signer 見「本地時鐘 − 上一檢查點 timestamp ≥ `LEDGER_CHECKPOINT_INTERVAL_HOURS`（24，[protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽)）」→ 可提案（觸發用本地時鐘——提案非 derive；checkpoint timestamp 於提案時 stamp、收件走 [ledger-admission.md §1](ledger-admission.md#1-baseevent-與簽章) 容差驗證）。reviewAndSign 拒簽「距上一檢查點未滿間隔」的提案（節流）。兩個同 `previous_checkpoint_cid` 的有效提案不是一般 fork winner，而是治理 signer equivocation，依下方 conflict quarantine 處理。**仲裁時序（抽籤點 / 投票期滿 / 撤回窗）全掛在檢查點節奏上**（[moderation.md §5](moderation.md)）——檢查點停擺 = 檢舉案卡在抽籤前。
- **〔LEDGER-R-037〕** **公開凍結前的 exact v1 baseline**：只接受上列 exact closed shape；`checkpoint_version: 0`／`2` 與單值 `log_head_cid` 一律拒絕，不做隱式升級。`log_head_cids` 必須 non-empty、unique、最多 64 筆，且按 multiformats entry CID 的原始 bytes 升冪 canonical 排序；此排序只供序列化，與 fold total order 不同。
- `proposeCheckpoint`：取完整 `logHeadCids` frontier + 算 derivedState + 上一個 checkpoint + signer set；**本次 checkpoint authority 固定讀前一個已採納 checkpoint 的 derived state（首個 checkpoint 讀 genesis）**，不得讀本次 frontier 折疊後的 signer set，也不得由 options／callback 注入另一份 signer set 作 fallback。若本次窗含 `governanceSigners` 變更，仍由舊集合提案／覆核／finalize，新集合自下一個 checkpoint 才取得 authority；`full-refold` 與 `quorum-follow` 採納亦同。只允許 `N=1` 或 `N>=3`，`N=2` 拒絕；呼叫 `splitColdMatchPartitions` 把超出 hot 範圍的 match 移到 cold partition（各 quarter 序列化為獨立 CID），並以 checkpoint `timestamp` 將 `monthlyFlowsByMonth` 裁成當月含前 11 個 UTC 月；`lifetimeRoyaltyMintedByPeer` 不裁剪。序列化 finalState → derived_state_cid；簽 proposal。這兩個經濟投影都是 canonical bigint state，codec 缺欄 fail-closed，不以舊 checkpoint fallback 或 raw log 掃描補值。`N=1` 是初期單一真治理者模式，不建議同一人製造三個假身分；有獨立治理者後應升至至少三位。
- `splitColdMatchPartitions(recentMatches, previousColdCids, now, hotMatchQuarters)`：分桶 → 過期 quarter 合併既有 cold partition（IPFS content-addressed，產生新 CID）→ proposer `pinningProvider.pin` 新 cold CID。
- **〔LEDGER-R-039〕** `reviewAndSign`：驗 proposer 簽章 → 驗 head-set frontier 與前一 frontier 雙向連續 → 以完整 DAG 重算 derived_state 比對 → 簽。連續性同時要求：每個 current head 都可到達至少一個 previous head（或相等），且每個 previous head 都被至少一個 current head 到達；不得悄悄遺失 sibling branch。
- `finalizeCheckpoint`：與遠端 adoption 共用 checkpoint commit queue；瀏覽器另以 Web Locks 對同一 ledger address 跨分頁序列化，無 Web Locks 的 fallback 只承諾單 runtime 序列、**不構成正確性 ／ 跨 peer 信任邊界**。取得 lock 後必重讀完整 durable control/revision，再由 storage port 對 expected control bytes 執行真 CAS；不同 intent 的 stale writer 一律拒絕。Checkpoint block／conflict evidence／derived block 先以 content-addressed artifact 儲存；單一 control envelope 切換才授權狀態。redo 順序固定為 `journal → latest/effective pointer → boundary commit → journal clear`，pointer 前絕不授予 eviction coverage。
- **〔LEDGER-R-040〕** **CheckpointStore control envelope**：`{ version, revision, latest, effective, conflictEvidenceCid, journal }` 是 exact canonical CBOR，所有 authority 欄位與 revision 由**同一次單 key `storage.compareAndSwap(expectedBytes, nextBytes)`** 線性化；只提供 `get`／`put`、或無法保證 compare-and-swap 原子性的 storage 一律 fail-closed，不得建立 CheckpointStore。IndexedDB 實作必在單一 `readwrite` transaction 內完成 read/compare/write。DB 名稱與 control key 同時帶完整 chainId，兩條鏈即使共用 origin 也不可讀寫同一 control。artifact 已存而 control CAS 失敗只留下不可見 orphan；control 已落盤但呼叫端收到 throw 時，重試若 intent 相同視為冪等成功，intent 不同則 revision mismatch。此 schema 只讀單一 control envelope，不接受分 key pointer fallback。
- **〔LEDGER-R-041〕** **遠端 adoption 與啟動 watermark**：live `LedgerCheckpointEvent` 與 open 時的 historical announcement 掃描都進**獨立**有界 queue（不占 ledger fold queue）：pending+active 64、pending bytes 256 KiB、單 announcement 8 KiB、concurrency 2、retry 1、intrinsic-invalid CID negative LRU 256。啟動 durable 掃描以 backpressure 等待容量，不因超過 64 筆而丟棄；若 live 到達時 queue 已滿，必設 rescan，並反覆執行「讀 durable heads → 掃描 ／drain → 再讀 heads」，直到 heads 與 rescan flag 同時穩定才推進 watermark。前景最多等 30 秒，但逾時只讓 `open` 回應，state read、business append、propose/sign/finalize 仍 fail-closed；背景續掃至穩定後才解鎖。`close` 必 abort 等待中的 adoption／ 掃描且不得在關閉後續寫。只有 checkpoint block 本身 exact CID／canonical CBOR／closed shape 等永久內在無效可進 negative cache；網路不可得、timeout、wrapper/context 不符與 retry 耗盡只算本輪有界檢查，不得永久快取或永久阻塞 watermark。
- **〔LEDGER-R-042〕** **同 previous sibling quarantine**：若兩個不同 checkpoint CID 都完整有效且 `previous_checkpoint_cid` 相同，不得 first-seen／ 最長鏈選邊。evidence 必含每個 candidate 實際驗證的完整 `{checkpointCid, signerSetCid, signers}`；`equivocatedSigners` 是交集，允許空集合（例如兩個完整有效但 signer set 互斥的 sibling）。candidate、signer set 與 signer 均 canonical 排序去重後以 content-addressed artifact 永久記錄；同一次 control commit 原子設 `conflictEvidenceCid`、把 `effective` 回到共同 previous（無 previous 則 genesis）並清除 pending journal。business fold、append、propose/sign/finalize 與後續 adoption 全 freeze，entry transport 仍可同步保留證據。
- **〔LEDGER-R-043〕** **crash redo 與 pre-open reconciliation**：跨 Orbit log／CheckpointStore 不宣稱單一 transaction。重啟在 Orbit open **之前**先讀 control 的 conflict/effective/journal，以 effective frontier 開庫；若 journal 與 effective latest 相符，冪等 redo boundary 後以 CAS 清 journal。announcement 後、control 前 crash 由 historical scan 重驗；control 後、boundary 前 crash 由 journal redo；任何階段都不得先淘汰未被 authority control 覆蓋的 entry。
- **Cold partition pinning 責任**：proposer 立即 pin 新 cold CID；pinning service 訂閱 `LedgerCheckpointEvent`、從 derived_state_cid 解出所有 `coldMatchPartitions` 值全 pin。
- **檢查點兼鏈重生錨**：帳本壞損最後手段不是注入裸 state CID，而是 `InitialCheckpointProof` 的完整來源 checkpoint chain。`parseInitialCheckpointProof` 先驗 closed descriptor 與 commitment；`verifyInitialCheckpointProof` 再有界抓取每代 checkpoint／signer set／DerivedState 及其 log heads／cold partitions，按來源 ledger domain 與前代 authority 驗簽並拒絕回退。`Open4wdLedgerOptions` 的 `genesisState` 與 `initialCheckpointProof` 互斥；proof 在 `open()` 連線後、任何 state 可讀前驗證，失敗清空 runtime 狀態且不得 fallback。browser composition root 由 deployment config 原樣傳遞；pinning 的 version-1 self-contained bundle 會先離線驗證、再預載 blocks。規範不變式見 [../資料系統.md §19](../資料系統.md)〔LEDGER-R-098〕。

## 4. Sync 與 Fork Resolution

### 4.1 有界 entry sync 與本機持久化

- **〔LEDGER-R-044〕** Orbit entry 使用獨立 IndexedDB blockstore `open4wd/ledger/entries`；不得與 Helia/Bitswap 內容 blockstore 共用，也不得以 shared `getAll()` 計算 entry quota。derived state／cold CID 等內容塊仍走 Helia blockstore。
- 遠端 head 的直接 pubsub／stream bytes 在 `Entry.decode` 前套單筆、per-source、global fixed-window 與 queue bytes/messages 四層 admission。缺少的 `next` ancestor 只可向送來該 authenticated head 的 peer 走 length-framed `/open4wd/orbit-entry-fetch/1/<orbit-address>`；先讀 4-byte length header、超過 `LEDGER_ENTRY_BLOCK_MAX_BYTES` 即 abort stream，不配置 payload、不落盤；完整 payload decode 後還須驗 `entry.hash === requested CID`，不符整次 join 回滾。**任何情況都不回退到 Helia/Bitswap 抓 Orbit entry。**
- **〔LEDGER-R-045〕** remote join 必須接到目前任一 head 或 finalized checkpoint boundary；isolated fork 拒絕。head metadata 在 JSON parse 前限制 65,536 bytes，解析後最多 64 heads；`next` 是因果鏈、`refs` 只作 skip pointer 且不 traversal。
- **〔LEDGER-R-046〕** remote join 與 local `commitPrepared(finalEntryBytes, cid)` 都先經 canonical Admission validator 再 staged；production local write 不得呼叫 `db.add(event)`／`Log.append` 重建 entry。entry/index/heads 三層 commit 任一失敗會逆序 rollback。rollback 自身失敗會在獨立 durable integrity storage 寫 poison marker，本 runtime 與下一次重啟皆 fail-closed，直到使用者執行明確的本機 ledger cache rebuild/drop；不得把半套 log 繼續同步。
- **〔LEDGER-R-047〕** quota eviction 只刪 finalized-checkpoint-covered entry，且呼叫專屬 entry blockstore 的真 `delete`。重啟不信任可偽造的 coverage side metadata：從本地 finalized boundary 沿 `next` 重建，逐 entry 驗 CID／Orbit identity 簽章 ／custom access-controller；boundary 缺失、ancestor bytes 損壞或鏈不一致即拒開。因沒有獨立 coverage version/checksum 檔，亦沒有「竄改 metadata 便取得淘汰權」的信任面。

- **〔LEDGER-R-048〕** `syncFromCheckpoint`：取 effective latest checkpoint（無則從 genesis/log 重建）→ 載已驗 derived_state（hot + coldMatchPartitions 的 **CID map**，cold 本體不載）→ 從 `log_head_cids` 完整 frontier fold 後續 DAG。遠端 checkpoint announcement 的下載 ／ 驗證 ／adoption 已由 [§3](#3-帳本檢查點ledgercheckpoint演算法) 獨立 queue 接線；不可直接把未驗 pinning 內容設為 latest。live update 必保留完整 LogEntry metadata；每次以 stable durable heads 抓取 catch-up batch，只有整批 canonical key 都嚴格大於上一折疊 key 時才增量 apply。若 production frontier continuity 拒絕 sibling growth（例如 `P→A` 已 fold 後 `P→B` 到達，`[A]→[A,B]` 不是連續增量），則在同一 state queue 對 stable full DAG refold；其他 storage／integrity error 仍進 ingest recovery，不得被誤當 reorg。event timestamp 只做收件 ／ 守門，不得拿來決定 fold order。增量 apply 若在 durable log commit 後失敗，runtime 立即標記 ingest failure、跳過同批排隊通知並 full refold；恢復完成前 state reads／business writes fail-closed，重啟亦可由 durable log replay。
- **〔LEDGER-R-049〕** **accepted／pending／notified 分離**：只有 decode 成功、非 checkpoint、未來時戳排除、所有 timeless signature／`foldGuard` 通過，且 `applyEvent` 實際執行未拋錯的 entry 才列為 accepted；獨立 `pendingNotificationEntries: Map<hash, LogEntry>` 保留 accepted-but-unnotified payload，`notified hashes` 記本 runtime 已送過的集合，不得把「decode 成功」直接當通知資格。startup reconciliation／conflict quarantine／ingest failure 任一未安全時，remote business entry 可先進 tentative derived state 與 pending map，但 `onEvent` 必為零；stable watermark、conflict/ingest 均已清除後，必在同一 state queue 依 canonical order flush pending，每筆恰一次，送出後移出 pending 並標 notified。若有效遠端 checkpoint 的完整 DAG／derived state 已驗證一致，coverage 只能取**該次 checkpoint-time fold 實際回傳的 accepted entries** 與當前 pending 的交集；不得以 raw frontier membership／head-set 可達性代替，也不得為通知另跑一次 fold 而引入不同規則。adoption 只在 durable control/boundary commit 完成後、rebuild 前於 state queue 標記這份 accepted coverage，因此 post-checkpoint replay window 即使為空仍可保留確實已折入 checkpoint state 的 payload 直到 stable flush；例如 `E.timestamp > checkpoint.timestamp` 時 E 雖在 raw DAG 仍不屬 coverage、不得通知。一般 full refold 若 entry 不再 accepted 且無上述 coverage 即從 pending 移除；永久無效 ／ 掃描轉 conflict 會清掉相應或全部 tentative pending，永不補送；`close`／open failure 同步清除 accepted、pending、coverage、notified 與 baseline，遲到 scan 不得 flush。open 前 durable history 在第一次 refold 建為 notified baseline，不偽裝成 live event。accepted replay map 仍隨 checkpoint/prune 完整替換，pending object buffer 則獨立保留未送 payload，但硬上限同 production `LRU_ENTRY_LIMIT=10,000`，超過即 fail-closed；flush、一般 refold、conflict、checkpoint coverage 完成與 close 都會裁剪，因此不形成無界 buffer。
- **Cold partition 不主動下載**：新玩家只查最近資料；查到 cold 時 `getMatchRecord` lazy fetch（顯示 loading）。
- **〔LEDGER-R-050〕** **Orbit multi-head 與 full-DAG fold**：所有已連到任一 verified head／checkpoint boundary 的 sibling 都保留，不以 arrival order 刪 branch；`entriesBetween(previousHeads, currentHeads)` 走 current frontier 可達的完整 DAG、在 previous frontier 截止並驗上列雙向連續性。共識 fold total order 固定為 `clock.time` 升冪 → `clock.id` 依 JavaScript UTF-16 code-unit 升冪 → entry CID 原始 bytes 升冪；這是對 Orbit equal-clock 行為的明確強化。read-only active-head 僅供展示，不得作共識裁切；同一 entry 集合不論到達順序，fold bytes／derived CID 必須相同。回合 anchor 衝突另走 `consensus-invalid`，不提供可挪用至 ledger sibling 的 winner 規則。
