---
id: D-20260708-07
date: 2026-07-08
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["UGC版權"]
sources: ["2026-07-08 里程碑 7c anti-piracy"]
files: ["程式架構/anti-piracy.md", "版權.md"]
vectors: []
deprecates: []
---

# D-20260708-07｜anti-piracy 宣告收件驗證只看 on-chain active 集合

## 背景與驅動力

里程碑 7c 落地 anti-piracy（相似度分類 ／ 宣告收件驗證 ／ 安全港 ／ 下架 reducer）後，同日複審抓到高風險項：收件驗證的逐對重算納入了 DMCA 清單命中（`dmcaListed`）並據以拒收——DMCA 清單隨 client 版出貨、各版內容不同，同一宣告跨 client 收拒不一 ＝ 分叉面；canon 早已明文「DMCA 清單不可入共識分層、收件驗證只能吃 on-chain 狀態」（[D-20260703-05](D-20260703-05-灰區similarity-pending.md) 追補即定），實作違規。

## 考慮過的選項

- 收件驗證納 DMCA 清單（原實作）：決定性違規、跨版 split，不可選。
- **收件只看 on-chain、DMCA 硬擋收斂到 UX／ 分類層**（採納）。

## 決定

- **宣告收件驗證只看 on-chain active 集合**（active＝ 非仲裁判抄下架、鏈上可決定）；DMCA 命中不影響收件結果。
- **DMCA 硬擋只留 UX／ 分類層**：`classifySimilarity` 的 `dmcaListed` 保留，供本地上傳決策用。
- **防鹽化分層同步落實**：90% 以上命中全為 blacklisted（仲裁判抄下架品）時降級 similarity-pending、永不硬擋；混合命中取最嚴（任一 90% 以上命中為活躍或 DMCA → 本地拒收）。

## 後果與影響

收件層決定性徹底閉合（原則見 [D-20260707-01](D-20260707-01-決定性紀律.md)），DMCA 維持純維運層定位（[D-20260702-02](D-20260702-02-DMCA維運層化.md)）、不因實作落地而滲入共識。隱匿 DMCA 命中的宣告由事後檢舉承接；拒收結果只回硬擋 matches（判抄品命中不列，fork／ 申訴對象更準）。收斂落於 [anti-piracy.md](../程式架構/anti-piracy.md)，相似度門檻權威仍在 [版權.md](../版權.md)。
