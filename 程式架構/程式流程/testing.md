---
type: impl-flow
domain: []
summary: 程式級流程圖：CI matrix／Fuzz／跨瀏覽器
authority: 程式架構/testing.md
slug: null
---

# Testing

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [testing.md](../testing.md) | [程式架構](../../程式架構.md) · [升版](../../流程/升版.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## 測試層與 runner

```mermaid
graph TB
    subgraph 測試層
        Unit[Unit<br/>Angular unit-test builder + Vitest]
        Int[Integration<br/>Vitest node environment + libp2p memory]
        E2E[E2E<br/>Playwright]
        Det[Determinism<br/>Cross-browser/OS harness]
    end

    Unit --> Int
    Int --> E2E
    Unit --> Det
    E2E --> Det

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Unit,Int local
    class E2E consensus
    class Det fail
```

## CI 觸發流程

```mermaid
flowchart TD
    Event{觸發事件}

    Event -->|master push / PR| CI[validate + unit + integration + E2E<br/>+ canonical assets gate]
    Event -->|nightly schedule / 手動| Night[fuzz + performance<br/>+ canonical assets perf]
    Event -->|workflow_dispatch| Release[determinism + perf + deployment assets<br/>+ production build + E2E]

    CI --> Result{結果}
    Night --> Result
    Release --> Result

    Result -->|綠| Pass[繼續]
    Result -->|紅| Block[阻擋]
    Result -->|效能退化落在警告區間| Warn[警告但通過<br/>依正文門檻判定]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Pass local
    class Warn consensus
    class Block fail
```

## 確定性測試流程

```mermaid
sequenceDiagram
    participant Test as Test Runner
    participant Browser1 as Chromium
    participant Browser2 as Firefox
    participant Browser3 as WebKit
    participant Fixture as 期望 Checksum

    Test->>Browser1: 跑固定 seed 與 frame 數的 sim
    Browser1->>Test: checksum_chromium

    Test->>Browser2: 跑相同 sim
    Browser2->>Test: checksum_firefox

    Test->>Browser3: 跑相同 sim
    Browser3->>Test: checksum_webkit

    Test->>Fixture: 比對

    alt 全部一致
        Fixture->>Test: ✅ PASS
    else 任一不同
        Fixture->>Test: ❌ FAIL + diff trace
        Test->>Test: 阻擋 release
    end
```

## 8 Peer Mesh 壓測

```mermaid
graph TB
    Setup[啟動完整 in-memory peer 集合]
    Setup --> Mesh[建立 full mesh]
    Mesh --> Assert[驗證全部 pairwise connections]
    Assert -->|全部建立| Pass[PASS]
    Assert -->|任一缺席| Fail[FAIL]

    Note["此 in-process memory proof 不模擬<br/>packet loss、latency 或賽事流量"]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Pass local
    class Fail fail
```

## Fuzz 流程

```mermaid
flowchart TD
    Start[fuzz runner 啟動] --> Gen[fast-check 隨機產生 input]
    Gen --> Run[呼叫 sanitizer / protocol parser]
    Run --> Result{結果}

    Result -->|throw| Bug[找到 BUG]
    Result -->|crash| Bug
    Result -->|hang > timeout| Bug
    Result -->|ok| Continue[繼續]

    Bug --> Shrink[fast-check shrink<br/>找最小 repro]
    Shrink --> Save[存到 corpus]
    Save --> Report[輸出本機可重現報告<br/>由維護者審閱]

    Continue --> Loop{達到 budget？}
    Loop -->|否| Gen
    Loop -->|是| Done[結束]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Done local
    class Bug fail
```

## Coverage 門檻流程

```mermaid
graph LR
    Run[pnpm test:coverage] --> Core[coverage-core gate]
    Run --> Pages[coverage-pages gate]
    Run --> Bootstrap[coverage-bootstrap-adapters gate]

    Core --> Check{三個 gate 全數通過?}
    Pages --> Check
    Bootstrap --> Check
    Check -->|否| Fail[CI Fail]
    Check -->|是| Pass[Coverage gate Pass]

    Pass --> Report[保留 CI coverage artifact]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Pass local
    class Fail fail
```

## 私密漏洞重現與公開 regression test

```mermaid
sequenceDiagram
    participant Reporter
    participant Private as 私密通報管道
    participant Maintainer
    participant Isolated as 隔離重現環境
    participant PR as 公開 PR
    participant CI as 一般 CI

    Reporter->>Private: 私下提交漏洞與重現資料
    Private->>Maintainer: 通知並協調補充資訊
    Maintainer->>Isolated: 在私密隔離環境驗證

    alt repro 成功
        Isolated->>Maintainer: 確認漏洞並修復
        Maintainer->>Private: 私下回覆結果與揭露時程
        Maintainer->>PR: 修復或協調揭露後提交去敏 regression test
        PR->>CI: 執行一般測試
        CI->>PR: 回報 regression 結果
    else repro 失敗
        Isolated->>Maintainer: 無法重現
        Maintainer->>Private: 私下請求補充細節
    end
```

## 測試環境隔離

```mermaid
graph TB
    Host[CI Runner]

    subgraph Test 1
        IDB1[Memory store／手寫 IDB port fake]
        WRTC1["@libp2p/memory transport"]
        Time1[fake timers]
    end

    subgraph Test 2
        IDB2[Memory store／手寫 IDB port fake]
        WRTC2["@libp2p/memory transport"]
        Time2[fake timers]
    end

    Host --> Test1
    Host --> Test2

    Note["每個 worker 獨立<br/>避免狀態洩漏"]

    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Test1,Test2 chain
```

## Perf Baseline 比對

```mermaid
flowchart LR
    PR[新 PR] --> Bench[跑 Perf 基準]
    Bench --> Compare{對比 baseline}

    Compare -->|低於警告門檻| Green[✅ 通過]
    Compare -->|警告區間| Yellow[⚠️ 警告但通過]
    Compare -->|超過阻擋門檻| Red[❌ 阻擋 merge]

    Red --> Investigate[調查退化原因]

    Yellow --> Note[寫入 PR comment]

    Green --> Update[可選：更新 baseline]

    Thresholds["讀取正文的門檻與校準規則"]

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef fail fill:#fae9e7,stroke:#b4544a,stroke-width:1.4px,color:#471d18;
    class Green local
    class Yellow consensus
    class Red fail
```

## 測試資料生命週期

```mermaid
graph TB
    Source[測試資料來源] --> Type{類型}

    Type --> Fixtures[Fixtures<br/>git-tracked]
    Type --> Generated[Generated<br/>at-runtime]
    Type --> Recorded[Recorded<br/>從真實比賽]

    Fixtures --> Use[測試使用]
    Generated --> Use
    Recorded --> Use

    Use --> Update{需更新？}
    Update -->|fixture 過期| RegFix[重新產出]
    Update -->|new feature| AddFix[新增]

    RegFix --> Source
    AddFix --> Source

    classDef local fill:#e8f3ec,stroke:#3f8f5f,stroke-width:1.4px,color:#173525;
    classDef consensus fill:#fdf3df,stroke:#c08a2d,stroke-width:1.4px,color:#3d2c0d;
    classDef chain fill:#e7eefb,stroke:#3f6bb0,stroke-width:1.4px,color:#152848;
    class Recorded local
    class Generated consensus
    class Fixtures chain
```
