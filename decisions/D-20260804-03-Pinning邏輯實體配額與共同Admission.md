---
id: D-20260804-03
date: 2026-08-04
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260720-01", "D-20260728-04", "D-20260803-03"]
domains: ["UGC版權", "版本部署"]
sources: ["2026-08-04 ─ Pinning 邏輯／實體配額與共同 Admission（issue 000154）"]
files: ["程式架構/pinning-service.md", "程式架構/interfaces.md", "部署資訊/open-4wd-pinning.md"]
vectors: []
deprecates: []
---

# D-20260804-03｜Pinning 邏輯／實體配額與共同 Admission

## 背景與驅動力

Pinning 的 signer 配額、provider 全域容量、checkpoint reconcile 與即時 pin 流程原先共用單一
`sizeBytes`，無法區分一個 root 引用的邏輯 bytes 與 DAG 去重後實際新增的 physical bytes。
各路徑若各自估算，會讓相同內容因入口不同而得到不同 admission 結果，也無法誠實呈現可接受新 pin
與否。

## 考慮過的選項

（流水帳未將「全部使用 logical bytes」或「全部使用 physical bytes」記為正式替代方案；本決策以
signer／root logical、provider 全域 root-attributed incremental physical 與共同 admission 的收斂形式成立。）

## 決定

per-signer 與 per-root 配額依 logical referenced bytes 計算；provider 全域容量依 root-attributed
incremental physical bytes 計算。API pin、checkpoint reconcile、replacement 與 cluster pin／unpin
共用相同 admission 與記帳模型，只有底層操作成功後才更新帳本。可觀測性必須分辨 logical 合計、
quota 使用量、上限與 `accepting_pins`；attributed physical 不冒充 Kubo 即時磁碟占用。

## 後果與影響

此決策細化 [D-20260720-01](D-20260720-01-pinning架構A-prime.md) 的 provider 儲存模型、
[D-20260728-04](D-20260728-04-Pinning可觀測性與私有Metrics.md) 的可觀測性，以及
[D-20260803-03](D-20260803-03-Pinning無官方節點與開發期baseline-v1.md) 的社群 provider 契約。
共享 child 的重歸屬與硬儲存預留仍是獨立問題，不在此決策中擴張共識 schema。
