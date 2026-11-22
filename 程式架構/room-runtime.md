---
type: impl
domain: ["比賽房間"]
summary: 等待房 star 拓撲／可驗 ReadySet／倒數繼任／開賽編排
authority: decisions/D-20260814-23-Ready提交驗證與倒數.md
slug: null
---
# room-runtime（等待房 star 拓撲 / 開賽編排 / quickMatch 接線）

> **本檔角色**：等待房的**傳輸與編排實作層** —— 成員 ↔ 房主的 star 拓撲 WebRTC link、房主權威 Room 狀態與中繼、presence 探索、房主繼任、可驗證 ReadySet、LockedStartPackage 與自動倒數／開賽 handoff、Quick Match 房間 discovery 接線。對應 `src/room-runtime/`。
> 配對演算法、房間 domain（`Room`／`MatchConfig`／loadout 驗證 ／matchId 契約）見 [matchmaking.md](matchmaking.md)；配對流程見 [配對.md](../流程/配對.md)；賽內 mesh（開賽後全連接同步）見 [network-sync.md](network-sync.md)；WebRTC 握手 glue 見 [signaling-service.md](signaling-service.md)。

## 1. 拓撲：等待房 star vs 賽內 mesh

兩層傳輸分工，**壽命與形狀皆不同**：

| | 等待房（room-runtime） | 賽內（network-sync `RaceMesh`） |
|---|---|---|
| 形狀 | **star**：每成員一條 link 連房主、房主權威＋中繼 | **full mesh**：固定名單全連接 |
| 成員變動 | 動態（進出、繼任）| 固定（開賽名單定、all-or-nothing） |
| 成形時機 | 進房即建 | 開賽確認後於 session start 全新建 |
| 權威 | 房主持 `Room` 真相 | 無中心（rollback netcode 共識） |

等待房不共用賽內 mesh：`RaceMesh` 是固定名單、進出成員會破壞其 all-or-nothing 語意；且等待房需要房主權威中繼（聊天 ／ready／ 狀態機）。開賽確認後賽內 mesh **重新**於 session start 建（見 [network-sync.md](network-sync.md)），與等待房 link 各自獨立——對應 [比賽進行.md](../流程/比賽進行.md) 「mesh 於開賽確認後成形」的流程序。

**〔ROOM-R-017〕** 連線健康共用 `(peerId, plane, generation, status)` 形，但資格按平面隔離：本模組只寫 `room-control`，重綁 link 即遞增 generation，舊 callback 不得覆寫新 link。room-control 失效只進等待房離場／房主繼任，不得直接把同 PeerId 標成 race forfeit 或結束 spectator-stream；race 與觀戰分別由各自模組裁定（[D-20260802-03](../decisions/D-20260802-03-三平面連線與分割安全定稿.md)）。

## 2. wire 協議（`room-wire.ts`）

star link 上的訊息以 dag-cbor 編碼；**連線歸屬認證**（link 綁 handshake 身分、逐包不簽章），聊天例外 ＝ 訊息自帶 `SignedPayload`（跨中繼可驗、仲裁證據）。房主廣播的 `room-state` 不含 invitation、OPAQUE server state 或 session key，並帶 `spectators` 已 admission PeerId 名冊，供非 host participant source 驗證 failover stream 撥入。

