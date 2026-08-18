---
type: index
domain: ["共識帳本", "建模物理", "比賽房間", "信譽仲裁"]
summary: 跨域 conformance 測試向量權威聲明＋家族索引
authority: null
slug: null
---

# Conformance 測試向量

> 共識語意的「輸入 → 期望輸出」資料集：語言中立、自足——重新實作者不跑主 repo 也能對答案。
> 目錄結構 ＝`conformance/<域>/<family>.vectors.json`，一檔一個語意家族、檔內多向量。

## 權威模型

1. **語意權威永遠在 spec 敘述**（canon 各檔）：每個 `expected` 值都必須可由敘述獨立推導；不可推導者不入向量。
2. **向量 ＝ 敘述的機器可驗採樣**，與「程式參數各 leaf 分冊（內容權威；[導覽](../程式參數.md)）↔ `system-constants`（被比對）」同款關係：收藏於本目錄後成為對實作的約束面（回放測試紅燈），位階在敘述之下。
3. **生成器 ＝ 工具、不是權威**：向量由主 repo `generate:conformance` 產值（sha-256／CID 不可手算），權威由**採納閘**賦予 ＝ 人工 review diff＋ 每家族抽樣以敘述獨立驗算。主 repo 的 conformance harness 為每個 family 至少凍結一條 `reviewedExpected`；它不得由 production `compute` 回填，生成與回放都必須另外通過該 oracle。採納後約束方向反轉——實作輸出偏離向量 ＝ 紅燈，修實作或走升版流程改契約；重生成同樣只是產值步驟、同過採納閘。
4. **矛盾位階**：向量 ↔ 敘述矛盾 ＝ 紅燈開修復項、預設修向量側；查明屬敘述筆誤 → 敘述走正常 spec 修正（屬共識語意變更者照 [升版.md](../流程/升版.md)）。實作 ↔ 向量矛盾 ＝ 回放紅燈，修實作或走升版流程改契約，二擇一。

## 變更紀律

- `formatVersion` 只描述 fixture envelope 的機器讀取格式；pre-launch 一律為 1，且不保留舊格式 reader。
- 不建立 fixture revision 或「內容改過幾次」欄位。案例與 `expected` 的歷次變更由 Git／exact specs SHA、綁定 ADR 與 `generatedBy` 追蹤，runner 不得依編輯次數分支。
- **任何 `expected` 值的改動 ＝ 共識語意變更**：條目寫進 [歷史記錄.md](../歷史記錄.md)＋ 依升版流程處理。純新增向量（增加覆蓋）不算語意變更。
- 未來若出現需跨發布相容的外部 consumer，另行決策新增 `contractVersion`；不得重用格式版本或編輯次數。

## 檔案格式

```json
{
  "family": "ledger/derive-match-id",
  "spec": ["資料系統.md", "程式架構/ledger-admission.md"],
  "formatVersion": 1,
  "encoding": { "bytes": "hex-lower", "bigint": "decimal-string" },
  "generatedBy": "open-4wd@<client version>",
  "vectors": [{ "name": "…", "input": {}, "expected": {} }]
}
```

- 編碼慣例：bytes＝ 小寫 hex；BigInt＝ 十進位字串（JSON 無 BigInt 型別；欄位語意由 spec 敘述定義）。
- `spec` 欄列出綁定的敘述權威檔（repo 相對路徑）。
- `generatedBy`＝ 產值來源記錄（provenance），非權威宣示。
- 每份 fixture 必須使用同一 envelope metadata；`pnpm check:conformance` 從 fixture 目錄發現全部家族，驗證路徑、格式、編碼、來源、案例名稱與本頁生成式索引 parity。

## 新增準則

向量必須自足（不引主 repo 代碼）、可由 spec 敘述獨立推導驗算、經採納閘 review 後 commit、家族列入下方索引。

## 家族索引

