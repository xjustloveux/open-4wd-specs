---
type: impl
domain: ["建模物理"]
summary: builtin 命名空間／物理烘焙 extras 同 UGC／公版清單
authority: null
slug: null
---

# builtin-assets（公版資產實作）

> **本檔角色**：公版（builtin）資產的**實作層** —— `builtin:*` ID 命名空間、Canonical PhysicsManifest（同 UGC）、版本控管、公版清單、fork / economy 整合、維護。
> 公版零件 / 場地的**物理參數 schema** 同 UGC（見 [建模參數.md](../建模參數.md)），公式見 [算式表.md](../算式表.md)；具體數值由維護者校準（[其他.md §1](../其他.md) 待 playtest）。對應 `src/builtin-assets/`（GLB 於 `public/assets/builtin/`）。

## 1. ID 命名空間

```text
builtin:<type>-<id>          // 例 builtin:chassis-01 / builtin:chip-01 / builtin:track-01
```

`<type>` = 8 類零件（`chassis / body / tire / motor / battery / roller / chip / weapon`）+ `track`。**ID 不重複使用**：移除一個公版只允許「不顯示但保留 ID」（標 `deprecated: true`），不可重指到新內容（會破壞舊存檔）。

## 2. 整車組合引用

loadout 的 part references 可為 CID 或 `builtin:*`：

```typescript
interface VehicleLoadout {
  chassis: CID | BuiltinId;
  body: CID | BuiltinId;
  tires: ReadonlyArray<CID | BuiltinId>; // 4
  motor: CID | BuiltinId;
  battery: CID | BuiltinId;
  rollers: ReadonlyArray<CID | BuiltinId>; // 0~多
  chip: CID | BuiltinId;
  weapon?: CID | BuiltinId;
  passiveWeightSplitPct?: number; // 僅 passive 武器可帶（0–100、預設 50）：加持分配，車輛組裝.md §3.5
}
type BuiltinId = `builtin:${string}`;
const isBuiltin = (ref: CID | BuiltinId): ref is BuiltinId =>
  ref.startsWith("builtin:");
```

## 3. 物理參數：GLB 烘焙 extras（同 UGC）

公版零件 / 場地與 UGC **完全相同**：一樣經 canonical finalizer 從幾何、材質、合法 empties 與已驗作者宣告建立並嵌入完整 `PhysicsManifest`，過同一套 Stage 3／獨立重建驗證；runtime 只消費 typed manifest，不直接讀 `auto_*` extras。**唯一差別＝發佈管道**：UGC 上傳鏈拿 CID 與 manifest reference；公版隨 client 出貨、由受版控 manifest 的 SHA-256／CID／extrasHash 與啟動檢查建立信任，且不上鏈。

