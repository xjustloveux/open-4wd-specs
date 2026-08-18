---
type: impl
domain: ["版本部署"]
summary: WebRTC 握手中介／訊息協議／adapters／rate limit／TURN
authority: null
slug: null
---
# signaling-service（WebRTC 握手中介實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/signaling-service.md](程式流程/signaling-service.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：玩家可自架的 WebRTC signaling 服務**實作層** —— Signaling v1、
> 協定核心、Node／Cloudflare Worker adapters、安全規則、rate limit 與 TURN 整合。
> 連線後即直接 P2P；client 依建房／加入角色使用 WSS 候選與 Gossip rendezvous。對應
> `src/signaling-service/`（client）＋ `open-4wd-signaling`（server）。

## 1. 角色定位

signaling 只負責 **WebRTC 握手中介**（交換 SDP / ICE candidate）；連線建立後雙方直接 P2P。
每個 client session 必須綁 canonical scope：`room:<小寫 UUID v4 RoomId>` 或
`match:<64 位小寫十六進位 matchId>`。Gossip scope 與 WSS rendezvous 必須同時開始：建房端只在
依玩家順序第一個可註冊的 WSS 維持 room scope，並發布已簽章 Gossip room announcement；加入端則
逐一嘗試 WSS candidates，關閉只含本機自己的空 room roster，直到取得至少一個非本機 peer，
同時有界等待該 RoomId 的已驗簽 Gossip announcement。`isHealthy`、`openSession` 與本機
`socket.send` 成功都不等於找到房間或目標。

房間公告的 `signalingEndpoint` 只是 joiner 可嘗試的 WSS 候選，`gossipSignaling` 則是 scoped
Gossip signaling 能力開關；兩者都須由已驗簽的 `RoomAnnouncement` 取得，且不等同握手成功。

冷啟動傳送只可選「最後已驗入站 transport」，或精確 WSS roster 確實包含目標的 WSS；兩者皆無時
走已開啟的 Gossip。第一個有效入站路徑對該 peer sticky，跨 transport 以 signed nonce 去重。
**配對不經 signaling**，仍由 GossipSub matchmaking 負責。

## 2. 訊息協議

```typescript
interface SignedSignalWire {
  type: 'signal-v1';
  scope: `room:${string}` | `match:${string}`;
  target: PeerId;
  message: SignalMessage;
  timestamp: number;
  nonceHex: string;       // 16 bytes lowercase hex
  signer: PeerId;
  signatureHex: string;   // Ed25519 64 bytes lowercase hex
}
```

| type | 流向 | 內容 |
|---|---|---|
| `register` | client→server（連上第一則）| `{ peerId, proof }`，登記後回 `room-state`（現有成員）並廣播 `peer-joined`。**register 簽章**：`proof = { timestamp, nonce, signatureHex }`＝身分私鑰對 `signingDigest({type:'signaling-register', peerId, room, timestamp, nonce})` 的簽章（實作即權威 `src/signaling-service/register-auth.ts`）；server 驗簽章＋時戳窗（±30s）＋`(peerId, nonce)` 短窗去重、無效即拒（`verifyRegisterProof` 由 main client 與 signaling provider 的 vendored protocol core 共用）。簽章綁 room，跨房重放無效 |
| `signal-v1` | signer→target | 端對端簽章 envelope；server 驗 canonical scope、target、時戳、nonce replay 與簽章後才 1:1 轉發，不保存 SDP／ICE |
| `join-request` / `join-as-spectator` | — | 正式許可與密碼裁決走房主 P2P DataChannel；signaling provider contract 只涵蓋連線發現與轉送 |
| `room-state` / `peer-joined` / `peer-left` / `error` | server→client | 房間成員快照 / 進出廣播 / 錯誤（如 `target-not-found`）。**`peers` 含本機並保留註冊順序、首項即房主**＝room-control 安全相依——client 對外 presence 與「找到房間」判定須排除本機；joiner 再據過濾後首個 peer 決定房主身分與撥號驗證（`acceptRoomLink` 只接受該 peer 的 offer 防冒充），伺服器必須保序。觀戰來源不由 signaling 指定；已驗 RoomSession 以固定 participant roster 與此在線快照本地選出 `{ peerId, sourceEpoch }`（[spectator.md §2](spectator.md)）|
| `leave` / close | — | 移除 peer、廣播 `peer-left`；`leave` 處理完**以 close code `left` 關閉該連線**（缺此步＝liveness 與 register 期限都掃不到的殭屍連線）|

