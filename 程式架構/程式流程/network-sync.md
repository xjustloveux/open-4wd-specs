---
type: impl-flow
domain: ["比賽房間"]
summary: 程式級流程圖：Rollback／Snapshot
authority: 程式架構/network-sync.md
slug: null
---
# Network Sync

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [network-sync.md](../network-sync.md) | [比賽進行](../../流程/比賽進行.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## Rollback 主迴圈

```mermaid
flowchart TD
    Start([每 frame 開始]) --> Local[寫入本地輸入]
    Local --> Broadcast[廣播 input 訊息]
    Broadcast --> Recv[接收網路訊息]
    Recv --> Process{處理訊息}
    Process -->|input| ValidateInput{loadout schema /<br/>唯一 / Event-Hold 合法?}
    ValidateInput -->|否| DropInput[丟棄並記 misbehavior]
    ValidateInput -->|是| Equivocation{同 peer+frame<br/>已有相異首值?}
    Equivocation -->|是| AbortInput[fail-closed 中止]
    Equivocation -->|否| CheckPred{該幀實際預測正確?}
    Process -->|checksum| StoreCS[鎖首票；舊輪/衝突票拒收]
    CheckPred -->|是| Continue
    CheckPred -->|否| MarkRB[標記需 rollback 至 frame N]
    StoreCS --> Continue
    MarkRB --> Continue
    Continue --> RB{需 rollback?}
    RB -->|是| Restore[restore snapshot]
    Restore --> Replay[重播至當前 frame]
    Replay --> SavePre
    RB -->|否| SavePre[saveState 當前 frame<br/>的 pre-step 快照進 buffer]
    SavePre --> StepCurrent[step 當前 frame]
    StepCurrent --> CSCheck{到達 checksum 取樣 frame?}
    CSCheck -->|是| Hash[computeStateHash]
    Hash --> SendCS[廣播 checksum]
    CSCheck -->|否| Done
    SendCS --> Done([下一 frame])
```

## Checksum 解決流程

```mermaid
flowchart TD
    Start([收到 checksum]) --> Wait{全員到齊或逾等待窗?}
    Wait -->|窗內未到齊| WaitMore[等待（逾窗未到 = 該輪缺席）]
    Wait -->|到齊 / 逾窗| Count[以已到票計票]
    Count --> Tied{平手?}
    Tied -->|是| Invalid[consensus-invalid<br/>形成 RaceAbortEvidenceEvent 候選證據]
    Tied -->|否| MyMatch{我的 hash 是多數派?}
    MyMatch -->|是| Reset[清除連續 desync 計數<br/>繼續]
    MyMatch -->|否| Inc[consecutiveDesync++<br/>不 rollback（重播同 input 無法收斂）]
    Inc --> Limit{達 desync strike 門檻?}
    Limit -->|是| Invalid
    Limit -->|否| Done([繼續、待下輪 checksum])
    Reset --> Done
```

## Input Prediction 流程

```mermaid
sequenceDiagram
    participant P1 as Player 1
    participant P2 as Player 2

    Note over P1,P2: frame N
    P1->>P1: localInput
    P1->>P2: input N

    Note over P2: 延遲收到另一玩家的舊 input
    P2->>P2: 延遲期間使用上一輸入作預測值
    P2->>P2: 比對 預測 vs 實際

    alt 預測正確
        Note over P2: 不需 rollback
    else 預測錯誤
        P2->>P2: rollback 至 frame N
        P2->>P2: 用實際輸入重播受影響區間
    end
```

## 8 玩家 Mesh 拓樸

```mermaid
graph TB
    P1[Player 1] --- P2[Player 2]
    P1 --- P3[Player 3]
    P1 --- P4[Player 4]
    P1 --- P5[Player 5]
    P1 --- P6[Player 6]
    P1 --- P7[Player 7]
    P1 --- P8[Player 8]
    P2 --- P3
    P2 --- P4
    P2 --- P5
    P2 --- P6
    P2 --- P7
    P2 --- P8
    P3 --- P4
    P3 --- P5
    P3 --- P6
    P3 --- P7
    P3 --- P8
    P4 --- P5
    P4 --- P6
    P4 --- P7
    P4 --- P8
    P5 --- P6
    P5 --- P7
    P5 --- P8
    P6 --- P7
    P6 --- P8
    P7 --- P8

    Note["玩家之間建立 full-mesh WebRTC 連線"]
```

## Reconnect 流程

```mermaid
sequenceDiagram
    participant Other as 其他玩家
    participant Lost as 斷線玩家
    participant Engine as Reconnect Handler

    Other->>Other: 偵測 Lost 連線中斷
    Other->>Engine: 啟動重連窗計時器
    Other->>Other: 比賽繼續，Lost 用預測輸入

    alt 重連窗內成功
        Lost->>Other: 定向 signed sync-probe-request
        Other->>Lost: signed offer（最近兩個 aligned frame + hash，snapshot 已 pin）
        Note over Lost,Other: offer 遺失時以同 offerId 依政策重送；不重複 copy/hash
        Lost->>Other: strict-quorum 同 frame+hash 的 exact offerId/target request
        Other->>Lost: unicast sync-response（僅首選 voter 傳完整 snapshot）
        Lost->>Lost: 在回覆窗內等待；逾時先取消 pending 再換 voter
        Lost->>Lost: 驗簽成功且 enqueue 後才消耗 pending，核對來源、目標、大小與內外 frame
        Lost->>Lost: current SavedState schema+vehicle/entity/destruction/route/projectile/weather lifecycle+拓撲+數值範圍 原子 loadState
        Note over Lost,Other: 畸形或 load 失敗：記 misbehavior、不前跳、不中斷幀<br/>成功送交通道才刪 pinned offer 並進 cooldown；send 失敗保留供重試
    else 重連窗期滿仍未連
        Engine->>Other: 標記 Lost 為「異常斷線」
        Note over Other: 比賽繼續，Lost 排在最後一名
        Note over Other: 結算時 Lost 不算簽章人
    end
```

## Snapshot Buffer 滑動視窗

```mermaid
flowchart LR
    Oldest[最舊可回滾快照] --> Middle[視窗內快照]
    Middle --> Newest[最新 pre-step 快照]
    Newest --> Push[推入下一份快照]
    Push --> Drop1[移除超出視窗的舊快照]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Newest,Push local
    class Drop1 fail
```

Buffer 精確保留 12 個 pre-step 快照，rollback acceptance 固定為 8 frames 且不可協商；
視窗推進與接納門檻以程式參數 authority 為準。
