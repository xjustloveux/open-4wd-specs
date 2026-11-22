---
type: deploy
domain: ["版本部署"]
summary: 四個產品 repo 的不可變 Graphify Release、specs 部分成功聚合與 GitHub App 喚醒 runbook
authority: null
slug: null
---

# Graphify Release 聚合

> **本檔角色**：定義 `open-4wd`、`open-4wd-pinning`、`open-4wd-signaling`、
> `open-4wd-turn` 如何各自發布 Graphify 衍生成品，以及 `open-4wd-specs` 如何在不取得私有
> repo 權限的前提下聚合知識圖。Graphify 是導覽與檢索層，原始碼與 canon 文檔仍是權威。

## 1. 發布與聚合契約

四個產品 repo 在各自的 upstream CI 成功後，才由 `graphify-release.yml` 對該次 exact source SHA
執行 Graphify 0.9.25。CI 只重播 repo 已提交的 semantic cache：backend 固定為不可連線的 loopback
Ollama 位址，輸出只要出現任一 cache miss 就立即失敗，不使用模型 API key，也不把文件／概念節點
降級成 code-only graph。Release tag 固定為 `graphify-<source SHA 前 12 碼>`，不設為 Latest，且只含：

- `graphify-site.zip`：deterministic store-only ZIP，exactly 包含完整 `graph.json`、互動 `index.html`、
  可由 `file://` 直接載入的 compact `viewer-data.js` 與自架 `vis-network.min.js`；頁面不需 CDN 或
  執行期 `fetch`。
- `graphify-manifest.json`：記錄 repo、完整 source SHA、exact tag、Graphify 版本、canonical 產生時間、
  node／edge 數、viewer mode／threshold／engine，以及 ZIP size 與 SHA-256。

Pre-launch 的 Graphify Release manifest 固定使用 `schemaVersion=1`；新增 viewer metadata 直接形成
完整的 current v1 shape，不為尚未正式發布的中間格式製造 v2。

viewer mode 不按 repo 名稱硬編，而由完整圖的 node 數決定：`<= 5000` 為 `full`，在同一互動圖
呈現全部節點與邊；`> 5000` 為 `community-drill`，先呈現 community overview，選取 community 後在
同頁進入其完整子圖並可返回。現行資料規模因此是 Main 使用 drill，Pinning、Signaling、TURN 使用
full；日後規模跨過門檻會自動切換。

發布前會拒絕不在固定四 repo allowlist 的名稱、非相對 source path、`.git`／`.env`／
`graphify-out` 路徑、常見本機 home path、私鑰或 GitHub token 形狀的內容。Release repository 必須已
開啟 immutable releases；同一 exact tag 已存在時不覆寫。正式啟用前仍須人工檢查圖中的檔名、
節點文字與查詢結果，靜態掃描不是內容審查的替代品。

specs 的 `refresh-graphify-releases.mjs` 永遠重新查詢固定 allowlist，不信任 dispatch payload 提供的
repo、tag 或 URL。每個 repo 獨立挑選最新且完整通過 manifest、asset exact-set、size、digest 與 ZIP
member 驗證的 `graphify-*` Release；不要求四個 repo 彼此或與 specs 對齊版本。有效者照常顯示，
其他 repo 明示為 `missing`、`private`、`fetch-failed` 或 `invalid`，不阻斷 canon docs 建置。

Release 解開至未追蹤的 `.graphify-releases/run-*/<repo>/`；每次 refresh 使用新目錄，不覆寫舊
cache。沒有遠端成品時，本機建站仍可讀 sibling `graphify-out`；只有 `graph.json` 而沒有 Graphify
HTML 的 repo 也會由同一 adaptive generator 產生 `index.html`、`viewer-data.js` 並複製自架
`vis-network.min.js`，不再靜默消失或退化為前 200 筆節點清單。

正式 viewer 使用與 Graphify 原生頁相同的 vis-network 9.1.6 引擎、配色與 forceAtlas2Based 物理
佈局，但將函式庫納入 immutable ZIP／本機站台，不載入任何外部資源
（[資安規範.md §5](../資安規範.md)）。沒有 `graph.json` 時才使用 Graphify 原生 HTML hardening；
原生 HTML 若含未知外部引用仍會讓建置失敗，不靜默放行。