## 3. 實作架構（`open-4wd-signaling` repo）

**平台無關協定核心 ＋ 薄傳輸適配器**：

- **`core/`**＝ 零 I/O 純函式：`room.ts` 純 reducer `step(state, input, now) → { state, effects }`（時鐘注入、不讀 `Date.now()`＝ 可決定性測試；per-room 單一狀態機）；`core/protocol/`＝**vendored 自主專案**的 wire / wire-parser / register-auth（逐字搬入 ＋MANIFEST hash＋CI 漂移檢查）——協定驗證與 client **位元組一致**，簽章 digest 不得獨立重寫。
- **`adapters/node/`**＝Node／`ws` 自架 adapter，行程內維持 ephemeral room state。
- **`adapters/worker/`**＝Cloudflare Worker adapter：每個 scope 一個 hibernatable
  Durable Object；成員順序、register/signal nonce 與限流存 SQLite。持久化失敗時
  必須在任何轉發 effect 前 fail-closed。
- **端點**：`GET /ws?room=<canonical-scope>`＋ 選配 `POST /turn-token`；無全域 lobby。

**伺服器義務**（契約由 client 程式碼鎖死、伺服器必須守住）：

1. **`MAX_PEERS = 64` 伺服器強制**——client parser 對超過 64 項的成員快照整則靜默丟棄，放行第 65 人 ＝`room-state` 被全房丟棄 ＝ 全房同時失聯；register 階段擋下並回 `error: room-full`。觀戰者 register 亦短暫佔名額，上限把失敗正確侷限在該觀戰者身上。
2. **liveness 由 adapter 的 WebSocket 存活面負責，不以 application message 靜默判斷**——client
   無應用層心跳，且握手後連線會長時間合法閒置，「N 秒無訊息即回收」會誤殺等待房成員。
   Node adapter 使用 WS 協定層 ping/pong，ping 間隔派生＝`PEER_TIMEOUT_MS` / 3（容許連丟兩次
   pong），逾時回收並廣播 `peer-left`。Cloudflare hibernation API 沒有 server 主動 ping 原語；Worker
   adapter 以 `getWebSockets()` 仍存在的 socket 加上 `webSocketClose`／`webSocketError` lifecycle
   判定存活，並由 edge runtime 回報半開／斷線。Worker 不得以最後一則應用訊息時間回收仍由 runtime
   持有的已註冊 socket；未註冊 socket 仍受 register deadline 限制。
