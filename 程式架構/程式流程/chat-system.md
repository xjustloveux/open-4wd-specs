---
type: impl-flow
domain: ["比賽房間"]
summary: 程式級流程圖：房間聊天／過濾
authority: 程式架構/chat-system.md
slug: null
---
# chat-system

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [chat-system.md](../chat-system.md) | [賽內機制](../../賽內機制.md) · [配對](../../流程/配對.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
> 等待房共用文字聊天的**技術流程圖**（訊息傳送／結構／過濾／速率／最近隊友／生命週期）。模組實作見 [chat-system.md](../chat-system.md)；賽內改用 [race-messages.md](../race-messages.md)。

## 訊息傳送

```mermaid
sequenceDiagram
    participant A as 玩家 A
    participant Host as 房主 HostRoom
    participant B as 玩家 B
    participant FilterB as 過濾器 (B 端)

    A->>A: 輸入訊息
    A->>A: 速率限制檢查
    A->>A: 長度驗證
    A->>A: signPayload → SignedPayload<ChatMessage>
    A->>Host: room-control 傳送原始 signed envelope
    Host->>Host: admitted source + 驗章 + per-sender + room-wide 預算
    Host->>B: 中繼同一份 signed envelope

    B->>B: 驗章（簽章 / 時序窗 / nonce）+ sender=signer + roomId
    B->>B: 驗 roomId、signer 與內容 shape
    B->>B: 個人封鎖清單靜音檢查
    B->>FilterB: 顯示前過濾
    
    alt B 啟用過濾
        FilterB->>B: 過濾後顯示
    else B 關閉過濾
        FilterB->>B: 原文顯示
    end
```

## 訊息結構

```mermaid
graph TB
    Env[SignedPayload〈ChatMessage〉] --> Msg[payload: ChatMessage]
    Env --> Nonce[timestamp + nonce + signer + signature]
    Msg --> Type[type: text or system]
    Msg --> Sender[sender peerId + nickname]
    Msg --> Room[roomId 情境綁定]
    Msg --> Content[檢查 content 長度]
    Msg --> TS[timestamp]
    Msg --> ID[messageId]

    Type -->|text| Text[玩家文字訊息]
    Type -->|system| System[系統事件]

    System --> S1[peer-joined]
    System --> S2[peer-left]
    System --> S3[host-changed]
    System --> S4[match-started]
    System --> S5[match-ended]
```

## 過濾流程

```mermaid
flowchart TD
    Recv[收到訊息] --> Check{過濾開啟?}
    Check -->|否| RawDisplay[顯示原文]
    Check -->|是| Local[讀裝置本機 literal 詞表]
    Local --> Norm[NFKC + case-fold + Unicode letter/number]
    Norm --> Map[建立 normalized 到原文字位映射]
    Map --> Match[substring 命中]
    Match --> Replace[依映射替換原文範圍為 ***]
    Replace --> FilteredDisplay[顯示過濾後]

    Starter[Git starter list] --> Import{玩家明確匯入?}
    Import -->|是| Copy[複製成玩家本機副本]
    Import -->|否| Local
    Copy --> Local

    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef ui fill:#efeafa,stroke:#7a5cb8,stroke-width:1.4px,color:#2b1d4d;
    class RawDisplay consensus
    class FilteredDisplay ui
```

## 騷擾檢舉證據

```mermaid
flowchart LR
    Select[玩家選同一 sender 的訊息] --> Cap{筆數符合證據上限?}
    Cap -->|否| Keep[依上限截取]
    Cap -->|是| Export[依 messageId 取原始 SignedPayload]
    Keep --> Export
    Export --> Encode[每筆 canonical DAG-CBOR + multibase base64url]
    Encode --> Report[ReportEvent details + evidence string array]
    Report --> Fold[ReportInfo 保留原值]
    Fold --> Inbox[仲裁收件匣逐筆離線驗章]
    Inbox --> Valid[顯示 valid / invalid、signer、messageId]
```

單一騷擾檢舉至多收錄同一 sender 的 16 筆訊息；完整逐筆大小與編碼限制見
[流程/檢舉與仲裁.md §1](../../流程/檢舉與仲裁.md)。

## 速率限制（雙端）

```mermaid
flowchart TD
    Send[使用者按送] --> Check[計算發送窗口內筆數]
    Check --> Count{尚有發送額度?}
    Count -->|是| Allow[允許送出]
    Count -->|否| Block[阻擋 + 警示「訊息過快」]
    Allow --> Record[記錄時間戳]

    Recv[收到訊息] --> Verify{驗章通過?}
    Verify -->|否| Drop[丟棄]
    Verify -->|是| RxCount{該 sender 接收速率合規?}
    RxCount -->|是| Accept[接受 → 過濾顯示]
    RxCount -->|否| Drop

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Allow,Accept local
    class Block,Drop fail
```

送端自律是 UX、收端強制是防線（惡意 client 可跳過送端檢查）。

## 最近隊友更新

```mermaid
sequenceDiagram
    participant Race as participant 已驗證正式結果
    participant Service as RecentTeammates Service
    participant DB as IndexedDB

    Race->>Service: addFromMatch(match-start 固定 roster)
    
    loop 每位 participant
        Service->>DB: get peer data
        alt 已存在
            Service->>DB: update lastPlayedAt + matchCount++
        else 新增
            Service->>DB: insert 初始 matchCount
        end
    end

    Service->>DB: 取所有 entries
    Service->>Service: 排序 by lastPlayedAt
    
    alt 超過歷史保留門檻
        Service->>DB: 刪除最舊的
    end
```

開賽失敗、賽前取消、單純 teardown 與 spectator 不進入此流程。設定頁隱私區讀取這份本機
清單，供玩家辨識最近隊友並直接加入個人封鎖清單；資料不建立好友關係且不上鏈。

## 房內聊天 UI

```mermaid
graph TB
    Room[房間] --> ChatWindow[聊天視窗]
    ChatWindow --> History[訊息歷史<br/>上限取自 CHAT_HISTORY_LIMIT]
    ChatWindow --> Input[輸入框]
    ChatWindow --> Toggle[☐ 文字過濾]
    
    Input --> RateCheck{速率檢查}
    RateCheck -->|通過| Send[送出]
    RateCheck -->|拒絕| Toast[「訊息過快」]

    History --> Each[每則訊息]
    Each --> Sender[發送者顯示身分]
    Each --> Time[時間戳]
    Each --> Text[訊息內容過濾後]
    
    Toggle -.->|on| Filtered
    Toggle -.->|off| Raw
```

發送者顯示為暱稱加空格與 `#` 後 8 位 hex 指紋；缺暱稱時只顯示該穩定指紋。

## 訊息生命週期

```mermaid
stateDiagram-v2
    [*] --> Composed: 玩家輸入
    Composed --> Sent: room-control 送給 host
    Sent --> Received: host 驗證後中繼
    Received --> Filtered: 過濾後顯示
    Received --> Raw: 不過濾顯示
    Filtered --> InBuffer: 加入歷史
    Raw --> InBuffer
    InBuffer --> RoomEnd: 房間結束
    RoomEnd --> [*]: 訊息消失（不上鏈）
```