<!-- conformance-family-index:start -->
| 家族 | 綁定敘述 | 決策 | 格式 |
| --- | --- | --- | --- |
| `ledger/admission-v1` | [資料系統.md](../資料系統.md)／[程式架構/ledger-admission.md](../程式架構/ledger-admission.md) | [D-20260719-01](../decisions/D-20260719-01-LedgerAdmission-v1.md)／[D-20260815-03](../decisions/D-20260815-03-CanonicalFold自包含比賽結算.md) | format v1 |
| `ledger/derive-match-id` | [資料系統.md](../資料系統.md)／[程式架構/ledger-admission.md](../程式架構/ledger-admission.md) | [D-20260710-02](../decisions/D-20260710-02-deriveMatchId定式.md)／[D-20260814-20](../decisions/D-20260814-20-多人可驗算起跑格.md) | format v1 |
| `ledger/loadout-signing-message` | [資料系統.md](../資料系統.md)／[程式架構/ledger-settlement.md](../程式架構/ledger-settlement.md) | [D-20260710-01](../decisions/D-20260710-01-loadout參與證明.md) | format v1 |
| `ledger/match-result-quorum` | [流程/比賽進行.md](../流程/比賽進行.md)／[程式架構/ledger-admission.md](../程式架構/ledger-admission.md)／[程式架構/ledger-settlement.md](../程式架構/ledger-settlement.md) | [D-20260802-03](../decisions/D-20260802-03-三平面連線與分割安全定稿.md)／[D-20260810-02](../decisions/D-20260810-02-MatchResult固定名單門檻與離場存證.md)／[D-20260815-03](../decisions/D-20260815-03-CanonicalFold自包含比賽結算.md) | format v1 |
| `ledger/race-consensus-anchor` | [資料系統.md](../資料系統.md)／[流程/比賽進行.md](../流程/比賽進行.md)／[程式架構/ledger-admission.md](../程式架構/ledger-admission.md)／[程式架構/ledger-settlement.md](../程式架構/ledger-settlement.md) | [D-20260810-03](../decisions/D-20260810-03-回合唯一ConsensusAnchor與衝突失效.md)／[D-20260815-03](../decisions/D-20260815-03-CanonicalFold自包含比賽結算.md) | format v1 |
| `ledger/signing-digest` | [資料系統.md](../資料系統.md)／[程式架構/ledger-admission.md](../程式架構/ledger-admission.md) | [D-20260731-04](../decisions/D-20260731-04-ledger-chain-identity貫穿邊界.md) | format v1 |
| `moderation/panel-draw` | [信譽系統.md](../信譽系統.md)／[程式架構/moderation.md](../程式架構/moderation.md) | [D-20260724-03](../decisions/D-20260724-03-ADR制度與conformance權威模型.md) | format v1 |
| `physics/track-entity-snapshot` | [零件與場景.md](../零件與場景.md)／[算式表.md](../算式表.md)／[decisions/D-20260811-03-TrackEntity決定性Runtime與預配置碎片池.md](../decisions/D-20260811-03-TrackEntity決定性Runtime與預配置碎片池.md)／[decisions/D-20260811-06-輪組二元損壞與固定驅動份額.md](../decisions/D-20260811-06-輪組二元損壞與固定驅動份額.md)／[decisions/D-20260814-06-場地碎片統一純視覺.md](../decisions/D-20260814-06-場地碎片統一純視覺.md) | [D-20260814-06](../decisions/D-20260814-06-場地碎片統一純視覺.md) | format v1 |
| `physics/weather-aero` | [算式表.md](../算式表.md)／[建模參數/場地.md](../建模參數/場地.md)／[decisions/D-20260811-07-相對氣流六軸Aero與決定性Weather-Patch.md](../decisions/D-20260811-07-相對氣流六軸Aero與決定性Weather-Patch.md) | [D-20260811-07](../decisions/D-20260811-07-相對氣流六軸Aero與決定性Weather-Patch.md) | format v1 |
| `room/capacity-reservations` | [程式架構/matchmaking.md](../程式架構/matchmaking.md)／[decisions/D-20260802-06-active加reserved原子容量.md](../decisions/D-20260802-06-active加reserved原子容量.md) | [D-20260802-06](../decisions/D-20260802-06-active加reserved原子容量.md)／[D-20260802-08](../decisions/D-20260802-08-Quick-Match加入既有公開房.md) | format v1 |
| `room/quick-match-selection` | [程式架構/matchmaking.md](../程式架構/matchmaking.md)／[decisions/D-20260802-08-Quick-Match加入既有公開房.md](../decisions/D-20260802-08-Quick-Match加入既有公開房.md) | [D-20260802-08](../decisions/D-20260802-08-Quick-Match加入既有公開房.md) | format v1 |
| `room/role-admission` | [程式架構/room-runtime.md](../程式架構/room-runtime.md)／[decisions/D-20260806-01-OPAQUE角色邀請驗證.md](../decisions/D-20260806-01-OPAQUE角色邀請驗證.md) | [D-20260802-07](../decisions/D-20260802-07-RoomSession角色化admission.md)／[D-20260806-01](../decisions/D-20260806-01-OPAQUE角色邀請驗證.md) | format v1 |
<!-- conformance-family-index:end -->
