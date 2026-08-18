---
type: impl
domain: ["比賽房間"]
summary: TrueSkill／既有公開房 Quick Match／動態窗口／房間管理／loadout 提交驗證
authority: decisions/D-20260814-23-Ready提交驗證與倒數.md
slug: null
---
# matchmaking（配對 / 房間 / 賽前 loadout 實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/matchmaking.md](程式流程/matchmaking.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：配對與房間的**實作層** —— TrueSkill 整合、既有公開房 Quick Match（動態窗口）、房間管理、賽前 loadout 提交與驗證、RoomId 生成。
> 配對設計見 [賽內機制.md §1](../賽內機制.md)；TrueSkill 算式見 [算式表.md §20](../算式表.md)；新手保護見 [信譽系統.md §4.1](../信譽系統.md)。對應 `src/matchmaking/`。
> **賽後結算簽章交換協議**（completes 配對後的比賽生命週期）**不在本檔** —— flow 見 [比賽結算.md §8](../流程/比賽結算.md)、訊息/函式實作見 [ledger-settlement.md §5](ledger-settlement.md)、計算見 [economy.md §4](economy.md)。

## 1. TrueSkill 整合（自製整數定點實作）

**不用 `ts-trueskill`**（浮點庫）——rating 屬共識 derive（全網重算需 bit-exact）、浮點與 Gaussian erf 禁入（[資料系統.md §17](../資料系統.md)）。自製整數定點實作 `trueskill-fixed.ts`，**算式權威 ＝ [算式表.md §20](../算式表.md)**（成對近似、isqrt、`TRUESKILL_V_TABLE_X1000`／`TRUESKILL_W_TABLE_X1000` 查表）：

```typescript
interface RatingX1000 { muX1000: number; sigmaX1000: number }   // X1000 整數定點

const newPlayer = (): RatingX1000 => ({
  muX1000: TRUESKILL_MU_INITIAL_X1000,        // 25000
  sigmaX1000: TRUESKILL_SIGMA_INITIAL_X1000,  // 8333
});

// 8 玩家比賽結束後更新（rankings = 總名次，一場比賽更新一次）；純整數、跨 peer bit-exact
function updateRatingsAfterMatch(
  participants: PeerId[], rankings: PeerId[], current: Map<PeerId, RatingX1000>,
): Map<PeerId, RatingX1000> {
  // 對每有序對算 Δμ 與 w（算式表 §20 成對近似），Σ ÷ (P−1)、σ 用平均 w̄ 縮減一次
  return trueskillFixedUpdate(participants, rankings, current);
}

function getDisplayRating(r: RatingX1000): number {
  return Math.max(0, r.muX1000 - 3 * r.sigmaX1000);   // X1000 整數；UI 顯示 ÷1000
}

// 頻繁斷線者：σ 維持較大、不收斂（呼應 reputation frequent-disconnect）
// threshold = FREQUENT_DISCONNECT_THRESHOLD（5）、σ 下限 = TRUESKILL_SIGMA_MIN_X1000（6000）——protocol.md §6
// disconnectCount = MatchDerivedState.disconnectCounts 規則索引（match-result 或本人 race-leave 累積；兩路以持久 (matchId, peerId) 去重，每場更新後對達標者托底，ledger.md）
function adjustRatingForFrequentDisconnects(r: RatingX1000, disconnectCount: number): RatingX1000 {
  if (disconnectCount < FREQUENT_DISCONNECT_THRESHOLD) return r;
  return { muX1000: r.muX1000, sigmaX1000: Math.max(r.sigmaX1000, TRUESKILL_SIGMA_MIN_X1000) };
}
```

賽後 rating 更新時機見 [比賽結算.md §7](../流程/比賽結算.md)；`TRUESKILL_V_TABLE_X1000`／`TRUESKILL_W_TABLE_X1000` 離線生成、隨 client 出貨（同仲裁權重表模式）。

## 2. Quick Match 房間廣告契約

Quick Match 只消費 [peer-discovery.md](peer-discovery.md) 已驗證的 `room-announce` 投影；它不廣播玩家 `match-request`、不交換 `match-offer`，也不建立預設房：

