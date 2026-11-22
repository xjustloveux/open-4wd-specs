---
id: D-20260814-02
date: 2026-08-14
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260808-03", "D-20260706-06"]
domains: ["建模物理"]
sources: ["2026-08-14 fluid weapon 與 projectile deploy zone 接線（issue 000477）"]
files: ["建模參數.md", "程式參數.md", "材質表.md", "程式架構/interfaces.md", "程式架構/physics-engine.md"]
vectors: []
deprecates: []
---

# D-20260814-02｜fluid projectile 部署區生命週期

## 背景與驅動力

fluid 材質雖已是 weapon 合法材質，PhysicsManifest 卻要求所有 proxy 都具固體熱參數，使合法資產
無法 finalize；launch projectile 也沒有把 fluid payload 落地轉成 deploy zone 的 runtime consumer。

## 考慮過的選項

- 把 fluid 當 solid 並填入假熱參數：違反材質 sensor／skip 語意，棄。
- 以 projectile 外觀投影或固定半徑形成區域：特殊形狀不穩定，且無法反映編輯器縮放後體積，棄。
- 保留 canonical density 質量、跳過固體熱合成，依 canonical volume 形成參數化圓形 sensor（採納）。

## 決定

- fluid sub-mesh 仍以 density 參與 mass／COM／慣量；proxy 的固體 thermal exchange 值為零，不進
  fatigue、固體接觸熱交換與過熱合成。混合 weapon 只累加 solid sub-mesh 的熱容量與環境熱傳。
- 每枚 fluid projectile 的 immutable descriptor 保存 Stage 3 重算的 `volumeM3`、`behavior` 與
  `params`；合法 uniform scale `s` 先攤平再重算，因此 volume 按 `s³` 變化。
- projectile 第一次接觸固定 track 或有效 Track Entity intact 表面時，停用原 body／collider並
  啟用同索引預配置圓形薄 sensor。碰車不部署；未部署而越過場地 fall-limit 時回收。
- 面積為 `clamp(volumeM3 / FLUID_PROJECTILE_SPREAD_THICKNESS_M ×
  FLUID_PROJECTILE_SPREAD_COEFFICIENT, FLUID_PROJECTILE_AREA_MIN_M2,
  FLUID_PROJECTILE_AREA_MAX_M2)`；半徑為 `sqrt(area/π)`，sensor 厚度另由集中參數控制。
- 固定表面保存 world anchor；Track Entity 保存 local position／normal 並逐 fixed step 跟隨。entity
  broken／退役時 zone 同步停用。zone 存續至回合結束，每枚 projectile 最多一區，無額外 timer／FIFO。
- 同一 zone 命中同一 part 的多 collider 先去重；zone 依 canonical key 排序。grip／sticky 取最強，
  burn／freeze／corrosive 依 distinct zone 疊加；projectile source peer 隨 hit 保留供致毀歸因。
- source、in-flight／deployed／retired、anchor 與 normal 進 SavedState v11、world snapshot 與 state hash；
  restore 不重新 raycast。

## 後果與影響

fluid weapon 可正常 finalize，且視覺縮放會透過 canonical volume 單調影響覆蓋面積，不限制特殊外形。
每枚 projectile 增加一組預配置、預設停用的 kinematic sensor 拓撲，仍受既有每場 64 枚彈藥上限約束；
執行期不新增無界 body。專案為 pre-launch，直接更新唯一支援的 manifest runtime shape 與 SavedState。
