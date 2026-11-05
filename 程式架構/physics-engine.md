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
`ReadonlyArray<PlayerInput>` 並回傳 `StepOutput`，rollback 使用 `saveState()`／`loadOwnState()`，
外來快照使用 `loadState()`，desync 使用 `computeStateHash()`。`DeterministicWorld` 是本模組內部 Rapier wrapper，不另建立第二套
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

輪組滑移熱與磨耗原子讀回 58 欄接觸與 6 欄時間作功。`NativeTrialCapture` 保存兩者，
`combineAcceptedNativeFrame` 只歸併接受子步。每列已接受耗能加入輪組快取，
快照與雜湊覆蓋 59 欄；缺欄、負值、非有限值與負零耗能均拒絕。
pipeline 捕獲暫存於 finish／discard 清空，不序列化指標。契約見
[D-20261018-03](../decisions/D-20261018-03-接受子步時間作功與區域耗能.md)。

實作 [interfaces.md §3 `PhysicsEngine`](interfaces.md) 介面，鎖定 deterministic 必要設定：

```typescript
const world = new RAPIER.World(gravityFromTrackManifest);
world.timestep = 1 / FIXED_FRAMERATE_HZ; // 鎖死 60Hz
world.integrationParameters.raw.configureBoundedCandidateProfile();
world.numSolverIterations = SOLVER_VELOCITY_ITERATIONS; // 4
world.numInternalPgsIterations = SOLVER_INTERNAL_PGS_ITERATIONS; // 25
world.maxCcdSubsteps = PHYSICS_CCD_MAX_SUBSTEPS; // 2；與 render catch-up 分軌
world.integrationParameters.raw.setCcdPersistentContactPolicy(
  PHYSICS_CCD_PERSISTENT_CONTACT_POLICY, // 2；只對固定目標改掃核心球（§2.2）
);
world.integrationParameters.raw.setContactNormalOrderPolicy(
  PHYSICS_CONTACT_NORMAL_ORDER_POLICY, // 1；接觸 normal 求解與點序無關（§2.9）
);
```

套用核心 profile 後再固定產品數值；快照宣告須符合實際迭代數。
還原前拒絕已宣告的重力、步長、solver、PGS、CCD substeps、持續接觸 CCD 與接觸 normal 求解順序設定漂移，不以覆寫掩蓋。

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

`engineVersion` 保存 Rapier runtime 的完整核心版本（包含 WASM digest），用於 SavedState
**全等核對**；[版本規範.md](../版本規範.md) 六欄位中的 `rapier_version` 是同一個 runtime 完整
核心版本（`RAPIER_VERSION_CURRENT` 與初始化後的 `rapierVersion()` 全等，由測試守門），用於配對
**全等比對**。同一套件版號下重建出不同 WASM 的核心、或共用相同上游 npm 版本的不同 Open4WD
修正版，都不可混場。PWA 生成守門核對宣告等於 file pin 核心身份的 runtime 版本、pinned bundle
內嵌同一 WASM digest，以及實際安裝的 JS/WASM bytes；初始化另核對完整核心 digest。

不可變形狀以登錄參照寫入快照（[D-20261028-02](../decisions/D-20261028-02-靜態形狀登錄參照快照.md)）。建構期 `recordImmutableBodyColliderTopology`
之後，本次新增的不可變 collider 中 trimesh／凸包形狀依 handle 升冪登錄為一批（場地一批、每台車一批）：
批次 id＝vendor `coStaticShapeWireBytes` 輸出（每形狀 u64 LE 長度加內嵌 bincode bytes）的 sha256 前 64
位元，同內容即成為別名。登錄表每個 wasm instance 一張；之後原生快照對登錄形狀只寫（批次 id, 序號）
16 B，其餘欄位與動態狀態（broad phase、narrow phase、island、solver）照舊完整寫入。引用未登錄批次的
快照原生還原失敗。每次登錄有自己的 token，`destroy` 逐一釋放；最後一個使用該批的世界銷毀時登錄表移除
該批。登錄的形狀建構後不得就地修改（就地修改會複製出未登錄的新形狀並改以內嵌寫入）。未登錄任何形狀
時快照與 vendor 父代逐位元相同。

SavedState envelope 的 `staticShapeBatches` 依首次登錄順序列出本世界引用的批次
`[批次 id（sha256 前 8 bytes）, sha256]`；三條載入路徑都先核對清單與本機世界登錄的批次逐位元全等，才交給
原生 restore。

SavedState 寫入剛取得的 Rapier snapshot；`saveState` 是純讀取，不以剛產生的 snapshot 重建 live
world。續跑與日後 load／replay 的逐位元一致由「快照無損」守門保證：不中斷、每幀
save→load→step、間隔 load 三種跑法的逐幀 state hash、快照 sha256 與完整內嵌原生快照 sha256 必須全等
（[testing.md §2](testing.md)、[D-20261028-01](../decisions/D-20261028-01-快照取消正規化與本機信任載入.md)、
[D-20261028-02](../decisions/D-20261028-02-靜態形狀登錄參照快照.md)）。

