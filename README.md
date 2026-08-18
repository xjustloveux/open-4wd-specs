---
type: index
domain: []
summary: repo 門面與閱讀指引
authority: null
slug: null
---
# Open4WD Specs

> **開發狀態**：Open4WD 仍在開發中，主遊戲尚未正式公開。目前
> [`runtime_phase = pre_launch`](專案生命週期.md)；本 corpus 是現行設計 canon，但首次
> `live` 前仍可能發生不相容重構。

Open4WD 的設計規格（spec）corpus——開源四驅車（mini 4WD 風格）UGC 競速遊戲：IPFS 內容尋址 ＋OrbitDB 事件帳本 ＋libp2p P2P＋ 確定性物理（Rapier）＋Angular PWA。

- **入口**：[總覽.md](總覽.md)——專案定位 ＋ 全部檔案索引
- **生命週期**：[專案生命週期.md](專案生命週期.md)——目前階段、candidate gate、首次公開發布鏈與上線後復原規則
- **歷史**：[歷史記錄.md](歷史記錄.md)——所有 spec 變更與定案理由集中收納（其他檔只寫現況）
- **規格資料夾**：`流程/`（跨模組流程）・`程式架構/`（實作層）・`美術資源/`（設計與參考件）・`部署資訊/`（週邊 repo）
- **稽核資料夾**：`decisions/`（ADR）・`conformance/`（跨語言測試向量）・`歷史記錄/`（每日流水帳）

## 貢獻

文檔工程紀律（單一權威、現況-歷史分離、機器執法、貢獻流程）集中於 [文檔工程.md](文檔工程.md)——本 repo 同時是一個可複用的開源文檔工程範例。常用要點：

- 規範性規則可用九域 ID：`LEDGER`、`ECON`、`MOD`、`PHYS`、`TRACK`、`PART`、
  `UGC`、`VERSION`、`SEC`。先在業務域 canon 掛唯一主錨，再於 `rule-contracts.json`
  完整宣告 `kind`、`requiredLayers`、唯一 `implementationRepos` 與逐層 `testContracts`；
  canon anchor 與 contract 必須是 exact set，`rules.json` 只是生成物。
- Owner repo 的 `*.conformance.spec.ts` 必須匯入 helper，以 literal `ruleConformance`
  同時綁定 rule ID、layer 與 contract；一般註解不算證據。完整程序見
  [文檔工程.md §5.1](文檔工程.md)。
- 提交前執行 `pnpm check`；CI 依相同聚合順序逐項執行，完整清單以 `package.json` 的 `scripts.check` 為準。

## 本機文檔站

MkDocs 工具鏈由 repo 內的 `pyproject.toml` 與 `uv.lock` 鎖定，不依賴使用者層全域
MkDocs。Node 入口在未設定 `UV_CACHE_DIR` 時，會使用 repo 上一層的 `.uv-cache/`，避免
Codex 等受限環境誤讀使用者層 cache；仍可用環境變數明確覆寫。先安裝 Python 3.12、uv
與 Node 依賴，再執行：

- `pnpm docs:bootstrap`：在可連線階段依 `uv.lock` 建立／更新 `.venv` 並暖化 cache。
- `pnpm docs:build`：依 lock 驗證／建立 `.venv` 後建置；缺少 Python 時不會自動下載。
- `pnpm docs:build:offline`：禁止網路解析，只使用本機既有 uv cache；cache 不完整時明確失敗。
- `pnpm docs:verify:offline`：不做同步，直接以既有 `.venv` 離線驗證建站；若缺少環境，會提示先執行 bootstrap。CI 會先 bootstrap，再執行包含此契約的 `pnpm test:docs`。

`.venv/`、`.site-src/`、`site/` 與 `mkdocs.build.yml` 都是可重建衍生物，不提交 Git。
建置只會附帶已上站 Markdown 實際引用的受控圖片／文件／影音；引用缺檔或越出 repo
邊界時會直接失敗，不會整包發布美術資源。需要在站內開啟的 repo 管理原始檔另由
`scripts/site-source-files.json` 逐檔列出來源與公開路徑；禁止 glob 或依副檔名泛收，且只在
`.site-src/` 副本改寫連結，因此原始 Markdown 的 GitHub repo 連結仍保持有效。
Markdown 來源檔名同樣保持穩定；目前只有生成式 `decisions/INDEX.md` 透過
`MARKDOWN_STAGE_ALIASES` 在建置副本映射為 `decisions/decision-index.md`，避免它與
`decisions/README.md` 在 Windows／MkDocs 同時輸出成 `decisions/index.html`。新增映射時必須
使用 repo 相對的 exact source／staged path，不能直接改寫來源文件或用 basename 猜測。

全文以繁體中文撰寫。License：[MIT](LICENSE)。
