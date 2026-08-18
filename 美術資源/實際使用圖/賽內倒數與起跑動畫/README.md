---
type: art
domain: ["前端主題"]
summary: 兩主題賽內倒數與起跑動畫原始工程
authority: null
slug: null
---

# 賽內倒數與起跑動畫原始工程

- `release-input/ui/race-countdown/default/` 與 `moon-rabbit/` 各保存三張數字透明
  ImageGen 原圖、既有 `start.png` 造型錨點、八張 `source/start/00.png`–`07.png`
  連續發射來源幀，以及正規化後逐幀 PNG。
- `animation-project.json` 是可編輯的畫布、來源模式、時序、亮度、縮放與 WebP 編碼設定；
  `start.sourceMode = "sequence"` 明確啟用多張來源幀，數字仍使用單一母圖。
- `build_animation.py` 將所有動態效果烘入 WebP 像素；runtime CSS 只負責版面。
- 上述 JSON、Python、測試與本 README 仍受 Git 版控；圖像 bytes 一律由被忽略的
  `release-input/ui/race-countdown/` 讀寫。此生成器是從 exact PNG 重建 runtime WebP
  的可重跑路徑，不可當作無用檔刪除。
- authoring timeline 的 3／2／1 各有 10 張 PNG、每格 90ms（900ms）；start 依序使用
  待發、蓄能、點火、單次爆發、外移、擴散、復位、餘光八張來源幀（720ms）。WebP
  encoder 可合併相同畫面，但保留總時長，loop metadata 固定為 1。
- static 成品取 timeline 指定的穩定幀，供 effective reduced motion 與載入失敗降級。

`release-input/ui/race-countdown/<theme>/source/start/` 必須具有與 timeline 完全相同數量的兩位數 PNG；缺幀或多幀時建置直接失敗，
不得輸出截斷動作。

先在 `open-4wd-specs` 執行 locked authoring 測試：

```powershell
pnpm authoring:animation:test
```

再從同一目錄重建至 sibling main repo：

```powershell
pnpm authoring:animation:build --runtime-themes ../open-4wd/public/assets/themes
```

Windows 也可從 `open-4wd-specs` 執行 `build-race-animation.bat`；兩個入口都只呼叫
`uv run --locked --group authoring`，不安裝未鎖定套件。docs CI 不選取 authoring group，
因此不會安裝 Pillow 或執行這組資產測試。

預設 authoring root 為 `open-4wd-specs/release-input/ui/race-countdown/`；只有從另一個已驗證
備份重建時，才以 `--authoring-root <path>` 明確覆寫。
