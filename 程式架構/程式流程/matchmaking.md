---
type: impl-flow
domain: ["比賽房間"]
summary: 程式級流程圖：既有房 Quick Match／配對窗口／賽後簽章
authority: 程式架構/matchmaking.md
slug: null
---

# matchmaking

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [matchmaking.md](../matchmaking.md) | [配對](../../流程/配對.md) · [比賽結算](../../流程/比賽結算.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
> 配對 / 結算的**技術流程圖**（訊息流 / 賽後簽章 / 斷線計分 / 房主繼任）。模組實作見 [matchmaking.md](../matchmaking.md)；配對遊戲流程（TrueSkill / 配對等待 / 房間）見 [流程/配對.md](../../流程/配對.md)。

## Quick Match 既有房流程

```mermaid
sequenceDiagram
    participant H as 既有房主
    participant GS as Rooms GossipSub
    participant Q as Quick Match 玩家

    H->>GS: room-announce<br/>(public, quick enabled, waiting,<br/>無參賽密碼, rating 中位數)
    GS->>Q: 已驗簽 rooms snapshot
    Q->>Q: 版本・rating 窗口預篩
    Q->>H: joinRoom(roomId, participant)
    H->>H: 最新房態重驗<br/>active + reserved 原子保留
    alt admission 成功
        H-->>Q: join-verdict {accepted, roomState}
        Q->>Q: 進入既有 RoomId
    else 最後席次被搶或公告已過期
        H-->>Q: 結構化拒絕
        Q->>Q: 回 discovery 輪詢至 timeout
    end

    Note over H,Q: Quick Match 不建立房間、不使用 match-request／match-offer
```

## 主 peer 賽後流程

```mermaid
flowchart TD
    Start([比賽結束<br/>最後一台車完賽 / 全員棄賽]) --> Collect[收齊 rounds、loadouts<br/>與 inline roundAnchors]
    Collect --> Build[buildMatchResultCandidate<br/>只含 match facts<br/>含 proposerSignature 自簽]
    Build --> Broadcast[經 RaceMesh ordered control<br/>廣播 match-result proposal]
    Broadcast --> Timer[啟動 SETTLEMENT_TIMEOUT_SEC 計時器]
    Timer --> Wait{等待回應}

    Wait -->|累計簽章達 quorum| Append[appendEvent MatchResultEvent<br/>含全部 signatures]
    Wait -->|剩餘可簽人數 < 需要| Cancel[廣播取消]
    Wait -->|timeout 到| Fail[視為失敗]
    Wait -->|收到 RejectMessage| Reject[紀錄 reason<br/>繼續等其他簽章]
    Reject --> Wait

    Append --> Done([結算寫入 ledger])
    Cancel --> Abort([放棄結算])
    Fail --> Abort

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Done,Append local
    class Build,Broadcast consensus
    class Start chain
    class Abort fail
```

`proposerSignature` 算 quorum 1 票，主 peer 自身也是完賽者之一。

## 完賽者驗算+簽章（reviewAndSignMatchResult）

```mermaid
flowchart TD
    Start([收到 match-result proposal control]) --> Step1{1. 自己在 ranking?}
    Step1 -->|否| R1([拒：非完賽者不可簽章])
    Step1 -->|是| Step2{2. proposerSignature.signer<br/>== candidate.peerId?}
    Step2 -->|否| R2([拒：signer 不一致])
    Step2 -->|是| Step3{3. proposerSignature.sig<br/>驗證通過?}
    Step3 -->|否| R3([拒：proposerSignature 無效])
    Step3 -->|是| Step4{"4. ranking 是否等於<br/>rounds[] 重算結果?"}
    Step4 -->|否| R4([拒：總名次不符])
    Step4 -->|是| Step5{5. rounds/roundAnchors/loadouts<br/>與本機觀測一致?}
    Step5 -->|否| R5([拒：match facts 不符])
    Step5 -->|是| Step6["6. 簽 ledgerSigningDigest(ledgerAddress, candidate)<br/>覆蓋整個 MatchResultEvent"]
    Step6 --> Ok([回 SignatureMessage<br/>signer, sig])

    R1 --> Broadcast[廣播 RejectMessage<br/>透明審計]
    R2 --> Broadcast
    R3 --> Broadcast
    R4 --> Broadcast
    R5 --> Broadcast

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Ok local
    class Broadcast consensus
    class Start chain
    class R1,R2,R3,R4,R5 fail
```

任一驗證失敗 → 拒簽 + 廣播 RejectMessage 給所有 peer（含主 peer 與其他完賽者），達到透明審計效果。

## 中途斷線計分

```mermaid
flowchart TD
    Race[比賽進行中] --> Voluntary{GO 後主動離場?}
    Voluntary -->|是| LeaveWire[送出 leave<br/>reason voluntary]
    LeaveWire --> LeaveEvent[本人單簽 RaceLeaveEvent]
    LeaveEvent --> LeaveEffect[套用離場計次與信譽效果]

    Voluntary -->|否| Disconnect[玩家 X 斷線]
    Disconnect --> Wait[等待重連窗]
    Wait --> Reconn{重連?}
    Reconn -->|是| Continue[正常繼續]
    Reconn -->|否| Quorum{原 active roster<br/>嚴格多數可定稿?}
    Quorum -->|否| Void[partition-void<br/>不得替第三人扣分]
    Quorum -->|是| MatchEffect[MatchResult disconnects<br/>套用離場效果]

    LeaveEffect --> Dedup[以 matchId + peerId<br/>持久去重]
    MatchEffect --> Dedup
    Dedup --> Record[只累積離場效果與計次]
    Record --> Later[下次合法 MatchResult<br/>更新 rating 時]
    Later --> Threshold{累積次數達門檻?}
    Threshold -->|是| AdjustSigma[套用 σ 下限]
    Threshold -->|否| Normal[正常 TrueSkill 更新]

    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class AdjustSigma consensus
    class LeaveEffect chain
    class Void fail
```

`RaceLeaveEvent` 只立即形成本人離場成本，不產生排名、TrueSkill、經濟或完賽效果，也不縮小 MatchResult quorum；正式 MatchResult 的其餘效果仍依原 active roster 的合法定稿正常套用。

## 房主繼任

```mermaid
flowchart TD
    Detect[偵測房主離線] --> State{房間狀態?}
    State -->|Waiting| Next[由進房順序下一位接任]
    State -->|Preloading/Racing/Settling| NoOp[無作用<br/>不需繼任]

    Next --> Update[Update room.hostPeerId]
    Update --> Notify[廣播給房間成員]

    NoOp --> Continue[比賽繼續]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Update local
    class NoOp chain
```