```typescript
type RoomWire =
  | { kind: 'join-request'; role: 'participant'|'spectator'; nicknameSnapshot: string; ratingX1000: number }
  | { kind: 'join-opaque-context'; protocolVersion: 1; role; policyEpoch; serverNonce }
  | { kind: 'join-opaque-start'; protocolVersion: 1; role; policyEpoch; clientNonce; startLoginRequest }
  | { kind: 'join-opaque-response'; protocolVersion: 1; role; policyEpoch; loginResponse }
  | { kind: 'join-opaque-finish'; protocolVersion: 1; role; policyEpoch; finishLoginRequest; clientConfirmation }
  | { kind: 'join-opaque-confirm'; protocolVersion: 1; role; policyEpoch; serverConfirmation; participantSuccession? }
  | { kind: 'join-verdict'; ok: true; state: RoomStateWire }
  | { kind: 'join-verdict'; ok: false; reason: 'join-rejected' | SpectatorJoinRejection }   // host→joiner
  | { kind: 'room-state'; state: RoomStateWire }                                            // host 廣播（任何變化）
  | { kind: 'ready-declaration'; signed: SignedPayload<ReadyDeclarationPayload> }            // participant→host
  | { kind: 'cancel-ready' }                                                                 // participant→host
  | { kind: 'ready-rejected'; reason: ReadyRejectionReason; declarationDigest: string }      // host→該聲明者
  | { kind: 'ready-set-request'; context: ReadySetContext; declarations }                    // host→participants
  | { kind: 'ready-set-ack'; signed: SignedPayload<ReadySetAcknowledgementPayload> }          // participant→host
  | { kind: 'locked-start-package'; lockedStartPackage: LockedStartPackage }                 // host→participants
  | { kind: 'chat'; signed: SignedPayload<ChatMessage> }                                    // 雙向（簽章自證、中繼原文）
  | { kind: 'grid-commit-request'; context: GridLockedContext }
  | { kind: 'grid-commit'; signed: SignedPayload<GridCommitmentPayload> }
  | { kind: 'grid-commitments-locked'; contextDigest; commitments }
  | { kind: 'grid-reveal'; signed: SignedPayload<GridRevealPayload> }
  | { kind: 'grid-ceremony-cancel'; contextDigest; reason; missingPeers }
  | { kind: 'match-start'; matchId; startedAt; state; lockedStartPackage; preStartDisconnects } // state 不含 lockedStartPackage
  | { kind: 'ping'; nonce: number } | { kind: 'pong'; nonce: number }                       // host 量 RTT
  | { kind: 'leave' };                                                                      // member→host（斷線同義）

interface RoomStateWire {
  room: Room;
  members: RoomMemberWire[];                     // members 序＝進房序、host 恆首位
  spectators: PeerId[];                          // 已通過 room-control admission
  spectatorSources: SpectatorSourceAssignment[]; // 與 spectators 一對一的 host 權威配置
  readyState: { phase: 'collecting'|'verifying'|'countdown'; ... };
  lockedStartPackage?: LockedStartPackage;
}
interface RoomMemberWire { peerId; nicknameSnapshot; ratingX1000; pingMs: number|null; transport; membershipEpoch; ready; colliderPieces: number|null }
```

