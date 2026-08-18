---
type: impl
domain: ["前端主題"]
summary: UI 前端技術選型與實作策略（渲染分工／token 架構／動畫效能預算／資產 pipeline）
authority: null
slug: null
---
# UI 前端實作策略（UI Tech Strategy）

> **本檔角色**：UI 的 **implementation authority** —— 渲染分工、CSS / SVG 合成技法、共用元件庫、design token 架構、動畫 / 效能預算、Three.js 疊層、RWD / a11y、背景策略、主題、資產 pipeline、字型。
> 視覺設計值（色票 / 字級）見 [設計系統.md](../美術資源/設計系統.md)；比賽 HUD 見 [賽內機制.md §2.4](../賽內機制.md)。對應 `src/ui-kit/`（o4-* 元件）＋ `src/pages/` ＋ `src/styles/`。

## 1. 渲染策略（5 技術疊合）

| 技術                    | 負責                                                                           |
| ----------------------- | ------------------------------------------------------------------------------ |
| **Angular (HTML+TS)**   | 元件結構 / 狀態 / 路由 / 表單 / 邏輯                                           |
| **SCSS / CSS**          | 色彩 / 版面 / 漸層 / 發光 / 邊框 / blend / 簡單動畫（GPU、token 化、themable） |
| **SVG**                 | icon / 線條 / 向量裝飾 / 動態 stroke / 遮罩（解析度無關、可染色、a11y）        |
| **Three.js `<canvas>`** | 3D 車 / 場地 / 比賽 / 環境背景                                                 |
| **PNG / WebP / Lottie** | 美術插畫 / key art / 複雜動畫 / 預烘 snapshot 縮圖                             |

**決策樹**：3D 場景 →Three.js；純向量 →SVG；可 gradient+blend+filter+shadow→CSS；逐畫素 shader→Canvas WebGL/Lottie；純插畫 →PNG/WebP。反例：UI 按鈕 / icon 不做成 PNG；列表縮圖用 Three.js **預烘 WebP snapshot**（非即時 3D）。

## 2. CSS 合成技法

多層漸層（≤5 層）、霓虹發光（`box-shadow` ≤6 層）、毛玻璃（`backdrop-filter`，整頁 ≤2 大面積）、`conic-gradient`+`mask` 放射 / 扇形進度（HUD 能量條 / radial progress）、`filter: hue-rotate/saturate` 主題微調、`mix-blend-mode` 染色 / 暗角 / 噪點、`clip-path` 非矩形機甲面板、`mask-image` icon 染色。**PSD / Figma 的 16 種 blend mode 名稱與 CSS 完全一致**（設計師交付直接寫 blend mode 名）。

## 3. SVG 規範

正式 UI icon sprite 位於 `public/assets/sprites/open4wd-ui.svg`，由 `o4-icon` 以受限名稱 union 與 `<symbol>` / `<use>` 引用；未知名稱必須回退至安全圖示，不得拼出任意 URL。icon 統一 `viewBox="0 0 24 24"` + `stroke-width=2` round cap/join，以 `currentColor` 染色、尺寸由 CSS 控制。需要獨立插畫或動態路徑時才使用外部單檔；正式控制項、導覽、HUD、UGC 類型與空狀態不得用 emoji / Unicode 字元代替 SVG。正式 Angular template 唯一允許的 SVG 結構是 `o4-icon` 的 `<svg><use href="assets/sprites/open4wd-ui.svg#…"></use></svg>`，其餘 SVG 幾何一律外部引用；同時禁止 `data:image/`、base64 圖檔、靜態 `style=""` 與 `<style>`。**主題提供的 SVG（不可信來源）一律 `<img>`／CSS url／mask 引用、禁走 `SafeHtmlPipe` inline**（[../主題系統.md §7](../主題系統.md) 另有 CI sanitize）。`public/reset/index.html` 是 `<style>` 唯一精確例外，因重置工具須在 Angular 啟動前獨立可用。

## 4. 共用元件庫（`o4-*`，全站強制使用）

