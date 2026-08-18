---
type: impl
domain: ["比賽房間"]
summary: 觀戰連線／deterministic replay／精簡 fallback／淘汰轉觀戰
authority: null
slug: null
---
# spectator（觀戰實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/spectator.md](程式流程/spectator.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：觀戰的**實作層** —— 角色 / 連線建立（participant-source star）、唯讀 deterministic replay、精簡 fallback、join 閘、視角系統、淘汰自動轉觀戰、訊息協議、房間設定。
> 觀戰流程與觀戰者特性（不簽章 / 不送 input / 不影響 desync）見 [觀戰.md](../流程/觀戰.md)；賽內定位見 [賽內機制.md §2.6](../賽內機制.md)。對應 `src/spectator/`。

## 1. 角色

房間角色與名冊以 [room-runtime.md §2](room-runtime.md) 的 participant／spectator
admission 與 `RoomMemberWire` 為唯一權威。淘汰是賽內 `physicsRetired` 狀態，不建立第三種
房間角色，也不另定義 spectator 專屬 `RoomMember`。

觀戰者**不簽章、不送 input、checksum 不參與多數派**（[觀戰.md §2](../流程/觀戰.md)）。主模式在本機執行唯讀物理 replay，但該世界不具共識權威；所有觀戰計時與 replay 修復皆為本地 ephemeral，不入帳本 / derive。

## 2. 觀戰連線建立（participant-source star）

**拓樸 ＝ assigned participant-source star**：同一 `sourceEpoch` 只由一位在線 participant
服務該觀戰者，觀戰者間不互聯；房主在固定 roster 中選 assigned count 最少者，平手依 roster
順序。來源失效時只重派受影響觀戰者，spectator 永不具候選資格。非本機
Race Config 的觀戰 alertdialog 先以 `{ role: 'spectator', password? }` 完成 room-control
admission，成功後進共用 RoomPage；match-start 才由顯示層索取已驗 RoomSession 的 host 並撥單向入站通道：

**〔SPEC-R-009〕** spectator-stream 是獨立連線平面。活躍 source channel 關閉時先把該 generation 轉為 reconnecting（其後舊 message 立即拒收），保留既有 `SpectatorSession` 實例、訂閱與 frame pump，但清空其 fallback `prev/current` 與 HUD cache，再以 `requestSource(roomId, previousSource)` 取得 `{ peerId, sourceEpoch }`、撥號並換綁。每次成功索源遞增 `sourceEpoch`，舊 channel 的延遲 close／message 一律忽略；新來源首幀必須直出，不得與舊來源插值。只有沒有在線 participant 或 dial 失敗才以 `source-unavailable` 結束本次觀看並回房；此失效不得改 room-control 或 race roster，原 host／單一 source 離線只要重選成功便不產生終局。

```typescript
export interface SpectatorJoinDeps {
  /** 讀取 host room-state 核發的 least-loaded assignment；client 不自行輪替。 */
  requestSource(roomId: RoomId, after?: PeerId):
    Promise<Result<{ peerId: PeerId; sourceEpoch: number }>>;
  nicknameSnapshot(peerId: PeerId): string | null; // 僅讀已驗 room snapshot
  /** 撥號推薦 participant source、取回單向入站通道 */
  dial(source: PeerId): Promise<Result<SpectatorInChannel>>;
  now(): number;                          // 單調毫秒鐘（插值用；測試注入假鐘）
  schedule(cb: () => void): () => void;    // 逐幀泵（真＝rAF、測試手動泵）；回傳停止函式
}

// 傳輸（signaling／WebRTC）以埠注入＝純邏輯可測；成功回可訂閱渲染幀／換場／終局的 SpectateHandle（§9）
async function joinAsSpectator(roomId: RoomId, deps: SpectatorJoinDeps): Promise<Result<SpectateHandle>> {
  const source = await deps.requestSource(roomId);             // 只讀既有 RoomSession assignment
  if (!source.ok) return source;
  const channel = await deps.dial(source.value.peerId);          // 撥 elected source 取單向入站通道
  if (!channel.ok) return channel;
  return ok(new SpectatorViewer(deps, channel.value));           // SpectatorSession 插值＋逐幀泵
}
```