載入分兩條信任路徑。`loadState` 用於所有來自本行程外的快照（catch-up、觀戰 checkpoint、存檔與
fixture），走完整驗證。`loadOwnState` 只接受本引擎目前世界以 `saveState` 自產、仍是同一份記憶體
參照的快照（`OwnSavedState`，型別品牌加執行期登記；複製、型別斷言偽造或世界重建前的 bytes 一律
拒絕），供 rollback 從自己的 StateBuffer 載入：envelope 欄位驗證與原子替換語意相同，跳過下述原生
拓樸、幾何、質量與 runtime hash 核對。完整驗證的 collider 形狀比對：還原後 collider 的登錄鍵等於建構期
記錄的登錄鍵即通過、不讀回幾何；鍵不符（改寫為內嵌或指到其他序號）退回完整幾何 bytes 比對。完整驗證的 restore 除了 body／collider，也逐一核對 Revolute joint 的 handle、兩端 body、型別、
anchor、frame／axis、linked-contact flag、limit 與 motor immutable state；數量或任一拓樸欄位不符
即在替換 live world 前原子拒絕。tire／roller auxiliary body 的旋轉與角速度同樣進入 state hash。
collider 拓樸以 manifest 推導的應建 collider 集合為準：`contact: "none"` 的輪組質量件不建 collider、
不在拓樸紀錄內（[§2.3](#23-tireroller-revolute-拓樸)）；launch 持彈 collider 與預配置彈剛體的啟用
狀態依 [§2.4](#24-active-weapon-拓樸) 由彈藥與損毀狀態推導後比對。

locked settings 在建構與兩條載入路徑套用；它們已序列化進快照，外來快照在 load 時驗證。研究
harness 直接改寫的原生設定不再被每幀存檔覆寫。

`takeSnapshot` 是純讀取：拍不拍快照不改變之後的原生狀態。collider 或剛體啟停（零件損毀、退役、
場地實體破壞、彈丸停用、流體 zone 啟停）以及載入新 body 時，當下就重算受影響剛體的質量快取，使快取
恆為重算的不動點；繞過世界 API 留下的待重算快取不是合法狀態，restore 驗證拒收（issue 001046）。

場地地面 piece 的鬼索引屬於 trimesh 形狀，隨 Rapier snapshot 一起序列化，還原後的擬法線與 live
world 相同；拓樸鍵只計可碰撞三角，鬼三角不計入。piece group 不進 snapshot：驗證通過的還原世界
與 bounded-step 交易的 `onRestore` 都依 canonical key 重新派發，續跑結果與未中斷執行逐位元相同
（[§2.7](#27-場地靜態碰撞體分段)）。

### 2.2 Gameplay dynamic hard CCD

primary chassis compound body、tire／roller hinge body、active weapon actuator payload，以及預配置
projectile body（發射前停用、發射後啟用），都由同一個 dynamic body factory 建立並固定套用
`PHYSICS_HARD_CCD_ENABLED=true`、`PHYSICS_CCD_MAX_SUBSTEPS=2`、
`PHYSICS_SOFT_CCD_PREDICTION_M=0`。不得依速度逐幀開關 CCD；發射只切換既有持彈 collider 與彈剛體的
啟用狀態，不改 body topology 或 CCD 設定。純視覺碎片沒有 body，故不配置 CCD。

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
tire／roller 排除直接連結的兩類 primary collider。未發射彈由 primary 上的持彈 collider 承載、
使用車體 membership；預配置彈剛體自建立即固定使用 launch 群組，發射後只排除來源 weapon fixed proxy，來源車其他零件、其他彈丸、他車與場地仍可接觸；完整離膛後
恢復來源武器接觸。不得以永久同車免疫替代。projectile 群組屬於可由彈藥與 sourceCleared
推導的狀態，restore 在替換 live world 前按輸入狀態驗證，而非將群組任意改動視為合法拓樸。

**持續接觸**（[D-20261026-02](../decisions/D-20261026-02-CCD持續接觸改掃核心球.md)）：hard CCD 不得把已貼在
一起的 pair 截斷在首次撞擊，否則滾動接地的車每幀都被截。步首（或 CCD 子步首）narrow phase 中
（來源 collider, 目標 collider）有 `dist ≤ prediction_distance` 的接觸點，或來源與同一固定剛體、同一
非零 piece group 的任一 piece 如此接觸，即為持續接觸；判定只讀步首狀態，與走訪順序無關。直接 pair
在步首有 manifold 但沒有接觸點（內部邊法線約束把該步的接觸暫時丟掉）、同群鄰 piece 也沒有接觸點時，
最後才以步首姿態對該 pair 做一次接觸查詢回退（容差 `prediction_distance`；順序固定為直接 pair → 同群
鄰 piece → 幾何回退，群組規則優先），
距離在容差內即為持續接觸、參考法線取查詢所得的目標面法線
（帶 `FIX_INTERNAL_EDGES` 擬法線的 trimesh 先投影進被命中三角形的擬法線錐，與 narrow phase 的內部邊修正
同一套規則；[D-20261101-02](../decisions/D-20261101-02-持續接觸判定的幾何回退.md)）；
否則已貼地的輪胎會被判成未貼合、在 CCD 子步首的 window-start 命中後整個半幀被時序求解器截停。持續接觸
pair 的處理：

- 固定目標先以完整形狀求 TOI；命中位置的接觸法線與步首參考法線（最深接觸點）夾角 ≥ 30° 時視為
  異面（例如同組的牆），接受完整命中，window-start（fraction 0）的命中亦同（同組薄牆在上一子步停在
  牆面、下一子步首就在 fraction 0 命中，必須截住）。同一面、查詢無結果或完整形狀未命中時，改掃核心球。
- 目標為 kinematic 或 dynamic 剛體（車對車、彈對車、旋轉武器）時不套用持續接觸規則，照父代以完整形狀求
  TOI（[D-20261027-02](../decisions/D-20261027-02-動態目標持續接觸回復完整形狀TOI.md)）。動態目標只掃核心球時，旋轉薄件質心幾乎不動、端點卻以 ω·R 掃進
  目標，核心球看不到而會切入或穿過動態薄目標。
- 核心球心在該 collider 的形狀質心，半徑＝min(0.25 × `ccd_thickness`, 0.5 × 內切半徑)；內切半徑限制
  斜放薄凸包被高估的 `ccd_thickness`。30° 與兩個比例是 kernel 固定常數，由 physics-version 釘住。
- 感測器、偽 pair 與非持續接觸 pair 照舊以完整形狀求 TOI。

設定以原生整合參數 `ccd_persistent_contact_policy` 承載（2＝上述規則），由
`PHYSICS_CCD_PERSISTENT_CONTACT_POLICY` 在 bounded profile 之後回填；進 Rapier snapshot，immutable world
config 與 restore 皆驗證，差異原子拒絕。

**穿入上界**：核心球擋的是穿過，不是穿入。只掃核心球時，穿入上界＝核心中心沿法線到形狀表面的距離
減核心半徑，可能接近外接半徑。實測下壓 ≤ 4.7 mm、非圓輪稜角 ≤ 8.4 mm、尖刺頂薄板 9–13 mm。
非圓輪離開預測帶後再落下屬真碰撞，仍有約 1–2 成截斷幀。

### 2.3 Tire／roller Revolute 拓樸

正式世界建立的資產邊界是 `AdmittedAsset`。`VehicleSpec`／`TrackSpec` 的質量、材質、幾何、
mount、動力、電池、技能、武器、route、磁源、天氣與重力只可由 typed `PhysicsManifest`
取得或由其中欄位作決定性推導；race runtime 禁止解析 GLB root/node extras 或重跑 Wave A/B。
正式 UGC 還必須由 asset boundary 核對 ledger record 與 embedded manifest 的 version／digest，並命中
同一 `(CID, version, digest)` 本機 admission receipt；缺 receipt、讀取失敗或參照不一致都拒絕。
GLB bytes 在此只提供 collider／ 視覺幾何。完整信任模型見
[D-20260811-02](../decisions/D-20260811-02-Canonical-PhysicsManifest與一次性Admission.md)。

chassis 與所有非 hinge 零件共用一個 primary dynamic body；每顆 tire／roller 依原始 part index
建立獨立 auxiliary dynamic body 與 contact-disabled Revolute impulse joint，該 part 每個未標
`contact: "none"` 的 admitted proxy 各建立一顆 collider。滾動面的形狀判定在**烘焙期**完成：derive 於量化前的全解析度網格
對 Mount 軸做 64 向徑向支撐判圓（容差 `ROLLING_SURFACE_ROUNDNESS_EPSILON_M`），判圓的 proxy
在 manifest 烘入 `shape` cylinder（擬合外緣半徑、軸向半寬、asset-local 中心與軸），runtime 讀
標記建 `ColliderDesc.cylinder`（pose＝shape 中心經組裝變換 ＋hinge `cylinderRotationLocal`）；
凸 hull 的離散圓周會把正圓輪變成多邊形、支撐半徑漣波遠超接觸容差並造成系統性偏航
（[D-20261020-01](../decisions/D-20261020-01-輪類滾動面改掛保守cylinder.md)）。非圓滾動 proxy
（方輪、齒輪等作者意圖）以保角支撐量化：hull 圓周站落在徑向剖面凸包角點（≤12、等角距裁減）
上，忠實保留 authored 角形；非滾動 proxy（hub 等）維持固定 26 向 convex hull
（[D-20261020-02](../decisions/D-20261020-02-旋轉面形狀分類移至烘焙期.md)）。同一部件有多個判圓
proxy 時，被包覆者退回已烘好的凸 hull 點：存在另一個半徑更大、同軸（兩軸外積長度
≤ 1e-6、內件中心到外件軸線 ≤ 10 µm，反向軸視為同軸）且軸向區間（中心 ± `halfHeightM`，端點容差
10 µm）包含它的判圓 proxy 時，該件接觸不到外界、移除 `shape`；未被包覆的較小判圓件（例如同軸上下
兩段、軸向外露、偏軸或斜軸）保留 `shape`，半徑並列者互不包覆
（[D-20261021-02](../decisions/D-20261021-02-滾輪被包覆內件維持凸hull.md)）。

上述判定之後，derive 再判定**被包覆質量件**：同一 tire／roller 部件內，候選外圈＝帶 cylinder `shape`
的 proxy C；另一 proxy P 的每個 admitted `pointsM` 點到 C 軸線距離 ≤ `C.radiusM + ε`，且沿 C 軸相對
`C.centerM` 的投影絕對值 ≤ `C.halfHeightM + ε`（ε＝`ENCLOSED_PROXY_TOLERANCE_M`）；P 若帶 `shape`，
另需依上段同軸包含規則被 C 包覆。多個候選時取包住 P 且 `sourceNodeIndex` 最小者，全程 f64 加減乘除
與平方根。P 在 manifest 烘入 `contact: "none"`，保留材質、質量、centroid、質量性質、熱資料與
`wearCapacityJ`；admission 逐件重判，標記與判定不一致即拒收，非 tire／roller 出現 `contact` 亦拒收。
runtime 不為 P 建 collider：其質量性質經 part pose 換到 hinge body frame，多件以平行軸定理合成後
設為 hinge body 的 additional mass properties，總質量、質心與慣量張量與全部建 collider 時相同；
同一 part 的 proxy 不得全為 `contact: "none"`。凸出外圈的件不算被包覆，仍建 collider。鉸接 body 的
CCD 厚度因此由外圈決定。公版 tire-01～03 的 Hub 與 roller-01～03 的 InnerSleeve／BearingHousing／
SealRings 皆為質量件（[D-20261026-01](../decisions/D-20261026-01-鉸接輪組被包覆內件只承載質量.md)）。
每顆 collider 的材質、質量與 `wearCapacityJ` 仍來自對應 proxy，不得以整車單一密度平均分配；
輪組不壓成單一 collider，只有被包覆質量件不建 collider。proxy 的 `centroidM` 與 `inertiaFrame` 屬 part（asset-local）frame；collider 擺位
不等於 part pose 時（cylinder 以 shape 中心加軸向旋轉擺放，含 weapon rotor），交給 Rapier 前須換到
collider-local：質心 c′＝R⁻¹·(c − shape 中心)、主軸 frame′＝R⁻¹·frame，R 為 collider 相對 part 的
旋轉；凸 hull collider 擺在 part pose，原值直用。未換算會讓質心偏軸、慣量主軸錯轉。

hinge anchor 與 axis 只由完整 Mount frame 決定：anchor 是 chassis-side Mount position，axis 是
chassis-side Mount local `+X`，視覺與 collider attachment 則為
`chassisMount × inverse(partMount)`。runtime 不以 AABB 最短軸、三角形、builtin 姿態或外觀猜軸；
part-side Mount 可有任意複合旋轉，幾何也可刻意不對稱或非圓盤。AABB box 只允許縮減測試 fixture；
正式 admitted asset 的非圓 proxy 一律使用逐 convex proxy 拓樸，cylinder 只由烘焙 `shape` 標記
決定（hinge descriptor 的 `radiusM` 保留為驅動換算半徑），runtime 不從 mesh 重推圓柱。

tire 接收 [算式表 §2](../算式表.md) 的角衝量，primary 接收等量反向反作用；roller 永遠被動。
驅動以 world 建立時的原始 driven tire 數固定分母，損壞 tire 的份額不重分配，全部損壞時不推進。
`broken` 是唯一狀態來源；首次損毀於幀末交易停用該輪組 collider／auxiliary body（質量件隨
整個 part 一併停用），使 Revolute 不再參與
物理，並重算 primary body 的質量、local COM 與慣量。不得另派生零摩擦、額外滾阻或 roller 軸向制動。
正常 `VehicleSpec` 宣告 tire／roller 卻缺完整 hinge
descriptor 時 fail closed；只有刻意不含 tire part 的縮減 physics fixture 保留 direct-primary
compatibility fallback。scale、freeze、teleport 與接觸 ／part world-position 查詢都必須涵蓋 primary
與所有 auxiliary bodies。決策背景見
[D-20260807-03](../decisions/D-20260807-03-輪組Revolute接觸驅動.md)；損壞狀態與回滾規則見
[D-20260811-06](../decisions/D-20260811-06-輪組二元損壞與固定驅動份額.md)。

### 2.4 Active weapon 拓樸

active weapon 的 manifest 必須帶經 Stage 3 `auto_weapon_physics` 重建與 descriptor 交叉驗證後的 typed `WeaponPhysicsSpec`；缺失、材質未知、actuator／projectile 不一致時 admission fail closed，runtime 不回讀原始 extras。固定 proxy 掛 primary body；每個 rotor／chain segment 建 auxiliary dynamic body 與 collider，依 descriptor 建 Revolute／Spherical joint。單體 revolute rotor 在 Stage 3 對 actuator 軸判圓：圓（平滑盤）＝payload proxy 帶 `shape` cylinder、runtime 建圓柱 collider；非圓（齒盤等）＝ 保角支撐量化 hull、齒尖全保留；chain 不分類。傷害輸出由幾何特徵決定——齒形 ＝ 離散高衝擊、平滑盤 ＝ 低傷害推擠，不另設研磨傷害機制（[D-20261020-02](../decisions/D-20261020-02-旋轉面形狀分類移至烘焙期.md)）。weapon aggregate AABB 不再同時包覆活動 payload，避免重複 collider／ 質量。

launch 預載彈在 world 建立時全部預配置，每顆兩件：primary 上的**持彈 collider**（形狀、材質與質量
取自該彈 canonical proxy，pose 為 authored 預載 pose，collision membership 用車體位，owner 記
`{partIndex: 武器, projectileIndex}`），以及預配置後停用的**彈剛體與 collider**（群組固定為 launch
群組，owner 一開始即 `bullet:<vehicleId>:<index>`）；不建 hold joint。發射第 i 顆時同一幀停用第 i 顆
持彈 collider，primary 重算質量並以切換前的同一速度場回填；彈剛體設為 primary 同 pose，以切換前
車體在彈質心處的點速度與相同角速度啟用，再施 impulse 與等量 recoil。總質量守恆，開火不新增 body。
未發射彈的呈現為車輛空間恆等 body delta（彈剛體 frame 與 primary 相同，節點由 authored 預載 pose
擺放），發射前已損毀者不輸出。body／collider handles 及各 topology key 由 load-time immutable
template 驗證；rollback 的已發射集合＝未損毀預載彈依 index 的最小前綴，長度＝未損毀數－剩餘彈藥，
snapshot 依此與損毀集合驗證持彈 collider／彈剛體的啟用狀態，不一致即原子拒絕。presentation 以具名
`WeaponNodePose` 對既有 GLB 節點更新；spectator wire 有界且不能建立新 scene object。決策背景見
[D-20260808-03](../decisions/D-20260808-03-武器執行期物理拓撲.md)、
[D-20261025-01](../decisions/D-20261025-01-持彈碰撞體切換與可選彈體獨立耐久.md)。

**預載彈耐久**由武器 manifest 的 `weapon.projectileIndependentDurability`（launch 必填布林、非 launch
不得出現；作者欄位見 [零件與共用介面.md §3.7.3](../建模參數/零件與共用介面.md#373-launch-武器子彈標記)）
決定：

- **關閉**（公版預設）：預載彈發射前屬武器零件，持彈 collider 承受的碰撞、熱與疲勞全部計入武器；
  武器 broken 時未發射彈一律停用。
- **開啟**：每顆預載彈以自身 proxy 套用零件 fatigue 與熱公式（manifest 為每顆烘
  `durability = {heatCapacityJPerC, ambientConductanceWPerC, thermalLimitC}`，流體彈熱容 0），武器本體
  的熱容、環境散熱與 thermal limit 排除彈節點、質量不變（[算式表 §6.1·§7](../算式表.md)）。持彈 collider
  的碰撞與部署區腐蝕／燒／凍只累計到該彈；損毀於幀末提交：記 `breakFrame`、可用彈藥減一、停用持彈
  collider 並自 primary 移除質量，碎片純視覺，流體彈不建部署區。發射依 index 跳過已損毀者；同幀先
  發射者不受當幀損毀交易影響；預載彈損毀不產生致毀歸因。武器 broken 時未發射彈一律停用。
  `VehicleState.weaponProjectiles` 輸出每顆狀態；HUD 顯示「預載彈損毀 n/N」，觀戰 wire 只帶
  `{broken,total}` 有界整數。

### 2.5 Track Entity 拓撲與生命週期

一般 solid 碰撞的 damage ledger 不辨識武器名稱：新接觸先在 Rapier solver 前依 body handle 保存
COM pose／`linvel`／`angvel`／effective inverse mass／world inverse inertia，solver 後取得實際
manifold point 與 canonical 有向 normal，以 `v + ω×r` 和方向 constraint effective mass 算法向
撞擊能量。每個 fixed step 再由 contact tangent impulse 與接觸點切向 slip 算持續剪切能量；
tire／roller 對固定 track 的 pair 只走專用磨耗 ledger。兩通道共用實際 collider 材質與
current PhysicsManifest 六向接觸面積，缺可信資料 fail closed。

`TrackSpec.entities` 只來自 current PhysicsManifest。world 依 `entityIndex` 建立 intact fixed／kinematic body 與 colliders，不為 destructible fragment 建立任何 body／collider。`visual_only` 完全排除於物理拓撲。entity collider 以每節點 AABB box 為基礎；連續 360° 旋轉（`rotation_amplitude_deg = 360`）的 kinematic entity 逐 collider 節點在烘焙期對 `rotation_axis` 判圓，判圓者（轉盤盤面等）帶 `shape` cylinder、runtime 建圓柱 collider，非圓（擋板等）維持 box（[D-20261020-02](../decisions/D-20261020-02-旋轉面形狀分類移至烘焙期.md)；box faceting 會把旋轉圓盤變成「旋轉方箱」而困住車輛）。kinematic pose 以固定 frame 與 deterministic motion evaluator 設定 next pose；conveyor 只巡訪實際 contact manifold，local −Z 切向衝量以 solver friction × normal impulse 封頂。

`TrackSpec.weather` 同樣只來自 current PhysicsManifest：race session 注入 `matchId`／`roundIndex` 與 track manifest digest，physics engine 派生 weather seed，以整數 accumulator、spawn ordinal 與 typed exposure grid 生成最多 50 個 active patch descriptors。world 只在 tire／roller 對固定 track solid 的實際 manifold 接觸套用一次 friction／rolling modifier；renderer、spectator 與 editor preview 消費同一 scheduler／descriptor 形狀，不另跑 RNG。body aero 每幀以六軸 drag area、各向 COP、該點相對氣流與 lift factor 施加有車重上限的 impulse。最大 8 車 ／50 patch 有獨立 60Hz benchmark。

破壞關閉 intact body/colliders、move/conveyor/magnets；碎片一律純視覺，由 `entityIndex + breakFrame + descriptor/presentation version` 重建，並與車輛共用 5 秒生命與淡出參數。RenderFrame／spectator 只傳 bounded visual descriptor，不傳 `physicsActive` 或逐片物理 pose。current SavedState 驗證 intact Rapier enabled 狀態、per-part 溫度 ／ 損毀交易、完整 roster 的 `destructionCounts`、projectile `sourceCleared`、checkpoint 約束的 `routeProgressUm`、weather scheduler／active descriptors 與 envelope lifecycle，任一不一致原子拒絕。最大合法 100 entities／50 destructibles／ 零 fragment body 有獨立 60Hz benchmark 與跨 snapshot conformance vector。決策見 [D-20260814-06](../decisions/D-20260814-06-場地碎片統一純視覺.md)。

### 2.6 Route／respawn surface frame

`RaceProgress.routePositionUm` 保存目前有號弧長，與排名用的最遠 `routeProgressUm` 分開。閉合環線逆向跨起點時，目前位置可為負；圈末與圈首投影的展開須同時有 chassis COM 實際跨接縫平面且交點位於閘門寬度內的證據，不單憑超過半圈的弧長差判定方向。起跑格只初始化目前位置，不取得排名進度；teleport 重定位目前位置與 sweep 起點，不在該幀增加最遠進度。兩個弧長欄位都進 current SavedState 與 hash。合法計圈仍依既有終點與 checkpoint 規則，新圈重設追蹤基準。此處不另定義自交或相近路段的分支歸屬。

回定位在淡出中點先檢查其他啟用車輛的實際碰撞外形，落點接觸或交疊時維持既有凍結動作與處罰狀態，
每影格重試，空出後才搬移。整組剛體的預覽與搬移共用同一變換，查詢位姿由目前 body 與 collider local pose 重建，
不依賴尚未同步的 collider 世界位姿。自己的形狀、停用形狀與 sensor 不構成占用；不以外接盒單獨拒絕。
沒有阻擋時處罰最短 1.6 秒，占用等待會延長，賽程時鐘仍前進，且不暫停車間碰撞。
等待沿用處罰計數，首次被阻擋的完整姿態保存為 current SavedState 的 `pendingRespawn` 並納入 hash，
避免等待期間被推動後改選落點；成功搬移後清空，不另建非決定性預約表；見 [D-20261016-01](../decisions/D-20261016-01-回定位等待空出的實際落點.md)。

`TrackConfig.route[]` 與 `respawnPoints[]` 都保留 Empty 的完整 world frame：local `-Z` 是 forward、
local `+Y` 是 up。Hermite sample 的 up 先在相鄰 authored up 間插值，再投影到 sample tangent 的
正交平面；runtime 的中心線最近點必須逐條預採樣**線段**做夾限投影，不得以最近 sample 點替代，
並以同一投影參數連續插值 half-width、tangent 與 up。退化 fallback 只依 authored frame 與固定軸序，
不可讀 camera 或 gravity。起跑格沿第一個 sample up 抬升 `START_GRID_LIFT_M`，所有 spawn／teleport quaternion 同時對齊車輛 local `-Z／+Y`。所有車同縱向，slot s 的 lateral offset 固定為 `(s-(N-1)/2)×START_GRID_CELL_WIDTH_M`，沿 surface-frame right 左右對稱；`N×cell width > RP1.width_m` 時 admission／runtime 同式拒絕。引擎只接受明確 `{slot, playerCount}`，正式賽不得以 load order 推斷 slot。這使 bank、側牆、
倒掛、垂直段與 360° 迴圈不被世界重力拉回水平；詳見
[D-20260808-01](../decisions/D-20260808-01-route與respawn完整surface-frame.md)、[D-20260814-20](../decisions/D-20260814-20-多人可驗算起跑格.md)。

### 2.7 場地靜態碰撞體分段

場地 solid 幾何依 `(materialId, sourceNodeIndex)` 分成最多 `TRACK_COLLIDER_REGION_COUNT_MAX` 個
region；region 以材質字串的 UTF-16 碼元序、再以 source node index 排序，collider 建立順序跟隨此序，
不得使用依執行環境 collation 而異的 `localeCompare`。每個 region 再依 admitted PhysicsManifest 的
`collision` 宣告切成 piece，每個 piece 一顆 fixed collider：

| piece | 來源 | 切法 | collider |
| --- | --- | --- | --- |
| 牆段 | `collision.wallStrips` 宣告的 solid 節點 | 相鄰兩環之間＝一段；短段沿條帶合併到 ≥ `TRACK_WALL_SEGMENT_LENGTH_M`，合併後不超過 `TRACK_WALL_SEGMENT_LENGTH_MAX_M`（單段本身超過上限仍為一個 piece）；三角歸屬見 [場地.md §8.7](../建模參數/場地.md#87-碰撞體分段collision-區塊選填) | `trimesh`，旗標 `FIX_INTERNAL_EDGES` 加 `BOUNDARY_EDGES_AS_INTERNAL`（256） |
| 單顆 | `collision.singleColliderNodes` 列出的 solid 節點（牆宣告不吻合而退回） | 不切：整個 region 一個 piece | `trimeshWithGhosts`，旗標 `FIX_INTERNAL_EDGES`，鬼三角為空 |
| 地面塊 | 其餘 solid region，同材質者先合併為一個 region | 合併後依世界 XZ 原點對齊、邊長 `collision.groundCellM` 的格切塊；三角以質心歸格；相鄰節點貼合的埋藏面剔除 | `trimeshWithGhosts`，旗標 `FIX_INTERNAL_EDGES`；鬼一環＝與本塊可碰撞三角共享邊的他塊三角 |

- 切分是純函數：頂點先以 1e-6 m 焊接，每個三角取字典序最小的循環旋轉（保留繞向），再依（分組鍵、
  頂點索引）排序；輸出與輸入三角順序無關，兩次呼叫逐位元相同。piece 總數上限
  `TRACK_COLLIDER_PIECE_COUNT_MAX`（含）；admission 與 Stage 3 以同一套切分純函數（`countGroundPieces`／
  `countWallStripPieces`／`countSinglePieces`）先計數拒收，建立 world 時再檢查一次（fail closed）。
- **單顆退回**：哪些牆宣告退回單顆由 admission 推導決定（與 Stage 3 共用 `resolveWallStrips`，判定見
  [場地.md §8.7](../建模參數/場地.md#87-碰撞體分段collision-區塊選填)），結果只以節點名寫進 manifest；
  runtime 不重判。單顆 piece 同樣焊接、正規化排序，canonical key 不變，piece group 照常派發（單一
  成員）。manifest 列出的節點若不是 DFS 首見的同名 solid 節點，載入失敗（fail closed）。
- **邊界邊旗標**（牆段）：邊界邊，包含條帶兩端的真開口邊，一律夾成唯一鄰面法線，跨段縫不產生
  假稜。代價是牆末端也被當成內部邊，車沿牆滑出牆端時留有約 1 mm 的穿入尾巴（issue 001048）。
- **鬼三角**（地面塊）：鬼三角只參與擬法線計算，不進 BVH、接觸或拓樸鍵，讓塊邊界取得真鄰面法線、
  可容許任意曲面。鬼一環只收共享邊三角，塊角頂點的擬法線與整片網格略有差異（曲面上的
  point-containment 微差）。鬼三角不用於牆段：用在牆上會抬車。
- **圓柱曲面支撐線段**：vendored parry witness 以 GJK 見證點的方位角定向圓柱／圓錐的端蓋方形近似；曲面線段則依
  （投影後的）接觸方向定方位角。內部邊的法線約束把方向投影成面法線後，見證點仍停在朝向邊的方位，曲面線段若跟著
  見證點就會被裁到邊上、回報不存在的穿入，輪胎每跨一片共面三角形就被頂起
  （[D-20261031-07](../decisions/D-20261031-07-圓柱曲面支撐線段依法線方位.md)）。
- **同材質地面合併**：鬼三角只能在同一個 region 內推導；分段鋪設的路面節點（各自封閉的方塊或路段）在
  節點縫上沒有鬼三角，頂面邊是 90° 的真稜，輪胎跨縫被頂起。runtime 與 admission 計數都先把同材質、
  非牆條帶、非單顆的 solid region 合併成一個 region（`sourceNodeIndex` 取組內最小者，canonical key 與
  piece group 隨之以材質為單位），再焊接、切塊、推導鬼三角。合併時剔除跨節點的埋藏面：與另一節點的
  三角共面、法線反向，且整片被這些三角的聯集蓋住者（投影到自身平面逐一裁剪、剩餘面積不超過容差；候選以
  AABB 重疊篩選、不要求共用頂點）；部分被蓋住者（相鄰節點寬度不同的接縫、小方塊坐在大底板上）只保留減去
  全部候選後的外露碎片，碎片超過上限時整片保留；同一節點內刻意做成雙面的零厚度面不受影響
  （[D-20261031-06](../decisions/D-20261031-06-同材質地面節點合併切塊.md)、
  [D-20261104-04](../decisions/D-20261104-04-埋藏面以整片覆蓋判定並保留外露碎片.md)）。
- **piece group**：`addTrack` 依 canonical key `track:material:sourceNode` 首次出現的順序從 1 起派發
  group。kernel 對「同一動態 collider × 同一固定 body × 同一非 0 group」的多顆 collider 合併
  manifold，成為一個 solver cluster（leader＝有 manifold 的最小 handle piece），等同拆分前單顆
  trimesh 的 per-pair clustering；否則同一接觸平面在縫上成為兩個冗餘約束，能力邊界的起步會卡死。
  group 0 行為與未分組逐位元相同；leader 換手時的 warm start 是近似（issue 001049）。
- **聚合語意**：damage、wear ledger 與材質診斷以 canonical key 聚合，多個 piece 即一個 region。
  碰撞 started 事件以（trackId, canonical key）聚合：依原生事件順序維護每組的接觸配對數（某配對本幀
  第一個事件為 stopped＝幀初已接觸、計入起始值），只有計數 0→1 的 started 才發出，同一配對同幀先
  stopped 再 started（分離後重新接觸）不會被吞；換手（計數歸零後緊接著由另一配對 started，kernel
  依此順序送出）屬同一接觸的延續、不發出。同幀同組多次發出時只留撞擊能量最大者。判定只讀本幀
  事件、不保留 JS 狀態，restore 後與 live 執行一致。
- 行為與成本由三治具品質閘（`src/physics-engine/track-collision-gates.spec.ts`，`pnpm test:gates`
  以 `O4_RESEARCH_GATES=1` 跑重格）與成本守門（`src/testing/performance/track-pieces-performance.spec.ts`）
  看守；判準形式與偵測力限制見
  [D-20261021-01](../decisions/D-20261021-01-場地碰撞體分段與邊界法線機制.md)，軌跡判準的自散視界
  不超過全部執行都還在場上的共同幀（離場翻滾段不列入，
  [D-20261101-03](../decisions/D-20261101-03-場地閘牆格軌跡視界截在在場上幀.md)）。

### 2.8 bounded-step 接受條件與細分停損

每幀先以兩個半幀試算（`BOUNDED_STEP_INITIAL_SPLIT`）。一段試算的接受條件：原生 `jointConstraintErrors`
的兩個值都 ≤ `BOUNDED_STEP_TOLERANCE_M`（0.2 mm），且 CCD 查詢沒有未決（`needsSubdivision`）。第一個值是
關節錨點的線性誤差（幀末與子步峰值取大者），第二個值是旋轉表面位移（非自由軸角誤差乘 body2 包圍半徑，
`2r·sin(θ/2)`）；原生只回傳全世界的最大值。被拒時還原並二分重試，深度上限 `BOUNDED_STEP_DEPTH_LIMIT`
（10），全部分支共用最多 `BOUNDED_STEP_TRIAL_MAX`（63）次試算，用盡即整幀失敗。四個值都是
physics-pinned 常數，改值會改變軌跡（[D-20261028-05](../decisions/D-20261028-05-bounded-step接受容差放寬至0.2毫米.md)）。

半幀起跑是薄目標品質的一部分，不是成本上的保守設定：D-20261027-02 的動態薄目標保證只在兩個半幀上
驗證，整幀起跑時自旋刀片打 2 mm 板 7 次中 7 次嚴格穿過。成本下限因此是每幀 2 次試算；要再降只能從 CCD
或原生單步成本下手。

試算被拒（接受指標超出容差）時細分重試。連續
`BOUNDED_STEP_STALL_FRAMES` 幀需要細分（有拒絕試算，或停損中仍超出容差）後，下一幀起接受不細分的
初始分段試算（原生無法判定者仍細分），直到某幀不再超出容差才恢復正常細分。判定只依幀數與試算
結果，不依牆鐘時間。連續計數是共識狀態，存在 SavedState envelope `boundedSubdivisionRun`，非零時
納入 state hash。計數範圍是**世界層**單一值：全世界任一車需要細分即計入，停損時全世界該幀接受
初始分段試算。Rapier 原生 `jointConstraintErrors` 只回傳全世界最大誤差，無法歸屬到單一車輛；分車
計數需要 vendor 變更或逐關節讀取成本（[D-20261025-01](../decisions/D-20261025-01-持彈碰撞體切換與可選彈體獨立耐久.md)）。
觸發時全場同幀精度略降，決定性與公平不受影響；八車同場可能誤觸發，playtest 觀察後再評估分車。
不進共識的純診斷計數由 `PhysicsEngine.boundedStallDiagnostics()` 對外提供：停損觸發幀數
（`stallFrames`）、其中接受超出容差試算的幀數（`acceptedFrames`）與最長連續細分幀數
（`longestRunFrames`）。

### 2.9 接觸點 normal 求解順序

Simplified（twist）接觸約束的 normal 求解與點序無關（[D-20261027-01](../decisions/D-20261027-01-接觸點求解順序對稱化.md)）。逐點 Gauss–Seidel 時，
先解的點固定多拿負載，而 manifold 排序基底綁世界軸，左右輪先解的點互為鏡像，形成依場地朝向而變的淨偏航。
每個 SIMD lane（一個 manifold）依作用點（有效質量 > 0，反彈另需通過反彈資格閘）分類：

- 恰為點 0、1 作用：精確 2×2 MLCP（上游 block-solver 的四候選序，帶逐點 cfm；耦合項與右端項寫成對兩點
  交換對稱）。`det ≤ 0.01·k'11·k'22` 時退回逐點。
- 其他兩點以上作用：從同一個起始速度做正序與反序的逐點求解，各點衝量取兩者平均，再依點序套用差量。
- 至多一點作用：逐點，與原逐點求解逐位元相同。

biased 與 relax pass 都經過 `ContactWithTwistFriction::solve`；反彈（`apply_restitution`）先備妥各點的臂、
有效質量與種子，再以同一規則求解。warmstart、`update`、`refresh_rhs_wo_bias` 與點序無關，不變；Coulomb 與
generic 路徑不變。門檻 0.01 與正反平均是 kernel 內固定規則，只用加減乘除、`simd_inv` 與乘 0.5。

設定以原生整合參數 `contact_normal_order_policy` 承載（1＝上述規則、0＝逐點），由
`PHYSICS_CONTACT_NORMAL_ORDER_POLICY` 在 bounded profile 之後回填；進 Rapier snapshot，immutable world config
與 restore 皆驗證，差異原子拒絕。

本規則只消除點序造成、與世界朝向相關的偏差。非圓輪（方、六角、星形等）的接地點隨滾動變化，偏航屬造型
本身的混沌，不保證改善；起步四向偏差另由 issue 001085 處理。

### 2.10 回合終局欄位與流內離場

`RaceProgress` 保存三個回合終局用的已雜湊欄位（issue 001117、001115），讓終局只由已確定、可快照的模擬狀態決定。三者都是 StepOutput.frame 語意（該步步進後的幀號），未發生時為 `null`：

| 欄位 | 寫入規則 |
|---|---|
| `quitAtFrame` | 步進輸入含該車 peer 的 `leave` 事件時寫入（＝該步 StepOutput.frame），只承認第一次；或由 `markQuitAtStart` 寫 0 |
| `lastMovingFrame` | chassis 線速或角速任一達回合低速門檻（`exceedsRoundSettleSpeed`，取 ≥）的最後一幀；所有未 `physicsRetired` 的車每步都評估，含已完賽與已離場者 |
| `leftLiveAtFrame` | 首次完賽、battery／motor 失能、chassis `physicsRetired` 或 quit 的那一幀；寫入後不變，`markQuitAtStart` 寫 0 |

- **SavedState 與 hash**：三欄都進 current SavedState，載入時只檢查範圍（`null`，或 0 到快照幀之間的整數），越界原子拒絕。state hash 的 race 陣列在既有欄位之後依序附加三者，`null` 編為 −1。
- **quit 車輛**：之後該車的輸入一律以空輸入模擬，不影響狀態與 hash；進度凍結，不推進 route、計圈或完賽，衝線不算完賽；場地 pass 只保留 deploy zone，出界處罰、KillZone 回定位，以及 chassis 同幀斷裂時的 swept finish 補判都略過。車體仍留在物理世界，照常參與碰撞。
- **沒有場地 config**：沒有 race progress 的車不記錄 leave，也不寫這三欄。
- **`markQuitAtStart(vehicleIds)`**：只能在 frame 0、第一次 step 前呼叫（否則拋出例外），把指定車的 `quitAtFrame` 與 `leftLiveAtFrame` 設為 0，供上一回合已流內離場的 peer 在本回合起點即為退出（[network-sync.md §7.4](network-sync.md)）。沒有 race progress 的車直接略過、不拋出例外，與上一條「不記錄 leave」一致。
- **消費端**：終局判定只讀已確定記錄所附的這些欄位，規則見 [賽內機制.md §3.1](../賽內機制.md)，算式見 [算式表 §20.1](../算式表.md)。

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

比賽、local-test 與觀戰 replay 的固定 timestep 迴圈在模擬 Worker 內執行（[network-sync.md §5.1](network-sync.md)）：以 `performance.now()` 差值累加 `realDeltaSeconds`（單次上限 0.25 s），以 `setTimeout` 排下一次 tick，不依賴 `requestAnimationFrame`；`MAX_SUBSTEPS` 照樣限制每次 tick 的補步數。Worker 計時器在背景分頁不受節流，背景暫停由主執行緒轉送 `visibilitychange` 主動通知，背景期間不累積補步。環境沒有 Worker 時同一迴圈改由主執行緒 rAF 驅動。正式賽在固定步之外另有兩種本機追加步：落後端快進的額外步（[network-sync.md §7.5](network-sync.md)）與 catch-up 載入後的分 tick 追趕（[network-sync.md §7.1](network-sync.md) 第 6 步），兩者都不動 accumulator。

視覺插值：`visualPos = lerp(prevState.position, currentState.position, renderAlpha)`（純表現、不影響共識；主執行緒以 Worker 回傳的 render frame 插值）。Worker 的 accumulator 不跨執行緒，`renderAlpha` 由主執行緒自算：viewport 保留最近幾個 render frame，維持一個顯示用模擬時刻，每個顯示幀依牆鐘乘上最近一秒的模擬進度率推進（以視窗內到達樣本最小平方法擬合，成批到達不讓估計擺動；Worker 被搶占、模擬慢於牆鐘時顯示時刻才不會追上最新幀而退化成直出），取包夾該時刻的兩幀，alpha＝顯示時刻在兩幀間的比例（位置 lerp、四元數 slerp；不外推）。顯示時刻的目標落後步數依最近一秒到達事件間隔的 P90 乘進度率換算、夾在 1～4 步（到達規律時 1 步；裝置跟不上、固定步迴圈補步成簇時放大，避免顯示時刻追平最新幀而停格再跳）；落後不足目標時以 0.9 倍推進重建緩衝、超出目標一步以上時以 1.1 倍追回，落後超出目標兩步以上或幀號倒退時重新對齊（`src/viewport/race-frame-interpolation.ts`）。跟車相機以插值後位姿為目標。

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
| 賽道進度                 | checkpoint 與 KillZone 使用 chassis COM segment-AABB；RPn 使用 authored surface frame 的正向 segment-plane crossing；`routeProgressUm` 保存 checkpoint 約束下單調不退的 route arc-length；`finishArmed`／previous COM／量化進度／完賽幀進 current SavedState 與 hash；流內離場凍結與回合終局欄位見 §2.10 | [零件與共用介面.md §5.4](../建模參數/零件與共用介面.md#5-empty-node-命名約定) |
| 流體 deploy zone         | 場地 authored sensor 與 fluid projectile 首次合法場地接觸啟用的預配置圓形 sensor 共用 canonical zone key；同 zone／part 多 collider 去重，grip／sticky 取最強，burn／freeze／corrosive 依 distinct zone 疊加；source peer、anchor 與 in-flight／deployed／retired 進 current SavedState | [算式表 §6.4·§8](../算式表.md)  |

每回合載入該回合的車 + 場地 = 全新世界,以「車輛回合初始狀態」開始（fatigue 0、temperature = 場地環境溫、broken false、battery 滿、彈藥滿）；回合獨立、不共享 runtime 狀態（換新車 + 新世界的自然結果、非 reset 流程，回合數可變 N）見 [算式表 §11](../算式表.md)。

## 8. Determinism 保證

| 面向                 | 作法                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| collider／joint 排序 | 場地 region 依 `(materialId, sourceNodeIndex)`（材質字串碼元序）、region 內 piece 依分組鍵與正規化三角序、part proxy 依 source node index、接觸依 canonical collider key 固定建構／累加；tire／roller Revolute joint 依 vehicle／原始 part index 固定建構                                                                                                                                                                                                                                                                                                                                |
| 數值精度             | 全物理 `f32`（避免 f64 跨平台差異）；material lookup 純函數 O(1)                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 運算白名單           | 共識路徑限 ECMAScript **正確捨入**運算：`+ − × ÷`、`Math.sqrt`、整數取捨（round / floor / ceil / trunc / abs / min / max）；規格標「implementation-approximated」的函數（三角 / 雙曲 / 指對數 / pow / cbrt / hypot）與 `**` 運算子（pow 語意）禁用——跨引擎可差 1 ulp（[資料系統.md §17](../資料系統.md) 同族不變式）。替代法：整數次方寫連乘、衰減線性化 `1−(1−decay)×dt`、朝向 shortest-arc quaternion、立方根定次 Newton（`deterministicCbrt`）。ESLint 強制：`src/physics-engine/**` 禁 `**` ＋ `Math` 黑名單（測試檔豁免） |
| sim state            | `fatigue` / `temperature` / `broken` 為 sim state，跨 peer deterministic；輪組 broken 於幀末停用自身物理並重算 primary 質量屬性，不另切換接觸係數。respawn 不修復，新回合全新 world 才回 false                                                                                                                                                                                                                                                                                                                                                  |
| handle 不穩 fallback | 若 Rapier upstream 改變 handle 順序 → 改走 sub-mesh fingerprint 作 collider userdata（[程式架構.md §6.3](../程式架構.md)）                                                                                                                                                                                                                                                                                                                                                                                                     |
| 接觸係數合成         | collider handle O(1) 對映 admitted material／wear capacity；一般 friction／restitution 採 `Average`，tire／roller restitution 採 `Min`。牽引、rolling resistance、接觸熱與 tire wear 共用 canonical manifold 聚合；磨耗只讀實際 rolling／tangential impulse 與相對速度。規則見 [D-20260811-04](../decisions/D-20260811-04-逐Collider材質接觸與滾動阻力.md)、[D-20260811-10](../decisions/D-20260811-10-逐Region接觸耗散輪胎磨耗.md)                                                                                            |
| 單執行緒             | deterministic build 與 SIMD / parallel 互斥；主站無 COOP/COEP → SAB 不可用 = **物理必然單執行緒**（[程式架構.md §6.6](../程式架構.md)）                                                                                                                                                                                                                                                                                                                                                                                        |

## 9. 效能目標

即時效能預算（L0／L1／L2 三層口徑、每幀實付定義、量測情境）只寫在 [network-sync.md §8](network-sync.md)；基準 ID 與回歸閘見 [testing.md §8](testing.md)。

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
