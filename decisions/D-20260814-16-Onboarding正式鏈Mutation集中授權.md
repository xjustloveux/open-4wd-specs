---
id: D-20260814-16
date: 2026-08-14
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260811-17"]
domains: ["共識帳本", "前端主題"]
sources: ["2026-08-14 ─ Onboarding 正式鏈 mutation 集中授權（issue 000500）"]
files: ["流程/玩家整體旅程.md", "程式架構.md"]
vectors: []
deprecates: []
---

# D-20260814-16｜Onboarding 正式鏈 Mutation 集中授權

## 背景與驅動力

四步 onboarding 已以 `chainUnlocked` 表達「準備完成才開放正式上鏈」，但實作只擋正式車位，
編輯器、評分與檢舉等 provider 可直接產生 ledger 事件。頁面提示也無法防止直接呼叫 provider。

## 考慮過的選項

- 只停用編輯器發布按鈕：可被其他頁面或直接 provider 呼叫繞過，棄。
- 在 ledger 最底層一律依本機 profile 阻擋：會誤傷已開始賽事與多方仲裁的協定收尾，棄。
- 集中登錄玩家 command，在 provider 寫入邊界 fail closed；協定收尾另列具名例外（採納）。

## 決定

- 車位購買、UGC 評分／撤回、檢舉、仲裁投票與創作者發布全部登錄為
  `requires-chain-unlocked`；未知正式 mutation 預設拒絕。
- 授權直接檢查 current schema 的四個里程碑與 `chainUnlocked`，不加入舊欄位 fallback、migration
  或缺欄正規化。
- `match-result`、`race-consensus-anchor`、`race-leave`、`race-abort-evidence` 與
  `arbitration-result` 只作已開始協定的具名收尾例外，每項必須保留理由與覆蓋測試。
- 編輯器在計費與 canonical finalize 前先查 onboarding 以提供明確提示，但 provider 邊界仍再次
  驗證。首頁持續顯示可恢復的引導入口；本機草稿、本機資產、本機比賽與純讀取維持可用。

## 後果與影響

新增玩家正式寫入時必須同步登錄政策，漏接會直接失敗而非靜默取得上鏈能力。協定收尾不會被
本機 onboarding 狀態中斷，且 UI、provider 與規格共同指向同一授權語意。