**發話方消歧**：room-control link 仍由房主主動撥；spectator-stream 則由觀戰者主動撥 elected participant source。觀戰 link＝一條 WebRTC 連線＋單一 `'spectator'` DataChannel；資料面由 source 下行，觀戰端只上行 exact-schema `mode-select`（`replay | fallback`）能力／修復協商，絕不送 race input。實作見 `src/room-runtime/spectator-link.ts`（`dialSpectatorChannel` initiator／`acceptSpectatorChannel` responder）。每位 participant 都保有 broadcaster/server；只有 host assignment 指到自己、且收到已 admission spectator 撥入者才實際送流。

**方向別 raw ingress admission**：source→viewer 在 UTF-8 decode 前以 canonical `{"type":"replay-checkpoint",` prefix 區分 5,657,942-byte checkpoint 上限與一般 262,144-byte 上限，並套用 120 message burst／90 s⁻¹、6,706,518 raw-byte burst／4,194,304 B s⁻¹；checkpoint 另為 1 burst／0.2 s⁻¹。viewer→source 只接受 128-byte control，另用 8 message burst／4 s⁻¹、1,024-byte burst／512 B s⁻¹。非 binary、非法 UTF-8、oversized 與 quota overflow 都先丟棄並進 `ingressStats`；連續 16 次 drop 關 link，成功分派清除連續計數。checkpoint encoder 固定上述 prefix，避免合法大包因 property order 落入一般上限。

受保護房在**RoomSession admission 階段**以 OPAQUE spectator invitation 驗證；索源與 stream 撥號只接受已驗證的 spectator Peer。invitation 不進 stream protocol。觀戰者接收來源中繼的已簽 race input，但不進 race mesh。

## 3. 觀戰 Session

主模式以 `SpectatorWorldDescriptor` 建立與參賽者同型的世界，載入 late-join checkpoint 後，將已簽 input 放進 2–6 幀自適應 jitter buffer 並唯讀重播。每 120 幀以中繼的已簽 checksum 票對帳；不一致只重載 checkpoint，不產生 desync、ledger 或 race membership 副作用。`displayName` 不在 descriptor 或 replay 訊息內，由觀戰端依 PeerId 自行解析。

client／protocol 版本不相容或裝置能力不足時自動選 `fallback` 並顯示精簡模式提示。下列 `SpectatorSession` 位姿插值核心只屬 fallback：

**fallback 純核心**：吃已解碼的 fallback 訊息、時鐘由呼叫端餵入 ＝ 可測。位置線性插值、旋轉 nlerp（短弧翻正 ＋ 歸一）；顯示層非共識。

```typescript
interface SpectatorSessionHandlers {
  onCountdown?(roundIndex: number, secondsLeft: number): void;
  onRoundStart?(descriptor: SpectatorWorldDescriptor): void;  // 換載同場地、同 roster 真車與同 seed 世界
  onResultReady?(result: { matchId: string; roomId: RoomId }): void;
  onSessionEnd?(reason: SpectatorSessionEndReason): void;
}

class SpectatorSession {
  #current: FallbackSpectatorState | null = null;
  #prev: FallbackSpectatorState | null = null;
  #lastUpdateAt = 0;
  #roundIndex = 0;

  #handlers: SpectatorSessionHandlers;
  constructor(handlers: SpectatorSessionHandlers = {}) { this.#handlers = handlers; }
  get roundIndex(): number { return this.#roundIndex; }       // renderFrameFromSpectator 用

  resetStream(): void { this.#current = null; this.#prev = null; this.#lastUpdateAt = 0; }

  handleMessage(message: SpectatorMessage, now: number): void {
    if (message.type === 'state-broadcast') {
      if (this.#current !== null && message.state.frame <= this.#current.frame) return;
      this.#prev = this.#current; this.#current = message.state; this.#lastUpdateAt = now; return;
    }
    if (message.type === 'round-start') { this.resetStream(); this.#roundIndex = message.roundIndex; this.#handlers.onRoundStart?.(message); return; }
    if (message.type === 'countdown') { this.#handlers.onCountdown?.(message.roundIndex, message.secondsLeft); return; }
    if (message.type === 'result-ready') { this.#handlers.onResultReady?.(message); return; }
    if (message.type === 'session-end') this.#handlers.onSessionEnd?.(message.reason);
  }

  getVisualState(now: number): FallbackSpectatorState | null { // 10Hz → 每幀線性插值
    if (this.#current === null || this.#prev === null) return this.#current;
    const alpha = Math.min((now - this.#lastUpdateAt) / SPECTATOR_BROADCAST_INTERVAL_MS, 1.0);   // 100ms = 10Hz interval
    return interpolateRaceState(this.#prev, this.#current, alpha);
  }
}
```

