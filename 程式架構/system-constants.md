---
type: impl
domain: []
summary: 四層常數套件結構／Brand 型別／economy-config runtime／不變式 CI
authority: null
slug: null
---

# system-constants（常數套件實作）

> **本檔角色**：`@open4wd/system-constants` 套件的**實作層** —— 四層結構、`as const` 凍結、Brand 型別、統一匯出、economy-config runtime、不變式 CI。
> **各 namespace 常數值的內容權威在 [程式參數各分冊](../程式參數.md)**（根頁只提供導覽，本檔不重列數值）；一致性級別 / 變更流程見 [共通規則.md §1](../程式參數/共通規則.md#1-一致性級別)·[§20](../程式參數/共通規則.md#20-變更流程)。對應 `src/system-constants/`。

## 1. 套件結構

```text
@open4wd/system-constants
├── protocol/         ← 跨 peer 共識必須一致（變更 → protocol major bump）
├── network/          ← sync＝協定綁定（major）；signaling/discovery＝連線策略；providers＝公開服務觀測
├── ui/               ← 純客戶端
└── economy-config/   ← 治理 signer 數量的純計算 helper；不保存 config shape／預設值（§4）
```

常數物件以 `Object.freeze()` / `as const` 凍結並搭配必要的 `type` / `interface`，**全 readonly、禁 runtime mutation**；純 helper 不複製 runtime domain model。各層分類與一致性級別見 [共通規則.md §1](../程式參數/共通規則.md#1-一致性級別)。

## 2. Brand 型別

以 TypeScript Brand types 區分量化單位 / 識別符，編譯期阻擋「把 Mm 當 cm」「把 X100 當 X1000」之類錯誤：`ProtocolVersion` / `NetworkVersion` / `ClientVersion` / `EconomyConfigEpoch` / `Mm` / `Gram` / `X1000` / `X100` / `MinorUnits` / `PeerId` / `CID` / `Signature`。完整定義與建構工具（`mm()` / `grams()` …）見 [共通規則.md §19.1](../程式參數/共通規則.md#19-型別系統--不變式ci-強制檢查)。

## 3. 統一匯出

```typescript
// @open4wd/system-constants/index.ts
export * as Protocol from "./protocol";
export * as Network from "./network";
export * as UI from "./ui";
export * as EconomyConfig from "./economy-config";
export type {
  ProtocolVersion,
  NetworkVersion,
  ClientVersion,
  EconomyConfigEpoch,
  Mm,
  Gram,
  X1000,
  X100,
  MinorUnits,
  ConsistencyLevel,
};
```

使用（**禁 hardcode，一律從套件取**）：

```typescript
import { Protocol, Network, UI } from "@open4wd/system-constants";
Protocol.matchmaking.PLAYERS_PER_RACE_MAX; // 8
Network.sync.ROLLBACK_FRAME_BUFFER_DEFAULT; // 見 程式參數/network.md §8
UI.animation.TOAST_DURATION_MS; // 4000
```

## 4. economy-config：runtime 單一 config authority 與純 helper

**live 共識 config ＝ `src/economy/config.ts`**：`EconomyConfig` 介面 ＋`GENESIS_ECONOMY_CONFIG`（genesis 預設）；治理 `config-update` 事件 fold 進 `DerivedState.economyConfig`（**epoch 化**——fold 至任一位置即該位置生效值，每次更新 epoch +1；[ledger-checkpoint.md §2](ledger-checkpoint.md)／[ledger.md §8](ledger.md)）；讀點 ＝`DerivedState.economyConfig`（無獨立 getter）。

**套件 `economy-config/` 只保留 signer 數量的純 quorum helper**。`revShare`、`governanceSigners` 與其他治理欄位一律在真正的 runtime config 上驗證；消費端只讀 `DerivedState.economyConfig`，CI 直接驗這份 runtime config，且只能有這一份 config shape。

`EconomyConfig` 介面 / 預設值（政策參數 revShare / forkDetection + 經濟值群組 match_prize / creator_royalty / upload_costs 等）見 [economy-config.md §17](../程式參數/economy-config.md#17-economy-configorbitdb-動態治理)（單一 authority；**newcomer / reputation 為 protocol 常數、不在 config**——[§17.3](../程式參數/economy-config.md#173-注意事項) 治理可調鐵則）；治理事件見 [ledger.md §8](ledger.md) · [governance（資料系統治理事件）](../資料系統.md)。

## 5. 不變式（CI `pnpm run check:invariants`）

編譯期 + 執行期雙重檢查（revShare 三層總和 = 100（pct 整數）、vehicle mass min < max、rollback buffer min ≤ default ≤ max、players min ≤ max ≤ hardcap、consensus anchor 收集窗可容納四個以上 fallback slots、治理 signer set 僅允許 N=1 或 N>=3 且 quorum 分別為 1／`floor(2N/3)+1` 等）；摘錄與實作連結見 [共通規則.md §19.2](../程式參數/共通規則.md#19-型別系統--不變式ci-強制檢查)，完整清單以 `src/system-constants/invariants.ts` 為執行權威。CI fail → 阻擋 merge。

## 6. 跨模組對接

| 模組                          | 對接                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| [程式參數各分冊](../程式參數.md) | **各 namespace 常數值的內容權威** + Brand 型別 + 不變式 + 變更流程 |
| [ledger.md](ledger.md)        | economy-config OrbitDB 讀取 / multisig                               |
| [版本規範.md](../版本規範.md) | `protocol/` 變更 → protocol major bump；`ui/` patch                  |
| 各 `程式架構/*` 模組          | 從套件取常數（physics / sync / signaling / matchmaking / security…） |
