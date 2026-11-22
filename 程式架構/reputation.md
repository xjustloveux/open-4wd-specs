---
type: impl
domain: ["信譽仲裁"]
summary: 玩家信譽純 derive（來源事件→delta／新手保護／API）
authority: null
slug: null
---

# reputation（玩家信譽實作）

> **本檔角色**：玩家信譽（PeerId 層）的**實作層** —— 信譽 **derive 規則**（無獨立事件、由來源事件推導）、derived state、加減分觸發邏輯、新手保護、惡意檢舉者判定、連動權重、API。
> 設計與分工見 [信譽系統.md §1/§2/§4](../信譽系統.md)；算式權威見 [算式表.md §16–17](../算式表.md)。對應 `src/reputation/`。
> 事件基底 `BaseEvent` / `serializeForSigning` / `consensusNow` 見 [ledger.md](ledger.md)。

## 1. 信譽 = 純 derive（無獨立事件）

信譽**不開獨立 ledger 事件**（同經濟「不另開 mint 事件」）——分數純由**來源事件**推導：各 delta 在 `applyEvent` 處理來源事件時算出、累加進 `ReputationDerivedState`。防偽 = 來源事件本身已驗證（`MatchResultEvent` multisig／本人單簽 `RaceLeaveEvent`／仲裁），無人能憑空替第三人塞分。

| 來源                                      | 推導的信譽 delta（reason）                                                                                                                                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MatchResultEvent`（multisig）            | `match-finish` +1（每非斷線完賽者）/ `win-streak` +5（冠軍）/ `frequent-disconnect` −5（自 `disconnects`、僅罰有本場 loadout 者）——加分僅計 finisherCount ≥ 3 場＋24h 日額、斷線罰不受限（[§5.1](#51-完賽--連勝--斷線applyeventmatchresultevent)） |
| `RaceLeaveEvent`（本人單簽） | `frequent-disconnect` −5，只作用 `peerId` 本人；不改排名／TrueSkill／經濟，且與同場 MatchResult 以 `(matchId, peerId)` 持久去重 |
| `ugcUsageStats` / ratings（DerivedState） | `ugc-usage-milestone` +5（每 100 次）/ `high-rated-ugc` +20                                                                                                                                                                                        |
| `ArbitrationResultEvent`                  | `report-success` +10 / `copyright-violation` −100（含剽竊）/ `griefing` −20（騷擾、其他-對玩家）/ `ugc-blacklisted` −20（內容不當、其他-對 UGC）/ `malicious-reporter` −30                                                                         |

DMCA 下架只約束各 provider 自己的供應出口（[dmca.md](dmca.md)）、不進帳本、**不產生任何信譽 delta**；provider 案件也不得注入 client-wide derive 或 use-gate。

```typescript
type ReputationReason =
  | "ugc-usage-milestone"
  | "match-finish"
  | "win-streak"
  | "report-success"
  | "high-rated-ugc"
  | "ugc-blacklisted"
  | "frequent-disconnect"
  | "griefing"
  | "malicious-reporter"
  | "copyright-violation";

// 推導出的單筆信譽變動（供 history / UI；**非 ledger 事件**）
interface ReputationDelta {
  target: PeerId;
  delta: number;
  reason: ReputationReason;
  causeEventId: EventId;
  appliedAt: Timestamp;
}

