---
type: impl
domain: ["比賽房間", "版本部署"]
summary: libp2p 組態／GossipSub／DHT／Peer Scoring／bootstrap
authority: null
slug: null
---
# peer-discovery（節點發現實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/peer-discovery.md](程式流程/peer-discovery.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：P2P 節點發現的**實作層** —— libp2p 節點組態、GossipSub topic / 簽章訊息、DHT provider / peer 查找、Peer Scoring、房間發現、NAT 穿透（Circuit Relay v2）、bootstrap 清單、topic rate limit。
> bootstrap 故障域建議（`LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED`）與撥號逾時（`BOOTSTRAP_DIAL_TIMEOUT_MS`）的部署面見 [部署資訊.md §5](../部署資訊.md)；空 bootstrap 清單是合法本地／既有 session 模式，不另設最小節點常數。簽章 / 驗簽見 [key-manager.md](key-manager.md) · [security.md](security.md)；配對演算法見 [matchmaking.md](matchmaking.md)。對應 `src/peer-discovery/`。

## 1. libp2p 節點組態

```typescript
async function createNode(opts: {
  privateKey: Libp2pPrivateKey;
  bootstrapList: string[];
}) {
  return createLibp2p({
    privateKey: opts.privateKey,
    // 不掛裸 /p2p-circuit；明示 relay 的 reservation 見 §7。
    addresses: { listen: ["/webrtc"] },
    transports: [
      webRTC(),
      webRTCDirect(),
      webSockets(),
      circuitRelayTransport(),
    ],
    streamMuxers: [yamux()],
    connectionEncrypters: [noise()], // libp2p 3.x 選項名（複數）
    services: {
      identify: identify(),
      ping: ping(), // kad-dht 硬性要求的兄弟服務（peer 存活探測）
      dht: kadDHT({
        protocol: "/open4wd/kad/1.0.0",
        clientMode: false,
        querySelfInterval: 600_000,
      }),
      pubsub: gossipsub({
        // 來源＝@libp2p/gossipsub；介面以目前 js-libp2p package 為準
        emitSelf: false,
        allowPublishToZeroTopicPeers: false, // gossipsub 11+ 選項名
        D: 6,
        heartbeatInterval: 1000,
        scoreThresholds: {
          gossipThreshold: -10,
          publishThreshold: -50,
          graylistThreshold: -80,
        },
        scoreParams: createPeerScoreParams({
          // 以官方建構器補齊未列欄位預設（直接給部分欄位會缺欄）
          topics: {
            "/open4wd/<chainId>/rooms/v1": createTopicScoreParams({
              topicWeight: 0.5,
              timeInMeshWeight: 1,
              timeInMeshQuantum: 1000,
              timeInMeshCap: 3600,
              firstMessageDeliveriesWeight: 1,
              firstMessageDeliveriesDecay: 0.5,
              firstMessageDeliveriesCap: 100,
            }),
          },
          appSpecificWeight: 1,
          appSpecificScore, // §5 AppPeerScore 綁定
          IPColocationFactorWeight: -5, // 同 IP 過度集中必須是負分（實際欄位名 IP 大寫）
          behaviourPenaltyWeight: -10,
          behaviourPenaltyDecay: 0.5,
        }),
      }),
    },
    peerDiscovery: [bootstrap({ list: opts.bootstrapList })],
  });
}
```

