---
id: D-20260815-01
date: 2026-08-15
status: superseded
supersedes: []
superseded_by: D-20260818-01
amends: ["D-20260712-02", "D-20260811-17", "D-20260814-22"]
domains: ["版本部署", "治理營運"]
sources: ["2026-08-15 ─ Authoring 原始 GLB 不可變 Release（issue 000519）"]
files: ["程式架構/builtin-assets.md", "程式架構/testing.md", "程式架構/toolchain.md", "專案生命週期.md"]
vectors: []
deprecates: []
---

# D-20260815-01｜Authoring 原始 GLB 不可變 Release

## 背景與驅動力

27 個 Editor authoring 原始 GLB 約 1.658 GB。它們不能由消毒、減面、烘焙後的 shipped
canonical GLB 取代，也不應讓一般 docs／main checkout 下載全部 bytes；原先 main manifest
同時保存來源 hash、Editor recipe 與成品 provenance，又缺少 CI 可取得的不可變來源。

## 考慮過的選項

- 將原始 GLB 當一般 Git blob：永久膨脹 clone 與歷史，否決。
- 只掛載維護者工作站 sibling：不可重現且不能形成 CI／Release 證據，否決。
- specs Git LFS 保存分類原檔、specs Release 分發、main 鎖定採用（採納）。

## 決定

- specs `美術資源/參考雛形` 是原始 bytes owner；最小 source manifest 只含
  `schemaVersion=1`、`candidateEpoch`、`assetId`、`logicalPath`、flat `releaseAsset`、SHA-256
  與 size。Editor 參數、說明與 canonical output provenance 不得進入此 manifest。
- main 的 authoring manifest 只保存 Editor recipe/output，以 `sourceAssetId` exact-set join specs；
  不再複製 source root、path、hash 或 size。pre-launch 不保留舊混合 manifest reader。
- PR checkout 明示 `lfs:false`，從工作樹 LFS pointer 驗 oid/size 與 manifest exact-set；實體 bytes
  checkout 亦重算 SHA/size。payload fingerprint 對 schema 與完整排序 records 計算，add、delete、
  rename、mapping 與 schema change 都會改變；payload 有變時 `candidateEpoch` 必須恰加一，無變不得空增。
- protected default branch 的 post-merge job 只 selective pull manifest 所列 LFS objects，驗證後建立
  `authoring-source-prepub-rcN-<fingerprint-prefix>` tag 與 Draft Release；既有 tag/draft 只有 desired
  state 完全相同才可續跑。下載回讀 exact-set 與每檔 digest 全通過後才自動 publish。Repository
  必須先啟用 immutable releases；發布後 tag 與 assets 不可改。
- main 的 dependency lock 綁 exact specs commit、Release tag、manifest fingerprint 與原始 manifest
  SHA-256；下載 individual Release assets 後做 specs／lock／Release 三方驗證，再跑 production Editor
  import、sanitize、縮放、減面、掛點、組車與賽事 journey。Release 存在不表示 main 已採用。
- specs public 前 main 只使用本機 sibling 驗證，不加入暫時 PAT／GitHub App。specs public 且取得
  immutable commit/Release 後，才把既有 adoption template 啟用為 main workflow。
- 一般 docs／PR checkout 永不拉 LFS bytes；Release job 才拉 27 檔，main 從 Release 下載而非 LFS。
  GitHub LFS storage 與每月 bandwidth 分別監控，spending budget 保持 0；source archive 不包含 LFS objects。

## 後果與影響

原始 bytes、Editor recipe 與 shipped output 各有唯一 owner；CI 能重現完整 authoring 流程，同時日常
文檔與 main checkout 不承擔 1.658 GB 下載。代價是 specs 每次 source payload 變更必須維護候選 epoch、
LFS 額度與 immutable Release，main 採用也必須更新四欄 lock 並重跑完整 journey。
