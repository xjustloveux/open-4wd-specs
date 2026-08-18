---
type: impl
domain: ["前端主題"]
summary: ThemeService／token 套用／資產 fallback／themes:validate
authority: null
slug: null
---

# themes（主題系統實作）

> **本檔角色**：主題系統的**實作層** —— `ThemeService`、受控 stylesheet 原子切換、token 套用、資產 fallback 解析、SW 快取、`themes:validate` CI。
> 設計（模型 ／manifest schema／ 分類註冊表 ／ 鐵則 ／ 社群 PR）見 [../主題系統.md](../主題系統.md)。程式與治理 metadata 對應 `src/themes/`，可部署主題 payload 對應 `public/assets/themes/`。

## 1. ThemeService

```typescript
interface ThemeManifest {
  id: string;
  name: Record<LangCode, string>;
  category: string;
  styleApiVersion: 1; // 穩定 data-theme-part API 版本
  stylesheet?: string; // 主題內安全 .css 相對路徑；default 必填
  authors: string[];
  tokens: Record<string, string>; // CSS custom properties 覆蓋
  assets: Record<string, string | null>; // key → 主題內相對路徑；音訊槽可 null = 明確靜音（audio-system.md §3）
  fonts?: ThemeFontRoleDeclaration[]; // base／mono／display；受控 WOFF2 face，不接受 raw @font-face
  renderProfile?: VehicleRenderProfile; // 僅顯示層；省略／無效＝default PBR
}

interface ThemeFontRoleDeclaration {
  role: "base" | "mono" | "display";
  faces: {
    src: string;
    weight: number | string;
    style: "normal" | "italic";
    license: string;
  }[];
}

interface VehicleRenderProfile {
  version: number; // 正整數，只作顯示快取失效
  materialMode: "pbr" | "toon";
  toonSteps?: 2 | 3 | 4 | 5;
  outline?: {
    enabled: boolean;
    color: string;
    strength: number;
    thickness: number;
  };
  lighting: {
    ambientColor: string;
    ambientIntensity: number;
    keyColor: string;
    keyIntensity: number;
    rimColor?: string;
    rimIntensity?: number;
  };
  environment?: {
    backgroundColor?: string;
    fogColor?: string;
    fogNear?: number;
    fogFar?: number;
  };
  stage?: {
    groundColor?: string;
    surfaceColor?: string;
    raisedColor?: string;
    metalColor?: string;
    accentColor?: string;
    markerColor?: string;
  };
}

type ThemeFallbackReason = 'unknown-id' | 'retired' | 'load-failed' | null;

interface ThemeService {
  getCurrentTheme(): string; // themeId（settings.display.themeId）
  readonly fallbackReason: ThemeFallbackReason; // 最近一次原子套用的降級原因；成功後清為 null
  setTheme(id: string): Promise<boolean>; // 準備 default/overlay CSS → persist → 原子提交 CSS＋token＋snapshot；失敗不留下半套狀態（主題系統.md §8）
  resolveAsset(key: string): string | null; // 選中主題 → default fallback（回傳 URL；音訊槽可 null = 靜音）
  listThemes(): Promise<ThemeManifest[]>;
  listCategories(): Promise<{ id: string; i18nKey: string }[]>; // categories.json
}
```

## 2. stylesheet、cascade layer 與 token 套用

全域 cascade 順序固定為：

```css
@layer reset, base, components, theme-default, theme, safety;
```

