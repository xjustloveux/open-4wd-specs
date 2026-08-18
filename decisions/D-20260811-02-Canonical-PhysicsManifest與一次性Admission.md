---
id: D-20260811-02
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260528-02", "D-20260804-02", "D-20260811-01"]
domains: ["建模物理", "UGC版權", "共識帳本", "資安"]
sources: ["2026-08-11 ─ Canonical PhysicsManifest 與一次性 Admission receipt（issue 000329）"]
files: ["UGC機制.md", "流程/UGC上傳.md", "程式架構/editor.md", "程式架構/ledger.md", "程式架構/physics-engine.md", "版本規範.md", "資安規範.md"]
vectors: []
deprecates: []
---

# D-20260811-02｜Canonical PhysicsManifest 與一次性 Admission receipt

## 背景與驅動力

上傳收件會從 GLB 幾何重算 `PhysicsFingerprint`，正式比賽卻直接讀 root extras 的
`auto_*` 與作者欄位。兩條路徑沒有共同權威；攻擊者可讓幾何、宣告指紋與 runtime extras
分裂。CID 只能保證 bytes 不變，不能保證同一組 bytes 裡各表示彼此一致。

## 考慮過的選項

- 只信上鏈時已算好的 fingerprint，之後比對字串：不能證明同一 GLB 內 raw extras、幾何與
  fingerprint 一致，且遠端可自報 verified 狀態，棄。
- 每次賽前都由完整 GLB 重跑 Wave A/B：一致性最直接，但把重解析與驗證成本放進高頻載入，
  也讓 race runtime 持續接觸不可信 extras，棄。
- 首次 CID admission 獨立重建完整 manifest，成功後保存本機 receipt；runtime 只收 typed
  admitted asset（採納）。

## 決定

- 建立版本化 Canonical `PhysicsManifest`。finalizer 從實際幾何、材質、合法 empty 與已驗證
  作者宣告產生完整 manifest，嵌入 canonical GLB，並寫入 manifest version 與 canonical JSON
  SHA-256 digest。
- `UgcUploadEvent`／UGC record 不複製 manifest，只保存 CID 與 manifest version/digest 參照；
  ledger 收件對新 CID 獨立重建 manifest，一致才接納，內容不可得則 defer，任何不一致 fail
  closed。
- 通過後可寫本機 `(CID, version, digest)` receipt。receipt 只避免重算，不進 ledger、不成為
  遠端可宣告的 verified flag，也不改變共識狀態。
- race asset boundary 只回 `AdmittedAsset`，world builder 只消費 typed manifest。runtime 禁止
  直接讀 raw extras、禁止跑 Wave A/B、禁止以缺欄 fallback 或猜測。
- mount 採語意白名單：chassis 只接受固定 18 個 mount 且恰有一個 `Mount_Weapon`；其他零件
  只接受該型別合法接點。多臂武器是 weapon 內部 actuator/Pivot/projectile 拓撲，不增加底盤
  插槽；不得把廣泛 `auto_empties` 複製成能力。
- 專案尚未發布，直接將 asset schema 升為 `open4wd_version=2`，manifest format 自 v1 起，並
  重烘全部 builtin；不提供 legacy extras fallback、雙讀或 migration。

### 三種指紋／摘要的分工

- `meshFingerprint`：反複製搜尋與完整 GLB 重算後的相似度判定。
- `PhysicsFingerprint`：fork 差異分類。
- `physicsManifestDigest`：正式 runtime 全部物理輸入的完整性與身分。

三者不得互相代替。

## 後果與影響

幾何重算只發生在 finalization 與新 CID 首次 admission，沿用最多兩筆並行的有界下載通道，
manifest reconstruction 在有超時的隔離 Worker 執行；後續以持久 receipt 命中。最大出貨零件、
最大出貨場地、27 資產批次 admission 與 receipt hit 需有 benchmark。這使
builtin 與 UGC 共用同一權威，也為後續 entity、接觸材質、熱、磨耗、能量與天候欄位提供一次
協調升版的唯一 schema 邊界。

本決策修訂 D-20260528-02 的 extras runtime 權威、D-20260804-02 的 physics fingerprint 收件
流程，以及 D-20260811-01 的逐層規則契約；其餘決策仍維持有效。