```typescript
interface QuickMatchRoomAdvertisement {
  roomId: RoomId;
  visibility: 'public' | 'private';
  quickMatchEnabled: boolean;
  participantPasswordRequired: boolean;
  state: 'waiting' | 'preloading' | 'racing' | 'settling' | 'closed';
  playerCount: number;
  maxPlayers: number;
  clientVersion: string;
  ratingAnchorX1000: number; // 現有 participant displayRating 的決定性中位數
}
```

`visibility` 與 `quickMatchEnabled` 都是明確建房政策，不得由「沒有 participantPassword」反推。公告只供候選預篩；最終是否可加入仍由房主的 participant admission 以最新房態判定。

## 3. 既有公開房選擇（動態窗口）

`selectQuickMatchRoom` 只保留 public、quick-match-enabled、無 participantPassword、`waiting`、仍有 participant 空位且 client version 相容的房。discovery 摘要不攜帶 `mode`／`rulesKey`；`disallowChip` 的唯一權威是入房後 `MatchConfig.rounds[]`，UI 若需要摘要只能由逐回合值本地衍生。rating 使用 `displayRating ÷ 1000` 整數分域：初始 ±5，每滿 10 秒 +5，上限 ±30。

同一輸入下候選固定依下列順序選擇，不能依網路到達順序決定：

1. rating anchor 距離較近；
2. 現有 participant 較多；
3. `RoomId` 字典序較小。

選中後呼叫一般 `joinRoom(roomId, { role: 'participant' })`。若公告已過期、最後一席被搶走或 admission 失敗，回到 discovery 輪詢並持續到 `QUICK_MATCH_TIMEOUT_MS`（120000 ms）；逾時提示，**不得自動建房**。取消或 dispose 必須停止輪詢；若取消與成功 admission 競速，已加入者立即離房，不留下 presence 或 reservation（[D-20260802-08](../decisions/D-20260802-08-Quick-Match加入既有公開房.md)）。

配對窗口設計見 [賽內機制.md §1.2](../賽內機制.md)；新手保護見 [信譽系統.md §4.1](../信譽系統.md)。

### 3.1 個人封鎖清單執行點（blocklist，本地）

規範見 [賽內機制.md §1.7](../賽內機制.md)。清單存 IndexedDB `open-4wd` store `blocklist`（store 清單見 [pwa-offline.md §5](pwa-offline.md)；**永不上鏈**）。公開 Quick Match／房間廣告不含 participant roster，不得為封鎖預先揭露成員；執行點收斂如下：

```typescript
// ① 我當房主：拒絕封鎖對象的 join 請求（回通用原因、不揭露封鎖狀態）
if (blocklist.has(joinRequest.sender)) return reject('房間無法加入');
// ② 所有非房主拒入情境：只對已接受的初始／後續權威 participant roster 計算本機交集
const conflicts = blockedRoomPeers(roomState.members, blocklist, me);
ui.setPersistentBlockedRoomWarning(conflicts, { action: '離開房間' });
```

相同 roster snapshot 不重複提示；衝突存在期間警示持續顯示，對方等待房文字與賽中圖示在
本機隱藏。這不是踢人請求，也不對全房廣播。waiting 階段的一鍵離房不進入棄賽處罰；賽內
3、2、1、GO 不負責個人設定鎖定或重新執行此裁決。

聊天靜音共用同一份清單（[chat-system.md §3](chat-system.md)）。

## 4. 房間管理

