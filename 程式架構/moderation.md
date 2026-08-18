---
type: impl
domain: ["信譽仲裁"]
summary: 檢舉／純仲裁（隨機抽選＋加權）／黑名單×經濟
authority: null
slug: null
---

# moderation（檢舉 / 仲裁 / 黑名單實作）

> **本檔角色**：檢舉 → 仲裁 → 黑名單的**實作層** —— 事件 schema、derived state、檢舉過期/撤回、**純仲裁觸發**（隨機抽合格仲裁者 → 加權投票 > 60% → 黑名單/扣信譽）、黑名單 × 經濟整合、fork 鏈黑名單、執行邊界、API。
> 流程設計見 [檢舉與仲裁.md](../流程/檢舉與仲裁.md)；信譽連動見 [信譽系統.md §5/§6/§8](../信譽系統.md)；DMCA 走獨立流程見 [dmca.md](dmca.md)。對應 `src/moderation/`。
> 事件基底 / `consensusNow` / 退役 derive 見 [ledger.md](ledger.md)。

## 1. 事件結構

**〔MOD-R-019〕** `report` 事件必須通過固定 schema 與 target kind 驗證，合法事件才可進入檢舉狀態：

```typescript
interface ReportEvent extends BaseEvent {
  // 資料系統 §3 事件目錄名
  type: "report";
  target: CID | PeerId; // 可檢舉 UGC（CID）或玩家（PeerId）
  targetKind: "cid" | "peer";
  reporter: PeerId;
  reason: ReportReason;
  details?: string; // 自由說明，限 500 字
  evidence?: string[]; // screenshots / log fragment 引用
}

interface ReportRevokeEvent extends BaseEvent {
  type: "report-revoke";
  reportEventId: EventId;
  reporter: PeerId; // 抽籤前可撤回（= 首個滿 24h 檢查點前，可能 > 24h，§4）
  target: CID | PeerId; // fold 定位用（fold 不可查原事件——純函數性補欄；reportEventId 留審計）
}

interface ArbitrationVoteEvent extends BaseEvent {
  type: "arbitration-vote";
  reportEventId: EventId;
  arbiter: PeerId;
  vote: "pass" | "reject" | "abstain";
}

interface ArbitrationResultEvent extends BaseEvent {
  type: "arbitration-result";
  reportEventId: EventId; // 檢舉案＝`${reporter}@${reportedAt}#${target}` 合成 id（綁 target 防跨標的簽章轉移）；上傳期案＝`upload:${cid}`（canonical、收件驗）
  result: "pass" | "reject" | "no-quorum"; // no-quorum = 流局（期滿有效票 < 4 且重抽輪已盡、或合格池 < 7；§5.3）
  passRatioX100: number; // 加權通過比例 × 100（門檻 60；no-quorum = 重算殘票比例、可為 0）
  arbiters: PeerId[]; // 參與加權計算者（因池 < 7 流局 → []）
  // 案錨摘要（fold 純函數性補欄——fold 不可查 ledger 原事件；§5.6 收件第 1 條驗「摘要與案錨事件逐位一致」、fold 對 state 案錄比對守門）
  caseKind: "report" | "upload-pending"; // 上傳期案同機器（§5.7）
  reporter?: PeerId; // 檢舉案＝檢舉者；上傳期案無（不進準確率）
  target: CID | PeerId;
  targetKind: "cid" | "peer";
  reason: ReportReason; // 罰則分流用；上傳期案固定 'copyright-violation' 語意但不扣信譽
  anchoredAt: Timestamp; // 案錨事件 timestamp（檢舉案＝ReportEvent、上傳期案＝UgcUploadEvent）
  // panel-signature-set：≥ quorum 名面板成員對 (reportEventId, target,
  // result, passRatioX100) 的 attestation——各自 replay 票序列後只簽自己算出的結果（§5.6
  // 收件條④分散化）；fold 恆驗（§5.6 硬化段；池不足流局 arbiters=[] 改驗合格池上界）
  panelSignatures: SignerSignature[];
}

// 黑名單（資料系統 §3）：CID 走 BlacklistEvent；玩家全域黑名單＝純 derive 三振（§5.5，無獨立事件）
interface BlacklistEvent extends BaseEvent {
  type: "blacklist-cid";
  cid: CID;
  triggeredBy: EventId; // 觸發的 arbitration-result 事件
  triggeredAt: Timestamp;
}

type ReportReason =
  | "copyright-violation" // 違反版權（含剽竊）；作弊非檢舉類型（自動反作弊處理，信譽系統 §5.1）
  | "griefing" // 騷擾（限對話，證據 = SignedPayload<ChatMessage>）
  | "inappropriate-content" // 內容不當（對 UGC）
  | "other";
