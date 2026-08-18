---
id: D-20260602-02
date: 2026-06-02
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["經濟"]
sources: ["2026-06-02 斷線結算經濟規則"]
files: ["經濟系統.md", "算式表.md", "流程/比賽進行.md", "流程/比賽結算.md"]
vectors: []
deprecates: []
---

# D-20260602-02｜斷線結算＝forfeit＋finisherCount＋不足 3 人經濟 void

## 背景與驅動力

經濟系統審視 Q2：斷線 ／ 棄賽者的經濟處理未定，且舊規則「斷線視為最後名次完賽（領末位獎）」開出「開房後全體斷線刷幣 ／ 刷 royalty」漏洞——獎金公式以開賽人數計，人斷光獎照發。

## 考慮過的選項

- 維持「斷線視為末位完賽領獎」：與 forfeit 概念牴觸、刷幣漏洞不閉（翻正）。
- forfeit＋ 完賽人數計價 ＋ 低完賽數經濟 void（採納）。

## 決定

- 獎金公式玩家數重定義為**完賽人數**：變數 `playerCount` 全改 `finisherCount`。
- 異常斷線者**與主動棄賽者**皆 forfeit：不計入 `finisherCount`、不發任何獎金；名次仍列最後，供記錄 ／TrueSkill／ 信譽使用。
- `finisherCount` 小於 3 ＝ **經濟 void**：獎金與 royalty 全空（含三層分潤），但比賽結果照常——完整名次照寫、TrueSkill／ 信譽 ／raceRecords 照常，空 settlement 仍走 ⌊N/2⌋+1 簽章。

## 後果與影響

刷幣至少需 3 名真實完賽者，solo／ 雙人分身房直接出局；「經濟 void 但競技結果有效」成為固定劃界。`finisherCount` 至少 3 其後成為場級鑄幣統一謂詞 `mintEligible` 的一半（[D-20260703-08](D-20260703-08-settlement收件全網重算.md)）。斷線頻率與信譽扣分的細則當時暫緩、另隨信譽系統收斂。細節權威見 [經濟系統.md](../經濟系統.md)。
