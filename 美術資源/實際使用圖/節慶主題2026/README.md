---
type: art
domain: ["前端主題", "比賽房間"]
summary: 萬聖節與彩鉛聖誕的主題、倒數、訊息圖庫交付與重建清單
authority: null
slug: null
---

# 節慶主題 2026

這兩套視覺沿用現有 Theme Style API v1。萬聖節採美式復古雕刻、南瓜與蝙蝠；聖誕節採彩鉛紙紋、冬青、緞帶與主次分明的角飾。主題素材與賽中訊息圖庫分開登記，不能藉切換網站主題更改玩家的九格訊息。

## 完整交付範圍

| 項目         | 萬聖節                         | 聖誕節                         |
| ------------ | ------------------------------ | ------------------------------ |
| 網站 themeId | halloween-workshop-2026-a9028c | christmas-workshop-2026-75fe9c |
| 訊息 packId  | halloween                      | christmas                      |
| 網站分類     | seasonal                       | seasonal                       |
| 主題圖檔     | 7 SVG、14 WebP                 | 7 SVG、14 WebP                 |
| 圖片槽位     | 26 個，包含動畫與靜態倒數      | 26 個，包含動畫與靜態倒數      |
| 賽中訊息     | 中央目錄 96 個語意             | 中央目錄 96 個語意             |
| 車輛渲染     | 中性 PBR                       | 中性 PBR；彩鉛效果限 UI 與插畫 |

主題各有獨立首頁、無車車庫背景、UGC 背景；其他場景依既有主題相同的用途共用。兩個主題各自提供首頁曲與比賽曲兩首 BGM（比賽以外的場景共用首頁曲）與 20 個音效（[主題音訊](../../主題音訊/README.md)）；保留遊戲訊號與路面循環音沿用預設槽位，不由主題覆寫。字型使用既有系統 fallback，不新增字型下載。Favicon 與社群 OG 圖屬全站品牌資產，不隨網站主題或訊息圖庫切換。上述數量是完整交付要求，不能以一般 validator 允許部分資產 fallback 作為已完成的證據。

## 檔案權責

- 本目錄：可版控的 Python／CJS 生成器、SVG 與 CSS 原稿、固定主題 ID、製作來源與驗證清單。
- `release-input/ui/themes/{halloween,christmas}/`：核准首頁、獨立場景、空狀態 PNG 母圖。
- `release-input/ui/race-countdown/{halloween,christmas}/frames/`：共用動畫工程正規化後的透明 PNG 影格；`source/` 保存數字母圖與起跑連續來源幀。
- `release-input/ui/race-messages/{halloween,christmas}/`：每個 messageKey 一張無字透明 PNG。
- main 的 `public/assets/themes/<themeId>/`：正式 theme.json、theme.css 與 21 個圖檔。
- main 的 `public/assets/race-message-packs/<packId>/`：正式 manifest 與 96 張 WebP；`builtin-packs.ts`、四語名稱及 generator/checker 同批更新。

原始 PNG 由既有 authoring-images.zip 收錄。SVG、CSS、JSON、CJS 與測試 build 不應放在 Release 投遞樹內。`authoring-source-manifest.json` 是 GLB exact-set 權威，這次只新增 UI 圖像，不在其中加入偽造 GLB 項目，也不改既有 Release tag 或 dependency lock。尚未獲授權發布任何 Release。

## 重建

以下命令從 workspace 根目錄執行，使用已安裝的 Node、Playwright／Chromium、Pillow 與 Prettier，不會安裝套件。CJS 使用 Playwright 預設瀏覽器；可用 `CHROMIUM_EXECUTABLE` 指定既有 Chromium 執行檔。

```powershell
python open-4wd-specs/美術資源/實際使用圖/節慶主題2026/build.py
python open-4wd-specs/美術資源/實際使用圖/節慶主題2026/audit-assets.py
python open-4wd-specs/美術資源/實際使用圖/節慶主題2026/audit-message-sources.py
```

在 main repo 執行：

