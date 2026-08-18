---
type: art
domain: ["前端主題"]
summary: 主題 Skin Layer／頁面套用強度／寬高比例三軸 RWD 的穩定視覺規格
authority: null
slug: null
---
# 主題外觀與 RWD

> **本檔角色**：主題 Skin Layer、頁面套用強度與寬度／高度／比例三軸 RWD 的穩定規格。審查 viewport、代表頁原型、整合守門與驗收矩陣移至 [主題審查計畫.md](主題審查計畫.md)，該檔不構成產品 canon。
> 共用視覺原則見 [設計系統.md](設計系統.md)；主題 manifest、fallback 與驗證見 [../主題系統.md](../主題系統.md)；前端落地邊界見 [ui-frontend.md](../程式架構/ui-frontend.md)；各路由資訊架構見 [頁面線框.md](頁面線框.md)。

## 1. 決策摘要

本專案採用「**共用 DOM／ 流程 + 可主題化 Skin Layer + 多比例 RWD**」：

- 不為不同主題複製頁面模板，也不分岔資料與互動行為。
- 主題除色彩與背景外，可改變字體角色、面板 ／ 卡片 ／ 按鈕形狀、邊框、陰影、表面材質、裝飾資產與受控動態。
- 主題不得改變資訊語意、閱讀順序、核心操作位置、觸控下限或 gameplay 狀態辨識。
- RWD 同時處理可用寬度、可用高度、直橫向與長寬比，不只依 viewport 寬度判斷。
- 「公開首頁、車庫、顯示設定」是 Default／月兔雙主題與靜態 HTML／SCSS 的代表驗證頁；Angular 實作必須符合相同契約。
- 需要玩家即時車輛或場地的遊戲頁仍由 Three.js canvas 負責；公開首頁 `/` 使用包含固定宣傳車的主題 Hero key art，不載入 GLB、不建立 WebGL context。整個 UI 不改為 Canvas；DOM／CSS／SVG 保留可存取性、可翻譯性與 RWD 能力。

這項設計的主要風險與取捨，是允許主題改變元件的「形狀文法」，而不只換色。其價值是月兔等強風格主題可真正形成不同遊戲世界；風險由固定 DOM、固定資訊層級、受控 token 名錄、fallback 與代表頁視覺測試收斂。

## 3. 不變條件與責任邊界

### 3.1 必須保持

- 路由、DOM 語意、資料契約、i18n key、鍵盤順序與核心流程不因主題分岔。
- 每個 viewport 同時只有一個主 CTA；操作名稱與結果文案保持一致。
- 正式 UI 圖示使用 SVG，不以 emoji、Unicode 或字元圖案代替。
- 一般操作觸控目標至少 44×44px；比賽技能按鈕至少 72×72px。
- gameplay 保留 token、警告 ／ 成功 ／ 危險狀態與改裝編輯器中性 PBR 不受 Skin Layer 破壞。
- PNG 原圖保留於規格庫美術資源；runtime 優先使用 WebP，向量裝飾優先使用 SVG。
- 主題圖檔禁字、資產隔離、default fallback、離線快取與 SVG sanitize 沿用既有主題規範。

### 3.2 責任邊界

- 正式公版 GLB 的產生、補檔與最終模型美術驗收。
- 物理、配對、帳本、鏈上、UGC 資料模型或經濟規則變更。
- README、release 發佈、Git 公開化與音樂 ／ 音效實際素材補齊。
- 每個主題各自維護 Angular template。
- 用整頁 Canvas 取代 DOM UI。
- 為了原型新增套件、外部 CDN 或任意遠端服務；若正式字型需要新增依賴，必須另行核准。

## 4. 主題架構

### 4.1 三層責任

| 層 | 責任 | 可否由非 default 主題覆寫 |
| --- | --- | --- |
| 語意與行為層 | DOM、資訊順序、路由、資料、互動、a11y、核心操作位置 | 否 |
| 共用基礎與 safety layer | gameplay 狀態、觸控下限、focus、safe-area、斷點與 RWD 安全不變式 | 否 |
| Skin Layer | 色彩、字體角色、形狀、表面、陰影、裝飾、場景覆蓋、既有容器內的視覺構圖與受控動態 | 是；限 Style API |

Skin Layer 是共用元件的呈現契約，不是另一套頁面。Angular／`o4-*` 元件以 `[data-theme-part]` 公開穩定語意部位；頁面與元件 SCSS 提供結構、基礎狀態與 safety，主題資料夾內 `theme.css` 負責外觀。不同主題不得要求主題 ID 分支、專屬 Angular template、`chromeSkin`／`festival` 類共用 enum 或把專屬 selector 塞回共用 SCSS。

