---
id: D-20260814-01
date: 2026-08-14
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260525-01", "D-20260528-01"]
domains: ["建模物理"]
sources: ["2026-08-14 終點與 KillZone 改採 chassis COM 掃掠判定（issue 000505）"]
files: ["遊戲機制.md", "建模參數.md", "程式參數.md", "程式架構/interfaces.md", "程式架構/physics-engine.md"]
vectors: []
deprecates: []
---

# D-20260814-01｜終點與 KillZone 改採 chassis COM 掃掠判定

## 背景與驅動力

終點原以 chassis COM 的步末位置是否落入球體判定，KillZone 也只檢查步末點。固定 60 Hz 下，合法
車速可讓 COM 在一幀內跨過整個球或薄 box，造成漏圈、漏完賽或漏掉出；終點另用步末速度判正向，
同幀碰撞或失能還可能推翻實際已發生的正向穿越。

## 考慮過的選項

- 放大終點球與 KillZone：只能降低漏判機率，會改變創作者幾何且仍無速度上限保證，棄。
- 啟用 CCD 後維持 point containment：CCD 解決 collider 接觸，不會替 gameplay trigger 補 sweep，棄。
- 以相鄰固定步的 chassis COM 線段做定向平面／AABB entry（採納）。

## 決定

- RPn 定義無高度上限的定向終點平面：origin 是 RPn.position，normal 是 normalized RPn.forward，
  right 由 RPn.forward 與正交化 RPn.up 的 canonical surface frame 推導，左右有效範圍是
  `RPn.width_m / 2` 加 `FINISH_GATE_LATERAL_EPS_M`。
- 每步以前一個已實現 COM 到目前 COM 的線段判定。只有先在平面後方完成 `finishArmed`、再由負側
  跨到正側且交點位於左右範圍內，才是正向通過；不再讀步末速度。起點在平面容差帶、反向、側向
  越界、共面移動與 teleport 都不算。
- 有效通過仍受 checkpoint 順序約束；loop 計圈後清除 armed 並重設 checkpoint，linear 直接完賽。
  同幀 crossing 在 broken／retirement 提交之前取得，合法 `finishedAtFrame` 不被後續損毀推翻。
- KillZone 對同一條 COM 線段做封閉 segment-AABB entry；多 zone 取最早 entry，相同 entry 依既有
  canonical zone index。teleport 重設 sweep 起點與 `finishArmed`，不把非物理位移當作通過路徑。
- previous COM、`finishArmed` 與 `finishedAtFrame` 是 SavedState／checksum／rollback 的共識狀態。
  專案仍為 pre-launch，直接替換舊 `atFinishGate` shape，不保留球形或舊欄相容讀取。

## 後果與影響

終點與 KillZone 不再受單幀位移尺度限制，斜坡、翻滾管與跳躍仍使用 authored RPn surface frame，
沒有任意世界高度上限。每車每步增加固定次數的點積與有界 KillZone slab 檢查；zone 數已有 authoring
上限，成本可預估。snapshot schema 與 protocol 常數隨目前唯一支援版本直接更新。
