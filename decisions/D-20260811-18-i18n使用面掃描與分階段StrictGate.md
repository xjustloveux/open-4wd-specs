---
id: D-20260811-18
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260704-02"]
domains: ["前端主題", "治理營運"]
sources: ["2026-08-12 ─ i18n 使用面 strict gate"]
files: ["程式架構/i18n.md", "程式架構/testing.md", "程式架構/toolchain.md"]
vectors: []
deprecates: []
---

# D-20260811-18｜i18n 使用面掃描與分階段 Strict Gate

## 背景與驅動力

既有 i18n 驗證只比較四份字典，能抓語系間缺鍵，卻不知道產品程式實際使用哪些 key；程式引用
不存在的 key 與字典中的 dead translation 都可在 CI 全綠時長期累積。若直接把新掃描併入既有
strict command，當時的大量存量缺口會讓跨 session 清理期間持續紅燈且無法區分新舊違反。

## 考慮過的選項

- 保持字典互比：零新增成本，但無法驗證 production 使用面。
- 以 baseline 豁免既有缺口並立即掛閘：能阻擋新增，卻建立需要長期維護的債務清單。
- 先以獨立報表列全量缺口，完成缺鍵與死鍵清理後再無 baseline 接 strict CI：採納。

## 決定

建立獨立 production TypeScript／HTML 使用面掃描器，辨識靜態 key、樣板、受支援動態前綴、registry
前綴與 ICU 參數。初期 report mode 不併入既有 `i18n:validate`；清理完成後以 strict mode 納入 CI，
缺字典 key 與 dead translation 均直接失敗。不保存 baseline、豁免清單或永久 report-only 模式。

## 後果與影響

此決策擴充 [D-20260704-02](D-20260704-02-i18n自寫SW與前綴接縫.md) 的字典驗證基準，讓語系
集合與程式使用面形成雙向證據。動態 key 寫法必須可被 scanner 靜態辨識或明確登記前綴；任意字串
拼接不再能依賴人工 review 才發現。
