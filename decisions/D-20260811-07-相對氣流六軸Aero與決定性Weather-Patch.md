---
id: D-20260811-07
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260612-01", "D-20260811-02", "D-20260811-04", "D-20260811-06"]
domains: ["建模物理"]
sources: ["2026-08-11 ─ 相對氣流六軸 Aero 與決定性 Weather Patch（issue 000331）"]
files: ["算式表.md", "建模參數.md", "程式參數.md", "編輯器操作.md", "程式架構/physics-engine.md", "程式架構/network-sync.md", "版本規範.md"]
vectors: ["physics/weather-aero"]
deprecates: []
---

# D-20260811-07｜相對氣流六軸 Aero 與決定性 Weather Patch

## 背景與驅動力

舊 canon 把場地風宣告成牛頓基準力，再以 body 八方向係數插值；無風時移動車沒有空阻，
`lift_factor` 也沒有公式。雨雪 patch 雖有 extras、編輯器與公式，runtime 型別卻在 admission
後丟掉全部資料。專案仍在開發期，公版 GLB 是契約半成品，因此直接建立完整模型，不保留
錯誤欄位、舊 snapshot 或舊公版 bytes 相容層。

## 考慮過的選項

- 只補接舊風力與 patch 欄位：會固化缺少車速、COP／lift 與 snapshot 規則的半套模型，棄。
- 分階段先上風力、之後再補 patch：會讓 manifest、SavedState 與 builtin 反覆破壞式升版，棄。
- 一次重構相對氣流、typed exposure、唯一 scheduler 與接觸 modifier（採納）。

## 決定

- `weather.wind_speed_n` 破壞式改為 `wind_speed_mps`。每個 body 烘焙 ±X／±Y／±Z 六軸
  `drag_area_m2` 與各向 `center_of_pressure_m`；runtime 以 COP 點速度計算
  `wind - (linear + angular × offset)`，因此靜止車受風、無風移動車也減速。
- 六軸 drag 分別施於各自 COP。lift 由相對重力平面的 drag 推導，正值沿重力下壓、負值形成
  升力；aero 總力鉗制為 `mass × |gravity| × 2`。係數 0.6／1／2 是 synthetic 初值，正式
  body 完成後只校準參數，不重開資料流與公式。
- Rain／snow seed 由 `matchId + roundIndex + track manifest digest` 的 SHA-256 派生。spawn 使用
  整數 accumulator、穩定 ordinal、frame 0 首次生成、每次固定最多八個候選與同場 50 上限；
  失敗候選仍消耗 ordinal。
- PhysicsManifest v5 保存 typed weather、整數 lifetime frames 與 exposure grid。exposure 每格只
  保存沿重力方向第一個合格靜態 solid；橋面／屋頂可生成，其下方與隧道被遮蔽。finalizer 與
  admission 從實際幾何獨立重建，runtime 禁止讀 raw extras。
- Patch 只作用於 tire／roller 對固定 track solid 的實際 manifold 接觸。surface friction 與
  rolling resistance 先乘 modifier，再進 D-20260811-04 的 combine／牽引／側滑／滾阻；同類
  重疊只取穩定 ID 最小者一次。weather restitution modifier 正式刪除，基礎材質 restitution
  仍照既有接觸規則生效。
- Physics engine 的 active descriptors 是唯一權威；participant、spectator 與 editor preview
  只傳遞／消費 descriptors，不另跑 RNG。seed、accumulator、spawn ordinal 與 active list 全進
  SavedState v8、checksum、strict atomic restore。
- Asset schema 維持尚未公開的唯一 `open4wd_version=5`，PhysicsManifest 升 v5；27 個半成品
  builtin 同版重烘並同步 SHA-256／CID／extrasHash，不建 migration catalog 或 fallback。

## 後果與影響

body 物理不再依賴「有沒有場地風」才生效；雨雪視覺、spectator 與接觸物理使用同一組 patch
身分與生命週期，rollback 不會重新抽樣。代價是每幀多出六軸 aero 與有界 patch 接觸查詢，
已以八車、50 active patch、60 fixed frames benchmark 守住 2 秒診斷門檻。這份決策修訂
D-20260612-01 的舊 aero 對角描述、D-20260811-02 的 manifest 邊界、D-20260811-04 的天氣
接觸擴充點與 D-20260811-06 的 mutable friction restore 語意。
