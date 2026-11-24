---
type: impl
domain: ["共識帳本", "經濟"]
summary: 比賽結果、經濟結算結構與簽章交換協議
authority: null
slug: null
---

# ledger settlement

> 本檔是比賽結果、經濟結算結構與簽章交換協議的實作 authority；總入口見 [ledger.md](ledger.md)。

## 5. 比賽結果與經濟結算結構

```typescript
interface MatchResultEvent extends BaseEvent {
  type: "match-result";
  matchId: string;
  gridProof: StartGridProof; // 完整 commitment/reveal proof，只在外層保存一次
  ranking: PeerId[]; // 總名次（forfeit 者整場壓出回合積分、排末位；N 回合積分加總 + tiebreak；驗算者重算比對，見 算式表 §20.1）
  rounds: RoundResult[]; // 逐回合權威結果（積分 / 總名次由此 derive、不另存）
  roundAnchors: Array<RaceConsensusAnchorEvent | null>; // inline 自包含證書；null＝該場不得鑄幣
  loadouts: Readonly<Record<PeerId, MatchParticipantLoadout>>;
  loadoutSignatures: Readonly<Record<PeerId, Signature>>; // 逐 peer matchId-bound loadout 簽章＝參與證明（收件⓪-loadout 驗、applier 只罰/只評有此者；擋塞人投毒）
  matchRules: MatchRules;
  disconnects: DisconnectInfo[];
  startedAt: Timestamp;
  finishedAt: Timestamp;
  clientVersions: Readonly<Record<PeerId, ClientVersionInfo>>;
  signatures: MatchResultSignature[]; // reason 無關，一律⌊original roster/2⌋+1，覆蓋 disconnects
}
interface RaceConsensusAnchorEvent extends BaseEvent {
  type: "race-consensus-anchor";
  matchId: string;
  gridContextDigest: string; // 綁外層 gridProof context
  gridSeed: string; // 綁外層 gridProof seed
  roundIndex: number;
  frame: number;
  checksum: string;
  presentPeers: PeerId[];
  signatures: MatchResultSignature[];
}
interface RaceLeaveEvent extends BaseEvent {
  type: "race-leave";
  matchId: string;
  roundIndex: number;
  reason: "voluntary"; // 本人單簽，只作用 peerId 本人；不得縮小 MatchResult quorum
}
interface RaceAbortEvidenceEvent extends BaseEvent {
  type: "race-abort-evidence";
  matchId: string;
  reason: "settlement-no-quorum" | "consensus-invalid" | "session-error";
  frameSummaries: Array<{
    roundIndex: number;
    frame: number;
    checksum: string;
  }>;
  receivedMessageDigests: Array<{
    sender: PeerId;
    kind: "leave" | "settlement-reject" | "settlement-cancel" | "checksum";
    digest: string;
  }>;
  observations: Array<{
    roundIndex: number;
    frame: number;
    kind: "peer-left" | "no-quorum" | "desync" | "session-error";
    subject?: PeerId;
  }>;
  anchorConflicts: RaceAnchorConflictEvidence[]; // 至多 1；同 round 互斥 anchor 與交集 signer 證據
  // 標準單簽、陣列各至多 16 且 canonical 排序；零業務 reducer
}
interface RoundResult {
  roundIndex: number; // 0-based
  trackRef: PartRef;
  lapCount: number; // 該回合場地（可與他回合同軌）+ 圈數（linear/open = 1）
  disallowChip?: boolean; // 該回合實際採用的晶片規則；缺省 = false
  endReason: "completed" | "eliminated" | "duration-limit"; // current shape 必寫並納入多簽
  terminalFrame: number; // 該回合最後 canonical frame；inline anchor tail 驗證基準
  ranking: PeerId[]; // 該回合名次（完賽時間 → 圈數 → PeerId）
  finishTimes: Readonly<Record<PeerId, number>>; // ms；DNF = 該回合 durationLimitSec × 1000
  destructionCounts: Readonly<Record<PeerId, number>>; // 完整 roster；直接致毀零件件數，0 亦必填
}
interface MatchEconomySettlement { // DerivedState/MatchRecord 內部結果，不是 LedgerEvent wire schema
  mintEligible: boolean; // 場級資格 = finisherCount ≥ 3、combo 未達 K=5、每回合 inline anchor 皆非 null；false → prizes / royalties 全空、usage 不記
  monthFactorX100: number; // 月軟曲線係數 ×100（fold 由事件位置前態計算）
  comboHash: string; // 24h K=5 組合 hash（完賽者群組、per-match）
  matchPrizes: ReadonlyArray<MatchPrizeShare>; // 依總名次；受月軟曲線 / per-player 上限（經濟系統 §6.1b）
  royalties: ReadonlyArray<RoyaltyShare>; // N 回合所有 track + car UGC 累加去重；70/20/10、24h 同 UGC 去重
}
interface MatchPrizeShare {
  recipient: PeerId;
  amount: bigint;
  rank: number;
} // rank = 完賽者排名（總名次序、forfeit 不佔位）
interface RoyaltyShare {
  recipient: PeerId;
  triggerPlayer: PeerId; // 實際觸發本筆分潤的完賽者；fold 依此更新 (sourceCid, player) 去重錨
  amount: bigint;
  sourceCid: CID;
  forkLineageDepth: 0 | 1 | 2;
}
interface MatchParticipantLoadout {
  peerId: PeerId;
  carRotation: VehicleLoadout[];
} // 長度 = MATCH_ROUND_COUNT（一車 / 回合、可重複用同台）
interface DisconnectInfo {
  peerId: PeerId;
  disconnectedAt: Timestamp;
  reason: "voluntary" | "network";
}
```

