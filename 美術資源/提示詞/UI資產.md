---
type: art
domain: ["前端主題"]
summary: UI 資產生成提示詞
authority: null
slug: null
---
# UI資產

> **參考件（非 spec）**：本檔為圖像生成提示詞；高解析 PNG 精選收 `release-input/ui/`（版面基準另存 `參考雛形/定版/`、早期概念稿 `參考雛形/草稿/`）。出貨資產路徑 ／ 染色規則以 [ui-frontend.md §3・§15](../../程式架構/ui-frontend.md) 為準。

本檔提供 Open4WD UI **個別資產**的 codex 圖像生成提示詞，依**最終輸出格式**分三類：

1. **直接使用 PNG/WebP**：codex 出圖 → 壓縮 → 直接用
2. **轉 SVG**：codex 出圖 → vtracer / potrace 轉向量 → 手工清理 → SVG
3. **轉 GLB**：codex 出圖 → Tripo3D／Blender → GLB → repository asset gate

> 與 [頁面概念圖.md](頁面概念圖.md) 區別：那份是「**整頁示意圖**」（給工程師看版型節奏），這份是「**個別資產**」（給工程師切版時實際用到的素材）。

> 與 [零件參考圖.md](零件參考圖.md) / [場地參考圖.md](場地參考圖.md) 區別：那兩份是「**車輛零件 / 場地 3D**」（玩家可上傳的 UGC 內容），這份是「**UI 系統內建資產**」（永遠存在於 app shell 中）。

---

## 設計依據

本檔所有資產風格 **與 [頁面概念圖.md](頁面概念圖.md) 同調**：主 C（3D 動畫電影卡通）70% + 輔 A（動畫熱血）30%。

色票走 v2（warm dark base + bold orange accent，詳見 [頁面概念圖.md](頁面概念圖.md) § 色票 v2）——**概念稿刻意暖化**；app 實際色票 ＝ [設計系統.md](../設計系統.md)（token 值權威 ＝default 主題，[主題系統.md](../../主題系統.md)）。

---

## 是否需要手機版？

| 類別 | 是否分手機版 | 理由 |
|---|---|---|
| **直接使用 PNG/WebP** | **僅全螢幕背景 / hero 類分**（16:9 + 9:16）；icon-size PNG（particle / badge）不分 | 構圖隨比例差異大 |
| **車庫舞台背景** | **不分**；單一 16:9 中央安全構圖 | 舞台不是全螢幕 hero；桌機／手機共用相機與 GLB 中心，窄畫面只裁切兩側設備 |
| **轉 SVG** | **不分** | 向量天生自適應 |
| **轉 GLB** | **不分** | 3D 模型由 Three.js camera 處理視角 |

實際需要兩版的只有「全螢幕背景 / hero key art 類」少數資產，會在下方逐項標註。

---

## 共通原則

### 一張圖只生一個資產