3. **`peers` 內 peerId 唯一**——同一連線重送 `register`＝ 協定違規、關閉；同一 peerId 經**新連線**出示合法 proof＝ **自我取代**（舊連線以 close code `superseded` 關閉、原位換鍵**保序**——房主仍是房主、不對其餘成員廣播、房滿仍可取代）——髒斷線後快速重進房不必等逾時窗。
4. **`peers` 保留註冊順序**（[§2](#2-訊息協議) room-state 列）＝ 安全相依，回傳無序陣列會使入房全面失敗且防冒充失效。

**三條安全規則**（register 驗簽的必要延伸——只驗 register 不管後續訊息 ＝ 簽章白做）：

1. 未 register 的連線不得送出任何非 `register` 訊息（違者丟棄並關閉——否則開一條 socket 即可中繼 SDP／ 污染房間）。
2. `wire.sender` 必須等於該連線 register 時綁定的 PeerId（違者丟棄——否則已註冊 peer 可冒用他人身分中繼）。
3. 連線須在 register 期限（`REGISTER_DEADLINE_MS`）內完成 register，否則關閉（未 register 連線不佔 64 名額，放任堆積 ＝ 繞過上限的資源耗盡面）。

畸形 ／ 未知 type 訊息一律靜默丟棄、不斷線（與 client 行為對稱）。

Cloudflare adapter 已有 local workerd E2E、generated types 與 Wrangler dry-run；公版不含
account、route、網域或 secret，也不執行正式部署。

### 3.1 client session 關閉與重連

`SignalingSession` 必須發布 `isOpen()` 與 unexpected `onClose()`；WebSocket `close`／`error`
會使 active mux 原子失效且只通知一次，呼叫者明示 `close()` 則不得觸發重連。Room dialer 先把
active session 設為 `null`，重跑同一份已設定的 provider chain，再把新 session 綁回原本的
`RoomPresencePort`、peer lifecycle 訂閱與所有 participant／spectator 撥號入口。重連期間
`dial`／`accept`／spectator 對應操作一律回 offline，不可把訊息送進已關閉 transport；同一時間
最多一個 reconnect in flight。若第一次重連失敗，頁面回到前景且 session 仍為 null／closed 時
可再次有界嘗試。room port 關閉、離房或 dispose 都屬明示關閉，必須取消訂閱、釋放舊 transport，
並禁止延遲完成的重連重新掛回。

## 4. 部署形狀與其他平台

公版同時提供 Cloudflare Workers＋SQLite-backed Durable Objects 與 Node docker adapter；
兩者協定地位相同，營運者依自己的平台與可用性政策選擇。

| 平台 | 狀態 | 原因 |
|---|---|---|
| **Cloudflare Workers** | ✅ 已實作 | Durable Objects 提供 per-scope 單一實例與 hibernation；SQLite 保存必要短期狀態 |
| **Vercel** | **受阻** | Serverless 不支援長連線 WS、需改 SSE / polling——client 只講 WebSocket、零 SSE 消費端；需主 repo 先補 client SSE provider |
| **Deno Deploy** | **存疑** | 無「依 key 路由到單一實例」原語，多 isolate 下同房 peer 可能落在不同實例＝廣播斷裂；需實測驗證 |

## 5. Rate Limit

- **連線級**：每 IP 每分鐘 60 次（`RATE_LIMIT_PER_MIN` 預設），逾額回 429（client 不解讀 429、非 ok 一律視為拒收）。client IP＝socket remote address；`TRUST_PROXY` **預設關閉**——無條件採信轉發標頭 ＝ 任何人可偽造繞過限流，僅在代理確定會覆寫標頭時開啟。
- **訊息級**：已註冊連線每分鐘 `MESSAGE_RATE_LIMIT_PER_MIN = 1,200` 則（轉發 1:1 無放大、此限只擋線速灌流；64 人房開賽 full-mesh 握手突發約 750 則故取寬裕值），逾額**靜默丟棄不斷線**。
- **傳輸層**：ws `maxPayload` 256 KiB（＝ 協定單訊息上限同值；超限由 ws 以 1009 關閉，早於任何緩衝放大）。
- **儲存**：Node 使用有界行程內計數；Worker 的 per-connection 訊息固定窗保存在 hibernation
  attachment，跨 isolate 喚醒仍延續。opaque IP／Peer admission／TURN bucket、replay nonce 與房間
  membership 則由 SQLite-backed Durable Objects 保存。Worker 公開入口只信 Cloudflare 提供的
  `CF-Connecting-IP`，不信 `X-Forwarded-For` 或 client 自填 admission header。

## 6. TURN 整合（玩家設定頁）

行動網路嚴格 NAT 時，client 只從玩家手動設定、已選 signaling provider 配對端點，或已接受的
session invite 組出 `RTCConfiguration`：

```typescript
const peerConnectionConfig: RTCConfiguration = {
  iceServers: selectedNetworkServices.iceServers,
};
```

`selectedNetworkServices` 是每次啟動／重連 generation 的不可變 snapshot；不得混入 registry 中
未選節點，也不得在失敗時改連固定或全域後備服務。TURN token TTL
（`TURN_TOKEN_TTL_SEC: 300`）由明示配對的 signaling 發放、coturn 以 **shared secret**
（REST API auth）驗證——同一營運者配對部署的變數須同值。簽發端點規格見
[§6.1](#61-turn-token-憑證端點簽發面)。

### 6.1 `/turn-token` 憑證端點（簽發面）

TURN 短期憑證由 signaling 的 REST 端點簽發（`open-4wd-signaling` 的 Node／Worker
adapters 共用同一驗證與回應契約；repo 層規格見
[../部署資訊/open-4wd-signaling.md](../部署資訊/open-4wd-signaling.md)）：

- **請求**：`POST /turn-token`，body JSON `{ peerId, proof: { nonce, timestamp, signatureHex } }`（body 上限 4 KiB）。
- **驗身 ＝ 重用 register 簽章證明**（[§2](#2-訊息協議)）：`proof` 與 register proof 同形同驗（身分私鑰 Ed25519 簽章 ＋ 時戳容忍窗 ＋nonce 去重），以 **purpose 哨兵 `'/turn-token'` 佔 room 位**做域分隔——沒有身分私鑰造不出合法 proof，端點不會淪為任何人可領中繼頻寬的憑證發放器。
- **回應** 200：`{ urls, username, credential, ttlSec: 300 }`——`username`＝`"<到期 unix 秒>:<peerId>"`、`credential`＝`base64(HMAC-SHA1(secret, username))`（coturn `use-auth-secret` REST auth 本地驗證、無需回源）；`urls`＝ 部署組態 `TURN_URLS` 原樣下發。
- **錯誤面**：端點未組態（`TURN_SHARED_SECRET`／`TURN_URLS` 任一缺席、含空值）＝ 該路徑同其他路徑回 **404**（不掛端點、signaling 其餘功能不受影響）；body 超上限 **413**；JSON 解析失敗 ／ 形不符 **400**；驗身失敗或 timestamp 超容忍窗 **403** `{ error: 'invalid-proof' }`；nonce 重放 **409** `{ error: 'nonce-replayed' }`；per-IP 限流逾額 **429**。
- **防護**：nonce 去重表與 `/turn-token` 限流窗獨立於 WS 路徑（互不干擾）；週期 tick 清掃——nonce 表剪枝窗 ＝timestamp 容忍窗（逾窗的 nonce 本就過不了驗證，剪枝不開重放縫）。
- **哨兵房保留**：WS 註冊房名**等於 `'/turn-token'` 或以 `'/'` 開頭一律拒絕**——`'/'` 前綴命名空間整段保留給內部 purpose；房名取自 `?room=` query、值可含 `/`，不相撞非結構保證、靠此 guard 強制。
- **部署組態**：`TURN_SHARED_SECRET`（與 `open-4wd-turn` 部署同值）＋`TURN_URLS`（逗號分隔、逐項 trim、僅接受 `turn:`／`turns:` 前綴項）；TTL＝ `network.md` 的 `TURN_TOKEN_TTL_SEC: 300`。
- **client 呼叫面**：已接線。client 從 `wss:` endpoint 推導同 origin
  `https://<host>/turn-token`，以身分私鑰造 proof；404 視為未提供。200 回應先依
  `Content-Length` 與串流逐 chunk 累計強制 `TURN_TOKEN_RESPONSE_MAX_BYTES: 32 × 1024`
  byte 上限，超限立即 cancel；有界完整 body 才以 strict UTF-8 解碼、JSON parse，並驗證 URL／
  欄位長度／TTL 上限。credential 僅留 session 記憶體，不寫 settings、IndexedDB 或 log；
  無 token 時只保留同一 snapshot 中的玩家手動／session ICE，不查詢其他 provider。

## 7. 跨模組對接

| 模組 | 對接 |
|---|---|
| [matchmaking.md](matchmaking.md) | 配對演算法與 payload schema 權威；配對訊息不經 signaling（主路徑＝GossipSub）|
| [peer-discovery.md](peer-discovery.md) | GossipSub room announcement、presence 與 scoped signaling rendezvous；連線後直接 P2P |
| [network-sync.md](network-sync.md) | 握手完成後的 DataChannel 即時同步 |
| [network.md §9](../程式參數/network.md#9-networksignaling連線握手) | 伺服器常數單一權威（`PEER_TIMEOUT_MS` / `MESSAGE_RATE_LIMIT_PER_MIN` / maxPayload / `TURN_TOKEN_TTL_SEC` 等）|
| [部署資訊.md §4](../部署資訊.md) | client fallback 順序 / TURN / 部署模板 |
