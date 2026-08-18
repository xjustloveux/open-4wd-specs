---
type: impl
domain: ["UGC版權"]
summary: Stage 2 編輯器（wave 管線／幾何工具／逐 sub-mesh 材質／三出口送出）
authority: null
slug: null
---

# editor（Stage 2 編輯器實作）

> **本檔角色**：Stage 2 編輯器（零件 ＋ 場地共用）的**實作層** —— 進場管線（wave A）、幾何工具（拼接 ／ 切分）、逐 sub-mesh 材質指派、選取 ／gizmo 系統、即時檢核引擎、session 狀態、上鏈流程驅動。
> **互動 ／ 版面 ／ 快捷鍵權威 = [編輯器操作.md](../編輯器操作.md)**（[§0.5](../編輯器操作.md#05-整體版面a1) 整體版面 ／[§0.6](../編輯器操作.md#06-快捷鍵總表c1) 快捷鍵 ／[§1](../編輯器操作.md#1-通用)–[§5](../編輯器操作.md#5-stage-1--stage-3-互動) 互動——本檔不重列）；資料層狀態轉移見 [UGC上傳.md](../流程/UGC上傳.md)；欄位 schema 見 [../建模參數.md](../建模參數.md)。對應 `src/editor/`、路由 `/editor`（[../程式架構.md §13](../程式架構.md)）。

## 1. 模組結構

```text
src/editor/
├── import/          # source admission、marker identity、來源單位正規化與 import workspace
├── pipeline/        # wave A/B、拼接、canonical finalizer、壓縮與三出口 adapters
├── geometry/        # 可逆 mesh document、表面查詢、切分與修補工具
├── viewport/        # preset `neutral` 中性 PBR 工作區；重力對齊低對比 grid 只輔助定位，不參與 content／picking／framing
├── validation/      # 即時檢核引擎（§4）＋ Stage 3 檢核（與收件端共用 validator）
├── session/         # 記憶體 session 狀態＋ undo stack（§3）
└── chain-scan/      # `Chain_Segment_*` 自動掃描 → joint 推導預覽（編輯器操作 §3.2）

src/pages/editor-page/ # assembly／split／material 等互動面板；資料與幾何規則仍由 src/editor 提供
```

`editor` 採**深路徑模組**邊界：production code 對 `src/editor/index.ts` 不得建立 import；跨模組
consumer 應依責任 leaf-pick，例如 `editor/validation/findings`、`editor/glb-scene` 或
`editor/pipeline/local-store`。這不是對外穩定 API surface；保留深路徑可維持 lazy route／browser
chunk 邊界，並避免 `pipeline/compress` 的 Node-only 相依經巨型 barrel 進入前端 bundle。新增共享型別
時應下沉到無反向依賴的 leaf type module，不得用 root barrel 掩蓋環狀依賴。

展示層元件（面板 ／ 頁籤 ／bottom sheet）走 `ui-kit/`（o4-*）；表單檢核走 ui-kit forms 兩層模型（[ui-frontend.md §4.1](ui-frontend.md)）。

**幾何工具**（`geometry/` 切分 ＋`pipeline/assembly` 拼接）＝ 在瀏覽器內產生多零件 / 多材質資產所需的水密 sub-mesh node：**拼接**由下而上合併多個水密 GLB（position 定位 ＋ 父子指定），**切分**由上而下對水密 node 軸向平面切 ＋ 開口邊界環三角化封蓋成封閉水密片（整體 Σ 體積守恆、切面沿用該片材質、僅水密 node）。兩者產物皆為封閉水密 sub-mesh，與材質模型（[../材質表.md §7](../材質表.md) 質量 = `Σ(水密體積 × 密度)`）一致。UI 面板 = `pages/editor-page/assembly-panel`／`split-panel`；**行為權威見 [../編輯器操作.md §2.4](../編輯器操作.md)**。目前切分軸向、拼接僅 position；候選精修集中於[../其他.md](../其他.md)。

## 2. 進場管線（wave A）

進場先做 `source admission → identity → 明示來源單位正規化 → meter facts → provisional uniform fit`；無 marker 場地以 150m 最長水平邊作初始 guidance，已帶 [../版本規範.md §15](../版本規範.md) current marker 的成品不重套單位或 fit。之後依 [零件與共用介面.md §4](../建模參數/零件與共用介面.md#4-glb-root-extras--系統自動算出欄位auto_) 執行 volume／mass／bbox／centroid／surface_area、`auto_feature_deviations` 介面特徵絕對公差量測與 visual/collider decimate。作者可再套正值 uniform scale；空間資料一起縮放，UV／貼圖不因空間倍率改寫。外形 AABB、輪徑或馬達總長不構成 canonical 相容性條件。

- **全部在 Worker 執行**（場地大 mesh 30–60s，不卡 UI 執行緒）；幾何計算走 [physics-engine.md §5–§6](physics-engine.md)（體積／表面積由 TypeScript 實作、指紋用 WASM；WASM 化評估見該檔 [§5](physics-engine.md#5-mesh-體積計算上傳時wasm) 實作落點）。
- Loading 覆蓋層逐項回報進度（編輯器操作 [§1.7](../編輯器操作.md#17-進場-loadingwave-a-自動計算)）；嚴重失敗退回 Stage 1、非致命走備援旁白提示。
- GLB 於 Stage 1 已過 Sanitize Worker（[security.md §2](security.md)）——本模組收到的是已消毒 bytes。

## 3. Session 狀態（A2：無草稿）

- 編輯狀態**只存在記憶體**：離開 `/editor`／關閉分頁即棄（A2 定案）；「Stage 2 編輯中」屬升版 idle guard 的非 idle 集合（[../版本規範.md §8.2](../版本規範.md)）。
- undo stack 全 session（編輯器操作 [§1.3](../編輯器操作.md#13-撤銷--重做--清空)）；切換編輯對象時清空。
- 唯一持久化 = 視覺層開關偏好（localStorage，編輯器操作 [§1.6](../編輯器操作.md#16-視覺輔助層級開關)）；產出物 = 上鏈成功的 CID 或 `local:<uuid>` 本機測試資產（IndexedDB `local-parts`／`local-tracks`，[pwa-offline.md §5](pwa-offline.md)）。測試零件只可裝入本機測試車位，測試場地只可進 local-test。
- 重開 current canonical／本機測試資產時沿用已驗 marker 與 baked facts，只重建編輯器需要的
  輕量幾何事實與可逆 document；不重新套來源單位、provisional fit 或 fresh-import type 矩陣。

### 3.1 重疊表面選擇器

Wave A 的 `NodeGeometry` 保留 primitive 頂點／triangle 範圍；surface query index 以 top-level
primitive BVH 接各 primitive-local BVH，並為 triangle 建立 exact-edge connected component。
Worker transfer 逐一搬移巢狀 typed-array buffer 且依 `ArrayBuffer` identity 去重。相機射線回傳
最多 32 個依 `(distance, mesh, primitive, triangle)` 排序的候選；只有世界點與 authored normal
在數值容差內皆相同的共面重複面才合併。查詢過程只保留最近 33 個唯一候選，避免單一深層
模型令主執行緒建立與 triangle 數等長的命中陣列。

`surface-selection.ts` 保存純函式 cycling 與 `{nodeIndex, primitiveOrdinal, componentId}` lock；
viewport 只建立非權威 triangle／point／normal 預覽，確認後才發完整 surface hit，頁面再以工具
policy 接受或拒絕。RoutePoint 與貼面 RespawnPoint 要求確認後 identity，Checkpoint／KillZone
可使用 view work plane。`[`／`]` 僅在 viewport active、非輸入焦點、無 blocking overlay 且候選
存在時攔截；`Tab` 永不進入此分支。此結構延續 [D-20260528-01](../decisions/D-20260528-01-route-Hermite-spline模型.md)、
[D-20260808-01](../decisions/D-20260808-01-route與respawn完整surface-frame.md) 與
[D-20260703-04](../decisions/D-20260703-04-sanitize天花板與Worker邊界.md)，未新增 schema 或決策。

### 3.2 可逆表面幾何文件

場地通過 admission 後建立 attribute-preserving `EditableMeshDocument`。它保留原 primitive／材質
ownership 以及 POSITION、NORMAL、TANGENT、TEXCOORD 與 index binding；編輯只記錄 compact
primitive-local overlay。筆刷 worker 只接收命中 component 的受影響頂點區域，拓樸 worker 只接收
被選 primitive 的 positions／indices／必要 attributes 與 world positions，不傳整份 GLB 或其他
primitive。worker 每次請求單獨建立並在成功、失敗、timeout、abort 後終止。

畫筆成功時以增量 refit 更新 primitive BVH 與 top-level ancestor bounds。補洞／橋接會重建被影響
primitive 的 query partition；同 mesh 後續 primitive 只調整 triangle offset，物件 identity 與其他
partition BVH 保持不變。`MeshPatchEdit`／`TopologyRepairEdit` 依 document → derived render geometry →
surface index → anchors → marker transform 發布，任一步失敗都補償已發布步驟。全 editor history 上限
為 128 MiB／100 筆，交易 byte size 只計實際保留 typed arrays。

三個輸出入口都先 materialize 目前 editable document，再進既有 canonical finalizer。attribute overlay
重指被修改 semantic；topology overlay 只重指被修補 primitive 的 index accessor，原 unsigned component
type 可容納時保留，必要時才升為 `UNSIGNED_INT`。本機測試、GLB 匯出與上鏈都先得到同一
canonical GLB；runtime collider 也只從該 GLB 的 POSITION／indices 建立，沒有 editor-only 第二份
碰撞真相。GLB 下載再由 canonical 成品產生 editable derivative，不回流成 runtime 真相。

此結構沿用 [D-20260528-01](../decisions/D-20260528-01-route-Hermite-spline模型.md)、
[D-20260808-01](../decisions/D-20260808-01-route與respawn完整surface-frame.md)、
[D-20260703-04](../decisions/D-20260703-04-sanitize天花板與Worker邊界.md) 與
[D-20260712-01](../decisions/D-20260712-01-材質統一水密sub-mesh.md)；未新增公開 schema。

## 4. 檢核引擎

| 層                    | 規則來源                                                                                                                                            | 呈現                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **即時**（編輯中）    | [../建模參數.md](../建模參數.md) 約束＋[../程式參數.md](../程式參數.md) 常數（Mount 偏離／重疊、Checkpoint scale、chip 總和、weapon 必填…） | 紅🟥／黃🟨框＋banner 計數（編輯器操作 [§3](../編輯器操作.md#3-零件編輯)–[§4](../編輯器操作.md#4-場地編輯) 各表為權威清單） |
| **Stage 3**（上鏈前） | 嚴格 schema 檢核                                                                                                                                    | 拒收清單側欄＋點按跳轉 focus（編輯器操作 [§5.2](../編輯器操作.md#52-stage-3-拒收清單)）                                    |

**與收件端共用同一 validator 模組**（[UGC機制.md §4](../UGC機制.md) Stage 3 檢核 = 收件重算同一套 code）——單一實作防「編輯器放行、全網拒收」的規則漂移。場地 validator 回傳的 `reject` 是 canonical／admission hard rule；`warn` 只供 authoring 呈現，不進 protocol admission。完整分層見 [場地.md §8](../建模參數/場地.md#8-場地-glb-root-extras) `TRACK-R-001`。

## 5. 送出驅動（wave B；本機測試 / 上鏈 / 可編輯 GLB）

三出口共用同一 canonical finalizer：攤平編輯 → part 重新執行同一套保真減面 → wave A/B 重算 → 全量規則檢核 → 從實際幾何、材質、合法 empty 與已驗作者宣告建立 current typed `PhysicsManifest`（含純視覺 fragment descriptor、逐 tire region wear capacity、能量域熱欄位、六向接觸面積與 part collider proxies）→ 寫入完整 manifest、version、canonical SHA-256 digest 與 [../版本規範.md §15](../版本規範.md) 的 current marker → Draco → 超大貼圖等比降至 4096px 內並轉 KTX2 → 壓縮後重驗。canonical 相容量測只接受介面表列出的 mount／hinge 特徵與逐 feature 絕對公差；輪徑、AABB、馬達總長等外形尺寸不得進入量測 API。**出口 A 本機測試**存 `local:<uuid>`；**出口 B 上鏈**保持 canonical GLB bytes 不變，只在 bytes 外增加三種分工明確的 mesh fingerprint、PhysicsFingerprint 與 manifest reference，再做相似度、IPFS 與 ledger 操作；**出口 C 可編輯 GLB**由同一 canonical 成品展開 Draco、把 KTX2 轉為內嵌 PNG，保留 authored 結構與 extras，但移除 canonical marker、manifest 與 `auto_*` 衍生快取。鏈上詳情與本機資產下載共用同一轉換埠；CAR 另保留 exact CID。當前 metadata 只支援 `copyright: self-made`。決策見 [D-20260811-04](../decisions/D-20260811-04-逐Collider材質接觸與滾動阻力.md)、[D-20260811-05](../decisions/D-20260811-05-能量域熱模型與固定熱庫接觸.md)、[D-20260811-10](../decisions/D-20260811-10-逐Region接觸耗散輪胎磨耗.md)、[D-20260811-14](../decisions/D-20260811-14-材質Capability與介面嚴外形寬.md)。

## 6. 跨模組對接

| 模組                                                                       | 對接                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [編輯器操作.md](../編輯器操作.md)                                          | 互動／版面／快捷鍵**權威**（[§0.5](../編輯器操作.md#05-整體版面a1)／[§0.6](../編輯器操作.md#06-快捷鍵總表c1)／[§1](../編輯器操作.md#1-通用)–[§5](../編輯器操作.md#5-stage-1--stage-3-互動)） |
| [../流程/UGC上傳.md](../流程/UGC上傳.md)                           | Stage 資料層狀態轉移／wave A·B 清單／拒收條件                                                                                                                                                |
| [physics-engine.md](physics-engine.md)                                     | WASM 幾何計算（volume／surface／fingerprint）                                                                                                                                                |
| [security.md](security.md)                                                 | Stage 1 Sanitize Worker（本模組上游）                                                                                                                                                        |
| [../材質表.md](../材質表.md)・[../建模參數.md](../建模參數.md)         | 材質 enum／欄位 schema／約束常數                                                                                                                                                             |
| `ui-kit/`（[ui-frontend.md §4](ui-frontend.md)） | o4-* 元件＋表單檢核層                                                                                                                                                                        |
| [pwa-offline.md](pwa-offline.md)                                           | `local-parts`／`local-tracks` 本機測試資產                                                                                                                                                   |