```powershell
node scripts/generate-race-message-packs.mjs --pack=halloween --complete
node scripts/generate-race-message-packs.mjs --pack=christmas --complete
node scripts/check-race-message-packs.mjs --complete
node scripts/generate-theme-registry.mjs
node scripts/themes-validate.mjs
```

`--pack` 限制輸出至指定圖庫，避免重編碼原有兩套圖。完整 gate 同時檢查 96 個精確語意鍵、256×256、alpha、64 KiB、digest 與檔案數；只比對數量不足以證明完整。

## 驗收邊界

主題資產檢查與 race-message pack 檢查分開執行。另需測試四套圖庫的精確 identity lookup、篡改 digest 拒絕、設定頁選用與四語名稱。PNG 母圖與 64px 縮圖需目視確認沒有文字、錯誤語意與裁切。完整性腳本不能代替視覺審查。

瀏覽器檢查使用 `verify-browser.cjs`；`SEASONAL_BROWSER_DIST` 指向實際 app browser build，`SEASONAL_VALIDATION_DIR` 可指定截圖及報告位置。測試不連外、不代表已驗證完整連線比賽或全部 CI。

前次程式整合驗證（本次圖像換版須另重驗）：四套圖庫共 384 張 WebP 通過完整 gate；新增 192 張 PNG 原稿通過精確語意、透明度與唯一雜湊檢查。設定頁與訊息圖庫 48 個測試、TypeScript 檢查及 development browser build 通過。瀏覽器完成 104 組頁面與尺寸組合檢查及 234 個圖檔載入，無破圖或橫向溢出，並確認訊息包可選用且不被網站主題切換覆寫。原稿提示詞與 SHA-256 分別保存在 `race-message-provenance.json` 及 `records/race-message-sources.json`。

完整 `pnpm check` 未完成：本機 Corepack 無法取得指定 pnpm，未安裝或連外補依賴；已改用既有工具完成文件 frontmatter、連結、生成文件、相關測試與修改文件的 Markdown 檢查。Main Graphify 仍需重建，既有 README 語意快取缺漏阻擋離線 finalizer；不把此項視為通過。Specs 未啟用 Graphify，其 `docs-map.md` 與 `graph.json` 已由文件生成器更新。

## 版控與保存評估

本目錄適合作為小型 authoring 工程進 Git，不應整包當成臨時檔捨棄。正式 PNG 母圖與逐幀圖則由 immutable Authoring Release 保存；只有提示詞不足以重建相同像素，必須同時保留 exact PNG 和雜湊。Runtime WebP／SVG 隨 main repo 版控。這是管理建議，不表示已執行 git add、commit、push 或發布 Release。

| 資料 | 管理方式 |
| --- | --- |
| `build.py`、`build-countdown.py`、`audit-*.py`、`themes.json` | specs Git；重建及驗證必要入口 |
| 目前使用的 `sources/` CSS 與 SVG | specs Git；可編輯向量與主題樣式 |
| `*-provenance.json`、`previous-prompts.json` | specs Git；來源、實際提示詞，僅使用 repo 相對路徑 |
| `records/*-build-manifest.json`、`records/*-sources.json` | specs Git；產出與 exact source 的 digest 對照，不保存執行機器路徑 |
| `audit-assets.py`、`records/asset-parity.json` | specs Git；完整槽位對照和尺寸／時序證據 |
| `verify-browser.cjs`、`review-message-sources.cjs` | specs Git；可重跑的測試工具，截圖與 build 不入 Git |
| `release-input/` 下 PNG 母圖、連續來源幀及正規化影格 | Git ignore；隨 authoring-images.zip 封裝並保留備份 |
| 本機截圖、測試 build、舊完整工作備份 | 本機視覺工作區或既有忽略目錄，不列入正式工程 |

### 過時與衍生檔案

`sources/{halloween,christmas}/race-countdown/*.svg`、`sources/*/empty-*.svg` 與 `render-empty.cjs` 已於 2026-10-24 依人工授權刪除；`build.py` 也不再讀取其 `empty-garage-source.png`。`render-countdown.cjs` 已變成呼叫共用 PNG 動畫工程的入口，沒有第二套 SVG 動畫演算法。

