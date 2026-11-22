---
type: impl
domain: ["前端主題"]
summary: head metadata／JSON-LD／sitemap／SSG／Lighthouse CI
authority: null
slug: null
---

# seo（SEO 實作）

> **本檔角色**：SEO 的**實作層** —— `<head>` metadata、`MetadataService`、JSON-LD 結構化資料、sitemap.xml、robots.txt、Angular SSG（prerender）、Lighthouse CI、域名遷移 redirect。
> SEO 設計（靜態 metadata / hreflang / OG 圖）見 [部署資訊.md §7](../部署資訊.md)；多語系 metadata 來源（`app.*` keys）見 [i18n.md](i18n.md) / [語系清單.md §2](../語系清單.md)。對應 `src/seo/`。

## 1. `<head>` Metadata

全頁通用 `<head>` 含：`<title>{pageTitle} — Open4WD`、`<meta description/keywords/author>`、`<link rel=canonical>`、**i18n hreflang**（zh-TW / zh-CN / en / ja + `x-default`=en）、Open Graph（og:type/title/description/image 1200×630/url/site_name/locale）、Twitter Card（summary_large_image）、theme-color（＝default 主題 `--color-bg-canvas`，權威 ＝ [主題系統.md](../主題系統.md) default manifest、`themes:validate` 守門同步）、Apple mobile meta、manifest、icons。

hreflang URL 對照見 [部署資訊.md §7.2 `HREFLANG_MAP`](../部署資訊.md)；OG 圖預設 `/assets/og/cover.jpg`（1200×630，[部署資訊.md §7.3](../部署資訊.md)）。

### 各頁 metadata 對照

| 路由                   | title                               | description                              | og:image                                |
| ---------------------- | ----------------------------------- | ---------------------------------------- | --------------------------------------- |
| `/`                    | Open4WD — Decentralized 4WD Racing  | i18n `app.description`                   | /assets/og/cover.jpg                    |
| `/announcements`       | i18n 公告列表標題                   | i18n 公告列表簡介                        | /assets/og/cover.jpg                    |
| `/announcements/:id`   | 該語系公告標題                      | 該語系摘要                               | 該公告 cover，否則 /assets/og/cover.jpg |
| `/login`               | Login — Open4WD                     | Sign in to start racing.                 | /assets/og/login.jpg                    |
| `/garage`              | Garage — Open4WD                    | Build your custom 4WD car.               | /assets/og/garage.jpg                   |
| `/ugc`                 | i18n UGC 展示廳標題                 | i18n UGC 展示廳簡介                      | /assets/og/cover.jpg                    |
| `/ugc/:cid`            | 依 kind 產生 Track／Part 標題       | 依 kind 產生作者與作品摘要               | {work.previewImage}                     |
| `/creator/:peerId`     | {creator.name} — Creator on Open4WD | {creator.bio}. {creator.numWorks} works. | {creator.avatar}                        |
| `/settings{/:section}` | i18n 設定標題                       | i18n 設定說明                            | /assets/og/cover.jpg                    |
| `/about` `/help`       | About / Help — Open4WD              | （靜態）                                 | /assets/og/{about,help}.jpg             |
| `/dmca`                | i18n DMCA 說明標題                  | Provider-scoped notice／counter 說明     | /assets/og/cover.jpg                    |
| `/dmca/transparency`   | i18n 透明度標題                     | Provider-scoped 聚合透明度說明           | /assets/og/cover.jpg                    |

