---
id: D-20260703-04
date: 2026-07-03
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["資安"]
sources: ["2026-07-03 資安規範.md 二輪複審"]
files: ["程式架構/security.md", "資安規範.md", "程式參數.md", "程式架構/anti-piracy.md"]
vectors: []
deprecates: [{"item":"SANITIZE_LIMITS","kind":"replaced","replacement":"結構安全絕對天花板與 Stage 1–3 per-type 檢核"}]
---

# D-20260703-04｜sanitize＝絕對天花板＋不可信 GLB 解析 Worker 邊界

## 背景與驅動力

資安二輪複審：舊 `SANITIZE_LIMITS` 是重構前概念殘塊——三角形與邊界上限撞場地合法規模、質量 ／ 密度欄位在 sanitize 階段原理上算不出（質量 ＝ 體積 × 材質密度，材質後段才指派）、`meshFormat` 列著已廢格式、non-watertight 被誤設為拒收。另一面：上傳檢核全在上傳者 client，擋不住改裝 client 直接上鏈敵意 GLB，而收件重算與載入必須解析它——一筆敵意上傳 ＝ 全網解析炸彈。

## 考慮過的選項

- 保留舊組逐項調數值：模型本身錯位，per-type 合法輸入仍會被結構層誤拒、調值救不了（未採）。
- 整組廢除、重定義為絕對天花板 ＋ 解析隔離（採納）。

## 決定

- 舊 `SANITIZE_LIMITS` **整組廢除**；sanitize 重定義為結構安全**「絕對天花板」**——只擋任何 type 都不可能合法的 GLB，數值改引 canon 常數；per-type 幾何、質量、密度檢核歸 Stage 1–3 pipeline，sanitize 不重複設限。
- 新結構常數 **`SANITIZE_EXTRAS_MAX_BYTES`**＝`16_777_216`（16 MB；同日勘誤自 64KB 放大——長賽道 extras 可合法累積數 MB；extras 總量不等於 GLB 檔案大小）與 **`SANITIZE_EXTRAS_MAX_DEPTH`**＝8（初估）。
- **不可信 GLB 解析信任邊界**：所有不可信 GLB 首次解析一律進 Sanitize Worker、同隔離同限額（上傳前 ／ 收件重算 ／ 首次載入）；失敗 ／ 超時 ／ 超限 ＝ 本地拒用 fail-fast（拒用是本地行為、非共識拒收）；收件重算遇 GLB 未同步或解析失敗 ＝ 暫緩排隊、有界重試。不變式：**不可信 GLB 不進主執行緒解析**。

## 後果與影響

上傳檢核定位改為「誠實 client 的品質閘」，對抗面全由 Worker 隔離承擔；暫緩排隊比照 settlement base 模式（[D-20260703-08](D-20260703-08-settlement收件全網重算.md)），`worker-src` 已在同日 CSP 定案（[D-20260703-01](D-20260703-01-CSP-meta注入.md)）預留。常數權威見 [程式參數.md](../程式參數.md)，邊界細節見 [資安規範.md](../資安規範.md)。
