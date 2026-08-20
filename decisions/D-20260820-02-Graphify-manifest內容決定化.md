---
id: D-20260820-02
date: 2026-08-20
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260725-05", "D-20260818-02"]
domains: ["治理營運"]
sources: ["2026-08-20 ─ Graphify manifest 內容決定化（issue 000724）"]
files: ["文檔工程.md"]
vectors: []
deprecates: []
---

# D-20260820-02｜Graphify manifest 內容決定化

## 背景與驅動力

四個程式 repo 刻意追蹤 `graphify-out/manifest.json`，但 Graphify 0.9.25 寫入的 `mtime`、物件
插入順序與平台換行會因 clone 位置、檔案系統及執行環境而變動。這些差異不是來源內容或知識圖
語意的變更，卻會造成跨機器噪音 diff，也讓 freshness 把時間戳誤當成跨 repo 契約。

## 考慮過的選項

- 停止追蹤 manifest：會失去 clone 後可離線判斷來源覆蓋與內容 freshness 的 metadata，否決。
- 保留 `mtime` 並容忍差異：仍會產生機器相依 diff，無法形成穩定成品，否決。
- 保留追蹤 manifest，改以內容 MD5 判 freshness，並由成功 finalizer 決定性正規化（採納）。

## 決定

- 四個程式 repo 繼續追蹤 `graphify-out/manifest.json`；它是可重建的檢索 metadata，不是 canon
  權威，也不取代來源檔或 Specs。
- 每列最終只保留 `ast_hash` 與 `semantic_hash`；path 依 ordinal 排序，row key 固定為
  `ast_hash`、`semantic_hash`，輸出使用 UTF-8 無 BOM、LF、兩空格縮排與單一檔尾換行。
- freshness 不再讀取 `mtime`。Git repo 只對 Git 變更候選計算來源 bytes 的 MD5；非 Git repo
  對 manifest 覆蓋的候選全部計算。缺檔、新檔、hash 缺失或格式錯誤、manifest 結構錯誤均
  fail closed。
- 非決定性但結構有效的 manifest 視為 stale，由正常 finalizer 做一次正規化；PowerShell
  freshness checker 不直接改檔。
- adapter 只能在 Graphify 操作成功且 graph health 有效後正規化 manifest。失敗路徑不得執行
  最終正規化；semantic cache、`.graphify_labels.json` 與其他生成物的格式及追蹤邊界不變。

## 後果與影響

不同機器對相同來源會得到穩定 manifest bytes，clone 後的 timestamp 差異不再造成 stale；實際
內容變更仍由 hash 精準偵測。既有四個 manifest 需各經一次正常 finalizer 遷移，之後重跑應為
no-op。Graphify 內部若仍暫時使用 `mtime` 作快速路徑，只能存在於成功正規化前的執行階段，不能
成為被追蹤的最終契約。
