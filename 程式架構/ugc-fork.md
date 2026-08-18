---
type: impl
domain: ["UGC版權"]
summary: 兩階段 fork 偵測／物理指紋／衍生樹 API
authority: null
slug: null
---

# ugc-fork（Fork 偵測 / 物理指紋 / 衍生樹實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/ugc-fork.md](程式流程/ugc-fork.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：fork 的**實作層** —— 兩階段 fork 判定、per-type 物理指紋與差異計算、分類門檻、`uploadAsFork` 流程、衍生樹 API、fingerprintVersion 機制。
> 設計與規則見 [版權.md §3（Fork 樹）/ §5（反複製五層 + fingerprint 標準化）](../版權.md)；分潤拆分（`computeRoyaltyShares` 70/20/10）見 [程式架構/economy.md §4](economy.md)；fork 流程見 [衍生.md](../流程/衍生.md)。對應 `src/ugc-fork/`。
> 物理量一律**整數量化**（mg / μm / μm² / μm³）避免跨 peer 浮點不一致。

## 1. 資料結構

```typescript
interface UGCMetadata {
  type:
    | "chassis"
    | "body"
    | "tire"
    | "motor"
    | "battery"
    | "roller"
    | "chip"
    | "weapon"
    | "track";
  copyright: "self-made" | "cc0" | "authorized";
  authorizationSource?: string;
  fingerprint: PhysicsFingerprint;
  fingerprintVersion: number; // 算法版本，升級 +1（舊作品鎖原版）
  parentCid: CID | null; // null = 原創；'builtin:*' 不可作 parent
  diffStage1?: number;
  diffStage2?: number;
  // mesh 幾何指紋（anti-piracy；出口 B 上傳時寫入）：primary=標準化 SHA-256 hex、
  // features=候選 discovery hint。此欄不可信，只可挑選待驗 CID；exact／分桶評分
  // 與 fork parent 建議只使用完整 GLB 重算後的 verified index。舊事件無欄仍可在
  // 下載使用／檢舉時由 CID GLB 建 verified entry。
  meshFingerprint?: { primary: string; features: Record<string, unknown> };
}

// 衍生血緣（DerivedState；child CID → ancestors）：至多 2 筆 [parent, grandparent]（Q6，見 資料系統 §4.1）
type ForkLineage = ReadonlyMap<CID, ReadonlyArray<CID>>;
// 推導：parentCid===null → 無；否則 [parent]；parent 自身有 parent → [parent, grandparent]（封頂 2）。builtin:* 不入血緣。
```

## 2. 兩階段 fork 判定

**為何兩階段**：純幾何指標與物理行為非線性對應（改幾個關鍵頂點 → 頂點變動小但重心/慣量大變；全身抖動 1mm → 頂點變動大但物理幾乎不變）→ 純幾何有誤殺 + 漏放兩種失敗。故 Stage 1 幾何快篩、Stage 2 物理指紋定案。

```typescript
type ForkDecision =
  | { action: "pass-through" } // 視為原創
  | { action: "suggest-fork"; suggestedParent: CID } // 提示玩家自選
  | { action: "force-fork"; suggestedParent: CID }; // 強制走 fork

async function evaluateForkDecision(
  candidateMesh,
  candidateMetadata,
  config,
  ledger,
): Promise<ForkDecision> {
  const candidates = await ledger.findNearestByAabb(candidateMesh); // AABB 快篩候選集
  for (const parent of candidates) {
    if (
      computeGeometryDiff(candidateMesh, parent.mesh) >=
      config.stage1_geometry.passthrough_threshold
    )
      continue; // 幾何不像 → 下一個
    const physDiff = computePhysicsFingerprintDiff(
      candidateMetadata,
      parent.metadata,
      candidateMetadata.type,
      config,
    );
    const decision = classifyByDiff(physDiff, candidateMetadata.type, config);
    if (decision.action !== "pass-through")
      return { ...decision, suggestedParent: parent.cid };
  }
  return { action: "pass-through" };
}
```

