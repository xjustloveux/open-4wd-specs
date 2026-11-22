---
type: impl
domain: ["UGC版權"]
summary: UGC 評分（整數量化／Bayesian／隱式 fallback／里程碑）
authority: null
slug: null
---
# ugc-rating（UGC 評分實作）

> **本檔角色**：UGC 評分（CID 層）的**實作層** —— 整數量化、事件 schema、Bayesian + 隱式 fallback 計算、24h 防抖、覆蓋/撤回、derived state 套用、高評分里程碑、API。
> 設計見 [信譽系統.md §3](../信譽系統.md)；算式權威見 [算式表.md §18（評分權重）/ §19（Bayesian + 隱式 fallback）](../算式表.md)；經濟接軌見 [算式表.md §14](../算式表.md)。對應 `src/ugc-rating/`。
> 事件基底 / `consensusNow` / `collectAllUgcUsedInMatch` / `RatingDerivedState` 嵌套見 [ledger.md](ledger.md)。

## 1. 整數量化原則

所有 rating 數值在 derived state / 事件 / API 內均以**整數**儲存，避免跨 peer 浮點誤差導致經濟結算共識炸裂（呼應 [資料系統.md § 整數量化](../資料系統.md)）：

- `score`: 1 | 2 | 3 | 4 | 5
- `weightX100`: 50 / 100 / 150（reputation 階梯量化，即 0.5 / 1.0 / 1.5 × 100）
- `ratingX100`: 0-500（表達 0.00-5.00）
- `weightedSumX10000`: Σ(score × 100 × weightX100)
- `totalWeightX100`: Σ weightX100

UI 顯示時除以 100 還原成「★4.6」。

## 2. 事件結構

```typescript
interface UgcRateEvent extends BaseEvent {
  type: 'ugc-rate';
  rater: PeerId;  cid: CID;  score: 1 | 2 | 3 | 4 | 5;
  useMatchId: string;       // 背書：該玩家在哪場比賽用過此 UGC
}

interface UgcRateRevokeEvent extends BaseEvent {
  type: 'ugc-rate-revoke';
  rateEventId: EventId;  rater: PeerId;   // 必須是原評分者；rateEventId＝審計引用
  cid: CID;                               // fold 定位用（撤回我對此 CID 的現行投票）——derive 為純函數、不得查 ledger 原事件
}
```

> 已列於 [資料系統.md §3 事件目錄](../資料系統.md)；併入 [ledger.md `LedgerEvent`](ledger.md) union。

**覆蓋**：同 PeerId 對同 CID 多次評分 → derive 取最新一筆有效（先前事件保留但不參與計算）。
**24h 覆蓋防抖**：同 `(rater, cid)` 上一筆未撤回的 `UgcRateEvent` 若在 24h 內，新評分被 `submitRating` 擋下、不寫 ledger（避免被覆蓋的事件永久佔 log）。修正錯評走「撤回 → 重評」雙步驟。24h 比對的「現在」採 `consensusNow(events)`（見 [ledger.md](ledger.md)）。

## 3. 計算

### 3.1 評分權重（整數量化）

```typescript
function ratingWeightX100(reputation: number): number {
  if (reputation < 200) return 50;    // 0.5
  if (reputation > 800) return 150;   // 1.5
  return 100;                          // 1.0
}
```

權威見 [算式表.md §18](../算式表.md)。

### 3.2 computedRatingX100（Bayesian，整數版）

```typescript
function computeRatingX100(stat: UgcRatingStat, ugcUsageCount: number): { ratingX100: number; isImplicit: boolean } {
  const n = stat.voteCount;
  if (n === 0) return { ratingX100: implicitRatingX100(ugcUsageCount), isImplicit: true };

  // 顯式平均：meanX100 = weightedSumX10000 / totalWeightX100
  const explicitMeanX100 = Number(stat.weightedSumX10000 / stat.totalWeightX100);

  if (n < BAYESIAN_PRIOR_SAMPLES) {     // 樣本不足：向中性 prior 拉
    const k = BAYESIAN_PRIOR_SAMPLES;
    return { ratingX100: Math.floor((n * explicitMeanX100 + k * RATING_NEUTRAL_X100) / (n + k)), isImplicit: false };
  }
  return { ratingX100: explicitMeanX100, isImplicit: false };
}
```

