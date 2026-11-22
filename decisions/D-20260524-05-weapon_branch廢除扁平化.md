---
id: D-20260524-05
date: 2026-05-24
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-05-24 Critical 10 項回填"]
files: ["建模參數.md", "車輛組裝.md", "零件與場景.md"]
vectors: []
deprecates: [{"item":"weapon_branch","kind":"replaced","replacement":"weapon_mechanism／weapon_main_mesh_node／weapon_max_angle_deg"},{"item":"chip_kinetic_ratios loadout 欄位","kind":"replaced","replacement":"上鏈後 immutable 的 chip kinetic_ratio"},{"item":"battery.output_w","kind":"renamed","replacement":"battery.declared_output_w"}]
---

# D-20260524-05｜`weapon_branch` 容器廢除＝三獨立 extras 扁平化

## 背景與驅動力

同日建模參數表審計九項清理中的三項結構收斂：`weapon_branch` 容器徒增一層巢狀；battery 輸出功率 `declared_output_w`／`output_w` 兩名並列；chip `kinetic_ratio` 留有「組裝時可調」例外——最後者與上鏈資產不可變的方向直接牴觸。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以清理 ／ 收斂形式成立。）

## 決定

- **`weapon_branch` 容器廢除**，扁平化為三個獨立 extras：`weapon_mechanism`／`weapon_main_mesh_node`／`weapon_max_angle_deg`。
- chip **`kinetic_ratio` 上鏈後完全 immutable**：移除「組裝時可調」例外，車輛組裝側同步移除 `chip_kinetic_ratios` loadout 欄位。
- battery 輸出功率**單名化**：只保留 `declared_output_w`。現況見 [建模參數.md](../建模參數.md)。

## 後果與影響

`kinetic_ratio` 鎖死翌日升格為「GLB 上鏈後皆不可修改」全域鐵則（[D-20260525-02](D-20260525-02-GLB上鏈後不可修改.md)）；也正因上鏈鎖死，後續被動加持（[D-20260706-06](D-20260706-06-被動加持三因子.md)）能直接以 `kinetic_ratio` 為外層總量。三獨立 extras 存續至 multi-actuator 重構（[D-20260628-01](D-20260628-01-武器multi-actuator統一.md)），`weapon_max_angle_deg` 名稱獲保留並移進 actuator。