- **Stage 1 幾何快篩** `computeGeometryDiff` = (頂點數相對差 + AABB 三軸最大相對差) / 2；≥ `passthrough_threshold`（預設 10%）→ 視為原創、跳過 Stage 2。
- **Stage 2 物理指紋**：按零件類別走專屬指紋（[§3](#3-物理指紋per-type)）。

## 3. 物理指紋（per type）

```typescript
type PhysicsFingerprint =
  | RigidFingerprint
  | RollingFingerprint
  | FunctionalFingerprint
  | ChipFingerprint
  | TrackFingerprint;

interface RigidFingerprint {
  // chassis / body / weapon
  kind: "rigid";
  mass_mg: bigint;
  com_um: [bigint, bigint, bigint];
  inertia_mg_um2: [bigint, bigint, bigint];
  surfaceArea_um2: bigint;
  frontalArea_um2?: bigint; // body only
  weaponBranchHash?: string; // weapon only：雜湊分支樹宣告（mechanism / main_mesh_node / max_angle_deg）
}
interface RollingFingerprint {
  // tire / roller
  kind: "rolling";
  mass_mg: bigint;
  radius_um: bigint;
  width_um: bigint;
  rollingInertia_mg_um2: bigint; // 胎面由 mesh+material 反映、不另存
}
interface FunctionalFingerprint {
  // motor / battery
  kind: "functional";
  subtype: "motor" | "battery";
  mass_mg: bigint;
  volume_um3: bigint;
  torqueRatio_pct?: number; // motor sidecar
  configuredOutputW?: number; // battery sidecar
}
interface ChipFingerprint {
  // chip（晶片）
  kind: "chip";
  mass_mg: bigint;
  volume_um3: bigint;
  slotCount: number;
  skillSlots: ReadonlyArray<{ skill: SkillId; allocationPct: number }>; // 依 skill 名字母排序
}
interface TrackFingerprint {
  // track
  kind: "track";
  pathLength_mm: bigint;
  avgWidth_mm: bigint;
  turnCount: number;
  surfaceArea_mm2: bigint;
  elevationRange_mm: bigint;
  checkpointCount: number; // 賽道 Checkpoint_<n> 數
}
type SkillId =
  | "boost"
  | "brake"
  | "swerve_left"
  | "swerve_right"
  | "jump"
  | "slam"
  | "stabilize"
  | "weapon";
```

### 差異計算

```typescript
function relDiff(a: bigint, b: bigint): number {
  // 整數相對差（ppm），避免浮點
  const max = a > b ? a : b,
    min = a > b ? b : a;
  return max === 0n ? 0 : Number(((max - min) * 1_000_000n) / max) / 1_000_000;
}
// rigidDiff（chassis/body/weapon）：max(massDiff, comDiff, inertiaDiff, saDiff, extra)；weaponBranchHash 不同 → extra=1.0（強原創訊號取最大分量）
// rollingDiff（tire/roller）：max(mass, radius, width, rollingInertia)
// functionalDiff（motor/battery）：{ meshDiff: max(mass, volume), sidecarDiff: relDiff(torqueRatio | configuredOutputW) } —— OR 邏輯
// chipDiff（chip）：{ meshDiff: max(mass, volume), skillDiff: (slotCountDiff + 對稱差集/2) / max(slotCount) } —— OR 邏輯
// trackDiff：max(pathLength, avgWidth, turnCount, surfaceArea, elevationRange, checkpointCount)；現行不做路徑相似度（中心線提取跨硬體浮點難、賽道門檻高）
```

> **rigidDiff 取最大分量**（非加權平均）：避免「多維小改動」洗掉原創訊號。**functionalDiff / chipDiff 用 OR 邏輯**：mesh（外觀）或 sidecar（功能配置）任一達原創門檻即原創（例：晶片 mesh 沿用但 skill 大改 → 仍原創）。規則權威見 [UGC機制.md §5.3](../UGC機制.md)。

## 4. 分類門檻 `classifyByDiff`

```typescript
// 單值類（rigid/rolling/track）：diff ≥ loose → pass-through；≥ strict → suggest-fork；否則 force-fork
// 雙值類（functional/chip）：mesh 或 sidecar/skill 任一 ≥ loose → pass-through；兩者皆 < strict → force-fork；否則 suggest-fork
```

`ForkDetectionConfig` = **`EconomyConfig.forkDetection`**（治理 multisig 經 `ConfigUpdateEvent` 更新、含於 `EconomyConfig`、隨 `economy_config_version` 版控與配對檢查；[治理事件.md §2.3](../流程/治理事件.md)）。門檻**值**的單一權威是 [economy-config.md §17.2](../程式參數/economy-config.md#17-economy-configorbitdb-動態治理)；本節只定義分類演算法。判定**演算法 / 指紋** `fingerprintVersion` 屬 `derive_logic`（client 發版），與門檻治理分離。

## 5. `uploadAsFork` 流程

```typescript
async function uploadAsFork(
  meshBytes,
  metadata,
  parentCid,
  config,
  ledger,
): Promise<Result<CID>> {
  if (parentCid === null) {
    // 自動判定
    const d = await evaluateForkDecision(meshBytes, metadata, config, ledger);
    if (d.action === "force-fork")
      return error(`與 ${d.suggestedParent} 高度相似，必須走 fork`);
    if (d.action === "suggest-fork")
      return error(`UI_PROMPT_FORK:${d.suggestedParent}`); // UI 詢問玩家
  }
  if (parentCid?.startsWith("builtin:")) return error("公版資產不可被 fork");
  if (parentCid && !(await ledger.getUgc(parentCid)))
    return error("parent CID 不存在");
  const childFp = await physics.computePhysicsFingerprint(
    meshBytes,
    metadata,
    metadata.type,
  );
  if (!childFp.ok) return error("mesh 無法計算指紋");
  const cid = await assetStorage.put(meshBytes);
  await ledger.appendEvent({
    type: "ugc-upload", // UgcUploadEvent；上鏈費只在此 burn（原創／fork 單次收費）
    cid,
    metadata: {
      ...metadata,
      fingerprint: childFp.value,
      fingerprintVersion: config.fingerprint_version,
      parentCid,
    },
  });
  if (parentCid)
    await ledger.appendEvent({ type: "ugc-fork", childCid: cid, parentCid }); // UgcForkEvent；免費血緣宣告
  return ok(cid);
}
```

**現行 production 接線**：`submitToChain` 在寫事件前執行同一矩陣。canonical bytes 若對到既有 ledger root，只把 bytes 補回本機 block store，回 `reusedExisting=true`，不新增 `ugc-upload`、不收費、不建立 self-fork。`parentCid=null` 的原創維持 exact／高相似拒收；非 null 時先由 `validateDeclaredFork` 檢查 parent 存在、同 type、非仲裁黑名單／非 similarity-pending 與修改幅度至少 10%，再只豁免 parent 及既有 ancestors 的相似命中；同時命中無關作品仍依 reject／pending 處理。上傳即接受 Fork，metadata 與 ledger event catalog 不另存逐作品開關（[D-20260808-04](../decisions/D-20260808-04-上鏈UGC一律接受Fork.md)）。

收件端不只信事件自報 physics fingerprint：首次看見 CID 時，content admission 會在隔離 Worker 由完整 finalized GLB 的實際幾何、材質與合法 authored declaration 獨立重建 Canonical PhysicsManifest，並重算 physics fingerprint；manifest version／digest 或 fingerprint 與事件不一致即拒收，內容尚未同步則 defer。驗證成功後必須先保存 `(CID, manifestVersion, manifestDigest)` 本機 receipt，寫入失敗不得發布 admitted manifest；相同 CID 再進場時驗 digest 並命中 receipt 後，才直接使用 typed `AdmittedAsset`。race runtime 不重跑 Wave A/B、也不解析 root/node extras。live admission 與 fold 都執行 declared-parent policy；無效非 null parent 不得靜默降級為原創 record。單一 provider 的 DMCA 案件只影響該 provider 是否供應 bytes，不成為全域 ledger parent 資格。

> 事件 = `UgcUploadEvent`（原創 / fork 都寫，**上鏈費只在此單次 burn**）+ `UgcForkEvent`（僅 fork、免費血緣宣告，欄位僅 `childCid` / `parentCid`、**無 ancestors 欄**）。**血緣 ＝fold derive 自 `UgcUploadEvent.metadata.parentCid`**（[parent, grandparent] 封頂 2 由 state 內 parent 邊推導；事件自報的血緣串不可信、不作依據）。收費權威見 economy.md [§1](economy.md#1-經濟事件)。

## 6. 衍生樹 API + fingerprintVersion

```typescript
interface ForkLineageApi {
  getAncestors(cid: CID): Promise<CID[]>; // 至多 2 層 [parent, grandparent]；更深靠 parent 邊逐跳上溯（資料系統 §4.1）
  getDirectChildren(cid: CID): Promise<CID[]>;
  getDescendantTree(cid: CID, maxDepth: number): Promise<ForkTree>;
  countDescendants(cid: CID): Promise<number>;
}
```

**fingerprintVersion**：算法升級時**舊作品不重算**；只在同版本 fingerprint 間比對，跨版本互比 → `pass-through`（無共同基準、寧放過不誤殺）。

## 7. Edge cases（重點）

| 情境                                         | 處理                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **parent 黑名單 / 退役 / unusable / yanked** | fork 仍存在、分潤照舊（B 作者 70% + A 作者 20%，即使 A 不可用）—— 分潤跟血緣、與可用性正交（[版權.md §3.4](../版權.md)） |
| fork 鏈過深（A→…→G）                         | 分潤只到 [parent, grandparent] 兩層（Q6）；更深不分潤                                                                    |
| 自 fork（A→A'）                              | 允許但無經濟意義（自分潤給自己）                                                                                         |
| 以公版為基礎改良                             | 不可標 builtin 為 parent（不在 ledger）；走 evaluateForkDecision 與真實 UGC 比對                                         |
| 跨 fingerprintVersion 比對                   | pass-through（不誤殺）                                                                                                   |
