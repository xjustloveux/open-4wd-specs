---
type: impl
domain: ["比賽房間"]
summary: Rollback Netcode／InputBuffer 預測／checksum 去同步／重連
authority: null
slug: null
---
# network-sync（Rollback Netcode 實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/network-sync.md](程式流程/network-sync.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：賽內 P2P 同步的**實作層** —— Rollback Netcode（input 預測 + 回滾）、StateBuffer、checksum 去同步偵測、DataChannel 二進位序列化、中途斷線 / 重連。
> 賽內同步設計見 [賽內機制.md §2](../賽內機制.md)；回合共識錨見 [資料系統.md §6](../資料系統.md)；簽章見 [key-manager.md](key-manager.md)。對應 `src/network-sync/`。

> **checksum（本檔）≠ 回合共識錨**：本檔的 rollback checksum 每 120 frame 在 peer 間投票、ephemeral；`RaceConsensusAnchorEvent` 只在回合終局，把本機仍保留且已 final 的尾窗 checksum 形成嚴格多數證書，之後 inline 進唯一 `MatchResultEvent` 才寫 ledger（[賽內機制.md §2.3](../賽內機制.md)）。本檔以下「checksum」一律指 rollback checksum。

## 1. 訊息類型

```typescript
type NetworkMessage =
  | {
      type: "input";
      frame: number;
      events: InputEvent[];
      sender: PeerId;
      signature: Signature;
    } // 高頻：frame＝排程幀（取樣幀 c＋D）；Race Sign Key 簽、nonce = frame（§6 wire `[sig:64]`）
  | {
      type: "checksum";
      frame: number;
      hash: string;
      sender: PeerId;
      signature: Signature;
    } // rollback checksum（非 ledger anchor）；簽章同上
  | {
      type: "sync-probe-request";
      requestId: number;
      target: PeerId;
      sender: PeerId;
    }
  | {
      type: "sync-probe-response";
      requestId: number;
      candidates: ReadonlyArray<{ frame: number; hash: string }>;
      target: PeerId;
      sender: PeerId;
    }
  | {
      type: "sync-request";
      requestId: number;
      offerId: number;
      targetFrame: number;
      targetHash: string;
      target: PeerId;
      sender: PeerId;
    }
  | {
      type: "sync-response";
      requestId: number;
      snapshot: SerializedSnapshot;
      frame: number;
      inputLog: SyncInputLog | null; // provider 簽章輸入日誌（§7.1）；逐筆驗簽失敗＝null
      target: PeerId;
      sender: PeerId;
    }
  | {
      type: "sync-response-receiving";
      requestId: number;
      target: PeerId;
      sender: PeerId;
    } // 內部訊息（非 wire）：等待中的 sync-response 分段傳輸又收到一段（§7.1 第 4 步）
  | {
      type: "sync-response-arrived";
      requestId: number;
      target: PeerId;
      sender: PeerId;
      transferMs?: number; // 本機量得的快照傳輸時間（毫秒，§6.1）；未分段時省略
    } // 內部訊息（非 wire）：sync-response 外層簽章已驗、日誌仍在驗簽（§7.1 第 4 步）
  | {
      type: "leave";
      reason: "voluntary" | "disconnect" | "desync";
      sender: PeerId;
    }; // control 通道離場通知：對端只記斷線（forfeit），不影響回合終局（§7.4）

// probe / sync-request / sync-response 皆走 Race Sign Key；簽章涵蓋 correlation/offer candidates/frame/hash/target/snapshot/inputLog 與 raceId。
// sender 不信任 payload 自陳值，由 RoundTransport 保留實際 DataChannel 來源後注入。
```

