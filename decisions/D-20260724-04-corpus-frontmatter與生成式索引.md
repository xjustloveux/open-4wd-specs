---
id: D-20260724-04
date: 2026-07-24
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["治理營運"]
sources: ["2026-07-24 文檔工程：全 corpus frontmatter＋生成式索引"]
files: ["總覽.md", "docs-map.md", "scripts/generate-docs.mjs", "scripts/check-frontmatter.mjs"]
vectors: []
deprecates: []
---

# D-20260724-04｜全 corpus frontmatter 與生成式索引

## 背景與驅動力

corpus 的檔案索引長期是手維表格：新增、改名或換域都要人工同步總覽，漏改不會有任何訊號。
lint 與引用檢查對歷史、快照類檔案的豁免以硬編檔名清單維持，改一次檔名就靜默失效。跨檔
導覽只能靠人腦或全文搜尋，也沒有機器可讀的檔案關聯來源可供知識圖取用。

三件事的共同缺口是：每份檔案沒有結構化的自我描述，於是所有彙總都只能手抄一次。

## 考慮過的選項

- 維持手維索引與硬編豁免清單：每次改檔名都是一次隱性破壞，棄。
- 只補 frontmatter、索引仍手維：中繼資料有了卻沒有消費端，會與正文逐漸脫節，棄。
- 以 frontmatter 為單一中繼資料來源，索引與關聯圖一律由其生成（採納）。

## 決定

- 每份 corpus 檔案都要有 frontmatter：`type` 取 11 值之一、`domain` 取 11 域白名單、
  `summary` 非空且不得含節號符號或連結語法、`authority` 與 `slug` 可為 null。
- 資料夾與 `type` 必須一致；程式架構、程式流程、流程、部署資訊、美術資源與歷史記錄各有
  對應值，違反即紅燈。
- 歷史與快照類的 lint 與引用檢查豁免改由 frontmatter `type` 機器判定，取代硬編檔名；
  `.textlintignore` 留作第二道保險。
- 生成式索引三件套：[總覽.md](../總覽.md) 的檔案索引改為圍欄生成區塊、
  [docs-map.md](../docs-map.md) 為域視角導覽、`graph.json` 供知識圖取用。三者皆為 derived
  非權威，且不進入關聯圖本身以免自指。
- 生成物不受中文排版 lint 管轄——其正規化權威是生成器本身，不是排版規則。
- 生成器與 frontmatter 檢查入 CI；生成物過期即紅燈，且禁止手改生成輸出。

## 後果與影響

檔案改名、新增或換域只需改 frontmatter，索引與關聯圖隨之更新，硬編清單的隱性破壞面消失；
`decisions` 的決策檔也被納入關聯圖，只計數不展開明細。

代價是生成器成為新的單點：輸出格式一改就同時影響三份產物。另有一個必須知道的操作細節
——把新檔加進索引時，索引本身的連結也是關聯圖的一條邊，因此生成需要跑到不動點才收斂，
單跑一次不足以讓檢查轉綠。
