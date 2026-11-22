---
id: D-20260516-01
date: 2026-05-16
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-05-16 Motor / Battery 新模型 + 8 Skill enum", "2026-06-30 遊戲機制複審：Endurance「沒電後果」補定義"]
files: ["建模參數.md", "算式表.md", "程式參數.md", "遊戲機制.md"]
vectors: []
deprecates: [{"item":"throttle／battery_discharge_amps／motor_max_current／motor_resistivity／battery_internal_resistance","kind":"replaced","replacement":"motor torque_ratio 與 battery 輸出功率模型"}]
---

# D-20260516-01｜Motor / Battery 能量模型＝宣告功率＋查表耗電（I²R 廢除）

## 背景與驅動力

原能量系統走擬真電學：`throttle`／`battery_discharge_amps`／`motor_max_current`／`motor_resistivity`／`battery_internal_resistance` 一路算 I²R，技能耗電再經 `SKILL_BATTERY_CURRENT` 電流模型。對 UGC 零件而言這串參數既難宣告也難平衡，與體積推導的 auto 欄位族也缺乏接點；spec 另殘留與回合制矛盾的「賽中修理」措辭。

## 考慮過的選項

- 維持 I²R 擬真電學建模：參數多、UGC 不可控，被整套汰換。
- 宣告值 ＋ 查表模型（採納）。

## 決定

- Motor＝`auto_input_w`（體積推導輸入功率）＋`torque_ratio`（扭力 vs 速度取捨拆分）。
- Battery＝`declared_output_w`（宣告輸出功率）＋`auto_capacity_mah`（體積推導容量）。
- 耗電改 **`base_battery_drain` mAh 查表**；I²R 五欄位整套廢除；新增 `auto_surface_area_mm2`（散熱面積自動計算）。
- 修理機制矛盾修補：**賽中無中途修理、每回合 reset**。公式現況見 [算式表.md](../算式表.md)、欄位見 [建模參數.md](../建模參數.md)。

## 附帶決策

Endurance「沒電後果」原全 corpus 無定義：駕駛功率用常數 `declared_output_w`、剩 1% 與滿電一樣快，視覺描述卻暗示公式裡不存在的降速機制。2026-06-30 複審裁定**硬切**——`capacity_mah` 歸零則 `actual_power_w`＝0、技能 ／ 武器 `applied_energy`＝0；`capacity_mah` clamp 非負；停住的車靠慣性滑行、等回合賽程時間上限兜底。Endurance stat 意義 ＝ 撐多久不斷電。

## 後果與影響

能量面從電學擬真轉為「宣告 ＋ 推導」二元模型，與體積制 auto 欄位同構；`declared_output_w` 成為後續武器動能與轉速公式的功率基底。同日 Skill enum 與 Stats 一併定形（[D-20260516-02](D-20260516-02-Skill八種Stats八項.md)）。