**〔LEDGER-R-051〕** **可簽章欄位一律 plain `Record` / array——dag-cbor 對 JS `Map` 往返不對稱**（decode 回 plain object，重編位元組即與簽章時不一致）。

〔ECON-R-048〕 完賽者簽章前只驗自包含 match facts（rounds、loadouts、grid proof、inline anchors 與 roster）；事件不含 payout 或 frontier。金額由每個 peer 在 canonical fold 的同一事件位置，依前態唯一計算，詳見 [economy.md §4](economy.md)。

### `collectAllUgcUsedInMatch`（純函數）

fold 內的 economy（創作回饋金結算與使用量記錄）與 reputation（使用里程碑）需「該場比賽 N 回合用到、且已有上傳紀錄的非公版 UGC CID」：

```typescript
function collectAllUgcUsedInMatch(
  match: Pick<MatchResultEvent, "rounds" | "loadouts">,
  ugcRecords: Pick<ReadonlyMap<CID, UgcRecord>, "has">, // 判定當下的狀態；fold = 該事件位置的前態
): ReadonlySet<CID> {
  const cids = new Set<CID>();
  const addIfUgc = (ref: string) => {
    if (
      !ref.startsWith("builtin:") &&
      !ref.startsWith("local:") &&
      ugcRecords.has(ref as CID) // 無上傳紀錄的 CID 不收
    )
      cids.add(ref as CID);
  };
  for (const r of match.rounds) addIfUgc(r.trackRef); // N 回合各自場地
  for (const loadout of match.loadouts.values())
    for (const car of loadout.carRotation)
      // N 台輪換車
      for (const ref of collectPartRefsFromLoadout(car))
        // chassis/body/motor/battery/chip/tires/rollers/weapon
        addIfUgc(ref);
  return cids;
}
```

