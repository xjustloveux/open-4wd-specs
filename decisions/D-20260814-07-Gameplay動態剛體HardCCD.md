---
id: D-20260814-07
date: 2026-08-14
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260808-03", "D-20260814-01", "D-20260814-05", "D-20260814-06"]
domains: ["建模物理", "比賽房間"]
sources: ["2026-08-14 ─ Gameplay 動態剛體統一啟用 hard CCD（issue 000502）"]
files: ["程式參數.md", "程式架構/physics-engine.md", "版本規範.md"]
vectors: []
deprecates: []
---

# D-20260814-07｜Gameplay 動態剛體 hard CCD

## 背景與驅動力

固定 60Hz 下，合法高速 chassis 與 projectile 的單幀位移可大於自身尺寸；場地 solid collider 又可
為無體積 trimesh 表面。離散碰撞因此可能漏掉接觸，連帶漏算撞擊、剪切、疲勞與熱。要求 UGC
提供足夠牆厚無法修復零厚度 surface crossing，也會限縮材質與造型設計。

## 考慮過的選項

- 只限制速度或牆厚：無法可靠涵蓋 trimesh surface，且壓縮遊戲與 UGC 設計空間，棄。
- 依當幀速度開關 CCD：改變 body topology 設定時機並擴大 rollback 驗證面，棄。
- 所有 gameplay dynamic body 固定 hard CCD、soft CCD 初版為 0（採納）。

## 決定

- `PHYSICS_HARD_CCD_ENABLED=true`、`PHYSICS_CCD_MAX_SUBSTEPS=2`、
  `PHYSICS_SOFT_CCD_PREDICTION_M=0` 為集中、physics-version-pinned protocol 常數；數值是初估，
  後續只改參數，不在判斷或物理運算寫死。
- chassis primary、tire／roller hinge、weapon actuator payload、持彈及已釋放 projectile 一律從同一
  dynamic body factory 建立。不得按速度切換；projectile release 不改 CCD。
- soft CCD 是可能提前接觸的 predictive constraint，不是 hard CCD 的替代；非零值須另案提出 body
  class、預測距離、容許提前量與效能證據。
- 不新增全域最小 collider／牆厚。既有退化三角形品質門檻保留。
- 純視覺碎片沒有 gameplay body，故不配置 CCD。終點／KillZone 等 custom trigger 維持獨立線段掃掠。
- snapshot／restore 驗證 body hard／soft CCD topology 與 immutable world CCD substeps；差異原子拒絕。

## 後果與影響

高速實體接觸不再依賴步末重疊，薄 fixed trimesh、kinematic entity、其他 dynamic body 與 released
projectile 都納入防穿透測試。hard CCD 增加 shape cast／substep 成本，因此最大合法拓撲需保留
benchmark；參數調整會改變 deterministic 物理結果，公開後必須隨 major 出貨。專案目前為
pre-launch，直接更新當前基線，不保留未公開舊設定的相容或遷移路徑。