```

檢舉類型 → 罰則對照見 [檢舉與仲裁.md §2](../流程/檢舉與仲裁.md)（違反版權含剽竊 -100 / 騷擾 -20 / 內容不當 -20 / 其他 -20 借標籤）。

## 2. Derived State

```typescript
interface ModerationDerivedState {
  blacklist: ReadonlySet<CID>; // CID 黑名單
  peerBlacklist: ReadonlySet<PeerId>; // 玩家黑名單（純 derive 三振，§5.5）
  pendingReports: ReadonlyMap<CID | PeerId, ReportInfo[]>; // 仲裁中 / 未結案
  reportsByReporter: ReadonlyMap<PeerId, ReadonlyMap<CID | PeerId, ReportInfo>>;
  reportAccuracy: ReadonlyMap<PeerId, { reports: number; successful: number }>;
  arbitrationResults: ReadonlyMap<EventId, ArbitrationResultRecord>; // 結果摘要（fold 冪等鍵；不存全事件——state 不揹簽章）
  convictionsByOffender: ReadonlyMap<PeerId, number>; // 規則索引：責任人定罪數（三振 §5.5 依據；結果套用時累加）
  uploadPendingConvictions: ReadonlyMap<PeerId, Timestamp[]>; // 規則索引：上傳期案判抄時間戳（安全港 30 天窗 anti-piracy.md §5.1；寫入時修剪）
}

interface ArbitrationResultRecord {
  // 結果摘要（caseKind + target = 上傳期案同 cid 去重依據）
  result: "pass" | "reject" | "no-quorum";
  passRatioX100: number;
  caseKind: "report" | "upload-pending";
  target: CID | PeerId;
}

interface ReportInfo {
  reportEventId: EventId;
  reporter: PeerId;
  targetKind: "cid" | "peer";
  reason: ReportReason;
  details?: string;
  reportedAt: Timestamp;
  revoked: boolean;
  revokedAt?: Timestamp;
  outcome?: "pass" | "reject" | "no-quorum"; // 仲裁結果（no-quorum = 流局，重抽一次仍不足）
}
```

## 3. pendingReports 自動過期（純 derive）

**〔MOD-R-020〕** 未結案的 `report` 事件放在 `pendingReports`，**滿 90 天仍未結案 → derive 時自動視為過期**（不再列入、不再可觸發新仲裁）。

P2P 不可用 `Date.now()`（每 peer 機器時間不同 → derive 不一致 → 簽章驗證炸裂），改用 `consensusNow(events)`（ledger 內最新事件 timestamp，見 [ledger.md](ledger.md)）。

```typescript
const REPORT_EXPIRE_MS = 90 * 24 * 3600 * 1000;
const isReportExpired = (r: ReportInfo, now: Timestamp) =>
  now - r.reportedAt >= REPORT_EXPIRE_MS;

function derivePendingReports(
  raw: ReadonlyMap<CID | PeerId, ReportInfo[]>,
  now: Timestamp,
): ReadonlyMap<CID | PeerId, ReportInfo[]> {
  const filtered = new Map<CID | PeerId, ReportInfo[]>();
  for (const [key, reports] of raw) {
    const alive = reports.filter((r) => !r.revoked && !isReportExpired(r, now));
    if (alive.length > 0) filtered.set(key, alive);
  }
  return filtered;
}
```

**過期不寫事件**（純 derive 規則）：P2P 無 timer、寫事件易漏；純 derive 任何 peer 重算結果一致、無共識成本。

## 4. 撤回（抽籤前）+ 重新檢舉

**〔MOD-R-021〕** 撤回資格由檢舉時間與 fold 位置共識時鐘推導，撤回窗在仲裁抽籤前。

**〔MOD-R-022〕** `consensusNow >= 檢舉 + 24h` 時必須拒絕撤回，事件自報 timestamp 不得繞過窗界。

**〔MOD-R-023〕** 窗內撤回不進準確率且允許同對象重新檢舉；抽籤後不得撤回。

抽籤點 = 檢舉後**首個 timestamp ≥ 檢舉 + 24h 的帳本檢查點**（seed 見 [§5.2](#52-隨機抽選跨-peer-deterministic)）。fold 守門的 24h 下界恆不晚於真實抽籤點。

```typescript
const canRevoke = (report: ReportEvent, latestCheckpointAt: Timestamp) =>
  latestCheckpointAt <
  report.timestamp + ARBITRATION_DRAW_DELAY_HOURS * 3600 * 1000; // 尚未到抽籤點（24h，protocol.md §5）