- build 產物與共用 SCSS 放在 `base`／`components`；Default `theme.css` 由 runtime 包成 `@layer theme-default`；非 default overlay 包成 `@layer theme`；focus、觸控安全、reduced motion 與不可破壞的不變式住 `safety`。Default token 生成物固定進 `base`，頁面、元件與共用產品樣式固定進 `components`；`src/**/*.scss` 的 emitted author declaration 不得留在 layer 外，否則 unlayered author CSS 會依 cascade 規則壓過所有主題層。
- CI 以 `check:style-layers` 對完整 `src/**/*.scss` 做 PostCSS AST 掃描並 fail closed；Sass 變數不算 emitted declaration。確有必要的 unlayered 例外只能在 scanner 的集中名錄以單一精確 path 與非空理由登錄，禁止 glob、目錄級 ignore 或檔內註解自行豁免；現行名錄為空。
- `src/styles/garage-fidelity.scss` 仍是 `components` layer 的單一來源，但不併入初始 `styles`：build 前以 `generate:garage-fidelity` 移除 author-only Sass 註解並 fail closed 拒絕其他 Sass 語法，投影為根層 `garage-fidelity.css`。Garage component 依 `document.baseURI` 掛載同源 `<link>` 並在 destroy 移除；根層 CSS 由 precache injector 納入 install cache。`check:garage-fidelity` 防止投影漂移。
- runtime 另以 `@scope ([data-theme-root])` 限制 Default，以 `@scope ([data-theme-root][data-theme-id="<id>"])` 限制非 default；主題原始檔不自行處理 scope 或 id。
- `ThemeStylesheetPort.ensureDefault()` 先抓取、重寫相對 asset URL 並裝入 Default 基線；`prepareActive()` 在未啟用的 `<style data-o4-theme-stylesheet="candidate">` 中準備 overlay；只有最新 request generation 可在 persist 成功後 `commitActive()`。
- fetch、Style API、persist 或 request generation 任一步失敗時 discard candidate，既有 active CSS、token、snapshot 與 persisted id 不被半途覆寫。離線缺非 default stylesheet 時該 session 使用 Default，但保留原 persisted id，回線後可自癒。
- 非 default manifest 省略 `stylesheet` 是合法輕量主題：提交 `null` overlay，只使用 Default CSS＋ 該主題 token／ 資產。Default stylesheet 不得省略。
- `themes:validate` 以 `scripts/theme-css.mjs` 的 `THEME_PARTS` 對 `src/` production Angular HTML／TS 做雙向 emitter gate：literal `data-theme-part`、host metadata 與 literal `themePart` input 都必須已註冊，每個 registry part 也必須至少有一個 emitter。`.spec.ts`、fixtures、dist、generated 不計入；唯一現行動態 host 是 `O4PageHeading.themePart()`，只接受各 template 的型別化 literal input，其他動態來源必須先增加封閉映射。
- `prepareThemeFonts()` 只接受結構化 `fonts`，為每個 theme id＋role 產生全域唯一 family 與固定 `font-display: swap` 的 `@font-face`；作者的 `theme.css` 仍不得自行寫 `@font-face`。產生的 face CSS 位於同一 stylesheet node、但放在 `@scope`／cascade layer 外，因 font face 名稱本質上是全域資源。
- Default 的 face CSS 只存在 Default node；非 Default face 跟 active candidate 原子替換，切換時先啟用新 node 再移除舊 active node，避免 family 碰撞或殘留。字型下載／解碼不在主題提交的 await 鏈上，404 或壞檔由 CSS fallback 吸收，不讓主題失敗。

token 在 stylesheet candidate 準備完成後，與 stylesheet、active manifest、render profile snapshot 同一次提交：

```typescript
async function applyTokens(m: ThemeManifest): Promise<void> {
  const reserved = new Set(THEME_RESERVED_TOKENS); // 程式參數/ui.md §14
  for (const [k, v] of Object.entries({
    ...defaultTheme.tokens,
    ...m.tokens,
  })) {
    // 保留 token 恆取 default 值（CI 已擋覆蓋、此為 runtime 防禦）；與 build 生成的 :root 基準一致（ui-frontend.md §5）
    document.documentElement.style.setProperty(
      k,
      reserved.has(k) ? defaultTheme.tokens[k] : v,
    );
  }
}
```

runtime 另寫入私有 `--theme-font-base`／`--theme-font-mono`／`--theme-font-display`，再將既有
`--font-family-base`／`--font-family-mono`／`--o4-display-font` 指向它們。自帶 family 排在 Default
locale-aware stack 前；未提供角色、缺 glyph或載入失敗時沿 stack 回退，display 預設回到 base。

