---
type: impl-flow
domain: ["共識帳本"]
summary: 程式級流程圖：Checkpoint／Partition／Sync
authority: 程式架構/ledger.md
slug: null
---
# Ledger

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [ledger.md](../ledger.md) | [資料系統](../../資料系統.md) · [比賽結算](../../流程/比賽結算.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## 三層架構

```mermaid
graph TB
    subgraph Layer3[Checkpoint 層]
        CP1[較早 Checkpoint]
        CP2[前一 Checkpoint]
        CP3[Checkpoint N]
        CP1 --> CP2 --> CP3
    end

    subgraph Layer2[Derived State 層]
        DS[Derived State<br/>balances/ratings/blacklist...]
    end

    subgraph Layer1[Event Log]
        E1[Event 1]
        E2[Event 2]
        E3[...]
        En[Event N]
        E1 --> E2 --> E3 --> En
    end

    Layer1 -->|推導| Layer2
    Layer2 -->|快照| Layer3

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Layer1 local
    class Layer2 chain
    class Layer3 consensus
```

## 事件溯源範例

```mermaid
sequenceDiagram
    participant E as Event Log
    participant D as Derived State

    E->>D: UgcUploadEvent
    Note over D: 建立 UGC record 並套用上鏈費
    E->>D: MatchResultEvent
    Note over D: 驗證 anchor 後套用排名、信譽與經濟 settlement
    E->>D: UgcSponsorBurnEvent
    Note over D: 套用贊助燒幣與作品永久聚合

    Note over D: 純函數推導<br/>可隨時從 Event 1 重算
```

## Checkpoint 提案流程

```mermaid
sequenceDiagram
    participant A as 治理 signer proposer
    participant B as 其他治理 signer
    participant C as 其他治理 signer
    participant Ds as 其餘治理 signers
    participant P as Pinning

    A->>A: 計算當前 derived_state
    A->>A: 上傳 derived_state 到 IPFS → CID
    A->>A: 建立 Checkpoint 提案 + 自簽
    A->>B: 廣播提案
    A->>C: 廣播提案
    A->>Ds: 廣播提案

    B->>B: 驗證 proposal
    B->>A: 簽章
    C->>C: 驗證
    C->>A: 簽章
    Ds->>Ds: 各自驗證 + 簽章
    Ds->>A: 簽章

    A->>A: 收集到治理 quorum 簽章

    A->>P: pin checkpoint CID
    A->>B: 廣播 finalized
    A->>C: 廣播 finalized
    A->>Ds: 廣播 finalized
```

## 新玩家 Sync 流程

```mermaid
flowchart TD
    Start([新玩家連線]) --> Announce[取得已驗 checkpoint announcement]
    Announce --> DL[依 announcement 下載 Checkpoint]
    DL --> Verify{驗證簽章}
    Verify -->|失敗| Fallback[fallback 從完整 log frontier sync]
    Verify -->|成功| LoadState[載入 derived_state]
    LoadState --> SyncEvents[從 log_head_cids frontier 開始 sync 後續事件]
    SyncEvents --> Ready([Ready 進入遊戲])

    Fallback --> SyncFull[從零開始 sync 全鏈]
    SyncFull --> Ready

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Ready local
    class Fallback consensus
    class Verify chain
```

## DAG 合併與衝突失效

```mermaid
flowchart TD
    Receive[收到新 heads] --> Merge[合併可達完整 DAG]
    Merge --> Verify[逐事件驗簽與 timeless fold gate]
    Verify --> Order[依 canonical total order replay]
    Order --> Conflict{同一回合 anchor 衝突?}
    Conflict -->|否| Apply[套用唯一合法事件]
    Conflict -->|是| Invalid[該回合 consensus-invalid]
    Invalid --> Evidence[RaceAbortEvidenceEvent 可記錄失效證據]
```

## 比賽結果簽章

```mermaid
sequenceDiagram
    participant P1 as 完賽者 1
    participant P2 as 完賽者 2
    participant Ps as 完賽者 3..N
    participant L as Ledger

    Note over P1,Ps: 比賽結束

    P1->>P1: 計算最終排名
    P1->>P2: 廣播排名 + 簽章
    P2->>P1: 驗證 + 簽章
    P2->>Ps: 廣播
    Ps->>P1: 各自簽章

    P1->>P1: 收集 MatchResult 所需嚴格多數簽章
    P1->>L: appendEvent match-result
    Note over L: 排名上鏈
```

## DerivedState 推導效能

```mermaid
flowchart LR
    subgraph 全量重算
        E1[Event 1] --> Sum[累計]
        E2[Event 2] --> Sum
        E3[...] --> Sum
        En[Event 100k] --> Sum
        Sum --> S1[Derived State]
    end

    subgraph 增量推導
        CP[Checkpoint<br/>含 derived_state] --> S2[載入]
        E1k[Event 1k 從 checkpoint 後] --> Apply[逐步套用]
        Apply --> S2
    end

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    class 增量推導 local
    class 全量重算 consensus
```

## 事件分類

```mermaid
mindmap
  root[Ledger Events]
    經濟
      SlotPurchaseEvent
      UgcSponsorBurnEvent
      上鏈費只燒於 UgcUploadEvent；UgcForkEvent 免費
    UGC
      UgcUploadEvent
      UgcForkEvent
      UgcMaintenanceEvent
    比賽
      MatchResultEvent
        含 rounds 陣列 + 總名次
        完整 gridProof + loadout proofs
        inline roundAnchors
        不含 payout 或 frontier
      RaceConsensusAnchorEvent 回合唯一共識錨，綁 grid digest + seed
      RaceLeaveEvent 本人主動離場成本
      RaceAbortEvidenceEvent consensus-invalid 證據
    Moderation
      ReportEvent
      ReportRevokeEvent
      ArbitrationVoteEvent
      ArbitrationResultEvent
      BlacklistEvent
    信譽
      (純 derive、無獨立事件)
    UGC Rating
      UgcRateEvent
      UgcRateRevokeEvent
    Config
      ConfigUpdateEvent
      AssetVersionUpgradeEvent
    Checkpoint
      LedgerCheckpointEvent 帳本檢查點
```
