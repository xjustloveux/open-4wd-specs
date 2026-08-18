---
id: D-20260814-08
date: 2026-08-14
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260807-03", "D-20260808-03", "D-20260814-07"]
domains: ["建模物理"]
sources: ["2026-08-14 ─ Projectile LaunchExit 幾何離膛（issue 000503）"]
files: ["建模參數.md", "編輯器操作.md", "程式參數.md", "程式架構/physics-engine.md", "版本規範.md"]
vectors: []
deprecates: []
---

# D-20260814-08｜Projectile LaunchExit 幾何離膛

## 背景與驅動力

預配置 projectile 在 hold joint 移除時仍可能位於來源 weapon convex 內；hard CCD 會正確保留這個
初始接觸，造成非設計性的來源武器自撞。固定幀數無法適應不同尺寸與特殊造型，永久 owner immunity
又會破壞既有未連結同車 body 可碰撞、自傷的政策。

## 考慮過的選項

- 固定幀數 grace：不同尺寸、速度與特殊造型無共同正確幀數，棄。
- projectile 對來源車永久免疫：破壞既有自體碰撞與反彈自傷，棄。
- 每 projectile 的 canonical convex LaunchExit 平面（採納）。

## 決定

- 每 projectile 保存 weapon-local、沿 Axis +Z 的量化 `exitDistanceUm`，不保存 rotation。
- Stage 3 以完整 canonical convex support 與 translational SAT 驗證正向、必要外界、無新阻擋且抵達
  平面時完整形狀已清除；無 primitive fallback，失敗即拒收。
- runtime 只過濾未清除 projectile collider 與 source weapon fixed proxy。場地、對手、來源車其他
  part 與其他 projectile 仍可碰撞。
- 每 fixed step 由來源 weapon 當前權威 pose 轉換平面；完整 support 的最小投影越過平面再加
  `PROJECTILE_EXIT_CLEARANCE_M=0.001` 後，`sourceCleared` 永久設 true，下幀恢復接觸。
- source weapon 先退出物理則直接清除；清除後反彈可正常撞擊與自傷，不重新取得 grace。
- SavedState v14／hash 保存 `sourceCleared`，world plane 與 rotation 不保存。PhysicsManifest、marker 與
  builtin 基線升 v10；pre-launch 不保留 v9 相容或 migration。

## 後果與影響

特殊、雙管、環形與開放造型以各 projectile 的實際 convex 幾何表達，不受統一包圍 primitive 限制；
contact hook 只增加必要 pair 的判斷。編輯器顯示每顆 projectile 的 LaunchExit 距離與 Axis 導出的平面，
並沿同一 Stage 3 規則顯示有效性。