`appSpecificWeight` 接 [§5](#5-peer-scoring信譽--黑名單加權) 的信譽 / 黑名單加權。

## 2. Topics 與訊息結構

```typescript
enum Topic {
  Rooms = "/open4wd/<chainId>/rooms/v1",
}
// 房內文字聊天走 DataChannel；賽中溝通只走 participant 原簽章圖示訊息。
// UGC 目錄由 ledger DerivedState 推導，不建立 GossipSub topic。
```

所有 topic 訊息皆為 `SignedPayload<T>`（結構見 [key-manager.md §SignedPayload](key-manager.md)：`{ payload, timestamp, nonce, signer, signature }`）。`payload` 內含 `type` 判別字：

```typescript
type RoomAnnouncement = SignedPayload<{
  type: "room-announce";
  roomId: RoomId; // canonical lowercase UUID v4（見 matchmaking.md generateRoomId）
  hostPeerId: PeerId;
  signalingEndpoint: string | null;
  gossipSignaling: boolean;
  trackId: string;
  playerCount: number;
  maxPlayers: number;
  visibility: 'public' | 'private';
  quickMatchEnabled: boolean;
  participantPasswordRequired: boolean;
  state: 'waiting' | 'preloading' | 'racing' | 'settling' | 'closed';
  clientVersion: string;
  ratingAnchorX1000: number;
  startsAt: number;
  ttl: number; // 牆鐘毫秒；ephemeral 發現層，非帳本
}>;
type RoomCloseEvent = SignedPayload<{
  type: "room-close";
  roomId: RoomId;
  reason: "match-over" | "host-left" | "expired";
}>;
// signaling 使用 /open4wd/<chainId>/signaling/v1/<canonical-scope> 獨立動態 topic，
// payload = { type:'signal-v1', scope, target, message }；topic 與 payload scope 必須相同
```

`signalingEndpoint` 是房主目前可用的 WSS signaling 端點候選；沒有可公告端點時為 `null`。
`gossipSignaling` 是 scoped Gossip signaling 的能力開關，不是端點位址，也不代表 WSS 已找到目標。

> 發現層僅是 GossipSub 傳輸載體；Quick Match 候選判定與動態窗口見 [matchmaking.md](matchmaking.md)。房間發現訊息的 `startsAt` / `ttl` 都是 ephemeral 牆鐘時間，**不入帳本、不參與 derive**（故可用 `Date.now()`，不受 `consensusNow` 規範約束，見 [ledger.md](ledger.md)）。

接收與發送只允許 rooms，以及由合法 canonical scope 派生的 signaling topic。
每個已解碼 payload 都先過通用成本界限（深度 `8`、
entries `512`、單一字串 UTF-8 `32,768 bytes`），再過 topic-specific schema；
signaling topic suffix 與 payload scope 不一致一律拒絕。RoomId、PeerId、signaling endpoint、
資源 ID、player count、版本資訊 bounded record（已知欄位另驗型別 ／ 長度）以及
SDP／ICE 欄位均有型別與長度界限。版本相容性的必填欄位與值域仍由 matchmaking／
versioning 權威層判定；未知 topic 或結構 schema 不符一律 fail-closed。

## 3. DHT 操作

```typescript
class TrackProviderHelper {
  // 宣告本節點 pin 了 trackId 的內容
  async announceProvide(trackId: string): Promise<void> {
    await libp2p.contentRouting.provide(CID.parse(trackId));
  }
  // 找誰有 trackId（10s timeout）
  async findProviders(
    trackId: string,
    opts: { limit: number },
  ): Promise<PeerInfo[]> {
    const providers: PeerInfo[] = [];
    for await (const p of libp2p.contentRouting.findProviders(
      CID.parse(trackId),
      { signal: AbortSignal.timeout(10_000) },
    )) {
      providers.push(p);
      if (providers.length >= opts.limit) break;
    }
    return providers;
  }
}

async function findPeer(peerId: PeerId): Promise<Multiaddr[]> {
  const info = await libp2p.peerRouting.findPeer(peerId, {
    signal: AbortSignal.timeout(10_000),
  });
  return info.multiaddrs;
}
```

## 4. GossipSub 訂閱 / 發送

```typescript
class TopicSubscriber {
  constructor(
    private libp2p: Libp2p,
    private keyManager: KeyManager,
    private knownPeers: Set<PeerId>,
  ) {}

  async subscribe<T>(
    topic: Topic,
    handler: (msg: SignedPayload<T>) => void,
  ): Promise<void> {
    assertAllowedTopic(topic); // 固定 topic 只允許 rooms
    this.libp2p.services.pubsub.subscribe(topic);
    this.libp2p.services.pubsub.addEventListener("message", async (e) => {
      if (e.detail.topic !== topic) return;
      if (e.detail.data.byteLength > 65_536) return; // dag-cbor decode 前
      try {
        const signed: SignedPayload<T> = dagCbor.decode(e.detail.data); // wire＝dag-cbor（SignedPayload 含 Uint8Array 欄位、JSON 無法無損往返；沿用專案 canonical 序列化）
        const source = normalizeSource(e.detail.from);
        if (source === null || source !== signed.signer) return; // transport source 綁 envelope
        if (!isValidTopicPayload(topic, signed.payload, signed.signer)) return;
        const verified = verifyP2PMessageAuthenticity(signed, this.knownPeers);
        if (!verified.ok) return; // signer / timestamp / nonce shape / signature
        if (nonceRegistry.has(source, signed.nonce)) return;
        if (!rateLimiter.shouldAccept(source, topic)) return; // 同 source 跨 topic 聚合
        if (!nonceRegistry.commit(source, signed.nonce, signed.timestamp))
          return;
        handler(signed);
      } catch {
        /* drop malformed */
      }
    });
  }

  async publish<T>(topic: Topic, payload: T): Promise<void> {
    assertAllowedTopic(topic);
    if (!isValidTopicPayload(topic, payload))
      throw new RangeError("invalid gossip payload");
    const signed = await signPayload(payload); // key-manager.md §9（free function，內部用 keyManager.sign）
    const encoded = dagCbor.encode(signed);
    if (encoded.byteLength > 65_536)
      throw new RangeError("gossip message exceeds byte limit");
    await this.libp2p.services.pubsub.publish(topic, encoded);
  }
}
```

## 5. Peer Scoring（信譽 / 黑名單加權）

`appSpecificScore` 接進 gossipsub scoreParams，把 derive 出的信譽 / 黑名單狀態餵給 mesh 評分：

```typescript
class AppPeerScore implements PeerScoreOverride {
  constructor(
    private reputation: ReputationStore,
    private moderation: ModerationStore,
  ) {}

  appSpecificScore(peerId: PeerId): number {
    if (this.moderation.isBlacklisted(peerId)) return -1000; // moderation.md：黑名單
    const score = getEffectiveScore(peerId, this.reputation, Date.now()); // 讀點契約（reputation.md §4：唯一讀分入口、新手下限作用於分數本身）；0–1000、init 500
    if (score >= 800) return 50; // 高信譽加分
    if (score < 300) return -50; // 低信譽扣分
    return 0;
  }
}
```

> 門檻 `>= 800 / < 300`（信譽 0–1000、init 500、`reputationToStars = floor(score/200)`，≈ 4★ / <1.5★）。`ReputationStore` / `ModerationStore` 為 DerivedState 的唯讀視圖（來源見 [reputation.md](reputation.md) / [ledger.md](ledger.md)）。

## 6. 房間發現 API

```typescript
interface RoomDiscovery {
  announceRoom(a: Omit<RoomAnnouncement["payload"], "type">): Promise<void>;
  closeRoom(
    roomId: RoomId,
    reason: RoomCloseEvent["payload"]["reason"],
  ): Promise<void>;
  subscribeRooms(handler: (rooms: RoomAnnouncement[]) => void): Subscription;
  listActiveRooms(): RoomAnnouncement[]; // 去重後即時清單
}
```

`RoomDiscoveryImpl` 以 `Map<RoomId, RoomAnnouncement>` 維護房間表：`room-announce` 寫入、
`room-close` 刪除；每 30s 掃 `ttl` 過期清理，房主與 joiner 以絕對
`nextRefreshAt` 每 30s 重新公告。lease TTL 為 120s：涵蓋背景分頁進入一分鐘級 timer
throttling 後的一次漏拍與網路延遲，但仍遠低於 300s 接收上限，避免 crash 後長期殘留。
頁面回到 visible 時不等下一個 timer，立即補一張最新 snapshot；延遲 callback 只補一次、不追趕
burst。明示 close 仍立即發布 `room-close`／`room-presence-left` 並解除 visibility 訂閱。

房主每次重新公告都從當前 Room snapshot 投影 player count、state 與 participant displayRating 中位數；不得重播建房時的靜態值。`visibility`／`quickMatchEnabled` 為明確政策，`participantPasswordRequired` 只代表 admission 保護狀態。Quick Match 只能把廣告當預篩，真正容量與政策由 host admission 原子重驗（[D-20260802-08](../decisions/D-20260802-08-Quick-Match加入既有公開房.md)）。

## 7. NAT 穿透：Circuit Relay v2

libp2p 先使用 direct／STUN；當 `connection:close` 顯示目前連線全失，或冷啟動經過
`BOOTSTRAP_DIAL_TIMEOUT_MS = 15_000` 後仍為零連線時，client 才逐一使用
玩家當次 snapshot 明示選取的 `relay` 候選建立 `<relay multiaddr>/p2p-circuit` reservation。
adapter 的 `reserveRelay()` Promise 完成才代表 v2 reservation 成立；第一次由
`transportManager.listen(...)` 建立 circuit listener，後續以同一 `Listener.listen(...)`
重用；單純 dial 成功不能算 reservation 成功。多個 recovery 共用單一航班；每個 libp2p
generation 也只建立一個 circuit listener，第一個 relay 失敗後以同一 listener 嘗試
下一個，避免失敗 listener 累積。冷啟動只排一個 15 秒觀察 timer，不會在啟動時預撥
所有 relay：

```typescript
const recoverRelay = makeRelayRecoveryOnDirectLoss({
  node: makeExplicitRelayReservationNode(node),
  relayAddrs: selectedNetworkServices.relay,
  isCurrent: () => generation === activeGeneration,
  onUnavailable: reportTransportUnavailable,
});
let inFlightRelayRecovery: Promise<void> | null = null;
const runRelayRecovery = () => {
  inFlightRelayRecovery = recoverRelay();
};
node.addEventListener("connection:close", runRelayRecovery);
let coldRecoveryTimer: ReturnType<typeof setTimeout> | null = null;
if (selectedNetworkServices.relay.length > 0) {
  coldRecoveryTimer = setTimeout(runRelayRecovery, BOOTSTRAP_DIAL_TIMEOUT_MS);
}
// generation teardown：先 clear timer、停止 transport 以中止 listen，再等待 in-flight recovery 收斂。
if (coldRecoveryTimer !== null) clearTimeout(coldRecoveryTimer);
await shutdownTransport();
await inFlightRelayRecovery?.catch(() => undefined);
```

community registry listing 只是 unauthenticated discovery 輸入，**永遠不能**自行授予 relay
能力；relay 必須來自玩家手動設定、已接受 session invite，或玩家明示選取的 registry entry。
設定頁可逐類設定 bootstrap 與 relay，listing 本身不等於選取。節點的通用
listen 清單刻意**不含**裸 `/p2p-circuit`，避免
libp2p RelayDiscovery 自動向任意 HOP-capable peer reservation。公版未部署設定保持空陣列。

行動網路嚴格 NAT 的 TURN relay fallback 見 [部署資訊.md §4.3](../部署資訊.md) · [signaling-service.md §TURN](signaling-service.md)。

## 8. Bootstrap 候選

```typescript
const bootstrapNodes = resolveBootstrapNodes({
  configured: selectedNetworkServices.bootstrap,
});
```

`selectedNetworkServices.bootstrap` 是玩家手動、已接受 session invite 與玩家明示選取的 community
registry 候選所形成的有界 snapshot。`resolveBootstrapNodes` 只做 multiaddr 驗證、去重與當次
generation 排序；不抓主 repo 文字檔、不讀內建預設、不做失敗 fallback，也不把 runtime 順序
寫回 settings／registry。空輸入保持空陣列，代表不主動撥號 bootstrap，但本機與既有 session
仍可運作。

`LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED = 3` 只是在玩家選取多個獨立 provider 故障域時的可用性提示，不是硬下限或
主專案營運承諾；`BOOTSTRAP_DIAL_TIMEOUT_MS = 15_000`。registry 僅列公開且通過技術檢核的
服務，沒有優先級、信任或持續可用保證。

## 9. Topic Rate Limit

每 authenticated source **跨所有 topic 合計**每 60s 上限 30 則（`TOPIC_RATE_*`，[network.md §10](../程式參數/network.md#10-networkpeer-discovery節點發現)），逾額丟棄（防 gossip flooding）。counter map 硬上限 `4,096`；窗口過期時清理，滿載時淘汰最久未活動來源，不允許無界 signer churn：

```typescript
class TopicRateLimiter {
  private counters = new Map<
    PeerId,
    { count: number; windowStart: number; lastSeen: number }
  >();
  private readonly WINDOW_MS = TOPIC_RATE_WINDOW_MS; // 60_000，network.md §10
  private readonly MAX_PER_WINDOW = TOPIC_RATE_MAX_PER_WINDOW; // 30，network.md §10
  shouldAccept(peerId: PeerId, topic: Topic): boolean {
    void topic; // 配額刻意跨 topic 聚合
    const now = Date.now();
    const c = this.counters.get(peerId);
    if (!c || now - c.windowStart > this.WINDOW_MS) {
      pruneExpired();
      if (!c && this.counters.size >= 4096) evictLeastRecentlyActive();
      this.counters.set(peerId, { count: 1, windowStart: now, lastSeen: now });
      return true;
    }
    c.count++;
    c.lastSeen = now;
    return c.count <= this.MAX_PER_WINDOW;
  }
}
```

限流只接受「authenticated GossipSub source = envelope signer」且驗簽成功的來源，並固定放在 nonce commit 前；同一來源跨 topic 共用 30/60s 配額，不能靠換 topic 繞過。Replay state 採每來源 64 nonce、最多 4096 來源，容量滿時 LRU 淘汰最久未活動來源，避免 Sybil 共享容量鎖死正常節點。raw message `65,536 bytes` 上限仍在 dag-cbor decode 前執行。另有不隨 source LRU 淘汰的 **global fixed-window** raw bytes／message 與 signature verification token 上限；因此攻擊者輪換大量 PeerId 仍無法重置整體 CPU／ 記憶體預算。

## 10. 觀察接點（給其他模組）

```typescript
interface DiscoveryEvents {
  on(event: "peer-connect", handler: (peerId: PeerId) => void): void;
  on(event: "peer-disconnect", handler: (peerId: PeerId) => void): void;
  on(event: "room-discovered", handler: (room: RoomAnnouncement) => void): void;
  on(event: "room-closed", handler: (code: string) => void): void;
}
```

## 11. 跨模組對接

| 模組                                                            | 對接                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| [key-manager.md](key-manager.md)                                | `signPayload` / `SignedPayload` 結構                   |
| [security.md](security.md)                                      | `verifyP2PMessage`（簽章 + timestamp + nonce 防重放）  |
| [matchmaking.md](matchmaking.md)                                | Quick Match 既有房候選 / 動態窗口                      |
| [reputation.md](reputation.md) · [moderation.md](moderation.md) | Peer Scoring 的信譽 / 黑名單來源（DerivedState）       |
| [signaling-service.md](signaling-service.md)                    | WebRTC 握手中介；GossipSub 為其 P2P fallback           |
| [ledger.md](ledger.md)                                          | DerivedState 唯讀視圖；發現層訊息為 ephemeral 不入帳本 |
| [部署資訊.md §5](../部署資訊.md)                                | bootstrap 常數 / 部署面                                |