- **〔LEDGER-R-053〕** `builtin:*` 過濾 → 公版不算 UGC 使用、不觸發 royalty；`local:*` 過濾 → defense in depth（不該出現在線上賽）；**只收 `ugcRecords` 已有上傳紀錄的 CID** → 事件引用但帳本上沒有上傳紀錄的 CID 不計入使用量、創作回饋金與使用里程碑。
- **「已有上傳紀錄」以判定當下的狀態為準**：fold 讀該 `MatchResultEvent` 位置的前態，所有節點在同一位置得到同一結果。上傳事件排在比賽結果事件之後時，該場不為這個 CID 記任何使用；上傳之後的比賽才開始累計，不回補先前的場次。比賽結果事件引用的是自報的 CID，作品是否存在只能由帳本上的上傳紀錄認定（[D-20261123-02](../decisions/D-20261123-02-使用量與回饋金只計已有上傳紀錄的CID.md)）。
- 這個條件在收集階段執行，早於呼叫端各自的過濾：創作回饋金結算之後再濾黑名單、退役與 `similarity-pending`，使用量記錄之後再濾 `similarity-pending`。這些過濾都是對單一 CID 判定去留、不新增 CID，所以新條件排在最前不改變它們對已有紀錄的 CID 的判定，只是先排除沒有上傳紀錄的 CID。資產升版產生的新版 CID 由升版事件建立紀錄，視同已有上傳紀錄。
- 宣告的資產種類與配裝格位是否相符不在此比對：種類是上傳者自報，比對不能提高偽造成本（同上決策）。
- **Set 去重 → 同一軌 / 同一台車跨多回合重複用，royalty 只算一次（per-match 去重）**；match 含越多回合 → 自然用到越多**不同** UGC → royalty 累加。
- 純函數，結果只由傳入的事件與 `ugcRecords` 決定。呼叫端分兩類：
  - **fold 內（共識判定）**：economy 的創作回饋金結算與使用量記錄、reputation 的使用里程碑。三者處理同一個 `MatchResultEvent` 時讀到的都是該事件位置前態的上傳紀錄（套用比賽結果事件不改動上傳紀錄），所以取得同一個集合。
  - **介面層（不屬共識判定）**：送出評分而未指定 `useMatchId` 時，以呼叫當下的狀態掃本機保留的最近比賽，找一場填入稽核欄（[ugc-rating.md §8](ugc-rating.md)）。這裡讀的不是各場事件位置的前態，作品上傳前引用它的場次也會被找到；找到的場不代表評分資格。
- moderation 與 ugc-rating 的 fold 不呼叫本函式：黑名單由 economy 結算對本函式的結果再過濾（[moderation.md §6](moderation.md)）；評分資格只讀使用量的 `uniqueUsers`（[ugc-rating.md §4](ugc-rating.md)），因使用量只為已有上傳紀錄的 CID 累計而受同一條件約束。
- loadout 欄位用 `chip`。

### 比賽結算簽章交換協議（實作）

**〔LEDGER-R-052〕** 完賽 → 主 peer 組裝自包含 match-facts candidate → 完賽者各自核對 → `⌊N/2⌋+1` 簽章 → 寫 ledger。candidate 不含 payout 或經濟 frontier；結算計算只在 canonical fold 發生（[economy.md §4](economy.md)）。

