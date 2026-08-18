---
id: D-20260710-03
date: 2026-07-10
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-07-10 首測前 staged 清帳：房間開賽編排","2026-07-10 首測前全專案五路複審"]
files: ["程式架構/ledger.md"]
vectors: []
deprecates: []
---

# D-20260710-03｜settledMatchIds 持久去重集

## 背景與驅動力

match-result 的冪等閘原以 hot 窗 matchRecords 判重，存在兩路繞過：檢查點 cold 分桶把舊場逐出 hot；economy no-op（界限拒、月硬頂）根本不寫 hot——複製 append 同一事件即可重套 TrueSkill 與信譽等累積型 reducer，正是 [D-20260709-02](D-20260709-02-fold守門原則.md) 點名的累積型冪等缺口。五路複審列高風險項；staged 清帳輪對其語意定案。

## 考慮過的選項

- hot 窗判重（原狀）：cold 逐出與 economy no-op 不寫 hot 兩路繞過。
- 持久去重集（採納）。

## 決定

- **`state.match.settledMatchIds` 持久去重集** ＝match-result 冪等閘唯一依據：閘後無條件回寫、永不逐出、隨檢查點序列化（排序穩定）、舊檢查點缺欄以 hot keys 播種。
- **完整性 ＝ 冪等閘正確性前提**：不同於顯示用 recentMatches（可逐出），此集任一 matchId 被逐出 ＝ 該場重複結算窗重開（雙記分）。故隨場數線性成長（每筆約數十 bytes）＝ 刻意接受；任何未來 bounding 須維持「全集同步命中」（緊湊持久索引），不得採 hot 窗逐出。
- 現況見 [程式架構/ledger.md](../程式架構/ledger.md)。

## 後果與影響

cold 分桶與 economy no-op 兩路繞過關閉；雙主並行 append 被冪等閘吸收轉良性；與顯示用 recentMatches 的可逐出語意明確分工。去重集本身的毒化面（搶佔偽 settle 先寫入假 matchId）由 [D-20260710-02](D-20260710-02-deriveMatchId定式.md) 的推導定式閉合。