切換**即時且原子生效**（stylesheet commit＋CSS variables swap＋ 資產 URL 重解析 ＋snapshot observer；BGM＝ 當前槽重解析、異檔即 crossfade，[audio-system.md §4](audio-system.md)），不需 reload、不改路由或表單狀態。

**Three.js token 鏡像**：Three.js 不讀 CSS 變數 → `ThemeService` 維護 token 鏡像，`setTheme` 時同步 3D 場景參數（ambient / fog / lights、`o4-3d-stage` preset 重算）——[ui-frontend.md §14](ui-frontend.md)。

### 2.1 車輛渲染 profile

- runtime 先驗證整份 profile：`version` 正整數；Toon 階數 2–5；outline strength 0–5、thickness 0–4；ambient／key／rim intensity 0–4；顏色只收 `#RGB／#RRGGBB／#RRGGBBAA`；霧距非負且 far 大於 near；`stage` 的 `groundColor`、`surfaceColor`、`raisedColor`、`metalColor`、`accentColor`、`markerColor` 亦套相同顏色驗證。任何不合法值都整份換成 immutable `DEFAULT_RENDER_PROFILE`（PBR），不可留下半套狀態。
- profile 僅套在 `vehicle-showcase` 與 `race`；`assembly`／ 改裝編輯器固定 default 中性 PBR。主題切換直接替換材質 view、場景 profile 與 post-processing，重用原 scene、GLB cache 與 assembled vehicle，不重抓資產。
- `race` arena 另以本機程序 `RoomEnvironment → PMREM` 建立中性 image-based lighting，作為高金屬度 PBR 場地與車輛的最低可讀性基準。它只補環境反射，不改寫作者的 base color／metalness／roughness／貼圖，也不取代 profile 的 key／ambient／rim、霧或背景；換場景與 viewport 銷毀必須釋放 PMREM render target。建立失敗時保留既有燈光 fallback，不得阻斷比賽。
- OutlinePass 是可選增強；初始化或 render 失敗即永久降級該 pipeline 為 `renderer.render`，保留 PBR／Toon 主材質。
- `renderProfile` 不可進 gameplay、CID、loadout hash、簽章或版本六欄位協商。它只影響畫面與縮圖 key；縮圖 key 為 `canonicalVisualLoadoutHash:themeId:renderProfile.version:preset`。

## 3. 資產 fallback 解析

```typescript
const toUrl = (id: string, rel: string | null) =>
  rel === null ? null : `/assets/themes/${id}/${rel}`;

function resolveAsset(key: string): string | null {
  if (RESERVED_SFX_SLOTS.includes(key)) return toUrl("default", defaultTheme.assets[key]); // 保留 SFX 槽恆取 default（audio-system.md §3；default 空 = 靜音）
  const t = themes.get(currentThemeId);
  const v = t?.assets[key];
  if (v === null) return null; // 音訊槽明確靜音（null 蓋掉 default）
  if (v !== undefined) return toUrl(currentThemeId, v);
  return toUrl("default", defaultTheme.assets[key]); // 省略 → fallback default（名錄完備 CI 驗證；音訊值可 null → 靜音）
}
```

禁止跨主題引用；`themes:validate` 擋路徑越界（`../`）。

### 3.1 賽內倒數呈現