**一致性 / 防作弊**由 peer 端 `builtin-assets CID 比對` + 配對 `builtin_assets_version` + embedded manifest digest 保證（[§7](#7-維護)、[D-20260811-02](../decisions/D-20260811-02-Canonical-PhysicsManifest與一次性Admission.md)）。公版與 UGC 共用同一 typed runtime boundary，不存在 builtin extras 快速通道。

## 4. 版本控管

| 規則                                                     | 內容                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 版本欄位                                                 | `builtin_assets_version`（6 版本欄位之一，見 [版本規範.md](../版本規範.md) / [versioning.md](versioning.md)） |
| bump 時機                                                | 任一公版 GLB 的 manifest digest／材質／碰撞／正式物理輸入變動 → 連帶 `client_version` major bump              |
| ID 新增                                                  | 不算 bump（舊版收到 unknown ID 視為缺資源 → 不配對）                                                          |
| 純視覺變動（只動 visual mesh / texture，不動烘焙物理值） | 不 bump                                                                                                       |

CI 監看 `assets/builtin/` GLB 烘焙 extras：物理值變動但 PR 未 bump `builtin_assets_version` → build fail（純視覺變動免 bump；偵測 ＝ 比對烘焙 extras）。

Pre-launch current builtin 與 PhysicsManifest 基線維持 v1；27 個公版 GLB 已嵌入完整 current
PhysicsManifest（場地與車輛純視覺 fragment descriptors＋逐 tire region wear capacity＋能量域熱＋六軸
aero＋typed weather exposure／track entities＋part collider proxies＋intact collider 六向接觸面積）並同步
SHA-256／CID／extrasHash provenance。公版 GLB 目前仍是功能／流程用半成品，只驗證契約與 synthetic
reference，不作平衡基準；專案尚未公開，不保留舊 bytes 相容層，正式公開時才凍結當時 bytes／provenance。

## 5. 公版清單（24 零件 + 3 場地）

24 = 8 類 × 3 變體（speed / heavy / control archetype；**變體編號 ＝ 表列序**：`-01` speed／`-02` heavy／`-03` control，場地同法 `track-01` practice／`track-02` speed／`track-03` combat）；具體數值由編輯器 author 並烘進各公版 GLB，設計方向如下：

| 類      | speed                                 | heavy                                                 | control                                                           |
| ------- | ------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| chassis | 輕量低 mass、Mount_Motor 後置         | 重型高 mass、roller mount 齊全、前置重心              | 平衡中 mass、前後對稱                                             |
| body    | 流線低 drag、微下壓                   | 重裝甲高 drag、高耐撞                                 | 通用中 drag                                                       |
| tire    | 光面胎面 + rubber（高摩擦軟胎）       | 越野花紋 + 硬橡膠（耐磨）                             | 通用淺花紋、平衡                                                  |
| motor   | 大體積、torque_ratio 偏低（偏速）     | 大體積、torque_ratio 偏高（偏扭矩）                   | 中體積、torque_ratio 50                                           |
| battery | 高 configured_output_w                | 大容量 auto_energy_capacity_mj                        | 平衡                                                              |
| roller  | 小尺寸低摩擦                          | 大尺寸中摩擦                                          | 中尺寸平衡                                                        |
| chip    | `[{boost,50},{brake,20},{weapon,30}]` | `[{slam,40},{stabilize,20},{weapon,40}]`              | `[{stabilize,30},{swerve_left,20},{swerve_right,20},{weapon,30}]` |
| weapon  | passive 輕型撞角                      | active general（1 轉子 actuator、max_angle 360 連旋） | active launch（釘刺，子節點 array 序 = 發射序）                   |

chip skill slots 上傳時 bake 進 GLB、上鏈後 immutable，各 slot `allocation_pct` 總和 ≤ 100（[算式表.md §3](../算式表.md)）；slot 數由 volume 階梯決定（`CHIP_SLOT_VOLUME_THRESHOLDS_M3`，[protocol.md §3](../程式參數/protocol.md#3-protocolugcugc-規格約束)）→ 公版 chip canonical 尺寸需達標（speed / heavy 3 槽 ≥ 3 cm³、control 4 槽 ≥ 6 cm³）。場地 3 個：`track-01` practice（橢圓/直線、3–5 checkpoint）/ `track-02` speed（中長競速、6–10）/ `track-03` combat（多障礙、5–8）。新玩家可組 Speed / Heavy / Control 三套完整 build，亦可混搭。

## 6. fork / economy 整合

- **不可 fork**：`uploadAsFork` 拒 `parentCid.startsWith('builtin:')`（公版不在 ledger）；「以公版改良」走自動相似度判定（[ugc-fork.md](ugc-fork.md)）。
- **創作回饋金跳過公版**：`collectAllUgcUsedInMatch` filter 掉 `builtin:*` → 公版不鑄幣、不消耗全網預算（[economy.md](economy.md)）。
- **贊助拒收公版**、**上鏈費不適用**（公版不上鏈，玩家使用完全免費）。

## 7. 維護

原始 authoring GLB 與 shipped canonical GLB 分權：specs 受版控的
`美術資源/authoring-source-manifest.json` 是 GLB desired-state 身分表；immutable Release 的
`authoring-release-manifest.json`、`SHA256SUMS` 與 Release assets 是公開 bytes 權威。Release
manifest 的每個 GLB input 必須攜帶相同 `assetId`，main 的
`scripts/builtin-assets/authoring-manifest.json` 則只保存 Editor recipe 與 output provenance，三方以
`sourceAssetId`／`assetId` exact-set join。Main dependency lock 必須同時鎖 exact specs commit、
`authoring-source-<commit 前 12 碼>` tag、source manifest fingerprint／檔案 SHA-256 與 Release
manifest SHA-256；adoption gate 再驗 Release manifest 的 source commit、全部 asset mapping、
下載檔案集合、size／SHA-256 與 `SHA256SUMS`，通過後才跑 production Editor journey。不得把
canonical bytes 回填為 source，也不存在舊式 candidate epoch tag 或 Git LFS pointer 採用路徑。
每筆 recipe 另明示 `textureMaxEdgePx`，part 再明示 `partTriangleTarget`；目前 reviewed profile 為
part 128px／6k、track 256px。兩值只控制 canonical 輸出容量與視覺細節，不能寫死在壓縮或減面
判斷裡，也不構成材質、物理、尺寸或造型准入限制。

公版變更（新增 / 調整 / deprecate）走**純 client 發版** —— 公版在 git、不在鏈上，同物理常數 / 材質數值（build-time 資產、不走治理、無鏈上事件）。編輯器 re-author → 匯出新 GLB → PR → CI → 推版生效；操作流程見 [流程/升版.md §8.3](../流程/升版.md)。與 UGC GLB 的鏈上提交流程**無關**。

| 操作               | 流程                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| 新增 / 調整數值    | 編輯器 author → 匯出 GLB → PR → 推版（`builtin_assets_version` + client major） |
| 修 visual 不改數值 | 替換 GLB → PR → 推版（玩家自動更新、不 bump）                                   |
| 移除               | **不允許**；標 `deprecated: true` 隱藏但保留 ID 與檔案                          |

首次公開前的最終公版須由 production Editor 手動 author／匯出並通過同一套 strict gate；這些替換仍
維持 v1。本地測試者精確清除 Open4WD asset cache 或使用 `/reset/`，不得用虛增
`builtin_assets_version` 代替開發期 cache 操作。
`OPEN4WD_BUILTIN_AUTHORING=1` 預設只把測試成品寫到 Playwright `test-results`；只有維護者手動再加
`OPEN4WD_BUILTIN_WRITE=1` 才可寫入 `public/assets/builtin`。CI、一般驗證與 agent 執行不得自行開啟
寫入旗標，測試通過也不等於已替換正式公版。

> **CI 機械檢核取代人工授權**：GLB extras 合法（同 UGC Stage 3 validator）、`assets/builtin/` 物理烘焙值變動必 bump `builtin_assets_version`（path-based，比照 [版本規範.md §13](../版本規範.md) 對 material-params 的不變式）。「數值平衡是否合理」屬人類判斷 → PR review（與物理常數同標準）。公版**一致性** enforcement 由 peer 端 `builtin-assets CID 比對` + 配對 `builtin_assets_version` 保證（[版本規範.md §7](../版本規範.md)），不需鏈上事件。

Public 出貨 manifest 每筆必須帶 `sha256`、真實 IPFS `cid`、canonical root `extrasHash` 與等於全局 `BUILTIN_ASSETS_VERSION_CURRENT` 的 `assetsVersion`；runtime fetch 後同時重算 SHA-256 與 CID，任一不符即拒絕使用。GLB 不得引用外部 buffer / image URI，PNG 必須有合法 signature／IHDR／ 尺寸，KTX2 必須有合法 signature／ 尺寸；場地紋理僅允許 KTX2，避免未壓縮 PNG 進入大型場地。`check:release-assets --strict` 會對缺檔、不完整 manifest、bytes／extras／ 版本不匹配全部 fail closed；27 個實體 GLB 未交付前只可在非 strict 開發檢查延後。

公版設計為「平庸但能跑」基準線（鼓勵改良超越）；調整向後相容（不可移除 / 不可改 ID）。GLB `assets/builtin/{parts,tracks}/`（24+3 檔）**出貨預算分級**：

- **零件 ≤ 112KiB／檔**：視覺網格 ≤ 8K tri（迷你四驅零件充裕）；公版純色設計 → **免點陣紋理**（材質色／頂點色）、必要時 ≤ 256²。超過原 100KiB 的額度只供完整 PhysicsManifest／deterministic physics metadata，不作提高視覺複雜度的額度
- **場地 ≤ 500KB／ 檔**：visual ≤ 50K tri、紋理 ≤ 1024 KTX2
- **總計 ≤ 4MB**（cache-first lazy、不進首載 precache，見 [pwa-offline.md](pwa-offline.md)）

管線：Tripo3D 生成高模 → decimate／retopo 至目標面數 → 紋理策略 → Draco＋KTX2 → **CI 驗 per-file 上限**（機器可驗）。[美術資源/提示詞/零件參考圖.md](../美術資源/提示詞/零件參考圖.md) 的「50K 面 ＋1024 紋理」為**生成階段高模建議值、非出貨值**。

## 8. 跨模組對接

| 模組                                                           | 對接                               |
| -------------------------------------------------------------- | ---------------------------------- |
| [建模參數.md](../建模參數.md) · [材質表.md](../材質表.md)      | 物理參數 / 材質 schema             |
| [算式表.md](../算式表.md)                                      | chip allocation_pct / 物理公式     |
| [versioning.md](versioning.md) · [版本規範.md](../版本規範.md) | `builtin_assets_version` bump 規則 |
| [ugc-fork.md](ugc-fork.md)                                     | 公版不可 fork                      |
| [economy.md](economy.md)                                       | 公版跳過鑄幣 / 贊助 / 上鏈費       |
