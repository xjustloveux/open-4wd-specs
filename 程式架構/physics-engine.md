---
type: impl
domain: ["建模物理"]
summary: Rapier 封裝 DeterministicWorld／固定 timestep／整數量化／determinism
authority: null
slug: null
---

# physics-engine（確定性物理引擎實作）

> **本檔角色**：Rapier 確定性物理引擎的**實作層** —— 三層架構、`DeterministicWorld` Rapier 封裝、固定 timestep loop、整數量化、mesh 體積計算、每幀模擬管線、determinism 保證。
> 所有物理**算式**（動力 / 熱 / 磁 / 損耗 / 技能）權威在 [算式表.md](../算式表.md)，本檔只描述引擎結構與管線、不重列公式；`K_*` 常數值見 [calibration.md §18](../程式參數/calibration.md#18-物理--武器-k-常數待-playtest-校準)；`PhysicsEngine` 介面契約見 [interfaces.md §3](interfaces.md)；mesh 指紋演算法見 [anti-piracy.md](anti-piracy.md)。對應 `src/physics-engine/`。

## 公開介面邊界

公開契約的單一權威是 [interfaces.md §3](interfaces.md)：`step()` 接受排序後的
`ReadonlyArray<PlayerInput>` 並回傳 `StepOutput`，rollback 使用 `saveState()`／`loadState()`，
desync 使用 `computeStateHash()`。`DeterministicWorld` 是本模組內部 Rapier wrapper，不另建立第二套
`PlayerInputs`／`Snapshot`／`computeChecksum()` 公開介面。

## 1. 三層架構

```text
玩家 input
  ↓
PhysicsEngine（Rapier wrapping）
  ├─ Layer A：固定 60Hz timestep + gameplay dynamic hard CCD（CCD substeps = 2）
  ├─ Layer B：collider builder + sub-mesh material lookup
  └─ Layer C：snapshot / rollback / desync detection
  ↓
Renderer + HUD（每幀）

賽果事件 → ledger → DerivedState（賽後、非每幀管線）
```

Layer B 的 collider 對應 GLB sub-mesh 固定索引（材質查表 O(1)）；Layer C 接 [network-sync.md](network-sync.md) 的 rollback 與 checksum。

## 2. DeterministicWorld（Rapier 封裝）

實作 [interfaces.md §3 `PhysicsEngine`](interfaces.md) 介面，鎖定 deterministic 必要設定：

```typescript
const world = new RAPIER.World(gravityFromTrackManifest);
world.timestep = 1 / FIXED_FRAMERATE_HZ; // 鎖死 60Hz
world.numSolverIterations = SOLVER_VELOCITY_ITERATIONS; // 8；Rapier 0.19 單一 solver 軸
world.maxCcdSubsteps = PHYSICS_CCD_MAX_SUBSTEPS; // 2；與 render catch-up 分軌
```

### 2.1 Snapshot / Restore

序列化原則見 [§1](#1-三層架構)（涵蓋 bodies / colliders / impulse·multibody joints / islands；canonical 跨 peer 一致；供 rollback + checksum 比對）。實作以 `bincode`（具體格式屬實作細節）：

```rust
pub fn take_snapshot(&self) -> Vec<u8> {
    let mut buf = Vec::new();
    bincode::serialize_into(&mut buf, &(&self.bodies, &self.colliders,
        &self.impulse_joints, &self.multibody_joints, &self.islands)).unwrap();
    buf
}
pub fn restore_snapshot(&mut self, data: &[u8]) -> Result<()> {
    let (b, c, ij, mj, isl) = bincode::deserialize(data)?;
    self.bodies = b; self.colliders = c; self.impulse_joints = ij;
    self.multibody_joints = mj; self.islands = isl; Ok(())
}
```

`engineVersion`（Rapier 版本）= [版本規範.md](../版本規範.md) 六欄位之一 `rapier_version`——配對**全等比對**、任何版本差異即擋配對（非僅 major）；升 Rapier = 發版 bump `rapier_version`。

SavedState 寫入剛取得的 Rapier snapshot；`saveState` 回傳前，live world 立即由**同一份** snapshot
重建，讓不中斷續跑與日後 load／replay 都從相同 serialized solver state 出發。restore 除了
body／collider，也逐一核對 Revolute joint 的 handle、兩端 body、型別、
anchor、frame／axis、linked-contact flag、limit 與 motor immutable state；數量或任一拓樸欄位不符
即在替換 live world 前原子拒絕。tire／roller auxiliary body 的旋轉與角速度同樣進入 state hash。

### 2.2 Gameplay dynamic hard CCD

primary chassis compound body、tire／roller hinge body、active weapon actuator payload，以及仍被
hold joint 握持或已釋放的預配置 projectile body，都由同一個 dynamic body factory 建立並固定套用
`PHYSICS_HARD_CCD_ENABLED=true`、`PHYSICS_CCD_MAX_SUBSTEPS=2`、
`PHYSICS_SOFT_CCD_PREDICTION_M=0`。不得依速度逐幀開關 CCD；projectile release 只移除既有 joint，
不改 body topology 或 CCD 設定。純視覺碎片沒有 body，故不配置 CCD。

hard CCD 用 shape cast／motion clamping 防止合法高速 body 跨過 fixed trimesh、kinematic entity 或
其他 dynamic body；soft CCD 則是可能在幾何接觸前改變 impulse 的預測約束，初版明確停用，不能
視為 hard CCD 替代品。場地不新增全域最小牆厚規則，以免限縮 UGC 造型；退化三角形仍由既有
canonical 幾何品質規則拒收。終點 ／Checkpoint／KillZone 等自訂 trigger 另走 chassis COM 線段掃掠，
Rapier CCD 不代替 trigger sweep。

這三個值皆為 physics-version-pinned protocol 常數。Rapier snapshot 保存 body CCD 狀態，
`bodyTopologyKey` 與 restore 驗證 hard／soft CCD，immutable world config 驗證 CCD substeps；任何差異
原子拒絕。改值會改變碰撞、fatigue、熱與損毀輸出，公開後須隨 physics/client major 出貨。決策見
[D-20260814-07](../decisions/D-20260814-07-Gameplay動態剛體HardCCD.md)。

Rapier 0.30.1 的 CCD 不讀取 joint contact-disable 或 contact hook，因此既定排除也必須編碼到
collision groups。每車保留主車體與 weapon fixed proxy 兩個 membership bits，八車互不共用；
tire／roller 排除直接連結的兩類 primary collider，持彈同樣排除整個 primary body。彈丸釋放後
只排除來源 weapon fixed proxy，來源車其他零件、其他彈丸、他車與場地仍可接觸；完整離膛後
恢復來源武器接觸。不得以永久同車免疫替代。projectile 群組屬於可由彈藥與 sourceCleared
推導的狀態，restore 在替換 live world 前按輸入狀態驗證，而非將群組任意改動視為合法拓樸。

### 2.3 Tire／roller Revolute 拓樸

正式世界建立的資產邊界是 `AdmittedAsset`。`VehicleSpec`／`TrackSpec` 的質量、材質、幾何、
mount、動力、電池、技能、武器、route、磁源、天氣與重力只可由 typed `PhysicsManifest`
取得或由其中欄位作決定性推導；race runtime 禁止解析 GLB root/node extras 或重跑 Wave A/B。
正式 UGC 還必須由 asset boundary 核對 ledger record 與 embedded manifest 的 version／digest，並命中
同一 `(CID, version, digest)` 本機 admission receipt；缺 receipt、讀取失敗或參照不一致都拒絕。
GLB bytes 在此只提供 collider／ 視覺幾何。完整信任模型見
[D-20260811-02](../decisions/D-20260811-02-Canonical-PhysicsManifest與一次性Admission.md)。

chassis 與所有非 hinge 零件共用一個 primary dynamic body；每顆 tire／roller 依原始 part index
建立獨立 auxiliary dynamic body 與 contact-disabled Revolute impulse joint，該 part 的每個 admitted
convex proxy 各建立一顆 collider。每顆 collider 的材質、質量與 `wearCapacityJ` 來自對應 proxy，
不得以整車單一密度平均分配或把整顆輪組壓成單一形狀。

hinge anchor 與 axis 只由完整 Mount frame 決定：anchor 是 chassis-side Mount position，axis 是
chassis-side Mount local `+X`，視覺與 collider attachment 則為
`chassisMount × inverse(partMount)`。runtime 不以 AABB 最短軸、三角形、builtin 姿態或外觀猜軸；
part-side Mount 可有任意複合旋轉，幾何也可刻意不對稱或非圓盤。AABB／ 圓柱只允許縮減測試 fixture，
正式 admitted asset 一律使用逐 convex proxy 拓樸。

tire 接收 [算式表 §2](../算式表.md) 的角衝量，primary 接收等量反向反作用；roller 永遠被動。
驅動以 world 建立時的原始 driven tire 數固定分母，損壞 tire 的份額不重分配，全部損壞時不推進。
`broken` 是唯一狀態來源；首次損毀於幀末交易停用該輪組 collider／auxiliary body，使 Revolute 不再參與
物理，並重算 primary body 的質量、local COM 與慣量。不得另派生零摩擦、額外滾阻或 roller 軸向制動。
正常 `VehicleSpec` 宣告 tire／roller 卻缺完整 hinge
descriptor 時 fail closed；只有刻意不含 tire part 的縮減 physics fixture 保留 direct-primary
compatibility fallback。scale、freeze、teleport 與接觸 ／part world-position 查詢都必須涵蓋 primary
與所有 auxiliary bodies。決策背景見
[D-20260807-03](../decisions/D-20260807-03-輪組Revolute接觸驅動.md)；損壞狀態與回滾規則見
[D-20260811-06](../decisions/D-20260811-06-輪組二元損壞與固定驅動份額.md)。

### 2.4 Active weapon 拓樸

active weapon 的 manifest 必須帶經 Stage 3 `auto_weapon_physics` 重建與 descriptor 交叉驗證後的 typed `WeaponPhysicsSpec`；缺失、材質未知、actuator／projectile 不一致時 admission fail closed，runtime 不回讀原始 extras。固定 proxy 掛 primary body；每個 rotor／chain segment 建 auxiliary dynamic body 與 convex collider，依 descriptor 建 Revolute／Spherical joint。weapon aggregate AABB 不再同時包覆活動 payload，避免重複 collider／ 質量。

launch projectile 在 world 建立時全部預配置並以 fixed hold joint 持彈；開火只釋放 authored child index，不新增 body。body／collider／joint handles 及各 topology key 由 load-time immutable template 驗證，snapshot 的 ammo／actuator phase 只能決定 mutable phase 與應存在的 hold joint 子集。presentation 以具名 `WeaponNodePose` 對既有 GLB 節點更新；spectator wire 有界且不能建立新 scene object。決策背景見 [D-20260808-03](../decisions/D-20260808-03-武器執行期物理拓撲.md)。

### 2.5 Track Entity 拓撲與生命週期

一般 solid 碰撞的 damage ledger 不辨識武器名稱：新接觸先在 Rapier solver 前依 body handle 保存
COM pose／`linvel`／`angvel`／effective inverse mass／world inverse inertia，solver 後取得實際
manifold point 與 canonical 有向 normal，以 `v + ω×r` 和方向 constraint effective mass 算法向
撞擊能量。每個 fixed step 再由 contact tangent impulse 與接觸點切向 slip 算持續剪切能量；
tire／roller 對固定 track 的 pair 只走專用磨耗 ledger。兩通道共用實際 collider 材質與
current PhysicsManifest 六向接觸面積，缺可信資料 fail closed。

`TrackSpec.entities` 只來自 current PhysicsManifest。world 依 `entityIndex` 建立 intact fixed／kinematic body 與 colliders，不為 destructible fragment 建立任何 body／collider。`visual_only` 完全排除於物理拓撲。kinematic pose 以固定 frame 與 deterministic motion evaluator 設定 next pose；conveyor 只巡訪實際 contact manifold，local −Z 切向衝量以 solver friction × normal impulse 封頂。

`TrackSpec.weather` 同樣只來自 current PhysicsManifest：race session 注入 `matchId`／`roundIndex` 與 track manifest digest，physics engine 派生 weather seed，以整數 accumulator、spawn ordinal 與 typed exposure grid 生成最多 50 個 active patch descriptors。world 只在 tire／roller 對固定 track solid 的實際 manifold 接觸套用一次 friction／rolling modifier；renderer、spectator 與 editor preview 消費同一 scheduler／descriptor 形狀，不另跑 RNG。body aero 每幀以六軸 drag area、各向 COP、該點相對氣流與 lift factor 施加有車重上限的 impulse。最大 8 車 ／50 patch 有獨立 60Hz benchmark。

破壞關閉 intact body/colliders、move/conveyor/magnets；碎片一律純視覺，由 `entityIndex + breakFrame + descriptor/presentation version` 重建，並與車輛共用 5 秒生命與淡出參數。RenderFrame／spectator 只傳 bounded visual descriptor，不傳 `physicsActive` 或逐片物理 pose。current SavedState 驗證 intact Rapier enabled 狀態、per-part 溫度 ／ 損毀交易、完整 roster 的 `destructionCounts`、projectile `sourceCleared`、checkpoint 約束的 `routeProgressUm`、weather scheduler／active descriptors 與 envelope lifecycle，任一不一致原子拒絕。最大合法 100 entities／50 destructibles／ 零 fragment body 有獨立 60Hz benchmark 與跨 snapshot conformance vector。決策見 [D-20260814-06](../decisions/D-20260814-06-場地碎片統一純視覺.md)。

### 2.6 Route／respawn surface frame

`TrackConfig.route[]` 與 `respawnPoints[]` 都保留 Empty 的完整 world frame：local `-Z` 是 forward、
local `+Y` 是 up。Hermite sample 的 up 先在相鄰 authored up 間插值，再投影到 sample tangent 的
正交平面；runtime 的中心線最近點必須逐條預採樣**線段**做夾限投影，不得以最近 sample 點替代，
並以同一投影參數連續插值 half-width、tangent 與 up。退化 fallback 只依 authored frame 與固定軸序，
不可讀 camera 或 gravity。起跑格沿第一個 sample up 抬升 `START_GRID_LIFT_M`，所有 spawn／teleport quaternion 同時對齊車輛 local `-Z／+Y`。所有車同縱向，slot s 的 lateral offset 固定為 `(s-(N-1)/2)×START_GRID_CELL_WIDTH_M`，沿 surface-frame right 左右對稱；`N×cell width > RP1.width_m` 時 admission／runtime 同式拒絕。引擎只接受明確 `{slot, playerCount}`，正式賽不得以 load order 推斷 slot。這使 bank、側牆、
倒掛、垂直段與 360° 迴圈不被世界重力拉回水平；詳見
[D-20260808-01](../decisions/D-20260808-01-route與respawn完整surface-frame.md)、[D-20260814-20](../decisions/D-20260814-20-多人可驗算起跑格.md)。

## 3. 固定 timestep loop

```typescript
class FixedTimestepLoop {
  private accumulator = 0;
  private readonly TIMESTEP = 1 / FIXED_FRAMERATE_HZ;

  tick(realDeltaSeconds: number): {
    physicsSteps: number;
    renderAlpha: number;
  } {
    this.accumulator += realDeltaSeconds;
    let physicsSteps = 0;
    while (this.accumulator >= this.TIMESTEP) {
      this.physicsEngine.step(this.collectInputs());
      this.accumulator -= this.TIMESTEP;
      if (++physicsSteps >= MAX_SUBSTEPS) {
        this.accumulator = 0;
        break;
      } // 防 spiral of death
    }
    return { physicsSteps, renderAlpha: this.accumulator / this.TIMESTEP };
  }
}
```

視覺插值：`visualPos = lerp(prevState.position, currentState.position, renderAlpha)`（純表現、不影響共識）。

## 4. 整數量化

跨 frame / 跨 peer 的浮點結果須量化為整數再使用（消除跨平台浮點差異）。量化尺度 `INTEGER_SCALE`（1mm 精度）見 [程式架構.md §6.2](../程式架構.md) / [程式參數.md](../程式參數.md)；物理算式統一 `f32`、經濟算式 `bigint`（[算式表.md §0](../算式表.md)）。座標 / 速度 / 角度依此量化後參與 ephemeral checksum 與回合 anchor checksum。

## 5. Mesh 體積計算（上傳時，WASM）

`computeMeshVolume` 算單零件體積（`mass = volume × density`，[算式表.md §1](../算式表.md)）：

```rust
// 主路徑：有號四面體積分（前提 mesh watertight）
fn mesh_volume_signed(triangles: &[Triangle]) -> f64 {
    let mut v = 0.0;
    for t in triangles {
        v += (-t.v3.x*t.v2.y*t.v1.z + t.v2.x*t.v3.y*t.v1.z + t.v3.x*t.v1.y*t.v2.z
              - t.v1.x*t.v3.y*t.v2.z - t.v2.x*t.v1.y*t.v3.z + t.v1.x*t.v2.y*t.v3.z) / 6.0;
    }
    v.abs()
}
```

| 情況                               | 處理                                                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| watertight mesh                    | 有號四面體積分（精確）                                                                                                                                        |
| 非 watertight 但合法（開放封閉殼） | voxelization 備援（`voxelVolumeM3`）：AABB → (y, z) 100² 柱網格 → 柱心射線奇偶判內外、精確 x 區間積分（誤差 ≈ ±1%；y／z 取相異子格採樣偏移防樣本恰落共享邊） |
| 兩者皆失敗                         | 拒絕上傳，提示創作者修正 mesh                                                                                                                                 |

表面積（`computeMeshSurfaceArea`）同路徑計算；current PhysicsManifest 另以 BVH 雙向射線排除同 part 內被其他水密 region 完整包覆的三角面，烘焙 `ambientConductanceWPerC` 與六向接觸面積。

> **實作落點**：現行為 TS 實作（積分與 voxel 備援皆僅 ＋−×÷ 的 f64 運算 ＝IEEE 決定性、無超越函數；效能達標）；WASM 化隨 anti-piracy 指紋工具鏈（Rust→WASM）一併評估。watertight 判定 ＝ **位置逐位元相同視為同頂點焊接後**每條無向邊恰被 2 個三角形共用（exporter 為法線 ／UV 複製頂點不影響判定）；編輯器 wave A 走陣列級 API 對 per-node 世界座標幾何逐一計算。

## 6. Mesh 指紋（WASM）

`computeMeshFingerprint` 在 WASM 內跑標準化 + SHA-256，輸出 `MeshFingerprint`（`primary` hash + `features`）。8 步標準化（平移 / PCA 對齊 / 縮放單位立方 / 16-bit 量化 / 頂點字典排序 / 拓樸重編 / 節點名排序）、鏡像偵測與相似度比對演算法權威見 [anti-piracy.md](anti-piracy.md)；fork 物理指紋見 [ugc-fork.md](ugc-fork.md)。

## 7. 每幀模擬管線

`step()` 內依序套用各物理子系統；**算式全部 defer [算式表.md](../算式表.md)**，本檔只列管線結構與對應章節：

| 子系統                   | 內容                                                                                                                                           | 算式                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 駕駛動力                 | SOC 降額後取得可用輸出，駕駛先扣整數 quantum                                                                                                 | [算式表 §2](../算式表.md)       |
| 技能觸發（event-driven） | 依 allocation 分配剩餘輸出；效果、電池成本與兩路廢熱分帳，Event／Hold／launch 依成功語意結算                                                | [算式表 §3](../算式表.md)       |
| 武器反作用力             | 武器動能轉 chassis 質心反向衝量（K_REACTION）                                                                                                  | [算式表 §4](../算式表.md)       |
| 磁力                     | 磁源→車輛／Track Entity 鐵磁 sub-mesh 逐 canonical collider 取材質、susceptibility 與世界中心後聚合（1/r²，impulse 只施於 COM、不產生 torque；fixed target 仍回推動態 source）；磁源↔磁源同極斥／異極吸 | [算式表 §5](../算式表.md)       |
| 熱模型                   | per-part J/W ledger；ambient／solid contact 固定熱庫與滑移熱在單一 backward Euler 解算一次；過熱破壞無 graceful degradation                    | [算式表 §6](../算式表.md)       |
| 損耗 fatigue             | 衝撞由實際碰撞 collider 材質對稱套用 attacker／target，車輛與 destructible entity 同規則；acid 由實際 zone/sub-mesh 接觸材質計算且同 zone/part 去重；輪胎逐 region rolling／slip 耗散與熱加權；閾值 1.0、broken 後凍結 | [算式表 §7·§8·§9](../算式表.md) |
| 場地物理                 | entity destructible（fatigue 達閾值後停用 intact 物理，碎片只重建純視覺 descriptor）、天氣 patch、風力、重力                                      | [算式表 §10](../算式表.md)      |
| 賽道進度                 | checkpoint 與 KillZone 使用 chassis COM segment-AABB；RPn 使用 authored surface frame 的正向 segment-plane crossing；`routeProgressUm` 保存 checkpoint 約束下單調不退的 route arc-length；`finishArmed`／previous COM／量化進度／完賽幀進 current SavedState 與 hash | [零件與共用介面.md §5.4](../建模參數/零件與共用介面.md#5-empty-node-命名約定) |
| 流體 deploy zone         | 場地 authored sensor 與 fluid projectile 首次合法場地接觸啟用的預配置圓形 sensor 共用 canonical zone key；同 zone／part 多 collider 去重，grip／sticky 取最強，burn／freeze／corrosive 依 distinct zone 疊加；source peer、anchor 與 in-flight／deployed／retired 進 current SavedState | [算式表 §6.4·§8](../算式表.md)  |

每回合載入該回合的車 + 場地 = 全新世界,以「車輛回合初始狀態」開始（fatigue 0、temperature = 場地環境溫、broken false、battery 滿、彈藥滿）；回合獨立、不共享 runtime 狀態（換新車 + 新世界的自然結果、非 reset 流程，回合數可變 N）見 [算式表 §11](../算式表.md)。

## 8. Determinism 保證

| 面向                 | 作法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| collider／joint 排序 | 場地 region 依 `(materialId, sourceNodeIndex)`、part proxy 依 source node index、接觸依 canonical collider key 固定建構／累加；tire／roller Revolute joint 依 vehicle／原始 part index 固定建構                                                                                                                                                                                                                                                                                                                                |
| 數值精度             | 全物理 `f32`（避免 f64 跨平台差異）；material lookup 純函數 O(1)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 運算白名單           | 共識路徑限 ECMAScript **正確捨入**運算：`+ − × ÷`、`Math.sqrt`、整數取捨（round / floor / ceil / trunc / abs / min / max）；規格標「implementation-approximated」的函數（三角 / 雙曲 / 指對數 / pow / cbrt / hypot）與 `**` 運算子（pow 語意）禁用——跨引擎可差 1 ulp（[資料系統.md §17](../資料系統.md) 同族不變式）。替代法：整數次方寫連乘、衰減線性化 `1−(1−decay)×dt`、朝向 shortest-arc quaternion、立方根定次 Newton（`deterministicCbrt`）。ESLint 強制：`src/physics-engine/**` 禁 `**` ＋ `Math` 黑名單（測試檔豁免） |
| sim state            | `fatigue` / `temperature` / `broken` 為 sim state，跨 peer deterministic；輪組 broken 於幀末停用自身物理並重算 primary 質量屬性，不另切換接觸係數。respawn 不修復，新回合全新 world 才回 false                                                                                                                                                                                                                                                                                                                                                  |
| handle 不穩 fallback | 若 Rapier upstream 改變 handle 順序 → 改走 sub-mesh fingerprint 作 collider userdata（[程式架構.md §6.3](../程式架構.md)）                                                                                                                                                                                                                                                                                                                                                                                                     |
| 接觸係數合成         | collider handle O(1) 對映 admitted material／wear capacity；一般 friction／restitution 採 `Average`，tire／roller restitution 採 `Min`。牽引、rolling resistance、接觸熱與 tire wear 共用 canonical manifold 聚合；磨耗只讀實際 rolling／tangential impulse 與相對速度。規則見 [D-20260811-04](../decisions/D-20260811-04-逐Collider材質接觸與滾動阻力.md)、[D-20260811-10](../decisions/D-20260811-10-逐Region接觸耗散輪胎磨耗.md)                                                                                            |
| 單執行緒             | deterministic build 與 SIMD / parallel 互斥；主站無 COOP/COEP → SAB 不可用 = **物理必然單執行緒**（[程式架構.md §6.6](../程式架構.md)）                                                                                                                                                                                                                                                                                                                                                                                        |

## 9. 效能目標

引擎關鍵路徑基準（完整 perf budget 與 PR 門檻見 [testing.md §8](testing.md)）：8 人比賽 frame ≤ 16ms（60fps）、rollback 重播 ≤ 8ms、snapshot 序列化 ≤ 4ms、mesh fingerprint / 體積（10k 頂點）≤ 50ms / 30ms。

## 10. 跨模組對接

| 模組                                                                   | 對接                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [算式表.md](../算式表.md)                                              | 所有物理算式權威（動力 / 技能 / 磁 / 熱 / 損耗 / 場地）                    |
| [calibration.md §18](../程式參數/calibration.md#18-物理--武器-k-常數待-playtest-校準)                                  | `K_*` 物理常數值                                                           |
| [interfaces.md §3](interfaces.md) | `PhysicsEngine` / `DeterministicWorld` 介面契約                            |
| [network-sync.md](network-sync.md)                                     | rollback / ephemeral checksum / 回合 anchor checksum（用 snapshot + step） |
| [anti-piracy.md](anti-piracy.md) · [ugc-fork.md](ugc-fork.md)          | mesh 指紋演算法 / fork 物理指紋                                            |
| [材質表.md](../材質表.md)                                              | 材質物理欄位 / `magnetism_role` / deploy_behavior / 可破壞性決策           |
| [建模參數.md](../建模參數.md)                                      | 重力 / 天氣 patch / aero / motor·battery·chip 建模參數                     |
