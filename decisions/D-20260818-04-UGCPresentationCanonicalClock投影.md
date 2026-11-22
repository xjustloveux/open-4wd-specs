---
id: D-20260818-04
date: 2026-08-18
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260816-08"]
domains: ["UGC版權", "共識帳本"]
sources: ["2026-08-18 ─ UGC Presentation canonical clock 投影"]
files: ["UGC機制.md", "資料系統.md", "程式架構/ledger-admission.md", "流程/UGC上傳.md", "編輯器操作.md"]
vectors: []
deprecates: []
---

# D-20260818-04｜UGC Presentation canonical clock 投影

## 背景與驅動力

D-20260816-08 已決定 presentation revision 的冷卻使用事件套用時的 canonical
`state.derivedAt`，但未把 live admission 在事件尚未 fold 前如何取得該時間寫成可執行公式。
若 live 直接使用 mirror head 的 `derivedAt`，作者上次更新後即使已過一小時，只要期間沒有其他
事件推進 mirror，合法更新仍會被拒絕；full fold 卻會先以事件時間推進 `derivedAt` 後接受，造成
live 與 replay 分歧。revision 0 若直接保存 upload 自報時間，也會產生相同的不一致錨點。

## 考慮過的選項

- live 只讀 mirror head：不需投影，但會在低流量時自鎖，且與 fold 分歧；不採。
- 直接以事件 `timestamp` 作冷卻鐘：可解自鎖，但 timeless replay 可用倒填時間偽造間隔；不採。
- live 投影 fold 將採用的 effective time：維持單調 clock 與 single-source policy；採納。

## 決定

- canonical fold 套用事件前先令 `derivedAt = max(previousDerivedAt, event.timestamp)`；presentation
  policy 只讀這個 effective time。
- live admission 尚未 fold 事件時，以同式
  `effectiveAt = max(mirrorHead.derivedAt, event.timestamp)` 驗證；UI preflight 以即將 stamp 的本機
  `now` 代入同式。live 標準事件時間閘仍限制 timestamp，因此這不是允許任意自報時間製造冷卻。
- revision 0 的 `presentationUpdatedAt` 記錄 upload 套用時的 `state.derivedAt`，不記 upload 原始
  `timestamp`。後續 revision 沿用相同錨點語意。
- 事件原始 `timestamp` 仍保留於簽署資料；timeless replay 不倒退既有 `derivedAt`，因此不能靠
  倒填事件製造額外冷卻間隔。

## 後果與影響

低流量 ledger 上的一小時後合法更新不再需要額外事件推進 mirror；live admission、UI preflight、
full fold 與 refold 對同一事件得到一致裁決。專案仍在 pre-launch，revision 0 錨點直接改採 current
canonical 語意，不提供舊 checkpoint 或舊資料 migration。
