---
type: registry
domain: ["建模物理"]
summary: 待 playtest 校準的物理與武器常數
authority: null
slug: null
---

# Calibration

> 本頁是所列 namespace 的內容權威；[程式參數](../程式參數.md) 只提供導覽。

## 18. 物理 / 武器 K 常數（待 playtest 校準）

| 常數 | 值 | 說明 |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `K_MAGNET_FORCE` | 0.03（初估；依真實接觸摩擦重校） | 武器磁源動態係數（`strength_n = available_output_w × allocation_pct / 100 × 此值`） |
| `K_MAGNET_PERMEABILITY_M2` | 0.0008（初估；依真實接觸摩擦重校） | 磁力公式 1/r² 尺度係數（r 單位 m） |
| `K_REACTION` | 0.002（初估；依真實接觸摩擦重校） | 武器反作用力衝量係數（N·s／effect J） |
| `K_ROLLING_RESISTANCE` | 0.0001（初估） | `rr_pair × normal_impulse` 的滾動阻力尺度 |
| `K_WEAPON_ROTOR_SPEED` | 0.1（初估；滿配單轉子 ≈33 rad/s） | 武器 actuator 功率 → 角速度係數（`ωᵢ = P × 此值 × speed_weightᵢ/Σ`，[算式表.md §3](../算式表.md)） |
| `FLUID_PROJECTILE_SPREAD_THICKNESS_M` | 0.002 m（初估） | fluid projectile canonical volume 換算地面面積的等效鋪展厚度 |
| `FLUID_PROJECTILE_SPREAD_COEFFICIENT` | 1（初估） | fluid projectile 鋪展面積係數 |
| `FLUID_PROJECTILE_AREA_MIN_M2` | 0.0001 m²（初估） | 單枚 fluid projectile deploy zone 最小面積 |
| `FLUID_PROJECTILE_AREA_MAX_M2` | 0.25 m²（初估） | 單枚 fluid projectile deploy zone 最大面積 |
| `FLUID_PROJECTILE_SENSOR_THICKNESS_M` | 0.002 m（初估） | fluid projectile 圓形薄 sensor 總厚度 |
| `K_CHIP_SKILL_WASTE_HEAT` | 0.001（synthetic reference 初估） | 實際 `battery_cost_j` → chip heat J 的比例 |
| `K_BATTERY_SKILL_WASTE_HEAT` | 0.02（synthetic reference 初估） | 實際 `battery_cost_j` → battery heat J 的比例 |
| `K_BATTERY_PASSIVE` | 0.15（synthetic reference 初估） | 實際供能功率轉為 battery heat power 的比例 |
| `K_MOTOR_HEAT` | 0.2（synthetic reference 初估） | motor 實際輸入功率轉為 heat power 的比例 |
| `MIN_TEMPERATURE_C` | -273.15 | 所有 runtime 熱積分下限 |
| `MAX_TEMPERATURE_C` | 5000 | 所有 runtime 熱積分上限 |
| `K_THERMAL_AMBIENT_W_PER_M2_C` | 80 | exposed area × capped conductivity factor 的 ambient conductance 基準 |
| `THERMAL_CONDUCTIVITY_FACTOR_CAP_W_PER_M_C` | 50 | ambient conductivity factor 的材質熱導上限 |
| `K_THERMAL_CONTACT` | 0.00002（初估） | effusivity pair × baked area × normal impulse 的接觸熱導尺度 |
| `K_THERMAL_SLIP` | 1（初估） | 實際切向耗散保留為 tire／roller 熱的比例 |
| `K_TIRE_THERMAL_WEAR_MAX` | 2（初估；總倍率上限 3） | 輪胎達熱限時二次曲線的額外 fatigue 倍率（總倍率 `1＋此值×r²`） |
| `K_TIRE_WEAR_CAPACITY` | 1（synthetic reference 初估） | tire region 的 `volume_m³ × ultimate_strength_pa` → wear capacity J 尺度 |
| `K_TIRE_SLIP_WEAR_MULTIPLIER` | 4（synthetic reference 初估） | slip dissipation 相對 rolling dissipation 的磨耗倍率 |
| `MIN_TIRE_WEAR_SPEED_MPS` | 0.001 | 低於此接觸速度視為共識靜止，不記 rolling／slip wear |
| `K_TORQUE_FROM_W` | 0.0002（公版最弱 speed 整車可由靜止爬 7.38% 起跑坡） | 功率 → 扭力（N·m/W）；每幀另以 `mass × remaining Δv` 鉗制，不跨越 derived top speed（[D-20260807-02](../decisions/D-20260807-02-公版起跑扭矩與極速衝量鉗制.md)） |
| `K_SPEED_FROM_W` | 0.015（初估；speed 配置極速 ≈8.4 m/s） | 功率 → 極速（m/s/W） |
| `K_BOOST` / `K_BRAKE` / `K_JUMP` / `K_SLAM` | 0.00065／0.00065／0.00065／0.00065（初估；滿威力 boost ≈+3 m/s、jump ≈0.3m） | Event 技能衝量係數（N·s／effect J） |
| `K_SWERVE` | 0.0008（初估；持續側移 ≈1.5 m/s²） | Hold 側移衝量係數（N·s／effect J） |
| `K_STABILIZE` | 0.5（初估；Hold 期間角阻尼 ≈+3） | Hold 角阻尼係數（阻尼／effect J） |
| `K_PASSIVE_EFFECT_MAX_PCT` | 30（**初估**） | 被動武器加持效果上限（三因子公式的封頂係數：滿配 allocation_pct=100＋split 全壓單軸時該軸效果 %；僅及武器零件自身、X100 整數運算，[算式表.md §3](../算式表.md)） |
| `K_ACID` | 2.5（初估） | 腐蝕速率 |
| `K_MOTOR_INPUT_W_M3` | 80,000,000（初估；等同 80 W/cm³） | 馬達輸入功率密度（W/m³，`auto_input_mw = round(volume_m3 × 此值 × 1000)`） |
| `K_BATTERY_OUTPUT_W_M3` | 80,000,000（初估；等同 80 W/cm³） | 電池輸出功率密度（W/m³，`configured_output_w` 上限 = `volume_m3 × 此值`） |
| `K_BATTERY_ENERGY_MJ_M3` | 90,000,000,000,000（90 GJ/m³ synthetic reference） | 電池遊戲儲能密度（mJ/m³，`auto_energy_capacity_mj = round(volume_m3 × 此值)`） |
| `BOOST_COST_EQUIVALENT_FRAMES` / `BRAKE_COST_EQUIVALENT_FRAMES` / `JUMP_COST_EQUIVALENT_FRAMES` / `SLAM_COST_EQUIVALENT_FRAMES` | 3600／1800／3600／3600 | 四個 Event 的獨立電池成本等效幀數（60Hz） |
| `K_STRESS_BURST_FACTOR` | 1.5（初估） | 一擊重傷倍率（單次 `stress > ultimate × 此值` 即重傷） |
| `K_IMPACT_DEPTH_M` | 0.001（初估） | 衝撞等效變形深度（m；`stress_MPa = impact_energy_J / (contact_area_m² × 此值) / 1,000,000`，[算式表.md §7](../算式表.md)） |
| `IMPACT_NORMAL_QUANTIZATION_PER_UNIT` | 1,000,000 | collider-local 接觸法線的共識量化尺度；六向面積固定 X→Y→Z 加權 |
| `IMPACT_CONTACT_AREA_MIN_M2` | 0.00000001 | 衝撞有效接觸面積安全下限（m²）；避免退化分母，不是幾何 fallback |
| `IMPACT_KINEMATICS_QUANTIZATION_PER_UNIT` | 1,000,000 | 接觸點速度、方向有效質量等撞擊中間量的共識量化尺度 |
| `IMPACT_CONTACT_QUERY_MARGIN_FRAMES` | 2（初估） | collision-start 在 solver 後缺少可用 manifold 時，以 solver 前 collider 位姿重建接觸的最大相對位移 frame 裕量 |
| `IMPACT_NORMAL_MIN_CLOSING_MPS` | 0.000001（初估） | manifold 法線與 solver 前相對接觸點速度近乎正交時，改採相對速度方向的最小 closing speed（m/s） |
| `K_SHEAR_DAMAGE_TRANSFER` | 0.10（初估） | solver 切向耗散轉成一般 solid fatigue 能量的比例 |
| `SHEAR_DAMAGE_MIN_SLIP_MPS` | 0.10（初估） | 一般剪切 fatigue 的最小切向 slip（m/s）；排除靜止接觸與 solver 微抖 |

這些常數歸 `protocol/physics` 層（跨 peer 共識必須一致）。
