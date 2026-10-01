---
type: canon
domain: ["UGC版權"]
summary: 上傳／編輯／送出（本機測試／上鏈／可編輯 GLB）／Fork
authority: null
slug: null
---

# UGC 機制

> **本檔角色**：UGC 上傳 / 編輯 / 送出（本機測試 / 上鏈 / 可編輯 GLB）/ Fork 的完整流程與規範。
> 欄位細節見 [建模參數.md](建模參數.md)；材質檢核見 [材質表.md §4](材質表.md)；上鏈資料結構見 [資料系統.md](資料系統.md)。

## 1. 三階段工作流程

```text
上傳 (Stage 1) → 編輯 (Stage 2) → 送出 (Stage 3：本機測試 / 上鏈 / 可編輯 GLB)
```

UGC 資產（零件 + 場地共用）的創作流程為上述三階段。**組裝（Loadout）是另一個介面操作、不屬此流程**：已上鏈的零件如何組裝成車，見 [車輛組裝.md](車輛組裝.md)。（「組裝」≠「賽前」；賽前是從車位選已組好的車、無編輯。）

## 2. Stage 1 — 上傳

### 2.1 流程

1. UI 先選 `type`（chassis / body / tire / motor / battery / roller / chip / weapon / track）
2. 上傳 GLB 檔案
3. 寬鬆檢核（GLB 合法）
4. type 定案：current marker 的精確 type 是身分權威，UI 不可覆寫；只有無 marker 的一般外部來源才依 UI 選擇、GLB 輔助 type 與幾何解析走 5 種情況。[runtime.md §10.1](建模參數/runtime.md#10-stage-對應的處理流程) 是判定矩陣權威；定案後 type 鎖死

### 2.2 Stage 1 拒收條件

Stage 1 拒收條件的唯一權威是 [流程/UGC上傳.md §3](流程/UGC上傳.md)；本檔不複製
第二份條件表。該表同時涵蓋格式、mesh、external URL／惡意 extras／NaN/Inf、source admission
絕對 ceiling 與 node 名稱重複。禁止材質在 Stage 1 剃除為未指派，Stage 2 提示重新指派，只有
殘留至 Stage 3 才拒收。

### 2.3 寬鬆檢核 vs 嚴格檢核

| 階段    | 檢核強度                         | 拒收後果                            |
| ------- | -------------------------------- | ----------------------------------- |
| Stage 1 | 寬鬆（基本格式 + 大致對齊 type） | UI 提示 + 修正再上傳                |
| Stage 2 | 編輯時即時警告                   | 無拒收（編輯中）                    |
| Stage 3 | 嚴格 schema                      | 拒收後不能上鏈，必須回 Stage 2 修正 |

## 3. Stage 2 — 編輯

### 3.1 自動算第一波（Stage 2 wave A）

**幾何即算**（進 Stage 2 即可，不依賴材質）：

| 計算項                  | 用途                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `volume_m3`             | 質量推算 / motor `auto_input_mw` / battery `auto_energy_capacity_mj` / chip slot 數 |
| `bbox_m`                | AABB 檢核                                                                           |
| `surface_area_m2`       | 散熱公式                                                                            |
| `watertight`            | 體積積分可靠性                                                                      |
| provisional uniform fit | 只作無 marker 來源的 client guidance，不是 canonical 相容性條件                     |
| `decimate`              | 三角形數量過多時自動降階                                                            |

**材質指派後才算**（依賴密度，材質變動時 reactive 重算，見 [§3.4](#34-系統性自動調整)）：

| 計算項                          | 用途                                                   |
| ------------------------------- | ------------------------------------------------------ |
| `mass_g`                        | 部件質量（= volume × 材質密度；組裝時加總驗證整車）    |
| `centroid_m`（物理重心 / 質心） | 多材質時依各 sub-mesh 密度加權；單一材質才等於幾何形心 |

### 3.2 玩家設值

| 欄位                                                                      | 設值方式                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| GLB extras（material / torque_ratio / configured_output_w 等）            | Stage 2 UI 編輯                                        |
| Mount empty 拖放                                                          | chassis 自訂位置 mount + weapon part-side Mount_Weapon |
| 武器設定（weapon_mechanism / weapon_main_mesh_node / weapon_actuators[]） | Stage 2 weapon 編輯器                                  |
| Axis / Pivot empty                                                        | Stage 2 武器編輯器                                     |
| Skill slots（晶片）                                                       | Stage 2 chip 編輯器                                    |

### 3.3 預設填補（「有值用值，沒值給預設」）

對所有可選欄位採此策略：

- 玩家在 GLB extras 已填 → 用玩家值
- 未填 → 用預設值（編輯器自動填補，玩家仍可改）
- 上鏈時嚴格 schema 驗證

預設值清單見 builtin-assets 設計與 [程式參數.md](程式參數.md)。

### 3.4 系統性自動調整

| 場景                                        | 自動處理                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 場地 `lap_mode` 推斷                        | `RP1 ↔ RPn` 中心距 < 1m 且 route ≥ 3 點 → loop，否則 linear（恰 2 點一律 linear）；`open` 強制 linear；玩家可 UI 覆蓋（僅 `fixed` 且 ≥ 3 點） |
| 部件 mass / volume 推算                     | 由 material × volume 自動                                                                                                                     |
| `auto_input_mw` / `auto_energy_capacity_mj` | volume × K 自動                                                                                                                               |
| Chip skill slot 數                          | volume → 1–4 個（階梯門檻見 [零件與共用介面.md §3.6](建模參數/零件與共用介面.md#3-各-part-type-專屬欄位)）                                    |

### 3.5 即時警告（編輯中軟提示）

| 警告                                              | 觸發   | 行動                               |
| ------------------------------------------------- | ------ | ---------------------------------- |
| Mount 位置介於 `MOUNT_AABB_WARN_M` 與 reject 門檻 | 軟警告 | 玩家可繼續，Stage 3 也通過         |
| Mount 間距介於 reject 與 `MOUNT_GAP_WARN_M` 門檻  | 軟警告 | 同上                               |
| Tire / roller mount 軸達 `HINGE_AXIS_WARN_SIN`    | 軟警告 | 同上                               |
| chip skill_slots 總 `allocation_pct` 接近 100%    | 軟提示 | 玩家可繼續（Stage 2 編輯 chip 時） |
| 「水包塑膠」邊界（fluid sub-mesh 在最外緣）       | 軟警告 | 確認後繼續，後果自負               |

### 3.6 編輯器強制互斥

| 規則                                    | 處理                                               |
| --------------------------------------- | -------------------------------------------------- |
| destructible + `physics: "visual_only"` | UI 強制：visual_only 時 destructible checkbox 灰掉 |
| chip 內 skill 重複                      | 拒絕儲存（除非全空）                               |

### 3.7 AI 單一 fused mesh 的材質處理（零件 / 場地共用）

**問題情境**：Tripo / Meshy 等 AI 3D 服務輸出**單一 fused mesh + 單一 PBR material + 單一 baseColor texture**。多材質模型的單位是**水密 sub-mesh（node）**——每個 sub-mesh 各有獨立水密體積，質量 = `Σ(sub-mesh 水密體積 × 材質密度)`、摩擦 / restitution / stress / fatigue / thermal / 磁性皆逐 sub-mesh well-defined（[材質表.md §7](材質表.md)）；瀏覽器編輯器可用平面切割＋封蓋把 fused solid 切成數個水密 sub-solid，也可把 primitive 內原本已各自水密的不連通幾何島，或數個已各自水密的 primitive 分離成 node；另可**拼接**數個水密實體為一資產，故多材質資產可在瀏覽器內完成（見下表與 [編輯器操作.md §2.4](編輯器操作.md)）。

| 情況                 | 材質處理                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **單一 fused mesh**  | = **單一材質**：整顆指派同一材質即可上傳（多數 AI 輸出的正常路徑）                                                                                                                                                                                                                                                                                                                             |
| **要多材質**         | 需有**數個各自水密的 sub-mesh（node）**，三條路徑皆可：①**瀏覽器切分**——平面切割＋封蓋，或沿原本已各自水密的 Primitive／不連通幾何島分離；②**瀏覽器拼接**——先開啟一個資產，再逐次加入另一個水密實體 GLB，以共用 Node TRS 定位後匯出為同一資產；③於 Blender 等外部工具先切好各水密 node 再上傳。每片有獨立水密體積，質量 / 熱逐 sub-mesh well-defined（見 [編輯器操作.md §2.4](編輯器操作.md)） |
| **Stage 2 材質指派** | 對每個 sub-mesh（node）指派材質——**主 / fallback 材質 ＋ 逐 sub-mesh 材質下拉**（見 [編輯器操作.md §2.3](編輯器操作.md)），依 `forbidden_scopes` 自動過濾                                                                                                                                                                                                                                      |

> **體積切分 vs 表面著色**：編輯器切分的是**體積**——沿平面切開後對每個開口邊界環（含中空 / 環狀多邊界環）三角化封蓋，每片成為**封閉水密實體**、封閉體積正確 → 質量正確（整體 Σ 守恆）；切面沿用該片材質。故切分 / 拼接產物皆與「材質 = 水密 sub-mesh、質量 = `Σ(水密體積 × 密度)`」模型一致。純表面色塊分割（open patch、無獨立體積）無法定義 per-region 質量 / 熱，不成立此模型、編輯器不採。切分**僅對水密 node 開放**（非水密無法保證封蓋後體積正確）；目前切分為軸向（X / Y / Z + 位置），拼接加入後共用 Node TRS 位移、旋轉與縮放。候選精修集中於[其他.md](其他.md)。

至少 1 個 sub-mesh 指派材質才能送出（Stage 3 gate 條件之一）。未指派 sub-mesh **fallback 到主 `material`**（[零件與共用介面.md §2](建模參數/零件與共用介面.md#2-glb-root-extras--玩家宣告欄位零件--場地共用) 零件 / [§8.5](建模參數/場地.md#85-材質指派materials-區塊sub-mesh-覆寫) 場地 統一規則；主 `material` 來源 = 玩家指定或最大 sub-mesh 指派，見 [編輯器操作.md §2.3](編輯器操作.md)）並警告。

### 3.8 AI 單一 mesh 的 launch 武器處理（零件）

Tripo / Meshy 出的單一 mesh 不含 `Mount_Weapon` empty，也無法區分 launcher_body vs bullet。Launch 武器需走以下其中一條：

| 路線                      | 適合對象                                 | 流程                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) 純瀏覽器編輯器        | 單一 fused mesh 或已含分離 bullet 節點者 | Stage 2 編輯器加 Mount_Weapon empty；bullet 子節點可用既有獨立節點，或以**切分工具**（軸向平面切＋封蓋，見 [§3.7](#37-ai-單一-fused-mesh-的材質處理零件--場地共用) 與 [編輯器操作.md §2.4](編輯器操作.md)）把 fused 武器切成 launcher_body 與各 bullet 水密片後標記 |
| (b) Blender + Tripo       | 熟 Blender 的創作者                      | Tripo 出基本 mesh → Blender 補 empty + 拆 launcher / bullet sub-mesh → 上傳                                                                                                                                                                                         |
| (c) 多次生成 + 編輯器拼接 | 不要求 launch 父子結構的一般零件／場地   | 先開啟一個 GLB，再逐次加入其他 GLB，以共用 Node TRS 定位後合為單一資產；launch bullet 必須在加入前已位於 `launcher_body` 的內部 hierarchy，拼接不重新掛父層（見 [§3.7](#37-ai-單一-fused-mesh-的材質處理零件--場地共用) 與 [編輯器操作.md §2.4](編輯器操作.md)）    |

零件 / 一般武器（general / magnet）若不含 launch 子彈，可單純 Tripo 出 → Stage 2 補 Axis / Pivot empty 即可。

## 4. Stage 3 — 上鏈

三個出口共用 canonical finalizer。它先攤平 Stage 2 編輯；part 會再跑一次保真減面，確保縮放、切割等後續 mesh 操作仍落在 100k hard cap 內，然後才重算 Wave A/B、檢核、標記與壓縮。一般 UGC 的零件三角形目標預設為 90k、貼圖最大邊預設為 4096px；Editor 可為下一次定稿明示較小的輸出目標，三個出口必須快照同一組值。這些是輸出品質／容量參數，不改材質、質量、重心、慣量、尺寸或造型合法範圍。current canonical marker 的精確 type 在重開與 fork 時為身分權威，不允許 UI 覆寫；出口 C 另由 canonical 成品產生不帶 marker／衍生快取的可編輯 GLB，重新匯入時依一般外部來源重新計算（[D-20260808-05](decisions/D-20260808-05-GLB匯出為可編輯衍生檔.md)）。

### 4.1 自動算第二波（Stage 3 wave B）

| 計算項                            | 用途                                                   |
| --------------------------------- | ------------------------------------------------------ |
| Voronoi 碎片預烘焙                | 破壞時碎裂                                             |
| Aero 六軸 drag area／各向 COP     | body 空氣動力                                          |
| typed exposure                    | 沿重力方向重建每格第一個合格靜態 solid 表面            |
| `auto_feature_deviations`         | 只量測表列 mount／hinge 介面特徵的絕對公差，不限制外形 |
| `auto_thermal_limit` weakest 合成 | 多材質 part 過熱閾值                                   |
| Schema 嚴格檢核                   | 必填欄位 / 範圍 / 互斥                                 |

### 4.2 Stage 3 拒收條件

| 條件                                                                                | 原因                                                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 必填欄位缺失                                                                        | 編輯未完成                                                                                                   |
| 最重 / 最輕材質密度比 > 50:1                                                        | 約束違反（單一零件內多材質密度差）                                                                           |
| Mount 位置違反 `MOUNT_AABB_REJECT_M`                                                | 拒收                                                                                                         |
| Mount 間距違反 `MOUNT_GAP_REJECT_M`                                                 | 拒收                                                                                                         |
| Tire / roller mount 軸違反 `HINGE_AXIS_REJECT_SIN`                                  | 拒收                                                                                                         |
| destructible + visual_only 同時設                                                   | 拒收                                                                                                         |
| 含禁止材質（依 forbidden_scopes / allowed_part_types）                              | 拒收                                                                                                         |
| chip skill 重複                                                                     | 拒收                                                                                                         |
| chip skill_slots 總 allocation_pct > 100%                                           | 拒收                                                                                                         |
| weapon active 但缺 `weapon_mechanism` / `weapon_main_mesh_node`                     | 拒收                                                                                                         |
| `general` actuator 缺 `weapon_max_angle_deg`（或驅動 pivot / 驅動體總數超上限）     | 拒收                                                                                                         |
| `general` actuator payload 非 `mesh_node` / `chain` 二選一（缺 payload 或兩者並存） | 拒收                                                                                                         |
| 宣告 fork 且 `parent` 是仲裁黑名單或 similarity-pending 待審作品                    | 拒收（Provider-scoped DMCA 不改 client parent 資格；重製正道 = 大幅修改後以原創上傳，[版權.md §4](版權.md)） |

> **整車質量 / 整車 AABB / 武器-chip 裝載**等屬**組裝（loadout）層**約束，在 [車輛組裝.md](車輛組裝.md) 檢核，不在零件上鏈階段。

### 4.3 上鏈動作

1. 以 canonical UnixFS profile 匯入 GLB（CIDv1 + sha2-256、1 MiB fixed chunks、balanced、raw leaves、無 metadata），寫入完整 exact block set；≤ 1 MiB root 為 raw，較大 root 為 dag-pb
2. ledger 寫一筆 UGC asset record（CID + 創作者簽章 + 元資料）
3. **CID 鎖死、GLB extras immutable**

### 4.4 上鏈後可變欄位

少數元資料**不寫進 GLB extras**（避免改變 CID）。上傳事件以 `presentation` 建立 revision 0；後續由原作者另簽 `UgcMetadataUpdateEvent`，不改寫原 upload event：

- 顯示名稱
- 描述
- tag

更新採 full replacement、只作用 exact CID，必須是 current revision + 1，且與上次成功 presentation 至少相隔 1 小時。冷卻只使用事件套用時的 canonical `state.derivedAt`，成功後 `presentationUpdatedAt` 記錄同一 effective time；revision 0 亦以 upload 套用時的 `state.derivedAt` 建立錨點。live 尚未 fold 時必投影 `max(mirrorHead.derivedAt, event.timestamp)`，不得只讀停滯的 mirror head；事件 `timestamp` 僅供簽署、稽核與 fold 單調推進，不得直接取代 canonical clock 製造更新間隔。name ≤256 UTF-8 bytes；description ≤500 code points 且 ≤2000 UTF-8 bytes；tags ≤32、每筆 ≤64 UTF-8 bytes；皆要求 NFC、拒絕 control／format code point，UI 只以純文字呈現。首次發布 UI 必須把三欄放入 revision 0 `presentation`，不得塞回 immutable metadata；既有作品的編輯入口只對目前解鎖的原作者顯示。更新採 single-flight，append 後必刷新權威 fold state 並確認 revision，未被 admission 採用不得顯示成功，且失敗須保留表單。retired／similarity-pending 可改；blacklisted 不可改；不沿版本 successor 傳播。`metadata_update_minor` 預設 0，若治理日後調高，扣款與更新原子套用。**創作者署名 / fork 關係不在此列 = immutable**，見 [§7](#7-ugc-asset-元資料分層)、[D-20260816-08](decisions/D-20260816-08-UGCPresentationMetadata可變修訂.md) 與 [D-20260818-04](decisions/D-20260818-04-UGCPresentationCanonicalClock投影.md)。

### 4.5 CAR 保存與本機補回

上鏈 UGC 的詳情頁可下載標準 CAR v1 保存包。保存包固定**一個 root**，並包含該 canonical
UnixFS root 的完整可達 block set；frame 順序不具語意。logical GLB 上限 80 MiB、單 block 上限
1 MiB、完整 block 數上限 81。匯入會逐 block 驗 CID digest、重建完整 GLB、以相同 profile
重新匯入並要求 root 與 block set 完全一致；多 root、重複 block、缺 block、額外不可達 block、
非 canonical UnixFS、截斷或 digest 不符皆拒絕。

任何持有者都可將合格 CAR 匯入本機 Helia，精確補回原 CID。此動作不是 Stage 1 上傳或 Stage 3
上鏈：不建立 `ugc-upload`、不改作者／血緣、不收費，也不進入相似度、文字或作品合法性檢核。
匯入不依賴登入、帳本、pinning 或連線；只影響目前裝置的內容庫，成功後按一般 LRU 自然淘汰。
專案仍在開發中，只有此 canonical profile；不提供舊格式雙讀、alias 或 migration。

CAR 與「匯出可編輯 GLB」目的不同：CAR 保存 canonical UnixFS blocks 與原 CID；GLB 匯出則從
已驗證 CID 的完整 canonical bytes 展開 Draco、把 KTX2 轉成內嵌 PNG，移除 marker 與衍生快取，
供 DCC 修改。editable GLB 不承諾原 CID，重新匯入必須重走 Stage 1–3。

### 4.6 資產庫／入庫

公開 UGC 卡片與詳情頁可將 `part | track` 加入目前身份資產庫：入庫免費、沒有數量帽，只受裝置
quota 限制。可選立即取回或稍後取回；名單存在但 canonical bytes 缺席／驗證失敗時為「待取回」，
不可裝配或進正式賽設定。資產庫不接受 `builtin:`、`local:`、takedown、similarity-pending 或類型
不完整作品；UGC 不另設收藏概念，玩家收藏清單仍只用於玩家公開頁。

## 5. Fork 機制

### 5.1 目的

允許玩家**衍生**他人作品，原作者自動分潤。

上傳即接受 Fork，所有上鏈 UGC 一律可衍生；沒有逐作品 `allowFork` 開關，也沒有事後關閉事件。
這是上傳授權契約的一部分，不取代類型、修改幅度、黑名單與 similarity-pending 守門。
見 [D-20260808-04](decisions/D-20260808-04-上鏈UGC一律接受Fork.md)。

### 5.2 流程

```text
原作 CID:A
  ├─ Fork 1（CID:B，parent=A）   創作者 X
  │   ├─ Fork 1.1（CID:C，parent=B，血緣=[B,A]）  創作者 Y
  └─ Fork 2（CID:D，parent=A）   創作者 Z
```

每筆 fork 上鏈事件（`UgcForkEvent`）帶：

- `childCid: CID` / `parentCid: CID`（直接父節點；**無 ancestors 欄**）
- 衍生創作者簽章

> **血緣 ＝fold derive、事件自報不可信**：royalty 血緣（`[parent, grandparent]` 至多 2 筆；`[0]=parent`、`[1]=grandparent`；深度 1 只有 `[parent]`）由 `UgcUploadEvent.metadata.parentCid` 的 parent 邊在 fold 端推導（`forkLineage`）——不吃事件自報的血緣串。**為何只到兩層**：三層分潤 = 本人 70 / parent 20 / grandparent 10，本人即 record 自身，故 derived record 只需 parent + grandparent 即可一筆算清全部 royalty 收受者（無需再抓父節點 record）。更深的血緣（曾祖以上）非 royalty 對象，要瀏覽族譜時靠 `parent` 邊逐跳上溯重建（見 [資料系統.md §4 ForkTreeDerivedState](資料系統.md)）。

### 5.3 Fork 約束

Fork 授權、血緣、深度與經濟政策只由 [版權.md §3–§4](版權.md) 定義；修改幅度的
`PhysicsFingerprint` 欄位、聚合與跨版本處理只由
[程式架構/ugc-fork.md §3–§4](程式架構/ugc-fork.md) 定義。mesh 幾何指紋不參與 fork
修改幅度，只服務反複製相似度。

原創判定依資產類型聚合：剛體類 `rigidDiff` 取所有物理差異維度的**最大分量**，避免顯著單維變更被平均稀釋；非剛體類 `functionalDiff`／`chipDiff` 採 **OR 邏輯**，mesh 外觀或 sidecar 功能任一達門檻即算有意義修改。精確欄位、比較順序與跨 `fingerprintVersion` 行為見 [程式架構/ugc-fork.md §3–§4](程式架構/ugc-fork.md)。

### 5.4 三層分潤

分潤角色與 fork 血緣政策只由 [版權.md §3](版權.md) 定義；百分比公式與整除行為只由
[算式表.md §15](算式表.md) 定義，治理值由 [economy-config.md §17](程式參數/economy-config.md#17-economy-configorbitdb-動態治理) 提供。

### 5.5 反複製

反複製防護層、相似度分流與救濟路徑只由 [版權.md §5](版權.md) 定義；本檔不重列。

## 6. 上傳 / 編輯 / 送出 三階段對照

三階段與本機測試／上鏈／可編輯 GLB 三出口的狀態、CID、檢核與燒幣對照只由
[流程/UGC上傳.md §1–§5](流程/UGC上傳.md) 定義。組裝（Loadout）是另一個本機介面，
見 [車輛組裝.md](車輛組裝.md)。

## 7. UGC asset 元資料分層

| 欄位                               | 寫入位置                                                           | 變動性                                  |
| ---------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| GLB binary                         | IPFS（內容 = CID）                                                 | ❌ immutable                            |
| GLB Root Extras（結構性 metadata） | 同上                                                               | ❌ immutable                            |
| 顯示名稱 / 描述 / tag              | `UgcUploadEvent.presentation` revision 0＋`UgcMetadataUpdateEvent` | ✏️ exact CID 可改；每次更新由原作者另簽 |
| 創作者署名 / fork 關係             | ledger record                                                      | ❌ 不可改                               |
| Rating / 使用統計                  | ledger 衍生狀態                                                    | 自動累積                                |
| 信譽分數                           | ledger 事件鏈                                                      | 自動累積                                |

## 8. 工具

UGC authoring 與檢核工具名錄只由 [流程/UGC上傳.md §7](流程/UGC上傳.md) 維護；
技術選型與 runtime loader 見 [使用技術.md](使用技術.md)。

## 9. 場地專屬流程差異

三階段框架（[§1](#1-三階段工作流程)–[§7](#7-ugc-asset-元資料分層)）零件 / 場地共用，但場地有以下特殊規則：

### 9.1 Stage 1 場地特殊條件

| 條件         | 限制                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| GLB 檔案大小 | ≤ 80 MiB（強制 Draco 幾何 + KTX2 紋理壓縮，[§9.3](#93-stage-3-場地特殊嚴格檢核) Stage 2 自動補；Stage 3 拒收未壓縮） |

> 零件／場地共用的「≥1 mesh」、安全性（無可執行內容／外連 URL）、來源總三角形數 3M
> 絕對 ceiling 與其他 Stage 1 檢核見 [§2.2](#22-stage-1-拒收條件) 所指向的唯一權威表；來源超過
> 3M 時 Stage 1 拒收。

AABB、Empty 完整度與 extras schema 不在 Stage 1 檢核（Stage 2 處理）；tris 在 Stage 1 只檢核
來源總量 3M 絕對 ceiling，編輯後超量才由 Stage 2 decimate。

### 9.2 Stage 2 場地特殊自動調整

| 觸發                        | 動作                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| AABB > 500m × 500m × 100m   | 等比例縮放至上限                                                                                                                            |
| 編輯操作後 Visual tris > 3M | Stage 2 自動 decimate；原始來源若已超 3M 已由 Stage 1 絕對 ceiling 拒收                                                                     |
| Collider 缺失               | 從 visual mesh 衍生（auto-decimate 至 500k）                                                                                                |
| Watertight 失敗             | remesh / convex hull fallback                                                                                                               |
| 沿 route 算最窄寬度         | 寫 `auto_narrowest_path_m`                                                                                                                  |
| 玩家上限                    | 由 `RP1.width_m` 自動推導                                                                                                                   |
| `lap_mode` 自動推斷         | `RP1 ↔ RPn` 距離 < 1m 且 route ≥ 3 點 → loop，否則 linear（恰 2 點一律 linear）；`open` 強制 linear；玩家可 UI 覆蓋（僅 `fixed` 且 ≥ 3 點） |
| 未壓縮 GLB                  | 自動套用 Draco（geometry level 7）+ KTX2 / Basis Universal（紋理）                                                                          |

> AI 單一 fused mesh 的材質處理、launch 武器處理屬零件 / 場地共用的 Stage 2 工作流，見 [§3.7](#37-ai-單一-fused-mesh-的材質處理零件--場地共用) / [§3.8](#38-ai-單一-mesh-的-launch-武器處理零件)。

### 9.3 Stage 3 場地特殊嚴格檢核

| 檢核項                 | 規則                                                                                                                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 必填欄位非空           | `track.route[]`（含 RP1 起點 + RPn 終點；open 恰 2 點 / fixed ≥ 2 點）/ 至少一材質；presentation tags 可為空，不屬 PhysicsManifest admission                                                                           |
| GLB extras schema 正確 | `open4wd_version` + `type: "track"` marker、`track` / `weather` / `physics` 區塊齊全                                                                                                                                   |
| 衍生限制滿足           | AABB / tris / GLB 大小 / entity / patch / 主貼圖（見 [零件與共用介面.md §7.2](建模參數/零件與共用介面.md#7-約束限制stage-1--stage-3-嚴格檢核)）                                                                        |
| Geometry 壓縮          | 必須 **Draco**（level ≥ 7），未壓縮 mesh primitive 拒收                                                                                                                                                                |
| Texture 壓縮           | 主場地貼圖必須 **KTX2 / Basis Universal**（PNG / JPG 直接內嵌拒收）                                                                                                                                                    |
| Empty 命名規則         | PascalCase + 標準名（見 [零件與共用介面.md §5.4](建模參數/零件與共用介面.md#5-empty-node-命名約定)）                                                                                                                   |
| Entity schema          | `entity_type` 在 3 類 enum 內；`destructible: true` 與 `physics: "visual_only"` 同時設定拒收                                                                                                                           |
| 跑道結構               | `route` 點數（open 恰 2 / fixed ≥ 2）、`width_m > 0`、相鄰點不重合、loop 模式起=終、**每點 position 貼 mesh 表面 ±0.005m**                                                                                             |
| KillZone box 範圍      | (位置 ± scale/2) 必須完全在場地 AABB 內                                                                                                                                                                                |
| Checkpoint box 範圍    | (位置 ± scale/2) 必須完全在場地 AABB 內（AABB 外永遠無法點亮 = 無法完賽）                                                                                                                                              |
| RespawnPoint 位置      | 必須在場地 AABB 內                                                                                                                                                                                                     |
| Empty ↔ 陣列 1:1       | `track.route[]` / `track.checkpoints[]` 每個 entry 有對應同名 empty；`RoutePoint` / `Checkpoint` 前綴 empty 未列入對應陣列 = 孤兒 → 拒收（[零件與共用介面.md §5.4](建模參數/零件與共用介面.md#5-empty-node-命名約定)） |
| 玩家上限合理           | `PLAYERS_PER_RACE_MIN`（2）≤ auto_player_max ≤ `TRACK_MAX_PLAYERS_HARDCAP`（8）（下限不足 = 永遠開不了房）                                                                                                             |
| 重力參數合法           | `gravity_direction` ≠ 零向量；`gravity_strength_m_s2` ∈ 1.6–25                                                                                                                                                         |

以上正式限制同時受 [場地.md §8](建模參數/場地.md#8-場地-glb-root-extras) 的
`TRACK-R-001` 約束：finalizer 與首次 CID admission 共用 validator；密度、窄路等 `warn` 只留在
authoring UI。首次 admission 只有在完整 `TrackPhysicsManifest` 重建、參照核對及 receipt 持久化全數
成功後才成立；runtime 只消費 typed admitted asset，不在賽前重跑本表。

> **強制壓縮設計理由**：Draco + KTX2 都是 **glTF 2.0 標準 extension**（`KHR_draco_mesh_compression` / `KHR_texture_basisu`），主流 viewer / engine 原生支援。Stage 2 編輯器在 finalize 時自動套用（玩家不需手動處理）；Stage 3 拒收未壓縮純粹是防繞過 Stage 2 直送 Stage 3。具體量化參數（Draco position bits / KTX2 UASTC vs ETC1S 選擇）屬實作層，由 convert script 決定。

### 9.4 場地外部可變 presentation metadata

上傳時寫入 `UgcUploadEvent.presentation` revision 0；後續由原作者另簽
`UgcMetadataUpdateEvent` full replacement（不進 GLB extras、不影響 CID 或原 upload 簽章）：

revision 冷卻以 canonical `state.derivedAt` 為 effective time；同一 canonical 時點只接受一筆更新，
不得以倒填事件 `timestamp` 排出多筆離線更新。

```jsonc
{
  "cid": "bafy...",
  "name": "Mt. Fuji Speedway",
  "description": "...",
  "tags": ["dirt", "hard", "realistic", "weather-extreme"],
  "revision": 1,
}
```

#### 9.4.1 場地標籤建議詞彙

tags 是至多 32 筆的 canonical string array，每筆至多 64 UTF-8 bytes；不是結構性 map，也不要求
固定三欄。UI 可用下列詞彙提供快捷篩選，但 ledger schema 不把建議詞彙當成封閉 enum：

**建議 tags**：

| 欄位       | 選項                                                      |
| ---------- | --------------------------------------------------------- |
| terrain    | street / dirt / ice / sand / mixed / fantasy / industrial |
| difficulty | easy / normal / hard / expert                             |
| style      | realistic / cartoon / abstract / scifi                    |

另可使用 `S`／`M`／`L`／`XL`、loop、jump、branching、hazard、dynamic、weather-extreme、
magnet、destructible-heavy、narrow、wide、short、long；仍只受共通字串上限約束。

**系統衍生**：`rating`（Bayesian，[算式表.md §19](算式表.md)・[信譽系統.md §3](信譽系統.md)）／`use_count`（ledger 自動累積）。

### 9.5 場地反作弊規則

| 試圖                                                | 對策                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AABB 巨大想當無限空間                               | Stage 1 不擋（Stage 2 自動縮放）、上限 500×500×100m                                                                                                                                      |
| 三角形爆量想拖慢渲染                                | Stage 2 自動 decimate visual + 衍生 collider                                                                                                                                             |
| 不壓縮 GLB 想撐爆 80 MiB                            | Stage 3 拒收未 Draco / 未 KTX2                                                                                                                                                           |
| 場地超大但內容空洞想佔評分排行                      | Stage 2 密度 < 5 tri/m² 警告 + 玩家評分自然懲罰                                                                                                                                          |
| 偽裝跑道但無起終點（缺 `track.route[]` / 點數不足） | Stage 3 嚴格檢核，缺即拒收                                                                                                                                                               |
| 設定極端天氣參數想癱瘓物理                          | 各參數有上限（風速 ≤ 30m/s、patch ≤ 50、temperature 範圍依 type 限）；kinematic 週期 / 振幅、conveyor 速度亦有上下限（[protocol.md §3](程式參數/protocol.md#3-protocolugcugc-規格約束)） |
| Entity 數量爆炸                                     | ≤ 100 總額 + 進 savestate 的 ≤ 50                                                                                                                                                        |

## 10. 版本升級與遷移

資產 schema 版本（`open4wd_version`、per-type）的完整模型見 [版本規範.md B 軸 §14–§26](版本規範.md)。本節是 UGC 側操作流程。

### 10.1 schema 版本寫入時機

`open4wd_version` 由 Stage 3 共用 canonical finalizer 寫入；本機儲存與上鏈使用相同已標記 GLB bytes。開發期唯一支援的 marker 與 PhysicsManifest 版本以 [版本規範.md §15](版本規範.md) 為權威；current manifest 必須包含逐 tire collider region wear capacity、定點能量帳、能量域熱欄位與 part collider proxies，並攜帶 version 與 digest。沒有舊版 shim、遷移或雙讀 fallback。檔案匯出以這份 canonical bytes 為來源，但下載前移除 marker、manifest 與衍生快取，避免外部修改後冒充 current canonical。Stage 2 編輯內容仍只存在 session 記憶體（不做持久化草稿）。

### 10.1.1 PhysicsManifest admission 與 runtime authority

`UgcUploadEvent`／derived record 只保存 CID、`physicsManifestVersion` 與 `physicsManifestDigest` reference，不把完整 manifest 複製進 ledger。首次 CID 收件必忽略 embedded copy，在有界 Worker 內從解碼後幾何、材質、合法 mount／route empty 與作者宣告獨立重建並重跑正式 validator；只有重建 digest 同時符合 embedded 與 event reference 才接納。成功後可保存本機 `(CID,version,digest)` receipt，receipt 只作效能快取、不進共識。

正式組車與場地載入只接受 `AdmittedAsset { bytes, manifest }`。race runtime 不解析 root/node extras、不跑 Wave A/B，也沒有缺欄 fallback。`meshFingerprint` 專責反複製，`PhysicsFingerprint` 專責 fork 差異，`physicsManifestDigest` 專責正式賽物理完整性；三者不得互相取代。

### 10.2 升級、棄用、救援與 yank

升級分類、版本後繼、鏈式遷移、deprecated／unusable、救援與 yank 的唯一權威是
[版本規範.md §16–§26](版本規範.md)。UGC 流程只負責把需要手動補正的資產導回 Stage 2，
並把成功升級視為新的 immutable CID。
