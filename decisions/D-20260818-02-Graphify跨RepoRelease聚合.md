---
id: D-20260818-02
date: 2026-08-18
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260725-05", "D-20260727-05", "D-20260811-17"]
domains: ["版本部署", "治理營運"]
sources: ["2026-08-18 ─ Graphify 跨 repo immutable Release 聚合（issue 000659）"]
files: ["部署資訊/Graphify Release 聚合.md", "文檔工程.md"]
vectors: []
deprecates: []
---

# D-20260818-02｜Graphify 跨 repo Release 聚合

## 背景與驅動力

specs 建站原本只探測同機 sibling Graphify HTML。只有 `graph.json` 的 repo 會靜默缺席，頁面數字也
可能是過期硬編碼；這個方式無法支援各 repo 獨立公開與建站。跨 repo 刷新又不能因任一 repo 尚未
公開而卡住，也不能讓事件 payload 變成任意下載來源。

## 考慮過的選項

- specs CI checkout 或直接讀取所有來源 repo：形成 private read 權限與版本同步耦合，否決。
- 等四個 repo 同版齊備再更新：讓獨立 repo 互相阻塞，也沒有實際語意必要，否決。
- 各 repo 發 immutable Release，specs 固定 allowlist 獨立驗證與部分成功聚合（採納）。

## 決定

- 四個產品 repo 各自以 exact source SHA 發布 `graphify-<short SHA>` immutable Release，
  `make_latest=false`；asset exact-set 為 deterministic `graphify-site.zip` 與
  `graphify-manifest.json`，manifest 綁 repo、source SHA、Graphify 版本、時間、圖統計、size 與 digest。
- specs 每次從固定四 repo allowlist 重新查詢，獨立選最新有效 Release，不對齊版本；缺少、私有、
  抓取失敗或無效皆明示狀態，不能阻斷 canon docs。dispatch payload 不參與資料來源選擇。
- App 只安裝於 specs 且只給 Contents read/write；來源 repo 只保存 App ID 與 private key 來 mint
  specs-only token。App 不安裝來源 repo，specs 不取得私有來源 read 權限。
- Release job 與通知 job 分離。通知不可用時由 specs 手動與低頻排程補償；所有 refresh 以
  concurrency 合併。
- private repo 先保持不發布；公開、安全檢查與 immutable Release 條件通過後，才以
  `GRAPHIFY_RELEASE_ENABLED=true` 個別啟用。Pages 亦以獨立 `DOCS_PAGES_ENABLED` 閘門控制。
- 本機 sibling artifact 仍是離線建站 fallback，但沒有 HTML 的 `graph.json` 必須可見；公開頁面的
  node／edge／產生時間只取已驗證 manifest 或當次本機 graph，不留硬編碼統計。

## 後果與影響

各 repo 可獨立更新，specs 在部分 repo 缺席時仍提供可驗證的知識圖與明確狀態；App compromise 的
安裝面只限 specs。代價是每個來源 repo 都要保存同一 App credential、維護 immutable Release 與
人工公開內容 gate，specs 也需保留 cache、手動與排程復原路徑。
