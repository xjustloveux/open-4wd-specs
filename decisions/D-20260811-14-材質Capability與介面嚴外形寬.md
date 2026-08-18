---
id: D-20260811-14
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260429-01", "D-20260811-04", "D-20260811-05"]
domains: ["建模物理", "材質"]
sources: ["2026-08-11 ─ 材質 Capability 與「介面嚴、外形寬」（issue 000337）"]
files: ["建模參數.md", "車輛組裝.md", "材質表.md", "程式架構/editor.md"]
vectors: []
deprecates: []
---

# D-20260811-14｜材質 Capability 與「介面嚴、外形寬」

## 背景與驅動力

早期 canonical 規格用公版整體尺寸的固定百分比同時處理「能不能裝」與「看起來像不像」，會讓輪徑、馬達長度、滾輪外徑等本應可調的 gameplay／造型軸變成 UGC 拒收條件。材質表也同時保存物理值、分類值與 fallback；若只看到欄位有值便推論所有情境都已接線，會誤判地面熱、fluid friction 或 3D viscosity 等能力。

## 考慮過的選項

- 保留全零件 ±15%：實作簡單，但以公版半成品外觀限制開發期 UGC，且不能精確表達小型配合特徵，棄。
- 完全取消尺寸／介面檢核：創作自由最大，但 mount center、軸孔或配合面錯位會直接破壞裝配與關節求解，棄。
- 介面逐特徵絕對公差＋外形自由，並以 runtime consumer 定義材質 capability（採納）。

## 決定

- canonical 相容性只檢查 mount center、hinge axis／radius／width 與 mating normal 等真正裝配介面；每個 feature 自帶 m 或 degree 絕對公差，無共用百分比帶。未知 kind、無效數值／單位或超限均 Stage 3 拒收。
- 輪徑、馬達總長、滾輪外徑、零件 AABB、外殼比例與純視覺輪廓不得進入介面量測 API。公版 GLB 是開發期半成品與視覺／平衡起點，不是 UGC 外形模板。
- 材質欄位只有在正式 runtime 有明確 consumer 時才可宣稱 gameplay capability。solid 接觸才使用 friction／restitution；rolling resistance 只用於輪組與 solid surface；熱以 vehicle part 與固定溫度地表／entity 熱庫交換，不建立動態地面熱場。
- fluid 維持 sensor＋deploy behavior；sticky velocity decay 是明示效果，不擴張成 3D viscosity、浮力、體積流場或一般流體阻力。材質數值無 consumer 時只屬分類／fallback，不會因調參自動生效。
- 所有 schema-valid UGC 的有限值與決定性是 runtime 責任。極端但合法的外形、質量與材質組合應由固定步長、guard、clamp、budget 或明示退化處理；拒收只用於文件化的安全、資源與介面界限。

## 後果與影響

本決策修訂 [D-20260429-01](D-20260429-01-socketType廢除前綴匹配.md) 的 lenient 尺寸語意：Mount 命名仍是相容性地基，但尺寸門檻收斂為介面絕對公差。它也補充 [D-20260811-04](D-20260811-04-逐Collider材質接觸與滾動阻力.md) 與 [D-20260811-05](D-20260811-05-能量域熱模型與固定熱庫接觸.md)：材質效果以實際 consumer 為準，固定熱庫不暗示地面熱場，fluid sensor 不暗示 3D 流體。未來新增 capability 必須同時交付 runtime、決定性／有限值測試與規格，不得只改參數表。