```typescript
interface Room {
  roomId: RoomId; hostPeerId: PeerId;
  visibility: 'public' | 'private';
  quickMatchEnabled: boolean;
  participantPasswordRequired: boolean; // public 唯讀；invitation／OPAQUE state 不在 Room
  participantPolicyEpoch: number;       // 同 RoomId 固定，0=open、1=受 invitation 保護
  members: PeerId[];                              // 進房順序
  maxPlayers: number;                            // ≤ min(各回合 track auto_player_max)（建模參數/零件與共用介面.md §5.4）、≤ PLAYERS_PER_RACE_MAX
  matchConfig: MatchConfig;
  currentMatchId?: string;                       // 當前比賽 id＝deriveMatchId(room.members, startedAt, matchRules, gridProof)；綁 roster 與可驗算起跑證明——見 §4.1
  pinnedCheckpointCid: CID;                      // 房間 pin 的帳本檢查點（版本規範 §20；B 軸可用性判定基準、`ROOM_PINNED_CHECKPOINT_MAX_AGE_HOURS` 檢核）
  allowSpectators: boolean;                      // 預設 true（spectator.md §8）
  maxSpectators: number;                         // 預設 20、固定範圍 0..50；達上限 join 失敗提示「觀戰滿了」
  spectatorPasswordRequired: boolean;
  spectatorPolicyEpoch: number;                  // 每次接受的 waiting mutation 遞增；secret 不在 Room
  state: 'waiting' | 'preloading' | 'racing' | 'settling' | 'closed';   // preloading→racing 每回合循環 N 次，最後一回合後 settling；closed＝房主鏈斷（§6）
  createdAt: Timestamp;
}
interface MatchConfig {
  rounds: RoundConfig[];                          // 長度 = MATCH_ROUND_COUNT（1..MAX）；房主逐回合設定（loadout 見 車輛組裝.md §2）
  matchRules: MatchRules;                         // 全場通用規則容器；新房目前為空
}
interface RoundConfig {
  trackRef: PartRef;                              // 該回合場地（CID 或 builtin:track-XX；各回合可重複同軌）
  lapCount: number;                               // 圈數（僅 lap_mode: loop 可 >1；linear/open = 1；RACE_LAP_COUNT_*）
  durationLimitSec: number;                       // 該回合賽程時間上限（RACE_DURATION_*）
  disallowChip?: boolean;                         // 該回合停用晶片主動技能；不限制晶片車參賽
}
interface RoomCreationAccessPolicy {
  visibility: 'public' | 'private';
  quickMatchEnabled: boolean;
  participantPassword?: string;                   // generated 192-bit participant invitation
  allowSpectators: boolean;                      // 預設 true
  maxSpectators: number;                         // 預設 20、0..50
  spectatorPassword?: string;                     // generated 192-bit spectator invitation
}
```

`auto_player_max` 只讀 canonical 場地 GLB 的 root extras，不以 browse card 的 metadata hint
取代。Race Config 以所有 `rounds[].trackRef` 的最小容量做即時 preflight；正式 provider 在
`RoomService.createRoom` 前重新解析並套同一規則。任一 ref 缺失、未解析或容量不在
`PLAYERS_PER_RACE_MIN..TRACK_MAX_PLAYERS_HARDCAP` 都回 `errors.room.badConfig`；成功後
`Room.maxPlayers` 是 participant admission 的最終原子上限。

**〔ROOM-R-018〕** spectator policy 由 Race Config 建房時給初值；RoomPage 只有 host 且 `waiting` 可更新。新增／更換 invitation 必須由 CSPRNG 產生 192-bit 值並建立新的 OPAQUE registration；省略＝保留、`null`＝移除。每次接受的更新遞增 epoch，credential mutation 或關閉觀戰會移除全部 spectator（[D-20260806-01](../decisions/D-20260806-01-OPAQUE角色邀請驗證.md)）。

**〔ROOM-R-019〕** 所有非同步容量 admission 共用 `CapacityReservations<Key>`：`tryReserve` 以 active＋reserved 原子判斷，成功只可 commit 或 release 一次。相同 active key 重連不新增占用；active transport 關閉才 deactivate。Spectator admission 與後續 participant Quick Match reservation 不得各自重寫計數（[D-20260802-06](../decisions/D-20260802-06-active加reserved原子容量.md)）。

**〔ROOM-R-020〕** `joinRoom` 必須以具名 `RoomJoinRequest` 明確指定 participant 或 spectator。兩角色先進 room-control admission；spectator 可在 waiting 加入，但不進 participant roster、ready、matchId、host succession 或 race mesh。participant 滿員不得自動降級 spectator（[D-20260802-07](../decisions/D-20260802-07-RoomSession角色化admission.md)）。

**〔ROOM-R-021〕** Quick Match 只加入既有 `visibility=public`、`quickMatchEnabled=true`、無 participantPassword 的 waiting 房；公告以現有 participant displayRating 中位數作錨。候選 admission 失敗回到輪詢，逾時不得建立 fallback 房；participant 容量沿用 ROOM-R-019 的 reservation（[D-20260802-08](../decisions/D-20260802-08-Quick-Match加入既有公開房.md)；向量 `room/quick-match-selection`）。

圈數 / 賽程時間上限為**逐回合**房間設定（非場地 GLB 屬性），見 [賽內機制.md §1.5](../賽內機制.md)。
`disallowChip` 同屬逐回合規則；每回合未提供時為 `false`。