`build.py` 已停止寫出舊空狀態 SVG；舊 SVG 與 `render-empty.cjs` 已刪除，不再提供舊圖稿生成入口。`previous-README.md` 保留為設計來源說明。生成的 core-loop 與 panel SVG 保留作可檢視快照，權威分別為 `build.py` 與 pencil 原稿，請勿直接修改生成快照。

共用倒數規格與原有兩套主題一致：數字 900ms，起跑八張連續來源幀共 720ms，loop=1；靜態圖由共用 timeline 指定。聖誕節空車庫來源固定為 `release-input/ui/themes/christmas/empty-garage-illustration.png`。

## 本次圖像修訂與完整性審查

空狀態圖已按原有兩套主題重新對齊：`empty-connection` 為斷開的機械連接器、`empty-garage` 為迷你四驅車、`empty-generic` 為空展示座。先前角色與升降台構圖已被取代。萬聖節採美式復古南瓜、蝙蝠與黃銅；聖誕節採紅綠象牙白彩鉛筆觸、冬青與鈴鐺。萬聖節車圖沿用現有 `assets/harvest-engraving.webp` 路徑，標題另用 `brand-emblem.svg`。

兩套 3／2／1 改用各自風格的完整插畫，起跑改成無文字號角與八張連續 AI 編輯來源幀。來源製作紀錄見 `countdown-provenance.json`、`empty-state-provenance.json`；`garage-provenance.json` 僅保留已取代的歷史紀錄。30 張來源 PNG 的尺寸與 SHA-256 見 `records/countdown-garage-sources.json`。

依原有兩套主題逐項檢查 26 個視覺槽位，以及首頁、工坊、UGC、空狀態、品牌、按鈕、面板與 core-loop 圖示。其餘圖檔已有主題化；core-loop 保留向量圖示，並以原主題的齒輪、儀表與旗幟為共同符號，沿用原始描邊比例，只加小型節慶裝飾。先前車體方框、滑桿與較細描邊已修正。不同頁面共用背景是現有主題槽位配置，並非缺圖。race-message packs 是獨立圖庫，沿用前次完成的兩套各 96 張產物。

前次重新驗證：兩套各 26 視覺槽位、21 圖檔及產出雜湊一致；四套主題正式驗證器零警告，註冊表一致；共用動畫單元測試 4 項通過，四套 race-message packs 共 384 張通過完整檢查。
前次瀏覽器使用前次已通過的 app build，直接載入最新 public 主題資產：104 組頁面與尺寸組合檢查、234 次資產載入，無失敗、破圖或橫向溢出；未重建 app 程式碼。

## 目錄整理清單

`records/retention-plan.json` 的 `keep` 列出 42 個保留檔案，`removed` 保存已授權刪除的 15 個確切路徑，`remove` 已清空。本輪未搬移、提交或推送。範圍不包含 Release PNG 原稿、main 正式成品或本機備份。

### 保留檔案

下列路徑皆相對本目錄。SVG 快照可由生成器重建，保留目的為人工檢視；它們不是輸入權威。

- `README.md`
- `audit-assets.py`
- `audit-message-sources.py`
- `build-countdown.py`
- `build.py`
- `countdown-provenance.json`
- `empty-state-provenance.json`
- `format-ignore`
- `garage-provenance.json`
- `previous-README.md`
- `previous-prompts.json`
- `race-message-provenance.json`
- `records/asset-parity.json`
- `records/christmas-build-manifest.json`
- `records/countdown-garage-sources.json`
- `records/halloween-build-manifest.json`
- `records/race-message-sources.json`
- `render-countdown.cjs`
- `review-message-sources.cjs`
- `sources/christmas/christmas-gift.svg`
- `sources/christmas/christmas-holly.svg`
- `sources/christmas/core-loop-assembly.svg`
- `sources/christmas/core-loop-race.svg`
- `sources/christmas/core-loop-tuning.svg`
- `sources/christmas/panel-surface.svg`
- `sources/christmas/pencil-grain.svg`
- `sources/christmas/pencil-outline.svg`
- `sources/christmas/pencil-star.svg`
- `sources/christmas/theme.css`
- `sources/halloween/bat.svg`
- `sources/halloween/core-loop-assembly.svg`
- `sources/halloween/core-loop-race.svg`
- `sources/halloween/core-loop-tuning.svg`
- `sources/halloween/hanging-bats.svg`
- `sources/halloween/panel-surface.svg`
- `sources/halloween/pumpkin.svg`
- `sources/halloween/theme.css`
- `supplement-provenance.json`
- `themes.json`
- `verify-browser.cjs`
- `records/retention-plan.json`
- `records/rebuild-without-legacy.json`

