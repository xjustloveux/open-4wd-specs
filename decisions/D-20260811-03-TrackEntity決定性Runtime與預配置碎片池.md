---
id: D-20260811-03
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260707-01", "D-20260811-02"]
domains: ["建模物理", "比賽房間"]
sources: ["2026-08-11 ─ Track Entity 決定性 Runtime 與預配置碎片池（issue 000332）"]
files: ["零件與場景.md", "建模參數.md", "算式表.md", "程式架構/physics-engine.md", "流程/觀戰.md", "版本規範.md"]
vectors: []
deprecates: []
---

# D-20260811-03｜Track Entity 決定性 Runtime 與預配置碎片池

> **2026-08-14 關聯追補**：本檔的 fragment body、五秒物理生命、64-body FIFO、逐片
> SavedState／checksum 與對應 benchmark 條款已由 [D-20260814-06](D-20260814-06-場地碎片統一純視覺.md)
> 取代；typed Track Entity、kinematic、conveyor、visual-only、fatigue 與 magnet 條款繼續有效。

## 背景與驅動力

場地編輯器已宣告 decoration、kinematic move/conveyor、visual-only、destructible 與動態磁源，
正式 physics runtime 卻只把全部 mesh 合併成固定碰撞網格。visual-only 因而成為實心牆，碎片
只有 count 摘要，運動、輸送、破壞、snapshot 與觀戰皆無權威資料路徑。

## 考慮過的選項

- 只讓 runtime 讀 node extras 並排除 visual-only：只能修單一症狀，持續造成 finalizer、admission
  與 runtime 三套權威，棄。
- 破壞時動態建立／移除 body：實作直觀，但 rollback topology 依歷史改變且會產生配置尖峰，棄。
- 由 typed manifest 完整描述 entity 與碎片，世界建立時預配置固定拓撲，賽中只切換可變狀態
  （採納）。

## 決定

- `TrackPhysicsManifest` v2 以穩定 entity index 保存初始 transform、visual/collider 分組、材質區域、
  motion/conveyor/destructible、質量慣量、fragment proxy 與 entity-local magnet；finalizer 產生，
  admission 對實際 CID 獨立重建，runtime 禁讀 raw extras。
- visual-only 只進 presentation，不建立 body、collider、sensor 或 magnet；default decoration 為固定
  collider；kinematic 以 fixed simulation frame 和版本固定近似產生姿態，不使用 wall clock 或
  `Math.sin`／`Math.cos`。
- conveyor 只作用於實際接觸，沿 entity local -Z，切向 impulse 受摩擦係數與法向 impulse 上限
  約束；broken 後歸零。entity-local magnet 隨姿態變換，broken 後停用。
- 每個 destructible fragment 存穩定 index、proxy、local pose、mass ratio、mass、COM 與 inertia；
  總質量精確等於完整 entity。破壞當幀停用原 body/collider/visual/motion/conveyor/magnet，啟用
  預配置 dynamic fragments 並繼承線／角速度，禁止雙重質量。
- 全部 fragment body 在 world build 時建立，賽中不新增／刪除拓撲。最多 64 個啟用物理，依
  `(spawnFrame, entityIndex, fragmentIndex)` 決定性 FIFO；五秒到期或被 FIFO 淘汰即停用物理並
  進 presentation fade。
- entity fatigue/broken、break frame、fragment lifetime/FIFO 與必要動態態納入 SavedState、hash
  與 atomic restore；未破壞 kinematic pose 由 frame 重建。
- entity/fragment presentation 經 `StepOutput → RenderFrame → spectator wire → viewport` 同步，
  不允許只在主機或本機呈現。
- 專案尚未發布，直接升 manifest v2 與 `open4wd_version=3`、重烘全部 builtin，不提供 legacy
  fallback。接觸材質細節由 issue 000333 疊加，天氣與 aero 由 issue 000331 疊加。

## 後果與影響

世界建立會預配置最多 100 entity 與各 destructible 的 fragment topology，增加固定載入記憶體，
但破壞當幀沒有配置尖峰且 rollback handle 集合穩定。CI 必須覆蓋 100 entity、50 destructible、
64 active fragments 的 60 Hz 與 snapshot benchmark，以及 visual-only、運動、輸送、磁源、破壞、
FIFO、觀戰和跨 snapshot conformance。

本決策依 D-20260707-01 的決定性紀律把 staged entity runtime 落地，並擴充 D-20260811-02 的 canonical
PhysicsManifest 權威；兩者其餘決策維持有效。