### 4.1 matchId 生成契約（綁 roster）

`currentMatchId` **非隨機值**，而是由開賽名單決定性推導（`src/ledger` `deriveMatchId`）：

```typescript
matchId = deriveMatchId(roster, startedAt, matchRules, gridProof);
//   roster     = 開賽時房間成員（room.members；函數內去重＋字典序排序）
//   startedAt  = LockedStartPackage 鎖定的開賽時戳（同房連續多場靠此區異）
//   matchRules = MatchConfig.matchRules
//   gridProof  = 已驗證 StartGridProof；digest 綁 contextDigest 與 gridSeed
// deriveMatchId = canonical 序列化 {type:'match-id', roster, startedAt, matchRules,
//                 gridContextDigest, gridSeed}
//                 的 sha-256 digest（hex 64 字；同輸入同 id、跨端一致）
```

matchId 的 roster 是 `LockedStartPackage` 的原鎖定名單；倒數中已確認斷線者仍留在該名單與原格位，另列 `preStartDisconnects`，不得用 survivor set 重算 id。開賽後名單只會「往 disconnects 移」不會增員；驗證端以 `sorted(ranking ∪ disconnects)` 重組原開賽名單，再以事件必填的 `gridProof` 同式推導。

**為何綁 roster**：`matchId` 綁定名單後，任一 peer 都無法為「任意自陳名單」配出他場的合法 `matchId`——單人自陳 `ranking`（quorum=1 自簽）只能配出「自己那組名單」的 id，杜絕搶佔任意 `matchId` 先行 settle、毒化持久去重集（`settledMatchIds`）使該場真結果被冪等閘吞。

### 4.2 起跑格 proof 與 slot mapping

`GridLockedContext` exact shape 為 version 1、seriesId、canonical roster、逐回合 canonical track manifest digest、match rules 與 round count。每位 participant 先簽 `grid-commitment`，全 roster 鎖定後才簽 `grid-reveal`；nonce 固定 32 bytes。同一 context 重試快取並重用同一組本機 commitment/reveal，roster／rules／manifest／series 任一變更才建立新 context。

`gridSeed = SHA-256(domain || lockedContext || sorted(PeerId, nonce))`，不得含 `startedAt` 或房主提供的陣列順序。base permutation 依 `SHA-256(domain || gridSeed || PeerId)` 排序；第 r 回合 slot 為 `(baseIndex + r) mod N`。車輛物理拓撲依 PeerId 字典序建立，slot 只由 proof 本地重算後以明確 mapping 傳入引擎，與 load order 無關。完整規則見 [D-20260814-20](../decisions/D-20260814-20-多人可驗算起跑格.md)。

### 4.3 ReadyDeclaration、ReadySet 與 LockedStartPackage

個人 `ReadyDeclaration` 簽署 `{ roomId, configDigest, membershipEpoch, participant, clientVersion, carRotation }`，不綁完整 roster；因此換人只作廢集合層，不抹除其他玩家的最終選擇。完整 roster 都有聲明後才建立 canonical `ReadySetContext` 與 digest。每端驗過同一集合的簽章、A 軸版本、實際 admitted manifests、loadout 結構與 B 軸資產版本，才簽 `ReadySetAcknowledgement`。

全 ack 後才執行起跑格 commitment／reveal，並形成不可變 `LockedStartPackage`：ReadySet context／digest、全部聲明與 ack、grid proof、matchId、startedAt、倒數 deadline 與聲明簽章索引。package 在倒數前複製到全員，RaceSession 只消費它；車庫後續變化不能改變本場輸入。倒數斷線只改 survivor transport 與 `preStartDisconnects`，package、matchId 與 slot mapping 不變。

## 5. 賽前 loadout 提交

`preloading` 狀態仍交換 matchId-bound `LoadoutSubmission`，用途是產生可寫入 ledger 的本場參與證明與第二道驗證；其 `carRotation` 必須精確等於 waiting 階段 LockedStartPackage 內的聲明，不再是選車入口。不同即整場 fail closed。