declare const REPUTATION_DELTAS: Record<ReputationReason, number>; // 數值權威 信譽系統.md §2.2 / §2.3（本檔不重列）
```

## 2. Derived State

**〔MOD-R-053〕** 規則查詢必須使用專用持久索引；UI 的最近 100 筆 history 淘汰不得改變共識結果：

```typescript
interface ReputationDerivedState {
  scores: ReadonlyMap<PeerId, number>;
  history: ReadonlyMap<PeerId, ReputationDelta[]>; // 最近 100 筆——**僅供 UI 顯示，不得作規則查詢依據**（活躍玩家會擠出舊筆；規則查詢用下方專用索引）
  lastMaliciousReporterAt: ReadonlyMap<PeerId, Timestamp>; // 規則索引：惡意檢舉前科（§5.3 30 天 rolling 依據；判罰時寫入）
  recentMatchGains: ReadonlyMap<
    PeerId,
    ReadonlyArray<{ at: Timestamp; delta: number }>
  >; // 規則索引：24h 比賽加分窗（§5.1 日額依據；發放時寫入、apply 時修剪 > 24h——日額使其自然 ≤ ~10 筆，可序列化進檢查點）
  registeredAt: ReadonlyMap<PeerId, Timestamp>; // = 該 peer 首筆事件「套用時」的 consensusNow（自報 timestamp 倒填無效，ledger.md §6）
  matchCount: ReadonlyMap<PeerId, number>; // 僅計「非斷線完賽且 finisherCount ≥ 3」之場（與 match-finish +1 同一計數，信譽系統 §2.2 / §8.1）
  ugcCount: ReadonlyMap<PeerId, number>;
  ugcMilestonesAwarded: ReadonlyMap<CID, number>; // 規則索引：per-CID 已頒發的使用里程碑數（§5.2 每 100 次 +5 防重複頒發；ugcUsageStats 更新後推導、發放時寫入、可序列化進檢查點）
}
```

## 3. 分數計算

```typescript
// deltas = deriveReputationDeltas(peerId, allEvents)：掃來源事件（match / 仲裁）+ ugcUsageStats 推導
function computeReputationScore(
  peerId: PeerId,
  deltas: ReputationDelta[],
): number {
  let score = 500; // initial
  for (const d of deltas) if (d.target === peerId) score += d.delta;
  return Math.max(0, Math.min(1000, score)); // clamp [0,1000]
}
```

純函數、由事件鏈**推導**（無獨立信譽事件），權威算式見 [算式表.md §16](../算式表.md)。

## 4. 新手保護

實作 [信譽系統.md §4.1](../信譽系統.md) 中與 reputation 模組相關的一條（信譽下限 400；仲裁扣分**無新手豁免**——仲裁加權 > 60% 才成立、本身即防線）：

```typescript
// 註冊 < 7 天 → 信譽下限保護為 400
function applyNewPlayerProtection(
  peerId: PeerId,
  rawScore: number,
  state: ReputationDerivedState,
  now: Timestamp, // consensusNow(events)，見 ledger.md
): number {
  const registeredAt = state.registeredAt.get(peerId);
  if (!registeredAt) return rawScore;
  const days = (now - registeredAt) / (1000 * 86400);
  return days < 7 ? Math.max(rawScore, 400) : rawScore;
}

