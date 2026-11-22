---
id: D-20260811-13
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260723-01", "D-20260809-09"]
domains: ["前端主題"]
sources: ["2026-08-11 ─ 主題字型採 manifest 窄契約（issue 000339）"]
files: ["主題系統.md", "程式參數.md", "程式架構/themes.md"]
vectors: []
deprecates: []
---

# D-20260811-13｜結構化主題字型與 Runtime Namespace

## 背景與驅動力

Style API v1 為安全起見禁止作者在 `theme.css` 寫 `@font-face`，使主題只能切換系統或應用既有
font stack。字體是節慶、書法與科技風格的重要識別，但直接開放原始 at-rule 會同時開放 family
命名、來源列表與更多 descriptor，難以維持主題間隔離、授權與載入預算。

## 考慮過的選項

- 維持完全禁止自帶字型：安全簡單，但主題表現力缺口持續存在，棄。
- 直接把 `@font-face` 加入 Style API 白名單：作者自由度高，但命名碰撞、來源、descriptor、授權與
  fallback 都難以機械守門，棄。
- 由 manifest 開受控語意角色、runtime 產生 face（採納）。

## 決定

- `theme.json` 可選 `fonts`，只開 `base`、`mono`、`display` 三個唯一角色；每個 face 精確宣告同
  主題 `.woff2` src、1–1000 整數或 range weight、`normal | italic` style 與同主題 OFL 1.1
  license。raw `theme.css @font-face` 維持禁止。
- 單主題最多 4 個 WOFF2，壓縮 bytes 合計最多 524288（512 KiB），並繼續計入 20 MB 總預算；
  collection、重複 src、重疊 descriptor、`local()`、外部／data／絕對／跨主題 URL 與任意進階
  descriptor 一律拒絕。
- runtime 以 theme id＋role 產生不可由作者指定的全域唯一 family，固定 `font-display: swap`，將
  base／mono／display 映射到既有字型 token 與私有 `--theme-font-*`。Default face 只放 Default
  stylesheet node，非 Default face 隨 active candidate 原子切換。
- 自帶 family 永遠接既有 locale-aware stack；display 未供應時回 base。主題提交不等待字型下載，
  因此首次啟用允許受控 FOUT；404、壞檔或缺 glyph 只走 fallback，不得讓主題啟用失敗。
- validator 檢查 schema、路徑、OFL 內容、檔數／bytes、WOFF2 header、宣告長度、table directory
  與區段邊界，並在 CI 以 headless Chromium `FontFace.load()` 真實解碼。只驗 magic bytes 不足。
- Default 字型與授權檔列 install precache；非 Default 字型維持 cache-first lazy，不增加首載 bundle。

## 後果與影響

修訂 [D-20260723-01](D-20260723-01-主題StyleAPI-v1.md) 的「禁止 `@font-face`」語意：禁止範圍仍
完整適用於作者 CSS，新增的唯一例外是 runtime 從已驗證 manifest 產生的窄契約。主題可取得字體
識別力，但不能擴張任意 CSS 信任面；CJK 完整字族仍由 locale-aware 應用字型負責，不鼓勵以主題
子預算攜帶大型全字集。正式 PR 必須同時通過授權、瀏覽器解碼、缺 glyph fallback、overflow 與
代表頁 a11y／必要操作可達性審查。