### 已授權刪除檔案

以下 15 個檔案已刪除，只移除舊線條稿與已停用入口；目前 PNG 原稿及正式圖像保留。空目錄未列入刪除授權，仍保留。

- `render-empty.cjs`
- `sources/christmas/empty-connection.svg`
- `sources/christmas/empty-garage.svg`
- `sources/christmas/empty-generic.svg`
- `sources/christmas/race-countdown/1.svg`
- `sources/christmas/race-countdown/2.svg`
- `sources/christmas/race-countdown/3.svg`
- `sources/christmas/race-countdown/start.svg`
- `sources/halloween/empty-connection.svg`
- `sources/halloween/empty-garage.svg`
- `sources/halloween/empty-generic.svg`
- `sources/halloween/race-countdown/1.svg`
- `sources/halloween/race-countdown/2.svg`
- `sources/halloween/race-countdown/3.svg`
- `sources/halloween/race-countdown/start.svg`

### 有效重建依賴

- `build.py` → `build-countdown.py` → 共用 `賽內倒數與起跑動畫/build_animation.py` 與 `animation-project.json` → `release-input/ui/race-countdown/{theme}/source/` 的數字 PNG、起跑連續 PNG → 正規化影格與 WebP。
- 空狀態只讀 `release-input/ui/themes/{theme}/empty-*-illustration.png`；缺少新 PNG 會失敗，不回退至舊 SVG 或 `empty-*-source.png`。
- 面板與裝飾讀有效 SVG／CSS；core-loop 圖示由 `build.py` 生成；首頁、工坊與 UGC 讀原有核准 PNG。
- `render-countdown.cjs` 仍是共用倒數生成器的快捷入口；`render-empty.cjs` 已刪除。

清理驗證會以 Python audit hook 阻擋對上述 15 個目標的任何開檔，並阻擋舊 `empty-*-source.png`，再執行完整 `build.py`；成功後比較兩套 runtime 逐檔 SHA-256，要求與清理前完全一致。結果保存於 `records/rebuild-without-legacy.json`，不是僅以搜尋未找到字串作為證據。

刪除前驗證：禁止存取舊稿期間，完整重建成功，兩套主題共 46 個 runtime 檔案的 SHA-256 全數維持不變。刪除後完整重建亦通過：15 個舊檔案在重建前後均不存在，46 個 runtime 檔案的 SHA-256 與刪除前完全相同；現存 42 個檔案與 `keep` 清單精確一致。正式主題驗證器四套全數通過、零警告，註冊表一致。

本輪比對除六張空狀態外，也檢視首頁、工坊、UGC、品牌、入口、按鈕、面板、core-loop 及倒數；UGC 紙面構圖與彩鉛首頁是原核准風格，保留其空間與主次，未改成原主題的寫實場景。
本輪空狀態與 core-loop 換版驗證：完整 build.py 成功，兩套各 26 視覺槽位及 21 圖檔通過 audit；四套主題驗證零警告、registry 一致；瀏覽器 104 組頁面與尺寸組合及 234 次圖片載入無破圖或溢出。192 張節慶訊息圖以 136px／64px 縮圖檢視，四套訊息包共 384 張通過完整 gate。保留目錄仍為 42 個檔案，已刪舊稿未重生，30 張來源雜湊一致；main Graphify 為 fresh。
