---
id: D-20260814-17
date: 2026-08-14
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["前端主題", "比賽房間"]
sources: ["2026-08-14 ─ Onboarding 採單人本機結果里程碑（issue 000501）"]
files: ["流程/玩家整體旅程.md"]
vectors: []
deprecates: []
---

# D-20260814-17｜Onboarding 採單人本機結果里程碑

## 背景與驅動力

玩家旅程把 onboarding 第三步寫成「對 Bot 跑一場」，但專案沒有 Bot／AI 對手；現行流程是單人
本機測試，且只要 race runtime 正常產生本機摘要就會完成里程碑。

## 考慮過的選項

- 為符合舊文字新增 Bot：會把完整 AI 系統不必要地綁入首次上鏈，棄。
- 只把文字改成「跑完」：容易誤解為必須抵達終點，與時間到／失能正常結算不符，棄。
- 以 canonical `LocalMatchSummary` 作單一完成條件，明載所有合法 end reason（採納）。

## 決定

- 第三步是完整進行一場單人本機測試，直到正常產生 canonical `LocalMatchSummary`；不要求對手、
  獲勝、名次或抵達終點。
- `completed`、`duration-limit` 與終局解算後的 `eliminated` 都完成里程碑。onboarding 不另行
  猜測零件狀態，也不改寫摘要。
- 時間到但未抵達終點仍是 DNF、`finishTimeMs = null`；里程碑完成不等於競賽完賽。
- 載入失敗、賽前取消、runtime error、直接離開、缺失摘要與 local session 收到非 local summary
  都不完成。
- Bot 若未來新增，另立功能議題定義完整 AI 與結果邊界，不自動成為上鏈解鎖要求。

## 後果與影響

Canon 與現行單人流程一致，玩家不會因不存在的 Bot 或未抵達終點而卡住；RacePage 也會對
session／summary mode 不相符 fail closed，只有真實本機結果能推進里程碑。
