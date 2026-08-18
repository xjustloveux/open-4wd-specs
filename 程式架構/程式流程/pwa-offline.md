---
type: impl-flow
domain: ["前端主題"]
summary: 程式級流程圖：PWA／離線快取
authority: 程式架構/pwa-offline.md
slug: null
---
# PWA Offline

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [pwa-offline.md](../pwa-offline.md) | [玩家整體旅程](../../流程/玩家整體旅程.md) · [遊戲機制](../../遊戲機制.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## App Shell 狀態與功能可用性

```mermaid
stateDiagram-v2
    state "local-ready" as local_ready
    state "online-ready" as online_ready
    [*] --> locked
    locked --> launching
    launching --> locked
    launching --> local_ready
    launching --> online_ready
    local_ready --> locked
    local_ready --> reconnecting
    reconnecting --> locked
    reconnecting --> local_ready
    reconnecting --> online_ready
    online_ready --> locked
    online_ready --> local_ready
    online_ready --> reconnecting
```

每次轉移原子產生 `{ revision, onlineEpoch, phase, capabilities, failure }` snapshot。
`capabilitiesFor` 直接依 phase 與 service availability 推導：`locked` 只有 `identity` 為 true；
`launching`、`local-ready`、`reconnecting` 開啟 onboarding、本機車庫、資產、UGC 編輯／匯入匯出
與本機比賽；`online-ready` 再依各服務可用性開啟 ledger、發布、配對、房間、聊天、觀戰、TURN、
評分、檢舉與仲裁。元件只讀能力 flag，不以五態名稱自行維護第二份矩陣。

## Service Worker 生命週期

```mermaid
stateDiagram-v2
    [*] --> Installing: install event
    Installing --> Installed: 預載資源完成
    Installed --> Activating: activate event
    Activating --> Active: 清理舊 cache + claim clients
    Active --> Idle: 服務 fetch 請求

    Idle --> Updating: 偵測到新 SW
    Updating --> Waiting: 新 SW installed 等待
    Waiting --> Active: UI idle guard 後送 SKIP_WAITING，再重整
```

## Cache Strategy 決策

```mermaid
flowchart TD
    Req[fetch 請求] --> URL{URL 類型}
    URL -->|/api/*| NO[Network Only]
    URL -->|/version.json| NO
    URL -->|/help/* 或 .md| SWR[Stale While Revalidate]
    URL -->|靜態資源| CF[Cache First]

    CF --> Cached{在 cache?}
    Cached -->|是| Return1[回傳 cached]
    Cached -->|否| Fetch1[fetch]
    Fetch1 -->|成功| Cache[cache + 回傳]
    Fetch1 -->|失敗| Offline1[503 Offline]

    SWR --> Cache2[同時 fetch 與回傳 cache]
    Cache2 -->|無 cache| Wait[等 fetch]

    NO --> Direct[直接 fetch]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Return1,Cache local
    class Offline1 fail
```

## 線上/離線切換

```mermaid
flowchart LR
    Online[線上模式] -.network drops.-> Offline[離線模式]
    Offline -.network restores.-> Verify{HEAD /version.json 確認}
    Verify -->|成功| Online
    Verify -->|失敗| Offline

    Online --> AllUI[所有按鈕可用]
    Offline --> GrayUI[需連線按鈕灰化]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    class Online local
    class Offline consensus
```

## IndexedDB 結構

```mermaid
graph LR
    DB[IndexedDB: open-4wd] --> S1[local-parts]
    DB --> S2[local-tracks]
    DB --> S3[settings]
    DB --> S4[cached-ugc-thumbnails]
    DB --> S5[ugc-cache-meta]
    DB --> S6[recent-teammates]
    DB --> S7[blocklist]
    DB --> S8[composed-vehicle-thumbnails]
    DB --> S9[ledger-admission-outbox]
    DB --> S10[physics-manifest-receipts]
    DB --> S11[inbox-snapshots]
    DB --> S12[inbox-read-markers]
    KDB[IndexedDB: open4wd-keys 金鑰獨立 db] --> K1[加密金鑰]

    S1 --> V1[本機測試零件 1]
    S1 --> V2[本機測試零件 2]

    S4 --> U1[UGC 縮圖]
    S5 --> U2[UGC metadata]
    S9 --> U3[完整組裝車縮圖<br/>keyPath: cacheKey]
```

`open-4wd` 的 schema 版本為 **1**，新建資料庫必須一次建立完整 stores。runtime 不得用 `indexedDB.deleteDatabase()` 自動清資料；缺少必要 store 時 fail closed 並交由產品內明示的重設流程處理。獨立的 `open4wd-keys` 不屬此資料庫生命週期。

## 容量警示流程

```mermaid
flowchart TD
    Check[觸發容量檢查] --> Policy[依平台與 UGC 貢獻等級<br/>解析 active policy]
    Policy --> Estimate[storage.estimate]
    Estimate --> Ratio{usage 是否超過<br/>policy trigger?}
    Ratio -->|否| OK[無警示]
    Ratio -->|是，離線| Deferred[cleanup-deferred-offline]
    Ratio -->|是，在線| GC[依 policy target 執行 LRU GC]
    GC --> Recheck[重新 estimate 並回報結果]
    Deferred --> Clean[設定頁清理工具]
    Recheck --> Clean
    Clean --> Choose[使用者選擇清理項]
    Choose --> Free[釋放空間]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class OK local
    class Deferred consensus
    class GC chain
```

## iOS 限制與緩解

```mermaid
graph TB
    iOS[iOS Safari 限制] --> L1[Install 流程不直觀]
    iOS --> L2[久未開啟時資料可能清除]
    iOS --> L3[WebRTC 後台暫停]

    L1 --> M1[onboarding 提供圖示說明]
    L2 --> M2[請求 persistent + 提示備份助記詞]
    L3 --> M3[比賽中提示保持應用前景]

    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    class iOS consensus
```