算式權威見 [算式表.md §19](../算式表.md)；常數值只由
[protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽) 定義，實作由系統常數模組匯入。

### 3.3 隱式 fallback（整數查表）

跨硬體浮點不一致 → 整數查表（避免炸毀 consensus）。隱式查表見 [算式表.md §19](../算式表.md)。

封頂 4.80 留下「顯式可達 5.00」的差異化空間，激勵玩家評分。

## 4. 提交流程

```typescript
async function submitRating(cid: CID, score: 1|2|3|4|5, useMatchId: string, ledger: Ledger, state: DerivedState): Promise<Result<EventId>> {
  const rater = keyManager.getPeerId();
  const now = consensusNow(await ledger.getAllEvents());
  const RATE_DEBOUNCE_MS = 24 * 3600 * 1000;

  if (cid.startsWith('builtin:')) return error('公版資產不可評分');
  if (state.moderation.blacklist.has(cid)) return error('黑名單作品不可評分');
  if (state.ugc.ugcRecords.get(cid)?.retired) return error('已歸檔作品不可評分（可先續租激活）');  // 退役 derive 見 ledger.md P5
  if (state.ugc.similarityPending.has(cid)) return error('相似度審查中、暫不可評分');             // anti-piracy.md §5.1（防審查期刷高評分里程碑）

  // 24h 覆蓋防抖
  const prev = state.ratings.ugcRatings.get(cid)?.explicitVotes.get(rater);
  if (prev && (now - prev.ratedAt) < RATE_DEBOUNCE_MS) return error('24 小時內已評分過，請先撤回再重評');

  // useMatchId 背書：必須參賽且該場用過此 UGC（collectAllUgcUsedInMatch 見 ledger.md）
  const match = await ledger.getMatchRecord(useMatchId);
  if (!match) return error('比賽不存在');
  if (!match.ranking.includes(rater)) return error('你未參與此比賽');
  if (!collectAllUgcUsedInMatch(match).has(cid)) return error('此比賽未使用該 UGC');

  return ok(await ledger.appendEvent({ type: 'ugc-rate', rater, cid, score, useMatchId }));
}
```

## 5. 撤回評分

```typescript
// 純函數形：以 (rater, cid) 自 state 定位現行投票、不查 ledger 原事件；rateEventId＝合成 `${rater}@${ratedAt}`（純審計引用）
async function revokeRating(cid: CID, ledger: Ledger, state: DerivedState): Promise<Result<void>> {
  const rater = keyManager.getPeerId();
  const vote = state.ratings.ugcRatings.get(cid)?.explicitVotes.get(rater);
  if (!vote) return error('你對此作品沒有現行評分');
  await ledger.appendEvent({ type: 'ugc-rate-revoke', rateEventId: `${rater}@${vote.ratedAt}`, rater, cid });
  return ok(undefined);
}
```

無時間限制（與 moderation 24h 撤回不同）：評分不像檢舉直接懲罰他人，撤回成本低、惡意空間小。

> **builder／收件契約（`src/ugc-rating/builder.ts`）**：退役檢查使用 `deriveRetireStatus` 完整 derive（含自動退役）；useMatchId 背書收件驗證 ＝hot（`recentMatches`）同步驗三條、hot miss＝defer（呼叫端 cold 補查重驗）；**背書只在收件層驗證**——hot 窗隨檢查點輪轉，若放入 fold 守門會使 refold 與首播分歧（同 7d「票不入 state」哲學）。

## 6. Derived State

```typescript
interface RatingDerivedState {        // 嵌套於 DerivedState.ratings（見 ledger.md）
  ugcRatings: ReadonlyMap<CID, UgcRatingStat>;
  creatorMilestones: ReadonlyMap<PeerId, CreatorRatingMilestone>;
}

interface UgcRatingStat {
  cid: CID;
  explicitVotes: ReadonlyMap<PeerId, ExplicitVote>;
  weightedSumX10000: bigint;  totalWeightX100: bigint;  voteCount: number;
  computedRatingX100: number;       // 0-500
  isImplicit: boolean;              // computedRating 是否來自隱式 fallback
  lastUpdatedAt: Timestamp;
}

interface ExplicitVote { score: 1|2|3|4|5; weightX100: number; ratedAt: Timestamp; useMatchId: string; }
interface CreatorRatingMilestone { peerId: PeerId; awardedCids: ReadonlySet<CID>; }
```

