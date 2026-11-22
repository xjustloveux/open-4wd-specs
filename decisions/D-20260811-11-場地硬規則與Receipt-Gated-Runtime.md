---
id: D-20260811-11
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260811-01", "D-20260811-02"]
domains: ["建模物理", "UGC版權", "共識帳本", "資安"]
sources: ["2026-08-11 ─ 場地硬規則與 Receipt-Gated Runtime（issue 000328）"]
files: ["建模參數.md", "UGC機制.md", "程式架構/editor.md", "程式架構/physics-engine.md", "程式架構/ugc-fork.md"]
vectors: []
deprecates: []
---

# D-20260811-11｜場地硬規則與 Receipt-Gated Runtime

## 背景與驅動力

場地規則原先只在編輯器與本機匯入執行；舊 track `PhysicsFingerprint` 只有六個幾何摘要，無法判定
route、lap mode、重力、天氣、entity 或資源上限。即使事件與摘要相符，正式賽仍可能讀到未經完整
場地規則驗證的 bytes。

## 考慮過的選項

- 擴充舊 fingerprint 並讓 runtime 逐欄判定：會複製不完整的第二套權威，且仍無法證明實際幾何，棄。
- 每次賽前重跑幾何與完整場地 validator：安全但把高成本工作放進高頻路徑，棄。
- finalizer 與首次 CID admission 共用純 validator，runtime 只收 receipt-gated typed manifest（採納）。

## 決定

- 建立 `TRACK-R-001`：canonical finalizer 與首次 ledger content admission 都必須對實際 GLB 執行同一套
  無 UI 依賴的場地 validator。route／checkpoint／empty、canonical derivation、重力／磁源、天氣、
  材質、entity 與幾何／資源上限等 `reject` findings 是協定規則；`warn` 只留在 authoring UI。
- 首次 admission 獨立重建完整 `TrackPhysicsManifest`，核對 embedded version／digest／schema，並在
  發布 admitted manifest 前成功持久化精確 `(CID, version, digest)` receipt。receipt 寫入失敗即
  fail closed，不得只在記憶體中視為通過。
- 正式 race asset boundary 對 UGC 同時要求 ledger record、embedded manifest reference 與本機 receipt
  完全一致，才回傳 typed `AdmittedTrackAsset`。runtime 不回讀 raw extras、不重跑 Wave A/B 或幾何
  validator。
- 舊六欄 track `PhysicsFingerprint` 維持 fork 差異分類用途，不擴充為 runtime 或 admission 權威。
- 專案仍在開發期，本次直接收斂現行路徑；不提供無 receipt、legacy extras 或 fingerprint fallback，
  也不另升 asset schema，沿用已完整承載場地資料的 PhysicsManifest v7。

## 後果與影響

新 CID 的驗證成本只發生一次；後續載入是固定大小的 record／manifest reference／receipt 核對。
本機 receipt 不是共識聲明，也不能由遠端自報；刪除或損壞只會使該節點重新 admission。三層
conformance 分別鎖 finalizer 拒絕、首次 admission 重建與 runtime receipt gate，防止未來只修一層。

本決策修訂 D-20260811-02 中「通過後可寫 receipt」為「receipt 成功持久化後才算通過」，並把
D-20260811-01 的逐層執法契約具體套用至場地。
