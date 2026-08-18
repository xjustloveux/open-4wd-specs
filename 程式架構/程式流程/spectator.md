---
type: impl-flow
domain: ["比賽房間"]
summary: 程式級流程圖：來源分配／deterministic replay／fallback／淘汰切觀戰
authority: 程式架構/spectator.md
slug: null
---
# spectator

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [spectator.md](../spectator.md) | [觀戰](../../流程/觀戰.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
> 觀戰的**技術流程圖**（來源分配 / deterministic replay / fallback / 不影響共識）。模組實作見 [spectator.md](../spectator.md)；觀戰加入 / 淘汰 / 視角等流程見 [流程/觀戰.md](../../流程/觀戰.md)。

## 觀戰連線拓樸（assigned participant-source star）

房主只做 least-loaded assignment；每位觀戰者主動撥被分配的 participant source。participant 都持有完整 input，故 source 可中繼相同資料；觀戰者不互聯、也永不成為 source。

```mermaid
graph TB
    subgraph 玩家網路
        P1[玩家1 = 房主]
        P2[玩家2]
        P3[玩家3]
        P4[玩家4]
    end

    P1 --- P2
    P1 --- P3
    P1 --- P4
    P2 --- P3
    P2 --- P4
    P3 --- P4

    SA[觀戰者A] --> P1
    SB[觀戰者B] --> P2
    SC[觀戰者C] --> P3

    Note["玩家完全互聯<br/>房主 least-loaded 分配觀戰來源"]
```

## Deterministic Replay

```mermaid
sequenceDiagram
    participant Host as assigned source
    participant DC as DataChannel
    participant Spec as 觀戰者

    Host->>Spec: world-descriptor
    Host->>Spec: countdown（低頻呈現控制）
    Host->>Spec: replay-checkpoint + bounded input backlog
    loop 固定頻率已簽 input relay
        Host->>DC: replay-inputs
        DC->>Spec: 已簽 input batch
        Spec->>Spec: 有界 jitter buffer＋唯讀 physics step
        Spec->>Spec: 共用 mapper → 速度／音效／HUD／小地圖
    end
    loop 定期對帳
        Host->>Spec: replay-checksums
        Spec->>Spec: 對帳；失配則要求新 checkpoint
    end
    Spec->>Spec: 本地回合規則 → RoundEndSummary 過場
```

觀戰 UI 依實際階段顯示 `building-world → waiting-checkpoint → catching-up → live`；無法建立 replay 時顯示 `reduced`。倒數不能由首個 replay frame 回推，因 descriptor 可能在 readiness 等待後才到達，所以由單一低頻控制訊息承載。

## 精簡 Fallback 視覺插值

```mermaid
graph LR
    PrevState[前一 state<br/>at T=100ms] --> Lerp{Linear Interp}
    CurrState[當前 state<br/>at T=200ms] --> Lerp
    Now[現在時間<br/>T=150ms] --> Alpha[alpha = 0.5]
    Alpha --> Lerp
    Lerp --> Visual[視覺位置 = pos@100 × 0.5 + pos@200 × 0.5]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    class Visual local
```

## 觀戰者不影響共識

```mermaid
graph TB
    Race[比賽 P2P mesh]

    subgraph 玩家
        P1[Player 1<br/>跑物理 + 簽章]
        P2[Player 2<br/>跑物理 + 簽章]
    end

    subgraph 觀戰
        S1[Spectator A<br/>唯讀 replay]
        S2[Spectator B<br/>fallback state]
    end

    P1 -.->|signed input| P2
    P2 -.->|signed input| P1
    P1 -->|descriptor + checkpoint + signed input| S1
    P2 -->|bounded fallback state| S2

    Note["觀戰者不傳送 input<br/>不參與 Snapshot Checksum<br/>不算結果簽章人"]

    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef ui fill:#efeafa,stroke:#7a5cb8,stroke-width:1.4px,color:#2b1d4d;
    class 玩家 consensus
    class 觀戰 ui
```
