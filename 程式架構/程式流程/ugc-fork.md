---
type: impl-flow
domain: ["UGC版權"]
summary: 程式級流程圖：指紋判定／Fork 樹
authority: 程式架構/ugc-fork.md
slug: null
---
# ugc-fork

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [ugc-fork.md](../ugc-fork.md) | [UGC 機制](../../UGC機制.md) · [衍生](../../流程/衍生.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
> Fork 偵測的**技術流程圖**（兩階段判定 / 物理指紋對照 / 決策樹 / 指紋版本）。模組實作見 [ugc-fork.md](../ugc-fork.md)；Fork 衍生樹 / 分潤等業務流程見 [流程/衍生.md](../../流程/衍生.md)。

## 兩階段判定流程

```mermaid
flowchart TD
    Start[上傳請求] --> NearestSearch[在 ledger 找最近 AABB 候選]
    NearestSearch --> Loop{有候選?}
    Loop -->|否| PassOrigin[視為原創<br/>pass-through]
    Loop -->|是| Stage1[Stage 1<br/>幾何快篩]
    
    Stage1 --> GeoDiff{幾何差異達門檻?}
    GeoDiff -->|是| Next[下一個候選]
    Next --> Loop
    GeoDiff -->|否| Stage2[Stage 2<br/>分組物理指紋]
    
    Stage2 --> ByType{零件類型}
    ByType -->|chassis/body/weapon| Rigid[剛體指紋]
    ByType -->|tire/roller| Rolling[滾動指紋]
    ByType -->|motor/battery| Functional[功能指紋<br/>mesh + sidecar]
    ByType -->|chip| Chip[chip 指紋<br/>mesh + skill]
    ByType -->|track| Track[場地多維指紋]
    
    Rigid --> Classify[雙標準分類]
    Rolling --> Classify
    Functional --> Classify
    Chip --> Classify
    Track --> Classify
    
    Classify --> Action{差異範圍}
    Action -->|< strict| ForceFork[強制 fork]
    Action -->|strict-loose| SuggestFork[提示 fork<br/>玩家自選]
    Action -->|≥ loose| Pass[直通]
    
    Pass --> Next
    SuggestFork --> Done[上傳完成]
    ForceFork --> ForkFlow[標 parent CID]
    ForkFlow --> Done
    PassOrigin --> Done
    
    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class PassOrigin,Pass local
    class SuggestFork consensus
    class Done chain
    class ForceFork fail
```

## 5 組指紋對照

> 欄位定義與差異計算（rigidDiff 取最大分量 / functionalDiff・chipDiff OR 邏輯）見 [程式架構/ugc-fork.md §3](../ugc-fork.md)；物理量一律整數量化（mg / μm / μm² / μm³）。

```mermaid
graph TB
    subgraph 剛體類
        Rigid[mass_mg / com_um xyz<br/>inertia_mg_um2 xyz / surfaceArea_um2]
        Rigid --> ChassisX[chassis: 無補充]
        Rigid --> BodyX[body: frontalArea_um2]
        Rigid --> WeaponX[weapon: weaponBranchHash<br/>（mechanism / main_mesh_node /<br/>max_angle_deg 雜湊）]
    end
    
    subgraph 滾動類
        Rolling[mass_mg / radius_um / width_um<br/>rollingInertia_mg_um2]
        Rolling --> RollingX[tire / roller: 皆無補充<br/>（胎面由 mesh + material 反映）]
    end
    
    subgraph 功能類
        Functional[mesh: mass_mg + volume_um3]
        Functional --> MotorS[motor sidecar:<br/>torqueRatio_pct]
        Functional --> BatteryS[battery sidecar:<br/>configuredOutputW]
    end
    
    subgraph chip
        Chip[mesh: mass_mg + volume_um3<br/>skill: slotCount + skillSlots<br/>（skill + allocationPct、字母排序）]
    end
    
    subgraph 場地類
        Track[pathLength_mm / avgWidth_mm<br/>turnCount / surfaceArea_mm2<br/>elevationRange_mm / checkpointCount]
    end
    
    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Rigid chain
    class Rolling,Functional,Track consensus
    class Chip local
```

## 雙標準決策樹（單一指紋類型）

```mermaid
flowchart LR
    Diff[物理指紋差異] --> A{< strict?}
    A -->|是| Force[強制 fork<br/>標 parent CID]
    A -->|否| B{< loose?}
    B -->|是| Suggest[提示 fork<br/>玩家可選獨立 or fork]
    B -->|否| Pass[通過<br/>視為原創]
    
    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Pass local
    class Suggest consensus
    class Force fail
```

## OR 邏輯（功能類、chip）

```mermaid
flowchart TD
    Start[功能類 fingerprint] --> Calc[計算 mesh diff + sidecar diff]
    Calc --> Check1{任一 ≥ loose?}
    Check1 -->|是| Pass[視為原創]
    Check1 -->|否| Check2{兩者皆 < strict?}
    Check2 -->|是| Force[強制 fork]
    Check2 -->|否| Suggest[提示 fork]
    
    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Pass local
    class Suggest consensus
    class Force fail
```

## fingerprint version 流程

```mermaid
flowchart TD
    UpgradeAlgo[fingerprint 算法升級<br/>version v1 → v2] --> NewUpload[新 UGC 用 v2 計算]
    UpgradeAlgo --> OldKeep[既有 UGC 仍標 v1<br/>不重算]
    
    NewUpload --> Compare{比對候選}
    OldKeep --> Compare
    Compare --> SameVer{同版本?}
    SameVer -->|是| Match[正常分組比對]
    SameVer -->|否| PassThrough[跨版本 pass-through<br/>視為原創]
    
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class UpgradeAlgo consensus
    class PassThrough chain
```