賽內每個 `input` 訊息帶 Ed25519 簽章（**Race Sign Key**，[key-manager.md §10](key-manager.md)）＋ nonce ＋ timestamp（防偽造，[資安規範.md §3.2](../資安規範.md)、[security.md §2](security.md)）——**nonce 語意 = `frame`**（單調不重複）、timestamp 由 frame 推得，故 wire 格式只需附 `[sig:64]`（[§6](#6-datachannel-二進位序列化)）。`frame` 是**排程幀**：本機在 local frame c 取樣的事件以 c＋D 送出與簽章（D＝`INPUT_DELAY_FRAMES`，[§2](#2-input-buffer預測)）。

`events` 的元素是技能觸發或流內離場（`{ type: "leave" }`），型別見 [interfaces.md §3](interfaces.md)。leave 必須單獨成幀，與其他事件一樣受簽章涵蓋；主動離場的時序見 [§7.4](#74-主動離場流內-leave)。

```typescript
interface SignedInputEntry { peer: PeerId; frame: number; events: InputEvent[]; signature: Signature } // 原發送者的 input 簽章
interface SyncInputLog { front: number; entries: readonly SignedInputEntry[] } // front＝provider 回應當下的模擬幀
```

## 2. Input Buffer（預測）

```typescript
class InputBuffer {
  private inputs = new Map<PeerId, Map<number, InputEvent[]>>();
  private predictions = new Map<PeerId, Map<number, InputEvent[]>>();

  setInput(
    peer: PeerId,
    frame: number,
    events: InputEvent[],
  ): {
    wasPredicted: boolean;
    predictionWasCorrect: boolean;
    equivocated: boolean;
  } {
    const peerMap = this.inputs.get(peer) ?? new Map();
    const first = peerMap.get(frame);
    if (first)
      return {
        wasPredicted: false,
        predictionWasCorrect: true,
        equivocated: !eventsEqual(first, events),
      };
    const predicted = this.predictions.get(peer)?.get(frame);
    peerMap.set(frame, events);
    this.inputs.set(peer, peerMap);
    return {
      wasPredicted: predicted !== undefined,
      predictionWasCorrect:
        predicted === undefined || eventsEqual(predicted, events),
      equivocated: false,
    };
  }

  getInputsForFrame(frame: number, allPeers: PeerId[]): PlayerInput[] {
    // 若該幀無真值：只取「frame 小於目標」的最新真輸入中的 Hold tick；
    // Event 與 leave 不重播，並把本次實際用到的預測存在 predictions[peer][frame]。
  }

  prune(beforeFrame: number): void {
    /* inputs 與 per-frame predictions 一併修剪 */
  }
}
```

預測錯誤（`wasPredicted && !predictionWasCorrect`）→ 觸發 rollback 到該 frame；`equivocated` → fail-closed。

**輸入延遲 D**（`INPUT_DELAY_FRAMES`，[D-20261028-03](../decisions/D-20261028-03-輸入延遲有界回滾與模擬Worker.md)）：

- 本機在 local frame c 取樣到的技能事件（含 Hold tick）一律寫入 `InputBuffer[local][c+D]`，並以 frame＝c+D 廣播與簽章。D 全房同值、不協商；比賽與 local-test 都套用。遠端只要在 D×T 內收到就不需預測。
- 每回合 frame 0 到 D−1 是**隱含空輸入幀**：所有 peer 視為「空輸入、已確定」，不需封包、不預測、不記預測（`isImplicitEmpty`）。倒數期間（GO 前）取樣到的事件丟棄，不補排進這 D 幀。
- 遠端相對本機的進度（lead）以排程前的 local frame 計算：input 幀先扣 D、checksum 幀原樣（[§7.2](#72-背景分頁造成的本機落後)、[§7.3](#73-持續落後自我驅逐)、[§7.5](#75-幀時鐘偏移與落後端快進)）。

## 3. State Buffer

StateBuffer 保存**前緣快照**：只在需要時存檔，不保證每幀都有（[D-20261028-03](../decisions/D-20261028-03-輸入延遲有界回滾與模擬Worker.md)）。

```typescript
class StateBuffer {
  private buffer = new Map<number, SavedState>();
  private readonly MAX_FRAMES = STATE_BUFFER_MAX_FRAMES; // 保留時窗（幀），network.md §8

  push(frame: number, snapshot: SavedState): void {
    this.buffer.set(frame, snapshot);
    for (const [f] of this.buffer)
      if (f < frame - this.MAX_FRAMES) this.buffer.delete(f); // 以最近一次寫入幀起算
  }
  latestAtOrBefore(frame: number): readonly [number, SavedState] | null; // ≤ frame 的最近保留快照
  discardAfter(frame: number): void; // 回滾後舊時間線的快照作廢
  hasFrame(frame: number): boolean;
  reset(frame: number, snapshot: SavedState): void; // catch-up：載入幀單一權威
}
```

- **存檔規則**：步進 frame c 之前，只有兩種情況 `saveState()`：
  1. c 是對齊幀（`c % CATCH_UP_OFFER_ALIGNMENT_FRAMES === 0`），供 catch-up offer、checksum 與觀戰 checkpoint 使用；
  2. c 含任何預測輸入（本幀取用輸入後判定），且保留中還沒有 c 的快照——**含預測的幀一律在該幀存檔**。
- **不變式**：任何可能被回滾的幀 m（c−R ≤ m < c 且 m 含預測）都存在保留快照 s，c−R ≤ s ≤ m。幀 m 的真值最晚在 current＝m+R 到達，此時 s 只能是 m，所以含預測的幀必須自己存檔。
- **成本**：單向延遲 ≤ D×T 時不需前緣快照，只有每 8 幀一次對齊快照。延遲落在 D×T 與 (D+R)×T 之間時最壞約每幀一次 save，回滾重播還會在對齊幀與仍含預測的幀重存：單向延遲 D+2 幀時實測每 240 幀約 255 次 save。
- **保留時窗**：`STATE_BUFFER_MAX_FRAMES` 是距最近一次寫入的幀數，不是每幀保證的容量；也不是 input 受理窗。
- **catch-up 候選**：offer 只取已 final 的對齊快照（a ≤ c−R，其前置輸入已不可再改），最多 `CATCH_UP_OFFER_CANDIDATES`（2）個；剛過對齊幀後的 R 幀內只有一個合格候選。offer 會複製 pin 候選，不依賴 StateBuffer 後續保留（[§5](#5-rollback-主迴圈)）。

## 4. Checksum 去同步偵測

每 `SNAPSHOT_INTERVAL_FRAMES`（120 frame、2 秒）各 peer 廣播 SHA-256 state hash，計票取多數；連續 `DESYNC_STRIKE_LIMIT`（3）次不一致才升級為 persistent-desync（防假陽性；常數見 [network.md §8](../程式參數/network.md#8-networksync網路同步)）。

**只對已確定狀態計票**（issue 001092）：checksum 幀 f 步進完成時只記「暫定 hash」，不廣播；回滾重播經過 f 時一律以重播後狀態覆寫暫定 hash。每幀步進後檢查：f 已確定＝下一次 drain 已不可能再收進任何 ≤ f 的輸入——受理窗外（`< current − ROLLBACK_FRAME_BUFFER_DEFAULT`）的幀必然丟棄，窗內每一幀則須已收齊全部 roster 的真值（不含預測；frame < D 的隱含空輸入幀視同已收齊）。確定後才把暫定 hash 轉為本地票、廣播並供 `resolveChecksum` 使用；所有 peer 套同一規則，因此誠實 peer 的票必定基於同一組輸入。回滾目標落在 StateBuffer 窗外時暫定 hash 作廢；catch-up 載入快照後舊時間線的暫定 hash 全數清除、不得廣播。確定最晚發生在 f + R + 1（R＝`ROLLBACK_FRAME_BUFFER_DEFAULT`），小於等待容差 `PEER_DESYNC_TOLERANCE_FRAMES`（30），所以裁定時點（f + 30）不變。確定判定只依受理窗 R 與已收真值，不依賴固定延遲。

**越窗期間不投票**（三人以上，[D-20261030-05](../decisions/D-20261030-05-越窗卡頓改走catch-up.md)）：本機自判越窗（[§7.5](#75-幀時鐘偏移與落後端快進)）時，本機狀態已知與全場不同。自判定起到 catch-up 對齊並結束分 tick 追趕為止，本機不記暫定 hash、不廣播 checksum 票；判定時尚未確定的暫定 hash 一併丟棄，不轉為正式票。他人的票照常收下，本機沒有正式票的輪次不做本機裁定，連續失配計數不變。這次 catch-up 成功（對齊並結束追趕）時清除本機的連續失配計數（`consecutiveDesyncs` 歸零）：越窗期間的 strike 來自已知的輸入遺失，不是持續分歧的證據。重連或 lead > 2×`STATE_BUFFER_MAX_FRAMES` 觸發的 catch-up 不歸零（[§7.1](#71-state-catch-up重連後對齊) 第 5 步）。catch-up 失敗或放棄、且嚴格多數 lead 已回到 ≤ D＋R 時恢復投票，strike 規則照舊。

```typescript
class ChecksumExchanger {
  private receivedChecksums = new Map<number, Map<PeerId, string>>();
  private consecutiveDesyncs = 0;
  private readonly DESYNC_LIMIT = DESYNC_STRIKE_LIMIT; // 3，network.md §8

  setChecksum(frame: number, peer: PeerId, hash: string): void {
    const map = this.receivedChecksums.get(frame) ?? new Map();
    map.set(peer, hash);
    this.receivedChecksums.set(frame, map);
  }

  // 只在本機自判越窗的 catch-up 成功時呼叫（D-20261030-05）
  clearStrikes(): void {
    this.consecutiveDesyncs = 0;
  }

  resolve(
    frame: number,
    currentFrame: number,
    myHash: string,
    allPeers: PeerId[],
  ): ChecksumResult {
    const peerMap = this.receivedChecksums.get(frame) ?? new Map();
    const waitedOut = currentFrame - frame >= PEER_DESYNC_TOLERANCE_FRAMES; // 30 frame / 0.5s（network.md §8）：逾窗未到的 peer 該輪視同缺席、以已到票數做多數決（不阻塞）
    if (!waitedOut && peerMap.size < allPeers.length - 1)
      return { type: "wait", awaiting: allPeers.length - 1 - peerMap.size };

    const counts = new Map<string, number>([[myHash, 1]]);
    for (const hash of peerMap.values())
      counts.set(hash, (counts.get(hash) ?? 0) + 1);

    let majorityHash: string | null = null,
      majorityCount = 0;
    for (const [hash, count] of counts) {
      if (count > majorityCount) {
        majorityHash = hash;
        majorityCount = count;
      }
    }
    const receivedVotes = 1 + peerMap.size;
    if (majorityCount <= receivedVotes / 2)
      return { type: "tied", hashes: completeTicket(myHash, peerMap) };

    if (majorityHash === myHash) {
      this.consecutiveDesyncs = 0;
      return { type: "consistent" };
    }
    // mismatch 不嘗試 rollback：決定性重播同一批 input 必得同一結果、治不了真分歧（且分歧點多在 StateBuffer 12 frame 窗外）→ 累積 strike（有成員缺席時少數端另行重同步，見本節下方）
    this.consecutiveDesyncs++;
    if (this.consecutiveDesyncs >= this.DESYNC_LIMIT)
      return { type: "persistent-desync" };
    return { type: "mismatch" };
  }
}

type ChecksumResult =
  | { type: "wait"; awaiting: number }
  | { type: "consistent" }
  | { type: "mismatch" }
  | { type: "tied"; participatingPeers: PeerId[] }
  | { type: "persistent-desync" };
```

`persistent-desync` → `handlePersistentDesync` 自我驅逐：本機停模擬、送 control `leave`（reason `'desync'`；對端只記斷線〔forfeit〕，不影響終局）＋ 觸發 [ledger.md §9 `DesyncEvent`](ledger.md)（被踢者自簽自報、不影響信譽、純供調查）。**checksum 等待容差 30 frame（0.5 秒）**：某 peer 的 checksum 逾窗未到 → 該輪視同缺席、不阻塞多數決；**mismatch 不觸發 rollback**（決定性重播無法收斂真分歧）、累積 strike；該輪有 roster 成員缺席投票時，少數端另向該輪多數票 peer 發起 catch-up 重同步（所需票數＝多數票遠端人數、至少兩名，[D-20261109-01](../decisions/D-20261109-01-斷線造成的checksum少數端重同步.md)），全員投票時不發起。

### 4.1 已確定步進串流

引擎另以 `onSettled` 依幀序發出**已確定步進記錄**，消費端（race-session）的回合共識錨、觀戰 checkpoint 與回合終局只吃這條串流，不讀 live 步的預測輸出（issue 001094、001095、001101）：

- **幀號約定**：記錄 N＝已步進 N 次後的狀態（即 frame N 步進前），附該步的物理輸出與擷取的附帶資料（各車進度、致毀統計）；記錄 N 在 frame N−1 已確定後才發出。checksum 幀 f 的 hash 則是步進 f 之後的狀態，兩者差一。
- 每幀恰發一次；回滾重播覆寫尚未發出的記錄。對齊 checkpoint 幀（`SNAPSHOT_INTERVAL_FRAMES` 的倍數）的記錄附 `{ hash, snapshot }`：hash 為該狀態的 state hash，snapshot 與該幀的對齊存檔共用。
- catch-up 對齊時先發 `reset(F)`，之後由 F+1 續發；消費端在 reset 時以載入狀態的 hash 補記載入幀 F 的錨（F 是已驗證的對齊幀），不重建任何消費端狀態。
- `reset(F)` 可早於已發出的最後一筆記錄（倒退載入，[§7.1](#71-state-catch-up重連後對齊) 第 5 步）：F 之後已發出的記錄屬舊時間線，消費端在補記 F 的錨之前先丟棄 F 之後的舊值，F 之後重發的記錄屬新時間線。回合共識錨刪除本機在 F 之後記錄的 hash，不再提案或拿來比對他人的聯署請求；回合 abort 證據摘要同樣丟棄 F 之後者。觀戰來源目前錨的幀 > F 時清除該錨、不再補送給 late join 或重求，但保留已驗簽的 input／checksum backlog（與本機時間線無關）；發布舊錨時已裁掉其之前的封包，因此之後只採用幀 ≥ 被清除錨幀的新錨，確保新錨之後的 input 不缺號（[spectator.md §3](spectator.md)）。回合終局只由已確定記錄所附的已雜湊每車欄位無狀態判定；這些欄位隨快照載入，恢復端與 live peers 推導出相同結果。
- 停串流分兩層。引擎層：只有回滾重播超出回滾窗（`onPersistentDesync('window')`）會清空待發記錄並停發；不可恢復 lag 的 `'window'`、持續落後的 `'lag'` 與輸入 equivocation 的 `'input'`，引擎都不停發。模擬端：收到 `'window'`、`'input'`、`'lag'` 任一升級，或主執行緒通知已自我驅逐（含 checksum 票面升級），都在同一步內同步停止消費串流並停迴圈，之後不再發出 checkpoint 或回合終局。race-session 已自我驅逐後，遲到的已確定訊息與回合終局一律丟棄，不定稿回合、不開下一回合、不結算。
- 消費端行為：回合共識錨只記帶 checkpoint 的記錄 hash；觀戰 checkpoint 只發布記錄所附快照（frame 0 於開賽時另發一次），live 步不另外 `saveState`；回合終局（完賽、時限、無存活車終局窗）以記錄判定，因此預測中的衝線或時限不會結束回合，終局延後到終局幀已確定，終局幀與致毀統計取自記錄。終局的唯一來源是記錄所附各車 `RaceProgress`（完賽幀、流內離場幀、最後移動幀、離開存活幀，[physics-engine.md §2.10](physics-engine.md)）加上當幀車況；判定規則見 [賽內機制.md §3.1](../賽內機制.md)，滑行窗算式見 [算式表 §20.1](../算式表.md)。傳輸層的斷線通知不進終局。

## 5. Rollback 主迴圈

`saveState` 是純讀取；rollback 從自己的 StateBuffer 載入時，只有本引擎自產、仍是同一份記憶體參照的
快照可走 `loadOwnState`（跳過原生拓樸、幾何、質量與 runtime hash 核對），其餘一律 `loadState` 完整驗證。
catch-up `sync-response` 與觀戰 checkpoint 一律完整驗證。信任邊界與無損守門見
[physics-engine.md](physics-engine.md)、[D-20261028-01](../decisions/D-20261028-01-快照取消正規化與本機信任載入.md)。

```typescript
class RollbackEngine {
  private currentFrame = 0;
  private inputBuffer = new InputBuffer(INPUT_DELAY_FRAMES);
  private stateBuffer = new StateBuffer();
  private checksumExchanger = new ChecksumExchanger();

  constructor(
    private physics: PhysicsEngine,
    private network: NetworkLayer,
    private localPeerId: PeerId,
    private allPeers: PeerId[],
  ) {}

  step(localInput: InputEvent[]): StepOutput {
    this.stepCount++; // catch-up 請求端的 RTT／逾時時基：只由 step 遞增（§7.1 第 6 步）
    // 0. 套用上一步之後收到的非同步交付回執（§6）
    this.applyPendingReceipts();
    // 1. 先收網路訊息：遲到輸入裁 rollback 目標；本步若 catch-up 對齊，current 已換成載入幀 F
    const { rollbackTo } = this.processNetworkMessages();
    // 2. 本機輸入排程到 current＋D，以排程幀廣播與簽章；catch-up 追趕中（含對齊當步）不排程（§7.1 第 6 步）
    const chasing = this.chaseTarget !== null;
    if (!chasing) {
      const scheduled = this.currentFrame + INPUT_DELAY_FRAMES;
      this.inputBuffer.setInput(this.localPeerId, scheduled, localInput);
      this.network.broadcast({ type: "input", frame: scheduled, events: localInput, sender: this.localPeerId });
    }
    // 3. 回滾（深度 ≤ R）後推進一幀；追趕中 live peers 同步前進一幀，追趕目標加一
    if (rollbackTo !== null && rollbackTo < this.currentFrame) this.rollbackAndReplay(rollbackTo);
    const output = this.advanceFrame();
    if (chasing && this.chaseTarget !== null) this.chaseTarget++;
    return output;
  }

  // 分 tick 追趕（§7.1 第 6 步）：RaceLoop 在每 tick 牆鐘預算內重複呼叫；不收訊、不寫本機輸入、不回報每幀實付
  advanceCatchUpChase(): boolean {
    if (this.chaseTarget === null) return false;
    this.advanceFrame();
    if (this.currentFrame >= this.chaseTarget) this.endCatchUpChase(); // 清空最大 lead 統計與持續落後計數
    return this.chaseTarget !== null;
  }

  // 落後端快進（§7.5）：本 tick 固定步之後應追加的步數
  clockFastForwardSteps(): number;

  private advanceFrame(): StepOutput {
    const inputs = this.inputBuffer.getInputsForFrame(this.currentFrame, this.allPeers);
    // 前緣快照（§3）：對齊幀或含預測的幀才存檔；對齊 checkpoint 幀同時掛到已確定記錄（§4.1）
    if (this.shouldSaveBeforeStep(this.currentFrame))
      this.stateBuffer.push(this.currentFrame, this.physics.saveState());
    const output = this.physics.step(inputs);
    this.pendingSettled.set(this.settledRecord(this.currentFrame + 1, output));
    this.recordTentativeHash(this.currentFrame); // checksum 幀只記暫定 hash（§4）
    this.currentFrame++;
    this.promoteStashedInputs(); // catch-up 暫存中進入未來窗的超前輸入晉升（§7.1 第 6 步）
    this.broadcastSettledChecksums(); // 已確定者才轉本地票廣播；已投過的輪不重投
    this.emitSettledSteps(); // 依幀序發出已確定記錄（§4.1）
    return output;
  }

  private rollbackAndReplay(targetFrame: number): void {
    const latest = this.stateBuffer.latestAtOrBefore(targetFrame);
    if (latest === null || latest[0] < this.currentFrame - ROLLBACK_FRAME_BUFFER_DEFAULT) {
      this.onPersistentDesync("window"); // 重播將超過 R：前緣不變式下只會是實作錯誤
      return;
    }
    const [snapshotFrame, snapshot] = latest;
    // 自產快照走本機信任載入；catch-up 重置留下的外來快照仍完整驗證（D-20261028-01）
    if (this.physics.isOwnSavedState(snapshot)) this.physics.loadOwnState(snapshot);
    else this.physics.loadState(snapshot);
    this.stateBuffer.discardAfter(snapshotFrame); // 舊時間線快照作廢
    for (let f = snapshotFrame; f < this.currentFrame; f++) {
      const inputs = this.inputBuffer.getInputsForFrame(f, this.allPeers);
      if (f > snapshotFrame && this.shouldSaveBeforeStep(f))
        this.stateBuffer.push(f, this.physics.saveState()); // 只在對齊幀與仍含預測的幀重存
      const output = this.physics.step(inputs);
      this.pendingSettled.set(this.settledRecord(f + 1, output)); // 覆寫尚未發出的記錄
      this.recordTentativeHash(f); // 重播經過 checksum 幀＝以真值重算暫定 hash（已投過的輪略過）
    }
  }

  // catch-up 對齊（§7.1 第 5 步）：守門看追前緣目標（已含 front 夾限），F 可早於本機（倒退載入）。
  private applyCatchUp(frame: number, snapshot: SavedState, log: SyncInputLog, chaseTarget: number): boolean {
    if (chaseTarget <= this.currentFrame) return false; // 本機已不落後於前緣：不載入
    this.physics.loadState(snapshot); // 外來快照：完整驗證
    // 新輸入時間線：F 之前的延續基準與 [F, front − R) 以日誌為唯一權威；
    // front − R 起併入本機已持有與暫存的真值（同 (peer, frame) 以日誌為準、相異＝equivocation）；
    // 對齊後未來窗外的真值放回暫存，隨前進晉升
    this.rebuildInputTimeline(frame, log);
    this.currentFrame = frame;
    this.stateBuffer.reset(frame, snapshot);
    this.tentativeHashes.clear(); // 舊時間線的暫定 hash 不廣播
    this.discardOwnHashesAfter(frame); // 倒退載入：> F 的本機票屬舊時間線；已投輪記錄保留、不重投
    this.discardOwnOffersAndResends(); // 自身擔任 provider 的 pinned offer 與待重送一律作廢
    this.resetLagObservations(); // 落後觀測、參考幀觀測與持續落後計數歸零
    this.settledHandler?.({ kind: "reset", frame }); // F 可早於已發出的記錄（§4.1）
    this.chaseTarget = frame < chaseTarget ? chaseTarget : null; // 本函式不推進：由 advanceCatchUpChase 分 tick 補足
    this.clockFastForward.reset();
    return true;
  }

  private processNetworkMessages(): { rollbackTo: number | null } {
    const messages = this.network.drain();
    resendPendingSyncResponses(); // responder 有上限地重送未交付的 sync-response（§7.1 第 3 步）
    // 第一遍：pending probe 必須逐 peer 同 requestId/target；signed offers 對完全相同
    // `(aligned frame, snapshot hash)` 分桶。達 strict remote quorum 後固定 voters 順序，
    // 只向第一位送含 offerId/targetFrame/targetHash 的 exact request。
    negotiateSnapshotOffers(messages);
    // 第二遍：sync-response-receiving 記下傳輸進度；sync-response-arrived 記下目前 pending 的到達步與傳輸步數；
    // 只有目前單一 voter/pending requestId 的
    // sync-response 可進；bytes hash、內外 frame、輸入日誌語意（roster、車輛 schema、front 跨度）任一失敗即換下一
    // committed voter。合格者延到第三遍之後才採用，讓同一 drain 的超前輸入與參考幀觀測先入帳。
    const accepted = takeMatchingSyncResponse(messages); // rttFrames＝到達步 − 請求步 − 傳輸步數
    retryTimedOutSnapshotRequest(); // CATCH_UP_REQUEST_TIMEOUT_FRAMES 自最近一次進展起算，另有傳輸與驗簽總上限：先取消 transport pending 再換 voter
    // 第三遍：輸入預測錯誤裁 rollback／checksum 入帳／probe 與 exact sync-request 應答
    let earliest: number | null = null;
    for (const msg of messages) {
      if (msg.type === "input") {
        if (!this.validInput(msg.sender, msg.events) || msg.frame < INPUT_DELAY_FRAMES) {
          noteMisbehavior(msg.sender); // frame < D 不可能合法排程
          continue;
        }
        this.observeRemoteFrame(msg.sender, msg.frame - INPUT_DELAY_FRAMES); // lead 扣 D；亦為參考幀觀測（§7.1 第 5 步）
        if (msg.frame > this.currentFrame + STATE_BUFFER_MAX_FRAMES * 2) {
          stashIfCatchingUp(msg); // catch-up 進行中（probe、快照階段或追趕中）入有界暫存，其餘丟棄
          continue;
        }
        if (msg.frame < this.currentFrame - ROLLBACK_FRAME_BUFFER_DEFAULT) continue; // 受理窗外
        const { wasPredicted, predictionWasCorrect, equivocated } =
          this.inputBuffer.setInput(msg.sender, msg.frame, msg.events);
        if (equivocated) {
          failClosed(msg.sender);
          continue;
        }
        recordSignedInput(msg); // 原簽章保留供日後當 provider 時組輸入日誌
        if (wasPredicted && !predictionWasCorrect && (earliest === null || msg.frame < earliest))
          earliest = msg.frame;
      } else if (msg.type === "checksum") {
        // 僅尚待裁定且在 past horizon 內的對齊輪；同 peer 首票鎖定
        this.checksumExchanger.setChecksum(msg.frame, msg.sender, msg.hash);
      } else if (msg.type === "sync-probe-request") {
        // 只 pin 已 final 的對齊候選（a ≤ current − R），且快照須 ≤ 單包上限減最壞輸入日誌
        const candidates = this.cacheSnapshotOfferAtomic(msg.sender, msg.requestId);
        if (candidates)
          this.network.broadcast({ type: "sync-probe-response", requestId: msg.requestId, candidates,
            target: msg.sender, sender: this.localPeerId });
      } else if (msg.type === "sync-request") {
        // 只從該 requester 的 bounded offer cache 取 `(offerId,targetFrame,targetHash)`
        const candidate = matchPinnedOffer(msg);
        const inputLog = this.buildInputLog(msg.targetFrame); // front − F 超過跨度上限＝不回應
        if (!candidate || !inputLog) continue;
        const sent = this.network.broadcast({ type: "sync-response", requestId: msg.requestId,
          target: msg.sender, sender: this.localPeerId, snapshot: candidate.snapshot,
          frame: msg.targetFrame, inputLog });
        // 同步 true＝已交給通道：原子刪 offer 並開始 cooldown；false/throw 保留 offer 並登記重送（§7.1 第 3 步）；
        // Worker 端回傳「已排入橋接佇列」：等回執（§6），回執未到前該 peer 視同冷卻中
        settleSyncResponseDelivery(msg.sender, sent);
      }
    }
    // 參考幀須含本 drain 第三遍的觀測；先前暫無參考而保留的回應每步重判
    const candidate = accepted ?? this.deferredCatchUp;
    if (candidate && this.adoptCatchUp(candidate)) earliest = null; // catchUpTarget 夾限後 applyCatchUp；舊時間線回滾目標失效
    this.evaluateObservedRemoteLag(); // 背景落後 catch-up／不可恢復 lag／持續落後（§7.2、§7.3）；追趕中只記觀測
    return { rollbackTo: earliest };
  }
}
```

`sync-response` 自身**永不觸發回滾**。probe 時 responder 從 StateBuffer 複製並 pin 最多兩個已 final 的 8-frame 對齊候選，signed offer 只送 `(frame,sha256(snapshot))`；候選快照上限為 `SYNC_SNAPSHOT_MAX_BYTES` 減最壞輸入日誌 bytes（`SYNC_INPUT_LOG_MAX_BYTES`，由既有常數推導，見 [§7.1](#71-state-catch-up重連後對齊)），送不出去的快照不參與 quorum。同值遠端票達 `floor(全名單/2)+1` 後，requester 只向一位 voter 索取完整 snapshot；300 步（5 秒）無回應、hash 不符、輸入日誌不合格、`front` 越出夾限、topology inspect 或 load 失敗便依序改向下一 voter（[§7.1](#71-state-catch-up重連後對齊)）。逾時必先通知 transport 取消 pending correlation，因此晚到的大型 response 只讀短 header，不能進 decode/copy/hash/verify。

offer TTL 900 幀（15 秒），per-requester 只保留一 attempt，全域最多 8 entries／64 MiB（`8 × 2 × SYNC_SNAPSHOT_MAX_BYTES`）；容量與來源 byteLength 必須在 `slice`／SHA-256 前以 `currentBytes - oldBytes + newBytes` preflight。replacement 在暫存 Map 完成 copy/hash 後才一次交換並更新 accounting；無候選、超額或 copy/hash 例外皆完整保留舊 offer，不 eviction 正在服務的他人 offer。probe response 遺失時，t=60／120 幀以**相同 offerId** 最多重送兩次，responder 冪等回傳既有 commitment、不重複 copy/hash；t=120 的最後一次送出恰好命中 replacement guard，新且 uint32 單調的 attempt 可安全取代，unordered 舊 id 永久拒絕。因 snapshot 已 pin，probe→request 即使延遲超過 StateBuffer 12 幀仍可服務；完整 snapshot 與輸入日誌（合計 ≤ `SYNC_SNAPSHOT_MAX_BYTES`）不需由每位 quorum voter 重傳。2 人場僅有 1 張遠端票，跨窗 catch-up 必然 fail-closed。

快照載入是原子操作。current SavedState 封裝 `vehicles[]`（含 actuator phases／ammo、per-part `broken/breakFrame`、weapon 預載彈 `projectiles[]`（`fatigue/temperature/broken/breakFrame`；未開啟彈體獨立耐久時為空陣列）、vehicle retirement 與 checkpoint 約束的 `routeProgressUm`）、完整 roster 的 `destructionCounts`、已釋放 `bullets[]` 的預配置 collider 身分與 `sourceCleared`、`trackEntities[]`（fatigue／broken／breakFrame）、`weather`（seed、accumulator、spawn ordinal、active descriptors）、`worldConfig`、`worldRuntimeStateHash` 與 world snapshot；immutable topology 涵蓋 body type/mass/gravity/dominance/solver/CCD/locks、collider parent/shape/mass/density/sensor/restitution/groups/collision types/events/hooks/contact skin/threshold，以及 permanent joint、launch 持彈 collider 與 entity intact handles；envelope 另含 bounded-step 細分停損的 `boundedSubdivisionRun`（非零時納入 state hash）。body／collider enabled 屬 mutable runtime state，必須與 vehicle／track lifecycle 雙向一致；場地與車輛純視覺碎片的 active／spawn／expiry／fade／pose／velocity 不進快照或 hash。snapshot、runtime hash、envelope broken／retirement、destruction attribution、route progress、projectile clearance 與 weather state 必須一致，restore 後再由 immutable manifest 重建派生狀態。位姿、速度、next pose、effective inertia、damping、sleeping 等 mutable state和 envelope runtime hash 一併比對。launch projectile 仍在 load-time 預配置；rollback 不接受 snapshot 自述新增 body／collider。暫時 Rapier world 以 `finally` 保證任何 getter/validation 例外皆 `free()`，全數驗證成功後才替換舊 world。

Input 入場前有三層關卡：每幀最多 4 事件、skill 唯一且 Event/Hold byte 語意必須符合；技能必須存在該 peer 本回合已驗證 loadout 的 chip schema。leave 必須單獨成幀（與技能同幀或重複 leave 整筆非法；encode、decode 與 `RollbackEngine.validEventsFor` 都檢查），不受 chip schema 約束。缺包預測只延續 `isHoldTick=true` 的連續技能；boost/jump/slam 等 Event 型技能與 leave 只執行一次，永不因缺包重放。引擎只承認每位 peer 的第一個 leave，之後該車的輸入一律忽略（[physics-engine.md §2.10](physics-engine.md)）。`InputBuffer` 保存每個 `(peer, frame)` **實際被模擬取用**的預測，future/out-of-order 到包不得回灌舊幀。同 `(peer, frame)` 首個 signed 值鎖定；後續相異值是 equivocation，立即 fail-closed 離場。

固定 60Hz physics（dt = `1 / FIXED_FRAMERATE_HZ` 秒精確值）、固定輸入延遲 D 加有界回滾 R（[D-20261028-03](../decisions/D-20261028-03-輸入延遲有界回滾與模擬Worker.md)；常數見 [network.md §8](../程式參數/network.md#8-networksync網路同步)）。物理跨 peer determinism（f32 + 整數量化 + O(1) material lookup + collider handle 固定索引）見 [賽內機制.md §2.2](../賽內機制.md)。

### 5.1 執行緒配置（模擬 Worker）

比賽、local-test 與觀戰 replay 的模擬在 dedicated module Worker 內執行；一個 Worker 只承載比賽回合或觀戰 replay 其中之一（[D-20261028-03](../decisions/D-20261028-03-輸入延遲有界回滾與模擬Worker.md)）。Worker 內仍是單執行緒、不用 SharedArrayBuffer，不違反 [程式架構.md §6.6](../程式架構.md)。

| 執行緒 | 職責 |
|---|---|
| 主執行緒 | DOM／Angular UI、three.js 渲染與 `renderAlpha` 插值、輸入取樣、音訊、本機先行回饋（技能鈕按下視覺）；`RTCPeerConnection` 與 DataChannel、wire encode／decode、Race Sign Key 簽章與驗簽、per-peer ingress token bucket；GLB fetch；`visibilitychange` 與生命週期事件 |
| 模擬 Worker | Rapier WASM 與 `PhysicsEngine`、`world-builder`、`RollbackEngine`（含 `InputBuffer`、`StateBuffer`、`ChecksumExchanger`）、固定 timestep 迴圈（[physics-engine.md §3](physics-engine.md)）；觀戰 replay world 與 replay 的 checkpoint 簽章、checksum 驗證 |

- **網路橋接**：主執行緒把已驗簽的 `NetworkMessage` 依到達順序轉給 Worker（sync-response 例外：日誌驗完才入佇列尾端，[§7.1](#71-state-catch-up重連後對齊) 第 4 步），Worker 以佇列實作 `drain()`；每個前進步恰 drain 一次。回合 GO 時本機已記為 forfeit 的成員（含後續回合屏障停滯移出者，[流程/比賽進行.md §1.7](../流程/比賽進行.md#17-go-前-race-ready-屏障)），其本回合 `input` 與 `checksum` 由橋接層在轉給 Worker 前丟棄，比照網路斷線者不影響模擬與 checksum 投票；其餘訊息型別照常轉送。Worker 送出的訊息由主執行緒簽章後交給 DataChannel，交付結果以非同步回執回報（[§6](#6-datachannel-二進位序列化)）。`'window'`、`'input'`、`'lag'` 升級與自我驅逐通知的停串流（停止消費已確定串流並停迴圈）都在 Worker 端同步完成，規則同 [§4.1](#41-已確定步進串流)。
- **資料傳遞**：場地與車輛 GLB 由主執行緒 fetch，複製成私有 `ArrayBuffer`（`slice`）後以 Transferable 轉移，主執行緒原 buffer 不受影響。catch-up 快照、已確定 checkpoint、回合建置回覆與網路出站訊息以結構化複製傳遞、不 transfer；觀戰 checkpoint 以 base64 字串複製。
- **Draco**：Worker 內以建置時生成的 ESM 包裝載入 three 的 Draco 解碼器（上游原檔加 default export、拒收含 `eval`／`Function`／`importScripts` 的來源，[security.md §3](security.md)）。
- **輸出**：Worker 每步回傳 render frame 與 HUD 推導所需資料；HUD、音訊與 `skill-applied` 事件由主執行緒消費，不回寫模擬。
- **背景與暫停**：Worker 計時器在背景分頁不受節流，主執行緒必須主動轉送 `visibilitychange`；local-test 切背景＝暫停，比賽依 [§7.2](#72-背景分頁造成的本機落後)。
- **沒有 Worker 時**：同一份模擬核心改在主執行緒承載（rAF 驅動），行為相同、只失去執行緒隔離。
- **決定性**：同一份 WASM、單執行緒、相同輸入序列；Worker 只改變「何時」執行。Worker 與主執行緒 120 幀 hash 逐位元相同（Chromium、Firefox），golden 與 conformance 不需重基線。

## 6. DataChannel 二進位序列化

```typescript
// wire 型別：INPUT=1 / CHECKSUM=2 / SYNC_REQUEST=3 / SYNC_RESPONSE=4 / PROBE_REQUEST=5 / PROBE_RESPONSE=6
// Input：       [type:1][frame:4 LE][events_len:1][events:variable][sig:64]（每 event：[event_type:1][skill:1][hold:1]）
//   event_type：1＝skill-trigger；2＝leave（三個 byte 固定為 [2,0,0]，且必須是該幀唯一事件）
// Checksum：    [type:1][frame:4 LE][hash:32][sig:64]
// ProbeRequest：[type:1][requestId:4 LE][targetLen:1][target][sig:64]
// ProbeResponse：[type:1][requestId:4 LE][count:1][count × (frame:4 + hash:32)][targetLen:1][target][sig:64]
// SyncRequest： [type:1][requestId:4 LE][offerId:4 LE][targetFrame:4 LE][targetHash:32][targetLen:1][target][sig:64]
// SyncResponse：[type:1][requestId:4 LE][frame:4 LE][targetLen:1][target][snapLen:4 LE][logLen:4 LE][snapshot][inputLog][sig:64]
//   inputLog＝[front:4 LE][peerCount:1][peerCount × (len:1 + PeerId)][entryCount:4 LE]
//             [entryCount × (peerIndex:1 + frame:4 LE + events_len:1 + events + sig:64)]；snapLen＋logLen ≤ SYNC_SNAPSHOT_MAX_BYTES
//   每筆 entry 的 sig＝原發送者對該 input 的簽章（與 Input wire 同 digest），接收端逐筆驗簽
// sig = Race Sign Key 簽 sha256(type ‖ requestId/offerId ‖ candidates/frame/hash ‖ target ‖ snapshot? ‖ inputLog? ‖ raceId)
// raceId = `${matchId}#${roundIndex}`：簽章域按回合隔離——跨回合遲到包驗簽必敗、frame 重置不汙染 InputBuffer
function encodeInput(msg: InputMessage): Uint8Array {
  const header = new Uint8Array(6);
  header[0] = MSG_TYPE_INPUT;
  new DataView(header.buffer).setUint32(1, msg.frame, true);
  header[5] = msg.events.length;
  return concat(header, encodeEvents(msg.events), msg.signature);
}
```

訊息大小：Input ~74 bytes（本體 ~10 + sig 64）、Checksum ~100 bytes（含 sig）；頻寬公式見 [§8](#8-效能預算三層口徑)。sync-request／sync-response 僅重連時零星發送、不計入穩態頻寬。

傳輸層依 DataChannel **真實來源 peer**，在任何 decode/copy/hash/verify 前套用跨 `drain()` 的 per-peer token bucket。input 獨立為 120 筆 burst／90 tokens/s（合法 60Hz 有裕度），checksum 與四種 catch-up 控制訊息維持獨立 32 筆 ／32 tokens/s；raw bytes 另受 `RACE_MESSAGE_MAX_BYTES + 64 KiB` 容量與每秒同量補充限制，大 snapshot 不得借 input message 配額放寬 byte 預算。`drain()` 只釋放 verified queue，不重置 ingress。`sync-response` 先以固定短 header 核對 pending；逾時 ／ 取消後 late response 在消耗 token/byte 配額前 cheap-drop，只有仍匹配的 response 才進 ingress bucket，壞簽或 enqueue 失敗不消耗仍有效 pending。probe、offer、exact request 與大型 response 全用 `sendRaceTo` 真定向；非 target peer 不收位元組、也不付 decode/verify 成本。

ordered `control` DataChannel 另有獨立 ingress：每個真實 remote peer 在 DAG-CBOR decode 前先套
256 KiB 單訊息上限、32-message burst／16 messages/s 與 327,680-byte burst／262,144 bytes/s
token bucket。message／byte 預算不足只 deterministic drop，不累積違規；oversized、非 binary、
畸形 CBOR 或 schema 不符則累積結構違規，3 次即關閉該 control link、把 `race-mesh` 狀態轉為
offline 並走既有 disconnect/forfeit 通知。

`ControlWire` 外層為 exact schema：`app` 只接受 `{ kind, payload }`，且 payload 必須是具非空
`type`（UTF-8 ≤64 bytes）的 record；深層賽事 domain union 仍由 `race-runtime` 保持單一型別權威，
mesh 不複製第二套 parser。`key` 只接受 exact `{ kind, raceId, publicKey, signature }`，raceId
UTF-8 ≤256 bytes、Ed25519 public key 恰 32 bytes 且通過身分公鑰檢查（非小階、非全零、正規編碼，[key-manager.md §3](key-manager.md)；不符視同 schema 不符，該鑰不進回合鑰表）、signature 恰 64 bytes；每 peer 最多保留 8 筆，
因此 retained key material 與 map key bytes 同時有硬界。`leave` 只接受 exact reason enum。

`race-message-envelope` 使用這條 ordered app-control bus，但不進 rollback input queue。transport
以固定 participant roster 驗真實 link source、原 signer、match、單調 sequence 與平均每 2 秒一則
（burst 2）的 per-sender quota；至少一條 control link 可寫才回報送出成功。完整 domain schema、
spectator 原簽章 relay 與 HUD 見 [race-messages.md](race-messages.md)。

### 6.1 應用層分段（issue 001093）

單一 RTCDataChannel 訊息受 SCTP 協商的 `maxMessageSize` 限制（Chromium 262,144 B），catch-up
`sync-response` 與觀戰 replay checkpoint 遠大於此。race、control 與 spectator 三條通道共用
`network-sync/data-channel-fragment`（room 通道不分段，只在送出端以同一上限檢查、超限不送，見
[room-runtime.md](room-runtime.md) §3）：

- **上限**：每條連線取 `min(pc.sctp.maxMessageSize, DATA_CHANNEL_MESSAGE_SAFE_MAX_BYTES)`；協商值未知或非法時用
  `DATA_CHANNEL_MESSAGE_FALLBACK_BYTES`（RFC 8841 預設 64 KiB）。不超過上限的訊息原樣送出，零額外 byte。
- **分段框**：`[0xff][messageId:4][index:4][count:4][totalLength:4][fragmentBytes:4][payload]`（big-endian、標頭
  21 bytes）。三種上層 wire 的首 byte 分別是 1–6、DAG-CBOR map 與 JSON `{`，不可能是 `0xff`。除末段外每段
  恰 `fragmentBytes`，且 ≥ `DATA_CHANNEL_FRAGMENT_MIN_PAYLOAD_BYTES`（16 KiB）；`count = ceil(totalLength /
  fragmentBytes)`。協商上限容不下最小段時整筆不送。messageId 每連線每通道單調 u32。pre_launch 直接採用此 wire，
  不保留舊單包格式。
- **指定段長**：送出端可指定每段酬載上限，超過者即使單包放得下也分段（段長取指定值與上限扣標頭的較小者，且不低於
  最小段長）。race 的 `sync-response` 以 `DATA_CHANNEL_FRAGMENT_MIN_PAYLOAD_BYTES` 為段長送出：接收端只能從第一段到達起
  量測傳輸時間，段愈小，未量測的首段愈短。框格式不變，接收端照常重組。
- **送出流量控制**：多段訊息送第一段前檢查 `bufferedAmount + 全部段長 ≤ DATA_CHANNEL_SEND_BUFFER_MAX_BYTES`（16 MiB），
  超量或任一 `send` 例外即回 `false`（`sendRaceTo` 回 false；`sync-response` 保留 pinned offer，由 responder 依 [§7.1](#71-state-catch-up重連後對齊) 第 3 步有上限地自動重送）。
- **重組**：每 peer 每通道一個重組器。分段框先過以 bytes 計的 token bucket（race＝`INGRESS_TOKEN_BUCKET_BYTES`、
  control＝`CONTROL_INGRESS_*_BYTES`、spectator＝`SPECTATOR_SOURCE_*_BYTES`／viewer 方向 `SPECTATOR_VIEWER_*_BYTES`），
  再驗標頭（總長 ≤ 該通道單訊息上限、段數與段長一致、index 範圍）；新訊息在配置緩衝前檢查未完成重組合計
  ≤ `*_REASSEMBLY_MAX_BYTES_PER_PEER`（race＝驗證後 queue 上限、control／spectator＝各自 byte bucket 容量）。亂序可收；
  相同內容的重複段冪等忽略，相異內容即整筆放棄；同 messageId 標頭不一致即放棄；未完成者逾時丟棄：control 與
  spectator 自首段起 `DATA_CHANNEL_REASSEMBLY_TIMEOUT_MS`（5 秒＝catch-up 請求逾時）；race 改為自最近一段起的閒置逾時
  （同為 5 秒，段持續到達即不逾時），另設自首段起的總上限 `RACE_REASSEMBLY_MAX_DURATION_MS`（＝`CATCH_UP_OFFER_TTL_FRAMES`
  個固定步，15 秒），讓低頻寬下的大快照能傳完；已完成或放棄的 messageId 保留有界記錄，遲到殘段不得重開重組。peer 離場或
  通道關閉即清空。
- **傳輸時間與進度**：重組完成時回報估計傳輸時間＝第一段到達到最後一段到達的時間 × 總長 ÷（總長 − 第一段長），即以其後
  各段的平均速率外推第一段自身的傳輸時間；未分段的訊息為 0。第一個到達的段不一定是 index 0（race 通道 unordered）。
  index 0 已到、尚未完成的多段訊息每收到一段即回報一次進度（開頭位元組與總長）。race 通道把兩者交給 RoundTransport
  （[§7.1](#71-state-catch-up重連後對齊) 第 4 步）。
- **首段預檢**：index 0 到達時以完整 wire 開頭位元組與宣告總長做廉價檢查，未過者整筆放棄、不複製其餘段。
  race：只有已宣告回合鑰的來源、且 header 對上 pending correlation 的 `sync-response` 可被重組（其餘 race 型別都遠小於
  上限，不會合法地分段）；spectator：超過 `SPECTATOR_WIRE_MAX_BYTES` 者必須是 canonical replay-checkpoint 前綴且
  checkpoint token 足夠。
- **驗證邊界**：分段框本身不簽章、不信任。重組完成的完整 wire 才進既有 admission（message token 以完整訊息計一次）、
  decode 與 Race Sign Key 驗簽（race）、ControlWire schema（control）或 checkpoint 簽章（spectator），沒有繞過驗證的
  捷徑；偽造或竄改任一段只會讓完整訊息驗簽失敗並被丟棄（壞簽不消耗仍有效的 pending）。

`NetworkLayer.broadcast` 與定向 `RaceWirePort.sendRaceTo` 的同步契約回傳 `boolean`：`true` 表示已交給傳輸通道，`false` 表示未交付，呼叫端必須保留重試／清理 correlation 所需狀態。模擬在 Worker 時（[§5.1](#51-執行緒配置模擬-worker)），Worker 端的 `broadcast` 只能回傳「已交給主執行緒橋接佇列」（帶 correlationId 的 queued 結果）；主執行緒交給 DataChannel 後以非同步回執 `{ correlationId, delivered }` 通知 Worker，回執在下一次 `step` 開頭、取訊息之前套用：`sync-response` 回執 `delivered` 才刪 offer 並以送出當時的幀起算 cooldown（回執未到前該 peer 視同冷卻中、不重送快照），未交付則保留 offer 並登記自動重送（[§7.1](#71-state-catch-up重連後對齊) 第 3 步）；`sync-request` 未交付且仍是目前等待的請求時，比照同步失敗取消並換下一位 voter。不得再以 `void` 表示舊測試 stub 的隱式成功；測試 double 也必須回傳實際布林值。fanout `RaceWirePort.sendRace` 仍是 best-effort `void`，各 peer 失敗隔離，不與定向送達契約混用。

> 殘餘風險：正常 `RaceWirePort.sendRace()` 對 mesh 一致廣播；但被攻陷的 peer 可繞過 API，對不同 DataChannel 選擇性傳送不同的「首個」signed input。單一觀測端若未同時看到兩值，無法立即證明 equivocation；現階段由後續 checksum 多數決 ／ 平手中止抓出分歧。若要即時證明，需新增跨 peer input commitment／ 回執協議，屬於後續 protocol 設計。

## 7. 中途斷線 / 重連

RaceMesh 對每個 remote 維護 `(peerId, 'race-mesh', generation, status)`；初連為 `online`，每次重連窗建立新 generation 的 `reconnecting`，恢復／逾時只能 transition 自己的 generation。舊 watcher 完成不得把較新的連線改回 `online` 或 `offline`。

```typescript
// mesh 端：pc 'disconnected'（WebRTC 暫態、常自癒）＝開 15s 重連窗（500ms 輪詢）而非即刻 forfeit
async function tryReconnect(disconnectedPeer: PeerId): Promise<boolean> {
  // RECONNECT_TIMEOUT_MS = 15_000
  const start = Date.now();
  while (Date.now() - start < RECONNECT_TIMEOUT_MS) {
    if (await isPeerConnected(disconnectedPeer)) {
      requestSync(disconnectedPeer);
      return true;
    } // 恢復＝發重連訊號
    await sleep(500);
  }
  return false; // 逾時 → 異常斷線
}
```

### 7.1 State catch-up（重連後對齊）

窗內連線恢復 ＝ 可靠通道自動重放在途訊息、短斷線由 rollback 窗修正，小幅穩態偏移由落後端快進回收（三人以上上界 D＋R、兩人場 2×`STATE_BUFFER_MAX_FRAMES`，[§7.5](#75-幀時鐘偏移與落後端快進)）；三人以上嚴格多數 lead 超過 D＋R 時本機自判越窗、改走本節 catch-up（[§7.5](#75-幀時鐘偏移與落後端快進)「越窗卡頓轉 catch-up」）；**落後過回滾窗者**另需 state 級 catch-up（分 tick 追趕、`front` 夾限與驗簽減量的取捨見 [D-20261029-03](../decisions/D-20261029-03-catch-up分tick追趕與落後端快進.md)）。訊號扇出鏈：`mesh` 重連窗恢復 → `onReconnect(peer)` 訊號 → 上層（race-session）催當前回合引擎 `rollback.requestCatchUp(peer)`（per-round 引擎；無進行回合 ＝no-op）：

1. 恢復端向全部遠端 roster peer 真定向送唯一 requestId 的 signed `sync-probe-request`；每個 responder 複製 pin 最多兩個已 final 的 8-frame 對齊 snapshot（[§3](#3-state-buffer)），回 signed `(frame,hash)` candidates。
2. requester 只以 frame 晚於本機目前幀的候選計票：較舊的候選不採用、不記 misbehavior（落後只略超過 D＋R 時，誠實 responder 兩個候選中較舊者可能早於本機，[D-20261030-05](../decisions/D-20261030-05-越窗卡頓改走catch-up.md)）；超出 current＋`CATCH_UP_MAX_ADVANCE_FRAMES`、未對齊 8 幀或 hash 格式不符者記 `invalid-catch-up`、整份 offer 不採用。同 `(frame,hash)` 達 strict remote quorum 後，只向第一位 voter 送含 `offerId/targetFrame/targetHash` 的 exact request；`CATCH_UP_REQUEST_TIMEOUT_FRAMES` 步逾時（先取消 transport pending）、壞 snapshot、不合格輸入日誌或第 5 步拒收時依序換下一 voter。逾時自最近一次進展起算（驗簽心跳與總上限的取捨見 [D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：尚未到達時自送出請求起算，之後每收到一則同一 correlation 的傳輸進度心跳 `sync-response-receiving`（第 4 步）再自該步起算；傳輸層回報 `sync-response-arrived`（外層簽章已驗、日誌仍在驗簽，第 4 步）後改自到達步起算；之後每收到一則同一 correlation 的日誌驗簽心跳 `sync-response-verifying`（第 4 步）再自該步起算。只要分段仍在到達、分片驗簽仍在推進就不會被逾時取消，停滯時照常逾時。尚未到達時，自送出請求起滿 `SYNC_RESPONSE_TRANSFER_MAX_STEPS` 步（＝`CATCH_UP_OFFER_TTL_FRAMES`，現值 900 步，[network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)）一律逾時：低頻寬下的大快照（例如 1 Mbps 傳約 1 MB 需數百步）可以傳完，但 provider 無法藉慢傳無限拖延。到達後，自到達起滿 `SYNC_LOG_VERIFY_MAX_STEPS` 步（＝ceil(`SYNC_INPUT_LOG_MAX_ENTRIES` × `SYNC_LOG_VERIFY_ENTRY_MAX_MS` × `FIXED_FRAMERATE_HZ` ÷ 1000)，現值 676 步，[network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)）一律逾時，provider 無法藉大日誌無限拖延。保證範圍：對第一位且誠實的 voter，單筆驗簽成本不超過 `SYNC_LOG_VERIFY_ENTRY_MAX_MS` 時最壞日誌也能在上限內驗完（涵蓋 WebCrypto 與 Firefox 主執行緒 noble）；更慢的 noble 環境（例如 Chromium 4× 降頻約 2.34 ms／筆）驗最壞日誌仍會逾時換人。整個 catch-up 另受 offer TTL 限制：各 voter 的 offer 在 probe 時 pin、自 pin 起 `CATCH_UP_OFFER_TTL_FRAMES` 幀後過期，前面的 voter 拖得愈久，後面的 voter 愈可能已無法回應。上限不得長於 offer TTL 也是這個原因；快照階段本機照常 step，與前緣的落後量不隨驗簽步數累加。
3. responder 只從 900 幀 TTL 的 bounded offer cache 回 exact snapshot，並附**簽章輸入日誌**：每 peer 在 F 之前最後一筆已受理真值（預測延續基準），加上 [F, front) 的全部已受理真值；front＝responder 回應當下的模擬幀，front < F（responder 自己已倒退到 F 之前）或 front − F 超過 `SYNC_INPUT_LOG_MAX_SPAN_FRAMES`（`CATCH_UP_OFFER_TTL_FRAMES` ＋ `STATE_BUFFER_MAX_FRAMES`）即不回應。每筆保留原發送者的 input 簽章；responder 自己的輸入由傳輸層以回合鑰補簽（Ed25519 決定性，與當初廣播的簽章相同），替其他 peer 補簽一律拒送。為此 responder 保留已受理真值與原簽章直到最舊 pinned offer 幀。
   - **重送**：sync-response 同步送出回 false、拋例外，或非同步回執 `delivered:false`（[§6](#6-datachannel-二進位序列化)）時，responder 保留 offer 並登記重送：第一次在下一步、之後每隔 `SYNC_RESPONSE_RESEND_SPACING_STEPS` 步，在收訊開頭重跑同一請求的應答流程（重建日誌、重新簽章），最多 `SYNC_RESPONSE_RESEND_LIMIT` 次（[network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)）。requester 不在 roster、offer 已過期或被取代，或 cooldown 已成立即放棄；同一 drain 對同一 peer 只應答一次，新到的同 peer 請求取代待重送者、次數重計。重送成功才刪 offer 並進 cooldown。不新增 wire（重送的是同型 sync-response），requester 不必等逾時換人。
   - offer TTL 與 sync-response 冷卻以 responder 的模擬幀計；responder 自己正在追趕（第 6 步）時這些計時會提早到期，只會少回應、不會回錯。
4. requester 的傳輸層先驗外層簽章，驗過即對模擬端送內部訊息 `sync-response-arrived`（非 wire；保證入佇列），引擎以該步作為到達步：逾時自此起算（第 2 步），日誌驗簽耗時不計入 RTT。接著逐筆以原發送者公鑰驗日誌：
   - **傳輸進度心跳**：sync-response 分段傳輸期間（[§6.1](#61-應用層分段issue-001093)），index 0 開頭對上現行 correlation 的訊息每收到一段，傳輸層對模擬端送內部訊息 `sync-response-receiving`（非 wire、保證入佇列；兩次 drain 之間每個 provider 至多一則；correlation 取消或被取代後不再產生），引擎只認目前 pending、尚未到達的同一 correlation，據此順延逾時（第 2 步）。段內容未驗簽，但來源由 DataChannel 綁定；可順延的總長以 `SYNC_RESPONSE_TRANSFER_MAX_STEPS` 封頂。
   - **傳輸時間**：到達通知附本機量得的傳輸時間 `transferMs`（§6.1 的估計值；未分段時省略＝0）。引擎換算成固定步數 round(`transferMs` × `FIXED_FRAMERATE_HZ` ÷ 1000)，再以「送出請求到到達」經過的步數封頂，記為傳輸步數；`rttFrames`＝到達步 − 送出請求步 − 傳輸步數。傳輸時間是 provider 送出快照之後、live peers 照常前進的時間，改以順延 front 計入（第 5 步），不灌進 RTT。量測只在接收端進行，wire 不變；幀號以既有的固定步時鐘對齊（[§7.5](#75-幀時鐘偏移與落後端快進)）。
   - **快取跳過**：已驗過的 `(peer, frame, digest, signature)` 記在已驗快取（live 路徑驗過的遠端 input、本機簽出的 input、先前驗過的日誌條目；同 `(peer, frame)` 只保留首筆），日誌條目 digest 與簽章逐位元組相同即跳過驗簽，差一 byte 即照常驗簽。快取以已見最大幀 − `SYNC_INPUT_LOG_MAX_SPAN_FRAMES` − 2×`STATE_BUFFER_MAX_FRAMES` 修剪，不收超過本機最近簽出幀＋`CATCH_UP_MAX_ADVANCE_FRAMES`＋2×`STATE_BUFFER_MAX_FRAMES` 的條目。快取只省驗簽成本，不影響任何判定。
   - **本機輸入比對**：本機簽出 input 時即寫入快取，日誌中的本機條目因此以逐位元組比對取代驗簽。
   - **分片**：其餘條目逐筆驗簽，每筆驗完檢查本片已耗時（含 noble 複核），達 `SYNC_LOG_VERIFY_SLICE_MS` 即讓出主執行緒（以 `MessageChannel` 觸發下一片，環境沒有時退回 `setTimeout(0)`），每片至少一筆。分片期間其他 peer 的 live input 照常驗簽與交付。
   - **驗簽心跳**（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：每驗完一片、讓出主執行緒之前，若 correlation 仍為現行，傳輸層對模擬端送內部訊息 `sync-response-verifying`（非 wire、保證入佇列），引擎據此順延逾時（第 2 步）。心跳綁定 provider、requestId 與 target，只由外層簽章已驗的現行 job 產生，兩次 drain 之間每個 job 至多一則；沒有推進、correlation 取消或被取代、回合收攤後都不再產生。
   - **交付順序**：日誌驗完才把 sync-response 放入到達順序佇列尾端（排在此刻之前已到達、仍在驗簽的訊息之後），本體保證入佇列；回合收攤（transport dispose）或 correlation 已取消、被新請求取代時中止、不交付。同一 correlation 重複到達不重驗。
   - 任一筆無公鑰或驗簽失敗，整份日誌不採用（以 `inputLog: null` 交付），與日誌語意不合格（非 roster、違反車輛 schema、front 跨度、frame < D）同樣記 `invalid-catch-up` 並在同一步換下一位 voter。不收進任何未簽的遠端輸入。驗過的日誌條目寫入快取，下一次 catch-up 不重驗。
5. bytes hash 與內外 frame 核對通過後，先決定追前緣目標，再經 side-effect-free inspect 原子 load F：
   - **參考幀**：本次 catch-up 發起（重連或自動）或背景恢復之後收到的各遠端觀測進度（input 幀扣 D、checksum 幀原樣，同 peer 取最大）中，排除 provider 後取嚴格多數第 k 大（k＝floor(n/2)+1，n＝非 provider 遠端人數；與 [§7.5](#75-幀時鐘偏移與落後端快進) 的 `quorumLead` 同口徑），少數同謀以超前 input／checksum 抬不動參考幀，provider 自送的超前觀測也不計入。超過本機 current＋`CATCH_UP_MAX_ADVANCE_FRAMES`＋`CATCH_UP_MAX_OBSERVED_AHEAD_FRAMES` 的觀測收到時即不採計，取參考幀時再濾一次。除 provider 外沒有其他遠端時改以對 provider 本身的觀測為參考；兩人場依 §7.2 本就不 catch-up（probe quorum 需兩張遠端票），此規則僅防禦性。
   - **暫無參考**：有效新觀測不足 k 名時保留已驗回應，之後每步以新觀測重判，自交付起最多保留 `CATCH_UP_REQUEST_TIMEOUT_FRAMES` 步，逾時放棄本次 attempt；不記 provider `invalid-catch-up`。
   - **`front` 夾限**：front 先依傳輸步數（第 4 步）與到達後經過的步數順延（provider 與 live peers 在快照傳輸期間與到達後同樣前進；日誌權威段仍以原 front 為準），須落在 [參考幀 − `CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES`, 參考幀＋M] 內（M＝D＋R，固定、不隨 RTT 放寬）。灌高（`front-ahead-of-observed`）或壓低（`front-behind-observed`）都在同一 attempt 換下一位 voter，**不記** provider `invalid-catch-up`：參考觀測陳舊或傳輸量測誤差都可能讓誠實 provider 越界，越界本身無法證明 provider 不誠實。下界依據：延遲不為負，大快照多出的傳輸時間已由順延補回，誠實 front 與參考幀之差只來自單程延遲的抖動差，下界容差取實測誠實最小值再減 1（量測情境與值見 [network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)）。上界不因順延放寬：傳輸步數不超過送出請求到到達實際經過的步數，順延後的 front 仍須 ≤ 參考幀＋M；provider 刻意放慢傳輸，只換得與誠實慢速 provider 相同的順延，目標仍被夾在參考幀＋M。
   - **追前緣目標** T＝min(front＋round(max(0, `rttFrames`)／2), 參考幀＋M)：live peers 在回應抵達前約再前進一個單程延遲；上限使 provider 延遲回應灌大 RTT 也無法把恢復端推到全場前緣之外。
   - **守門**：T ≤ 本機目前幀時不載入；此時參考幀仍領先本機超過 R 表示 front 偏低（與 `front-behind-observed` 同性質），換下一位 voter、不記 misbehavior，否則本機確實已不落後，靜默結束本次 attempt（不記 misbehavior）。F 早於本機目前幀而 T 晚於本機時照常載入（**倒退載入**：等待回應期間本機越過 F 屬正常）；T 晚於本機也保證之後的本機排程幀晚於舊時間線已送出者（簽章 nonce 單調）。載入拋錯同樣記 `invalid-catch-up` 並換 voter。
   - **重建輸入時間線**：F 之前的延續基準與 [F, front − R) 以日誌為唯一權威（responder 已不可能再改），本機在此區間但不在日誌中的舊輸入捨棄；front − R 起併入本機已持有與 catch-up 期間有界暫存的真值，同 `(peer, frame)` 以日誌為準。為此，快照階段（自選定 commitment 起，含傳輸、日誌驗簽與暫無參考保留）本機的已受理真值自 F 起不依回滾窗修剪：慢速傳輸時本機可能在等待中越過 provider 的 front 數十到數百幀，倒退載入要靠這些真值補上 [max(F, front − R), current)。保留期受傳輸與驗簽總上限及 offer 保留期約束，有界。任何同 `(peer, frame)` 的兩份已簽值相異，記 `input-equivocation` 並比照 live 路徑升級。對齊後落在未來窗外的真值放回暫存（第 6 步晉升）。
   - **倒退載入的保護**：（1）已投 checksum 輪不重投：引擎記錄已廣播本機票的 checksum 幀（修剪 < current − `CHECKSUM_PAST_HORIZON_FRAMES`），重播再經過這些幀時不記暫定 hash、不廣播，否則對端會把本機的兩張票判成 checksum equivocation；（2）本機在 F 之後記錄、尚待裁定的 checksum 票刪除，不再拿來自判，連續失配計數不歸零（計數只來自真正裁定過的輪；本機自判越窗的 catch-up 例外，見 [§4](#4-checksum-去同步偵測)）；（3）已確定串流的 `reset(F)` 可早於已發出記錄，回合共識錨與觀戰來源丟棄 F 之後的舊值（[§4.1](#41-已確定步進串流)）。
   - 任何 catch-up 成功（前進或倒退）都作廢本機擔任 provider 時 pin 住的 offer 與待重送：已受理真值與基準已換成新時間線，舊 offer 的日誌無法再完整重建；向本機索取的 requester 由逾時換人。同時清空落後觀測、參考幀觀測與持續落後計數。
6. **載入後依牆鐘預算分 tick 追趕**：載入當步 current＝F，同一步只模擬 F 一幀；之後追到 T 的工作由 `RaceLoop` 分散到多個 tick。追趕使用與平常相同的快照、checksum 與已確定記錄規則；已確定串流先發 `reset(F)`（[§4.1](#41-已確定步進串流)）。
   - **預算**：本 tick 至少跑過一個固定步、且固定步數未達 `MAX_SUBSTEPS` 時，`RaceLoop` 在 `CATCH_UP_CHASE_TICK_BUDGET_MS` 內重複推進追趕幀（預算自 tick 開始計，已含本 tick 固定步耗時），至少一幀；沒有固定步或固定步達 `MAX_SUBSTEPS`（裝置跟不上）的 tick 不追趕。追趕幀不收訊、不寫本機輸入、不回報每幀實付（[§8](#8-效能預算三層口徑)），也不出 render 步。
   - **目標前進**：追趕期間的正常 step 照常收訊並前進一幀，live peers 同時也前進一幀，T 同步加一；差距只由追趕幀縮小。current ≥ T 時結束追趕；載入時已在 T 上則不進入追趕。
   - **本機輸入**：進入追趕時，載入當步與追趕期間的 step 都不排程、不廣播本機輸入（載入時已在 T 上則照常排程於 F＋D）。event 型按鍵公告丟棄，hold 由下一次取樣重建，pending leave 保留到第一個真正排程的步（[§7.4](#74-主動離場流內-leave)）。追趕結束後第一個排程幀＝結束時的 current＋D。本機在對齊前已送出、排程幀 ≥ max(F, front − R) 的輸入照常套用，較早者以日誌為準、不補發，`RaceLoop` 也不公告這些較早排程的技能生效。本機排程幀嚴格遞增（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：current＋D 不晚於已送出過的最大排程幀時，該步不排程、不廣播本機輸入（倒退載入後追趕提前結束時可能發生），否則同幀兩份相異已簽值會被他人判為 equivocation。追趕期間畫面持續更新，但本機無法操作。本機自判越窗（[§7.5](#75-幀時鐘偏移與落後端快進)）時，自判定起（含 probe 與快照階段）同樣不排程本機輸入、不投 checksum 票，處置相同，直到對齊並結束追趕。
   - **暫存晉升**：catch-up 進行中（probe、快照階段或追趕中）超出未來窗的已驗遠端輸入進有界暫存（上界 current＋`CATCH_UP_MAX_ADVANCE_FRAMES`＋2×`STATE_BUFFER_MAX_FRAMES`，同 `(peer, frame)` 首值鎖定、相異即 equivocation）；每前進一幀（含追趕幀），把 frame ≤ current＋2×`STATE_BUFFER_MAX_FRAMES` 的暫存條目晉升進 InputBuffer。沒有進行中的 catch-up 且對齊時放回的條目已全部晉升時清空暫存。
   - **lag 暫停**：追趕中不累計也不歸零持續落後（[§7.3](#73-持續落後自我驅逐)）、不啟動自動 catch-up、不判定不可恢復 lag（只記觀測）、不快進（[§7.5](#75-幀時鐘偏移與落後端快進)），也不受理新的 catch-up 請求（對齊已有 quorum 背書、追趕本身在收斂；結束後若仍落後由既有流程處理）。追趕結束時清空最大 lead 統計與持續落後計數。
   - **追趕無進展期限**（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：lag 暫停的例外。每個正常 step 量一次追趕差距（T − current）；差距低於追趕期間的最小值即視為有進展，期限自該步重新起算。連續 `PERSISTENT_LAG_DEMOTE_FRAMES` 個正常 step 差距都沒有縮小，才單次通知 `onPersistentDesync('lag')` 自我退出（`lag-evicted`，§7.3）。典型情境是單步成本超過一個固定步的裝置：每個 tick 固定步都達 `MAX_SUBSTEPS`、從不推進追趕幀，差距恆定。差距仍在縮小時不論追了多少步都不退出（例如每 tick 只推進 1 個追趕幀的慢裝置）。正常 step 不會讓差距變大；差距只在背景恢復時加大，超過 `CATCH_UP_MAX_ADVANCE_FRAMES` 時走不可恢復 lag（見下方「背景恢復」）。
   - **不擔任 provider**（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：追趕中收到他人的 `sync-probe-request` 不 pin offer、不回應，不參與 quorum；否則日誌 front＝落後的 current，requester 會判 `front-behind-observed`、記誠實者 `invalid-catch-up` 並多等一個 RTT 換人。追趕結束後照常回應。
   - **背景恢復**（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：追趕中切到背景再回前景時，T 加上隱藏期間換算的幀數後距本機超過 `CATCH_UP_MAX_ADVANCE_FRAMES` 即走不可恢復 lag（§7.2）。隱藏不超過 `CHASE_SUSPENSION_MAX_FRAMES`（24 幀，推導見 [network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)）時 T 加上隱藏幀數、繼續追趕；無進展期限記錄的最小差距同步加上隱藏幀數，差距因隱藏加大不會被誤判為停滯。更長時，隱藏期間不 drain，傳輸層每 peer 已驗佇列（`VERIFIED_QUEUE_MAX_MESSAGES_PER_PEER`）可能已丟棄較新的 live input，只延長 T 會以預測模擬被丟棄的幀而與全場分歧；因此結束追趕，改以自動 catch-up 重新對齊。自動 catch-up 冷卻中不立即發起，由 §7.2 的落後觀測在冷卻結束後發起。
   - **時基**：requester 端的 RTT、probe 與快照逾時、追趕無進展期限、自動 catch-up 冷卻（`CATCH_UP_PROBE_REPLACE_AFTER_FRAMES` 步；本機自判越窗發起者不受此限）都以本機 step 數計（只由 step 遞增，追趕幀與載入跳號不計）。快進追加步（§7.5）也走 step，同樣計入（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）；probe 階段不暫停快進，該階段的逾時與重送牆鐘長度可能略短，probe 會重試，功能無害。

**驗簽器**（issue 001118，[D-20261029-03](../decisions/D-20261029-03-catch-up分tick追趕與落後端快進.md)）：回合訊息（input、checksum、四種 catch-up 訊息與日誌條目）在主執行緒以非同步 Ed25519 驗簽器驗證，不移入 Worker（[§5.1](#51-執行緒配置模擬-worker)）。環境支援 Ed25519 WebCrypto 時先以 `crypto.subtle.verify` 驗，WebCrypto 接受且簽章 S < L 才採用；拒絕或拋錯一律以 noble（`@noble/curves`，RFC 8032 嚴格模式，[D-20261030-02](../decisions/D-20261030-02-Ed25519改RFC8032嚴格驗簽.md)）複核，以 noble 結果為最終判定。WebCrypto 為 cofactorless 方程式，且不一定拒小階或非正規編碼的公鑰（Node 實測會接受），所以只有通過身分公鑰檢查的公鑰才交 WebCrypto，其餘直接由 noble 判定；回合公鑰在 `key` 宣告入口已拒收這類公鑰。在此前提下接受集合與 noble 相同，各瀏覽器判定一致：以 001118 的語意對照語料（2518 筆）在嚴格模式重跑，最終判定逐筆與 noble 相同，noble 只接受 1000 筆合法簽章；Node 的原生 WebCrypto 另接受 14 筆小階或非正規編碼公鑰的簽章，這些公鑰都被身分公鑰檢查擋下、不會走 WebCrypto。支援偵測以固定向量進行：RFC 8032 合法向量必須接受，竄改簽章、竄改訊息與 S＋L 三個負向向量必須拒絕；任一不符、拋錯或逾時即整個環境改用 noble。單筆 WebCrypto 超過 `SIGNATURE_VERIFY_TIMEOUT_MS` 未完成時，該筆改由 noble 判定，該回合的驗簽器之後一律改用 noble。CryptoKey 依公鑰快取（import 失敗不快取）。Chromium 的 WebCrypto Ed25519 在呼叫執行緒同步執行，所以日誌仍須分片（第 4 步）。非同步驗簽下每則收件依到達順序取得交付位置，只交出最前面一則未完成者之前的已完成前綴，驗簽失敗者不占位；sync-response 例外見第 4 步。簽章格式與 digest 不變。

八人 mesh 驗證：一人凍結斷線 300 tick 後 catch-up，對齊當下 live peers 已超過 F+D+R；catch-up 後單向延遲 1..6 幀抖動時，12 個 seed 在對齊後約 1800 幀內每輪 checksum 八票逐位元一致、無 desync。

**已知限制**：

- 惡意 provider 對單一 voter 的最壞拖延（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：先以慢速分段把傳輸拖到 `SYNC_RESPONSE_TRANSFER_MAX_STEPS`（900 步）前一刻才傳完，再送外層簽章合法、最後一筆日誌無效的最大日誌，讓驗簽拖到 `SYNC_LOG_VERIFY_MAX_STEPS`（676 步）；同時沒有參考幀時再加最多 `CATCH_UP_REQUEST_TIMEOUT_FRAMES` 步保留。拖延有界（voter 至多 n−1 位）且只傷害恢復端，但快照階段持續落後不累計，恢復端的驅逐也隨之推遲。單一惡意 voter 最多約 899＋676≈1575 步，遠超 offer TTL（900 幀），排在其後的誠實 voter 的 offer 可能都已過期而不回應，整個 attempt 失敗；冷卻後重新 probe 時惡意者可能再次排第一。只拖傳輸（不靠大日誌）時約 899 步，同樣可能耗盡後面 voter 的 offer 壽命。
- `front` 越界不記 misbehavior：惡意 provider 反覆回越界的 front 不會累積 `invalid-catch-up`，只讓恢復端每次多等一個往返加傳輸時間後換人；壞簽、壞 hash、不合格日誌與載入失敗仍記。
- 傳輸時間只在接收端量測：第一段自身的傳輸時間以其後各段的平均速率外推（sync-response 以 16 KiB 分段，外推部分很短），頻寬在傳輸中劇烈變動時估計仍可能偏差；未分段（≤ 16 KiB）的回應不量測。偏差使順延後的 front 越界時只換 voter，不影響其他 peer。
- 反覆短暫切換：catch-up 進行中（probe、快照請求或暫無參考保留）每次回到前景都取消並重新發起（§7.2），即使只隱藏一幀；反覆短暫切到背景再切回，可能讓 catch-up 一直無法完成，最後由持續落後以 lag 退出。
- 追趕沒有絕對總上限：無進展期限只在差距連續 `PERSISTENT_LAG_DEMOTE_FRAMES` 個正常 step 沒縮小時觸發，差距每創新低即重新起算，慢但持續推進的裝置最壞可在追趕中停留約「初始差距 × `PERSISTENT_LAG_DEMOTE_FRAMES`」步，期間無法操作。追趕中不擔任 provider（第 6 步），3 人場時另兩人中任一人追趕，第三人的 catch-up probe 就湊不到 quorum（需兩張遠端票），要等追趕結束；等待超過持續落後門檻時，第三人在 probe 失敗後以 lag 退出。
- 日誌只來自單一 provider、沒有 quorum 背書：簽章防偽造，但防不了刻意漏筆或竄改。前提是 `front` 已依第 5 步夾限，漏筆或竄改只會讓恢復端與全場分歧並由 checksum strike 自我驅逐，不影響其他 peer；provider 延遲回應灌大 RTT 時同樣只會讓恢復端被驅逐（issue 001107）。
- 前緣估計誤差只剩超前誤差：落後誤差由 §7.5 快進回收；catch-up 高估前緣時恢復端領先全場，本機不暫停步進、不修正，超過容忍即由 checksum strike 自我驅逐（issue 001104，[D-20261029-03](../decisions/D-20261029-03-catch-up分tick追趕與落後端快進.md)）。
- catch-up 後單向延遲抖動只保證 1..6 幀（上段驗證）；抖動上限等於 D＋R（1..8）時容忍裕度為 0，偏移 ±1 幀即分歧——超前時恢復端單獨被驅逐，低估時誠實 peer 之間可能 tied。根本解需以 wire 交換 frame advantage（issue 001127）。

**Fail-closed**：所有 offer/target/hash/snapshot/inputLog 關聯欄位均納入 Race Sign Key digest。無共同同值 offer、cache quota/TTL 超限、無足夠遠端票（含 2 人場）或所有 voters 均失敗，一律維持原狀。所有 catch-up 類型與大型 snapshot 一律使用真 unicast。

### 7.2 背景分頁造成的本機落後

正式賽的 `requestAnimationFrame` 在背景分頁可能停止，因此 render clock 不得被當成「全網仍同步」的證據。Rollback 收件端在套用 future-window admission 前，按 roster peer 單調記錄當次觀測到的最大遠端 lead：任一合法 peer 顯示本機落後超過 `STATE_BUFFER_MAX_FRAMES × 2`（24 幀）且不超過 `CATCH_UP_MAX_ADVANCE_FRAMES`（900 幀）時，最多啟動一個既有 quorum catch-up；載入門檻、hash 驗證與 bounded snapshot 規則完全不變。落後在 (R, 24] 幀的穩態偏移：兩人場由 [§7.5](#75-幀時鐘偏移與落後端快進) 的落後端快進回收；三人以上嚴格多數 lead 在 (R, D＋R] 時快進，超過 D＋R 時本機自判越窗並立即發起同一套 catch-up（§7.5「越窗卡頓轉 catch-up」，先於本段判定，不受自動 catch-up 冷卻限制）。catch-up 追趕中（§7.1 第 6 步）只記觀測、不啟動 catch-up、不判定不可恢復 lag。超過 900 幀時，只有 `floor(全名單/2)+1` 個遠端 peer 的獨立觀測共同成立，才可判定本機已超出安全恢復窗，單一 peer 不得藉 future frame 強迫觀測方退賽。

瀏覽器 `visibilitychange` 轉回可見時另以本機時鐘計算隱藏期間並立即處理：≤24 幀不動作；三人以上、25–900 幀催既有 catch-up；>900 幀走 `persistent-desync` 自我驅逐。2 人場因只有唯一遠端、既有 strict quorum 必然無法成立，隱藏超過 24 幀即自我驅逐，不接受唯一對手未經交叉背書的快照。catch-up 進行中（probe、快照請求或暫無參考保留）回到前景時，不論隱藏多久都取消並重新發起 catch-up（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：已到達或保留中的回應以本機 step 數順延 front，隱藏期間 step 數不增會低估前緣，誠實 provider 會被誤判；超過 900 幀或 2 人場隱藏超過 24 幀仍自我驅逐。追趕中的背景恢復見 §7.1 第 6 步。local-test 只把可見性轉為暫停／恢復，切背景等同暫停。模擬在 Worker 時，可見性變化由主執行緒主動轉送（§5.1）。

### 7.3 持續落後自我驅逐

裝置或網路持續跟不上的 peer 由自己退出，不拖住全房（issue 001040，[D-20261028-03](../decisions/D-20261028-03-輸入延遲有界回滾與模擬Worker.md)）：

- **最近 lead**：每個遠端以最近觀測到的模擬進度幀（input 幀扣 D、checksum 幀原樣，同 peer 取最大）減本機目前幀。對端停送時此值隨本機前進遞減，斷線者不會被當成持續領先；與 §7.2 的最大 lead 統計分開。
- **判定**：每個本機幀評估一次。嚴格過半遠端（`floor(遠端數/2)+1`）**且**至少兩名遠端的最近 lead > R 時累計，任一幀不成立即歸零；連續達 `PERSISTENT_LAG_DEMOTE_FRAMES`（300 幀、5 秒，[network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)）即單次通知 `onPersistentDesync('lag')`。已升級不可恢復 lag 時不再評估。
- **兩人場永不觸發**：lead 來自對端自簽的幀號，單一 peer 可任意灌高，不得單獨逼退對手；代價是兩人場的慢端仍會拖慢對手。
- **與快進的關係**：最近 lead 與 [§7.5](#75-幀時鐘偏移與落後端快進) 落後端快進同口徑（以最近一步收訊時的幀計）；穩態落後先由快進回收（三人以上 lead 超過 D＋R 時改走自判越窗 catch-up），追不回、持續落後才由本節驅逐。已上報持續落後或不可恢復 lag 後不再快進、也不再自判越窗。
- **與 catch-up 的關係**：catch-up 已取得多數背書、正在索取或載入快照（快照階段），以及載入後分 tick 追趕期間（[§7.1](#71-state-catch-up重連後對齊) 第 6 步）都不累計也不歸零；對齊成功與追趕結束時歸零。追趕本身有無進展期限（[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：追趕差距連續 `PERSISTENT_LAG_DEMOTE_FRAMES` 個正常 step 沒有縮小（差距每縮小一次即重新起算），視同持續落後，單次通知 `onPersistentDesync('lag')`，跟不上的裝置不會停在無法操作的追趕狀態；差距持續縮小的慢裝置照常追完並歸零。probe 階段照常累計，但達門檻時延後到 probe 有結果：成功進入快照階段即續暫停，失敗或逾時才驅逐。自判越窗發起的 catch-up（§7.5）適用同一規則。
- **處置**：結束原因 `lag-evicted`。沿用驅逐收攤（本機停模擬、送 control `leave`〔reason `'desync'`〕並退出回合；對端只記斷線〔forfeit〕，不影響終局），同一步內不得再以已確定記錄終局；但**不是 desync**——不自報 `DesyncEvent`、不計入 desync 統計、不轉紅 desync 燈號、不終止觀戰 hub。結束畫面提示可回房以觀戰者身分觀看，不自動重新加入。
- local-test 不建立 RollbackEngine，不適用。

### 7.4 主動離場（流內 leave）

玩家主動離場時，離場本身必須落在已簽輸入流的確定幀上，所有 peer 才會在同一幀把該車視為退出（issue 001117，[D-20261029-01](../decisions/D-20261029-01-回合終局一致性.md)）：

- **適用範圍**：只有使用者主動 abort、且 match 回合已 GO 尚未終局時才走流內 leave。回合之間、GO 前、local-test、`failSession`、分割作廢、賽前取消與自我驅逐都不等 flush，直接走傳輸層離場；對端記為斷線。
- **送出**：主執行緒送 `leave-round` 給模擬端，`RaceLoop.requestLeave` 讓下一步的本機輸入只含 leave，之後恆為空輸入。leave 的排程幀＝該步實際模擬幀＋D；catch-up 載入後進入分 tick 追趕時，載入當步與追趕期間的步不排程本機輸入，leave 保留到追趕結束後第一個真正排程的步，排程幀＝追趕結束時的幀＋D（[§7.1](#71-state-catch-up重連後對齊) 第 6 步），與技能輸入同樣廣播與簽章。
- **生效**：各 peer 的引擎在步進該排程幀時寫入該車 `quitAtFrame`，受 rollback 與快照保障（[physics-engine.md §2.10](physics-engine.md)）。
- **flush**：已確定記錄的幀超過排程幀，或 stepper 幀 ≥ 排程幀＋`STATE_BUFFER_MAX_FRAMES` 時，模擬端回覆 `leave-flushed`；每次 `leave-round` 只回一次。local-test、未開始步進或已結束的回合立即回覆。
- **等待上限**：主執行緒最多等 2×ceil((`INPUT_DELAY_FRAMES`＋`STATE_BUFFER_MAX_FRAMES`)×1000／`FIXED_FRAMERATE_HZ`) ms（60 Hz 時約 600 ms），由既有常數推得；模擬端 fatal 時提前放行。之後才送 control `leave`（reason `'voluntary'`）並收攤連線。等待期間收到的 `round-end` 不通知終局 listener、不定稿回合。
- **跨回合**：`round-end` 附 `quitPeers`（終局視圖中已流內離場者，依 PeerId 排序）；主執行緒累加後填入下一回合 `RoundBuildRequest.quitAtStart`，模擬端在 frame 0 第一次 step 前以 `markQuitAtStart` 標記。
- **傳輸層離場與斷線**：control `leave`、ICE 斷線與重連窗逾時只寫入結算的 `disconnects`（forfeit），不通知模擬端；斷線車照常以 Hold 延續的預測輸入模擬。

> 重連 / 斷線處理設計（重連沿用原 loadout 防偷換、開賽前退出無懲罰、賽中斷線 30 frame 容忍）見 [賽內機制.md §4](../賽內機制.md) 與 [matchmaking.md § 重連時的 loadout 處理](matchmaking.md)。

### 7.5 幀時鐘偏移與落後端快進

本節是幀時鐘偏移回收的**單一權威**；常數值見 [network.md §8.2](../程式參數/network.md#82-networklocal-policy本機處置政策)。peer 因卡頓（固定步達 `MAX_SUBSTEPS` 時丟棄累積時間）或 catch-up 低估前緣而落後時，若不回收，偏移會持續吃掉 (D+R)×T 的延遲容忍（issue 001104，[D-20261029-03](../decisions/D-20261029-03-catch-up分tick追趕與落後端快進.md)）。回收只改本機步進節奏，不改 wire、快照或 hash。

- **lead 口徑**：沿用 [§7.3](#73-持續落後自我驅逐) 的最近 lead（各遠端最近觀測進度：input 幀扣 D、checksum 幀原樣，同 peer 取最大），以最近一步收訊時的幀計，與持續落後判定同口徑。`quorumLead`＝各遠端 lead 的第 k 大值（k＝floor(遠端數/2)+1，至少 k 名遠端的 lead ≥ 此值）；觀測數 < k 時視為無值，少數 peer 自簽灌高的幀號不影響結果。
- **快進上界**：三人以上為 D＋R，超過即改走下方「越窗卡頓轉 catch-up」、不快進（[D-20261030-05](../decisions/D-20261030-05-越窗卡頓改走catch-up.md)）；兩人場為 2×`STATE_BUFFER_MAX_FRAMES`，超過屬 [§7.2](#72-背景分頁造成的本機落後) 的 catch-up 範圍（兩人場實際無法 catch-up）。
- **兩人場也快進**：k＝1，唯一對手即多數。對手灌高幀號最多讓本機快進到 lead 2×`STATE_BUFFER_MAX_FRAMES` 以內；§7.3 的兩人場例外（永不驅逐）不變。
- **遲滯**：`quorumLead` > R 時啟動；啟動中每 tick 建議額外步數＝min(`CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS`, `quorumLead` − `CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES`)。`quorumLead` ≤ `CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES`、超過快進上界或無值時停止並回 0。
- **詢問時機**：`RaceLoop` 只在本 tick 跑過至少一個固定步、且固定步數未達 `MAX_SUBSTEPS` 時，於固定步之後詢問一次並追加建議步數。沒有固定步的 tick 不問：建議以最近一步收訊的口徑計，重複詢問會超調。固定步已達 `MAX_SUBSTEPS` 表示裝置跟不上，追加只會讓 tick 更慢。
- **不快進**：持續落後或不可恢復 lag 已上報、catch-up 快照階段（已選定 voter、正在索取或等待載入）、載入後分 tick 追趕期間（[§7.1](#71-state-catch-up重連後對齊) 第 6 步，追趕預算取代快進），或本機自判越窗期間；此時遲滯狀態重設。catch-up 對齊時也重設。
- **額外步是正常模擬步**：走一般 `step()`，照常收訊、照常取樣並送出本機輸入、依前緣規則存快照（不繞過 `shouldSaveBeforeStep`）、計入每幀實付，也計入 catch-up requester 的 step 時基（[§7.1](#71-state-catch-up重連後對齊) 第 6 步「時基」，[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）；遲到輸入觸發的回滾仍 ≤ R。額外步不動 accumulator，`renderAlpha` 照固定步計算。
- **不回收超前**：catch-up 高估前緣時恢復端會領先全場，本機不暫停步進、也沒有任何超前回收機制；超出容忍時由 checksum strike 處置（[§7.1](#71-state-catch-up重連後對齊) 已知限制）。
- **越窗卡頓轉 catch-up**（三人以上，[D-20261030-05](../decisions/D-20261030-05-越窗卡頓改走catch-up.md)）：快進只回收時鐘偏移，救不回已越過他人受理窗的輸入。單次卡頓 s 幀、單程延遲 L 時：（甲）s＋L > D＋R，落後端恢復後的首批輸入到達他人時已過舊而被丟棄；（乙）s − L＋D > 2×`STATE_BUFFER_MAX_FRAMES`，他人的輸入超出落後端的未來窗而被丟棄。兩者都讓落後端與全場分歧。
  - **偵測**：每次正常 step 收訊後，`quorumLead`（以該次收訊時的幀計）> D＋R 即判定越窗：下一筆排程幀 c＋D 早於嚴格多數遠端目前幀 − R，即使單向延遲為 0 也已過舊；（乙）的門檻 2×`STATE_BUFFER_MAX_FRAMES` − D 高於 D＋R，同一條件涵蓋。以嚴格多數計，少數 peer 自簽灌高的幀號不會單獨觸發；不新增常數。已上報持續落後或不可恢復 lag、或 catch-up 追趕中時不判定。
  - **處置**：判定成立時停止排程與廣播本機輸入（處置同 [§7.1](#71-state-catch-up重連後對齊) 第 6 步：event 型按鍵公告丟棄、hold 由下一次取樣重建、pending leave 延到第一個真正排程的步），不快進，並在沒有進行中的 catch-up 時立即以 §7.1 的 quorum probe 發起 catch-up。發起不受自動 catch-up 冷卻（`CATCH_UP_PROBE_REPLACE_AFTER_FRAMES` 步）限制，短時間內連續卡頓時每次都可立即發起；單航班不變：已有 probe、快照請求、暫無參考保留或追趕進行中時沿用進行中的那一次。quorum、快照驗證、`front` 夾限、追趕與期限規則全部沿用 §7.1，不新增 wire。
  - **解除**：暫停持續到 catch-up 對齊並結束分 tick 追趕，之後照常排程，排程幀＝追趕結束時的幀＋D。catch-up 未發起或失敗後，`quorumLead` 回到 ≤ D＋R（或無值）才恢復排程與投票；仍 > D＋R 則立即重新發起。
  - **checksum**：判定起到對齊並結束追趕不投票、丟棄暫定 hash；成功時清除本機 strike（[§4](#4-checksum-去同步偵測)）。
  - **兩人場維持現行行為**：probe 需 floor(全名單／2)＋1 張遠端票，兩人場只有一名遠端，且不接受唯一對手未經交叉背書的快照（§7.2），catch-up 無法進行；越窗時本機不改變輸入、checksum 與快進行為（快進上界仍為 2×`STATE_BUFFER_MAX_FRAMES`），仍可能因 checksum 分歧而結束。
- **限制**：lead 以遠端自簽進度計，恆比真實進度舊約一個單程延遲 L。偵測條件不含 L，所以 `quorumLead` ≤ D＋R 但 `quorumLead`＋2L > D＋R 時偵測不到，輸入照樣越窗，由 checksum strike 處置。同理，快進停在 `CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES` 會殘留真實落後約 L；2L > D＋R 時落後端之後的輸入到達他人時都已過舊。自判越窗的 catch-up 雖不受本機冷卻限制，responder 對同一 requester 在 `CATCH_UP_PROBE_REPLACE_AFTER_FRAMES` 幀內的新 probe 與 `SYNC_REQUEST_COOLDOWN_FRAMES` 內的快照請求仍不回應，連續卡頓的第二次 catch-up 可能要等這段時間後的重試才完成，期間本機無法操作。根本解需以 wire 交換 frame advantage（issue 001127）。

### 異常斷線後

1. GO 後最終 offline 交 `RacePartitionGuard`；門檻固定為 original active roster 的 `floor(N/2)+1`。
2. 本端仍可達嚴格多數才移除該玩家並續賽；少數側／平手側立即 `partition-void`，停止 frame pump、不執行 settlement。
3. 可續賽側的最終 `MatchResultEvent.signatures` 必須達原 roster 嚴格多數，且簽章覆蓋 `disconnects`，因此同時是 removal certificate。4 人 2–2、2 人 1–1 皆無法定稿。
4. 首回合 GO 後的回合 race-ready 屏障停滯逾時，未到者同樣計入失聯：寫入 `disconnects` 並告知 `RacePartitionGuard`；剩餘非 forfeit 成員低於 original active roster（`ranking ∪ disconnects` 去重）的 `floor(N/2)+1` 時以 `partition-void` 收場、不開賽、不結算（[流程/比賽進行.md §1.7](../流程/比賽進行.md#17-go-前-race-ready-屏障)）。本機自身停滯則走 `lag-evicted` 驅逐收攤（§7.3 處置）。
5. 已形成合法 removal 的玩家整場 forfeit：先從每個回合名次移除、不得分，總名次排在最後完賽者之後（依斷線時間，再依 PeerId），TrueSkill 與連勝讀同一份總名次（[算式表.md §20.1](../算式表.md)）；信譽依 [賽內機制.md §4](../賽內機制.md)（異常斷線 -5，僅罰有本場 loadout 者）。

## 8. 效能預算（三層口徑）

本節是即時效能預算的**單一權威**：公式、常數名與推導只寫在這裡；[testing.md §8](testing.md) 只列基準 ID 與量測口徑，[physics-engine.md §9](physics-engine.md) 只留連結；常數值以 [network.md §8.1](../程式參數/network.md#81-networkperf效能預算口徑) 為準（[D-20261028-04](../decisions/D-20261028-04-效能預算三層口徑.md)）。

**記號**：T＝1000／`FIXED_FRAMERATE_HZ` ms；R＝`ROLLBACK_FRAME_BUFFER_DEFAULT`；D＝`INPUT_DELAY_FRAMES`；k＝`PERF_LOW_END_FACTOR`（參考機效能 ÷ 最低支援裝置效能）。參考機為一般中階筆電，型號與環境由 testing §8 登錄。產品目標在參考機的 Chromium、模擬 Worker 內量測；Node harness 的數字是代理指標，可用於研究與回歸，不能單獨宣稱達標。

**每幀實付**＝`engine.step`（含 bounded-step 試算與內部快照）＋該幀實際發生的 `saveState`＋`stateHash`（含 checkpoint hash 與 checksum 幀暫定 hash）。依前緣快照規則（[§3](#3-state-buffer)），穩態只有每 `CATCH_UP_OFFER_ALIGNMENT_FRAMES` 幀一次的對齊快照與 checksum 幀的 hash；量測取逐幀實際值、不攤提，只計前進幀，不含簿記。回滾重播與 catch-up 追趕的耗時不併入每幀實付。

| 層 | 目標 | 量測對象 | 60 Hz 值 |
|---|---|---|---|
| **L0 可玩底線** | P95(每幀實付) ≤ T ÷ k | 參考機、不注入延遲（不回滾）；觀戰 replay 同樣適用 | 8.33 ms |
| **L1 穩態餘裕** | P50(每幀實付) ≤ T ÷ `PERF_STEADY_HEADROOM_DIVISOR` | 同 L0 | 8.33 ms |
| **L2 回滾頓挫** | P95(最深回滾事件耗時) ≤ `PERF_ROLLBACK_STUTTER_FRAMES` × T（不除以 k） | 參考機；回滾事件＝`loadOwnState`＋重播 R 幀＋重播期間的必要 save | 50 ms |

- L1 的意義是落後後能比即時更快追上（一次 3T 頓挫約 6T 內追回）；L2 是有界頓挫，在 Worker 內只造成模擬落後、不凍結畫面。
- `ROLLBACK_FRAME_BUFFER_MAX`（回滾深度上限 3 幀）是協定常數；L2 的 3T 是時間預算。兩者數字相同但概念不同，各自獨立常數。
- P99 與 max 只報告、不設目標。L2 另報在宣告延遲模型下的每分鐘回滾事件數與深度分佈，只報告。

**未達 L0 的裝置**照常參賽，不降為觀戰。正式比賽與本機測試回合中，本機以每幀實付的滾動 600 幀 P95 超過一個 tick（T）判定效能警告，比賽頁顯示提示橫幅並附顯示設定入口（玩家可直接去降 3D 算圖解析度或關反鋸齒）；警告不影響參賽、輸入或共識。P95 每 60 幀重算一次；每回合重新取樣，因此回合開頭約 10 秒（窗未滿）不判定；回滾重播成本不計入；local-test 的每幀實付＝`engine.step` 加該幀實際發生的 `stateHash` 與 `saveState`，口徑同 match；觀戰 replay 不產生警告（[D-20261101-01](../decisions/D-20261101-01-本機測試也顯示效能警告.md)）。同一橫幅也在呈現層降階中（比賽視口的像素自適應倍率低於 100，[D-20261102-02](../decisions/D-20261102-02-比賽視口背景層移除與像素自適應.md)）顯示：語意是「本機撐不住（模擬或呈現）」，與 L0 判定、參賽與共識無關。

**只報告的診斷指標**（各自一個基準 ID 或診斷輸出）：world step、`engine.step`、`saveState`、`loadOwnState`、`loadState`（完整驗證，catch-up 與觀戰用）、`stateHash`、snapshot bytes、bounded-step 拒絕幀比例與試算數分佈、Rapier profiler 分項。

**catch-up 效能閘**（issue 001108，[D-20261029-03](../decisions/D-20261029-03-catch-up分tick追趕與落後端快進.md)；不設產品目標，基準 ID 與閘規則見 [testing.md §8](testing.md)）：

- `catch-up-worst`：catch-up 最壞總工作量＝完整驗證載入外來快照＋冷快取驗簽 `SYNC_INPUT_LOG_MAX_ENTRIES` 筆日誌（與產品同一 digest 與驗簽器，[§7.1](#71-state-catch-up重連後對齊)）＋重播 `SYNC_INPUT_LOG_MAX_SPAN_FRAMES` 幀。產品路徑把驗簽分片、追趕分 tick，此值是總和而非單一 tick 的頓挫。
- `catch-up-chase-tick-max`：以真實 `RaceLoop` 分 tick 追趕 `SYNC_INPUT_LOG_MAX_SPAN_FRAMES` 幀，每個 tick 扣掉該 tick 最後一個追趕步的實測耗時後 ≤ `CATCH_UP_CHASE_TICK_BUDGET_MS`＋`engine.step` 的 P95。此式表達「每個追趕步開始前，本 tick 已耗時不超過預算」；直接以 tick 最大值比較時，落在預算邊界的那一步碰上 GC 尖峰就會誤判。

**快照大小**：硬上限是 `SYNC_SNAPSHOT_MAX_BYTES`，超過是功能失敗（catch-up 與觀戰 checkpoint 無法送出），不是效能退化；catch-up 可 offer 的快照另須扣最壞輸入日誌（[§5](#5-rollback-主迴圈)）。效能目標為相對值 P100(snapshot bytes) ≤ `SYNC_SNAPSHOT_MAX_BYTES` ÷ `PERF_SNAPSHOT_BYTES_TARGET_DIVISOR`（1 MiB）。

**頻寬**：送出＝HZ × 每則 input bytes；接收＝(`PLAYERS_PER_RACE_MAX` − 1) × HZ × 每則 input bytes ＋ checksum 攤提。以 [§6](#6-datachannel-二進位序列化) 的 input ~74 bytes 計，60 Hz 送約 4.4 KB/s、八人房收約 31 KB/s。input delay 不改頻寬。

**量測情境**：公版三場地（urban、snowy、jungle）× 車組（heavy8、mixed8）× 起跑佈局（至少含正式起跑格的八車成團壓力情境與分散佈局）。每情境暖機 60 幀後量 ≥ 900 幀，兩次獨立行程，逐情境判定（不以幾何平均判達標），報表另列幾何平均；量測時不得有並行重負載，CPU 負載與行程數納入報表。

**現況**：不可變形狀以登錄參照寫入快照後（[D-20261028-02](../decisions/D-20261028-02-靜態形狀登錄參照快照.md)），公版三場 × mixed8／heavy8 960 幀的 SavedState 最大 736,357–1,170,176 B（4 MiB 的 17.6–27.9%，未達 1 MiB 目標），`saveState` P50 2.2–3.0 ms；bounded-step 接受容差放寬（[D-20261028-05](../decisions/D-20261028-05-bounded-step接受容差放寬至0.2毫米.md)）後，以改版前每幀存檔口徑量得的每幀實付 P50／P95 為 23.1／34.2 ms（snowy-mixed8）到 43.1／78.7 ms（jungle-heavy8），未達 L0／L1。前緣快照與 Worker 下的參考機重量尚未進行；重量後 L0 仍差 1.5 倍以上才另案評估 30 Hz。

## 9. 風險與緩解

| 風險                  | 緩解                                            |
| --------------------- | ----------------------------------------------- |
| Snapshot 過大記憶體爆 | 稀疏前緣快照、保留時窗 12 幀（§3）＋增量 snapshot（擴充候選） |
| Rollback 卡頓         | 輸入延遲 D 吸收 ≤ D×T 的延遲、回滾深度 ≤ R；模擬在 Worker（§5.1）只造成模擬落後；L2 頓挫預算（§8） |
| Network jitter        | adaptive prediction（擴充候選）                 |
| Desync 假陽性         | 只對已確定狀態計票（§4）＋連續 3 次不一致才升級 |
| 大訊息超過 SCTP 單訊息上限 | 應用層分段與每 peer 有界重組（§6.1）       |
| 持續跟不上的 peer     | 持續落後自我驅逐 `lag-evicted`（§7.3）；裝置未達 L0 顯示效能警告（§8） |
| 幀時鐘偏移與 catch-up 卡頓 | 落後端快進回收穩態偏移（§7.5）；catch-up 分 tick 追趕、驗簽快取與分片、`front` 夾限（§7.1）；`catch-up-worst` 回歸閘與單 tick 追趕斷言（§8）；1..8 抖動已知限制（issue 001127） |