同一 fallback generation 的 frame 必須嚴格遞增，重複或倒退一律丟棄。每次 `round-start` 與成功換綁新 source generation 都先 `resetStream()`，所以新場地載入後不會再輸出上一回合位姿，新來源首幀也不會從舊來源座標滑入。其餘插值以 `next` 車輛集合為準、`prev` 缺席者原樣輸出（新進車無前幀可插）。位姿線性／nlerp 至 next 幀；離散 `brokenPartIds`／`eliminated` 在 alpha 到 1 時切換，不製造半破壞狀態。入站通道 JSON 解析、逐幀泵（`schedule`）、渲染／換場／倒數／回合摘要／同步階段／終局訂閱與終局閂由 `joinAsSpectator` 回傳的 `SpectatorViewer`（實作 `SpectateHandle`，[§9](#9-api)）承擔；畸形幀丟棄不中斷收訊。

## 4. Participant source 廣播與 join 閘

### 4.1 SpectatorBroadcaster（fallback 推幀中樞）

吃注入 `send` 埠、**tick 由外部驅動**（幀驅動、非 wall timer）＝ 可測；無觀戰者 ＝ 零成本。`broadcast('round-start')` 記住最近一次完整 world descriptor，`addSpectator` 對新（含中途）觀戰者**補送該 round-start**＝ 立即載入正確場地與 canonical roster 真車；後續 checkpoint／input replay 以此不可變描述為基底。

```typescript
interface SpectatorSendPort { isOpen(peer: PeerId): boolean; send(peer: PeerId, message: SpectatorMessage): void; }

class SpectatorBroadcaster {
  #spectators = new Set<PeerId>();
  #currentRoundStart: Extract<SpectatorMessage, { type: 'round-start' }> | null = null;
  constructor(private port: SpectatorSendPort) {}
  get spectatorCount(): number { return this.#spectators.size; }

  addSpectator(peer: PeerId): void {                          // late-join：補送最近 round-start
    this.#spectators.add(peer);
    if (this.#currentRoundStart !== null && this.port.isOpen(peer)) this.port.send(peer, this.#currentRoundStart);
  }
  removeSpectator(peer: PeerId): void { this.#spectators.delete(peer); }
  broadcastState(state: FallbackSpectatorState): void {       // 每 SPECTATOR_BROADCAST_INTERVAL_MS 由外部呼叫
    if (this.#spectators.size === 0) return;
    for (const peer of this.#spectators) if (this.port.isOpen(peer)) this.port.send(peer, { type: 'state-broadcast', state });
  }
  broadcast(message: SpectatorMessage): void {                // round-start／countdown／result-ready／session-end
    if (message.type === 'round-start') this.#currentRoundStart = message;
    for (const peer of this.#spectators) if (this.port.isOpen(peer)) this.port.send(peer, message);
  }
}
```

fallback 推幀節拍為 10Hz。`spectatorStateOf` 只投影 §7 正面表列的 presentation 欄位；`weaponNodes.fired` 是公開動畫邊緣，協議 HUD 只含 elapsed／lap／standings。不得傳來源參賽者的 NET、耐久、溫度、電量、技能配置、原始 input 或共識票；所有欄位都不具物理／賽果權威（[D-20260812-02](../decisions/D-20260812-02-觀戰Deterministic-Replay與精簡Fallback.md)）。

### 4.2 進房閘（evaluateSpectatorJoin）

零文案 code、UI 映 i18n（`spectator.reject.<reason>`）。`waiting` 可先加入共用 RoomPage；`closed` 拒。

```typescript
type SpectatorJoinRejection = 'spectators-disabled' | 'room-closed' | 'spectator-full';

function evaluateSpectatorJoin(
  room: { allowSpectators: boolean; maxSpectators: number;
          state: 'waiting' | 'preloading' | 'racing' | 'settling' | 'closed' },
  currentSpectatorCount: number,
): { ok: true } | { ok: false; reason: SpectatorJoinRejection } {
  if (!room.allowSpectators) return { ok: false, reason: 'spectators-disabled' };
  if (room.state === 'closed') return { ok: false, reason: 'room-closed' };
  if (currentSpectatorCount >= room.maxSpectators) return { ok: false, reason: 'spectator-full' };
  return { ok: true };
}
```

此純政策函式不接觸 credential；受保護角色另由 room-control 的 RFC 9807 OPAQUE state machine 裁決，認證失敗只回通用 `join-rejected`。

### 4.3 SpectatorServer（participant-source 服務端）

星狀拓樸下每位 participant 都持有 `SpectatorServer`；source 只依已完成 room-control OPAQUE admission 的 PeerId 名冊驗證，不重做 invitation 判定。spectator OPAQUE server state 不交付 participant successor；房主繼任時受保護觀戰必須 fail closed。

```typescript
interface SpectatorServerDeps {
  roomSnapshot(): { /* 進房閘讀的房間三欄位＋房態；每次請求即時取 */ };
  onJoinRequest(handler: (req: { peerId: PeerId }) => void): () => void;
  openChannel(peerId: PeerId): Promise<SpectatorChannel>;     // 僅進房閘放行後呼叫
  onReject?(peerId: PeerId, reason: SpectatorJoinRejection): void;
  maxPendingOpens?: number;
}
class SpectatorServer {
  get broadcaster(): SpectatorBroadcaster;    // race-session 開賽時取（spectatorHub）、逐幀推
  get spectatorCount(): number;
  listSpectators(): readonly PeerId[];
  dispose(): void;                            // 解除 join 監聽、關所有通道、清登記
}
```

participant 端受話迴圈（`src/room-runtime/room-service.ts`）接觀戰者撥入 → 以 admitted spectator 名冊過閘 → 交 `SpectatorServer`；spectator／local-test 無 SpectatorServer。race-session 在每位 participant 開賽時取得自己的 broadcaster，因此原 source 消失後替代 participant 可在不中止 race mesh 的情況下立刻接流。

## 5. 視角系統（3 模式）

`CameraMode` 型別定義於本模組 `messages.ts`，但**攝影機 rig 屬 render 層**（viewport 內建），非觀戰模組 API：

```typescript
type CameraMode =
  | { type: 'follow'; targetPeerId: PeerId }   // 跟車：鎖定某車，camera 跟隨
  | { type: 'free' }                            // 自由：滑鼠 / 手把自由操控
  | { type: 'tour' };                           // 巡禮：局部車群導播鏡位
```

共用 RacePage 的 `CameraController` 維持 role、產品模式、目標與首幀確立的固定車序；`TourDirector` 只以局部車群展開度取景，鏡位套用前對場地做 ray collision 避讓，不做全場 fit。participant 的「類型／跟車／自己」與 spectator 的「類型／跟車」共用同一狀態機。已淘汰或完賽車仍可跟，只跳過離線缺席者。

## 6. 淘汰自動轉觀戰

淘汰唯一條件 = chassis broken 令車輛 `physicsRetired`；battery／motor broken 只造成動力失能，不自動切觀戰（定義見 [零件與場景.md](../零件與場景.md)、流程見 [觀戰.md §5](../流程/觀戰.md)）。

```typescript
type EliminationReason = 'vehicle-destroyed';   // chassis broken

const LETHAL_PART_TYPES: ReadonlySet<PartType> = new Set(['chassis']);

function checkElimination(parts: readonly { partType: PartType; broken: boolean }[]): EliminationReason | null {
  return parts.some((part) => part.broken && LETHAL_PART_TYPES.has(part.partType)) ? 'vehicle-destroyed' : null;
}
```

chassis broken 使該車進入 `physicsRetired`；client 依本機賽況停止該玩家 input 並切 spectator UI，但不建立額外事件型別，也不改變當前相機模式或跟車目標。玩家可繼續看或主動退出。

## 7. 訊息協議

```typescript
type SpectatorMessage =
  | ({ type: 'round-start' } & SpectatorWorldDescriptor)
  | { type: 'replay-checkpoint'; frame: number; sourcePeerId: PeerId; snapshotHash: string; snapshot: Base64Url; signature: Base64Url }
  | { type: 'replay-inputs'; fromFrame: number; toFrame: number; packets: readonly { sender: PeerId; frame: number; wire: Base64Url }[] }
  | { type: 'replay-checksums'; frame: number; packets: readonly { sender: PeerId; frame: number; wire: Base64Url }[] }
  | { type: 'state-broadcast'; state: FallbackSpectatorState }
  | { type: 'countdown'; roundIndex: number; secondsLeft: number }
  | { type: 'result-ready'; matchId: string; roomId: RoomId }       // 只是 verified ledger lookup／返回房間 context
  | { type: 'session-end'; reason: SpectatorSessionEndReason };

type SpectatorSessionEndReason =
  | 'source-unavailable'
  | 'pre-race-cancelled'
  | 'error'
  | 'settlement-failed'
  | 'partition-void'
  | 'consensus-invalid';

interface SpectatorWorldDescriptor {
  matchId: string;
  roundIndex: number;
  startedAt: Timestamp;
  trackRef: TrackRef;
  roster: readonly { peerId: PeerId; loadout: VehicleLoadout }[];
  weatherSeed: { matchId: string; roundIndex: number };
  lapCount: number;
  durationLimitSec: number;
  disallowChip: boolean;
  replay: null | {
    clientVersion: ClientVersionInfo;
    raceId: string;
    publicKeys: readonly { peerId: PeerId; key: Base64Url }[];
  };
}

interface FallbackSpectatorState {
  frame: number;
  vehicles: readonly FallbackSpectatorVehicleState[];
  trackEntities: readonly SpectatorTrackEntityState[];
  weatherPatches: readonly SpectatorWeatherPatchState[];
  hud: SpectatorPublicHudState;
}
interface SpectatorPublicHudState {
  elapsedMs: number;
  lap: number;
  lapTotal: number;
  standings: readonly { peerId: PeerId; rank: number }[];
}
interface FallbackSpectatorVehicleState {
  peerId: PeerId;
  positionMm: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  brokenPartIds: readonly string[]; // 最多 64 筆；每項 1–128 chars，ASCII 字典序去重
  eliminated: boolean;
  weaponNodes: readonly SpectatorWeaponNodeState[];
}
interface SpectatorTrackFragmentState { fragmentIndex: number; seed: number; seedMm: Vec3; volumeMm3: number; opacityX1000: number; }
interface SpectatorTrackEntityState { entityIndex: number; nodeName: string; positionMm: Vec3; rotation: Quat; broken: boolean; fragments: readonly SpectatorTrackFragmentState[]; }
```

`decodeSpectatorMessage` 是不信任邊界，僅接受上述 discriminator 與各型正面表列欄位。world descriptor 的 roster 必須固定排序且每位具完整 loadout；input／checksum 必須保留原 Race Sign Key 簽章並逐筆驗證；checkpoint 受既有 4 MiB SavedState 上限、frame／hash／topology驗證保護，而且只在 `waiting-checkpoint` 接受目前 channel generation 綁定的 `sourcePeerId`／`sourceEpoch`，frame 必須不低於目前單調 floor。錯階段、舊 generation、錯 source 或倒退 frame 在 snapshot／signature base64 decode 前拒絕；合法 checkpoint 的兩份 bytes 只解碼一次，再共用於 hash、簽章驗證與 `loadCheckpoint`。fallback 先以 UTF-8 byte length 拒絕超過 256 KiB，再套 vehicles／weapon nodes／track entities／純視覺 fragment descriptors／weather／HUD 的 encoder-decoder 對稱上限，來源不得送出接收端必丟的幀。fragment wire 不含 `physicsActive`、物理 pose 或 velocity。未知、多欄、少欄、非 canonical 排序或畸形資料全部 fail-closed。

replay checksum 只判斷觀戰本機世界是否需重載，**不得**寫入參賽 race checksum exchanger 或形成投票。`result-ready.matchId` 只接受 64 位小寫 digest、RoomId 只接受 canonical UUIDv4；正常完賽仍由 verified ledger MatchResult 定稿。無政策性固定延遲；2–6 幀 jitter buffer 上限只吸收抖動，超限顯示串流不穩並要求 checkpoint。

倒數是唯一由來源送出的低頻賽事節奏控制訊息：world descriptor 通常在 GO 前才完成，因此觀戰端不能由第一個 replay frame 回推仍剩幾秒；`countdown` 只驅動本地 overlay／音效，不具物理或賽果權威。其餘完整呈現均由 replay 本地推導：共用 `mapRenderFrame` 產生速度與碰撞／武器音訊事件，共用回合規則產生 `RoundEndSummary`，RacePage 以同一渲染幀顯示小地圖。無生產者的 `race-event` 已自協議移除；fallback 明確維持 reduced presentation，不偽造 replay 才能可靠取得的回合摘要或音效。

UI 必須誠實顯示目前階段：`building-world`、`waiting-checkpoint`、`catching-up`、`live` 或 `reduced`；不得再以「等待第一份 snapshot」概括 replay 的不同準備階段。

正常完賽只送 `result-ready`；全場 `error`／`settlement-failed`／`partition-void`／`consensus-invalid` 由每位 participant 的 RaceSession 對其所服務的觀戰者 fire-once 送 `session-end`，RacePage 顯示同一終局原因與回房入口。GO 前 readiness 取消送 `pre-race-cancelled` 並直接回房。單一 participant 的 `desync-evicted` 不是全場終點，不得送給觀戰者；來源通道失效仍優先重選，只有無候選或重撥失敗才由 viewer 本地形成 `source-unavailable`。

RacePage 消費的 viewer HUD 會在 `SpectatorPublicHudState` 上附加本地 `net`，並從已驗 room admission snapshot 取得 `nicknameSnapshot`，呼叫共用 `resolveDisplayIdentity(peerId, nicknameSnapshot)` 產生顯示標籤；缺快照時只顯示 `#` 加 SHA-256(PeerId) 前 4 bytes 的 8 位小寫十六進位指紋。暱稱不進 fallback wire。replay 依最近一批完整連續 input 幀相對 jitter target 的餘裕分為 good／degraded／bad；fallback 依 `now - lastUpdateAt` 分級（≤2 個廣播週期 good、≤5 個 degraded、其餘或尚無快照 bad）。來源端不得傳送或覆寫此值，因此來源自身 rollback 品質不會冒充觀戰串流品質；停更時即使畫面維持最後一幀，NET 仍會降級。

來源每 120 幀只更新本機 checkpoint cache；穩態 replay 不推大包。觀戰端首次 `mode-select: replay` 或修復重選時，source 才依序補目前 checkpoint 與其後 bounded backlog。`room-state.spectators[]` 與 `room-state.spectatorSources[]` 均為必填 current shape；後者由房主維護 `{ spectatorPeerId, sourcePeerId, sourceEpoch }` 並與前者一對一。least-loaded 平手依 canonical participant roster，來源離線只重配受影響者；缺欄不觸發相容性 fallback。

觀戰者在 waiting RoomPage 與 participant 共用文字聊天；進入 RacePage 後不建立自由文字或 spectator chat。賽中只唯讀接收 participant 的原始簽章圖示訊息 envelope，並以目前 match、固定 participant roster、loadout 與 sequence 重驗後顯示（[chat-system.md](chat-system.md)、[race-messages.md](race-messages.md)、[觀戰.md §8](../流程/觀戰.md)）。

## 8. 房間設定

觀戰 public policy 掛在 [matchmaking.md §4 `Room`](matchmaking.md)：`allowSpectators`／`maxSpectators`／`spectatorPasswordRequired`／`spectatorPolicyEpoch`。generated invitation 只存在 session memory/sessionStorage；HostRoom 只持 OPAQUE server state，不進 Room 或 room-state。

Race Config 設初值；RoomPage 只有 host＋waiting 可更新。關閉觀戰或 invitation 新增／更換／移除時，`SpectatorServer.applyPolicyChange` 關閉全部通道；新 invitation 必須重新產生並建立新的 OPAQUE registration。match-start 後凍結至賽終。

容量閘不只看已登記 broadcaster count。`SpectatorServer` 必須先從共用 `CapacityReservations<PeerId>` 取得名額，再進 async `openChannel`：唯一條件為 active＋reserved 小於 `maxSpectators`；成功 commit、open 失敗或 dispose release、當前通道 close deactivate。同 PeerId 重連替換舊通道且不新增名額。`maxPendingOpens = 8` 仍只負責匿名半開 DoS 背壓（[D-20260802-06](../decisions/D-20260802-06-active加reserved原子容量.md)）。

## 9. API

觀戰端 app 面（`SpectatorData`，[data-providers 契約](interfaces.md)）＝ 單一進場埠；成功回 `SpectateHandle`（presentation／終局訂閱 ＋ 離場，攝影機由 viewport rig 承擔 ＝ 非本把手）：

```typescript
interface SpectatorData {
  joinAsSpectator(roomId: RoomId): Promise<Result<SpectateHandle>>;   // admission 已在 RoomSession 階段完成
}

interface SpectateHandle {
  subscribeFrames(onFrame: (frame: RenderFrame) => void): Unsubscribe;                 // 插值後渲染幀（與比賽渲染同型）
  onTrackChange(listener: (roundIndex: number, trackRef: string) => void): Unsubscribe; // 換場（訂閱當下已知現回合＝立即補送）
  onVehicles(listener: (vehicles: readonly RaceVehicleVisual[]) => void): Unsubscribe; // canonical roster 真車（遲訂閱補送）
  onHudState(listener: (state: SpectatorHudState) => void): Unsubscribe;
  onCountdown(listener: (roundIndex: number, secondsLeft: number) => void): Unsubscribe; // 來源低頻控制，僅呈現用途
  onRoundEnd(listener: (summary: RoundEndSummary) => void): Unsubscribe;                 // replay 本地導出；fallback 不提供
  onPresentationState(listener: (state: SpectatorPresentationState) => void): Unsubscribe; // 訂閱時立即補送
  onResultReady(listener: (result: { matchId: string; roomId: RoomId }) => void): Unsubscribe;
  onSessionEnd(listener: (reason: SpectatorSessionEndReason) => void): Unsubscribe;
  leave(): void;                                                                        // 冪等：停泵＋關通道＋清訂閱
}
```

participant source 服務面 ＝`SpectatorServer`（[§4.3](#43-spectatorserverparticipant-source-服務端)：`broadcaster` / `spectatorCount` / `listSpectators()` / `dispose()`）。無獨立 `SpectatorApi` 類；攝影機由共用 RacePage `CameraController` 與 viewport rig 承擔（[§5](#5-視角系統3-模式)）。

## 10. 跨模組對接

| 模組 | 對接 |
|---|---|
| [觀戰.md](../流程/觀戰.md) · [賽內機制.md §2.6](../賽內機制.md) | 流程 / 觀戰者特性 / 視角模式 / 淘汰規則 |
| `src/room-runtime/spectator-link.ts` | participant-source 觀戰 link（單向 `'spectator'` DataChannel、JSON 幀；initiator/responder 消歧）|
| `src/race-runtime/spectator-wiring.ts` | 已簽 input／checksum relay、checkpoint 與 fallback projection；觀戰 replay 共用 `mapRenderFrame`／`deriveHudState` |
| `src/pages/race-page/spectator-race-adapter.ts` | 已驗 spectator RoomSession → replay 或 fallback／終局，與 participant 共用 RacePage |
| [signaling-service.md](signaling-service.md) · [peer-discovery.md](peer-discovery.md) | presence 在線快照；RoomService 以固定 participant roster 本地選 source |
| [physics-engine.md](physics-engine.md) | 主模式唯讀 replay 與 SavedState 修復；fallback 才只渲染位姿 |
| [chat-system.md](chat-system.md) · [race-messages.md](race-messages.md) | waiting 共用文字與賽內唯讀圖示 relay |
| [零件與場景.md §12](../零件與場景.md) | 致命 part broken 定義 |