> 表中路徑為**未前綴形**；實際收錄 URL = `HREFLANG_MAP` 的 `/<lang>/` 前綴形（[§6](#6-angular-ssgprerender) SSG 預渲染；router 前綴變體見 [../程式架構.md §13](../程式架構.md)）。

## 2. MetadataService

```typescript
interface PageMetadata {
  title: string;
  description: string;
  keywords?: string;
  ogImage: string;
  ogLocale: "zh_TW" | "zh_CN" | "en_US" | "ja_JP";
  canonicalURL: string;
  hreflangURLs: Record<string, string>;
  jsonLd?: object;
}

interface MetadataService {
  getMetadata(
    route: string,
    params?: Record<string, string>,
  ): Promise<PageMetadata>; // 讀 i18n app.* keys
  applyToHead(meta: PageMetadata): void;
}
```

## 3. JSON-LD 結構化資料

```typescript
@Injectable({ providedIn: "root" })
export class JsonLdInjector {
  constructor(@Inject(DOCUMENT) private doc: Document) {}
  apply(jsonLd: object): void {
    this.doc
      .querySelector('script[type="application/ld+json"][data-managed]')
      ?.remove();
    const s = this.doc.createElement("script");
    s.type = "application/ld+json";
    s.dataset.managed = "true";
    s.textContent = JSON.stringify(jsonLd);
    this.doc.head.appendChild(s);
  }
}
```

- **首頁** — `@graph`: `VideoGame`（name/genre/playMode/numberOfPlayers 1–8/license MIT（[../版權.md §11](../版權.md)）/isAccessibleForFree）+ `WebSite`（SearchAction）。
- **UGC 詳情** — 依載入結果的 kind 產生：track 為 `Game`、part 為 `CreativeWork`；兩者皆含
  `author: Person` 與 `isBasedOn` parent CID（若有 fork 血緣）。
- **創作者頁** — `Person`（`memberOf: Open4WD Community`）。
- **公告詳情** — `Article`（headline/description/datePublished/dateModified/inLanguage/image）；撤回頁
  的 title、description 與 JSON-LD headline 都要明確加上該語系「已撤回」標示。

## 4. sitemap.xml

- 首發主 sitemap：首頁（含 4 語系 `xhtml:link` alternate）+ 靜態頁 + 公告列表 ／ 所有可直接
  開啟的公告詳情。公告沿用四語 alternate；expired／retracted 歷史頁仍列入，retracted
  metadata 必須明確標示。
- URL > 50,000（hard limit）→ `sitemapindex` 拆 `sitemap-{static,ugc,creators}.xml`。
- 生成器＝`scripts/generate-seo.mjs`（robots.txt／sitemap／ssg-routes 三產物單腳本；來源＝
  `src/seo/seo-routes.json` 路由名錄、公告 build snapshot，以及 optional `ugcIndex` 接縫；
  `--check` 掛 CI 驗證產物一致）。缺少輸入時只產生靜態與公告路由，build 不連 provider、
  OrbitDB 或其他網路來源。
- 首發不產生 UGC／creator prerender。日後只有另案定義可採納 checkpoint、ranking／eligibility、
  簽章 snapshot、足量公開 UGC 與失敗／快取政策後，才能向 optional `ugcIndex` 提供凍結輸入；
  本次不擴張 pinning API。

## 5. robots.txt

```text
User-agent: *
Allow: /
Disallow: /race/        # 賽中不收錄
Disallow: /home
Disallow: /settings/
Disallow: /api/
Sitemap: {CANONICAL_BASE_URL}/sitemap.xml   # build 注入；現行正式值 = https://open4wd.org

# AI 爬蟲（GPTBot、ClaudeBot 等）不另立群組：依社群決定放行，即與一般爬蟲同一組規則。
User-agent: AhrefsBot   # 商業 SEO 工具：限速，但路由排除照舊
Crawl-delay: 10
Allow: /
Disallow: /race/
Disallow: /home
Disallow: /settings/
Disallow: /api/
```

**群組不繼承**：爬蟲只採用最明確符合的**單一**群組，其餘群組完全不套用。因此具名群組必須逐字
複述上面四條 `Disallow`，否則替某支爬蟲開一個群組，效果會是讓它繞過路由排除——與「依社群決定」
的放行意圖相反。只想給予與一般爬蟲相同待遇時，正確作法是**不開群組**，讓它落到 `*`。

## 6. Angular SSG（prerender）

```jsonc
"prerender": {
  "discoverRoutes": false,
  "routesFile": "ssg-routes.txt"
}
```

`angular.json` 不另列手工 `routes`；`ssg-routes.txt` 由 `scripts/generate-seo.mjs` 動態生成
（[§4](#4-sitemapxml) 同一腳本）：未前綴 public shell（`/`、`/about`、`/help`）+
4 語系 ×（靜態 indexable 頁 + 公告列表／詳情）→ `/<lang>/...` 路由。Prerender 讀取 server
announcement content provider，不經 browser fetch，也不把正文打入 browser JS。`/login` 為
`noindex`，不在 SSG route 清單。Optional `ugcIndex` 接縫保留但首發不提供輸入，因此不生成
`/ugc/:cid` 或 `/creator/:peerId` prerender；一般 client-side route 仍可由玩家直接開啟。

## 7. Lighthouse CI

主 repo `.lighthouserc.json` 是 URL、執行次數、分數、Web Vitals 值與 warn／error 分級的唯一
可執行權威；本檔不複製數字。GitHub Actions `lighthouse.yml` 在 PR 執行：accessibility 與 SEO
採 error blocker，performance、best-practices、LCP 與 CLS 先採 warn 收集固定環境 baseline。
進入 `release_candidate` 時，維護者須依同一固定環境 baseline 核准並在
`.lighthouserc.json` 將選定門檻升格為 release blocker；門檻異動不得只改文件。

## 8. 域名遷移 redirect

遷移程序權威見 [部署資訊.md §8](../部署資訊.md)。**正向不需自建 redirect**——GH Pages 設 custom domain 後 github.io 自動 301（path-preserving）。meta refresh 僅**反向 / 棄用**情境備援：

```html
<!-- 反向（萬一棄用 custom domain，舊位置續租 1–2 年）：open4wd.org → xjustloveux.github.io/open-4wd/ -->
<meta
  http-equiv="refresh"
  content="0; url=https://xjustloveux.github.io/open-4wd/"
/>
<link rel="canonical" href="https://xjustloveux.github.io/open-4wd/" />
```

或在 Cloudflare 設 301 redirect rule。

## 9. 目標基準

| 指標                   | 目標             | 量測                    |
| ---------------------- | ---------------- | ----------------------- |
| 靜態 indexable 路由    | manifest 全數收錄 | 生成器 contract test    |
| LCP／CLS 與四分類分數  | 依 executable config | Lighthouse CI        |
| 4 語系 hreflang 正確率 | 100%              | Search Console + manual |
| 結構化資料頁比率       | > 80%             | Rich Results Test       |
| sitemap.xml            | 每次相關 build 決定性生成 | `check:seo`       |

## 10. 跨模組對接

| 模組                                | 對接                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| `i18n/`（[i18n.md](i18n.md)）       | `app.*` keys → title / description / OG / hreflang                    |
| `pwa-offline/`                      | manifest / theme-color / icons                                        |
| optional `ugcIndex` 接縫             | 首發無輸入；日後只接受另案定義並驗證的凍結 snapshot                   |
| `system-constants`                  | 域名 / OG 路徑 / hreflang 常數（見 [部署資訊.md §7](../部署資訊.md)） |