### 6.1 事件套用（覆蓋 = 先扣舊投票再加新）

```typescript
function applyRatingEvent(state, event, reputationState, ugcUsageStats, ugcRecords): RatingDerivedState {   // 純函數：不吃 ledger
  if (event.type === 'ugc-rate') {
    const stat = state.ugcRatings.get(event.cid) ?? newEmptyStat(event.cid);
    const weightX100 = ratingWeightX100(getEffectiveScore(event.rater, reputationState, event.timestamp));  // 保護後分數（reputation.md §4 讀點契約）

    let weightedSum = stat.weightedSumX10000, totalWeight = stat.totalWeightX100, voteCount = stat.voteCount;
    const oldVote = stat.explicitVotes.get(event.rater);
    if (oldVote) {  // 覆蓋：扣除舊投票
      weightedSum -= BigInt(oldVote.score * 100 * oldVote.weightX100);
      totalWeight -= BigInt(oldVote.weightX100);  voteCount -= 1;
    }
    weightedSum += BigInt(event.score * 100 * weightX100);
    totalWeight += BigInt(weightX100);  voteCount += 1;

    const newVotes = new Map([...stat.explicitVotes, [event.rater, {
      score: event.score, weightX100, ratedAt: event.timestamp, useMatchId: event.useMatchId }]]);
    const ugcUsage = ugcUsageStats.get(event.cid)?.totalUses ?? 0;
    const newStat: UgcRatingStat = { cid: event.cid, explicitVotes: newVotes,
      weightedSumX10000: weightedSum, totalWeightX100: totalWeight, voteCount,
      ...computeRatingX100({ ...stat, weightedSumX10000: weightedSum, totalWeightX100: totalWeight, voteCount }, ugcUsage),
      lastUpdatedAt: event.timestamp };

    const milestoneDeltas = deriveHighRatedReputation(newStat, ugcRecords, state.creatorMilestones, `${event.cid}@${event.timestamp}`, event.timestamp);  // cause＝合成 `${cid}@${at}`
    return { ugcRatings: new Map([...state.ugcRatings, [event.cid, newStat]]),
      creatorMilestones: applyMilestoneAdjustments(state.creatorMilestones, milestoneDeltas) };
  }

  // ugc-rate-revoke：以 (event.rater, event.cid) 定位現行投票（純函數、不查 ledger 原事件）→ 扣除、重算
  const stat = state.ugcRatings.get(event.cid);
  const oldVote = stat?.explicitVotes.get(event.rater);
  if (!stat || !oldVote) return state;
  const weightedSum = stat.weightedSumX10000 - BigInt(oldVote.score * 100 * oldVote.weightX100);
  const totalWeight = stat.totalWeightX100 - BigInt(oldVote.weightX100);
  const voteCount = stat.voteCount - 1;
  const newVotes = new Map(stat.explicitVotes); newVotes.delete(event.rater);
  const ugcUsage = ugcUsageStats.get(event.cid)?.totalUses ?? 0;
  const newStat = { ...stat, explicitVotes: newVotes, weightedSumX10000: weightedSum,
    totalWeightX100: totalWeight, voteCount,
    ...computeRatingX100({ ...stat, weightedSumX10000: weightedSum, totalWeightX100: totalWeight, voteCount }, ugcUsage),
    lastUpdatedAt: event.timestamp };
  const milestoneDeltas = deriveHighRatedReputation(newStat, ugcRecords, state.creatorMilestones, `${event.cid}@${event.timestamp}`, event.timestamp);  // 撤低分票可令 rating 升越 4.5——revoke 也檢查
  return { ugcRatings: new Map([...state.ugcRatings, [event.cid, newStat]]),
    creatorMilestones: applyMilestoneAdjustments(state.creatorMilestones, milestoneDeltas) };
}
```

## 7. 高評分里程碑（reputation +20，per-CID）

**觸發 = 單一 UGC 達 `voteCount ≥ 10 且 ratingX100 ≥ 450`（rating ≥ 4.5）→ 該 UGC 作者 +20**，以 `creatorMilestones.awardedCids` 去重（每個 CID 只計一次）。

