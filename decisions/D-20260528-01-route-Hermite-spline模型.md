---
id: D-20260528-01
date: 2026-05-28
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-05-28 建模參數表二輪複審"]
files: ["建模參數.md", "遊戲機制.md", "編輯器操作.md", "UGC機制.md"]
vectors: []
deprecates: []
---

# D-20260528-01｜route＝貼表面 Hermite spline 模型

## 背景與驅動力

初版 route＝polyline，曲線靠多點折線逼近；走廊檢核另有 `width_mm` 與 `deviation_mm` 兩欄語義重疊（b-soft 實際只用後者、前者空轉）。二輪複審中 B3 經三輪演化：polyline→ 自訂切線 spline→ **貼表面 spline** 定版（採業界賽道編輯器慣例）。

## 考慮過的選項

- polyline 折線逼近：點多才順，創作負擔大。
- 自訂切線 spline（中版）：曲線可順，但點不綁表面，up 軸與浮空段語義未解。
- 貼表面 spline（採納）。

## 決定

- route 改為依各點 (position, forward) 插值的 **Hermite spline**，少量點即成順曲線。
- **RoutePoint 永遠貼 mesh 表面**（±5mm）；forward 約束在表面切線平面（繞 surface normal 的 1 DOF）；up 軸自動 ＝surface normal——banked、翻滾管道、立體迴圈原生支援。
- **飛越段**：中間無 mesh 處自然放不了點 →spline 浮空；b-soft 僅當車「在表面」時觸發（物理 contact＋100 ms hysteresis），空中不檢核、重力兜底。
- 新 auto 欄位 **`auto_route_polyline_3d`**：Stage 3 等弧長預採樣，runtime b-soft 查最近點用。
- **width／deviation 合一**：廢 `deviation_mm`；`width_mm`＝ 車道全寬，b-soft 邊界 ＝spline 中心線 ± 半寬。
- **起終點統一**：廢 `StartLine`／`FinishLine`／`Waypoint`，一律 RoutePoint——RP1 起、RPn 終；open vs fixed＝ 走廊 b-soft 關 ／ 開。
- **`track.type` 改唯讀衍生**：由有無走廊（編輯器有無連線）衍生 open／fixed，非獨立選項。現況見 [建模參數.md](../建模參數.md)。

## 後果與影響

Stage 2 編輯器互動（切線把手、加點刪點、旋轉切線）同輪抽離成獨立檔 [編輯器操作.md](../編輯器操作.md)；`route[]` 順序語義其後由 [D-20260612-04](D-20260612-04-節點名唯一順序extras.md) 明文改 extras 陣列承載；車頭 ＝−Z 的全域軸向慣例（[D-20260612-01](D-20260612-01-軸向慣例定錨.md)）即沿 RoutePoint 前向慣例定錨。fixed 軌的走廊約束與 checkpoint 有序關卡（[D-20260525-01](D-20260525-01-Checkpoint有序關卡.md)）互補，構成防抄近路雙層。
