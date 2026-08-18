---
id: D-20260628-01
date: 2026-06-28
status: accepted
supersedes: ["D-20260517-01"]
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-06-28 武器 multi-actuator 統一模型整進 canonical"]
files: ["建模參數.md", "算式表.md", "程式參數.md", "編輯器操作.md"]
vectors: []
deprecates: []
---

# D-20260628-01｜武器 multi-actuator 統一模型（`weapon_actuators[]`）

## 背景與驅動力

「兩邊各自獨立旋轉」的武器在單 `Pivot`＋ 單 `weapon_max_angle_deg` 模型下做不到（中心 slot、整體同轉可以；兩側獨立不行）。同日二次重審先評估為僅到草案（與磁源劃界同輪，見 [D-20260628-02](D-20260628-02-磁源兩套劃界.md)），經多輪設計收斂後使用者裁定：機制與參數**現在定案進 canonical**，只有編輯器 UI 留草案（綁整體版面未定項）。

## 考慮過的選項

- 維持單 Pivot＋ 單角度模型：兩側獨立旋轉做不到，評估已確認。
- 多轉子另立草案暫停（前一輪裁定）：功能龐大、受編輯器版面未定項影響。
- 統一 `weapon_actuators[]` 模型定案（採納）：單轉、多轉、單鏈、多鏈全為其特例。

## 決定

- `general` 機制統一為 **`weapon_actuators[]`**：每項一個獨立驅動 pivot，payload＝ 剛體轉子 `mesh_node` 或鏈條 `chain`。
- 轉速 **energy-driven＋ 總功率守恆**：`ω_i = P × K_WEAPON_ROTOR_SPEED × (speed_weight_i / Σ speed_weight)`、`P = kinetic_ratio × battery.declared_output_w`；`speed_weight` 預設 1＝ 均分，加 actuator 各自變慢——**無疊加 exploit**；耗能 ／ 發熱不隨數量變。
- 鏈條 ＝actuator payload：基座旋轉吃 `speed_weight`，尾段 `Chain_Segment` 物理 joint 甩動不吃。
- **共用單一觸發**（晶片 1 個 weapon 槽）；獨立的是運動、非觸發；同武器各 actuator 間關碰撞。
- 反作用力 **weapon-level 沿 `Axis`**（共用 `applied_energy`、淨值不變、不模擬轉向 recoil 抵銷）。
- 常數：新增 `MAX_WEAPON_DRIVEN_PIVOTS`（8）／`K_WEAPON_ROTOR_SPEED`；`MAX_CHAIN_SEGMENT` 改 **`MAX_WEAPON_DRIVEN_BODIES`**（16＝ 剛體轉子 ＋ 全鏈段總數封頂）；body 預算不變；保留 `weapon_max_angle_deg` 名並移進 actuator。現況見 [建模參數.md](../建模參數.md) 與 [算式表.md](../算式表.md)。

## 後果與影響

完整取代 [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) 的 master/slave 分支樹。兩項已報備的可重議判斷：① 反作用力停在 weapon-level（要模擬雙臂抵銷須改逐 actuator 拆向）；②`weapon_main_mesh_node` 對 general 武器仍必填、當基座 ／hub。多 actuator 的編輯器 UI 留草案續議。
