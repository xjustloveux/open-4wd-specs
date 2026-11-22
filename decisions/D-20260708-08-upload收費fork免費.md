---
id: D-20260708-08
date: 2026-07-08
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["經濟"]
sources: ["2026-07-08 里程碑 7b ugc-fork"]
files: ["程式架構/economy.md"]
vectors: []
deprecates: []
---

# D-20260708-08｜上鏈收費限 `UgcUploadEvent`、`UgcForkEvent`＝免費血緣宣告

## 背景與驅動力

ugc-fork 實作對映時撞出 canon 自相矛盾：[ugc-fork.md](../程式架構/ugc-fork.md) 定 fork 流程寫 upload＋fork **兩事件**，[economy.md](../程式架構/economy.md) 卻對兩型都收費——同一次 fork 動作被收兩次，違反 [經濟系統.md](../經濟系統.md) 上鏈費的單次語意。同輪落地複審另發現 fork parent 資格漏擋：實作只擋 builtin／ 幽靈 parent／ 禁 fork，未擋已下架與待審者。

## 考慮過的選項

- 維持兩事件皆收費：雙重收費、與單次語意矛盾（未採）。
- 收費釘在實體上傳、血緣宣告免費（採納，以經濟系統單次語意為據）。

## 決定

- **收費限 `UgcUploadEvent`**：原創與 fork 的實體上傳都寫此事件、單次收費（零件 50／ 場地 500）；**`UgcForkEvent`＝ 免費血緣宣告**、不帶費用。
- fork parent 資格補擋：parent 為仲裁**黑名單**（已下架）或 `similarity-pending` 待審者 ＝ 不建血緣、record 照建——堵「侵權物經新血緣從新作永續領分潤」；與「既有 fork 的分潤不受 parent 後續狀態影響」不衝突（時點不同：本擋為新 fork 當下的資格）。
- DMCA 清單不進帳本 ＝ 共識側不驗 parent 的 DMCA 狀態（builder 擋、維運層模型）。

## 後果與影響

上鏈費的事件掛點單一化，首次上鏈負資產（[D-20260602-01](D-20260602-01-首次上鏈負資產.md)）自此僅錨在 upload 燒費；`similarity-pending` 灰區語意見 [D-20260703-05](D-20260703-05-灰區similarity-pending.md)。費率與血緣規則權威見 [經濟系統.md](../經濟系統.md)、[版權.md](../版權.md)。
