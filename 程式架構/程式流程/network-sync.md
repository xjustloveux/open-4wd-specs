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
    Start([每 frame 開始]) --> Receipt[套用非同步交付回執]
    Receipt --> Recv[接收網路訊息]
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
    Continue --> Local[本地輸入排程到 current+D<br/>簽章並廣播]
    Local --> RB{需 rollback?}
    RB -->|是| Restore[載入 ≤ 目標幀的最近快照<br/>距 current 超過 R 即 fail-closed]
    Restore --> Replay[重播至當前 frame<br/>只在對齊幀與含預測幀重存]
    Replay --> SaveRule
    RB -->|否| SaveRule{對齊幀或含預測?}
    SaveRule -->|是| SavePre[saveState 當前 frame<br/>的前緣快照進 buffer]
    SaveRule -->|否| StepCurrent
    SavePre --> StepCurrent[step 當前 frame]
    StepCurrent --> CSCheck{到達 checksum 取樣 frame?}
    CSCheck -->|是| Hash[記暫定 hash]
    CSCheck -->|否| Settle
    Hash --> Settle[已確定的暫定 hash 廣播<br/>依幀序發出已確定記錄]
    Settle --> Done([下一 frame])
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
    Limit -->|否| Absent{該輪有成員缺席投票?}
    Absent -->|是| Resync[向該輪多數票 peer<br/>發起 catch-up 重同步]
    Absent -->|否| Done([繼續、待下輪 checksum])
    Resync --> Done
    Reset --> Done
```

## Input Prediction 流程

```mermaid
sequenceDiagram
    participant P1 as Player 1
    participant P2 as Player 2

    Note over P1,P2: frame N
    P1->>P1: frame N−D 取樣的 localInput 排程到 N
    P1->>P2: input N（D 幀前送出）

    Note over P2: 單向延遲 ≤ D 幀：步進 N 前已收到、不需預測
    Note over P2: 超過 D 幀才延遲收到
    P2->>P2: 延遲期間延續上一輸入的 Hold 作預測值
    P2->>P2: 比對 預測 vs 實際

    alt 預測正確
        Note over P2: 不需 rollback
    else 預測錯誤
        P2->>P2: rollback 至 frame N（深度 ≤ R）
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
        Other->>Lost: signed offer（最多兩個已 final aligned frame + hash，snapshot 已 pin）
        Note over Lost,Other: offer 遺失時以同 offerId 依政策重送；不重複 copy/hash
        Lost->>Other: strict-quorum 同 frame+hash 的 exact offerId/target request
        Other->>Lost: unicast sync-response（僅首選 voter 傳完整 snapshot＋簽章輸入日誌）
        Lost->>Lost: 在回覆窗內等待（外層簽章驗過即記到達、逾時改自到達起算）；逾時先取消 pending 再換 voter
        Lost->>Lost: 驗簽成功且 enqueue 後才消耗 pending，核對來源、目標、大小與內外 frame
        Lost->>Lost: 日誌命中已驗快取者跳過、其餘分片驗簽，再驗語意（roster、車輛 schema、front 跨度）
        Lost->>Lost: 以非 provider 觀測的參考幀夾限 front 與追前緣目標；越界記 misbehavior 並換 voter
        Lost->>Lost: current SavedState schema+vehicle/entity/destruction/route/projectile/weather lifecycle+拓撲+數值範圍 原子 loadState
        Lost->>Lost: 載入 F 後依牆鐘預算分 tick 追到前緣，追趕結束後本機輸入自結束幀加 D 恢復
        Note over Lost,Other: 畸形或 load 失敗：記 misbehavior、不前跳、不中斷幀<br/>成功送交通道才刪 pinned offer 並進 cooldown；send 失敗由 responder 有上限地重送
    else 重連窗期滿仍未連
        Engine->>Other: 標記 Lost 為「異常斷線」
        Note over Other: 比賽繼續，Lost 排在最後一名
        Note over Other: 結算時 Lost 不算簽章人
    end
```

追前緣目標、輸入日誌、驗簽、時間線重建與分 tick 追趕規則見 [network-sync.md §7.1](../network-sync.md) 第 4–6 步。

## Snapshot Buffer 滑動視窗

```mermaid
flowchart LR
    Oldest[最舊可回滾快照] --> Middle[視窗內快照]
    Middle --> Newest[最新前緣快照<br/>對齊幀或預測幀]
    Newest --> Push[推入下一份快照]
    Push --> Drop1[移除超出視窗的舊快照]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Newest,Push local
    class Drop1 fail
```

Buffer 只保存前緣快照（對齊幀與含預測的幀），保留距最近一次寫入 12 幀內者，不保證每幀都有；
rollback acceptance 為 R 幀且不可協商。視窗推進與接納門檻以程式參數 authority 為準。
