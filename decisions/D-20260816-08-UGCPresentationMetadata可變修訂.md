---
id: D-20260816-08
date: 2026-08-16
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260810-02", "D-20260810-03", "D-20260815-03"]
domains: ["UGC版權", "共識帳本"]
sources: ["2026-08-16 ─ UGC Presentation Metadata 採獨立簽署 Revision"]
files: ["UGC機制.md", "資料系統.md", "程式架構/ledger.md", "流程/UGC上傳.md", "編輯器操作.md"]
vectors: []
deprecates: []
---

# D-20260816-08｜UGC Presentation Metadata 可變修訂

## 背景與驅動力

UGC 的 GLB、CID、PhysicsManifest、版權授權、作者與 lineage 必須不可變，但產品原始規劃允許
作者在不換 CID 的情況下修改顯示名稱、描述與 tags。先前把名稱與 tags 混入
`UgcUploadEvent.metadata`，會讓它們成為原 upload 簽章的一部分；若直接覆寫該事件，既有簽章必然
失效。另一方面，把可變欄位完全放在 ledger 外又無法建立跨 peer 一致的作者權威與 revision。

## 考慮過的選項

- 直接修改既有 upload event：破壞 append-only log 與原簽章，不採。
- presentation 完全留在本機或 provider：不影響簽章，但沒有全網權威、不同 provider 會分歧，不採。
- 保留不可變 upload，另寫作者簽署的 revision event：原簽章與 CID 不變，同時保有可驗權威；採納。

## 決定

- `UGCMetadata` 只含 admission／內容不可變欄；`UgcUploadEvent.presentation` 建立 revision 0。
- 新增永久單簽事件 `ugc-metadata-update`，內容為 exact CID、完整替換的
  `UgcPresentationMetadata` 與下一個 revision。事件由原作者以 chain-bound ledger digest 簽署；
  更新不修改或重新驗算舊 upload event。
- 只接受 `currentRevision + 1`；成功 presentation 之間至少相隔 1 小時。冷卻以事件進入
  canonical fold 時已單調推進的 `state.derivedAt` 計算，成功後 `presentationUpdatedAt` 亦記錄
  該 effective time；事件原始 `timestamp` 只供簽署與稽核，不作冷卻鐘。未知 CID 或 live state
  尚未追上 revision 時 defer；作者不符、stale、冷卻未滿或黑名單 CID reject／fold no-op。
  retired 與 similarity-pending 仍可更新，且更新不傳播到 successor CID。
- name 至多 256 UTF-8 bytes；description 至多 500 Unicode code points 且 2000 UTF-8 bytes；
  tags 至多 32 筆、每筆 64 UTF-8 bytes。文字必須 NFC 且不得含 control／format code point；UI
  只能以純文字呈現。
- `metadata_update_minor` 預設 0。未來非零時，扣款與 revision 套用是單一原子 fold；失敗更新不扣款。
  presentation、revision 與 updatedAt 都是 current checkpoint 必填資料。

## 後果與影響

既有 upload／asset 簽章與 CID 不會因改名失效；每次修改本身則有獨立、可驗、可重播的簽章。
事件目錄增加一種永久事件，main 與 pinning vendor 必須同步 exact schema。專案仍在 pre-launch，
因此直接採 current wire／checkpoint 形狀，不提供混合 metadata 或舊 checkpoint migration。
同一 canonical `derivedAt` 下連續倒填多筆 update 只會接受第一筆；下一筆須等 canonical clock
再前進至少 1 小時，不能以人為拉開事件 `timestamp` 繞過冷卻或造成自鎖。
