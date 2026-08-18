---
id: D-20260809-08
date: 2026-08-09
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260729-01"]
domains: ["治理營運", "UGC版權", "版本部署"]
sources: ["2026-08-09 ─ 跨 Repo Canonical Leaf Contract 與 Vendor Parity（issue 000282）"]
files: ["程式架構/interfaces.md", "程式架構/pinning-service.md", "程式架構/toolchain.md"]
vectors: []
deprecates: []
---

# D-20260809-08｜跨 Repo Canonical Leaf Contract 與 Vendor Parity

## 背景與驅動力

UGC transfer limits 與 Pinning HTTP 507 reason 同時被 main 與 pinning 使用，卻各自維護平行手抄
常數與型別。只做 drift assertion 仍保留兩個可被獨立修改的權威，也無法保證乾淨 vendor sync 後
所有 transitive leaf 都完整、可編譯。

## 考慮過的選項

- 兩 repo 各留一份，測試比對值：改動簡單，但 ownership 與結構仍可漂移。
- 主 repo 擁有窄 canonical leaf，pinning 使用 vendored copy 並以 manifest／sync gate 驗 parity：採納。

## 決定

UGC content profile 與實際 API 可回傳的 Pinning 狀態 vocabulary 各自只有一份 canonical leaf owner；
main consumer 直接引用該 leaf，pinning 消費受 manifest 鎖定的 vendored copy。Vendor gate 必須驗 exact
bytes／清單與完整 import closure；新增 transitive leaf 時同步更新 manifest，乾淨同步後仍須能獨立
編譯。不再以平行手抄常數加 assertion 冒充單一權威。

## 後果與影響

此決策把 [D-20260729-01](D-20260729-01-跨repo規則追溯ownership.md) 的跨 repo ownership 原則
落到實際共享程式契約。代價是 vendor manifest 與 parity gate 成為每次契約變更的必要同行修改。
