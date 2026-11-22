---
id: D-20260604-02
date: 2026-06-04
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-06-04 project-resources → 企劃 新舊脫鉤大重構"]
files: ["資料系統.md", "程式架構/ledger.md", "賽內機制.md", "程式參數.md"]
vectors: []
deprecates: []
---

# D-20260604-02｜Checkpoint 三同名拆開

## 背景與驅動力

「Checkpoint」一詞在 corpus 同時指三個不同概念：賽道防抄近路關卡、賽內週期性物理快照、帳本治理檢查點——三者的 quorum（過半數 vs 三分之二）、生命週期（ephemeral vs 永久）、用途全然不同，同名導致跨檔誤讀與門檻互相污染的風險。project-resources 脫鉤大重構期間一併裁決正名。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以收斂 ／ 正名形式成立。）

## 決定

- **賽道關卡** ＝`Checkpoint_<n>` 節點（防抄近路、依序通過）。
- **賽內快照** ＝`RaceSnapshotEvent`：在場 `⌊N/2⌋+1` 多簽、physics checksum、ephemeral、每 60 秒。
- **帳本檢查點** ＝`LedgerCheckpointEvent`：治理 `⌊2N/3⌋+1` 多簽，管狀態整併、同步、裁剪。
- 兩套 quorum 各管各皆正確；跨約 14 檔正名，`CHECKPOINT_*` 常數沿用 ＝ 賽內快照。現況見 [資料系統.md](../資料系統.md)、[程式架構/ledger.md](../程式架構/ledger.md)、[賽內機制.md](../賽內機制.md)。

## 後果與影響

治理三分之二（[D-20260524-01](D-20260524-01-SignerSet治理quorum.md)）與賽局過半數（[D-20260531-03](D-20260531-03-結算快照簽章門檻.md)）自此各有專名、不再互相污染；三名詞成為全 corpus 用語鐵則。`RaceSnapshotEvent` 後升格為結算 base 新鮮度的時間錨（最小 schema 於經濟複審輪首度定義）；`LedgerCheckpointEvent` 成為 pinning 服務的訂閱面與房間 pin 對象。
