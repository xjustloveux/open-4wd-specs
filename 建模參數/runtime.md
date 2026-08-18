---
type: registry
domain: ["建模物理"]
summary: Stage type 定案、處理流程與預設填補原則
authority: null
slug: null
---

# Stage runtime

> 本檔是建模參數的分冊 authority；穩定總入口與既有章節錨點見 [建模參數.md](../建模參數.md)。

## 10. Stage 對應的處理流程

```text
Stage 1（上傳）：
  - UI 先選 type → 上傳 GLB
  - 寬鬆檢核（GLB 合法）
  - type 定案：GLB 幾何解析 vs UI 選的 type 比對（5 種情況見 §10.1）；定案後 type 即鎖，Stage 2 / 上鏈皆不可改

Stage 2（編輯）：
  - 自動算第一波：volume / mass / bbox / centroid / surface_area / watertight / provisional uniform fit guidance / decimate
  - 玩家設 GLB extras（零件依 [建模參數/零件與共用介面.md §2–§3](零件與共用介面.md)、場地共用欄位依 [建模參數/零件與共用介面.md §2](零件與共用介面.md)、場地專屬依 [建模參數/場地.md §8–§9](場地.md)；type 已於 Stage 1 定案）
  - 玩家 Mount empty 拖放（chassis 自訂位置 + weapon part-side）
  - 武器機制設定 + Axis / Pivot empty
  - 預設填補（有值用值，沒值給預設）
  - 場地 lap_mode 自動推斷
  - destructible UI 互斥檢查

Stage 3（本機儲存／匯出／上鏈共用）：
  - 自動算第二波：Voronoi 預烘焙 / aero 六軸面積＋各向壓力中心 / typed exposure / `auto_feature_deviations` 介面特徵絕對公差 /
    thermal_limit weakest 合成 / schema 嚴格檢核
  - 寫入 [版本規範.md §15](../版本規範.md) 的 current `open4wd_version` 與完整 current PhysicsManifest／version／digest，Draco／KTX2 壓縮並重驗；本機儲存與上鏈取得同一 canonical bytes
  - 匯出出口由 canonical bytes 產生移除 marker／manifest／`auto_*` 的可編輯衍生 GLB
  - 上鏈出口另寫 IPFS + ledger
  - CID 鎖死，GLB extras immutable
```

詳見 [UGC機制.md](../UGC機制.md)。**版本升級 / 遷移流程**（三分類、鏈式、降版本、yank）見 [版本規範.md B 軸 §17–§22](../版本規範.md) 與 [UGC機制.md](../UGC機制.md)。

### 10.1 Stage 1–2 — type 定案判定

下表只適用於**沒有 current `open4wd_version` marker 的 fresh import**：type 由 **UI 選擇** 與 **GLB 幾何解析** 共同定案；GLB extras 內既有的 `type`（若有）僅為輔助，**以 UI 選擇 + 幾何解析為準**。已有 current marker 的 canonical reopen／fork 以其精確 `type` 為身分權威，不走下表，也不得由 UI 覆寫。fresh import 定案後 type 即鎖，Stage 2 與上鏈皆不可改（要換 type = 重新上傳）。

> **「幾何解析符合」的操作性定義 = 「UI 所選 type 的必要解析產物全部可取得」**（非外觀分類）：每個 type 都有一串「僅能透過解析 GLB 取得」的資料——即本表各 type 標 `required ✅` 的解析產物（[§4](零件與共用介面.md#4-glb-root-extras--系統自動算出欄位auto_) required 慣例：幾何 / 質量類恆需算得出）；任一無法取得（**含備援路徑失敗**）→ 不符、上傳失敗，提示**指明缺何產物**（例：「mesh 非封閉且 voxelization 備援失敗，無法取得體積」）。**檢核時點**：Stage 1 source admission 只檢結構、資源上限與有限座標；`volume` 於 Stage 2 wave A 實算（[§10](runtime.md#10-stage-對應的處理流程)），備援皆失敗 → **視同 type 定案失敗退回上傳**（效果同 Stage 1 不符）。AABB、退化面與 per-type 尺度規則一律在來源單位正規化、scene transform 解算與自動 fit 後，以 canonical meter/world geometry 於 Stage 3 檢核。
>
> | 範圍              | Stage 1 source admission                                                                                                                                   |
> | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 共通（所有 type） | GLB 結構合法、≥ 1 mesh、資源量在安全上限內、座標為有限值                                                                                                   |
> | 零件 8 類         | 不套物理尺度；來源單位正規化與 scene transform 解算後，Stage 3 對 canonical meter/world AABB 套 `PART_AABB_MIN/MAX_M`（[protocol.md §3](../程式參數/protocol.md#3-protocolugcugc-規格約束)） |
> | track             | 不套物理尺度；Stage 2 可自動 fit，Stage 3 對 fit 後 canonical meter/world geometry 套場地 AABB 與 `auto_player_max ≥ PLAYERS_PER_RACE_MIN`                 |
>
> **Stage 2 必要解析產物**：wave A 必須取得 `volume`；watertight 積分失敗時走 voxelization 備援，**兩者皆失敗 = type 定案失敗並退回上傳**（[§4.1](零件與共用介面.md#41-所有-part-共用)）。這項要求不屬於 Stage 1 source admission。
>
> 幾何相似的 type（如 battery vs chip 同為小盒）必要產物清單相同 → Stage 1 皆放行，**by design**（UI 選擇即玩家意圖宣告；權威檢核在 Stage 3 嚴格 schema）。新增 part type 時，定義其必要解析產物清單即自動定義 Stage 1 行為。具體演算法（watertight 判定、voxel 解析度、主軸推斷）屬實作層，比照 [§4.2](零件與共用介面.md#42-body-專屬-aero) aero。

| GLB 內含 type? | 幾何解析符合 UI type? | GLB type vs UI type | 結果                                                                               |
| -------------- | --------------------- | ------------------- | ---------------------------------------------------------------------------------- |
| 否             | ✅ 符合               | —                   | 繼續 Stage 2                                                                       |
| 否             | ❌ 不符               | —                   | **上傳失敗** + 提示（**指明缺何解析產物**，見上方定義）                            |
| 是             | ✅ 符合               | 相同                | 繼續 Stage 2                                                                       |
| 是             | ✅ 符合               | 不同                | **以 UI type 覆寫 GLB type** + 提示 + 繼續 Stage 2                                 |
| 是             | ❌ 不符               | —                   | **上傳失敗** + 提示（可註明「GLB 宣告為 X 但幾何不符所選類別」+ 指明缺何解析產物） |

## 11. 「有值用值，沒值給預設」原則

Stage 2 編輯器對所有可選欄位採此策略：

- 玩家在 GLB extras 已填 → 用玩家值
- 未填 → 用預設值（編輯器自動填補，玩家可改）
- 上鏈時嚴格 schema 驗證

數值／限制預設以本文件各 type 欄位表、[程式參數.md](../程式參數.md) 與 schema/generated rules 為權威；builtin assets 只提供可直接使用的公版成品與建模起點，不是所有 UGC 欄位預設值的總表。