## 2. GitHub App 最小權限設定

GitHub App 只用來在來源 Release 成功後喚醒 specs；它不讀來源 repo，也不攜帶圖譜資料。

1. 在維護者帳號的 Developer settings 建立 GitHub App。名稱須全 GitHub 唯一；Homepage URL 可填
   專案公開首頁。Webhook 關閉，不設定 callback URL，不啟用 OAuth。
2. Repository permissions 只給 **Contents: Read and write**，其餘保持 No access。這個 write 權限只
   是 GitHub `repository_dispatch` API 的要求，不代表 App 可修改工作樹。
3. 安裝 App 時選 **Only select repositories**，只勾 `open-4wd-specs`。不得安裝到四個來源 repo，
   也不得用 All repositories；因此 App token 無法替 specs 取得任何私有來源內容。
4. 從 App 的 General 設定複製 Client ID，再產生 private key。四個來源 repo 各設定
   Actions variable `OPEN4WD_GRAPH_APP_CLIENT_ID`，並把 PEM 全文存為 Actions secret
   `OPEN4WD_GRAPH_APP_PRIVATE_KEY`。若使用帳號／組織層 secret，repository access 必須只限固定
   四個來源 repo。Client ID 不是數字 App ID，也不是 Client Secret；specs 不保存 Client ID 或
   private key。
5. 在來源 repo 手動跑一次 Graphify Release 後，確認 `notify-specs` mint 的 token 只列出 specs
   installation，且 specs 收到 `graphify-release-published` dispatch。dispatch payload 只是喚醒提示；
   refresh 仍從 allowlist 重新取得 Release。

App 未設定或 token mint／dispatch 失敗時，Release 本身仍成功，通知 job 只留下明確訊息。specs 可
由 `workflow_dispatch` 立即補跑，也會在每週一 04:17 UTC 低頻刷新；同一時間只保留一個 refresh。

## 3. 公開與 Pages 啟用順序

來源 repo 還是 private 時，不給 specs 或 App read 權限，也不發布 Graphify Release。每個 repo 獨立
完成以下檢查後，才設定 repository variable `GRAPHIFY_RELEASE_ENABLED=true`：

1. repo 已公開，upstream CI 全綠，且 GitHub immutable releases 已開啟。
2. 本機 `check-graphify.ps1` 顯示 fresh，query／path／explain 能回答預期的內部關係。
3. 以相同 prepare script 對 `graphify-out/graph.json` 預演，人工檢查 manifest、source paths、
   adaptive mode、搜尋／縮放／選取／drill 行為與關鍵字，確認沒有個資、內部基礎設施、憑證、
   尷尬註記或其他不應公開內容。
4. 手動執行 Graphify Release workflow，下載兩個 assets 回讀 digest、exact SHA 與頁面內容，再確認
   specs refresh 對該 repo 顯示 `available`。

四個 repo 不必同時啟用；尚未公開的項目保持狀態列，不拖延已公開 repo。specs 的
`DOCS_PAGES_ENABLED=true` 只在 Pages origin 與環境設定完成後才打開；未開啟時 refresh 仍會建置
並驗證站點，但不部署 Pages。

## 4. 金鑰輪替、撤銷與故障復原

- 定期輪替：先在 App 產生新 private key，更新固定四 repo 可見的 Actions secret，逐 repo 手動驗證
  notification，再撤銷舊 key。Client ID 不變。
- 疑似外洩：立即撤銷涉事 key，停用或刪除來源 secret，檢查 App installation 與 audit log；必要時
  suspend／uninstall App。Release refresh 可繼續靠 specs 手動／排程執行。
- App 權限或安裝範圍誤設：先收回多餘 repo access，再輪替 key。不得用擴大來源 read 權限來解決
  `private` 狀態；該狀態會在 repo 公開並有有效 Release 後自然消失。
- Release 不合法：因 immutable asset 不可覆寫，修正來源或工具後以新 source commit 產生新 tag；
  specs 會跳過 invalid Release，繼續嘗試較舊的有效版本並保留錯誤摘要。
- refresh 失敗：先看 `.graphify-releases/status.json` 區分 API、缺 Release、manifest 或 digest 問題；
  修正後手動 dispatch。不可直接編輯 cache 冒充有效來源。