```typescript
// cause / at = 觸發跨越門檻的 UgcRateEvent / UgcRateRevokeEvent；cause＝合成 `${cid}@${at}`（純函數、不揹 log entry id）；appliedAt 綁事件、跨 peer history 一致——不得用 derive 當下時間
function deriveHighRatedReputation(stat, ugcRecords, currentMilestones, cause: EventId, at: Timestamp): ReputationDelta[] {  // 推導、非 ledger 事件
  if (stat.voteCount < 10) return [];                  // 樣本門檻防「找朋友互打 5 星」
  if (stat.computedRatingX100 < 450) return [];
  const author = ugcRecords.get(stat.cid)?.author;
  if (!author) return [];
  if (currentMilestones.get(author)?.awardedCids.has(stat.cid)) return [];   // 已計入過
  return [{ target: author, delta: 20, reason: 'high-rated-ugc', causeEventId: cause, appliedAt: at }];
}
```

- **樣本門檻 `voteCount ≥ 10`**：避免少量互評刷分。
- **不退回**：rating 之後掉到 < 4.5，已給的 +20 不撤回（事件溯源原則）。
- 對齊 [信譽系統.md §1/§2.2/§3.4](../信譽系統.md)（per-CID 高評分里程碑）。

## 8. 公開 API

```typescript
interface UgcRatingApi extends RatingApi {
  getRatingX100(cid: CID): number;                                  // 0-500，給 economy
  getRatingsX100(cids: ReadonlyArray<CID>): ReadonlyMap<CID, number>;
  getRatingDetail(cid: CID): Promise<RatingDetail>;
  submitRating(cid: CID, score: 1|2|3|4|5, useMatchId: string): Promise<Result<EventId>>;
  revokeRating(cid: CID): Promise<Result<void>>;               // 以 (我, cid) 定位現行投票撤回（§5）
  canRate(cid: CID, requester: PeerId): Promise<{ allowed: boolean; lastMatchId?: string }>;
  getMyRating(cid: CID): Promise<{ score: 1|2|3|4|5; ratedAt: Timestamp } | null>;
}

interface RatingDetail {
  cid: CID;  ratingX100: number;  voteCount: number;
  distribution: { [score in 1|2|3|4|5]: number };  isImplicit: boolean;
}

// canRate：找最近一場 requester 參與且用過該 cid 的比賽
async function canRate(cid: CID, requester: PeerId, ledger: Ledger): Promise<{ allowed: boolean; lastMatchId?: string }> {
  if (cid.startsWith('builtin:')) return { allowed: false };
  for (const match of await ledger.getRecentMatchesForPlayer(requester, 50)) {
    if (collectAllUgcUsedInMatch(match).has(cid)) return { allowed: true, lastMatchId: match.matchId };
  }
  return { allowed: false };
}
```

## 9. UI 顯示規則

- 卡片顯示 `★4.6 (24)` 或 `★4.2 (隱式)`；公版資產不顯示星等。
- 樣本 `< 5` 時 UI 弱化星等（淺色 / 加標示）。詳見 [信譽系統.md §3.1](../信譽系統.md)。

## 10. 與其他模組接軌

| 模組 | 接軌 |
|---|---|
| `ledger/` | `UgcRateEvent` / `UgcRateRevokeEvent` 入 `LedgerEvent`；`DerivedState.ratings` 嵌套；`applyEvent` + 本檔 `applyRatingEvent` |
| `economy/` | 透過 `getRatingX100(cid)` 取整數 rating → royalty 全整數運算（見 [算式表.md §14](../算式表.md)）|
| `reputation/` | 高評分里程碑 → 信譽 delta `reason:'high-rated-ugc'`（derive、無獨立事件）|
| `moderation/` | 黑名單作品拒收新評分；歷史評分不排除（評分是當下品味）|

## 11. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 評分極稀少 | 隱式 fallback（整數查表）+ Bayesian 平均 |
| 多開刷高/低分 | 需實際使用背書 + reputation 權重 + Bayesian + milestone 樣本 `voteCount ≥ 10` |
| 早期樣本太少失真 | Bayesian + 隱式 fallback |
| 評分跨閾值反覆刷 +20 | `creatorMilestones.awardedCids` 記錄已計入 CID、永不退回 |
| 跨 peer 浮點誤差 | 全整數 × 100 量化 |