// 讀點契約：下限保護作用於「分數本身」——scores map 存 raw、所有讀點一律經本函數取分
function getEffectiveScore(
  peerId: PeerId,
  state: ReputationDerivedState,
  now: Timestamp,
): number {
  return applyNewPlayerProtection(
    peerId,
    state.scores.get(peerId) ?? 500,
    state,
    now,
  );
}
```

**〔MOD-R-054〕** **讀點契約**（[信譽系統.md §4.1](../信譽系統.md)）：仲裁資格與 weight（`now` = 抽籤檢查點 timestamp）、UGC 評分權重（`now` = 該 `UgcRateEvent.timestamp`，[ugc-rating.md §6.1](ugc-rating.md)）、配對過濾（`now` = `consensusNow`）、API `getScore` / UI——**全部讀 `getEffectiveScore`**。consensus derive 內的 `now` 一律綁事件 / 檢查點 timestamp（決定性、不得用本地時鐘）。

## 5. 信譽 delta 推導（在 `applyEvent` 套用來源事件時算）

> 以下皆**推導出 `ReputationDelta`、累加進 `scores` + `history`**，**不 `appendEvent`**（信譽無獨立事件，[§1](#1-信譽--純-derive無獨立事件)）。`history` 即推導出的 delta 串（供 UI / 防疊扣查詢）。

### 5.1 完賽 + 連勝 + 斷線（`applyEvent(MatchResultEvent)`）

**〔MOD-R-055〕** MatchResult fold 必須共同推導完賽、連勝、斷線信譽 delta，並套用 24h 比賽加分上限：

```typescript
// matchGains24hOf(p, at)：rolling 24h 內（(at−24h, at]）match-finish + win-streak delta 合計
// —— 自 §2 recentMatchGains 專用索引加總（發放時同步寫入、修剪 > 24h）；history 100 筆僅 UI、不得作依據
function deriveMatchReputation(
  match: MatchResultEvent,
  recentOf: (p: PeerId) => MatchRecord[],
  matchGains24hOf: (p: PeerId, at: Timestamp) => number,
): ReputationDelta[] {
  const ds: ReputationDelta[] = [],
    at = match.timestamp,
    cause = match.id;
  const forfeited = new Set(match.disconnects.map((d) => d.peerId));
  for (const d of match.disconnects) {
    // 異常斷線 −5/次——absent（未交 loadout）＝無參與證明不罰；有 loadout 者不論 finisherCount 照罰（void 為全體斷線而設，信譽系統 §2.3）
    if (match.loadouts[d.peerId] === undefined) continue; // committed 閘：只罰有本場簽章 loadout 者
    ds.push({
      target: d.peerId,
      delta: REPUTATION_DELTAS["frequent-disconnect"],
      reason: "frequent-disconnect",
      causeEventId: cause,
      appliedAt: at,
    });
  }

  const finishers = match.ranking.filter((p) => !forfeited.has(p));
  if (finishers.length < 3) return ds; // 經濟 void 場（finisherCount < 3）不發加分（同 經濟系統 §6.2 門檻與理由）

  const capped = (d: ReputationDelta) => {
    // 24h 日額：已發 + 本場已列 + 本筆 ≤ 上限才發（逐筆檢查、超額不發）
    const inMatch = ds
      .filter((x) => x.target === d.target && x.delta > 0)
      .reduce((s, x) => s + x.delta, 0);
    if (
      matchGains24hOf(d.target, at) + inMatch + d.delta <=
      REPUTATION_MATCH_GAIN_DAILY_MAX
    )
      ds.push(d);
  };
  for (const p of finishers)
    // 完賽 +1（每非斷線完賽者；先於連勝檢查）
    capped({
      target: p,
      delta: REPUTATION_DELTAS["match-finish"],
      reason: "match-finish",
      causeEventId: cause,
      appliedAt: at,
    });
  const winner = match.ranking[0]; // 連勝看冠軍（總名次第 1）
  const recent = recentOf(winner); // 最近 5 場「含本場」、僅列 finisherCount ≥ 3 之場（void 不入窗、不破連勝）
  if (recent.length === 5 && recent.every((r) => r.ranking[0] === winner))
    // 連勝：最近 5 場（含本場）總名次全部第 1
    capped({
      target: winner,
      delta: REPUTATION_DELTAS["win-streak"],
      reason: "win-streak",
      causeEventId: cause,
      appliedAt: at,
    });
  return ds;
}
```

比賽加分日額 `REPUTATION_MATCH_GAIN_DAILY_MAX`（10，rolling 24h、非日曆日；[protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽)）只蓋 match-finish / win-streak——**扣分與其他加分不經此額度**（權威 [信譽系統.md §2.2](../信譽系統.md)）。

### 5.2 UGC 使用門檻（每 100 次 +5；`ugcUsageStats` 更新後推導）

```typescript
// cause / at = 觸發 ugcUsageStats 更新的來源事件（MatchResultEvent）——appliedAt 綁事件、跨 peer history 一致（不得用 derivedAt）
function deriveMilestoneReputation(
  cid: CID,
  state: DerivedState,
  cause: EventId,
  at: Timestamp,
): ReputationDelta[] {
  const stats = state.ugcUsageStats.get(cid);
  const author = state.ugcRecords.get(cid)?.author;
  if (!stats || !author) return [];
  const milestone = Math.floor(stats.totalUses / 100);
  const awarded = state.ugcMilestonesAwarded.get(cid) ?? 0; // 防重複頒發（推導旗標）
  return Array.from({ length: Math.max(0, milestone - awarded) }, () => ({
    target: author,
    delta: REPUTATION_DELTAS["ugc-usage-milestone"],
    reason: "ugc-usage-milestone",
    causeEventId: cause,
    appliedAt: at,
  }));
}
```

### 5.3 惡意檢舉者判定（三條件 AND，防誤殺；`applyEvent(ArbitrationResultEvent)`）

**〔MOD-R-056〕** 對齊 [信譽系統.md §4.3](../信譽系統.md)：樣本足夠 + 準確率低 + 無前科保護，三條件**同時**滿足才 −30。

```typescript
// arb = 觸發判定的 ArbitrationResultEvent（reject 結案時呼叫）——cause / appliedAt 綁事件、跨 peer 一致
function deriveMaliciousReporter(
  reporter: PeerId,
  state: DerivedState,
  arb: ArbitrationResultEvent,
): ReputationDelta[] {
  const acc = state.reportAccuracy.get(reporter);
  if (!acc || acc.reports < 10) return []; // ① 樣本不足（已結案 < 10 筆；準確率 = lifetime 累積）
  if (acc.successful * 10 >= acc.reports * 3) return []; // ② 準確率 ≥ 30%（整數交叉相乘、免浮點）
  const lastAt = state.lastMaliciousReporterAt.get(reporter); // 專用規則索引（§2；history 100 筆僅 UI、會被活躍玩家擠出）
  if (lastAt !== undefined && lastAt >= arb.timestamp - 30 * 86400 * 1000)
    return []; // ③ 30 天內已判過 → 不疊扣（rolling）；判罰時同步寫入索引
  return [
    {
      target: reporter,
      delta: REPUTATION_DELTAS["malicious-reporter"],
      reason: "malicious-reporter",
      causeEventId: arb.id,
      appliedAt: arb.timestamp,
    },
  ];
}
```

### 5.4 檢舉成立（`applyEvent(ArbitrationResultEvent)`，罰則依檢舉類型）

**〔MOD-R-057〕** 對齊 [信譽系統.md §2.3 / §5.3](../信譽系統.md)。「其他」型無專屬 reason，**借對象所屬桶的標籤**（對 UGC → `ugc-blacklisted`、對玩家 → `griefing`）；`reject` / 流局 / 抽籤前撤回不產生 delta（只進 / 不進準確率統計見 [moderation.md §5.4](moderation.md)）。**無新手豁免**。

```typescript
function deriveArbitrationReputation(
  arb: ArbitrationResultEvent,
  report: ReportEvent,
  state: DerivedState,
): ReputationDelta[] {
  if (arb.result !== "pass") return []; // reject → 零 delta（僅準確率統計 → §5.3）
  const at = arb.timestamp,
    cause = arb.id,
    ds: ReputationDelta[] = [];
  ds.push({
    target: report.reporter,
    delta: REPUTATION_DELTAS["report-success"],
    reason: "report-success",
    causeEventId: cause,
    appliedAt: at,
  });
  const offender =
    report.targetKind === "cid" // 責任人：UGC 定罪 → 作者
      ? state.ugcRecords.get(report.target as CID)!.author
      : (report.target as PeerId);
  const reason: ReputationReason =
    report.reason === "copyright-violation"
      ? "copyright-violation" // 含剽竊（併入版權）−100
      : report.targetKind === "cid"
        ? "ugc-blacklisted" // 內容不當 / 其他-對 UGC −20
        : "griefing"; // 騷擾 / 其他-對玩家 −20
  ds.push({
    target: offender,
    delta: REPUTATION_DELTAS[reason],
    reason,
    causeEventId: cause,
    appliedAt: at,
  });
  return ds;
}
```

CID 定罪同時觸發 `BlacklistEvent`（下架）；同一責任人定罪累積 ≥ 3 → 全域玩家黑名單（純 derive 三振，見 [moderation.md §5.5](moderation.md)）。

## 6. 連動 API

### 6.1 仲裁投票權重

〔MOD-R-010〕

```typescript
// 整數預算表（共識計算禁浮點 log10——tally 全網重算驗證，跨硬體 libm 差異會翻轉 60% 邊界案；算式表 §17）
function arbitrationVoteWeightX100(reputation: number): number {
  return ARBITRATION_WEIGHT_X100_TABLE[Math.max(0, Math.min(1000, reputation))];
  // 表 = 離線一次性生成 round(100 × log10(rep + 10))、隨 client 出貨（bit-exact）；rep ∈ [0,1000] → weightX100 ∈ [100, 300]
}
```

權威算式見 [算式表.md §17](../算式表.md)。檢舉與仲裁採**純仲裁模型**（隨機抽合格仲裁者投票、加權通過 > 60% 才黑名單），見 [moderation.md](moderation.md) 與 [檢舉與仲裁.md](../流程/檢舉與仲裁.md)。

> **註**：`report-success +10` 由仲裁通過觸發、非加權門檻（所有檢舉走仲裁，見 [moderation.md](moderation.md)）。UGC **評分**權重 `ratingWeightX100`（50/100/150）是另一回事，見 [ugc-rating.md § 評分權重](ugc-rating.md)。

### 6.2 配對過濾

```typescript
function shouldFilterByReputation(
  threshold: number,
  state: DerivedState,
  now: Timestamp,
): (p: PeerId) => boolean {
  return (peerId) =>
    getEffectiveScore(peerId, state.reputation, now) >= threshold; // 保護後分數（§4 讀點契約；now = consensusNow）
}
```

## 7. UI 顯示

```typescript
function reputationToStars(score: number): number {
  // 0-1000 → 0-5 ★
  return Math.floor(score / 200);
}
```

| 信譽    | 星級       |
| ------- | ---------- |
| 0~199   | 0★（無星） |
| 200~399 | ⭐         |
| 400~599 | ⭐⭐       |
| 600~799 | ⭐⭐⭐     |
| 800~999 | ⭐⭐⭐⭐   |
| 1000    | ⭐⭐⭐⭐⭐ |

信譽變動歷史 UI 見 [信譽系統.md §9.2](../信譽系統.md)。

## 8. 公開 API

```typescript
interface ReputationApi {
  getScore(peerId: PeerId): Promise<number>;
  getStars(peerId: PeerId): Promise<number>;
  getHistory(peerId: PeerId, limit: number): Promise<ReputationDelta[]>;
  onScoreChange(
    peerId: PeerId,
    handler: (newScore: number) => void,
  ): Unsubscribe;
  getDistribution(): Promise<ReputationDistribution>;
}

interface ReputationDistribution {
  total: number;
  bands: Array<{ min: number; max: number; count: number }>;
  median: number;
}
```

## 9. 風險與緩解

| 風險                              | 緩解                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 信譽通膨                          | 上限 1000 + 加分事件門檻                                                                                                                                  |
| 新人被惡意刷低                    | 新人保護期 7 天保底 400 + 純仲裁定罪門檻（加權 > 60%）+ 惡意檢舉者 −30 反制                                                                               |
| 計算錯誤                          | 純函數 + 帳本檢查點（見 ledger.md）                                                                                                                       |
| Sybil 刷分（合謀完賽 / 連勝農場） | 比賽加分僅計 finisherCount ≥ 3 場 + rolling 24h 日額（[§5.1](#51-完賽--連勝--斷線applyeventmatchresultevent)）+ 多方簽章；殘餘風險 = honest-majority 假設 |
