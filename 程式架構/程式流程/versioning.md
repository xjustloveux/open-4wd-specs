---
type: impl-flow
domain: ["版本部署"]
summary: 程式級流程圖：版本廣播／升版／Service Worker
authority: 程式架構/versioning.md
slug: null
---
# Versioning

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [versioning.md](../versioning.md) | [版本規範](../../版本規範.md) · [升版](../../流程/升版.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## 六欄版本

```mermaid
graph LR
    Offer[VersionOffer] --> Client[client_version]
    Offer --> Rapier[rapier_version]
    Offer --> Protocol[protocol_version]
    Offer --> Derive[derive_logic_version]
    Offer --> Builtin[builtin_assets_version]
    Offer --> Economy[economy_config_version]
    Client --> Gate[六欄版本與設定 digest 相容檢查]
    Rapier --> Gate
    Protocol --> Gate
    Derive --> Gate
    Builtin --> Gate
    Economy --> Gate
```

## 開賽前版本檢查

```mermaid
sequenceDiagram
    participant Player as Participant
    participant Room as 房間成員
    participant System as 系統

    Player->>Room: 確認 carRotation 並送 ReadyDeclaration
    Room->>System: 全 roster Ready，形成 ReadySet
    System->>Room: 請求各端驗簽並重驗實際 admitted manifests
    Room->>System: client_version + rapier_version + protocol_version<br/>derive_logic_version + builtin_assets_version<br/>economy_config_version + B 軸資產檢核

    System->>System: 比對六欄版本、設定 digest、結構與 B 軸結果

    alt 全部一致
        Room->>System: 全員 ReadySet acknowledgement
        System->>System: 起跑格 commitment／reveal<br/>建立 LockedStartPackage
        System->>Room: 複製鎖定包並啟動倒數
        Room->>Room: 倒數到期進 preloading
    else 有人不符
        System->>Room: ✗ 不接受 acknowledgement，不進倒數
        Room->>Player: 顯示更新、換件或遷移要求
    end
```

## 升版提示流程

```mermaid
flowchart TD
    Start([應用啟動]) --> SW[Service Worker 檢查]
    SW --> NewSW{有新 SW?}
    NewSW -->|否| Continue[繼續使用當前版本]
    NewSW -->|是| Banner[顯示「有新版」橫幅]
    Banner --> User{用戶選擇}
    User -->|立即更新| Apply[idle guard 後送 SKIP_WAITING<br/>再重整]
    User -->|稍後| Continue
    Apply --> Continue

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef ui fill:#efeafa,stroke:#7a5cb8,stroke-width:1.4px,color:#2b1d4d;
    class Apply local
    class Banner ui
```

## 大版本切割

```mermaid
graph LR
    subgraph V1[v1.x 玩家]
        A[玩家 A v1.2]
        B[玩家 B v1.5]
    end

    subgraph V2[v2.x 玩家]
        C[玩家 C v2.0]
        D[玩家 D v2.1]
    end

    A -.可以對戰.- B
    C -.可以對戰.- D
    A -.major 不同.-x C
    B -.major 不同.-x D

    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class V1 chain
    class V2 consensus
```

## Service Worker 生命週期

```mermaid
stateDiagram-v2
    [*] --> Installing: 首次訪問
    Installing --> Installed: assets 全部 cache
    Installed --> Activated: 第一次啟用
    Activated --> Idle: 服務中

    Idle --> CheckUpdate: 重新訪問 / 手動檢查
    CheckUpdate --> Idle: 無新版
    CheckUpdate --> NewInstalling: 有新 SW

    NewInstalling --> Waiting: 新 SW 等待啟用
    Waiting --> NewActivated: UI idle guard 發 SKIP_WAITING

    NewActivated --> Idle: 新版運行
```

## 升版風險決策

```mermaid
flowchart TD
    Change[要修改的內容] --> Type{變更類型}
    Type -->|Bug fix 不影響 deterministic| Patch[Patch v1.2.x]
    Type -->|新功能 不影響 deterministic| Minor[Minor v1.x]
    Type -->|破壞 deterministic 或 protocol| Major[Major v2.0]

    Patch --> Easy[輕鬆升版<br/>玩家同 major 相容]
    Minor --> Easy
    Major --> Hard[切割社群<br/>只保留規範定義的短寬限]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    class Easy local
    class Hard consensus
```
