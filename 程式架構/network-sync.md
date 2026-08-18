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
    } // 高頻：Race Sign Key 簽、nonce = frame（§6 wire `[sig:64]`）
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
      target: PeerId;
      sender: PeerId;
    }
  | {
      type: "leave";
      reason: "voluntary" | "disconnect" | "desync";
      sender: PeerId;
    };

// probe / sync-request / sync-response 皆走 Race Sign Key；簽章涵蓋 correlation/offer candidates/frame/hash/target/snapshot 與 raceId。
// sender 不信任 payload 自陳值，由 RoundTransport 保留實際 DataChannel 來源後注入。
```

賽內每個 `input` 訊息帶 Ed25519 簽章（**Race Sign Key**，[key-manager.md §10](key-manager.md)）＋ nonce ＋ timestamp（防偽造，[資安規範.md §3.2](../資安規範.md)、[security.md §2](security.md)）——**nonce 語意 = `frame`**（單調不重複）、timestamp 由 frame 推得，故 wire 格式只需附 `[sig:64]`（[§6](#6-datachannel-二進位序列化)）。

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
    // Event 不重播，並把本次實際用到的預測存在 predictions[peer][frame]。
  }

  prune(beforeFrame: number): void {
    /* inputs 與 per-frame predictions 一併修剪 */
  }
}
```

預測錯誤（`wasPredicted && !predictionWasCorrect`）→ 觸發 rollback 到該 frame；`equivocated` → fail-closed。

## 3. State Buffer

```typescript
class StateBuffer {
  private buffer = new Map<number, SerializedSnapshot>();
  private readonly MAX_FRAMES = 12; // storage capacity；一般 input acceptance/rollback 深度為 8；offer 會複製 pin 對齊候選，不依賴 buffer 後續保留

  push(frame: number, snapshot: SerializedSnapshot): void {
    this.buffer.set(frame, snapshot);
    for (const [f] of this.buffer)
      if (f <= frame - this.MAX_FRAMES) this.buffer.delete(f);
  }
  get(frame: number): SerializedSnapshot | null {
    return this.buffer.get(frame) ?? null;
  }
  hasFrame(frame: number): boolean {
    return this.buffer.has(frame);
  }
}
```

## 4. Checksum 去同步偵測