```typescript
interface LoadoutSubmission {
  type: 'loadout-submit'; matchId: string; participant: PeerId;
  loadout: MatchParticipantLoadout;              // 結構見 ledger-settlement.md §5 / 車輛組裝.md §2
  submittedAt: Timestamp; signature: Signature;  // 玩家私鑰簽 loadoutSigningMessage(matchId, loadout)＝綁 matchId
}
// MatchParticipantLoadout = { peerId; carRotation: VehicleLoadout[] }（長度 = MATCH_ROUND_COUNT、一車 / 回合；定義見 ledger-settlement.md §5）
// 簽章綁 matchId＝**參與證明**：loadout 交換時各端收集全體簽章，賽後隨結算存進 MatchResultEvent.loadoutSignatures，
//   收件⓪-loadout 據以驗「被列 loadouts 者確有本場簽章 loadout」＋applier 只罰／只評有 loadout 者
//   （absent〔未交 loadout〕＝無承諾、不罰）——擋憑空自造一場塞人投毒信譽（見 ledger-admission.md §1）。

async function validateLoadoutSubmission(sub: LoadoutSubmission, room: Room, modState: ModerationDerivedState): Promise<Result<void>> {
  // 1. 簽章（綁 matchId＝跨場不可重放；verify(message, signature, peerId)，見 key-manager.md）
  if (!await keyManager.verify(loadoutSigningMessage(sub.matchId, sub.loadout), sub.signature, sub.participant)) return error('簽章無效');
  // 2. matchId 一致
  if (sub.matchId !== room.currentMatchId) return error('matchId 不符');
  // 3. participant 為房間成員
  if (!room.members.includes(sub.participant)) return error('非房間成員');
  // 3.5 車數 = 回合數（一台 / 回合；carRotation 可變長、需 runtime 檢核）
  if (sub.loadout.carRotation.length !== room.matchConfig.rounds.length) return error('車數需等於回合數');
  for (const car of sub.loadout.carRotation) {
    const refs = collectPartRefsFromLoadout(car);
    // 4. 不可含 local:*（正式賽）
    if (refs.some(r => r.startsWith('local:'))) return error('正式賽不可使用本地零件');
    // 5. 不可含黑名單 CID（見 moderation.md）
    for (const ref of refs)
      if (!ref.startsWith('builtin:') && modState.blacklist.has(ref as CID)) return error(`含黑名單 UGC：${ref}`);
    // 6. 結構檢核（8 類零件、mount 對齊、passive 加持分配值域與 passive-only），見 車輛組裝.md §2·§3.1·§3.5 / 建模參數/零件與共用介面.md §6
    const sc = validateStructure(car);
    if (!sc.ok) return error(sc.error);
    // 7. B 軸資產版本可用性（版本規範 §24）：依 room.pinnedCheckpointCid 的動態 min-supported 判定，unusable → 拒；降版本映射於載入時套用
    const va = validateAssetVersions(refs, room.pinnedCheckpointCid);
    if (!va.ok) return error(va.error);
  }
  return ok(undefined);
}
```

### 提交時間窗

| 階段 | 時長 | 行為 |
|---|---|---|
| 等待提交 | `LOADOUT_SUBMIT_WINDOW_SEC`（60 秒）| 收集所有 participant 的 LoadoutSubmission——**窗內收件即驗、窗到即定案**（無獨立互驗窗）|
| 進入 racing | — | 全通過 → `racing`；某人未提交 → 落 `disconnects`（absent＝無 loadout 參與證明、不罰，[ledger-admission.md §1](ledger-admission.md)）|

60 秒窗與 2 秒重送以單調時鐘的絕對 deadline 為真值；timer 僅喚醒。頁面由背景回前景時立即定案已逾期的窗，或補送一次已到期的本機提交，不讓瀏覽器 timer throttling 延長協議時間。

**`LoadoutSubmission` 不單獨寫 ledger**，賽後納入 `MatchResultEvent.loadouts`（見 [ledger-settlement.md §5](ledger-settlement.md)）一併儲存（省空間；loadout 跟 ranking/signatures 綁定才有意義）。

### 重連時的 loadout 處理

中途斷線 < 15 秒（`RECONNECT_TIMEOUT_MS`）可重連者**沿用原 loadout**（防偷換）：重連 peer 比對 `loadoutHash`，不符 → 拒絕重連、視為新連線。

## 6. 進房 / 房主變更

進房與房間即時態的**傳輸層 ＝star 拓撲**（成員各一條 WebRTC link 連房主、房主權威 ＋ 中繼；presence 房域探索、房主繼任），落地見 [room-runtime.md](room-runtime.md)。本節僅列房主變更的 domain 函式（room-runtime `#onHostLost` 呼叫）：

