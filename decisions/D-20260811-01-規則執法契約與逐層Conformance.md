---
id: D-20260811-01
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260724-05", "D-20260725-06", "D-20260729-01"]
domains: ["治理營運"]
sources: ["2026-08-11 ─ 規則執法契約與逐層 Conformance（issue 000330）"]
files: ["rule-contracts.json", "rules.json", "scripts/generate-rules.mjs", "scripts/check-trace.mjs"]
vectors: []
deprecates: []
---

# D-20260811-01｜規則執法契約與逐層 Conformance

## 背景與驅動力

既有規則 ID 只回答「某測試提過這個 ID」，不能回答規則是否在正確邊界執法。實例是
ECON-R-027：builder 測試完整覆蓋贊助限制，但 live admission 與 deterministic fold 原本都
沒有同一政策，`check:trace` 仍顯示全綠。另一方面，物理、場地、零件、UGC、版本與資安域
沒有正式 ID，恰好避開近期最多的跨層缺口。

## 考慮過的選項

- 保留一般註解，另用測試檔路徑推測層級：檔名不能證明測試呼叫正式邊界，仍可由 builder
  測試冒充 admission，棄。
- 只替新規則增加 `layer`：舊規則繼續保有假綠燈，且同一規則可能需要多層執法，棄。
- 建立完整結構契約，逐層使用可執行 conformance harness，遷移後一次啟用 hard gate（採納）。

## 決定

- canon 內文仍以唯一粗體主錨承載語意；`rule-contracts.json` 對每個主錨完整宣告 `kind`、
  `requiredLayers`、`implementationRepos` 與逐層 `testContracts`。canon 與 contract ID 集合必須
  完全相等；不提供 default、舊格式或 report-mode fallback。
- `kind` 僅允許 `reject`、`derive`、`behavior`、`invariant`、`calibration`；layer 僅允許
  `authoring`、`finalizer`、`admission`、`fold`、`room`、`runtime`、`service`、
  `schema-static`。同一規則可要求多層，且每層必須有全 registry 唯一的 contract ID。
- `rules.json` 繼續是 derived registry，由 canon anchors 與 `rule-contracts.json` exact join 產生。
  原 `rule-ownership.json` 的 ownership 併入完整 contract，不再作執行期輸入。
- 一般 `// 驗證規則：〔ID〕` 註解保留作追溯，但不能滿足 required layer。逐層證據必須在
  `*.conformance.spec.ts` 以 `ruleConformance` 宣告 exact ID／layer／contract，並透過 harness
  的 `invoke` 實際呼叫傳入的 production boundary；verify 未呼叫 boundary 時測試必敗。
- checker 對 ghost、錯 owner、缺 layer、錯 layer、錯 contract、非專用檔、缺 harness import、
  重複 conformance 與 hard rule 缺 contract 一律 hard-fail。檔案路徑只作輔助訊號，不替代
  executable conformance。
- ID 前綴擴為 LEDGER／ECON／MOD／PHYS／TRACK／PART／UGC／VERSION／SEC。只納入會影響
  canonical bytes、上鏈接受、跨 peer state、正式玩法或穩定產品契約的規則；純敘述、一般
  authoring warning 與建議不掛號。
- calibration 規則必須宣告獨立 vector ID 與有限接受區間，測試以 production 公式／常數算出
  觀測值。canon 與 source 互相比對的 drift test 不足以滿足 calibration contract。

## 後果與影響

規則 coverage 從「ID 出現在測試」升為「每個必要執法層都有正式邊界證據」。新增 admission
或 runtime 規則時，builder/UI 測試不能再製造安全假象；缺少產品接線的規則會在 hard gate
直接顯示缺哪一層。

代價是 registry 與 conformance 遷移量明顯增加，且 harness 仍不能取代人工檢查測試向量是否
真正打中規則。工具保證 boundary 被呼叫、tuple 精確且 ownership 正確；向量品質由 code review
與產品 issue 的反例維持。

本決策修訂 D-20260724-05 的三域範圍、D-20260725-06 的 report mode，以及
D-20260729-01 的分離 ownership 輸入；三者其餘關於穩定 ID、append-only 編號、明示 target 與
跨 repo ownership 的原則維持有效。