### 4.2 Style API、token 與私有 CSS 的責任

Style API v1 的穩定部位名錄由 `scripts/theme-css.mjs` 維護；主題只選取這些 part，不依賴內部 class。Default `theme.css` 是完整呈現基線，非 default `theme.css` 是可省略 overlay。cascade 順序固定為 `reset → base → components → theme-default → theme → safety`，因此強風格主題能改變完整表面，同時不能蓋過安全不變式。

共用 token 只收可重用的設計決策；主題內只為自身構圖使用的值放在 `:scope { --theme-* }`，單一 stable part 的一次性設計直接寫 declaration。主題形狀不建立全域邏輯方向 token 或 profile enum。例如導覽四角可由主題 CSS 直接分別宣告 `border-start-start-radius` 等屬性，不需要 `--o4-nav-radius-*` 四個全域 token。

共用 Skin token 供跨頁基礎元件使用；default 必須完備，其他主題可部分覆寫並 fallback：

| Token | 用途 | 限制 |
| --- | --- | --- |
| `--o4-panel-radius` | Pit Board、設定群組與大型面板外形 | 不得造成內容裁切 |
| `--o4-card-radius` | 車位、公告、主題與資產卡片 | 膠囊只限真正的 chip／segmented control |
| `--o4-button-radius` | 一般按鈕與主 CTA | 仍須保留清楚 focus outline |
| `--o4-button-bevel` | Default 切角或月兔柔角的受控形狀尺寸 | 僅用於裝飾形狀，不改 hit box |
| `--o4-border-width` | 面板與控制項主邊框寬度 | 高對比模式仍須可辨識 |
| `--o4-panel-background` | 面板表面漸層／材質色 | 禁 `url()`；圖檔走 asset key |
| `--o4-panel-border` | 面板輪廓色／漸層 | 不得取代狀態色 |
| `--o4-panel-shadow` | 面板層次與內凹／浮起效果 | 行動版需控制 GPU 成本 |
| `--o4-control-surface` | input、select、toggle 的共用底面 | body text 對比至少 4.5:1 |
| `--o4-control-border` | 表單控制項邊界 | focus 狀態另有可視輪廓 |
| `--o4-display-font` | 頁標、Stage 標題與重點數字字體 | 內文與長字串仍使用 base 字體 |
| `--o4-display-weight` | 顯示字重 | 必須有實際字型檔或可靠 fallback |
| `--o4-display-letter-spacing` | 顯示字距 | CJK 不可因過寬字距降低可讀性 |
| `--o4-display-transform` | 拉丁顯示字大小寫 | CJK 不受影響 |
| `--o4-scene-overlay` | 場景上方的可讀性漸層／暗角 | 不得過度壓暗主題插畫與 3D 主體 |
| `--o4-scene-filter` | 背景的飽和／明暗微調 | 不能用來掩蓋品質不足的資產 |
| `--o4-hover-lift` | 桌面 hover 位移 | 不造成 reflow；reduced motion 歸零 |
| `--o4-press-depth` | 按下回饋位移／縮放幅度 | 不改 hit box |

