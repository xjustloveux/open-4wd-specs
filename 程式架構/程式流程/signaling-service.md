---
type: impl-flow
domain: ["版本部署"]
summary: 程式級流程圖：握手／fallback
authority: 程式架構/signaling-service.md
slug: null
---
# Signaling Service 架構圖

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [signaling-service.md](../signaling-service.md) | [配對](../../流程/配對.md) · [資安規範](../../資安規範.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## 整體架構

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"14px","primaryTextColor":"#1f2937","lineColor":"#64748b"},"flowchart":{"curve":"basis"}}}%%
flowchart TB
    P1([玩家 1])
    P2([玩家 2])

    subgraph C1[玩家端 scoped mux]
        WSS[依玩家排序的 WSS endpoints]
        GS[GossipSub scope topic]
    end

    subgraph SG1[open-4wd-signaling]
        CF[Cloudflare Worker adapter<br/>SQLite-backed Durable Object]
        Node[Node／ws adapter]
        Core[共用純協定核心]
        TT[POST /turn-token<br/>選配 TURN 短期憑證]
    end

    P1 --> C1
    WSS -->|可選 provider 實作| CF
    WSS -.->|可選 provider 實作| Node
    CF --> Core
    Node --> Core
    GS <-.->|純 P2P fallback| P2
    Core -->|signed signal-v1| P2
    P1 -.->|"proof 驗身"| TT
    P1 -. WebRTC P2P .-> P2

    style SG1 fill:transparent,stroke:#b9c4d2,stroke-dasharray:4 3
    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class P1,P2 local
    class WSS,GS,CF,Node,Core,TT chain
```

架構權威見 [signaling-service.md §3](../signaling-service.md)（協定核心 ＋ 傳輸適配器、伺服器義務、安全規則）。

## WebRTC 連線建立流程

```mermaid
sequenceDiagram
    participant P1 as Player 1
    participant SS as Signaling Server
    participant P2 as Player 2

    P1->>SS: GET /ws?room=room:<roomId> + signed register
    P2->>SS: GET /ws?room=room:<roomId> + signed register

    P1->>P1: 建立 RTCPeerConnection
    P1->>P1: createOffer
    P1->>SS: signed signal-v1 {scope,target=P2,message:offer}
    SS->>P2: 驗證後 1:1 轉發 envelope

    P2->>P2: 建立 RTCPeerConnection
    P2->>P2: setRemoteDescription(offer)
    P2->>P2: createAnswer
    P2->>SS: signed signal-v1 {scope,target=P1,message:answer}
    SS->>P1: 驗證後 1:1 轉發 envelope

    par ICE Candidate 交換
        P1->>SS: signed signal-v1 {message:ice-candidate}
        SS->>P2: 轉發
    and
        P2->>SS: signed signal-v1 {message:ice-candidate}
        SS->>P1: 轉發
    end

    Note over P1,P2: WebRTC 連線建立成功
    P1->>P2: DataChannel 直連
    P2->>P1: DataChannel 直連

    P1->>SS: 關閉 scoped signaling session
    P2->>SS: 關閉 scoped signaling session
```

## 多 transport（client 端）

GossipSub scope 從 rendezvous 開始即監聽。建房端只維持第一個可註冊 room scope 的 WSS；
加入端依使用者順序嘗試 WSS candidates，只有精確 roster 含非本機 peer 才停止，否則關閉該
session 並續試。冷啟動 WSS roster 不含目標時走 Gossip；入站後沿該 transport sticky，跨
transport 以 signed nonce 去重。配對流程本身只走 GossipSub，見
[matchmaking.md](../matchmaking.md)。

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"14px","primaryTextColor":"#1f2937","lineColor":"#64748b"},"flowchart":{"curve":"basis"}}}%%
flowchart TD
    Start([需要 scoped signaling]) --> Role{角色}
    Start --> Gossip{libp2p GossipSub 可用?}
    Gossip -->|是| UseGossip[立即開 Gossip scope session]
    Gossip -->|否| NoGossip[無 Gossip session]
    Role -->|建房| HostWss[只維持第一個可註冊 WSS]
    Role -->|加入| JoinWss[依設定順序開 WSS candidate]
    JoinWss --> Roster{roster 有非本機 peer?}
    Roster -->|否| Next[關閉並續試下一個]
    Next --> JoinWss
    Roster -->|是| Found[選定該 WSS]
    HostWss --> Mux[SignalingMux]
    Found --> Mux
    UseGossip --> Mux
    NoGossip --> Mux
    Mux --> Route{最後入站或 WSS roster 有目標?}
    Route -->|是| Sticky[沿已驗路徑]
    Route -->|否且 Gossip 可用| GossipRoute[走 Gossip]
    Route -->|無任何 transport| Offline[網路房間／比賽不可用<br/>本機測試仍可用]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class HostWss,JoinWss,Found,Mux,Sticky local
    class UseGossip,GossipRoute consensus
    class Offline fail
```

## 訊息流

```mermaid
flowchart LR
    P1[P1] -->|"signed register"| Scope["room:<roomId>"]
    P1 -->|"signed signal-v1<br/>target=P2"| Scope
    Scope -->|"驗證後 1:1 轉發"| P2[P2]
    P2 -->|"signed signal-v1<br/>target=P1"| Scope
    Scope -->|"驗證後 1:1 轉發"| P1

    Note["伺服器不保存 SDP／ICE 或遊戲資料<br/>Worker SQLite 僅存短期成員、nonce、限流"]
```

## 部署形狀

部署細節與其他平台評估見 [signaling-service.md §4](../signaling-service.md)、
[部署資訊/open-4wd-signaling.md §5](../../部署資訊/open-4wd-signaling.md)。

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"14px","primaryTextColor":"#1f2937","lineColor":"#64748b"},"flowchart":{"curve":"basis"}}}%%
flowchart LR
    Repo[open-4wd-signaling<br/>公版 reusable repo] --> Fork[營運者 fork]
    Fork --> Dispatch[workflow_dispatch<br/>人工輸入與核准]
    Fork --> NodeConfig[部署者 compose／config]
    Dispatch --> CF[Cloudflare Workers<br/>SQLite-backed Durable Objects]
    NodeConfig --> Node[docker compose<br/>Node adapter]
    NodeConfig --> AIO[all-in-one<br/>Node signaling＋coturn]
    Player[玩家設定／session hint／registry] -.->|自行選擇，不內建預設 endpoint| CF
    Player -.->|自行選擇| Node
    Player -.->|自行選擇| AIO

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Repo,Fork,Dispatch,NodeConfig chain
    class CF,Node,AIO,Player local
```

所有部署皆由各維護者獨立負責；專案不指定營運節點、預設清單或必須持續運作的部署。