```typescript
// 透過既有 RaceMesh ordered control DataChannel 的 app-control bus 在參賽者間交換
// （DAG-CBOR、固定 roster 驗來源）；不新增 GossipSub topic，也不寫 ledger，最終 MatchResultEvent 才寫
interface SettlementProposalMessage {
  type: "settlement-proposal";
  matchId: string;
  candidate: Omit<MatchResultEvent, "signatures">;
  proposerSignature: MatchResultSignature; // 主 peer 自簽（算進 quorum）
}
interface SettlementSignatureMessage {
  type: "settlement-signature";
  matchId: string;
  candidateHash: string;
  signature: MatchResultSignature;
}
interface SettlementRejectMessage {
  type: "settlement-reject";
  matchId: string;
  candidateHash: string;
  reason: string;
  rejecter: PeerId;
  transient?: boolean;
}
interface SettlementTakeoverMessage {
  // 主 peer 中斷時任一完賽者接手
  type: "settlement-takeover";
  matchId: string;
  newProposer: PeerId;
  reusedCandidateHash: string;
  collectedSignatures: ReadonlyArray<MatchResultSignature>; // 接手前已收集簽章（接收者逐一驗證）
  proposedAt: Timestamp; // takeover 等候窗起點
}
interface SettlementCancelMessage {
  // 收集端裁定不可能湊滿（決定性拒簽者過多）＝主動終局：全員即刻收攤、免等滿窗
  type: "settlement-cancel";
  matchId: string;
  candidateHash: string;
  reason: string;
  canceller: PeerId;
}
// candidateHash = signingDigest(candidate)＝sha256(serializeForSigning(candidate))；所有訊息引用同一 hash 確保版本對齊

// 主 peer：只建比賽事實 candidate + 自簽
async function buildMatchResultCandidate(
  ctx: MatchContext,
  deps: SettlementSignerDeps,
): Promise<{
  candidate: Omit<MatchResultEvent, "signatures">;
  proposerSignature: MatchResultSignature;
}> {
  const now = deps.now();
  const base = {
    type: "match-result" as const,
    matchId: ctx.matchId,
    gridProof: ctx.gridProof,
    ranking: deriveTotalRanking(ctx.rounds, ctx.disconnects),
    rounds: ctx.rounds,
    roundAnchors: ctx.roundAnchors,
    loadouts: mapToPlainRecord(ctx.submittedLoadouts), // 可簽章欄位＝plain Record（上方鐵則）
    loadoutSignatures: mapToPlainRecord(ctx.loadoutSignatures),
    matchRules: ctx.matchRules,
    disconnects: ctx.disconnects,
    startedAt: ctx.startedAt,
    finishedAt: now,
    timestamp: now,
    clientVersions: mapToPlainRecord(ctx.clientVersions),
    peerId: deps.getPeerId(),
    signature: new Uint8Array(0),
  };
  const candidate = base;
  const sig = await deps.sign(ledgerSigningDigest(deps.ledgerAddress, candidate));
  return {
    candidate,
    proposerSignature: { signer: deps.getPeerId(), sig },
  };
}

// 完賽者：驗證提案者、總名次與本機 match facts 後簽章
async function reviewAndSignMatchResult(
  msg: SettlementProposalMessage,
  deps: SettlementSignerDeps,
  localChecks?: MatchFactChecks,
): Promise<Result<MatchResultSignature>> {
  const me = deps.getPeerId();
  const { candidate, proposerSignature } = msg;
  if (
    !candidate.ranking.includes(me) ||
    candidate.disconnects.some((d) => d.peerId === me)
  )
    return error("非完賽者不可簽章"); // 非 forfeit 完賽者才可簽（收件 gate ① 同規則）
  if (proposerSignature.signer !== candidate.peerId)
    return error("proposerSignature.signer 與 candidate.peerId 不一致");
  if (
    !(await deps.verify(
      ledgerSigningDigest(deps.ledgerAddress, candidate),
      proposerSignature.sig,
      proposerSignature.signer,
    ))
  )
    return error("proposerSignature 無效");
  // 多回合 consensus-critical 檢核（防主 peer 偽造）：
  //   ① rounds[] 各回合 ranking / finishTimes / destructionCounts 與本機賽內觀測一致（每回合 deterministic 物理、各 peer 自有結果）
  //   ② inline anchors 與本機收集證書一致
  //   ③ loadouts / matchRules 與賽前提交一致
  // ② 總名次防偽：candidate.ranking 須等於由 rounds[]＋disconnects 重算的總名次（算式表 §20.1 `deriveTotalRanking`）
  const recomputed = deriveTotalRanking(candidate.rounds, candidate.disconnects);
  if (
    candidate.ranking.length !== recomputed.length ||
    candidate.ranking.some((p, i) => p !== recomputed[i])
  )
    return error("總名次與回合積分重算不符");
  if (localChecks?.verifyRounds && !localChecks.verifyRounds(candidate.rounds))
    return error("rounds 與本機觀測不符");
  if (localChecks?.verifyRoundAnchors && !localChecks.verifyRoundAnchors(candidate.roundAnchors))
    return error("roundAnchors 與本機證書不符");
  if (localChecks?.verifyLoadouts && !localChecks.verifyLoadouts(candidate.loadouts))
    return error("loadouts 與賽前提交不符");
  return ok({
    signer: me,
    sig: await deps.sign(ledgerSigningDigest(deps.ledgerAddress, candidate)),
  });
}
```

`MatchContext` = `{ matchId; config: MatchConfig; submittedLoadouts: ReadonlyMap<PeerId, MatchParticipantLoadout>; loadoutSignatures: ReadonlyMap<PeerId, Signature>; rounds: RoundResult[]; startedAt; disconnects }`（賽前 loadout 收集見 [matchmaking.md §5](matchmaking.md)；`loadoutSignatures`＝loadout 交換時收集的 matchId-bound 參與證明、隨結算入事件；`rounds` 隨每回合完成累積）。各回合 `trackRef` / `lapCount` 從 `config.rounds[i]` 取、materialize 進 `RoundResult`，不在事件頂層重複。
