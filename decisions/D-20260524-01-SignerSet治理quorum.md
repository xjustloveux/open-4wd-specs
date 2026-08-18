---
id: D-20260524-01
date: 2026-05-24
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-05-24 Critical 10 項回填"]
files: ["流程/治理事件.md"]
vectors: []
deprecates: []
---

# D-20260524-01｜Signer Set 治理 quorum＝floor(2N/3)+1

## 背景與驅動力

平行掃描舊 project-resources 全部 36 份 spec 回填遺失決策（Critical 10 項）時，發現治理層 quorum 寫法 drift：治理事件流程檔內全部寫 `⌈M/2⌉+1`（過半數形），與當時權威 `governance.md`（現已歷史化）的三分之二形不一致。Signer Set 是帳本檢查點與治理事件的信任錨，兩種門檻並存 ＝ 跨檔矛盾且弱化安全邊界。

## 考慮過的選項

- 以過半數形 `⌈M/2⌉+1` 為準：門檻較低，且與權威檔衝突。
- 對齊三分之二形 `floor(2N/3)+1`（採納）：治理層攸關檢查點定稿與參數變更，取較高容錯門檻。

## 決定

- Signer Set 治理 quorum＝**`floor(2N/3)+1`**，Signer Set 規模最低不得低於 3；治理事件流程內所有過半數寫法一律改正。
- 同批補齊 Signer Set 初始化規範、signer 變更流程、緊急回滾必要欄位；現況細節見 [流程/治理事件.md](../流程/治理事件.md)。

## 後果與影響

治理層 quorum 自此定形三分之二，與結算 ／ 賽中快照層的過半數門檻（[D-20260531-03](D-20260531-03-結算快照簽章門檻.md)）分屬不同層、各管各；同名「Checkpoint」概念後由 [D-20260604-02](D-20260604-02-Checkpoint三同名拆開.md) 拆開正名。單一維護者時期的現實化特例後由 [D-20260719-01](D-20260719-01-LedgerAdmission-v1.md) 釘死：N=1 合法、N=2 非法、三位以上獨立治理者才套本式。