每 `SNAPSHOT_INTERVAL_FRAMES`（120 frame、2 秒）各 peer 廣播 SHA-256 state hash，計票取多數；連續 `DESYNC_STRIKE_LIMIT`（3）次不一致才升級為 persistent-desync（防假陽性；常數見 [network.md §8](../程式參數/network.md#8-networksync網路同步)）。

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
    // mismatch 不嘗試 rollback：決定性重播同一批 input 必得同一結果、治不了真分歧（且分歧點多在 StateBuffer 12 frame 窗外）→ 只累積 strike
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

`persistent-desync` → `handlePersistentDesync` 廣播 `leave reason:'desync'` + 觸發 [ledger.md §9 `DesyncEvent`](ledger.md)（被踢者自簽自報、不影響信譽、純供調查）。**checksum 等待容差 30 frame（0.5 秒）**：某 peer 的 checksum 逾窗未到 → 該輪視同缺席、不阻塞多數決；**mismatch 不觸發 rollback**（決定性重播無法收斂真分歧）、僅累積 strike。

## 5. Rollback 主迴圈

```typescript
class RollbackEngine {
  private currentFrame = 0;
  private inputBuffer = new InputBuffer();
  private stateBuffer = new StateBuffer();
  private checksumExchanger = new ChecksumExchanger();

  constructor(
    private physics: PhysicsEngine,
    private network: NetworkLayer,
    private localPeerId: PeerId,
    private allPeers: PeerId[],
  ) {}

  step(localInput: InputEvent[]): void {
    // 1. 寫本地輸入 + 廣播
    this.inputBuffer.setInput(this.localPeerId, this.currentFrame, localInput);
    this.network.broadcast({
      type: "input",
      frame: this.currentFrame,
      events: localInput,
      sender: this.localPeerId,
    });

    // 2. 處理遲到輸入 → 必要時 rollback
    const { rollbackTo } = this.processNetworkMessages();
    if (rollbackTo !== null && rollbackTo < this.currentFrame)
      this.rollbackAndReplay(rollbackTo);

    // 3. 推進當前 frame
    const inputs = this.inputBuffer.getInputsForFrame(
      this.currentFrame,
      this.allPeers,
    );
    this.stateBuffer.push(this.currentFrame, this.physics.saveState());
    this.physics.step(inputs);

    // 4. 每 SNAPSHOT_INTERVAL_FRAMES（120、2 秒）廣播 checksum（network.md §8）
    if (this.currentFrame % SNAPSHOT_INTERVAL_FRAMES === 0)
      this.network.broadcast({
        type: "checksum",
        frame: this.currentFrame,
        hash: this.physics.computeStateHash(),
        sender: this.localPeerId,
      });

    this.currentFrame++;
  }

  // reconnect 訊號只作 admission；第一階段向全部遠端 roster peer 定向要求 bounded snapshot offer。
  requestCatchUp(triggerPeer: PeerId): void {
    if (
      !this.allPeers.includes(triggerPeer) ||
      triggerPeer === this.localPeerId
    )
      return;
    if (this.catchUpAttempt?.pending)
      this.network.cancelSyncResponse?.(
        this.catchUpAttempt.pending.peer,
        this.catchUpAttempt.pending.requestId,
      );
    this.pendingProbes.clear();
    this.catchUpAttempt = null;
    for (const target of this.allPeers.filter(
      (peer) => peer !== this.localPeerId,
    )) {
      const requestId = this.nextRequestId();
      this.pendingProbes.set(target, {
        requestId,
        requestedAtFrame: this.currentFrame,
        retries: 0,
      });
      this.network.broadcast({
        type: "sync-probe-request",
        requestId,
        target,
        sender: this.localPeerId,
      });
    }
  }

  private rollbackAndReplay(targetFrame: number): void {
    const snapshot = this.stateBuffer.get(targetFrame);
    if (!snapshot) {
      this.handlePersistentDesync();
      return;
    } // window 外 → desync
    this.physics.loadState(snapshot);
    for (let f = targetFrame; f < this.currentFrame; f++) {
      this.physics.step(this.inputBuffer.getInputsForFrame(f, this.allPeers));
      this.stateBuffer.push(f + 1, this.physics.saveState());
    }
  }

  // best-effort catch-up：落後端以對端快照直接對齊。只在確實落後時採用（快照幀不新於本地
  // 一律忽略＝絕不倒退）。採用後緩衝重置為載入幀單一權威、已封存於快照的舊輸入修剪；
  // 不重播、不觸發回滾窗、不升級 desync。
  private applyCatchUp(frame: number, snapshot: SerializedSnapshot): boolean {
    if (frame <= this.currentFrame) return false; // 未落後＝不倒退
    this.physics.loadState(snapshot);
    this.currentFrame = frame;
    this.stateBuffer.reset(frame, snapshot); // 緩衝＝載入幀單一權威（清舊/新殘影）
    this.inputBuffer.prune(frame); // < frame 的輸入已封存於快照
    return true;
  }

  private processNetworkMessages(): { rollbackTo: number | null } {
    const messages = this.network.drain();
    // 第一遍：pending probe 必須逐 peer 同 requestId/target；signed offers 對完全相同
    // `(aligned frame, snapshot hash)` 分桶。達 strict remote quorum 後固定 voters 順序，
    // 只向第一位送含 offerId/targetFrame/targetHash 的 exact request。
    negotiateSnapshotOffers(messages);
    retryTimedOutProbes({
      everyFrames: CATCH_UP_PROBE_TIMEOUT_FRAMES,
      sameOfferId: true,
      retries: CATCH_UP_PROBE_RETRY_LIMIT,
    });
    // 第二遍：只有目前單一 voter/pending requestId 的完整快照可進；transport enqueue 後
    // correlation 已一次性消耗。bytes hash、內外 frame、side-effect-free topology inspect
    // 與原子 load 任一失敗即換下一 committed voter，不再對大快照做第二次 quorum。
    let caughtUp = false;
    for (const msg of messages)
      if (msg.type === "sync-response") {
        const attempt = this.catchUpAttempt;
        const pending = attempt?.pending;
        if (
          !attempt ||
          !pending ||
          msg.sender !== pending.peer ||
          msg.target !== this.localPeerId ||
          msg.requestId !== pending.requestId
        )
          continue;
        attempt.pending = null;
        if (
          msg.frame !== attempt.targetFrame ||
          snapshotHash(msg.snapshot) !== attempt.targetHash ||
          this.physics.savedStateFrame(msg.snapshot) !== msg.frame
        ) {
          noteMisbehavior(msg.sender);
          requestSnapshotFromNextVoter();
          continue;
        }
        try {
          if (this.applyCatchUp(msg.frame, msg.snapshot)) caughtUp = true;
          this.catchUpAttempt = null;
        } catch {
          noteMisbehavior(msg.sender);
          requestSnapshotFromNextVoter();
        } // fail-soft：不前跳、不污染、不中斷幀
      }
    const timedOut = this.catchUpAttempt?.pending;
    if (
      timedOut &&
      this.currentFrame - timedOut.requestedAtFrame >=
        CATCH_UP_REQUEST_TIMEOUT_FRAMES
    ) {
      this.network.cancelSyncResponse?.(timedOut.peer, timedOut.requestId);
      this.catchUpAttempt.pending = null;
      requestSnapshotFromNextVoter();
    }
    // 第三遍：輸入預測錯誤裁 rollback／checksum 入帳／probe 與 exact sync-request 應答
    let earliest: number | null = null;
    const respondedTo = new Set<PeerId>();
    for (const msg of messages) {
      if (msg.type === "input") {
        // 窗外未來幀／過舊幀丟棄（防記憶體無界＋防單一慢 peer 的遲到 input 連鎖清場）；
        // 本 drain 已 catch-up 對齊＝快照幀之前的輸入不納回滾
        if (msg.frame > this.currentFrame + STATE_BUFFER_MAX_FRAMES * 2)
          continue;
        if (msg.frame < this.currentFrame - ROLLBACK_FRAME_BUFFER_DEFAULT)
          continue;
        if (caughtUp && msg.frame < this.currentFrame) continue;
        if (!this.validInput(msg.sender, msg.events)) {
          noteMisbehavior(msg.sender);
          continue;
        }
        const { wasPredicted, predictionWasCorrect, equivocated } =
          this.inputBuffer.setInput(msg.sender, msg.frame, msg.events);
        if (equivocated) {
          failClosed(msg.sender);
          continue;
        }
        if (
          wasPredicted &&
          !predictionWasCorrect &&
          (earliest === null || msg.frame < earliest)
        )
          earliest = msg.frame;
      } else if (msg.type === "checksum") {
        // 僅尚待裁定且在 past horizon 內的對齊輪；同 peer 首票鎖定
        this.checksumExchanger.setChecksum(msg.frame, msg.sender, msg.hash);
      } else if (msg.type === "sync-probe-request") {
        // 同 offerId＝重送既有 commitment；新單調 id 未滿 120f guard 或 unordered 舊 id＝拒絕。
        // replacement 先用 source byteLength 算 current-old+new quota，再於暫存 Map 完成
        // slice/hash；無候選、超額、copy/hash throw 皆保留 old，成功才一次 swap/accounting。
        const candidates = this.cacheSnapshotOfferAtomic(
          msg.sender,
          msg.requestId,
        );
        if (candidates)
          this.network.broadcast({
            type: "sync-probe-response",
            requestId: msg.requestId,
            candidates,
            target: msg.sender,
            sender: this.localPeerId,
          });
      } else if (msg.type === "sync-request") {
        // 只從該 requester 的 bounded offer cache 取 `(offerId,targetFrame,targetHash)`；
        // 不回 StateBuffer current，也不受後續 eviction 影響。
        if (
          msg.target !== this.localPeerId ||
          !this.allPeers.includes(msg.sender) ||
          respondedTo.has(msg.sender) ||
          this.syncRequestCoolingDown(msg.sender)
        )
          continue;
        respondedTo.add(msg.sender);
        const offer = this.offerCache.get(msg.sender);
        const candidate = offer?.candidates.get(msg.targetFrame);
        if (
          offer?.offerId !== msg.offerId ||
          candidate?.hash !== msg.targetHash
        )
          continue;
        const sent = this.network.broadcast({
          type: "sync-response",
          requestId: msg.requestId,
          target: msg.sender,
          sender: this.localPeerId,
          snapshot: candidate.snapshot,
          frame: msg.targetFrame,
        });
        // 只有成功交給 DataChannel 才原子刪 offer 並開始 cooldown；false/throw 保留供重試。
        if (sent) {
          this.deleteOffer(msg.sender); // 同步維護 entry 與 pinned byte accounting
          this.lastSyncResponseFrame.set(msg.sender, this.currentFrame);
        }
      }
    }
    return { rollbackTo: earliest };
  }
}
```

`sync-response` 自身**永不觸發回滾**。probe 時 responder 從 StateBuffer 複製並 pin 最近兩個 8-frame 對齊候選，signed offer 只送 `(frame,sha256(snapshot))`。同值遠端票達 `floor(全名單/2)+1` 後，requester 只向一位 voter 索取完整 snapshot；300 幀（5 秒）無回應、hash 不符、topology inspect 或 load 失敗便依序改向下一 voter。逾時必先通知 transport 取消 pending correlation，因此晚到 4 MiB response 只讀短 header，不能進 decode/copy/hash/verify。

offer TTL 900 幀（15 秒），per-requester 只保留一 attempt，全域最多 8 entries／64 MiB；容量與來源 byteLength 必須在 `slice`／SHA-256 前以 `currentBytes - oldBytes + newBytes` preflight。replacement 在暫存 Map 完成 copy/hash 後才一次交換並更新 accounting；無候選、超額或 copy/hash 例外皆完整保留舊 offer，不 eviction 正在服務的他人 offer。probe response 遺失時，t=60／120 幀以**相同 offerId** 最多重送兩次，responder 冪等回傳既有 commitment、不重複 copy/hash；t=120 的最後一次送出恰好命中 replacement guard，新且 uint32 單調的 attempt 可安全取代，unordered 舊 id 永久拒絕。因 snapshot 已 pin，probe→request 即使延遲超過 StateBuffer 12 幀仍可服務；完整 4 MiB snapshot 不需由每位 quorum voter 重傳。2 人場僅有 1 張遠端票，跨窗 catch-up 必然 fail-closed。

快照載入是原子操作。current SavedState 封裝 `vehicles[]`（含 actuator phases／ammo、per-part `broken/breakFrame`、vehicle retirement 與 checkpoint 約束的 `routeProgressUm`）、完整 roster 的 `destructionCounts`、已釋放 `bullets[]` 的預配置 collider 身分與 `sourceCleared`、`trackEntities[]`（fatigue／broken／breakFrame）、`weather`（seed、accumulator、spawn ordinal、active descriptors）、`worldConfig`、`worldRuntimeStateHash` 與 world snapshot；immutable topology 涵蓋 body type/mass/gravity/dominance/solver/CCD/locks、collider parent/shape/mass/density/sensor/restitution/groups/collision types/events/hooks/contact skin/threshold，以及 permanent／仍持彈 joint 與 entity intact handles。body／collider enabled 屬 mutable runtime state，必須與 vehicle／track lifecycle 雙向一致；場地與車輛純視覺碎片的 active／spawn／expiry／fade／pose／velocity 不進快照或 hash。snapshot、runtime hash、envelope broken／retirement、destruction attribution、route progress、projectile clearance 與 weather state 必須一致，restore 後再由 immutable manifest 重建派生狀態。位姿、速度、next pose、effective inertia、damping、sleeping 等 mutable state和 envelope runtime hash 一併比對。launch projectile 仍在 load-time 預配置；rollback 不接受 snapshot 自述新增 body／collider。暫時 Rapier world 以 `finally` 保證任何 getter/validation 例外皆 `free()`，全數驗證成功後才替換舊 world。

Input 入場前有三層關卡：每幀最多 4 事件、skill 唯一且 Event/Hold byte 語意必須符合；技能必須存在該 peer 本回合已驗證 loadout 的 chip schema。缺包預測只延續 `isHoldTick=true` 的連續技能；boost/jump/slam 等 Event 型技能只執行一次，永不因缺包重放。`InputBuffer` 保存每個 `(peer, frame)` **實際被模擬取用**的預測，future/out-of-order 到包不得回灌舊幀。同 `(peer, frame)` 首個 signed 值鎖定；後續相異值是 equivocation，立即 fail-closed 離場。

固定 60Hz physics（dt = `1 / FIXED_FRAMERATE_HZ` 秒精確值）、純 rollback 且不另加 input delay。物理跨 peer determinism（f32 + 整數量化 + O(1) material lookup + collider handle 固定索引）見 [賽內機制.md §2.2](../賽內機制.md)。

## 6. DataChannel 二進位序列化

```typescript
// wire 型別：INPUT=1 / CHECKSUM=2 / SYNC_REQUEST=3 / SYNC_RESPONSE=4 / PROBE_REQUEST=5 / PROBE_RESPONSE=6
// Input：       [type:1][frame:4 LE][events_len:1][events:variable][sig:64]（每 event：[event_type:1][skill:1][hold:1]）
// Checksum：    [type:1][frame:4 LE][hash:32][sig:64]
// ProbeRequest：[type:1][requestId:4 LE][targetLen:1][target][sig:64]
// ProbeResponse：[type:1][requestId:4 LE][count:1][count × (frame:4 + hash:32)][targetLen:1][target][sig:64]
// SyncRequest： [type:1][requestId:4 LE][offerId:4 LE][targetFrame:4 LE][targetHash:32][targetLen:1][target][sig:64]
// SyncResponse：[type:1][requestId:4 LE][frame:4 LE][targetLen:1][target][snapLen:4 LE][snapshot][sig:64]
// sig = Race Sign Key 簽 sha256(type ‖ requestId/offerId ‖ candidates/frame/hash ‖ target ‖ snapshot? ‖ raceId)
// raceId = `${matchId}#${roundIndex}`：簽章域按回合隔離——跨回合遲到包驗簽必敗、frame 重置不汙染 InputBuffer
function encodeInput(msg: InputMessage): Uint8Array {
  const header = new Uint8Array(6);
  header[0] = MSG_TYPE_INPUT;
  new DataView(header.buffer).setUint32(1, msg.frame, true);
  header[5] = msg.events.length;
  return concat(header, encodeEvents(msg.events), msg.signature);
}
```

頻寬：Input ~74 bytes（本體 ~10 + sig 64）、Checksum ~100 bytes（含 sig）；60Hz 送 ~4.4 KB/s、8 人房收 7 路 ~31 KB/s（可接受）。sync-request／sync-response 僅重連時零星發送、不計入穩態頻寬。

傳輸層依 DataChannel **真實來源 peer**，在任何 decode/copy/hash/verify 前套用跨 `drain()` 的 per-peer token bucket。input 獨立為 120 筆 burst／90 tokens/s（合法 60Hz 有裕度），checksum 與四種 catch-up 控制訊息維持獨立 32 筆 ／32 tokens/s；raw bytes 另受 `RACE_MESSAGE_MAX_BYTES + 64 KiB` 容量與每秒同量補充限制，大 snapshot 不得借 input message 配額放寬 byte 預算。`drain()` 只釋放 verified queue，不重置 ingress。`sync-response` 先以固定短 header 核對 pending；逾時 ／ 取消後 late response 在消耗 token/byte 配額前 cheap-drop，只有仍匹配的 response 才進 ingress bucket，壞簽或 enqueue 失敗不消耗仍有效 pending。probe、offer、exact request 與大型 response 全用 `sendRaceTo` 真定向；非 target peer 不收位元組、也不付 decode/verify 成本。

ordered `control` DataChannel 另有獨立 ingress：每個真實 remote peer 在 DAG-CBOR decode 前先套
256 KiB 單訊息上限、32-message burst／16 messages/s 與 327,680-byte burst／262,144 bytes/s
token bucket。message／byte 預算不足只 deterministic drop，不累積違規；oversized、非 binary、
畸形 CBOR 或 schema 不符則累積結構違規，3 次即關閉該 control link、把 `race-mesh` 狀態轉為
offline 並走既有 disconnect/forfeit 通知。

`ControlWire` 外層為 exact schema：`app` 只接受 `{ kind, payload }`，且 payload 必須是具非空
`type`（UTF-8 ≤64 bytes）的 record；深層賽事 domain union 仍由 `race-runtime` 保持單一型別權威，
mesh 不複製第二套 parser。`key` 只接受 exact `{ kind, raceId, publicKey, signature }`，raceId
UTF-8 ≤256 bytes、Ed25519 public key 恰 32 bytes、signature 恰 64 bytes；每 peer 最多保留 8 筆，
因此 retained key material 與 map key bytes 同時有硬界。`leave` 只接受 exact reason enum。

`race-message-envelope` 使用這條 ordered app-control bus，但不進 rollback input queue。transport
以固定 participant roster 驗真實 link source、原 signer、match、單調 sequence 與平均每 2 秒一則
（burst 2）的 per-sender quota；至少一條 control link 可寫才回報送出成功。完整 domain schema、
spectator 原簽章 relay 與 HUD 見 [race-messages.md](race-messages.md)。

`NetworkLayer.broadcast` 與定向 `RaceWirePort.sendRaceTo` 的契約只回傳 `boolean`：`true` 表示已交給傳輸通道，`false` 表示未交付，呼叫端必須保留重試／清理 correlation 所需狀態。不得再以 `void` 表示舊測試 stub 的隱式成功；測試 double 也必須回傳實際布林值。fanout `RaceWirePort.sendRace` 仍是 best-effort `void`，各 peer 失敗隔離，不與定向送達契約混用。

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

窗內連線恢復 ＝ 可靠通道自動重放在途訊息、短斷線由 rollback 窗修正；**落後過回滾窗者**另需 state 級 catch-up。訊號扇出鏈：`mesh` 重連窗恢復 → `onReconnect(peer)` 訊號 → 上層（race-session）催當前回合引擎 `rollback.requestCatchUp(peer)`（per-round 引擎；無進行回合 ＝no-op）：

1. 恢復端向全部遠端 roster peer 真定向送唯一 requestId 的 signed `sync-probe-request`；每個 responder 複製 pin 最近兩個 8-frame 對齊 snapshot，回 signed `(frame,hash)` candidates。
2. 同 `(frame,hash)` 達 strict remote quorum 後，只向第一位 voter 送含 `offerId/targetFrame/targetHash` 的 exact request；300 幀 timeout（先取消 transport pending）或壞 snapshot 時依序換下一 voter。
3. responder 只從 900 幀 TTL 的 bounded offer cache 回 exact snapshot。requester 核對 bytes hash、side-effect-free inspect 後才原子 load；不要求所有 voters 傳完整大快照。

**Fail-closed**：所有 offer/target/hash/snapshot 關聯欄位均納入 Race Sign Key digest。無共同同值 offer、cache quota/TTL 超限、無足夠遠端票（含 2 人場）或所有 voters 均失敗，一律維持原狀。所有 catch-up 類型與大型 snapshot 一律使用真 unicast。

### 7.2 背景分頁造成的本機落後

正式賽的 `requestAnimationFrame` 在背景分頁可能停止，因此 render clock 不得被當成「全網仍同步」的證據。Rollback 收件端在套用 future-window admission 前，按 roster peer 單調記錄當次觀測到的最大遠端 lead：任一合法 peer 顯示本機落後超過 `STATE_BUFFER_MAX_FRAMES × 2`（24 幀）且不超過 `CATCH_UP_MAX_ADVANCE_FRAMES`（900 幀）時，最多啟動一個既有 quorum catch-up；載入門檻、hash 驗證與 bounded snapshot 規則完全不變。超過 900 幀時，只有 `floor(全名單/2)+1` 個遠端 peer 的獨立觀測共同成立，才可判定本機已超出安全恢復窗，單一 peer 不得藉 future frame 強迫觀測方退賽。

瀏覽器 `visibilitychange` 轉回可見時另以本機時鐘計算隱藏期間並立即處理：≤24 幀不動作；三人以上、25–900 幀催既有 catch-up；>900 幀走 `persistent-desync` 自我驅逐。2 人場因只有唯一遠端、既有 strict quorum 必然無法成立，隱藏超過 24 幀即自我驅逐，不接受唯一對手未經交叉背書的快照。local-test 不接此生命週期埠，切背景仍等同暫停。

> 重連 / 斷線處理設計（重連沿用原 loadout 防偷換、開賽前退出無懲罰、賽中斷線 30 frame 容忍）見 [賽內機制.md §4](../賽內機制.md) 與 [matchmaking.md § 重連時的 loadout 處理](matchmaking.md)。

### 異常斷線後

1. GO 後最終 offline 交 `RacePartitionGuard`；門檻固定為 original active roster 的 `floor(N/2)+1`。
2. 本端仍可達嚴格多數才移除該玩家並續賽；少數側／平手側立即 `partition-void`，停止 frame pump、不執行 settlement。
3. 可續賽側的最終 `MatchResultEvent.signatures` 必須達原 roster 嚴格多數，且簽章覆蓋 `disconnects`，因此同時是 removal certificate。4 人 2–2、2 人 1–1 皆無法定稿。
4. 已形成合法 removal 的玩家排位為最後完賽者之後（依斷線時間），信譽依 [賽內機制.md §4](../賽內機制.md)（異常斷線 -5，僅罰有本場 loadout 者）。

## 8. 效能目標

| 指標                    | 目標                                        |
| ----------------------- | ------------------------------------------- |
| 8 玩家 frame time       | ≤ 16 ms (60fps)                             |
| Rollback 5 frames 重播  | ≤ 8 ms                                      |
| Snapshot 序列化         | ≤ 4 ms                                      |
| Snapshot 大小（8 玩家） | ≤ 64 KB                                     |
| Network bandwidth       | 送 ≤ 10 KB/s；收（8 人房、含簽章）≤ 40 KB/s |

## 9. 風險與緩解

| 風險                  | 緩解                                            |
| --------------------- | ----------------------------------------------- |
| Snapshot 過大記憶體爆 | 限 12 frames buffer + 增量 snapshot（擴充候選） |
| Rollback 卡頓         | profiling + 重播 budget                         |
| Network jitter        | adaptive prediction（擴充候選）                 |
| Desync 假陽性         | 連續 3 次不一致才升級                           |