`RacePage` 將既有 `secondsLeft` 的 3／2／1／0 映射到
[主題系統 §5.4](../主題系統.md#54-賽內倒數與起跑視覺資產) 的字面資產槽；0 映射
`race-start`，不增加 wire 欄位。participant session 與 spectator adapter 共用同一個本機呈現
入口，事件先遞增 epoch 再掛載 `<img>`，因此相同數字在後續回合仍建立新節點並重播一次。

`MotionPreferenceService.effectiveReducedMotion` 是唯一動效判定；true 時直接解析 `*-static`。
一般模式的 error handler 依序切到主題靜態、default 動態與 default 靜態，耗盡才揭露既有文字
視覺。圖片 `aria-hidden` 且空 `alt`，固定 live region 另有 visually-hidden 真實文字。圖片處理
不回呼 race session、adapter、readiness 或 frame pump，也不 await `secondsLeft === 0`。

`scripts/themes-validate.mjs` 對八個槽檢查 RIFF/WebP 結構、VP8X alpha、512×512 畫布、動靜態
槽型態、2–18 幀、loop 1、總時長及 768／128 KiB 預算；禁字與閃光安全另由主題美術 review
依 [主題系統 §5.4](../主題系統.md#54-賽內倒數與起跑視覺資產) 驗收。

## 4. SW 快取

- `default/` manifest、stylesheet、一般資產、字型與 OFL 授權檔隨 fallback 骨幹列 install precache。
- 其他主題 = cache-first lazy：`setTheme` 時抓 manifest＋stylesheet＋ 資產進 cache；首載 bundle 不含非 default 主題。
- 升版失效 = 新版 `CACHE_NAME` 整組換新（[versioning.md §7](versioning.md)）。
- **升版後自癒**：activate 後首次啟動背景重跑 `setTheme(getCurrentTheme())`（在線即補滿快取）；離線資產缺 → 該 session 以 default 呈現、不改 persisted（[../主題系統.md §6](../主題系統.md)）。

## 5. `themes:validate`（CI）

檢查項權威見 [../主題系統.md §7](../主題系統.md)：**id 格式 `^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}$`＋ 總長 ≤ 40＋ 資料夾唯一 ＋ 未列 `retired-ids.json`**（[§5.2](../主題系統.md#52-id-命名與生命週期)；`default` 免尾碼例外）／Style API 版本 ／Default stylesheet 必填、其他主題可省略 ／stylesheet 路徑與存在性 ／PostCSS AST 檢查 stable part、內部 class、at-rule、`!important`、fixed 定位、安全 URL 與 custom property／ 分類存在於註冊表 ／default token·資產 key 完備（**程式碼引用集 ⊆ default**、其他主題 keys ⊆ default；**音訊 key 例外 ＝ 名錄必列、值可 `null`**）／`name.en` 必填 ／token 值禁 `url(`／ 音訊檔解碼煙測 ＋ 保留 SFX 槽供檔警告（audio-system.md [§6](audio-system.md#6-ci-檢核併入-themesvalidate主題系統md-7)）／結構化 fonts schema、同主題路徑、OFL 1.1、4 檔／512 KiB、WOFF2 header／table 結構與 Chromium `FontFace.load()` 解碼／manifest 引用檔案存在 ＋ 資料夾檔案全被引用 ／ 保留 token 未覆蓋 ／`THEME_SIZE_MAX_MB` 預算 ／ 路徑越界。

`scripts/theme-css.mjs` 是 Style API v1 stable part 名錄與 CSS validator 權威；加入 part 是共用 API 變更，必須經 PR review、測試與文件同步。Game Scene 的 `game-scene-decoration` 是完整 inset、`aria-hidden` 且不接收 pointer event 的大型外觀層；各主題可自行設計其構圖，共用契約不得強制固定角落 marker 或以逐頁 `display: none` 清單補洞。主題作者不得要求 `ThemeService` 新增主題 enum、在 Angular 模板判斷特定 theme id，或把主題專屬選擇器塞回共用 SCSS。

## 6. 跨模組對接

| 模組                                                              | 對接                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [settings.md](settings.md)                                        | `DisplaySettings.themeId`（顯示分類、即時生效）                                                                                                     |
| [i18n.md](i18n.md)                                                | 分類顯示名 `themes.category.<id>` dict                                                                                                              |
| [pwa-offline.md](pwa-offline.md) · [versioning.md](versioning.md) | SW 快取分路／升版失效                                                                                                                               |
| [ui-frontend.md](ui-frontend.md)        | cascade layers／stable theme part／token 命名慣例／build 生成 `:root` 基準（自 default manifest）／Three.js token 鏡像／`o4-3d-stage` preset 隨主題 |
| [ui.md §14](../程式參數/ui.md#14-uilayout版面與主題常數)                          | `THEME_RESERVED_TOKENS`／`THEME_SIZE_MAX_MB`／`THEME_FONT_MAX_FILES`／`THEME_FONT_MAX_BYTES`                                                        |