主題 CSS 可以在 stable part 的既有容器中設定 grid／flex、內外距、對齊與視覺層次，以支援 Default、月兔與未來不同構圖；但不能改 DOM 閱讀順序、隱藏必要控制、使核心 CTA 不可達、破壞文件無水平溢位或低於觸控下限。Stage 的硬安全上限、compact navigation、safe-area 與比賽 HUD 尺寸仍由 [§7](#7-多比例-rwd) 的共用 RWD／safety 規則控制。

### 4.3 第一階段資產 key

在既有 `scene-*`、`garage-background` 與 `theme-preview` 之外，新增下列可選視覺槽；default 提供完整 fallback：

| Asset key | 用途 | 建議格式 |
| --- | --- | --- |
| `landing-hero` | 公開首頁 Hero／全站低干擾模糊底圖 | WebP；規格庫保留 PNG 原圖 |
| `core-loop-assembly` | 首頁核心循環「組裝」圖形 | SVG |
| `core-loop-tuning` | 首頁核心循環「調校」圖形 | SVG |
| `core-loop-race` | 首頁核心循環「競賽」圖形 | SVG |
| `empty-generic` | 通用無資料狀態 | SVG 或透明 WebP |
| `empty-connection` | 離線／無法連線 | SVG 或透明 WebP |
| `empty-garage` | 尚無正式車或本機資源 | SVG 或透明 WebP |

裝飾 asset 使用 CSS background 或 `aria-hidden`；承載資訊的圖必須有可翻譯替代文字。空狀態文字與 CTA 永遠由 DOM／i18n 渲染，圖檔不含文字。

正式 template 與主題 SVG 的結構、安全引用方式只由
[ui-frontend.md §3](../程式架構/ui-frontend.md) 定義；本檔的資產表只指定主題需要提供哪些視覺槽位。

## 5. 頁面套用強度

主題不需要在每個頁面使用相同裝飾密度。以工作目的分成三層，差異是「裝飾強度」，不是功能分支。

| 層級 | 路由 | 套用原則 |
| --- | --- | --- |
| 完整 Skin | `/`、`/home`、`/garage`、`/ugc`、`/ugc/:cid`、`/race-config`、`/room/:roomId`、`/result/:resultId` | 背景、舞台、標題、主卡片、主 CTA、狀態與空畫面共同形成主題世界 |
| 支援 Skin | `/login`、`/announcements`、`/announcements/:id`、`/inbox`、`/about`、`/help`、`/settings/:section?`、`/creator/:peerId`、`/dmca`、`/dmca/transparency` | 保留閱讀與表單清晰度，套用 shell、標題、按鈕、卡片、圖示與少量角件 |
| 精密 Skin | `/editor`、`/garage/edit/:id`、Tool Drawer、P2P／CID／版本診斷 | 外框與導覽可主題化；編輯面、量測、數值、錯誤與技術控制維持中性高精度 |

`/race/:sessionId` 以沉浸與效能優先：HUD 可套字體、輪廓與少量 accent，但保留 gameplay 色彩、72px 技能按鈕與低 blend-layer 預算。

## 6. 兩個正式主題方向

### 6.1 Default：專業迷你四驅車工坊

**主體與玩家任務**：玩家在實體感明確的迷你四驅車 Pit Bench 上選車、調校並進入比賽；第一眼必須是四驅車與專業工坊展示 ／ 維修設備，不是資料儀表板。賽道與起跑設備僅能出現在場地、比賽及觀戰情境，不得回填公開首頁。

**色彩**：Default 的 token 名稱、色值與語意只由 [設計系統.md §2](設計系統.md) 定義；本節只規範其視覺使用方向。

**字體角色**：標題採窄體、較高字重與克制字距，內文維持 Noto Sans／Inter；目前使用既有字型 fallback，增加 display font 必須先核准資產／套件。

**形狀與材質**：8px 內的機械圓角、切角、沖壓金屬、無刻度工作墊嵌槽、紙標籤、螺絲 ／ 卡榫暗示。避免每個資訊都成為同款矩形卡片。

**唯一記憶點**：無刻度「舞台導引紋」從 Pit Bench 延伸至起跑方向，以嵌槽、接縫與箭頭串連 Stage、車位架與成績展示台。它只引導視線，不顯示數字、單位、等距刻度或比例，也不宣稱量測任何車輛資料。

### 6.2 月兔工坊：中秋日系 Q 版迷你四驅車工坊

**主體與玩家任務**：月兔 Pit Crew 在月夜工坊協助玩家調校迷你四驅車；Q 版的是工坊角色、裝飾與互動回饋，車仍維持可辨識的迷你四驅車比例，不變成一般賽車或玩具小汽車。

**色彩**：Moon Indigo `#10182C`、Night Plum `#17152B`、Jade Mint `#78E2C5`、Moon Gold `#D8A64B`、Lantern Gold `#F8D878`、Moon Ivory `#FFF1C7`。

**字體角色**：標題可使用較圓、較短、親和的 CJK display 角色；內文、數據與技術資訊維持 Noto Sans／Inter／mono。不得讓整頁都使用可愛字體而降低數據辨識。

**形狀與材質**：較大的柔角但保留局部切角，雙層奶油色 ／ 靛色輪廓、玉石按鈕、印章式 badge、兔耳負形與小型燈籠 ／ 月餅機械細節。避免通用手遊的全膠囊、玻璃卡片與過量漂浮粒子。

**唯一記憶點**：`Moon Rabbit Pit Crew` 角件與玉色「新月舞台導引紋」只出現在主要 Stage、主 CTA 或正式空狀態；導引紋不得出現刻度、數字或單位。一個 viewport 至多一個主角色焦點，其餘裝飾保持安靜。

**Q 版完成條件**：即使遮住背景插畫，只看按鈕、卡片、導覽、空狀態與標題，仍能與 Default 明確區分；若只能靠背景或色票辨認，視為未完成。

## 7. 多比例 RWD

### 7.1 三軸模型

RWD 依序回答三個問題：

1. **寬度軸**：可並排多少內容、導覽是否能完整容納。
2. **高度軸**：topbar、Stage、主要操作與 dock 是否能在低高度安全共存。
3. **比例 ／ 方向軸**：同一寬度在高直向、標準橫向、超寬橫向時，Stage 與資訊密度應如何重排。

既有 40em／64em／90em 仍是主要內容分桶，不增加另一套全站網格級距；但允許以下「適配條件」，其用途是防止內容不合身，不是第四種裝置分類：

- **導覽 fit threshold**：public shell 容器可用寬度 `≤72rem` 時切 compact navigation；這個 content-fit 條件自然涵蓋 667px 橫向手機與瀏覽器文字放大，不另設重複的 viewport breakpoint。
- **低高度橫向**：`orientation: landscape` 且可用高度 `≤32rem` 時，縮短 topbar／ 標題留白、收合非核心資訊、固定主要操作於安全拇指區。
- **高直向**：直向且寬度達 Tablet／Desktop 時，Stage 使用 aspect ratio 與 min/max block-size，不得按剩餘 `dvh` 無上限拉長。
- **超寬遊戲面**：`≥120em` 時，Stage／Event Board／Start Gate 等沉浸頁可逐步擴至 `112rem`；登入、公告、說明、設定等閱讀頁仍維持較窄可讀寬。Editor 與 Garage Edit 屬精密工作區，保留 shell 左右安全內距但不套用 `1440px` 最大寬。

### 7.2 各比例行為

| 情境 | 必須行為 |
| --- | --- |
| 手機直向 | Stage-first；單欄；主 CTA 與 bottom dock 不重疊；抽屜最後或預設收合 |
| 手機橫向／低高度 | compact topbar；隱藏非必要標籤而非縮小 hit target；主操作首屏可見；內容允許垂直捲動 |
| 平板直向 | Stage 保持四驅車／賽道適當比例；Pit Board 排在 Stage 後；不可形成超高空舞台 |
| 平板橫向 | 依內容採 2 欄或桌面骨架；觸控目標仍 ≥44px，不因像桌面而縮小 |
| 一般桌面 | 依頁面線框維持 Stage／Pit Board／Tool Drawer 主次；中央 3D 不被側欄壓縮 |
| 高解析直向桌面 | 以可讀寬與 Stage aspect cap 控制，不把 portrait 當成無限高 desktop |
| 超寬桌面 | 遊戲 Stage 可擴張，資訊欄維持可讀寬；多出的空間用於主視覺與空間節奏，不新增假資訊 |

### 7.3 頁面殼層與共用標題

- 使用共用頁面標題的頁面，由 App shell 統一提供導覽列到標題的 `space-4` 距離；頁面 wrapper、host 與標題本身不得再疊加另一份頂部留白。標題後方距離、內容寬度與左右內距仍由頁面構圖負責。
- Editor 與 Garage Edit 使用 viewport 扣除 shell 安全內距後的完整可用寬；Editor 桌面工作台以 flex 填滿 shell 剩餘高度，內容超高時允許頁面正常增高。小於 `64em` 的既有 Tablet／Mobile drawer 與 bottom-sheet 高度限制不變。
- `/ugc/:cid` 對 Part 與 Track 使用同一個 plain、置中的 detail 構圖，不因 `kind` 切換 scene frame 或頁面寬度；差異只存在右側資訊、資產種類文字與可用操作。

### 7.4 Stage 尺寸原則

- 車庫、首頁、場地海報等非沉浸 Stage 不使用無上限 `min-height: 100dvh`。
- Stage 以內容類型設定合理 aspect ratio，並配合 `clamp()`／`min()`／`max()`；背景使用 focal point，避免 `cover` 裁掉四驅車、賽道或月兔主角色。
- 直向 Stage 到達上限後，額外高度交給 Pit Board、清單或頁面留白，不再拉長背景。
- 比賽 ／ 觀戰是例外：arena 可維持至少 `100dvh`，但 HUD 必須吃 safe-area 且不得上下切版壓縮 3D。
- 3D canvas 由 `ResizeObserver` 重算 camera aspect；裝置旋轉時重用 scene 與資產，不建立第二個常駐 renderer。

Stage 若出現迷你四驅車軌道模組，必須符合下列視覺比例；這是物件比例契約，與無刻度「舞台導引紋」無關：

- 公開首頁不展示軌道、起跑門或車道護牆，也不放人物、真人工作桌或可建立真人尺度的遠景工作區；Hero 以四驅車工坊展示 ／ 維修平台與封閉式迷你零件展示牆定錨。軌道只出現在場地、比賽、觀戰等尺寸可由正式幾何驗證的畫面。

- 固定兩條寬車道，不把軌道壓縮成三條以上裝飾細槽。
- 單一車道淨寬以 115mm 對應車輛最大建議寬 105mm，視覺上約為車寬的 1.1 倍；同一景深比較時，車必須能實際放入任一車道。
- 護牆高度約 50mm，約為車道寬的 43%；不得縮成貼地細線，也不得高到遮住整台車。
- 彎道半徑跨數個車長；構圖放不下時將模組裁出畫面或完全省略，不縮小車道來硬塞。
- 正式 HTML／CSS／3D 原型以固定幾何比例驗證；生成概念圖只要無法清楚判定比例，就不能作為軌道出貨依據。

### 7.5 橫向溢位與旋轉

- **文件層**在支援矩陣中不得出現水平捲軸；需要橫捲的回合帶、tab 或工具列只能在標示清楚的內部容器捲動。
- 內部橫捲容器提供尾端遮罩 ／ 箭頭 ／ 下一張局部露出等 affordance，並支援鍵盤與觸控。
- 編輯器送出操作在所有支援尺寸都要直接可見；低高度或中窄寬時合併成「送出」選單，不得藏在工具列最右端。
- orientation change 後保留目前路由、表單、展開面板、選取車位 ／ 零件與可合理保留的捲動位置。
- fixed action bar、mobile dock、toast 與 modal 共同計入 `env(safe-area-inset-*)`；不得互相遮住。

## 8. 空狀態、錯誤與離線狀態

空狀態是玩家下一步的入口，不是小型系統警告：

- 保留該頁主題場景或低成本 CSS 舞台，不以大片純空白取代。
- 使用一個主題插畫 ／SVG 類型圖示、一句明確狀態、一句可執行說明與至多一個主 CTA。
- 「離線未快取」「資料損壞」「無內容」「權限不足」「正式 GLB 缺檔」必須是不同語意與修復動作。
- 技術細節收進可展開區，不先顯示 PeerId、CID、stack 或 provider 名稱。
- 月兔可以由 Pit Crew 引導，但不把錯誤寫成角色道歉；文案仍直接說明發生什麼與如何修復。

## 10. 可存取性、效能與資產預算

- body／control text 對比至少 4.5:1，大字至少 3:1；focus ring 在兩個主題與所有表面都可見。
- 不用顏色作唯一識別；狀態同時有圖示、文字或形狀。
- 唯一 effective reduced motion（玩家 `reduce` 或 OS `prefers-reduced-motion: reduce`）關閉非必要 hover lift、粒子、視差、展示車自轉與場景轉場；`data-motion=pending` 同樣保持靜止。
- 低階裝置減少陰影層、blend 與 filter；月兔的 Q 版完成度不能依賴高成本特效才成立。
- 一般 UI 維持首屏 CSS、LCP 與 blend-layer 既有預算；比賽 HUD 不使用 backdrop-filter。
- 非 default 主題資產保持 lazy；切主題不得重載路由或丟失表單 ／ 編輯狀態。
- 代表頁概念資產的 PNG 原圖存規格庫；程式使用 WebP／SVG。所有資產須有來源與授權紀錄。
- 不為卡片建立獨立 WebGL context；卡片車輛仍使用組裝後車輛的預烘透明 WebP snapshot，卡片背景由 CSS／ 主題資產繪製。

## 13. 文件權威與衝突處理

- 本檔是 Skin Layer、頁面套用強度、多比例 RWD 與代表頁原型的權威。
- [../主題系統.md](../主題系統.md) 仍是 manifest、fallback、分類、資產隔離、快取與 CI 驗證權威。
- [ui-frontend.md](../程式架構/ui-frontend.md) 仍是渲染分工、元件庫、效能與技術落地權威。
- [頁面線框.md](頁面線框.md) 仍是各路由資訊架構與主要互動權威。
- 若舊文件的「只依寬度」「`>1440` 一律不放大」「卡片圓角一律不超過 8px」與本檔衝突，以本檔的分情境規則為準；Default 仍可保留 8px 內機械圓角，強風格主題則由受控 Skin token 改變外形。