> **「全站強制」＝ 使用標準**（凡該類控制項一律用 `o4-*`、不繞道原生）。目前原子件名錄包含基礎組（`o4-button`／`o4-icon`／`o4-input`／`o4-select`／`o4-toggle`／`o4-slider`／`o4-tab`／`o4-modal`／`o4-toast`／`o4-card`）、`o4-status-pill`、`o4-stat-gauge`、`o4-3d-stage` 與 `form-field`（[§4.1](#41-表單與檢核兩層分離)）。其他遊戲化與容器名稱只在有對應頁面 consumer 時加入實作名錄。

- **基礎**：`o4-button`（primary/secondary/ghost/icon/danger）/ `o4-icon` / `o4-input` / `o4-select` / `o4-toggle` / `o4-slider` / `o4-tab` / `o4-modal` / `o4-toast`（以 `ToastService`＋`o4-toast-container` 形交付）/ `o4-card`（flat/raised/glass/glow-edge）。
- **遊戲化**：`o4-stat-gauge` / `o4-energy-bar` / `o4-rank-badge` / `o4-coin-chip` / `o4-creator-tag` / `o4-vehicle-slot` / `o4-track-slot` / `o4-part-chip` / `o4-status-pill` / `o4-countdown` / `o4-hud-pos` / `o4-hud-speed` / `o4-3d-stage`（統一 Three.js canvas 容器）。
- **容器**：`o4-shell` / `o4-navbar` / `o4-tabbar-mobile` / `o4-page-bg` / `o4-empty-state` / `o4-error-state` / `o4-loading-state`。

實作落點 `src/ui-kit/`（[../程式架構.md §4](../程式架構.md)）；路由頁面（構圖層、每頁獨立設計）在 `src/pages/`，共用只在原子層——**跨頁領域複合件**（`o4-ugc-card`／`o4-chat-panel`）住 `src/pages/shared/`（領域構圖、非原子）。

### 4.1 表單與檢核（兩層分離）

- **UI 表單層**（`src/ui-kit/forms/`）：Angular Reactive Forms；共用 form-field 元件（label ＋ `o4-input`/`o4-select` ＋ 錯誤槽）；錯誤訊息一律 i18n `validation.*` key（ICU 帶 `{min}`/`{max}` 參數，[../語系清單.md §3](../語系清單.md)）。
- **規則權威在領域層**：validator 門檻值一律取自 `@open4wd/system-constants` 或領域模組（助記詞 12/24 → key-manager、回合數 ／ 人數 → `protocol.md`、檢舉擋點 → moderation `canFileReport`）——**表單層禁止重寫門檻值**（跨檔漂移紀律的程式碼層延伸）。
- **表單過檢 ≠ 被接受**：真擋點在領域 ／ 共識層（schema 檢核、收件驗證）；UI 檢核僅即時反饋——改裝 client 可跳過表單（[../資安規範.md](../資安規範.md) 同一信任邊界）。

## 5. Design Token（CSS 變數）

命名 `--{category}-{role}-{variant?}`（如 `--color-accent-speed` / `--space-3` / `--anim-duration-fast`）。**token 名錄與預設值權威 = [../主題系統.md](../主題系統.md)（`themes/default/theme.json`）**；`src/styles/tokens/{colors,typography,spacing,radius,shadows,motion}.scss` 為 build 時自 default manifest 生成的 `:root { --xxx }` 基準輸出（首屏免等 JS、**禁手改**避免雙權威）；主題覆寫 = runtime `applyTokens`（[../程式架構/themes.md §2](../程式架構/themes.md)）。Three.js 不讀 CSS 變數 → `ThemeService` 維護 token 鏡像，切主題時同步 ambient/fog/lights（[§14](#14-主題切換架構)）。

token 負責可重用的設計決策，不承擔所有主題構圖。正式分工為：manifest token＝ 跨元件共享值與可由程式鏡像的值；`theme.css` 內 `--theme-*`＝ 單一主題的私有組合參數；受控 CSS declaration＝ 只在特定 stable part 上有意義的外觀與構圖。不得為每個邊角、每個主題專屬裝飾都擴張成全域 `--o4-*` token；同理也不得把 gameplay 狀態、命中區、safe-area 或共用 RWD 安全規則藏進主題私有變數。

### 5.1 頁面構圖與容器邊界

- `src/styles/game-surfaces.scss` 只定義跨頁語意角色：`.o4-stage`、`.o4-pit-board`、`.o4-tool-drawer`、`.o4-inline-blocker`；它不接管單頁 grid，也不提供量尺元件。
- `src/pages/**/<page>.scss` 負責該路由的構圖、斷點與視覺節奏，不複製 token 值、不改 generated token SCSS。
- Stage 承載 3D／ 主資產，Pit Board 承載目前目標與單一主 CTA，Tool Drawer 承載 PeerId／CID／OrbitDB／TURN／ 版本與診斷。核心流程不可只存在於收合抽屜內。
- 任何 viewport 同時只能有一個 `accent.speed` primary；測試可用 `[data-primary-action]` 或頁面專用 primary hook 驗證。狀態切換可以更換主動作，但不能同時呈現兩個橘色 CTA。

## 6. 互動狀態（6 態，缺一不可進審查）

`default` / `hover`（桌面）/ `active`（scale 0.96）/ `focus`（2px outline ring）/ `disabled`（opacity 0.4）/ `loading`（spinner + 鎖互動）。**禁止只做 hover 不做 focus**（a11y）。

## 7. 動畫規範

視覺時長 ／ 緩動一律走 design token `--anim-*`（名錄與預設值權威 = `themes/default/theme.json`，[../主題系統.md](../主題系統.md)；本表 = default 級距的**設計來源**）；toast 停留與倒數節拍等行為時序常數住 [ui.md §12](../程式參數/ui.md#12-uianimation動畫行為常數)、非 token。effective reduced motion 直接採靜態素材、0.01ms 動畫與停用 smooth scrolling，不另乘比例係數。全域互動只對按鈕、連結、slot、topic 與卡片套用短促 transform / opacity / border / background 轉場，不以 `transition: all` 擴散到布局屬性。
級距：hover/focus 120ms / panel 240ms / modal 320ms / HUD 60–180ms / 結算演出 600–1200ms。緩動：一般 UI `cubic-bezier(0.4,0,0.2,1)`、遊戲感 spring `cubic-bezier(0.34,1.56,0.64,1)`。**僅對 `transform`/`opacity`/`filter` 動畫**（禁 width/height/top/left/margin reflow）。> 240ms 動畫須遵守唯一 effective reduced motion（玩家 `reduce` 或 OS `prefers-reduced-motion: reduce`）；`data-motion=pending` 也不得啟動裝飾動畫。

## 8. 效能預算

| 場景         | 預算                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 一般 UI 頁   | JS bundle < 350KB gz / 初始 `styles` production artifact ≤ 50 KiB raw / LCP < 2.5s（4G）/ blend layer ≤ 4 / backdrop-filter ≤ 2                              |
| **比賽 HUD** | HUD 渲染 < 1.5ms/frame / 60fps（手機 30）/ blend layer ≤ 2 嚴格 / **不用 backdrop-filter** / 全走 transform+opacity / UI 更新 10–15Hz（物理 60Hz） |
| 載入頁       | 首屏 < 100KB inline CSS / 載入動畫 CSS 或 Lottie ≤ 50KB                                                                                            |

Three.js GLB：UGC 上限 80 MiB＝ **拒收線**（sanitize hard cap，[建模參數.md](../建模參數.md)）；公版出貨預算另有分級（零件 ≤112KiB〔超過原 100KiB 的額度僅供完整 PhysicsManifest／deterministic physics metadata〕／場地 ≤500KiB／總計 ≤4MiB，[../程式架構/builtin-assets.md §4](../程式架構/builtin-assets.md)）——效能設計以公版預算為基準、UGC 依檔案大小顯示於卡片供玩家自行取捨。

## 9. Three.js Canvas × DOM 疊層

`<o4-3d-stage>`（canvas 全占）+ `.hud-overlay`（`pointer-events: none`，個別互動元素 `auto`）。z-index：canvas 0 / HUD 容器 10 / HUD 互動 20 / Toast 100 / Modal 1000。`o4-3d-stage` 監聽 `ResizeObserver` 同步 canvas 寬高·camera aspect·`setSize/setPixelRatio`；`ngOnDestroy` 釋放 geometry/material/texture/renderer。

**renderer／context 預算**：每個可見 stage 最多一個 renderer，卡片禁止各自建立 WebGL context 或常駐 render loop。一般 stage 的 pixel ratio 目標夾在 1–2（高 DPR 裝置上限 2），drawing buffer 硬上限 8,000,000 pixels；超大舞台必要時可低於 DPR 1 以守住硬上限。組裝車縮圖由全站單一 offscreen renderer 串行處理，固定 512×320、DPR 1、每個工作只渲一幀，優先 WebP、失敗才 PNG。縮圖與顯示 stage 共用 GLB／ 組裝資產快取但不共用可變 scene；context lost、無 WebGL、GPU／post-processing 失敗時回 `null`，UI 顯示 SVG 車輛 fallback，不產生 broken image。縮圖不得以每卡 requestAnimationFrame 實作。

## 10. RWD 與觸控

主要內容仍採 CSS／SCSS 的 40em／64em／90em 三級寬度分桶，並由 `ui-breakpoints.test.mjs`
守門；不另維護 TypeScript px 對照常數。高度、比例、compact navigation 與超寬 Stage
不是新裝置分類，其完整行為與驗收矩陣只由
[主題外觀與 RWD.md §7](../美術資源/主題外觀與%20RWD.md) 與非 canon
[主題審查計畫.md §12](../美術資源/主題審查計畫.md) 定義。

**斷點單位 ＝CSS 邏輯像素**（與實體解析度 ／DPR 無關）；寬度 media query 以 em 實作，低高度條件以 rem 實作，aspect／orientation 只描述可用畫面形狀，全部禁機型綁定。編輯器以用途導向 `(width < 64em)` query 切 compact／PC 版面（[../編輯器操作.md §0.5](../編輯器操作.md)），但中窄寬或低高度時送出操作必須直接可見或收斂成單一「送出」選單。概念與原型至少輸出 1440×900、1080×1920、667×375、390×844，並以 3440×1440 補驗超寬。觸控目標 ≥44×44px、主操作放拇指區、避開螢幕邊緣 8px；文件層不得水平溢位，回合帶 ／tab／ 工具列只能在有明確提示的內部容器橫捲。

**全站不強制螢幕方向**（RWD 直橫皆支援；比賽頁僅建議橫向——直向進賽顯示一次性旋轉建議 toast、可記住不再提示、不阻擋；直向適應排版見 [../賽內機制.md §2.4](../賽內機制.md)）。瀏覽器無可靠跨平台 OS 級鎖定能力，因此不做內容遮罩式強制旋轉。

共用 RacePage 路由使用沉浸式 shell：participant／spectator 都讓 3D arena 至少 `100dvh`、不渲染一般 topbar / bottom nav、HUD 使用 `env(safe-area-inset-*)`。participant 在 390px 基準下四個技能同列等寬且各 ≥72×72px；共用相機列只有產品三模式，participant 顯示類型／跟車／自己，spectator 顯示類型／跟車且不顯示技能列。低於既定支援寬度時才另設極窄 fallback，不得靠縮小 hit target 硬塞。

## 11. 無障礙（a11y）

文字對比 ≥ 4.5:1（大字 ≥ 3:1）；顏色非唯一識別（加形狀 / 圖示）。鍵盤：Tab 順序符合視覺、焦點環顯著、Esc 關 modal、Enter/Space 啟動。icon button 必有 `aria-label`，圖示 SVG `role=img`+`<title>`、裝飾 SVG `aria-hidden`。OS 或玩家的 effective reduced motion 關閉非必要動畫。

## 12. UGC 邊界值

顯示長度上限（暱稱 12 全/24 半、車名 16/32、場地名 24/48、簡介 100 字）→ ellipsis；全 emoji 仍顯示、RTL 自動 `direction: rtl`、控制字元 / zero-width 移除、HTML 一律 escape（無富文本）。UGC 字串處**禁固定寬排版**（`flex-shrink:1` + `min-width:0` + `overflow:hidden`）。

## 13. 背景策略（共用底層＋A / B / D 頁面覆蓋）

所有路由先顯示 App Shell 唯一的主題 `app-backdrop`：以目前主題 `landing-hero` 形成固定全畫面、低干擾模糊底圖。它不接收輸入、不動畫；低特效 ／ 降低透明度模式可降低模糊或退回主題純色。

頁面仍可依需求覆蓋共用底層：A = PNG/WebP 預烘背景（極低成本）；B = 純 CSS（gradient+filter+低對比工坊材質）；D = Three.js 同 scene 背景（skybox+stage+ambient）。**不用 C**（另開 scene 浪費 GPU）。`/login`、`/settings`、`/help`、`/inbox`、`/about`、`/dmca` 可用透明 B tint；`/garage`、`/garage/edit/:id` 與 `/ugc` 使用 D；`/editor` 使用中性 D；`/ugc/:cid` 可使用 A+B 或 showroom D；`/race-config`、`/room/:roomId` 使用 B+D；`/result/:resultId` 使用 B+局部 D；`/race/:sessionId` 使用全頁 Three.js。頁面覆蓋可不透明或透明，沒有完成且核准的預烘圖時使用 B，不以臨時圖片或不存在的 GLB 佔位。`o4-3d-stage [preset]`：`garage / workshop / showroom / arena / podium / neutral`，每 preset 一份 lighting+skybox+stage、跟主題 token 同步。

設定頁的外層 tint、shell、navigation 與 panel 透明度都是主題責任，不由共用元件鎖死。
Default／月兔與其他主題的 tint、shell、panel 透明度只由
[主題系統.md §5](../主題系統.md) 定義。設定 section 不套用通用 `.o4-pit-board` 不透明底，
避免繞過 theme part 把共用模糊背景完全遮住。

## 14. 主題切換架構

主題模型權威 = [../主題系統.md](../主題系統.md)：受控 CSS ＋ token ＋ manifest ＋ fallback default（`public/assets/themes/<id>/` 自包含資源包；新增主題只新增自己的 manifest／ 可選 stylesheet／assets，不修改 Angular、共用 SCSS 或 `ThemeService`）；套用實作 = [../程式架構/themes.md](../程式架構/themes.md)。本檔補 UI 側銜接：

- Angular／UI Kit 只在語意穩定的節點公開 `[data-theme-part]`；主題 `theme.css` 只能選取 Style API 名錄內的 part。全域 cascade 固定 `reset → base → components → theme-default → theme → safety`，使主題能形成完整視覺，且 focus、觸控、安全區與 reduced motion 仍由 safety 最後守門。
- Theme stylesheet 在未啟用 candidate 中完成抓取、URL 重寫與準備，成功 persist 後才與 token／snapshot 原子提交；失敗保留既有畫面。非 default 可省略 stylesheet 作輕量色票主題。
- **Three.js 不讀 CSS 變數** → `ThemeService` 維護 token 鏡像，`setTheme` 時同步 ambient / fog / lights 與 `o4-3d-stage` preset（[§13](#13-背景策略共用底層a--b--d-頁面覆蓋)）。
- arena 對外部 PBR 場地提供本機程序 PMREM 環境反射作可讀性底線，避免高金屬度表面在只有方向光時大面積近黑。此補光不需 HDRI／網路資產、不竄改 UGC 材質，且只套 race；主題 profile 仍控制色調、key／ambient／rim、背景與霧。
- Skin Layer 可改字體角色、元件形狀、表面、陰影、裝飾、受控動態與既有容器內的視覺構圖，但不可改 DOM、資訊順序、權限、必要操作或共用 RWD 安全下限；Style API／token／asset 契約與頁面套用強度見 [主題外觀與 RWD.md §4·§5](../美術資源/主題外觀與%20RWD.md)。
- `theme.json.renderProfile` 只影響車庫展示、比賽 ／ 觀戰與縮圖；改裝編輯器固定中性 PBR。除材質、燈光與環境外，`stage` palette 以 `ground/surface/raised/metal/accent/marker` 六色控制 Three.js 舞台世界材質；缺項安全回退 Default，preset 不判斷主題 id。無效 profile 整份回 default PBR，Outline 不可用時降級為無描邊 Toon／PBR；主題切換重用 GLB 與組裝結果，只換 render view 與縮圖 key（精確 schema 見 [../主題系統.md §5.3](../主題系統.md)）。
- token 預設值 build 流見 [§5](#5-design-tokencss-變數)（自 default manifest 生成、禁手改）。
- 初始 CSS 預算只量正式 production 輸出的 `styles[-hash].css` raw bytes，不以 development 未最佳化產物或來源碼合計代替；Angular `bundle: styles` 與 build 後 artifact checker 同為 50 KiB fail-closed gate。只服務單一路由的大型樣式不得搬入 global 規避 `anyComponentStyle`：Garage fidelity 由單一 SCSS 權威投影成根層 `garage-fidelity.css`，進 Garage 才掛載、離頁移除，並由 install precache 保留首次離線可達性。
- 新主題 = 社群 PR（[../主題系統.md §9](../主題系統.md)、`themes:validate`）；review 必須檢查 Style API、外部 URL／ 內部 class、a11y、授權、大小預算，並附公開首頁、車庫、顯示設定、Race Config、Editor 五個代表頁的多比例截圖。官方 repo 中的正式主題都經此門檻；其他使用者自行 fork、修改且不送 PR 的版本不在官方 runtime 信任與審查範圍。

## 15. 資產 pipeline 與工具鏈

核心開發者：[提示詞/頁面概念圖.md](../美術資源/提示詞/頁面概念圖.md) 出示意圖、[UI資產.md](../美術資源/提示詞/UI資產.md) 出資產母圖，再依用途最佳化。主題 UI 圖、動畫與主題專屬 3D 一律進 `public/assets/themes/<id>/assets/` 並由 `theme.json` 引用；跨主題共用 icon sprite 進 `public/assets/sprites/`。builtin gameplay GLB 另走 [程式架構/builtin-assets.md](../程式架構/builtin-assets.md) 的 authoring manifest／release gate，不混入主題資產。貢獻目錄、命名、授權與驗證入口統一維護於 repo 根 `CONTRIBUTING.md`；圖檔禁字鐵則見 [§16](#16-文字與字型)。工具可使用 vtracer／potrace、Blender／Tripo3D／Meshy、Lottie、sharp／squoosh、glyphhanger／pyftsubset 與 wcag-contrast，但產物仍須通過 repository gate。

### 15.1 音訊與公版 GLB release gate

- 主題 manifest 必須列出完整 BGM／SFX 槽位；default 可全部為 `null`。`null` 是正式的安全靜音狀態：不得抓取 fallback URL、不得報 console error，也不得阻擋建置或本機測試。
- 公版 GLB release gate 必須驗證路徑、schema、缺檔 fallback、資產檢查器、完整本機測試與公開授權。缺檔時不製造假檔，也不把概念圖當正式資產。

## 16. 文字與字型

**圖檔禁字鐵則**：任何**出貨圖檔資產**（SVG／點陣／GLB〔貼圖與幾何字皆含〕／Lottie／og:image 等）**禁止內含文字**——任何語言的字母字系皆禁；**數字 0–9 與跨語系中立符號**（`! ? + × % : →` 等數學／標點／圖形符號）**允許**。文字一律由執行期以 i18n 字串渲染（fallback 階梯見下）。**範圍 ＝ 官方資產**（UGC 貼圖不在此政策——不可管、內容問題走檢舉機制）；設計參考件（頁面概念圖）豁免——圖內文字僅為示意、非出貨資產。

**3 分類**：A 品牌符號（**圖形 mark**＝圖檔、零文字；「open4wd」wordmark＝web font 排版、不做含字圖檔）／C 設計過 web 字（標題／HUD／**戲劇定格詞**〔READY／GO！／VICTORY 等＝i18n key、可翻〕，web font＋執行期渲染）／D 純動態字串（暱稱／UGC，web font、翻譯）。**鐵律**：i18n key 只走 C／D，**禁對任何字串做含字圖檔**。

**C 類視覺強度 fallback 階梯**（效果不足時逐層升級；文字恆來自 i18n 字串、恆非圖檔）：

1. CSS：描邊 / 漸層 clip-text / 多層 text-shadow / 發光 / 3D 投影 / skew——集中 `text-styles.scss`
2. SVG filter on text：`feTurbulence`／`feDisplacementMap`（火焰扭曲 / 液態）／`feSpecularLighting`（金屬光）——執行期模板、非資產檔
3. Canvas／WebGL 動態文字渲染：i18n 字串 → CanvasTexture／TextGeometry ＋ shader／ 粒子（賽內定格詞建議此層；字型檔 ＝C/D 類既有資產）
4. 圖形層 ＋ 文字層合成：效果主體 ＝ **零文字純圖形動畫資產**（爆光環 / 速度線 / 集中線），文字以 1–2 層疊加

**不設 per-locale 分版圖檔後門**——單一效果四層皆不可行時，改設計遷就政策（避免翻譯 PR 變美術 PR）。

字型全部免費商用且自行託管（不用 Google Fonts CDN）；OFL 須附 `LICENSE.txt`，系統字（PingFang / 微軟正黑）只進 CSS fallback chain、不 bundle。初始 CSS 只帶 Inter；bootstrap 依目前語系只啟用 Noto Sans TC／SC／JP 的 400、700 stylesheet，英文不載入 CJK。所有 face 使用 `font-display: swap`，缺字型走系統 fallback，不設會阻塞 `/race/:sessionId` 的 route guard。runtime 對照與載入生命週期以 [../程式架構/i18n.md §6.1](../程式架構/i18n.md) 為準。

## 17. 跨模組對接

| 對象                                         | 對接                                |
| -------------------------------------------- | ----------------------------------- |
| [設計系統.md](../美術資源/設計系統.md)                   | 色票 / 字級 / 元件規則來源          |
| [賽內機制.md §2.4](../賽內機制.md)           | 比賽 HUD 規格 / Three.js scene 預算 |
| [pwa-offline.md](../程式架構/pwa-offline.md) | 字型 / 資產 SW cache、離線          |
| [語系清單.md](../語系清單.md)                | i18n 文字（C/D 類）                 |
| [建模參數.md](../建模參數.md)            | GLB 大小上限                        |