`room.vehicleColliderPieceMax` 必須是 `null` 或 `ROOM_VEHICLE_COLLIDER_PIECE_MAX_OPTIONS` 其中一個值，成員的
`colliderPieces` 必須是 `null` 或非負整數；不符即在 decode 邊界拒收。`colliderPieces` 的填寫時機與用途見
[§4](#4-房主權威host-roomts-hostroom)。

`spectators` 與 `spectatorSources` 是 current wire shape 必填欄位；缺任一欄、兩者數量不一致、
觀戰者重複、來源不在固定 participant roster，皆在 decode 邊界拒收。participant source 只接受
配置中明確指向自己的觀戰連線，不以缺欄代表舊版或退回本機選舉。

`match-start` 的鎖定包只在 wire 頂層出現一次：`state` 不得再帶 `lockedStartPackage`，起跑證明一律取
`lockedStartPackage.gridProof`（wire 不另帶 `gridProof`），且 `matchId`／`startedAt` 必須與鎖定包相同；
多帶欄位、state 內嵌或不一致皆在 decode 邊界拒收。最壞情況（8 人、5 回合、UGC CID 零件、50 觀戰）
編碼約 89 KB，低於 256 KiB room wire 上限。

**OPAQUE role invitation admission**：participant 與 spectator 都使用 CSPRNG 產生的 192-bit invitation，並以 RFC 9807 OPAQUE 登入；`join-request` 不帶 secret。OPAQUE 後的雙向 confirmation 綁 protocol version、RoomId、role、policy epoch、joiner／expected host PeerId、雙方 nonce 與 transcript hash。wire 只接受 OPAQUE 訊息與這個 confirmation 形狀，plaintext secret 或其他形狀一律拒絕（[D-20260806-01](../decisions/D-20260806-01-OPAQUE角色邀請驗證.md)）。

HostRoom 只持 OPAQUE server setup／registration record；participant 成功後以 session key 加密該 server state 交付繼任用途，spectator 絕不取得 succession envelope。通過的 spectator 只進私有 control slot、不加入 `Room.members`；match-start 同時通知兩角色，之後只有 participant 建 race mesh。

## 3. link 埠（`room-link.ts`）

一條 WebRTC 連線 ＋ 單一 `'room'` DataChannel（reliable ordered）的收發埠。**埠形抽象**（`RoomLinkPort`：`peer`／`send`／`onWire`／`onClose`／`ingressStats`／`close`），測試以記憶體對接、runtime 以 WebRTC glue 實作：

- **房主端 `dialRoomLink`**：`performHandshake(initiator)`＋ 先建 room 通道（房主於 presence 現身即撥）。
- **成員端 `acceptRoomLink(expectedRemote)`**：responder 先由 presence 房主或已驗證繼任結果取得 `expectedRemote`；只接收該 PeerId 的 offer/ICE，其他 sender 在進緩衝前丟棄。禁止「首個 sdp-offer 定對端」，避免第三方搶先冒充房主。
- `detectTransport`：`getStats` 選中候選對走 relay＝TURN，讀不到 ＝ 保守回 `'direct'`。
- **raw ingress admission**：每條 link 在 DAG-CBOR decode 前先套用 256 KiB 單包上限，以及一般訊息 64 burst／32 s⁻¹、raw byte 327,680 burst／262,144 B s⁻¹ 的 token bucket；預算跨 callback 持續，不因單次 handler 返回而重置。
- **高成本 wire quota**：OPAQUE、join／state、Ready／簽章、grid、chat 與 match-start 另受 8 burst／4 s⁻¹ 的低頻 bucket 約束；ping／pong、cancel-ready、ready-rejected 與 leave 只消耗一般預算。
- **送出端上限**：room 通道不做應用層分段（分段範圍見 [network-sync.md](network-sync.md) §6.1）。`send` 以編碼後大小比對 `min(pc.sctp.maxMessageSize, DATA_CHANNEL_MESSAGE_SAFE_MAX_BYTES)`（協商值未知時退回 RFC 8841 預設 64 KiB），超限整則不送；通道未開、超限或底層 `send` 例外都不外拋，`send` 回 `false` 告知呼叫端。
- **違規處置與可觀測性**：oversized、非 binary、畸形、一般或高成本 quota overflow 都先丟棄並累計 `ingressStats`；連續 16 次 drop 關閉 room-control link，任何成功 decode 且通過 quota 的分派會清除連續計數。所有 wire 仍須通過既有 closed schema。

## 4. 房主權威（`host-room.ts` `HostRoom`）

房主持 `Room` 真相與逐成員 link slot。

- **join 裁決**：先做 waiting／重複／容量／封鎖與每房間逐 PeerId 的線上嘗試窗；open role 或繼任 seeded 直接收編，受保護角色必須完成單一、順序化 OPAQUE state machine 與雙向 confirmation。認證錯誤對外只回通用 `join-rejected`。
- **半開洪流防護**：已撥、未 admit 的 link 計入 `canAcceptDial` 上限（匿名新 keypair 灌 presence 撐不出無限半開 PC）；`attachLink` 10s 未表態即斷；`close` 收半開 link＋wire handler 首行 `#closed` 守門（收攤後到達的訊息不被 admit 進死房）。
- **room-state 廣播**：每變化（進出 ／ready／ping 更新 ／ 狀態機）即 `#broadcast`。
- **廣播逐 link 隔離**：room-state、ceremony、ping 與 match-start 廣播逐條 link 送出，單一 link 回 `false` 或拋錯都不中斷其他 participant／spectator，也不阻止 match-start 後 host 本地的 `onMatchStart`；失敗的 link 由其自身 close／斷線路徑收斂。
- **spectator policy**：`updateSpectatorPolicy` 只在 waiting 接受完整 public projection（allow／max／required／epoch），每次成功以單一 room-state 廣播；secret 僅在 HostRoom／RoomService 私有 admission 狀態，不進 public Room 或下行 wire。
- **授權通關**：`updateAuthorizedEntry` 只在 waiting 由 host 替換最多 200 個 PeerId 的本機快照；participant／spectator 命中時只略過各自 OPAQUE 密碼證明，封鎖、狀態、重複與容量 reservation 仍先執行。快照不進 public Room 或 wire，完整 reload／host loss／繼任一律清空；收藏來源與 UI 規則見 [player-favorites.md](player-favorites.md)。
- **Ready／chat 中繼**：host 與 member 都以 `ReadyDeclaration` 簽署房間、設定 digest、membership epoch、完整 ClientVersionInfo 與逐回合 `carRotation`；`cancel-ready` 只撤銷本人。`chat` **中繼前逐成員限流**（`canSend` 窗 5/s）＋原文中繼＋房主本地消費。
- **ping 量測**：每 `PING_INTERVAL_MS`（3s）對各成員發 `ping`，`pong` 同 nonce 回 ＝`pingMs` 入診斷。
- **自動開賽**：沒有公開 `startMatch` 操作。全員 Ready 才形成 roster-scoped `ReadySet`；每端重驗簽章、同一 digest、ClientVersionInfo、實際 admitted manifests、結構與 B 軸版本後簽 ack。全 ack 才進 commitment／reveal 起跑證明；成功後建立完整 `LockedStartPackage` 並複製到全員，再以集中參數 `READY_COUNTDOWN_SEC` 倒數。到期自動廣播 `match-start`；任何缺件、替換、驗證逾時或 context 改變均 fail closed。
- **每車碰撞塊上限**：`Room.vehicleColliderPieceMax` 為 `null`（不限）或 `ROOM_VEHICLE_COLLIDER_PIECE_MAX_OPTIONS` 其中一個值，建房時決定，之後沒有修改入口。它不在 `MatchConfig.matchRules` 裡（該物件為空），而是 Ready 設定 `ReadyRoomConfig` 的欄位：`{ version, seriesId, trackManifestDigests, matchRules, roundCount, vehicleColliderPieceMax }`，設定 digest 由這個物件算出，房主與成員各自以手上的房間狀態計算。房間設有上限時，房主接納 Ready 聲明前（在聲明通過配裝檢核之後），以及非房主 participant 驗證 ReadySet 的每一份聲明時，都以本機算出的整車碰撞塊合計逐一檢查 `carRotation` 的每一台車；任何一台超過上限或算不出合計，房主不接納該聲明（原因 `collider-pieces-exceeded`），成員不簽 ack。房主沒有接納其他成員的聲明時，回一則 `ready-rejected` 給該聲明者（見下方「Ready 被房主拒絕」），該成員在 room-state 維持未 Ready。房間不限時不因碰撞塊數拒絕聲明，算不出合計的車也不因此被擋下（[D-20261118-02](../decisions/D-20261118-02-房間的每車碰撞塊上限.md)）。
- **碰撞塊數顯示**：本機檢核 Ready 聲明或 ReadySet 時，算出該成員輪替內每台車的整車碰撞塊合計（逐掛載位加總，同一顆輪胎裝在四個位置算四次，武器彈體不計），取各車最大值；任何一台車算不出來即沒有值。房主接納一位成員的 Ready 聲明時取得這個值，寫入 room-state 該成員的 `colliderPieces` 並廣播；未 Ready 或算不出來的成員該欄為 `null`。非房主的參賽者對已 Ready 的成員，在整份 ReadySet 的所有聲明都通過本機檢核之後才改顯示自己算出的值，在那之前（含任何一份聲明沒有通過本機檢核時）顯示房主回報的值；觀戰者不驗證 ReadySet，只有房主回報的值。本機玩家自己那一列取自所選車輛，還沒算出時才用前述的值。成員撤回 Ready 或離房後清除。全員 Ready 歸零時（賽終，或倒數截止時存活成員不足而取消開賽），房主端清除各成員的碰撞塊數與廢止材質提示、保留場地的廢止材質提示；非房主端在收到回到 collecting 階段的 room-state 時清空整份廢止材質提示（含場地），到下一次 ReadySet 驗證才重新取得。倒數中繼任的房主以沿用的 LockedStartPackage 還原宣告後，對其中每一份宣告的輪替車與各回合場地重新做一次本機檢核，補回場地與各成員的廢止材質提示及碰撞塊數，並再廣播一次 room-state；檢核完成前這些顯示為空；檢核完成時，生效的宣告已不是鎖定包那一份的成員（已撤回、離房，或撤回後重新宣告）不補回，重新宣告者以新宣告通過時寫入的值為準；房間已關閉或 ready 協調狀態已被換掉（倒數截止而取消、賽終）時整份不寫入；檢核失敗不影響已鎖定的開賽。room-state 裡的 `colliderPieces` 只供顯示，不進 Ready digest；每車碰撞塊上限的檢查只用檢查端自己算出的數字，不讀這個欄位（[D-20261118-01](../decisions/D-20261118-01-零件碰撞塊改為作者資料與覆蓋規則.md)、[D-20261118-02](../decisions/D-20261118-02-房間的每車碰撞塊上限.md)）。
- **個人與集合失效分離**：個人聲明不綁完整 roster。加入／移除只作廢 ReadySet ack 與起跑證明，其他玩家維持 Ready；場地、賽制或回合設定改變才清除全員 Ready。host Ready 時不得移除玩家，須先取消本人 Ready。
- **倒數斷線**：participant admission 鎖住；room link close 與 signaling presence 離開必須交叉確認，host 單方面關 link 不足以排除玩家。真正斷線者不補位、不提供本場重連，原起跑格留空；剩餘者至少 2 人且為原鎖定 roster 嚴格多數才續開，否則取消本輪並使剩餘玩家回未 Ready。
- **GO 前取消 `cancelMatchBeforeGo`**：僅接受 `preloading`；依 race-ready 結果批次移除 missing 的非 host participant、保留 host，再一次性回 `waiting`、清 `currentMatchId`、全員 ready 歸零並廣播。此路徑不建立結算／forfeit；剩餘成員重新 Ready、驗證並自動倒數後，會因新 `startedAt` 得到新 `matchId`。
- **賽終 `noteMatchOver`**：回 `waiting`、清 `currentMatchId`、成員 ready 歸零 ＋ 廣播。

## 5. 成員端（`host-room.ts` `MemberRoom`）

單 link 對房主的消費面：`room-state`／`chat`／起跑 commitment-reveal／`match-start` 路由至 handlers＋ 快取 `lastState`；`ping`→ 自動 `pong`；link 斷 ＝`onHostLost`（繼任判定）。收到 `match-start` 時，本地 `lastState` 與交給 handler 的 state 以 wire 頂層鎖定包補回 `lockedStartPackage`，gridProof 取自鎖定包。participant 只對已驗 roster／rules／manifest／series context 簽 commitment，收到完整且逐筆驗簽的 locked commitment set 後才 reveal；spectator 不參與 ceremony，但會驗完整 proof。

## 6. 服務編排（`room-service.ts` `RoomService`）

`AppDataProviders` matchmaking／chat 域的真背靠（[bootstrap real-providers](../程式架構.md)）。持一個 `#active` 房間（host 或 member 角色二擇一）與 `#activeMatch`。

- **重入守門（`#generation`）**：併發 `createRoom`／`joinRoom`／ 繼任 ＝ 後起者 supersede，前者於提交 `#active` 前比對世代不符即自拆半成品（`#teardownActive`）＝ 不覆蓋、不留孤兒資源。
- **`createRoom`**：驗證 `MatchConfig` 與 access policy 的 generated invitation 格式，建立 RoomId 後分角色完成 OPAQUE registration，再把 server state 交給 HostRoom。每車碰撞塊上限是獨立參數，省略時為 `null`（不限）；不是 `null` 也不在 `ROOM_VEHICLE_COLLIDER_PIECE_MAX_OPTIONS` 內的值回 `errors.room.badConfig`。
- **`updateSpectatorPolicy`**：不在房＝`notInRoom`、非 host＝`hostOnly`、非 waiting＝`notWaiting`。省略 invitation 保留既有 OPAQUE state、`null` 移除、generated 192-bit 字串建立新 registration；成功才更新私有狀態與驅逐通道。
- **`updateAuthorizedEntry`**：provider 先驗證輸入是目前收藏的無重複子集；RoomService 再做 `notInRoom`／`hostOnly`，HostRoom 做 `notWaiting` 與界線檢查。此狀態刻意不加入 `ActiveRoomState` succession payload 或 RoomSession resume。
- **容量 reservation**：SpectatorServer 在非同步 `openChannel` 前呼叫共用 `CapacityReservations<PeerId>.tryReserve`；`active + reserved` 達上限立即拒絕。open 成功 commit，失敗／dispose release，當前通道 close deactivate；同 PeerId 重連可滿房替換而不增加占用。`maxPendingOpens` 是另一道 DoS 背壓，不能代替房間容量。
- **`joinRoom`**：`joinPresence`→peers 空 ＝`notFound`→ 以 presence 註冊序第一位為 expected host→`dialer.accept(expectedHost)`→`MemberRoom.requestJoin`。
- **持續 RoomSession／`resumeRoom`**：bootstrap 只在此分頁的 sessionStorage 保存 canonical 192-bit invitation 與 room／role／match hint；離房、身份 lock、角色撤銷或 epoch 變更即清除。分享 URL 只用 fragment，Race Config 讀取後立即 `history.replaceState` 移除；不得進 query、localStorage、IndexedDB、log 或 public Room。
- **`setReady`**：`true` 只消費已確認的本機輪替、簽署不可變聲明；`false` 只撤銷本人。RoomService／provider／RoomPage 都沒有手動開賽 API。`true` 在簽署前先逐車檢核本機輪替的配裝（不論房間有沒有每車碰撞塊上限）：任何一台檢核不通過，即以 `ReadyLoadoutInvalidError` 拒絕，不簽署也不送出，錯誤帶從 1 起算的回合，RoomPage 顯示 `errors.room.loadoutInvalid`。房間設有每車碰撞塊上限時再比塊數：任何一台超過上限或算不出合計，即以 `VehicleColliderPieceLimitError` 拒絕，錯誤帶回合、該車塊數（算不出時為 `null`）與房間上限，RoomPage 據此顯示 `errors.room.colliderPiecesExceeded` 或 `errors.room.colliderPiecesUnknown`。
- **Ready 被房主拒絕**：房主沒有接納一份 Ready 聲明時，把內部原因歸成拒因分類 `ReadyRejectionReason`（`loadout-invalid`、`collider-pieces`、`version-incompatible`、`room-changed`、`other`）。聲明來自其他成員時，房主只對那位聲明者送一則 `ready-rejected`，帶分類與被拒聲明的 digest（`readyDeclarationDigest`）；房間已關閉或該成員的連線已關閉時不會送出；較新的 Ready 訊息已經到達房主時也不送（這份聲明已被取代）。較新的訊息還在路上時，較早那份的拒絕照樣送出。檢核過程丟出例外時當作沒有接納，分類為 `other`。成員端只在 digest 等於手上那份送出去的聲明時處理：撤回本機的準備狀態、清掉該聲明，並在 `RoomServiceView.readyRejection` 帶出拒因，RoomPage 顯示 `errors.room.readyRejected.*` 的對應訊息。手上沒有聲明，或被拒的是較早送出、內容與手上那份不同的聲明時忽略；這樣內容不同的較早聲明被拒不會清掉之後重新送出的聲明。digest 只由聲明內容決定，撤回後原樣再送的兩份聲明 digest 相同、無法區分，這時較早那份的拒絕會被當成手上這份的拒絕。拒因在本機再次準備或撤回準備之後清為 `null`。聲明是房主自己的時候不經 wire，`setReady` 直接以 `ReadyRejectedError` 拒絕，RoomPage 顯示同一組訊息。`room-changed` 涵蓋設定 digest、membership epoch、回合數或房間不符、聲明者不在房主的 Ready 名單，以及房主取不到設定；其中房主取不到設定與雙方對同一設定算出不同 digest 的情況，再按一次準備不一定會成功。簽章、簽署者或格式不符歸為 `other`。配裝檢核（本機的 `errors.room.loadoutInvalid` 與房主的 `loadout-invalid`）沒通過的原因除了配裝不符條件，也包含零件資料讀不到。
- **Ready 訊息的處理順序與自我修正**（issue 001449）：房主對同一位成員的 `ready-declaration` 與 `cancel-ready` 依到達順序逐一處理，後一則等前一則處理完才開始；聲明的檢核是非同步的，不排隊的話較早的聲明可能在撤回或較新的聲明之後才被記入。輪到一份聲明時若房間已關閉、或同一位成員後面已經排了較新的 Ready 訊息，這份聲明直接丟棄、不檢核；檢核期間才排進較新訊息的，在記入協調器之前丟棄。兩種情況都不接納、不回拒絕訊息。驗簽期間才到的訊息不在這個檢查範圍內，那份聲明會先記入，再由後面那則處理。房主自己的 `submitReady`／`cancelReady` 不經這個佇列。成員端送出聲明後、看到房主的結果（房間狀態把本機標為已準備，或收到這份聲明的拒絕訊息）之前，收到「本機未準備」的房間狀態不清掉手上的聲明：房主檢核需要時間，期間的例行廣播與撤回造成的廣播都還不是這份聲明的結果。看到結果之後，未準備的房間狀態才清掉聲明（房主重設 Ready 的情況）。成員端另有兩處自我修正，都是送出 `cancel-ready` 讓兩邊回到未準備，沒有訊息：一、房間狀態把本機標為已準備而本機手上沒有聲明，且房間不在倒數階段；二、收到的 ReadySet 請求裡本機的聲明不是手上那一份（或手上沒有聲明），且本機沒有較新的聲明在等房主的結果。這兩種狀態下本機簽不了 ack，不修正的話整房會停在驗證階段。已知殘餘：等待房主結果的狀態不綁定特定聲明，任何把本機標為已準備的房間狀態都會結束它。較早聲明的已準備狀態若在較新的聲明送出之後才到（例如撤回後立刻再準備，或房主還沒回應時換車再按一次準備），等待會提早結束；之後的未準備狀態或含較早聲明的 ReadySet 請求會清掉較新的聲明，最後由自我修正收斂為未準備而沒有訊息，玩家要再按一次準備。另有兩種情況不會自行收斂：成員較新的聲明沒有送達房主（在房主入口被限流丟棄）而房主已接納較早那份時，含較早聲明的 ReadySet 請求會因為本機還在等結果而被略過，整房停在驗證階段，要該成員撤回再按一次準備，或等房主因其他成員的變動重新發出請求；房主對某位成員的配裝檢核一直沒有返回時，該成員之後的 Ready 訊息都排在後面不會被處理。
- **`activeMatch`**：race-page 進場讀點另含 `LockedStartPackage` 與 `preStartDisconnects`；RaceSession 只用鎖定包中的輪替，不重讀可變車庫。**成員端 match-start 校驗**（host 不可信）：完整驗 package、proof、matchId、canonical roster、round count、rules 與先前觀察值，不符即忽略。
- **`cancelMatchBeforeGo`**：race-ready 在 GO 前取消時先清 rotation stash／本機 `#activeMatch`；host 角色再執行上述權威取消。RacePage 先保存 canonical `RoomId`，再取消並導回 `/room/:roomId`，避免 destroy 鉤誤走一般賽終語意。
- **`noteMatchOver`**：race session 收攤鉤——清 `activeMatch`＋ 暫存、host 回 waiting 廣播。
- **`cancelQuickMatch`／`dispose`**：停待決 Quick Match discovery 輪詢；`dispose` 另收 dialer 持久 signaling WS。
- **loadout 暫存**：等待房暫存只供建立本人的 ReadyDeclaration；match handoff 後 RaceSession 以 `LockedStartPackage` 為唯一輪替讀點。preloading 的 matchId-bound loadout 簽章仍保留為 ledger 參與證明與第二道驗證。
- **逐回合規則**：Room UI 逐回合顯示 `disallowChip`，但所有 formal 車位仍可排入
  `carRotation`；晶片車遇禁用回合只顯示警告。每回合未提供時為 `false`。
- **聊天 `ChatHub`**：`acceptChatMessage` 四關（驗章 ／sender===signer／roomId／ 限流 ＋ 封鎖）後入列 ＋ 證據史；`exportEvidenceFor(messageIds)` 只取玩家選取的保留原件，逐筆輸出 canonical DAG-CBOR + multibase base64url 字串，最多 16 筆。

### 6.1 房主繼任（`#onHostLost`）

房主 link 斷時，`waiting` 由名單序次位升任 host、其餘成員 seeded 自動重掛。每位已驗 participant 都從原 host 收到以該次 OPAQUE session key 加密的 participant server state；當選者用它與固定 epoch 重開 HostRoom，從未取得 plaintext invitation。spectator server state 不進 succession；若舊政策受保護，新 host 必須關閉觀戰並提升 spectator epoch，不能降級成公開觀戰。

繼任的 HostRoom 沿用原房間狀態的 `vehicleColliderPieceMax`。不在倒數中的繼任，重新掛上新房主的成員若原本已 Ready，會以新的 membership epoch 經 `setReady` 重簽同一份選擇；重簽被拒絕時該成員維持未 Ready，由玩家自行再按準備。

授權通關名單同樣不進 succession；新 HostRoom 預設空集合。這是權威生命週期邊界，不以 sessionStorage 模擬 host reload recovery；完整 reload 依既有 host loss／繼任處理。

倒數屬 waiting 的鎖定子狀態。決定性下一位 host 只有在完整 `LockedStartPackage` 可重驗、digest 相同且排除舊 host 後仍滿足嚴格多數時才以原 deadline 恢復倒數；舊 host 列入 `preStartDisconnects`。其他原 roster participant 可免密重新掛 room-control，但不重簽 Ready；新加入者仍拒絕。條件不成立即不沿用倒數。

## 7. Quick Match（既有公開房 discovery）

`RoomService.quickMatch()` 從 `RoomDialerPort.quickMatchRooms()` 取得已驗證的 rooms discovery snapshot，依 [matchmaking.md §3](matchmaking.md) 選出既有公開候選，再走一般 `joinRoom(roomId, { role: 'participant' })`。它不建立房間、不產生 `match-request`／`match-offer`，也沒有預設建房 fallback。加入者沿用該房的每車碰撞塊上限；房間公告不帶上限，候選選擇不依上限篩選，車輛超過上限的玩家照常加入，在 `setReady` 被拒絕。

房主公告只是預篩。HostRoom 收到 participant `join-request` 時先原子保留席次，再進 OPAQUE；成功 commit，錯誤、逾時或 link close release。公告過期或最後一席競爭失敗時，Quick Match 回到 discovery 輪詢。

rooms discovery 未接或中途失效回 `errors.p2p.offline`；持續無合格房則到 deadline 回 `errors.matchmaking.timeout`。兩者都不得留下房間、presence 或 reservation（[D-20260802-08](../decisions/D-20260802-08-Quick-Match加入既有公開房.md)）。

## 8. 跨模組對接

| 模組 | 對接 |
|---|---|
| `matchmaking/`（[matchmaking.md](matchmaking.md)）| `Room`／`MatchConfig`／`validateMatchConfig`／`deriveMatchId`／Quick Match 候選選擇／容量 reservation |
| `signaling-service/`（[signaling-service.md](signaling-service.md)）| `performHandshake`／canonical room scope mux／SDP 中繼 |
| `network-sync/`（[network-sync.md](network-sync.md)）| 賽內 mesh 於開賽後另建（等待房 link 與其獨立）|
| `peer-discovery/`（[peer-discovery.md](peer-discovery.md)）| Quick Match 房間公告／presence 租約、scoped Gossip signaling |
| `chat-system/`（[chat-system.md](chat-system.md)）| `acceptChatMessage`／`ChatHistory`／`ChatRateLimiter`／封鎖清單 |
| `pwa-offline/`（[pwa-offline.md](pwa-offline.md)）| `activeMatch` 非空＝賽用資產 pin `race-lock`；`noteMatchOver`＝解除＋延遲 GC |
| `bootstrap/` | `room-deps.ts` 真件組裝（dialer／presence／rooms discovery snapshot）；`app-shell` race-lock 接線 |

## 9. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 房主單點（等待房）| 僅 waiting 繼任、seededMembers 免密碼補收；`racing`／`settling` 房主無作用 |
| 無主 link 佔資源 | `attachLink` 10s join-request deadline，未表態＝斷 |
| 中繼聊天偽冒 | 聊天自帶 `SignedPayload`、收端 sender===signer＋限流＋封鎖過濾 |
| quickMatch 開放信任集洪水 | 簽章／時戳／nonce／per-signer 限流；封鎖清單＋版本閘下游過濾 |
