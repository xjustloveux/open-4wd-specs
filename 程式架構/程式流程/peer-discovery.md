---
type: impl-flow
domain: []
summary: 程式級流程圖：DHT＋GossipSub＋PeerScore
authority: 程式架構/peer-discovery.md
slug: null
---
# Peer Discovery

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [peer-discovery.md](../peer-discovery.md) | [配對](../../流程/配對.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## 啟動探索

```mermaid
flowchart TD
    Start[App 啟動] --> KM[KeyManager 解鎖]
    KM --> CreatePeer[建立 libp2p node<br/>peerId from KeyPair]
    CreatePeer --> LoadBootstrap[載入玩家選定的 Bootstrap entries]

    LoadBootstrap --> Source{來源}
    Source -->|手動| Manual[玩家輸入]
    Source -->|session| Session[邀請內 hint]
    Source -->|registry| Registry[社群 registry<br/>由玩家明確選取]

    Manual --> Connect[嘗試連線]
    Session --> Connect
    Registry --> Connect

    Connect --> JoinDHT[加入 Kademlia DHT]
    JoinDHT --> Subscribe[訂閱 Topics]

    Subscribe --> Topics["/open4wd/CHAIN_ID/rooms/v1<br/>＋動態 signaling topics"]
    Topics --> Ready[Discovery 就緒]
```

## 房間發現流程

```mermaid
sequenceDiagram
    participant Host as 房主
    participant Pubsub as GossipSub Mesh
    participant Player as 找房玩家
    participant DHT

    Host->>Host: 建立房間
    Host->>Pubsub: publish RoomAnnouncement<br/>topic=/open4wd/CHAIN_ID/rooms/v1
    Pubsub->>Player: 廣播 RoomAnnouncement
    Player->>Player: 驗簽 + TTL 檢查
    Player->>Player: 加入本地房間清單

    Note over Player: 玩家點選房間

    Player->>DHT: findPeer(host.peerId)
    DHT->>Player: multiaddr
    Player->>Host: WebRTC 握手 (via Signaling)
    Host->>Player: DataChannel 建立

    Note over Host,Player: 之後完全 P2P
```

## NAT 穿透三層

```mermaid
flowchart TD
    Peer[玩家 A] --> Try1[嘗試直連]
    Try1 -->|公開 IP| Direct[Direct]
    Try1 -->|私網| Try2[WebRTC + STUN]

    Try2 -->|多數 NAT| Stun[STUN 穿透]
    Try2 -->|嚴格 NAT| Try3[Circuit Relay v2]

    Try3 --> Reserve[到 Relay node 預訂 slot]
    Reserve --> Hairpin[Relay 中繼訊息]

    Direct --> P2P[直接 P2P]
    Stun --> P2P
    Hairpin --> P2PRelay[P2P 經 Relay]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    class Direct,Stun local
    class Hairpin consensus
```

## Peer Scoring 流程

```mermaid
graph TB
    Msg[GossipSub 收到訊息] --> Score{計算 PeerScore}

    Score --> Topic[topic-specific 分數]
    Score --> App[appSpecificScore]
    Score --> IP[ipColocationFactor]
    Score --> Penalty[behaviourPenalty]

    App --> Reputation[查 reputation]
    App --> RepScore[依本機 reputation 注入分數]

    Topic --> Sum[總分]
    App --> Sum
    IP --> Sum
    Penalty --> Sum

    Sum --> Decide{總分可接受？}
    Decide -->|是| Forward[轉發 + 處理]
    Decide -->|否| RateLimit[降速處理]
    Decide -->|遠低於門檻| Drop[拒絕訊息／連線<br/>不自動寫入封鎖清單]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Forward local
    class RateLimit consensus
    class Drop fail
```

## Quick Match 房間探索

```mermaid
sequenceDiagram
    participant Host as 既有房主
    participant Rooms as Topic.Rooms
    participant Player as Quick Match 玩家

    Host->>Rooms: publish RoomAnnouncement<br/>{visibility, quickMatchEnabled,<br/>state, capacity, version, rules, ratingAnchor}
    Rooms->>Player: 已驗簽 rooms snapshot
    Player->>Player: 只選 public＋enabled＋waiting<br/>＋無參賽密碼＋相容 rating
    Player->>Host: 一般 participant admission
    Host->>Host: 最新狀態與容量 reservation 重驗
    alt 成功
        Host-->>Player: 進入既有 RoomId
    else 競爭失敗
        Host-->>Player: 拒絕
        Player->>Player: 持續探索至 timeout
    end
```

## DHT 查找

```mermaid
sequenceDiagram
    participant Me
    participant Bucket as 我的 Routing Table
    participant Peer as 鄰近 peers
    participant Target

    Me->>Bucket: findPeer(targetPeerId)
    Bucket->>Bucket: 找最近的 K 個
    Me->>Peer: 詢問 closer peers
    Peer->>Me: 回傳更近的 K
    
    loop 收斂
        Me->>Peer: 再問
        Peer->>Me: 更近的 K
    end
    
    Me->>Target: 找到 multiaddr
    Target->>Me: 回應
```

## Topic 訊息驗簽

```mermaid
flowchart TD
    Receive[GossipSub 訊息] --> Parse{canonical DAG-CBOR decode}
    Parse -->|fail| Drop1[丟棄]
    Parse -->|ok| Verify{驗簽}
    Verify -->|fail| Drop2[丟棄 + 扣分]
    Verify -->|ok| Time{timestamp 在允許窗內?}
    Time -->|fail| Drop3[丟棄 replay]
    Time -->|ok| Rate{Rate limit}
    Rate -->|超限| Drop4[丟棄 + 扣分]
    Rate -->|ok| App{app-specific 檢查}
    App -->|fail| Drop5[丟棄]
    App -->|ok| Handle[處理訊息]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Handle local
    class Drop1,Drop2,Drop3,Drop4,Drop5 fail
```

## Bootstrap 故障切換

```mermaid
graph LR
    Boot1[Bootstrap A<br/>down]
    Boot2[Bootstrap B<br/>up]
    Boot3[Bootstrap C<br/>up]
    Selected[玩家選定的其他節點<br/>up]

    Peer[新加入玩家] --> Try1
    Try1 -.X.-> Boot1
    Try1 --> Try2
    Try2 --> Boot2
    Boot2 --> Joined[加入 DHT]

    Joined --> Discover[發現 Boot3 + Selected]
    Discover --> Healthy[多源連線]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Boot2,Boot3,Selected local
    class Boot1 fail
```

## Topic 結構

```mermaid
graph TB
    Root[open4wd/]

    Root --> Rooms[rooms/v1<br/>RoomAnnounce／RoomClose<br/>RoomPresence／PresenceLeft]
    Root --> Signal[signaling/v1/&lt;canonical-scope&gt;<br/>signed signal-v1]

    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Rooms chain
    class Signal consensus
```
