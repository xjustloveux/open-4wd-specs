---
type: impl
domain: []
summary: 五個已接線抽象介面＋一個保留接縫＋共用型別與同版守門
authority: null
slug: null
---

# interfaces（跨模組介面契約）

> **本檔角色**：跨模組的**介面契約層** —— 共用型別、五個已接線的可替換抽象介面（`SignalingProvider` / `PhysicsEngine` / `Ledger` / `KeyManager` / `PinningProvider`），以及一個保留接縫 `AssetStorage` 的 TypeScript 定義。
> 各介面的**實作**見對應 `程式架構/` 模組（signaling-service / network-sync / ledger / key-manager / pinning-service…）；介面 I/O 中的**領域型別設計**（skill / entity / weapon / 材質）見 canon 主檔（車輛組裝 / 零件與場景 / 材質表 / 建模參數分冊）。對應 `src/interfaces/`。

五個已接線介面各有 TypeScript 定義、現行實作與測試替身（[testing.md](testing.md)），由
同一 app build 的型別檢查與 provider tests 維持一致（[§8](#8-同版守門)）。`AssetStorage`
是保留接縫，首發尚無實作且目前不注入。

## 1. 共用型別

```typescript
export type CID = string; // 任何 IPFS 內容的 CID
export type PeerId = string; // libp2p peer 識別碼
export type Signature = Uint8Array; // Ed25519 簽章（64 bytes；Brand 版見 程式參數/共通規則.md §19.1、hex 僅顯示 / log 用）
export type Timestamp = number; // UNIX 毫秒

/** 結果型別（避免 throw） */
export type Result<T, E = Error> =
  { ok: true; value: T } | { ok: false; error: E };

```

**P2P 即時訊息**的簽章酬載統一用 [key-manager.md §9 `SignedPayload<T>`](key-manager.md)（`{ payload, timestamp, nonce, signer, signature }`，nonce 防重放見 [資安規範.md §3.4](../資安規範.md)）；**ledger 事件不走 SignedPayload**——事件無 nonce，用 `BaseEvent.signature` / 多簽 `signatures[]`，CID 冪等 ＋ 首播 ±30s 取代重放防護（[資料系統.md §11](../資料系統.md) 劃界）。

## 2. SignalingProvider

```typescript
export interface SignalingSession {
  readonly providerId: string;
  readonly scope: string; // room:<roomId> | match:<matchId>
  readonly peers?: readonly PeerId[]; // 精確 roster 僅部分 transport 提供
  send(target: PeerId, message: SignalMessage): Promise<Result<void>>;
  onMessage(
    handler: (
      from: PeerId,
      message: SignalMessage,
      meta: { readonly nonce: string },
    ) => void,
  ): Unsubscribe;
  onPeerJoined?(handler: (peer: PeerId) => void): Unsubscribe;
  onPeerLeft?(handler: (peer: PeerId) => void): Unsubscribe;
  isOpen?(): boolean;
  onClose?(handler: () => void): Unsubscribe; // unexpected transport loss only
  close(): Promise<void>;
}

export interface SignalingProvider {
  readonly providerId: string;
  readonly priority: number; // 越小越優先嘗試
  openSession(input: {
    readonly localPeerId: PeerId;
    readonly scope: string;
  }): Promise<Result<SignalingSession>>;
  isHealthy(): Promise<boolean>;
}

export type SignalMessage =
  // 握手 3 型；傳輸 envelope 見 signaling-service.md §2 signed signal-v1
  | { type: "sdp-offer"; sdp: string }
  | { type: "sdp-answer"; sdp: string }
  | { type: "ice-candidate"; candidate: RTCIceCandidateInit };

export type Unsubscribe = () => void;
```

**正式實作**見 [signaling-service.md](signaling-service.md)／
[peer-discovery.md](peer-discovery.md)：設定中的 `wss://` 端點依順序嘗試第一個健康者，
並同時開啟 `GossipsubSignalingProvider`。兩者以 canonical scope 隔離；
`SignalingMux` 依最後入站 transport 回覆、跨 transport 以 signed nonce 去重。
active transport 意外關閉時，mux 以 `onClose` 通知 room dialer 原子替換整個 provider chain；
明示 `close()` 不發通知，也不觸發重連。
配對、房間公告、RoomId 存在性與觀戰許可不屬此介面，分別由 Gossip matchmaking、
RoomDiscoveryTable 與房主 P2P DataChannel 負責。

## 3. PhysicsEngine

```typescript
export interface StartGridPlacement {
  slot: number;
  playerCount: number;
}

export interface PhysicsEngine {
  readonly engineName: string;
  readonly engineVersion: string; // Rapier 版本，影響 deterministic（見 版本規範.md rapier_version）
  initWorld(config: PhysicsWorldConfig): Promise<Result<void>>;
  loadVehicle(vehicleSpec: VehicleSpec, startGrid?: StartGridPlacement): Result<VehicleId>;
  loadTrack(trackSpec: TrackSpec): Result<TrackId>;
  step(inputs: ReadonlyArray<PlayerInput>): StepOutput; // 推進一 frame（固定 60Hz）
  saveState(): SavedState; // rollback savestate
  savedStateFrame(state: SavedState): number | null; // side-effect-free 完整 schema/topology inspect
  loadState(state: SavedState): void;
  inputSchemaForPeer(peerId: PeerId): ReadonlyArray<SkillSlot> | null;
  computeMeshVolume(meshBytes: Uint8Array): Result<number>; // WASM 內，整數量化
  computeMeshSurfaceArea(meshBytes: Uint8Array): Result<number>;
  computeMeshFingerprint(meshBytes: Uint8Array): Result<MeshFingerprint>; // 防複製，見 anti-piracy.md
  computeStateHash(): string; // desync 偵測，見 network-sync.md
  destroy(): void;
}

export interface PhysicsWorldConfig {
  gravity: Vec3;
  timestep: number; // 鎖死 60Hz（1/60 s）；render catch-up 與 CCD 子步上限不由 caller 設定
}
export type Vec3 = [number, number, number];
```

### 3.1 載入 / Input 型別

```typescript
export interface VehicleSpec {
  vehicleId: VehicleId;
  parts: ReadonlyArray<PartInstance>;
  totalMassGrams: number; // 組裝後有效質量；passive weapon 減重已套用，PartInstance 烘焙值不變
  motor: { torqueRatio: number; autoInputMw: number }; // motor 宣告＋體積派生輸入上限
  battery: { configuredOutputMw: number; energyCapacityMj: number };
  chipSlots: ReadonlyArray<SkillSlot>; // Σ allocationPct ≤ 100
  weapon?: VehicleWeaponSpec; // 未裝＝省略；passive 仍占 weapon 槽
  // 重心／慣量等組裝產物隨車輛組裝層收斂
}

export interface VehicleWeaponSpec {
  passive: boolean; // true＝純物理被動（allocationPct＝加持總量）
  branch?: WeaponBranch; // active 必填
  passiveWeightSplitPct?: number; // passive 專屬：減重 vs 抗性（0–100、預設 50、組裝層）
  ammoCount?: number; // launch 滿彈；必須等於 physics.projectiles.length
  physics?: WeaponPhysicsSpec; // active 必填；runtime 不推斷替代 box／sphere
}

export interface SourceMassProperties {
  readonly principalInertiaPerKgM2: Vec3; // 來源質心處主慣量/kg，m²；不從接觸凸包重算
  readonly inertiaFrame: readonly [number, number, number, number]; // proxy-local 單位四元數
}
export interface PartPhysicsProxy {
  readonly nodeName: string;
  readonly sourceNodeIndex: number;
  readonly material: MaterialId;
  readonly massGrams: number;
  readonly thermalExchangeFactor: number;
  readonly thermalContactAreaM2: number;
  readonly contactAreasM2: DirectionalContactAreasM2;
  readonly wearCapacityJ?: number;
  readonly centroidM: Vec3;
  readonly massProperties: SourceMassProperties;
  readonly pointsM: ReadonlyArray<Vec3>; // deterministic convex support points，4..26
}
export type WeaponPhysicsProxy = Omit<
  PartPhysicsProxy,
  "sourceNodeIndex" | "thermalExchangeFactor" | "thermalContactAreaM2"
>;
export interface WeaponPhysicsActuator {
  actuatorIndex: number;
  pivotNode: string;
  pivotPose: { positionM: Vec3; rotation: [number, number, number, number] };
  axisM: Vec3;
  maxAngleDeg: number;
  speedWeight: number;
  phaseOffsetDeg: number;
  motionCurve: "sin" | "linear";
  payload: ReadonlyArray<WeaponPhysicsProxy>;
  joints: ReadonlyArray<{
    fromNode: string;
    toNode: string;
    type: "revolute" | "spherical";
    anchorM: Vec3;
    axisM?: Vec3;
  }>;
}
export interface WeaponPhysicsSpec {
  version: 1;
  axisPose: { positionM: Vec3; rotation: [number, number, number, number] };
  fixedProxies: ReadonlyArray<WeaponPhysicsProxy>;
  actuators: ReadonlyArray<WeaponPhysicsActuator>;
  projectiles: ReadonlyArray<{
    projectileIndex: number;
    nodeName: string;
    pose: { positionM: Vec3; rotation: [number, number, number, number] };
    proxy: WeaponPhysicsProxy;
    fluidPayload?: {
      volumeM3: number; // Stage 3 套用變換後重算的 canonical 體積
      behavior: "grip_loss" | "sticky" | "freeze" | "burn" | "corrosive";
      params: Readonly<Record<string, number>>;
    };
  }>;
}

/** 零件類型（8 類；單一來源——material-params／builtin-assets 由此 re-export） */
export type PartType =
  | "chassis"
  | "body"
  | "tire"
  | "motor"
  | "battery"
  | "roller"
  | "chip"
  | "weapon";

export interface PartInstance {
  cid: CID;
  partType: PartType;
  meshBytes: Uint8Array; // 視覺／指紋用；物理載入不從此重推幾何（改讀 bakedGeometry）
  /** 多材質宣告陣列（單材質寫成單元素）。宣告格式見 建模參數.md（材質宣告）；
   *  場景檢核由 material 的 forbidden_scopes / allowed_part_types 自動處理，見 材質表.md §8。 */
  materials: ReadonlyArray<{ mesh_node: string; material: MaterialId }>;
  mountTransforms: ReadonlyArray<MountTransform>;
  bakedGeometry: BakedPartGeometry; // 物理載入唯一幾何來源（GLB extras 烘焙、整數量化）——不從 mesh 重推＝跨 peer 決定性
}
/** 零件烘焙幾何：質量與單一能量域熱輸入 */
export interface BakedPartGeometry {
  aabbMinM: Vec3;
  aabbMaxM: Vec3;
  volumeM3: number;
  surfaceAreaM2: number;
  massGrams: number;
  heatCapacityJPerC: number; // Σ(massKg × specificHeat)
  ambientConductanceWPerC: number; // exposed area × capped conductivity factor
  thermalLimitC: number | null; // PhysicsManifest.geometry.thermalLimitC；weakest non-null
}
export type VehicleId = string;
export type TrackId = string;
export type MaterialId = string;
export type MountTransform = { node: string; matrix: number[] /* 16 */ };

export interface TrackSpec {
  trackId: TrackId;
  meshBytes: Uint8Array;
  config?: TrackConfig; // 只由 admitted PhysicsManifest hydrate；runtime 禁讀 extras
  materials?: ReadonlyArray<{ meshNode: string; material: MaterialId }>;
}
export interface TrackConfig {
  trackType: "open" | "fixed";
  lapMode: "linear" | "loop";
  route: ReadonlyArray<RoutePoint>; // RP1 起點、RPn 終點
  checkpoints?: ReadonlyArray<{ positionM: Vec3; halfExtentsM: Vec3 }>; // 依序通過、segment-AABB sweep
  respawnPoints?: ReadonlyArray<TrackRespawnPoint>; // 掉出 fade in（無＝RP1）
  killZones?: ReadonlyArray<{ minM: Vec3; maxM: Vec3 }>; // chassis COM segment-AABB sweep
  magnetSources?: ReadonlyArray<TrackMagnetSource>; // 靜態磁源（N 極＝宣告向量）
  weather?: { type: "normal" | "rain" | "snow"; temperatureC: number };
  gravity?: { direction: Vec3; strengthMps2: number };
  entities?: ReadonlyArray<TrackEntitySpec>; // entityIndex 連續；typed topology 見零件與場景 §10
  // 場地 fluid zone 非宣告欄位＝材質 is_fluid 派生 sensor trimesh（behavior / params 隨材質定義，材質表.md）
}
export interface RoutePoint {
  positionM: Vec3;
  forward: Vec3;
  up: Vec3; // authored surface normal；不得由 gravity／camera 推測
  widthM: number;
}
export interface TrackRespawnPoint {
  positionM: Vec3;
  forward: Vec3;
  up: Vec3;
}
export interface TrackMagnetSource {
  positionM: Vec3;
  strengthN: number;
  nPole: Vec3;
}

export interface PlayerInput {
  peerId: PeerId;
  frame: number;
  events: ReadonlyArray<InputEvent>;
}

export type InputEvent = {
  type: "skill-trigger";
  skillId: SkillId;
  isHoldTick: boolean;
}; // 觸發 chip slot 上的 skill；isHoldTick=Hold 型按住期間每 dt tick；強弱由該 slot allocation_pct 決定（見 車輛組裝.md）
// 玩家賽中唯一輸入 = 技能觸發：迷你四驅車**無轉向**（滾輪貼牆自走）；橫向位移 = swerve_left / swerve_right 技能（賽內機制.md §2.4.1 鍵位）

/** 8 種 skill enum（設計見 車輛組裝.md / 建模參數.md skill slot）*/
export type SkillId =
  | "boost"
  | "brake"
  | "swerve_left"
  | "swerve_right"
  | "jump"
  | "slam"
  | "stabilize"
  | "weapon";

/** chip 的 skill slot：種類 + 動能比例（1–100 整數，整顆 chip 各 slot allocation_pct 總和 ≤ 100）*/
export interface SkillSlot {
  skill: SkillId;
  allocationPct: number;
}

/** 場地 entity 3 類（見 零件與場景.md §10）*/
export type EntityType = "decoration" | "kinematic_move" | "kinematic_conveyor";
export type MotionCurve = "sin" | "step" | "linear"; // kinematic_move 位移曲線

/** 武器分支（active weapon；設計見 建模參數.md weapon 分支 extras / 車輛組裝.md）*/
export interface WeaponBranch {
  mainMeshNode: string; // 主物件 mesh node（依 mechanism 解釋）
  mechanism: "magnet" | "launch" | "general";
  // magnet：無欄位（強度由 chip allocation_pct 決定，N 極方向 = Axis empty +Z）
  // launch：無欄位（子彈 = mainMeshNode 子節點 mesh；落地行為由 bullet 材質決定）
  // general：actuators 有項 = general_actuated（每項一個驅動 pivot），無 = general_push
  actuators?: WeaponActuator[]; // general：≤ MAX_WEAPON_DRIVEN_PIVOTS，見 建模參數/零件與共用介面.md §3.7
}
export interface WeaponActuator {
  pivotNode: string;
  rotationAxis: [number, number, number];
  maxAngleDeg: number; // 1..360（360 連旋 / <360 揮）
  speedWeight?: number; // 預設 1，正規化權重（ωᵢ ∝ weight/Σ）
  phaseOffsetDeg?: number; // 預設 0，相位偏移角度 0..360（與功率脫鉤、相對相位恆定）
  motionCurve?: "sin" | "linear";
  meshNode?: string; // payload A：剛體轉子
  chain?: string[]; // payload B：Chain_Segment 節點名（歸屬清單；鏈序依 GLB children）
}
```

Race HUD 另輸出固定順序的 `skillDisableReasons`：`disallow-chip → chip-broken →
functional-disabled → physics-retired → eliminated → quit`；本機車況尚不可得時使用
`state-unavailable`。陣列非空即代表所有主動技能槽 disabled 且 active=false。這是由當幀
`VehicleState`、逐回合規則與編排層退出集合推導的 presentation/input authority，不持久化成另一個
latch。RacePage 只在 enabled→disabled 邊沿釋放現有 hold，並在任何停用原因存在時於播放音效與
`feedInput` 之前拒絕新 press；物理引擎仍保留獨立 fail-closed 驗證。

### 3.2 輸出型別

```typescript
export interface StepOutput {
  frame: number;
  vehicleStates: ReadonlyMap<VehicleId, VehicleState>;
  collisions: ReadonlyArray<CollisionEvent>;
  finishedVehicles: ReadonlyArray<VehicleId>; // 累計完賽集合（vehicleId 排序＝canonical、非名次）；⚠️完賽幀不得取首次觀測 frame（rollback 重播修正下各 peer 可能不同）——共識完賽幀＝引擎 sim state `RaceProgress.finishedAtFrame`（入 snapshot 與 hash；引擎 `raceProgressOf(vehicleId)` 讀點），RoundResult 名次／finishTimes 由此排
  trackEntities?: ReadonlyArray<TrackEntityState>; // pose／fatigue／broken／fragment presentation；entityIndex 排序
}
export interface VehicleState {
  position: Vec3;
  rotation: [number, number, number, number]; // quaternion
  velocity: Vec3;
  angularVelocity: Vec3;
  weaponNodes?: ReadonlyArray<WeaponNodePose>; // 只允許 baked node-name domain
  parts: ReadonlyArray<PartState>; // per-part fatigue / temperature / broken
  enduranceRemainingPct: number; // 0~100 = battery 剩餘 / 初始 × 100
}
export interface WeaponNodePose {
  nodeName: string;
  space: "vehicle" | "world"; // attached body delta／released projectile world pose
  position: Vec3;
  rotation: [number, number, number, number];
  fired: boolean;
}
export interface PartState {
  partIndex: number;
  fatigue: number; // 0~1，衝撞 / 腐蝕 / 磨耗對稱累積（不可逆）；universal 閾值 1.0；broken 後凍結 1.0
  temperature: number; // °C，per-part 即時（可逆）
  broken: boolean; // 任一路徑達破壞（fatigue ≥ 1.0 / 一擊 stress > ultimate × K_STRESS_BURST_FACTOR / 積分後 T_next > thermalLimitC）
}
export type CollisionEvent = {
  a: VehicleId | TrackId;
  b: VehicleId | TrackId;
  point: Vec3;
  relativeSpeed: number;
};
export type SavedState = Uint8Array; // Rapier 序列化

export interface MeshFingerprint {
  primary: string; // 完整 SHA-256
  features: {
    vertexCount: number;
    volume: number /* 量化整數 */;
    surfaceArea: number;
    aabb: [Vec3, Vec3];
    barycenter: Vec3;
  };
}
```

物理引擎另以 `destructionCountsOfRound(): Readonly<Record<PeerId, number>>` 暴露完整 roster 的回合
直接致毀件數。它是 current SavedState 與 checksum 的共識 state，`RoundResult.destructionCounts` 只可
由此 materialize；不得由呈現層掃描終局 broken 狀態重算。

`fatigue` / `temperature` / `broken` 跨 peer deterministic（sim state）；耐受度 / 熱 / 破壞模型見 [算式表.md](../算式表.md)。

## 4. AssetStorage

`AssetStorage` 是尚未接線的保留接縫，目前沒有實作、啟動注入或 consumer。現行內容讀取由
`bootstrap/asset-source` 統一解析 `builtin:`／`local:`／CID，再由 `ugc-content/UgcBlockSource`
處理 CID 多來源取塊；本節不得被解讀成已存在另一套儲存 runtime。

```typescript
export interface AssetStorage {
  readonly storageName: string;
  get(cid: CID): Promise<Result<Uint8Array>>;
  put(bytes: Uint8Array): Promise<Result<CID>>;
  has(cid: CID): Promise<boolean>;
  getSize(cid: CID): Promise<Result<number>>; // 不下載，僅 metadata
  abort(cid: CID): Promise<void>;
  onProgress(
    cid: CID,
    handler: (loaded: number, total: number) => void,
  ): Unsubscribe;
}
```

## 5. Ledger

```typescript
export interface Ledger {
  readonly ledgerAddress: string; // ＝LEDGER_DB_ADDRESS（build 注入；鏈身分＝資料系統 §1.1）
  open(myPeerId: PeerId): Promise<Result<void>>; // 上線（連線目標＝ledgerAddress）並 sync 至最新檢查點
  appendEvent<T extends LedgerEvent>(
    event: Omit<T, "signature" | "peerId" | "timestamp">,
  ): Promise<Result<EventId>>; // 標準單簽：自動 stamp＋自動簽章
  readEvents(sinceCheckpoint?: CID): AsyncIterable<LedgerEvent>; // 事件自帶 BaseEvent.signature（非 SignedPayload，資料系統 §11）
  getAllEvents(): Promise<ReadonlyArray<LedgerEvent>>; // consensusNow / derive 用全量；LRU miss 只查專屬本機 IDB，遠端 ancestor 走 authenticated bounded entry-fetch
  getDerivedState(): Promise<DerivedState>;
  deriveStateAt(logHeadCids: ReadonlyArray<CID>): Promise<DerivedState | null>; // 完整 frontier 純函數重算；拉不齊回 null
  getLatestLogHeads(): Promise<ReadonlyArray<CID>>; // 診斷／同步用完整 frontier；空帳本回 []
  onEvent(handler: (event: LedgerEvent) => void): Unsubscribe;
  proposeCheckpoint(): Promise<Result<CheckpointProposal>>;
  signCheckpoint(proposal: CheckpointProposal): Promise<Result<Signature>>;
  finalizeCheckpoint(
    proposal: CheckpointProposal,
    signatures: ReadonlyArray<Signature>,
  ): Promise<Result<CID>>;
  getLatestCheckpoint(): Promise<Result<CID>>;
  syncFromCheckpoint(): Promise<Result<void>>;
  syncEventsSince(cids: ReadonlyArray<CID>): Promise<Result<number>>; // 從完整 frontier 同步，不得把 multi-head 壓成單一 CID
}
export type EventId = string;

export interface CheckpointProposal {
  proposalId: string;
  checkpoint: Omit<LedgerCheckpoint, "signatures">; // checkpoint 本體結構＝ledger-checkpoint.md §3 LedgerCheckpoint
  proposer: PeerId;
  proposerSignature: Signature;
  expiresAt: Timestamp;
}
```

方法面 ＝ 完整 `LedgerApi` 中以介面層型別可表達的子集——比賽記錄查詢 ／`appendPreSigned` 等需實作層型別的方法屬 `src/ledger` 具體類（[ledger.md §11](ledger.md)）。

> `LedgerEvent` 事件目錄、`DerivedState` 完整巢狀結構（hot/cold、coldMatchPartitions、退役 / 信譽 / fork 血緣）皆以 [ledger-checkpoint.md §3·§4](ledger-checkpoint.md) 為權威，本介面不重列。`UGCMetadata.type` 為 per-type `open4wd_version` marker 模型（[版本規範.md B 軸](../版本規範.md)）；`forkLineage` 至多 2 層 `[parent, grandparent]`。

## 6. KeyManager

[key-manager.md §2](key-manager.md) 是 `KeyManager` 方法面與 nickname fallback 的唯一權威；本檔不再
複製第二份 interface。整合端只依該契約注入，包含 `getNicknameSnapshot()`、`exportLibp2pSeed()` 與
`signPayload()`；未提供 nickname 時使用 PeerId 的穩定短指紋，不暴露可誤認為身分的字串切片。

## 7. PinningProvider

```typescript
export interface PinningProvider {
  readonly nodeName: string;
  readonly nodeUrl: string;
  readonly source: "manual" | "session" | "community";
  isReadable(): Promise<boolean>;
  getWriteReadiness(): Promise<Result<PinningWriteReadiness>>;
  getDescriptor(): Promise<Result<PinningProviderDescriptor>>;
  pin(request: PinRequest): Promise<Result<void>>;
  unpin(cid: CID): Promise<Result<void>>;
  getStats(): Promise<Result<PinningStats>>;
  getBlockUrl(rootCid: CID, blockCid: CID): string; // provider policy-aware root-scoped fallback
}
export interface PinningProviderDescriptor {
  schemaVersion: 1;
  providerId: string;
  capabilities: {
    ugcRead: { enabled: boolean };
    ugcWrite: { enabled: boolean; authorization: "operator-policy" };
    legalNotice: { enabled: boolean };
    counterNotice: { enabled: boolean };
    transparency: { enabled: boolean };
  };
  declarations: {
    designatedAgentRegistration: "not-declared" | "registered";
    safeHarborEligibility: "not-asserted";
  };
  policies: {
    ugc?: string;
    legal?: string;
    privacy?: string;
    retention?: string;
  };
}
export const PIN_REQUEST_CATEGORIES = ["part", "track"] as const;
export type PinRequestCategory = (typeof PIN_REQUEST_CATEGORIES)[number];

export interface PinRequest {
  cid: CID;
  category: PinRequestCategory;
  sizeHintBytes: number; // 簽章涵蓋的正整數；完整 logical DAG bytes 硬上限，禁止低報
}
export interface PinningStats {
  nodeId: string;
  version: string;
  totalPinnedCount: number;
  totalSizeBytes: number; // 目前 pinned roots 的 logical referenced bytes 合計
  acceptingPins: boolean;
  quotaUsedBytes: number; // 目前 Cluster roots 引用的唯一 block bytes
  quotaLimitBytes: number;
  availableSpaceBytes: number;
  ipfsClusterPeers: number;
  uptime: number /* 秒 */;
  lastSyncTimestamp: Timestamp;
}
export interface PinningWriteReadiness {
  ready: boolean;
  reason:
    | "ready"
    | "not-authorized"
    | "not-advertised"
    | "invalid-stats"
    | "no-capacity";
}
```

HTTP 實作會嚴格解析 `/provider` 與 `/stats`。`isReadable()` 只判斷 descriptor 合法、
`ugcRead.enabled` 且 root-scoped read API 健康，不得因沒有 write、stats 或可用容量而把 read-only provider
判為不可讀。`getWriteReadiness()` 是獨立的寫入閘門：玩家設定必須對該 provider 明示
`writeEnabled`，descriptor 必須宣告 UGC write，之後才可讀取 `/stats`，並要求 response 合法、
`acceptingPins === true`、`ipfsClusterPeers > 0` 與 `availableSpaceBytes > 0`；任何一項不符都不得呼叫 `pin()`。`totalSizeBytes`
是 logical root bytes；quota used/limit 是節點帳本的 unique referenced block bytes，不能取代 Kubo
剩餘空間或被 client 解讀為即時磁碟占用。指定代理人登記狀態只由營運者
聲明，client 永遠不據此推導安全港資格。四個 `policies` 欄位皆為營運者選填的公開 HTTPS
連結；adapter 拒絕 credentials、query、fragment、非 HTTPS 與未知鍵，但不依內容推導信任或
合規狀態。`pin()`／`unpin()` 使用 `KeyManager.signPayload()` 產生既有 API 所需的
canonical DAG-CBOR 簽章。實作見 [pinning-service.md](pinning-service.md)。
507 配額失敗維持 `code: "quota-exceeded"`，並只在 server body 通過封閉 shape 驗證時附加
`reason?: "signer-pins" | "signer-size" | "global-size"`；adapter 不保留原始 error body。

`PinningProvider` 不提供遠端 pin inventory 列舉；節點內部的 cluster list 只供配額、stats 與
reconcile。線上 UGC 讀取會先嘗試本機快取與 Helia／Bitswap，短 timeout 後才以同一 UGC root
呼叫 `getBlockUrl(rootCid, blockCid)`；每條路徑共用 CID、大小上限與 sanitizer 驗證。多個
provider 是 first-valid-wins；2xx 只代表 transport 候選，內容驗證失敗必須繼續下一個，不得
阻斷 fallback。沒有 root context 的 raw gateway URL 不屬受 provider policy 控制的讀取契約。
`UgcBlockSource.get(rootCid, blockCid)` 的各 block request 可在全域 8／每來源 4 的上限內並行；
privacy-first 預設延遲 hedge，speed-first 可立即 hedge。完整 DAG 重組與 canonical root 驗證完成
後才可交給 GLB sanitizer／render／指紋流程，任何 partial union 都不是可用資產。

`source` 只記錄候選來自玩家手動設定、當次 session 或 community registry，不是 trust level。
`community-listed` 只表示上次檢核時技術上可發現；registry listing 不會啟用 `pin()`、授予
write permission 或推導 DMCA／安全港資格。`operator` 是負責 deployment 的人或組織，
`provider` 是 capability endpoint，`self-hosted` 只描述玩家／社群自行營運。

## App Shell runtime snapshot

```typescript
type AppRuntimePhase =
  | 'locked'
  | 'launching'
  | 'local-ready'
  | 'reconnecting'
  | 'online-ready';

type RuntimeFailureKind =
  | 'physical-offline'
  | 'node-unavailable'
  | 'ledger-unavailable'
  | 'signaling-unavailable'
  | 'unknown';

interface AppCapabilities {
  identity: boolean;
  onboarding: boolean;
  localGarageRead: boolean;
  localGarageWrite: boolean;
  localAssetRead: boolean;
  localAssetWrite: boolean;
  localUgcEdit: boolean;
  glbImport: boolean;
  glbExport: boolean;
  localRace: boolean;
  ledgerRead: boolean;
  ledgerWrite: boolean;
  ugcPublish: boolean;
  ugcFork: boolean;
  slotUnlock: boolean;
  matchmaking: boolean;
  room: boolean;
  chat: boolean;
  spectator: boolean;
  turnRelay: boolean;
  rating: boolean;
  moderation: boolean;
  arbitration: boolean;
}

interface AppRuntimeSnapshot {
  revision: number;
  onlineEpoch: number;
  phase: AppRuntimePhase;
  capabilities: Readonly<AppCapabilities>;
  failure: RuntimeFailureKind | null;
}
```

snapshot 由 App Shell 唯一持有並原子發布；consumer 不得由連線布林值、route 或 phase 名稱重算
能力。合法轉移與 fail-closed 規則見 [pwa-offline.md](pwa-offline.md)。

## 8. 同版守門

五個已接線 provider 與 app 在同一 TypeScript build 內發布，不存在可獨立替換、需要 runtime
semver negotiation 的第三方 provider ABI。介面 shape 由 `src/interfaces/`、`check:types` 與各
provider contract test 守住；未接線的 `AssetStorage` 只保留型別接縫。

跨 peer／跨版本協議相容仍由 `src/versioning/client-version.ts` 的 client version negotiation
負責，該機制比較 client、protocol、economy、Rapier 與材質版本，不能與同版 provider 型別混用。

## 9. 跨模組對接

| 介面                | 實作模組                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SignalingProvider` | [signaling-service.md](signaling-service.md) · [peer-discovery.md](peer-discovery.md)                                                                                          |
| `PhysicsEngine`     | `physics-engine/`（Rapier 包裝）· I/O 領域型別設計見 [車輛組裝.md](../車輛組裝.md) / [零件與場景.md](../零件與場景.md) / [材質表.md](../材質表.md) / [算式表.md](../算式表.md) |
| `AssetStorage`      | 保留接縫；現行讀取由 `bootstrap/asset-source` + `ugc-content/UgcBlockSource` 負責                                                                                           |
| `Ledger`            | [ledger.md](ledger.md)（事件 / DerivedState / 檢查點 權威）                                                                                                                    |
| `KeyManager`        | [key-manager.md](key-manager.md)                                                                                                                                               |
| `PinningProvider`   | [pinning-service.md](pinning-service.md)                                                                                                                                       |