```typescript
// 房主離開：僅 waiting 階段由進房順序下一位接任（racing/settling 房主無作用）
function handleHostLeft(room: Room): Room {
  if (room.state !== 'waiting') return room;
  const next = room.members.find(p => p !== room.hostPeerId);
  return next ? { ...room, hostPeerId: next } : { ...room, state: 'closed' };
}
```

進房裁決（OPAQUE role invitation／容量／封鎖／重複身分，認證拒絕＝通用原因）、participant-only encrypted succession、開賽編排皆在 [room-runtime.md §4·§6](room-runtime.md)。

## 7. RoomId 生成

```typescript
type RoomId = string & { readonly __roomId: unique symbol };
function generateRoomId(): RoomId {
  return parseRoomId(crypto.randomUUID())!; // canonical lowercase UUID v4
}
async function createUniqueRoomId(roomDiscovery: RoomDiscoveryPort): Promise<RoomId> {
  while (true) {
    const roomId = generateRoomId();
    if (!await roomDiscovery.roomExists(roomId)) return roomId;
  }
}
```

`RoomId` 是不可重用的房間實例識別，canonical wire 形式為小寫 UUID v4（122 bits
Web Crypto 隨機性）。存在性來自已驗簽 Gossip 房間公告表，不依賴 signaling server；
建房時若極低機率撞到仍存活房間則重生；wire 只接受這個 UUID 形狀，見
[D-20260802-01](../decisions/D-20260802-01-RoomId房間實例識別.md)。

## 8. API

```typescript
interface MatchmakingApi {
  quickMatch(): Promise<Result<{ roomId: RoomId }>>;
  cancelQuickMatch(): void;
  createRoom(
    config: MatchConfig,
    accessPolicy?: RoomCreationAccessPolicy,
    maxPlayers?: number,
  ): Promise<Result<{ roomId: RoomId }>>;
  joinRoom(roomId: RoomId, request: RoomJoinRequest): Promise<Result<void>>;
  leaveRoom(): Promise<void>;
  getMyRating(): Promise<{ mu: number; sigma: number; display: number }>;
  getRating(peerId: PeerId): Promise<{ display: number } | null>;
  onRoomStateChange(handler: (room: Room) => void): Unsubscribe;
}
```

## 9. UI 整合

- TrueSkill 顯示：`★ {displayRating}` + `(新手)` 標籤（< 10 場）。
- 配對等待：顯示等待時間 + 當前搜尋範圍（`★ {rating-tolerance} ~ {rating+tolerance}`）+ 取消。

## 10. 跨模組對接

| 模組 | 對接 |
|---|---|
| `versioning/`（[versioning.md](versioning.md)）| `checkCompatibility` 配對預篩 + create／join／Ready 的 `isPinnedCheckpointFresh` + 開賽前資產 `preRaceVersionCheck` |
| `room-runtime/`（[room-runtime.md](room-runtime.md)）| 等待房 star 拓撲傳輸／房主權威中繼／開賽編排／quickMatch 接線（`Room`／`deriveMatchId`／loadout 驗證 domain 消費端）|
| `signaling-service/` | WebRTC 握手（`performHandshake`）＋ presence 房域註冊 |
| `network-sync/`（[network-sync.md](network-sync.md)）| 配對成立後 mesh DataChannel + 賽內同步（開賽後另建）|
| `ledger/`（[ledger.md](ledger.md)）| `MatchParticipantLoadout` / `MatchResultEvent.loadouts`；賽後結算簽章協議 |
| `economy/`（[economy.md](economy.md)）| 賽後結算計算 + disconnect 規則 |
| `moderation/`（[moderation.md](moderation.md)）| loadout 黑名單檢核 |
| `key-manager/`（[key-manager.md](key-manager.md)）| loadout 簽章驗證 |

## 11. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 配對等太久 | tolerance 動態擴大 + 顯示時間 |
| 新人配對困難 | σ 大自然容忍範圍寬 |
| Sybil 假帳號刷 σ | 鑄幣 / 比賽結果簽章門檻自然抑制 |
| RoomId 碰撞 | UUID v4 122 bits；存活碰撞仍以 discovery 檢查後重生 |
| 大廳訊息洪水 | Signaling 端速率限制 |