不要要求 codex 一次出多個資產（icon sheet 例外，見 [§2.2](#22-icon-set)）。否則 vtracer 切不乾淨、Tripo3D 抓不到主體。

### 背景一律 transparent 或純色

- 轉 SVG / GLB 用：純白 `#ffffff` 或純灰 `#f5f5f5` 背景，方便去背
- 直接使用 PNG：依用途決定（splash 需要背景、icon-style PNG 透明）

### 風格鎖死

不論哪個資產類別，主體**必須**是 3D 動畫電影卡通風（chunky / 圓潤 / 飽和 / soft AO），不可:

- 寫實 photoreal
- 線稿極簡 minimalist
- Material Design flat
- 蘋果擬物 skeuomorphism

---

## 命名與目錄

正式路徑由 [ui-frontend.md §15](../../程式架構/ui-frontend.md) 定義：主題 UI 圖、動畫與主題專屬 3D 放在
`public/assets/themes/<id>/assets/`，跨主題 icon sprite 放在 `public/assets/sprites/`；builtin gameplay
GLB 走獨立 authoring manifest／release gate。母圖與未最佳化來源不得放入出貨路徑。

---

# 第一類：直接使用 PNG / WebP

## 1.1 Hero / Splash 背景

### `login-bg` — 登入頁背景

**用途**：`/login` 全螢幕背景
**輸出**：兩版 — desktop 1920×1080（16:9）+ mobile 1080×1920（9:16）
**目錄**：default 主題的 `assets/hero/login-bg-desktop.webp` + `login-bg-mobile.webp`

```text
Cinematic 3D-animated-film-style stylized scene for a Mini 4WD racing game login
splash. NOT photoreal, NOT a SaaS background.

A chunky cartoon Mini 4WD car (vibrant candy red body shell, exposed
wheels, twin guide rollers) sits centered at lower-third on a stylized
urban asphalt road at warm orange sunset, slightly low-angle hero shot.
Soft motion-blur radial speed lines emanate from the car as a subtle
background pattern, NOT dominant.

Environment: warm dark sky gradient from deep brown (#1a1410) at top to
bold orange (#f97316) near horizon. Blurred stylized city silhouettes in
the far distance with small warm window lights. Foreground asphalt has
freshly painted bright white lane markings, slight wet reflection.

Lighting: strong warm rim light from behind the car (orange halo), cool
sky-blue rim from front, cinematic key light.

Style: chunky candy-bright toon-shaded 3D cartoon aesthetic,
toon-shaded with soft fillets, bouncy spring proportions, saturated warm
palette, NO photoreal materials, NO thin lines.

CRITICAL — image must contain ZERO text, ZERO logos, ZERO UI elements.
Pure background art only. Logo and UI will be overlaid in code.
```

**手機版差異**：構圖改直幅，車輛上移至中上、地面延伸至下，預留下方 ~40% 給 UI 元件疊上去。提示詞末尾加：

```text
COMPOSITION FOR PORTRAIT 9:16: vehicle positioned upper-third center,
extended asphalt road occupies the lower 50% of the frame as a clear
zone for UI overlay, vertical space emphasized.
```

---

### `splash-loading-bg` — 全螢幕載入背景

**用途**：首次載入、IPFS bootstrap 等候
**輸出**：兩版 desktop / mobile

```text
Stylized cartoon racing pit-lane scene at dawn, viewed from far enough
that the central focus is empty (where loading animation will sit).

A chunky cartoon Mini 4WD car silhouette sits at far edge of the frame
as a small detail, NOT the main subject. The main visual is the warm
gradient sky and stylized blurred grandstand silhouettes.

Color: warm dark base (#1a1410), bold orange horizon glow (#f97316),
small cool sky blue accents (#38bdf8) on distant lights.

Style: 3D-animated-film stylized, toon-shaded, soft fillets, saturated, NOT
photoreal. Composition is minimal so a loading spinner can be overlaid
centrally without clashing.

CRITICAL — ZERO text, ZERO logos, ZERO UI. Pure background art.
```

---

### `garage-workshop-default-master` — Default 車庫舞台正式母檔

- **用途**：`/garage` 車輛舞台背景；GLB／ 藍圖與 HTML/CSS UI 由程式分層覆蓋
- **母檔**：`release-input/ui/themes/default/garage-workshop-default.png`（1920×1080 PNG）
- **runtime**：`public/assets/themes/default/assets/workshop-background-desktop.webp`
- **行動版**：不另出圖；共用中央安全構圖，以 `background-size: cover` 裁切兩側設備

```text
Cinematic 16:9 environment-only background for a browser Mini 4WD game garage.
This is a professional tabletop Mini 4WD tuning workshop, NOT a full-size car garage.

Camera: seated eye level, straight toward a precision tabletop workbench, moderate wide
lens, symmetrical perspective. Keep the central 55 percent visually quiet and empty for
a separately rendered 3D Mini 4WD vehicle. The lower 35 to 40 percent is a correctly
scaled rubberized tuning mat and compact display plinth for a roughly 15 cm model car.

Peripheral environment: small electric motors, guide rollers, bearings, AA batteries,
screw organizers, digital caliper, compact diagnostic instruments, modular Mini 4WD
track sections, shallow parts drawers and precision hand tools. Objects stay at the left
and right edges and may be cropped on narrow screens.

Track scale contract: if a track section is visible, use exactly two broad lanes. A single
lane is 115 mm wide while the vehicle is at most 105 mm wide, so one lane must read almost
as wide as the future vehicle. Course wall height is 50 mm, about 43 percent of lane width.
At comparable depth, one lane should be about 64 to 70 percent of the central plinth's
usable vehicle-length dimension. The curve radius must span several vehicle lengths. Keep
the module partly outside the far-right frame rather than compressing it into narrow rails.

Art direction: semi-realistic premium game environment, matte gunmetal and charcoal
steel, warm orange task lights, restrained cool-blue diagnostic glow, subtle wear, soft
cinematic depth, professional competitive hobbyist workshop. Central key light is soft
and neutral so a future PBR vehicle remains readable. Darker perimeter, detailed but not
cluttered.

Hard exclusions: no vehicle or vehicle silhouette, no full-size tires, no automobile
lift, no steering wheel, no road or city exit, no human, no mascot, no brand, no logo,
no readable text, no pseudo-text, no numbers, no UI, no button, no watermark.
```

**美術簽名**：工作墊外緣融合迷你四驅車工坊面板語彙的無刻度導引槽與接縫，讓場景第一眼即屬於 Mini 4WD，而不是泛用機械工作桌；**禁止數字、單位、等距刻度、比例值與尺規造型**，中央車位本身維持乾淨。

---

### `garage-workshop-moon-rabbit-master` — 月兔專業工坊正式母檔

- **用途**：`/garage` 正式永久中秋 Q 版主題；沿用 Default 的 GLB 相機與安全區
- **構圖參考**：只引用核准的 `garage-workshop-default-master.png` 相機、工作桌高度與中央空間，不複製個別道具 ／ 材質
- **母檔**：`release-input/ui/themes/moon-rabbit/garage-workshop-moon-rabbit.png`（1920×1080 PNG）
- **runtime**：`public/assets/themes/moon-rabbit-workshop-2026-97c954/assets/garage-background.webp`

```text
Using the supplied approved Default Mini 4WD workshop only as a composition and camera
reference, create a completely original 16:9 Moon Rabbit Festival version. Preserve the
same seated-eye-level camera, workbench height, empty central 55 percent vehicle safe
zone and correctly scaled Mini 4WD tuning mat. Do not copy individual props or textures.

Art direction: polished medium-chibi Japanese game environment, rounded readable forms,
deep indigo moonlit workshop, jade-green mechanical rim light and warm moon-gold task
lights. Equipment remains functional and correctly scaled: small motors, rollers,
batteries, screw trays, caliper, compact diagnostic instruments and Mini 4WD track
modules. A large original full moon or moon window sits toward the upper right without
entering the central vehicle silhouette. Add restrained paper lanterns, cloud curves,
moon phases, rabbit-ear geometry and mochi-making motifs around the periphery.

Track scale contract: any visible track section has exactly two broad lanes. One lane is
115 mm wide for a vehicle up to 105 mm wide, so a future car nearly fills the lane. Wall
height is 50 mm, about 43 percent of lane width. Match the approved Default track module's
lane width, wall height and vanishing point exactly; keep most of the curve outside the
far-right frame rather than turning it into decorative narrow channels.

The result must still feel like a credible professional tuning workshop, not a candy
room or nursery. Use soft toon shading and premium game-background finish. Side props
may crop on narrow screens; the table and central vehicle zone must survive center crop.

Hard exclusions: no vehicle or vehicle silhouette, no existing anime/game character,
no copied mascot, no full-size automotive object, no brand, no logo, no readable text,
no pseudo-text, no numbers, no UI, no button, no watermark.
```

**美術簽名**：同一組無刻度導引槽與調校台在月光下轉化成玉色機械紋與雲弧，右上月窗提供主題辨識；導引紋禁止數字、單位與等距刻度，中央仍保持安靜，避免 Q 版裝飾搶走 GLB。

---

## 1.2 Empty State 插畫

每個都是**透明背景 PNG**（@1x 512px + @2x 1024px），用於列表頁無內容時。

### `empty-garage` — 車庫空狀態

```text
A chunky cartoon 3D-animated-film-style empty wooden workbench with a small
question mark floating above, viewed at 3/4 angle. Warm wood texture
with rounded edges, toon-shaded, with a single cartoon screwdriver and a
spool of orange wire lying on top suggesting "ready for building".

Friendly, inviting, slightly humorous tone. NO car, NO finished part —
the message is "create your first vehicle here".

Color: warm wood tones (#a87b54, #d4a574), bold orange accent (#f97316)
on the wire, sky blue (#38bdf8) on the floating question mark.

CRITICAL — transparent background, ZERO text, ZERO labels. The
illustration must work on any warm-dark page background. Pure standalone
illustration centered in frame with small margin.
```

### `empty-rooms` — 房間空狀態（無玩家在線）

```text
A chunky cartoon 3D-animated-film-style empty starting grid line painted on
asphalt, viewed from low angle, with a single small sleeping cartoon
mascot character (a friendly round robot in racing helmet) sitting at
the start, suggesting "waiting for racers".

Color: warm grey asphalt (#3d3438), bright white starting line, bold
orange (#f97316) on the mascot's helmet, sky blue (#38bdf8) on the
mascot's body.

Style: chunky 3D-animated-film cartoon, toon-shaded, soft fillets, friendly humor.

CRITICAL — transparent background, ZERO text, ZERO labels.
```

### `empty-connection` — 離線 / 無連線

```text
A chunky cartoon 3D-animated-film-style stylized broken radio tower floating in
center frame, with a comically large yellow lightning bolt slashing
through it (suggesting signal lost). Friendly but clearly indicates
disconnect.

Color: warm grey tower (#3d3438), bold orange accents (#f97316), energy
yellow (#facc15) lightning bolt.

Style: chunky 3D-animated-film cartoon, toon-shaded, soft fillets.

CRITICAL — transparent background, ZERO text, ZERO labels.
```

---

## 1.3 Loading 插畫（動畫前提，用 Lottie 包裝）

> 若改走 Lottie，本節 PNG 可省。當前列 PNG 提示詞作為起點；確認需要動態旋轉再追加 Lottie JSON 規格。

### `loading-mascot-spin` — 中央載入吉祥物

```text
A single chunky cartoon 3D-animated-film-style round robot mascot character (friendly,
racing helmet, big expressive eyes) holding a tire above its head ready
to spin, mid-pose. Body in bold orange (#f97316), helmet sky blue
(#38bdf8), big toon-shaded chunky proportions.

Style: chunky candy-bright 3D-animated-film cartoon, exaggerated cute proportions,
toon-shaded, soft fillets, bouncy energy.

CRITICAL — transparent background, ZERO text. Single isolated character,
ready to be made into a spinning animation in code.
```

---

## 1.4 Achievement / Reward 美術

### `medal-gold` / `medal-silver` / `medal-bronze` — 比賽獎牌

> ⚠️ 可考慮改用 SVG 或 GLB，看最終是否需要動態旋轉 / 動態金額顯示。當前提示詞列 PNG 版本；若決定改格式請更新本節並重新跑提示詞。

```text
A single chunky cartoon 3D-animated-film-style {gold/silver/bronze} racing medal,
front-facing 3/4 view, big and bold with thick chunky proportions,
embossed cartoon car silhouette in center. Ribbon in bold orange
(#f97316) flowing diagonally behind. NOT photoreal — exaggerated cartoon
shading, soft AO, slight rim light.

Color (for gold variant): warm gold (#fbbf24) with deeper amber shadows;
silver: cool silver (#cbd5e1); bronze: warm copper (#c2580f).

CRITICAL — transparent background, ZERO text, ZERO numbers, ZERO logos.
Single isolated medal, centered, ready to use as a UI badge.
```

---

## 1.5 Particle Textures（給 Three.js / canvas 用）

小型 PNG（256×256），**透明背景** + **白色主體**（執行時 CSS / shader 染色）。

### `particle-spark` / `particle-smoke` / `particle-flare` / `particle-dust`

```text
A single isolated {spark / smoke puff / lens flare / dust cloud} on
pure transparent background. The shape is rendered as soft glowing
white-to-transparent radial gradient with cartoon-stylized edges (not
photoreal). Centered, 256×256 frame, with soft falloff to transparent at
the edges so it can tile / blend without visible seams.

For 'spark': sharp 4-point cross star with bright white core and longer
horizontal/vertical rays.

For 'smoke puff': irregular round soft cloud, internal value variation.

For 'lens flare': bright center, 6 radial rays, hexagonal lens artifact
overlay.

For 'dust cloud': flat oval irregular puff, lighter at top.

CRITICAL — transparent background, white shape only, ZERO color, ZERO
text. Will be tinted in code via CSS or shader.
```

---

## 1.6 Skybox HDR（環境貼圖，可選）

> 若 [ui-frontend.md §13](../../程式架構/ui-frontend.md) 背景策略 D 採用 Three.js skybox，這裡列 HDR 環境貼圖；codex 不擅出 HDR equirectangular，建議改用 PolyHaven CC0 素材，或請美術後製。

**本檔不列入提示詞，採 PolyHaven CC0 + 後處理。**

---

# 第二類：轉 SVG

## 2.1 Logo Wordmark

### `logo-open4wd` — 主 logo

```text
The wordmark logo "Open4WD" in chunky cartoon poster-style game-logo
typography. Letters are bold, slightly rounded, with strong outline and
inner gradient from bold orange (#f97316) at top to deeper warm orange
(#c2580f) at bottom. Letters slightly tilted forward (3-5 degree
italic) to suggest motion.

A small stylized speedometer needle icon replaces the "4" inside the
wordmark, hinting at the racing theme.

Style: arcade kart-racing game logo / candy-bright animated-film poster typography. Bold,
chunky, fun, but legible.

CRITICAL — pure black background, isolated white-bordered wordmark only.
NO other elements, NO background art, NO additional text. Will be
vector-traced to SVG.
```

> 轉 SVG 後，wordmark 的填色全部換成 `currentColor` 或 `var(--color-accent-speed)`，邊框換 `var(--color-text-primary)`，這樣主題切換可控。

---

## 2.2 Icon Set

### 2.2.1 共通 icon prompt 模板

```text
A single isolated cartoon-style icon depicting {icon-meaning}, rendered
as a chunky bold solid filled shape with thick rounded outline (4-6px
relative weight), candy-bright animated-film poster icon aesthetic. Composition
fills a square frame with small margin (10-15%).

Style: chunky, friendly, slightly bouncy, toon-shaded with single flat
fill color or 2-tone shading max. NO thin line-art, NO outline-only, NO
Material Design hairlines.

Use these conventions:
- Primary shape filled in solid black (#000000)
- Inner highlight if needed in solid white (#ffffff)
- NO color (will be re-colored in CSS via fill="currentColor")

CRITICAL — pure white background, single centered icon only, ZERO text,
ZERO labels, ZERO additional decorative elements. Will be vector-traced
to SVG and re-colored programmatically.
```

### 2.2.2 Icon 清單

代換上方模板的 `{icon-meaning}`，依下表批次生成。圖大小 1024×1024，後續轉 SVG 縮成 viewBox `0 0 24 24`。

#### 導覽類

| ID | icon-meaning（填入提示詞） |
|---|---|
| `nav-garage` | a chunky cartoon garage door, half open |
| `nav-tracks` | a chunky cartoon winding race track viewed from above |
| `nav-race` | a chunky cartoon checkered flag waving |
| `nav-room` | a chunky cartoon room door with a small "wait" hourglass beside |
| `nav-showcase` | a chunky cartoon car on a display pedestal |
| `nav-creator` | a chunky cartoon person silhouette wearing a racing cap |
| `nav-settings` | a chunky cartoon gear with thick teeth |
| `nav-help` | a chunky cartoon question mark inside a circle |

#### 操作類

| ID | icon-meaning |
|---|---|
| `action-upload` | a chunky cartoon up-arrow rising from a tray |
| `action-download` | a chunky cartoon down-arrow into a tray |
| `action-share` | a chunky cartoon three connected dots in a triangle |
| `action-copy` | a chunky cartoon two overlapping rectangles |
| `action-fork` | a chunky cartoon Y-shaped fork branching path |
| `action-like` | a chunky cartoon heart |
| `action-edit` | a chunky cartoon pencil at 45-degree angle |
| `action-delete` | a chunky cartoon trash bin |
| `action-search` | a chunky cartoon magnifying glass |
| `action-close` | a chunky cartoon X (two crossed thick bars) |
| `action-back` | a chunky cartoon left-pointing arrow |
| `action-menu` | a chunky cartoon three horizontal bars (hamburger) |

#### 數值 / 屬性類（出現在零件 / 車輛卡）

| ID | icon-meaning |
|---|---|
| `stat-mass` | a chunky cartoon dumbbell weight |
| `stat-friction` | a chunky cartoon textured surface with arrows |
| `stat-restitution` | a chunky cartoon bouncing ball arc |
| `stat-durability` | a chunky cartoon shield |
| `stat-energy` | a chunky cartoon lightning bolt |
| `stat-motor` | a chunky cartoon round motor body with shaft |
| `stat-battery` | a chunky cartoon AA battery upright |
| `stat-body` | a chunky cartoon car body shell silhouette from above |
| `stat-tire` | a chunky cartoon car tire viewed from front |
| `stat-roller` | a chunky cartoon small wheel with central axle |
| `stat-weapon` | a chunky cartoon star burst (suggesting weapon impact) |
| `stat-chip` | a chunky cartoon small rectangular chip with grid pattern |

#### 比賽 HUD 類

| ID | icon-meaning |
|---|---|
| `hud-lap` | a chunky cartoon circular arrow loop |
| `hud-speed` | a chunky cartoon speedometer needle pointing up-right |
| `hud-boost` | a chunky cartoon flame coming from car exhaust |
| `hud-pos` | a chunky cartoon trophy with "1" embossed |
| `hud-time` | a chunky cartoon stopwatch |
| `hud-finish-flag` | a chunky cartoon checkered flag |
| `hud-start-flag` | a chunky cartoon green-and-white start flag |
| `hud-waypoint` | a chunky cartoon downward map pin marker |
| `hud-kill-zone` | a chunky cartoon skull (cute, not scary) |
| `hud-respawn` | a chunky cartoon circular arrow with sparkle |

#### 經濟 / 狀態類

| ID | icon-meaning |
|---|---|
| `econ-coin` | a chunky cartoon round coin with embossed car silhouette |
| `econ-trophy` | a chunky cartoon trophy cup |
| `econ-rank-1` | a chunky cartoon gold medal with "1" |
| `econ-rank-2` | a chunky cartoon silver medal with "2" |
| `econ-rank-3` | a chunky cartoon bronze medal with "3" |
| `status-online` | a chunky cartoon filled circle with subtle glow |
| `status-offline` | a chunky cartoon hollow circle with diagonal slash |
| `status-busy` | a chunky cartoon clock with hands |
| `status-racing` | a chunky cartoon car icon with motion lines |
| `status-ai` | a chunky cartoon stylized brain or "AI" letterform |

#### 系統 / 通用

| ID | icon-meaning |
|---|---|
| `sys-sound-on` | a chunky cartoon speaker with waves |
| `sys-sound-off` | a chunky cartoon speaker with X slash |
| `sys-music-on` | a chunky cartoon eighth note with waves |
| `sys-music-off` | a chunky cartoon eighth note with X slash |
| `sys-info` | a chunky cartoon lowercase i inside a circle |
| `sys-warning` | a chunky cartoon exclamation mark inside a triangle |
| `sys-error` | a chunky cartoon X inside a circle |
| `sys-success` | a chunky cartoon check mark inside a circle |
| `sys-fullscreen` | a chunky cartoon four corner brackets |

### 2.2.3 Icon Sheet 批次出圖（風格一致性校準）

跑單 icon 前，先用一張「sheet 圖」校風格：

```text
A reference sheet of 12 chunky cartoon UI icons for a Mini 4WD racing
game, laid out in a 4-column 3-row grid on pure white background. Each
icon is a single isolated solid black shape (candy-bright animated-film poster
icon style) with thick rounded outline, no thin lines.

Icons depicted in this grid (left-to-right, top-to-bottom):
1. garage door (half open)
2. winding race track from above
3. checkered flag
4. settings gear
5. up-arrow on tray (upload)
6. heart (like)
7. magnifying glass (search)
8. trash bin (delete)
9. lightning bolt (energy)
10. car tire from front
11. trophy cup
12. checkmark in circle

Each icon fills its grid cell with small margin (10%). Consistent stroke
weight, consistent style, all solid black on white.

CRITICAL — pure white background, only the 12 icons, ZERO labels, ZERO
text, ZERO grid lines visible, just the icons floating in implicit grid
positions. This sheet will be visually reviewed for style consistency,
then individual icons will be re-generated using this sheet as style
reference.
```

> 用這張 sheet 確認風格 OK 後，逐個跑 [§2.2.1](#221-共通-icon-prompt-模板) 模板 + [§2.2.2](#222-icon-清單) 清單。

---

## 2.3 邊框 / 卡牌 Frame

### `frame-card-hex` — 六角卡牌邊框

```text
A single isolated decorative hexagonal card frame border in chunky
cartoon mecha-anime style, rendered as a thick solid black outline on
pure white background. The hexagon is wider than tall (3:4 aspect ratio
oriented like a portrait card). Outline weight is bold and confident,
with small cut-corner notches at each of 6 vertices (suggesting
mechanical paneling).

Decorative interior accents: 4 small diagonal corner brackets just
inside the outline (mecha L-shapes), but the central area is left
completely empty (where card content will live).

Style: chunky 3D-animated-film cartoon + anime mecha fusion, bold solid shapes.

CRITICAL — pure white background, single isolated frame outline, ZERO
fill in center, ZERO text, ZERO additional decorations. Frame will be
vector-traced and applied as a card border via CSS / SVG.
```

### `frame-card-soft` — 圓潤卡牌邊框

```text
A single isolated decorative soft-rounded rectangle card frame in chunky
cartoon 3D-animated-film style, rendered as a thick solid black outline on pure
white background. Aspect 3:4 portrait card. Corner radius is large (~8%
of width), giving a friendly bouncy feel.

Decorative interior accents: 2 small chunky stylized rivets at top-left
and bottom-right corners (small filled circles ~3% of width).

Style: chunky candy-bright 3D-animated-film cartoon, friendly, bouncy.

CRITICAL — pure white background, single isolated frame outline, ZERO
fill in center, ZERO text. Frame will be vector-traced.
```

### `frame-bracket-mecha` — 機甲 L 形角框（4 個一組）

```text
A reference sheet showing 4 mecha-anime style chunky L-shaped corner
brackets laid out as if framing the 4 corners of an implicit rectangle.
Each bracket is rendered as a thick solid black shape on pure white
background, with bold confident lines and small chunky inner notches
suggesting paneling.

Top-left bracket points down-right; top-right points down-left;
bottom-left points up-right; bottom-right points up-left.

Style: chunky 3D-animated-film cartoon + anime mecha fusion (mecha-anime cockpit UI energy), bold.

CRITICAL — pure white background, only the 4 brackets in their
respective corner positions, ZERO text, ZERO connecting lines, ZERO
center fill. Vector-traceable.
```

---

## 2.4 裝飾 Pattern（可平鋪 SVG）

### `pattern-speed-lines` — 速度線放射 pattern

```text
A radial pattern of stylized cartoon speed lines emanating from the
center of a square frame outward to the edges. Lines are thick at the
center end and taper to fine points at the edge, varying in length and
spacing (anime comic-book speed line style). Pure solid black on pure
white background.

Approximately 24-36 lines evenly distributed radially with slight
randomness in length to feel organic, NOT mechanical.

Style: anime hot-blooded racing manga speed lines (1990s racing anime
feel), bold and confident.

CRITICAL — pure white background, single isolated radial pattern, ZERO
text, ZERO additional elements. Pattern will be vector-traced and used
as SVG decoration / mask in CSS.
```

### `pattern-scan-line` — 掃描線（HUD 用）

```text
A horizontal scan-line pattern: 20-30 evenly-spaced thin horizontal
black lines across a wide square frame on pure white background. Lines
are uniformly thin (1px relative weight) with consistent spacing.
Suggesting CRT scanline / digital HUD overlay.

CRITICAL — pure white background, only the horizontal lines, ZERO text,
ZERO border. Pattern will be vector-traced for tiled HUD overlay.
```

### `pattern-grid-tech` — 科技格紋（背景 B 方案用）

```text
A subtle tech grid pattern: thin solid black grid lines forming a
regular square mesh across a square frame on pure white background.
Every 5th line is slightly thicker to suggest major / minor grid
hierarchy. Suggesting blueprint / engineering surface.

CRITICAL — pure white background, only the grid lines, ZERO text. Will
be vector-traced and used as a tilable CSS background pattern at low
opacity.
```

---

## 2.5 戲劇定格詞——圖形效果層（零文字）

對應 [ui-frontend.md §16](../../程式架構/ui-frontend.md) **圖檔禁字鐵則**：定格詞（READY／GO！／VICTORY…）的**文字** ＝C 類 i18n 字串、由執行期渲染（fallback 階梯 1–3）；本節只出**文字背後的圖形效果層**（fallback 階梯 4 的圖形資產）——爆光環 ／ 速度線 ／ 漫畫集中線 ／ 彩帶爆發等，**圖內零文字**。

### 2.5.1 共通提示詞模板（效果圖形）

```text
A single isolated cartoon burst effect graphic for a racing game
dramatic overlay: {EFFECT_DESC}. candy-bright animated-film / arcade-game
aesthetic, bold chunky shapes with thick rounded outlines, dramatic
celebratory energy. Colors: gradient from {FILL_TOP} to {FILL_BOTTOM}.

CRITICAL — pure white background, ZERO text, ZERO letters, ZERO numbers,
ZERO logos. Pure abstract graphic shapes only (burst rays, speed lines,
manga concentration lines, confetti, glow rings). A localized text will
be rendered on top of this graphic at runtime by the game engine.
Will be vector-traced to SVG.
```

### 2.5.2 定格詞場景與配色（文字層 CSS 漸層 token＋效果層共用）

| ID | 場景（文字＝i18n key） | `{FILL_TOP}` → `{FILL_BOTTOM}` | 效果圖形建議 |
|---|---|---|---|
| `fx-ready` | 比賽倒數前 | `#f97316` → `#c2580f`（橘）| 收束集中線 |
| `fx-go` | 比賽起跑 | `#84cc16` → `#65a30d`（綠）| 爆發光環＋速度線 |
| `fx-finish` | 比賽結束 | `#f97316` → `#dc2626`（橘紅）| 方格旗紋爆發（旗紋非文字）|
| `fx-boost` | 加速觸發 | `#38bdf8` → `#0284c7`（藍）| 後掠速度線 |
| `fx-ko` | 擊倒對手 | `#dc2626` → `#991b1b`（深紅）| 漫畫衝擊星爆 |
| `fx-victory` | 結算第一名 | `#fbbf24` → `#b45309`（金）| 金色光環＋彩帶 |
| `fx-defeat` | 結算非前三 | `#475569` → `#1e293b`（冷灰）| 下沉煙塵 |
| `fx-new-record` | 圈速 / 總時間刷新 | `#facc15` → `#f59e0b`（黃金）| 閃電形光帶 |
| `fx-combo` | 連續攻擊命中 | `#fb923c` → `#ea580c`（暖橘）| 連段火花 |
| `fx-perfect` | 滿分完賽 | `#fbbf24` → `#d97706`（金）| 全屏金粒子 |
| `fx-lap` | 圈次橫幅（「LAP」字樣＝i18n 執行期；圈數 n＝數字、可入圖或執行期）| `#38bdf8` → `#0284c7`（藍）| 輕量橫幅帶 |
| `fx-lap-final` | 最後一圈 | `#f97316` → `#dc2626`（橘紅）| 警示橫幅帶 |

### 2.5.3 出圖規格

- 1024×512 橫幅，純白背景（vtracer 轉 SVG 用）
- 一張圖一個效果，**勿合圖**
- 轉 SVG 後，主體 fill 改為 `currentColor` 或 `var(--color-accent-speed)` 之類 token，**讓主題可控**
- 效果圖形需預留中央水平文字帶（文字由執行期疊加、各語系長度不一，中央 60% 寬度保持低複雜度）

### 2.5.4 注意事項

- **任何字串（含英文）都不做含字圖檔**——定格詞文字走 [ui-frontend.md §16](../../程式架構/ui-frontend.md) C 類執行期渲染（web font＋CSS／SVG filter／Canvas 渲染），配色用本表漸層 token
- 數字 0–9 與中立符號（`!` `?` 等）允許入圖（如圈次數字），但優先執行期渲染以保持彈性

---

# 第三類：轉 GLB

## 3.1 環境 Stage

### `stage-garage` — 車庫工作檯場景

**用途**：`/garage` 主背景（背景策略 D）
**輸出 GLB**：≤ 30 MB（壓縮後），≤ 200k 三角形

```text
A chunky cartoon 3D-animated-film-style mechanic's workshop scene, isometric 3/4
view at 30-degree elevation. The scene is a small modular diorama:
wooden workbench at center (warm oak tone), a tool pegboard wall behind
with chunky cartoon hand tools hanging (wrench, hammer, screwdriver),
warm hanging incandescent light bulb illuminating from above-front, a
small radio on the corner of the workbench, scattered chunky cartoon
sparks or shavings on the workbench surface.

The workbench TOP IS EMPTY in the center — this is where a Mini 4WD
vehicle will sit (rendered separately by Three.js). The center area is
clear.

Style: chunky candy-bright 3D-animated-film cartoon, toon-shaded, soft fillets,
warm warm warm palette, NOT photoreal. Single isolated diorama on plain
light grey #f5f5f5 background.

CRITICAL — ZERO text, ZERO labels, ZERO logos, ZERO branding on tools,
ZERO additional vehicles. Pure environmental scene only. Will be
processed via Tripo3D into GLB.
```

### `stage-showroom` — 展示廳舞台

**用途**：車庫 ／ 結算的組裝車展示舞台（不是公開 vehicle UGC 頁）
**輸出 GLB**：≤ 30 MB，≤ 200k tri

```text
A chunky cartoon 3D-animated-film-style empty circular showroom stage / display
platform, viewed at 30-degree elevation 3/4 angle. The stage is a glossy
dark circular platform (~3 meter diameter equivalent) with a ring of
small chunky cartoon spotlights mounted on a curved overhead frame arc
above it, all pointing inward toward the stage center. The stage center
is EMPTY (where a vehicle will sit, rendered separately).

Background: dark warm-brown void / black, suggesting an enclosed showroom
space. NO walls visible, just the stage and overhead light rig.

Style: chunky 3D-animated-film cartoon, exaggerated proportions on the lights and
stage edges, toon-shaded, dramatic showroom lighting energy.

CRITICAL — ZERO text, ZERO logos, ZERO vehicles in the scene. Pure empty
stage rig. Will be processed via Tripo3D into GLB.
```

### `stage-workshop-clean` — 車間（編輯模式）

**用途**：`/garage/edit/:id` 主背景，中性明亮
**輸出 GLB**：≤ 25 MB，≤ 150k tri

```text
A chunky cartoon 3D-animated-film-style empty modular workshop floor: clean bright
modular tile floor in light warm grey, four small parking-bay marker
strips in bold orange paint forming a square footprint at center. A
small chunky cartoon parts rack stands to one side with empty slots.
Overhead a chunky cartoon LED panel light glows neutral cool white.

Composition: 30-degree elevation 3/4 view. The center parking footprint
is EMPTY (where the editable vehicle will sit). Background is bright
warm-neutral.

Style: chunky 3D-animated-film cartoon, friendly clean engineering space, toon-
shaded, NOT photoreal.

CRITICAL — ZERO text, ZERO labels, ZERO logos. Pure empty workshop
diorama. Will be processed via Tripo3D into GLB.
```

### `stage-arena-waiting` — 房間等待區

**用途**：`/room/:roomId` 主背景，輕量
**輸出 GLB**：≤ 20 MB，≤ 100k tri（極簡）

```text
A chunky cartoon 3D-animated-film-style starting-grid pit lane scene at sunset:
asphalt road foreground with bright white painted starting grid lines,
chunky cartoon grandstand silhouettes in the far distance, warm orange
sky horizon, large chunky cartoon "WAITING" banner arch overhead (NO
text on it, just a chunky arch shape).

Composition: 3/4 hero angle, low camera height. The starting grid in
foreground is EMPTY (where player avatars / car previews will appear).

Style: chunky 3D-animated-film cartoon, dramatic warm sunset, toon-shaded.

CRITICAL — ZERO text, ZERO labels, ZERO logos (including on the banner
arch). Pure empty environment. Will be processed via Tripo3D into GLB.
```

---

## 3.2 領獎台 / 演出

### `podium-result` — 結算領獎台

**用途**：`/result/:resultId` 點綴 3D 演出
**輸出 GLB**：≤ 20 MB

```text
A chunky cartoon 3D-animated-film-style three-tier racing podium standing alone on
a glossy dark stage floor, viewed at 3/4 hero angle 20-degree elevation.
The center tier is tallest (gold), left tier medium height (silver),
right tier shortest (bronze). Each tier has a bold colored top surface
matching its medal color. Behind the podium, a single tall chunky
cartoon banner arch (no text). Decorative chunky confetti bits frozen
mid-air around the scene.

Style: chunky 3D-animated-film cartoon, celebratory, slightly humorous, exaggerated
proportions, toon-shaded.

CRITICAL — ZERO text, ZERO labels, ZERO logos (including on banner arch
and podium tier tops). Just the empty podium. Three.js will composite
characters / cars on top. Will be processed via Tripo3D into GLB.
```

---

## 3.3 獎杯 / 代幣 / 獎章 3D

### `prop-trophy-cup` — 獎杯（顯示在排行榜 / 結算）

```text
A single isolated chunky cartoon 3D-animated-film-style golden racing trophy cup,
front-facing 3/4 view. Two big chunky handles on either side, wide
chunky bowl shape, sitting on a tall stylized base. Embossed cartoon
checkered flag emblem on the front of the cup (no text). Warm gold
color with deeper amber shadows, soft AO at contact points.

Style: chunky candy-bright 3D-animated-film cartoon, exaggerated bouncy proportions,
toon-shaded, NOT photoreal.

CRITICAL — pure plain light grey background #f5f5f5, single isolated
object, ZERO text, ZERO labels, ZERO branding, ZERO additional elements.
Will be processed via Tripo3D into GLB.
```

### `prop-coin` — 虛擬幣 3D 模型

```text
A single isolated chunky cartoon 3D-animated-film-style round metallic coin,
slightly thick (suggesting weight), embossed cartoon Mini 4WD car
silhouette on the front face. Warm gold edges with subtle copper inner
highlights. Resting at a slight 3/4 angle with edge partially visible.

Style: chunky candy-bright 3D-animated-film cartoon, friendly bouncy, toon-shaded.

CRITICAL — pure plain light grey background #f5f5f5, single isolated
object, ZERO text, ZERO numbers, ZERO logos on the coin face (only the
embossed car silhouette). Will be processed via Tripo3D into GLB.
```

### `prop-medal-gold` / `prop-medal-silver` / `prop-medal-bronze`

```text
A single isolated chunky cartoon 3D-animated-film-style {gold/silver/bronze}
hanging racing medal, front-facing slight 3/4 view, with a bold orange
ribbon attached at the top loop, the ribbon flowing slightly to one
side. The medal is a chunky thick disc with embossed cartoon car
silhouette on the front face (no text or number).

Color (per variant):
- gold: warm gold (#fbbf24) with amber shadows
- silver: cool silver (#cbd5e1) with grey shadows
- bronze: warm copper (#c2580f) with brown shadows

Style: chunky candy-bright 3D-animated-film cartoon, exaggerated bouncy.

CRITICAL — pure plain light grey background #f5f5f5, single isolated
medal, ZERO text, ZERO numbers, ZERO branding. Will be processed via
Tripo3D into GLB.
```

---

## 3.4 工具 / 道具 prop

### `prop-wrench` — 扳手（編輯零件圖示用 3D）

> 可選；若 [§2.2](#22-icon-set) icon SVG 已夠用則不需 GLB 版。**未納入本檔**，若實作後決定需要 3D 工具 prop 再追加提示詞。

---

## 3.5 Default 公開首頁完整 Hero key art

> 參考 [`參考雛形/定版/landing-default-v2.png`](../參考雛形/定版/landing-default-v2.png) 的相機、光線、材質與工坊辨識。公開首頁 `/` 的 runtime 只載入一張包含固定宣傳車的完整 Hero key art；不載入 GLB、不建立 Canvas／WebGL，也不讀取玩家車庫。文字、Logo、按鈕與公告仍由 DOM／SCSS 呈現。

### `landing-hero-desktop-v4`（目前 runtime 權威）

```text
Use case: stylized-concept
Asset type: complete opaque desktop public-landing Hero key art
Input images: Image 1 is landing-default-v2 and supplies only the approved camera direction, composition intent, professional Mini 4WD workshop identity, material density and orange/black lighting palette
Primary request: generate one completely new unified 16:9 Hero artwork; create the workshop, integrated mat/platform, original fixed promotional Mini 4WD car, foreground tools, contact shadow, reflections and environment lighting together in the same generation, not as composited layers
Composition/framing: reserve the left 30 to 34 percent as a dark DOM copy-safe zone; place the promotional car on the lower-right work mat at approximately 38 to 46 percent of full image width; preserve all wheels, bumpers and guide rollers
Lighting/mood: match the workshop's warm orange task lights, restrained cool fill, contact shadow and material reflections so the car is grounded on the mat
Constraints: one opaque image; no copied vehicle, no separate composited layer, no text, letter, number, logo, UI, button, card, race track, lane, guard wall, start gate, ruler, repeated tick, calibration grid, person, human-scale work area or watermark; the original car is fixed promotional art and must not imply player garage data
```

PNG master：`release-input/ui/themes/default/landing-hero-desktop-v4.png`；runtime 最佳化副本隨 default 主題供給（`public/assets/themes/default/assets/`，主 repo）。`landing-hero-desktop-v3` 因使用舊圖層合成而退件；以下兩節只保留為過程研究，不得由公開首頁 runtime 個別載入。

### 來源素材：`workshop-scene-desktop-v2`

> 2026-07-19 架構修正：工坊背景與靜態展示 ／ 維修平台必須在同一次生成中共用相機、消失點、尺度、接觸面與陰影；不得再拆成兩張圖後合成。

```text
Use case: stylized-concept
Asset type: no-vehicle desktop web-game hero scene base
Input images: Image 1 is a camera, lighting, material-density and workshop-identity reference only; it is not an edit target
Primary request: create one physically coherent scene base for a professional tabletop Mini 4WD pit workshop, with no vehicle and no UI
Scene/backdrop: enclosed miniature-parts display wall, dark tool cabinets, overhead work lights, powder-coated steel and restrained warm orange reflections; a broad dark-rubber and powder-coated-steel maintenance/display platform is physically attached to the workbench and occupies the lower-right foreground
Style/medium: cinematic industrial realism suitable for a shippable browser game, detailed physical depth rather than a dashboard illustration
Composition/framing: 16:9 wide close elevated three-quarter tabletop view, not an open room and not a full-size garage; reserve the left 34% as a dark readable copy-safe zone; reserve the right 66% as an empty vehicle-stage-safe zone on the integrated platform; the platform, cabinets and workbench share one camera height, vanishing point, physical scale, contact plane and shadows; continue believable workshop detail to every viewport edge
Lighting/mood: focused warm-orange bench lighting with subtle cool instrument fill; black areas retain visible material detail
Color palette: #0B0C0E, #15171A, #292C31, #F26422, restrained #3DB7E9
Constraints: no vehicle, no foreground tool tray, no separate floating platform, no room floor, no person, no character, no text, no letter, no number, no logo, no UI, no button, no card, no race track, no lane, no guard wall, no start gate, no ruler, no tick, no unit, no calibration grid, no watermark, no human-scale work area
```

### 已退件：`workshop-background-desktop` 與 `display-platform-desktop`

舊流程將空房間背景與透明平台分開生成，實測造成平台比例、深度、接觸面及消失點與背景不一致。兩個 prompt 僅保留於版本歷史，不得再用於產出、manifest 或 runtime。既有 `workshop-background-desktop.png` 保留作診斷證據，不覆寫。

### 來源素材：`foreground-tools-desktop-v2`

```text
Use case: background-extraction
Asset type: isolated transparent game-scene foreground integration layer
Input images: Image 1 is the approved visual reference; Image 2 is the approved workshop-scene-desktop-v2 and fixes camera perspective
Primary request: create only restrained foreground miniature pit tools, parts trays and workbench-edge fragments
Composition/framing: same 16:9 camera; objects appear only along lower-left, lower-right and far side edges; headline, CTA, complete vehicle body, exposed wheels, bumpers and guide rollers safe zones remain empty
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local removal
Constraints: background must be one uniform #00ff00 with no shadow, gradient, texture, reflection, floor plane or lighting variation; no #00ff00 in the subject; crisp complete silhouettes; no vehicle, person, character, text, logo, UI, race track, lane, guard wall, start gate, ruler, repeated tick, number, unit, calibration grid or watermark
```

---

# 附錄

## A. 與其他文件的關係

| 此檔的角色 | 對應文件 |
|---|---|
| 整頁示意圖 | [頁面概念圖.md](頁面概念圖.md) |
| 個別 UI 資產（本檔）| 自己 |
| 公版零件 3D 參考圖 | [零件參考圖.md](零件參考圖.md) |
| 公版場地 3D 參考圖 | [場地參考圖.md](場地參考圖.md) |
| UI 技術選型 | [ui-frontend.md](../../程式架構/ui-frontend.md) |
| 色票字級 | [../設計系統.md](../設計系統.md) |

## B. 手機版差異總表

| 資產 | 是否需要手機版 | 額外提示詞 |
|---|---|---|
| `login-bg` | ✅ | 「composition for portrait 9:16 ...」 |
| `splash-loading-bg` | ✅ | 同上 |
| Empty state 插畫 | ❌ | 透明 PNG 已是 square，CSS 縮放即可 |
| Loading 吉祥物 | ❌ | 同上 |
| Achievement 獎牌 | ❌ | 同上 |
| Particle 紋理 | ❌ | 256×256 統一 |
| Logo / Icon / Frame / Pattern | ❌ | SVG 向量 |
| Stage / Podium / Prop GLB | ❌ | Three.js 處理視角 |

## C. 擴充候選清單（未納入本檔範圍）

- 季節主題版本（聖誕 / 春節 / 夏日）的 `login-bg`、`splash-loading-bg`
- 觀賽模式 HUD 邊框（觀眾席角度）
- 教學 onboarding 插畫（4-5 張流程引導圖）
- Settings 八個正式分類各自的代表插畫（developer 分類由 build flag 額外開啟）
- /help 動態頁的章節 hero 圖
- 排行榜頭 1-3 名特殊光環 / 王冠 GLB
- Mascot 角色完整表情包（喜怒哀樂、勝利、失敗、思考）
- AI 玩家角色 GLB（區別於玩家車輛）

## D. 自我驗證（每張圖出來檢查）

1. **風格 OK？** 是否 3D 動畫電影卡通感？不是 photoreal、不是 minimalist line-art。
2. **背景乾淨？** 該透明 / 純白 / 純灰的有沒有混雜雜訊？
3. **零文字？** 圖內是否真的沒有文字、標籤、logo、品牌？（**無例外**——圖檔禁字鐵則，[ui-frontend.md §16](../../程式架構/ui-frontend.md)；數字 0–9 與中立符號允許）
4. **單一主體？** 是否一張圖只一個資產？
5. **可下游處理？** SVG 路徑可向量化、GLB 可被 Tripo3D 正確解讀。
6. **可染色？** SVG 主體是純黑或單色，沒有寫死的彩色填充（除 logo / 美術插畫 / [§2.5](#25-戲劇定格詞圖形效果層零文字) 漸層字）。
7. **手機版必要時是否分版？** 全螢幕 hero 類有出 9:16 嗎？

任何一項 fail → reroll prompt。