// 撤回 / 流局 / 過期皆無懲罰、同對象可再檢舉；僅「仲裁中 / 已有 pass·reject 結果且未過期」不可重複告
function canReportAgain(
  reporter: PeerId,
  target: CID | PeerId,
  state: ModerationDerivedState,
  now: Timestamp,
): boolean {
  const prev = state.reportsByReporter.get(reporter)?.get(target);
  if (!prev) return true;
  if (prev.revoked) return true; // 抽籤前撤回 → 可再（無懲罰）
  if (prev.outcome === "no-quorum") return true; // 流局 → 可再（沒人投票 ≠ 檢舉不實）
  if (isReportExpired(prev, now)) return true; // 社群未跟進過期 → 可再（無懲罰）
  return false; // 仲裁中 / 已有結果未過期
}
```

**〔MOD-R-024〕** 已終局下架、退役、進入安全港或不存在的 CID 不得再次成為有效檢舉目標。

**〔MOD-R-025〕** 同一對象已有進行中或未過期終局案件時，必須序列化並拒絕重複檢舉。

**〔MOD-R-026〕** 檢舉者超過 rolling 窗口額度時必須拒絕新案。

**〔MOD-R-027〕** 檢舉理由與 target kind 的非法組合必須在表單服務層拒絕。

**表單層擋點**（`canReportAgain` 之外的四道前置檢查，`reportTarget` 拒收）：

```typescript
function canFileReport(
  reporter: PeerId,
  target: CID | PeerId,
  targetKind: "cid" | "peer",
  reason: ReportReason,
  state: ModerationDerivedState,
  now: Timestamp,
): { ok: boolean; reason?: string } {
  // ① 對象終局：CID 已在仲裁黑名單 → 已下架、再告無意義（provider DMCA 案件不進此 gate——與鏈上檢舉平行，信譽系統 §7）；
  //    玩家已在全域黑名單 → 已永 ban、再告白燒 7 席（其名下 CID 仍可逐一檢舉下架，不受此擋點影響）
  if (targetKind === "cid" && state.blacklist.has(target as CID))
    return { ok: false, reason: "該 UGC 已下架" };
  if (targetKind === "peer" && state.peerBlacklist.has(target as PeerId))
    return { ok: false, reason: "該玩家已在全域黑名單" };
  // ② 同對象序列化：已有開放案（未撤回 / 未過期 / 尚無 outcome）→ 拒——防同一事件 k 案 pile-on（k× 扣分 + k 記三振）
  if (
    (state.pendingReports.get(target) ?? []).some(
      (r) => !r.revoked && !r.outcome && !isReportExpired(r, now),
    )
  )
    return { ok: false, reason: "該對象已有審理中檢舉" };
  if (targetKind === "cid" && state.ugc.similarityPending.has(target as CID))
    return { ok: false, reason: "該作品相似度審查中（上傳期案，§5.7）" };
  // ③ 檢舉者額度：同時開放案 ≥ REPORT_OPEN_MAX_PER_REPORTER（3，個人上限）→ 拒——防仲裁注意力洪水（每案燒 7 席）
  if (countOpenReportsOf(reporter, state, now) >= REPORT_OPEN_MAX_PER_REPORTER)
    return { ok: false, reason: "同時檢舉數已達上限，請待現有案件結案" };
  // ④ reason × targetKind 合法組合：版權 → cid / 騷擾 → peer / 內容不當 → cid / 其他 → 皆可；且 cid 需存在（ugcRecords 可解析作者）
  if (!isValidReasonTarget(reason, targetKind))
    return { ok: false, reason: "檢舉類型與對象不符" };
  return canReportAgain(reporter, target, state, now)
    ? { ok: true }
    : { ok: false, reason: "你對該對象已有檢舉紀錄（審理中或已有結果）" };
}
// 合法組合：copyright-violation → cid｜griefing → peer｜inappropriate-content → cid｜other → cid + peer
```

擋點皆純 derive 可判（任何 peer 收到 `ReportEvent` 時同規則驗證、不符拒收）。② 的副作用「自佔告位」（用小號先告自己拖延真檢舉）：每輪只拖數天、燒小號檢舉準確率（−30）與負資產成本，playtest 觀察即可。

## 5. 純仲裁觸發（黑名單 / 信譽懲罰唯一路徑）

> **設計決定**：所有檢舉一律走仲裁，**沒有「加權檢舉數 ≥ N 直接黑名單」的快速路徑**。理由：直接門檻有「N 人串謀直接下架」風險；隨機抽合格仲裁者投票較抗串謀。

### 5.1 合格仲裁者

四條門檻（信譽 ≥ 200 / 比賽 ≥ 10 / 註冊 ≥ 30 天 / 非全域黑名單）權威見 [信譽系統.md §8.1](../信譽系統.md)。

```typescript
// state / at 一律取「抽籤檢查點」快照（§5.2）——投票期間信譽變動不影響本案資格與 weight
function isQualifiedArbiter(
  peer: PeerId,
  report: ReportEvent,
  state: DerivedState,
  at: Timestamp,
): boolean {
  const offender =
    report.targetKind === "cid" // 責任人：UGC 案先解析作者，再做本人排除 / 共賽過濾
      ? state.ugc.ugcRecords.get(report.target as CID)?.author
      : (report.target as PeerId);
  if (peer === report.reporter || peer === offender) return false; // 兩造本人不入面板
  if (state.moderation.peerBlacklist.has(peer)) return false; // 全域黑名單者不入池（且其連不上 mesh，抽到＝白燒席位）
  const rep = getEffectiveScore(peer, state.reputation, at); // 保護後分數（reputation.md §4 讀點契約）
  if (rep < 200) return false; // 信譽門檻
  if ((state.reputation.matchCount.get(peer) ?? 0) < 10) return false; // 比賽場數
  const days =
    (at - (state.reputation.registeredAt.get(peer) ?? at)) / (1000 * 86400);
  if (days < 30) return false; // 帳號年資（防 Sybil，與 7 天新手保護無關；registeredAt 定義見 ledger.md §6）
  if (
    hadRecentSharedMatch(peer, report.reporter, at) || // 與檢舉者 / 責任人最近 24h 無共同比賽（防報復串）
    (offender && hadRecentSharedMatch(peer, offender, at))
  )
    return false;
  return true;
}
```

### 5.2 隨機抽選（跨 peer deterministic）

**〔MOD-R-028〕** 仲裁面板必須以 `hash(reportId + 抽籤檢查點 timestamp)` 對 canonical 合格池決定性抽選 7 人。

**〔MOD-R-029〕** 仲裁資格與投票 weight 一律取該輪抽籤檢查點的 `DerivedState` 快照，投票期間的信譽變動不得改變本案。

抽籤點 = 檢舉後首個滿 24h 的帳本檢查點（[§4](#4-撤回抽籤前-重新檢舉) 撤回窗以此為界）；`ARBITRATION_PANEL_SIZE = 7`（[程式參數.md](../程式參數.md)，protocol 常數、非治理 config）。合格池 < 7 → 流局（寫 `result: 'no-quorum'` 結果事件、`arbiters: []`，[§5.3](#53-加權計票)／[§5.6](#56-結果事件寫入與驗證permissionless--全網驗算)；同對象可立即再檢舉——池未成長前再告仍會流局）。

### 5.3 加權計票

**〔MOD-R-030〕** **票集合（tally 的輸入，全網同規則、決定性）**：

1. **面板過濾**：只計**該輪面板成員**的票（[§5.2](#52-隨機抽選跨-peer-deterministic) 抽出的 7 人；重抽輪 = 重抽面板）——非面板票不入 tally
2. **窗口**：只計 deterministic fold 序在「該輪抽籤點之後、該輪期滿檢查點 `log_head_cids` frontier 之前」的票
3. **每人一票**：同一 arbiter 多筆 → 取窗內 log 序**最後一筆**（窗內可改票）
4. **重抽輪不沿用**：第一輪的票作廢（新面板新計票；第一輪投過票者若再中籤須重投）

**〔MOD-R-031〕** `arbitration-vote` admission 必須排除檢舉者與責任人兩造的票。

**〔MOD-R-032〕** `arbitration-vote` admission 必須拒絕抽籤下界前、明確超出容許上界或已撤回案件的票。

精確面板與窗口需要檢查點時間線、抽籤點資格快照及重抽缺席集，面板資格不在同步收件驗，**面板過濾由 tally 終判**（上列票集合規則）。

```typescript
// 全整數共識計算：weightX100 = ARBITRATION_WEIGHT_X100_TABLE[rep]（預算表；浮點 log10 跨硬體不一致、禁入共識，算式表 §17）
// state = 抽籤檢查點快照（§5.2）、drawAt = 該輪抽籤檢查點 timestamp；votes = 上述「票集合」（面板過濾 + 窗口 + 每人取最後一筆之後）
function tallyArbitration(
  votes: ArbitrationVoteEvent[],
  state: DerivedState,
  drawAt: Timestamp,
): { result: "pass" | "reject"; passRatioX100: number } {
  let passW = 0,
    denomW = 0;
  for (const v of votes) {
    if (v.vote === "abstain") continue; // 棄權不計入分母
    const w = arbitrationVoteWeightX100(
      getEffectiveScore(v.arbiter, state.reputation, drawAt),
    ); // 整數 weightX100（保護後分數），見 reputation.md §6.1 / §4
    denomW += w;
    if (v.vote === "pass") passW += w;
  }
  const pass = passW * 100 > denomW * ARBITRATION_PASS_THRESHOLD_PCT; // current 60；整數交叉相乘、無除法捨入
  const passRatioX100 = denomW > 0 ? Math.floor((passW * 100) / denomW) : 0; // 事件記錄欄位（整數除法 deterministic）
  return { result: pass ? "pass" : "reject", passRatioX100 };
}
```

**〔MOD-R-033〕** **投票期滿** = 抽籤點起首個 timestamp ≥ 抽籤點 + `ARBITRATION_VOTE_WINDOW_HOURS`（72，待 playtest 校準）的帳本檢查點；該檢查點兼任重抽 seed。重抽輪期滿自重抽檢查點重新起算。

**〔MOD-R-034〕** Quorum 固定為 4 張有效票；pass 與 reject 計入，棄權不計。

**〔MOD-R-035〕** 達 quorum 後以整數權重計票，pass 權重必須嚴格大於有效票總權重的 60% 才通過。

投票期滿有效票 < 4 → 重抽一輪（新檢查點 seed、**排除第一輪缺席者**；`ARBITRATION_REDRAW_MAX = 1`）；第二輪仍 < 4 → **流局**（非 reject、不進準確率、同對象可再檢舉）——**寫 `result: 'no-quorum'` 結果事件**（任一 peer 可寫 ＋ 全網驗算同 [§5.6](#56-結果事件寫入與驗證permissionless--全網驗算)）。流局不能只靠讀點 derive：`outcome` 入 state 需事件觸發 fold（否則流局案卡 open、同對象序列化擋點誤鎖再告 90 天），且上傳期案流局要解除 `similarity-pending`——**經濟共識值的變化必須由事件觸發**（結算過濾吃它，讀點 derive 會把檢查點時間線 ＋ 票集合拖進 economy 驗算路徑）。事件語意 ＝「仲裁程序已走完、未達 quorum」的可驗算程序事實（零 delta、零準確率足跡，[§5.4](#54-結果套用)）。加權因合格門檻（信譽 ≥ 200 → weight ∈ [2.32, 3.00]）面板內差距 ≤ 1.29×，近似人頭（見 [檢舉與仲裁.md §5/§6.3](../流程/檢舉與仲裁.md)）。

### 5.4 結果套用

**〔MOD-R-036〕** 罰則**依檢舉類型、不依 target 種類**（數值權威 [信譽系統.md §2.3](../信譽系統.md)；derive 函式見 [reputation.md §5.4](reputation.md)）：

```typescript
// arbitration-result = 'pass'：
//   target=cid → BlacklistEvent（下架）＋作者信譽扣分（違反版權含剽竊 −100 / 內容不當·其他 −20 = ugc-blacklisted）
//   target=peer → 信譽扣分（騷擾·其他 −20 = griefing；違反版權含剽竊 −100）
//   檢舉者信譽 +10（reason report-success、derive）
//   reportAccuracy[reporter].{reports, successful} += 1
// arbitration-result = 'reject'：
//   無懲罰；reportAccuracy[reporter].reports += 1（未成功）→ 餵 checkMaliciousReporter（見 reputation.md §5.3）
// arbitration-result = 'no-quorum'（流局）/ 抽籤前撤回：
//   零 delta、不進 reportAccuracy（沒人投票 / 主動收回 ≠ 檢舉不實）；流局只落 outcome
//   （解除同對象序列化擋點）、上傳期案 = 解除 similarity-pending（不計安全港）
```

黑名單觸發後注入 peer-discovery PeerScore；gossip／publish／graylist 三個原生門檻只讀 [network.md §10](../程式參數/network.md#10-networkpeer-discovery節點發現) 的具名常數，注入實作見 [peer-discovery.md](peer-discovery.md)。

### 5.5 玩家全域黑名單（純 derive 三振，無獨立事件）

**〔MOD-R-037〕** 同一責任人累積三次仲裁定罪後，必須由 fold 決定性推導為永久全域玩家黑名單：

```typescript
// 同一 peer 作為「責任人」（被檢舉玩家本人、或被定罪 UGC 的作者）的仲裁定罪（result='pass'）
// 累積 ≥ GLOBAL_PEER_BLACKLIST_STRIKES（3，protocol.md §5）→ peerBlacklist（純推導、任何 peer 重算一致；永久，新 PeerId 不繼承資產）
function deriveGlobalPeerBlacklist(
  convictionsByOffender: ReadonlyMap<PeerId, number>,
): ReadonlySet<PeerId> {
  return new Set(
    [...convictionsByOffender]
      .filter(([, n]) => n >= GLOBAL_PEER_BLACKLIST_STRIKES)
      .map(([p]) => p),
  );
}
```

玩家全域黑名單是純 derive，沒有獨立 `ModerationActionEvent`，因此也不需要為衍生結果指定簽署者。DMCA Repeat Infringer **不進三振**（provider 案件不在帳本、不可 derive），由各 pinning provider 對自己的供應出口拒服務承接（[dmca.md §5](dmca.md)）。

### 5.6 結果事件寫入與驗證（permissionless + 全網驗算）

**〔MOD-R-038〕** `ArbitrationResultEvent` / `BlacklistEvent` **任一 peer 可寫**（無指定寫入者——通常由期滿檢查點的 proposer 順手寫，但非義務）；防偽不靠寫入者身分、靠**全網驗算**（票已上鏈、結果人人可重算）：

`appendEvent` 收件驗證（`arbitration-result`）＝ **shape＋冪等＋案錨摘要＋panel-signature-set**（live 與 fold 同組判定 ＝ 無分叉），任一條不符即拒收：

1. **〔MOD-R-039〕** `reportEventId` 指向存在且**未撤回、尚無結果**的開放案錨（canonical caseId 反查）；**事件內案錨摘要（caseKind / reporter / target / targetKind / reason / anchoredAt）與案錨事件逐位一致**（[§1](#1-事件結構) 純函數性補欄——fold 另以摘要對 state 案錄比對守門：開放案存在 ／ 未撤回 ／ 無結果 ／ 摘要相符，不符 no-op）
2. **〔MOD-R-040〕** `timestamp` ≥ **程序下界**（面板案 ≥ 案錨 ＋ 抽籤延遲 ＋ 投票窗；池不足流局 ≥ 案錨 ＋ 抽籤延遲——與 fold 恆驗同式，硬化段）
3. **〔MOD-R-041〕** `arbiters` **長度合法**（面板案 = `ARBITRATION_PANEL_SIZE`(7)；池不足流局 = `[]`）
4. **〔MOD-R-042〕** **panel-signature-set**：≥ quorum 面板 attestation——distinct、∈ `arbiters`、非兩造、簽章對 `(reportEventId, target, result, passRatioX100)` digest 有效。**期滿等值／面板重導／tally 全量重算由 attestation 流程承擔**：每位面板成員各自 replay 票序列後只簽自己算出的結果，簽章集背書下與逐條重算等效
5. **〔MOD-R-043〕** 同 `reportEventId` 已有結果事件 → 拒收（**首筆有效**；並行寫入的競合由 ledger fork resolution 收斂，[ledger-checkpoint.md §4](ledger-checkpoint.md)）

**〔MOD-R-044〕** `BlacklistEvent`：`triggeredBy` 必須指向 `result: 'pass'` 且 `targetKind: 'cid'` 的結果事件（**不得指向 no-quorum**）；同 `cid` 去重（首筆有效）。`result: 'no-quorum'`：**票不足流局**（面板存在）＝ 條 4 同適用（末輪面板足額 attest）；**池不足流局**（`arbiters: []`、無面板可簽）＝ 條 4 改驗**合格池上界 < 7**（僅穩定 ／ 單調欄位計數，硬化段）。

> 對照：`MatchResultEvent` 靠完賽者多簽（參與者集合明確）；仲裁結果的「參與者」是全網（票公開），故用驗算取代多簽——與純 derive 哲學一致、零新增信任假設。

> **panel-signature-set 驗證（`src/moderation/attestation.ts`）**：上列 ①–⑤ 同時適用於 `appendEvent` 的 live 收件與 `applyArbitrationResult` 的 timeless fold。因 log AC 為 `write:['*']` 且歷史同步不重跑 live admission，`panelSignatures`（[§1](#1-事件結構)）必須讓結果在 fold 中自證：
>
> - **〔MOD-R-045〕** **digest**＝`signingDigest({type:'arbitration-result-attest', reportEventId, target, result, passRatioX100})`（域分離標籤防跨用途重放；`target` 綁定防同 caseId 跨標的簽章轉移。`reportEventId` 已含 `#${target}`、digest 再顯式帶 target＝ 雙重綁定；實作即權威）。
> - **attestation 語意 ＝ 條 ④ 分散化**：每位面板成員以 coordinator replay 票序列、**只簽自己算出的結果**——結果事件的簽章集即 ≥ quorum 份獨立驗算證明；聲稱值與成員自算不符時該成員簽出的 digest 自然對不上。timestamp 不入 digest（改動無實質攻擊值、由程序下界 ＋ 首筆有效約束）。
> - **〔MOD-R-046〕** **fold 驗**：面板案（pass／reject／ 票不足流局）＝`arbiters.length = 7`、簽章集 ≥ quorum(4)——distinct、∈ `arbiters`、**非兩造**（reporter＋cid 案作者 ／peer 案本人；上傳期案相似對象作者群不在 state、不入 fold 必要條件）、**逐 signer 穩定必要條件**（年資 `registeredAt ≤ 抽籤點 − 30 天`＝timeless 精確；場數 ≥ 10＝ 單調遞增必要條件）、簽章有效。信譽 ≥ 200／ 共賽過濾非單調、不入 fold（收件全量驗算 ＋attestation 承擔）——「可重導面板」的完整重導對 fold 位置 state 為近似（抽籤點與結果間的事件會挪動資格），故 fold 取**對合法結果永不誤拒**的必要條件子集。
> - **池不足流局**（`arbiters: []`、無面板可簽）＝ 限 `result:'no-quorum'`、改驗**合格池上界** ＜ 7（只用穩定 ／ 單調欄位計數 ＝ 上界 ≥ 抽籤時真池數、偽造不誤放；fold 位置 state ≈ 事發當時歷史真值——所有 peer replay 同一 log 前綴得同一判定）。
> - **timestamp 程序下界**：面板案 ≥ 案錨 ＋ 抽籤延遲 ＋ 投票窗、池不足 ≥ 案錨 ＋ 抽籤延遲——早於程序可能完成時點的預埋條目直接無效。
>
> 仲裁者本就簽自己的票、面板簽章集非新增信任假設、僅使結果於 fold **自證**（免於 fold 載入全票重算）。attestation 為期滿後的**機械事實簽署**（client 自動 replay 自動簽、無需人工判斷——與投票的人工審查不同），故票不足流局也由末輪面板足額 attest；蒐集無時窗（成員上線即補簽）。

