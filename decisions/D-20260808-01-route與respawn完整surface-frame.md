---
id: D-20260808-01
date: 2026-08-08
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260528-01", "D-20260612-01"]
domains: ["建模物理"]
sources: ["2026-08-08 ─ route 與 respawn 完整 surface frame"]
files: ["建模參數.md", "程式架構/interfaces.md", "程式架構/physics-engine.md"]
vectors: []
deprecates: []
---

# D-20260808-01｜route 與 respawn 完整 surface frame

## 背景與驅動力

D-20260528-01 已決定 RoutePoint 的 `forward` 位於表面切線平面、`up` 等於 surface normal，
但 runtime `TrackConfig` 只保存 `forward`。起跑與回位因此只能用 local `-Z → forward` 的
shortest-arc 四元數；當兩向量接近反向時，旋轉軸不唯一，微小斜率可讓車輛繞 local X 而非 Y
旋轉 180°，使 local `+Y` 朝下。這不是重力能補足的資訊：bank、側牆、倒掛與 360° 迴圈的
surface up 本來就可能不等於重力反向。

RespawnPoint 同樣只有 position 與 forward 契約；在上述非水平表面回位時也缺少唯一姿態。

## 考慮過的選項

- 一律用場地重力反向當 up：水平場地簡單，但會破壞 bank、側牆、倒掛與迴圈，否決。
- 保留 forward-only，對接近反向個案固定繞世界 Y：只修水平特例，且自訂重力仍錯，否決。
- RoutePoint／RespawnPoint 完整傳遞 world `+Y` up 與 world `-Z` forward（採納）。

## 決定

- `RoutePoint` 與 `TrackRespawnPoint` 都以 `{positionM, forward, up}` 傳入 physics；兩軸來自 empty
  的完整 world frame。RoutePoint 的 up 仍是 D-20260528-01 已定義的 surface normal。
- RespawnPoint 的 authored world `+Y` 是回位 up；Editor 貼面新增時以命中面 normal 初始化，
  rotation 同時承載 `+Y／-Z`，scale 仍無語意。創作者可為特殊場地明確調整完整姿態。
- Hermite 預採樣同時插值 up，並在每個 sample 投影到切線的正交平面後正規化；退化時只使用
  相鄰 authored frame 與固定軸序的 deterministic fallback，不讀 camera 或 gravity。
- 起跑格沿第一個 sample 的 surface up 抬升並以該 frame 生成 quaternion；last-valid、RP1 fallback
  與 authored RespawnPoint teleport 都必須攜帶 up。forward-only quaternion API 從 production 移除。
- full-frame quaternion 只使用加減乘除與平方根，維持既有決定性邊界；local `-Z` 對齊 forward、
  local `+Y` 對齊正交化後的 up。

## 後果與影響

起跑與重生不再把世界重力誤當道路法線，水平、banked、垂直、倒掛及 360° 迴圈共用同一資料流。
`TrackConfig` 是物理／rollback 相容邊界，缺少 up 的舊建構器必須同步；既有 GLB wire extras 不新增
欄位，因為 frame 仍由同一 Empty transform 取得。此決策補足 D-20260528-01 已定義但未接到 runtime
的 RoutePoint up，並把相同的完整回位姿態契約補到 RespawnPoint。