### 5.7 上傳期仲裁案（similarity-pending）

灰區上傳（70–90% 相似宣告；含對「仲裁判抄下架品」的 ≥90 降級命中，[anti-piracy.md §5.1](anti-piracy.md) 分層）走同一套仲裁機器，差異僅案錨與後果：

- **〔MOD-R-047〕** **案錨 = 含 `similarityMatches` 宣告的 `UgcUploadEvent`**（**在鏈上**；無 `ReportEvent`、無檢舉者、無 reporter delta）。抽籤點 / 投票期 / 票集合 / 快照 / 結果事件全網驗算全同 [§5.1](#51-合格仲裁者)–[§5.6](#56-結果事件寫入與驗證permissionless--全網驗算)；`ArbitrationResultEvent.reportEventId` 此時指向該上傳事件（[§5.6](#56-結果事件寫入與驗證permissionless--全網驗算) 收件驗證第 1 條對應改驗「指向含相似宣告的上傳事件——`upload:<cid>` 案錨、pending 中」；時序由條 2 程序下界約束）。
- **兩造** = 上傳者 ＋ 相似對象作者（CID 先解析作者，逐案排除同 [§5.1](#51-合格仲裁者)）。
- **〔MOD-R-048〕** **結果**：`pass`（判抄）→ pending CID 寫 `BlacklistEvent` 下架、**不扣信譽**（灰區撞衫可能），並累積該上傳者的**安全港次數閘**（rolling 30 天 ≥ 3 → pending 通道暫停 30 天，[anti-piracy.md §5.1](anti-piracy.md)）；`reject`（判非抄）或**流局**（no-quorum）→ 解除 `similarity-pending`、經濟開始。**皆不進任何人準確率統計**。
- pending 語意與經濟隔離見 [anti-piracy.md §5.1](anti-piracy.md)。

**≥90 拒收無獨立申訴案型**——案錨必須在鏈上（被拒上傳不在 ledger，[§5.6](#56-結果事件寫入與驗證permissionless--全網驗算) 條 1 無從驗算、fold 無從解析）。**正主救濟路徑 = 組合既有機器**：① 標準檢舉命中對象（違反版權 → 仲裁下架 `BlacklistEvent`＋ 盜版者 −100）→ ② 再上傳——對「仲裁判抄下架品」的 ≥90 命中依 [anti-piracy.md §5.1](anti-piracy.md) 分層**降級 pending**（不硬擋）→ 走本節上傳期案（判非抄 / 流局 → 經濟開始）。逐位元相同的 mesh 無法復刻上鏈（exact 命中硬擋 ＋ 原 CID 已永久黑名單、事件溯源不復活）——正主需做有實質差異的重新輸出（content-addressing 本質限制）。Provider DMCA 案件不加入 similarity 比對對象或 client 全域 gate；其爭議只在同一 provider 的反通知流程處理（[dmca.md](dmca.md)）。

## 6. 黑名單與經濟整合（擋未來、不回收歷史）

| 行為                           | 規則                                                                |
| ------------------------------ | ------------------------------------------------------------------- |
| **〔MOD-R-049〕** 既有玩家餘額 | **不變動**（過去鑄幣保留）                                          |
| 過去鑄幣事件                   | **不撤銷**（事件溯源不可篡改）                                      |
| 未來該 UGC 觸發的鑄幣          | **擋下**（computeMatchSettlement 過濾黑名單 → 不產生 RoyaltyShare） |
| 該 UGC 後續被使用              | **擋下**（`formal-race` context 拒收）                              |

不回收歷史鑄幣的理由：事件溯源不可篡改 + 既得權益保護 + 避免「幣永遠可能被回收」的長期不確定性 + 黑名單本身（下架 + 依檢舉類型 −20／−100；上傳期案 0）已是強懲罰。

economy 結算過濾點（見 [economy.md](economy.md) `computeMatchSettlement`）：

```typescript
// collectAllUgcUsedInMatch 已濾 builtin:* / local:*（見 ledger.md）
const ugcsUsed = Array.from(collectAllUgcUsedInMatch(match)).filter(
  (cid) => !state.moderation.blacklist.has(cid),
); // 再濾黑名單 → 不再 mint 創作回饋金
```

## 7. Fork 鏈中的黑名單作品（不向下傳染）

A → B（parent=A），A 進黑名單：

| 場景                                    | 規則                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------- |
| **〔MOD-R-050〕** A 黑名單後 B 仍被使用 | B 的 royalty 照舊（B 作者 70% + A 作者 20%，即使 A 在黑名單）                       |
| A 黑名單後 B 被檢舉成立                 | B 也進黑名單，B 的未來 royalty 才停                                                 |
| 黑名單向下傳染？                        | **不傳染**（避免連坐；分潤跟血緣、與可用性狀態正交，見 [版權.md §3.4](../版權.md)） |

A 作者仍領 20%（即使 A 黑名單）是刻意設計：單一作品黑名單不應抹消衍生鏈歷史貢獻；多作品連續定罪由信譽扣分累積壓力 + **三振硬停**（定罪 ≥ 3 → 全域玩家黑名單，[§5.5](#55-玩家全域黑名單純-derive-三振無獨立事件)）。

## 8. 執行邊界檢查（黑名單 vs 退役）

**〔MOD-R-051〕** `canUseUgc` 必須分別以 `blacklisted` 或 `retired` 原因拒絕不可用內容，且不承載 UI 文案：

```typescript
// 實作形（src/moderation/use-gate.ts）：canUseUgc(cid, context, state: DerivedState, now)
// —— 退役＝deriveRetireStatus 完整 derive（含自動退役、epoch 化 config；now＝共識可決值）；
// 回 { allowed, cause: 'blacklisted'|'retired'|null }。Provider DMCA 案件不進 client use-gate。
// ＝零文案（顯示字串歸 UI i18n `ugcUse.<cause>.<context>`）。下方為語意矩陣草圖：
function canUseUgc(
  cid: CID,
  context: "new-assembly" | "existing-vehicle" | "formal-race" | "local-test",
  modState: ModerationDerivedState,
  ugcState: UgcDerivedState,
): { allowed: boolean; warning: string | null } {
  const blacklisted = modState.blacklist.has(cid);

  const retired = ugcState.ugcRecords.get(cid)?.retired ?? false; // 退役 derive 見 ledger.md P5
  if (!blacklisted && !retired) return { allowed: true, warning: null };

  if (blacklisted)
    switch (
      context // 黑名單優先（懲罰性）
    ) {
      case "new-assembly":
        return { allowed: false, warning: "此 UGC 已被黑名單，無法選用" };
      case "existing-vehicle":
        return {
          allowed: true,
          warning: "車輛含已下架 UGC（既有組裝不強制變更）",
        };
      case "formal-race":
        return {
          allowed: false,
          warning: "車輛含黑名單 UGC，無法參加正式比賽",
        };
      case "local-test":
        return { allowed: true, warning: "此 UGC 已下架，僅限本機測試" };
    }
  switch (
    context // 退役（非懲罰性、可續租）
  ) {
    case "new-assembly":
      return {
        allowed: false,
        warning: "此 UGC 已歸檔。可由創作者或玩家「續租」激活",
      };
    case "existing-vehicle":
      return { allowed: true, warning: "車輛含已歸檔 UGC（既有組裝可保留）" };
    case "formal-race":
      return {
        allowed: false,
        warning: "車輛含已歸檔 UGC，無法參加正式比賽（觸發續租可重新使用）",
      };
    case "local-test":
      return { allowed: true, warning: "此 UGC 已歸檔，僅限本機測試" };
  }
}
```

Provider DMCA 下架只停止該 provider 自己的 pin／gateway／cluster 供應，不改本矩陣，也不優先
清除玩家本機 cache；本機 bytes 依容量政策自然淘汰，詳見 [dmca.md §3](dmca.md) 與
[D-20260803-04](../decisions/D-20260803-04-Provider-scoped-DMCA與私有簽章收件匣.md)。

| 維度                   | 黑名單                             | 退役                                           |
| ---------------------- | ---------------------------------- | ---------------------------------------------- |
| 觸發                   | 社群檢舉 → 仲裁通過                | 自動 derive（無人用 / 低 rating / 創作者離開） |
| 性質                   | 懲罰性下架                         | 純儲存歸檔                                     |
| **〔MOD-R-052〕** 復活 | 不能（事件溯源）                   | 可（付續租費 → `UgcMaintenanceEvent`）         |
| 信譽連動               | 依檢舉類型 −20／−100；上傳期案為 0 | 不扣分                                         |
| UI                     | 「已下架」紅字                     | 「已歸檔」灰字 + 續租按鈕                      |

## 9. API

```typescript
interface ModerationApi {
  reportTarget(
    target: CID | PeerId,
    reason: ReportReason,
    details?: string,
    evidence?: readonly string[],
  ): Promise<Result<EventId>>; // 先過 canFileReport 四道擋點（§4）；騷擾證據 = 每則各自序列化的 SignedPayload<ChatMessage>（≤16、每則 ≤4096 UTF-8 bytes）
  revokeReport(reportEventId: EventId): Promise<Result<void>>;
  castArbitrationVote(
    reportEventId: EventId,
    vote: "pass" | "reject" | "abstain",
  ): Promise<Result<void>>;
  isBlacklisted(cid: CID): Promise<boolean>;
  isPeerBlacklisted(peerId: PeerId): Promise<boolean>;
  getMyReports(): Promise<ReportInfo[]>;
  getMyAccuracy(): Promise<{
    reports: number;
    successful: number;
    ratio: number;
  }>;
  // no-quorum 同時涵蓋末輪票不足與合格池不足；兩者皆已結案、可立即再檢舉。
  getReportStatus(target: CID | PeerId): Promise<{ pendingReports: number; arbitrationOpen: boolean; result?: 'pass'|'reject'|'no-quorum' }>;
  listBlacklist(
    cursor?: string,
    limit?: number,
  ): Promise<{ cids: CID[]; nextCursor?: string }>;
}
```

## 10. UI 整合

- 聊天面板允許玩家從同一 sender 選取至多 16 則已驗文字訊息，填寫至多 500 字補充說明後提出 `targetKind='peer'`、`reason='griefing'` 的檢舉。
- `fileReport` 必須把 `details` 與 `evidence` 原樣複製進 `ReportEvent`；fold 的 `ReportInfo` 也必須保留兩者，不能只保存 target／reason。
- 仲裁收件匣投影包含 `details` 與每筆 evidence 的 `valid`、`signer`、`messageId`；驗證只依上鏈字串與 PeerId 公鑰離線完成。無效證據仍可顯示為無效，但不得偽裝成已驗證內容。

檢舉按鈕（原因下拉 + 500 字說明）、我的檢舉歷史（含準確率）、黑名單作品「已下架」顯示 —— 詳見 [檢舉與仲裁.md](../流程/檢舉與仲裁.md)。

## 11. 風險與緩解

| 風險                                | 緩解                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 惡意聯合檢舉                        | 純仲裁（隨機抽合格仲裁者）+ 反報復串過濾，取代易串謀的加權門檻                                                                              |
| 惡意檢舉者                          | `checkMaliciousReporter` 三條件（見 reputation.md [§5.3](reputation.md#53-惡意檢舉者判定三條件-and防誤殺applyeventarbitrationresultevent)） |
| 黑名單規模膨脹                      | OrbitDB 索引化查詢                                                                                                                          |
| 跨版本繞過黑名單                    | 主程式 hard-code 嚴格檢查；社群版本若繞過視為 fork                                                                                          |
| 撤回濫用（看風向重骰仲裁者）        | 撤回窗僅到抽籤前（撤回可再告、無懲罰）；抽籤後不可撤（[§4](#4-撤回抽籤前-重新檢舉)）                                                        |
| 檢舉洪水（仲裁注意力 DoS）          | `REPORT_OPEN_MAX_PER_REPORTER`（3，個人同時開放案上限）+ 同對象序列化（[§4](#4-撤回抽籤前-重新檢舉) 表單層擋點）                            |
| 群體 pile-on（同事件 k 案灌爆三振） | 同對象同時僅一開放案（[§4](#4-撤回抽籤前-重新檢舉) 擋點②）；CID / 玩家已黑名單不可再告                                                      |
| 票灌水（非面板 / 重複票攪局 tally） | `arbitration-vote` 收件做兩造排除＋窗界粗篩；精確面板與窗口由 tally 終判，票集合＝面板 × 窗內 × 每人最後一筆（[§5.3](#53-加權計票)）        |
