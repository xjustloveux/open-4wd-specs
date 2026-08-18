---
type: impl
domain: ["前端主題"]
summary: 四語公告 scanner／generator／catalog／safe renderer
authority: null
slug: null
---
# announcements（靜態公告）

> **本檔角色**：[`公告系統.md`](../公告系統.md) 的程式實作層。對應
> `src/announcements/`、`src/pages/announcements-page/`、
> `src/pages/announcement-detail-page/` 與 `scripts/generate-announcements.mjs`。

## 1. 單一資料權威與生成物

作者只修改 `public/assets/announcements/<id>/` 與 `tags/*.json`。build 前 generator 驗證完整
來源，再產生：

| 生成物 | 消費者 | 限制 |
|---|---|---|
| `public/assets/announcements/index.json` | Browser／Service Worker | catalog digest、manifest projection、URL、資產 metadata |
| `src/announcements/generated/summary.ts` | Landing、Race Bench、列表、SEO | 只含標題／摘要／keywords／cover／manifest／asset inventory；不可靜態 import 正文 |
| `src/announcements/generated/content.ts` | SSR／SSG | 四語 allowlisted blocks；只由 server provider 載入，不進 browser module graph |

三個檔案皆為生成物，不手動編輯。正式來源可以完全沒有公告，此時仍生成合法空 catalog。
生成順序固定為 announcements → SEO → Angular build／PWA 注入；各 build compound 直接執行
generator。`check:announcements` 的 check mode 可供本機或 PR 額外比對 byte-identical 輸出，
目前工具鏈將它列為 local、不是既有 CI job；排序使用 Unicode code-point comparator，不受 OS
locale 或目錄列舉順序影響。

## 2. 模組分層

```text
authoring JSON/assets
  → Node scanner（schema／path／bytes／graph／budget）
  → generated summary + server content + browser index
  → AnnouncementCatalog（純 read/query）
  → Landing／Race Bench／List／Detail
  → SEO/SSG 與 PWA 使用相同 generated authority
```

- `schema.ts` 是 framework-independent content validator；問題帶精確 path/code。
- `AnnouncementCatalog` 只讀生成資料，malformed record 單則略過並留 recoverable issue；它提供
  `landing(locale, 3)`、`latest`、`raceBench`、`getById`、summary search、async content search 與
  `loadContent`。
- locale 正規化支援四個正式 locale；`zh-HK`／`zh-MO`／Hant fallback 至 `zh-TW`，Hans／SG
  fallback 至 `zh-CN`，其他 fallback `en`。
- Browser 的 detail／ 全文搜尋透過 `content-loader`，以 `document.baseURI` 解析單則、單語系、
  digest-versioned JSON URL；限制 HTTP 狀態、MIME 與 1 MiB raw bytes，先驗 SHA-256，再驗 locale
  與 schema。Browser module graph 不得 import `generated/content`，避免把歷史正文塞入 JS。
- SSR／SSG 由 `app.config.server.ts` 覆寫 loader token，改讀 build-time `generated/content`；兩端
  回傳同一 discriminated result，不把例外或原始錯誤訊息暴露給頁面。
- renderer 使用 Angular escaping 與窮舉 switch，不得使用 `innerHTML` 或
  `bypassSecurityTrust*`。圖片 ／ 附件必須以 announcement ID、原始 reference 與 generated
  metadata 精確配對後才輸出 URL。

## 3. 查詢語意

| Query | 回傳 |
|---|---|
| `landing(locale, 3)` | 全部有效 pinned，再加最新 3 則有效 unpinned，無重複 |
| `raceBench(locale)` | 有效 `important`／`critical`，pinned-first、時間倒序 |
| `search(locale, {tag, query})` | title／summary／keywords；只含有效 published |
| `searchIncludingContent(...)` | 上述再加 lazy content 純文字；不得把 HTML 當搜尋來源 |
| `getById`／`loadContent` | 依 ID 直接查歷史；`ready`／`unavailable`／`corrupt` 明確區分，允許 expired／retracted |

有效指 `status=published` 且尚未到 `expiresAt`。公告沒有 runtime 排程發布；來源只放已可公開
內容。排序 tie 以 ID code-point 決定，所有 clock-dependent 測試注入 `ANNOUNCEMENT_CLOCK`。

## 4. 路由與依賴邊界

- `/announcements` 與 `/announcements/:id` 是 public lazy routes，不要求 APP_DATA、身分解鎖或
  Ledger；使用 public shell，不能觸發玩家餘額讀取。
- 語系前綴 SSG 門牌與其他公開頁一致；browser snap-back 後保留同一無前綴 route。
- 公開首頁查詢失敗仍需保留 Hero 與主 CTA；Race Bench 提示是 compact/non-modal，不得推走
  主要比賽操作。
- 詳情頁擁有唯一 H1、發布 ／ 更新時間、tag、priority、撤回 ／ 取代狀態與返回列表操作；損壞
  ID、缺內容、離線未快取各有不同可理解狀態。

## 5. 快取邊界

公告 runtime cache 與一般 app shell cache 分開並有容量上限。URL 使用 locale／asset digest
versioning；catalog fetch/cache timestamp 另存，不能覆寫或假借 `publishedAt`。precache 只從
generated index metadata 推導 allowlist，非圖片附件與超預算資產永不加入。舊歷史頁讀取後
可進 runtime cache；撤回或修正後由新 digest URL 避免舊 bytes 冒充新內容。

Service Worker 對 install precache 與 runtime fetch 都先比對 URL 的 `v=sha256` 與 response raw
bytes；缺少、重複或不符 digest 一律不寫入 cache。首頁候選 cover 只有在 512 KiB 以下才
precache；runtime 圖片仍受單張 1.5 MiB 與公告專用容量 ／ 筆數上限約束。寫入 cache 時附上可信的
`X-Open4WD-Announcement-Cached-At` response header，頁面只在實際離線時顯示該時間。

## 6. 失敗策略

| 失敗 | 行為 |
|---|---|
| authoring/schema/path/MIME/budget/graph 錯誤 | generator 非零結束，禁止 build |
| 單筆 generated summary 損壞 | catalog 略過該筆並留 issue；Landing 繼續 |
| content/block/asset metadata 不匹配 | fail closed：不渲染該 block／下載連結 |
| 不安全 image link | 圖片本體經驗證後可顯示，但不包 anchor |
| 不安全 CTA | CTA 完全不輸出 |
| catalog 無此 ID | 顯示 missing，不假裝是網路問題 |
| 離線且詳情未快取／HTTP 暫時失敗 | 顯示 unavailable，不顯示假的空公告 |
| digest、MIME、locale 或 schema 不符 | 顯示 corrupt 並 fail closed |

## 7. 測試層

- Node：scanner、資產 bytes、generator deterministic、SEO/PWA 衍生清單。
- Angular：schema、catalog、safe link、renderer、list/detail、Landing/Race Bench、SEO metadata。
- Playwright：公開首頁 → 列表 → 篩選 ／ 搜尋 → 詳情 ／ 附件、Race Bench 高優先提示、撤回 ／
  取代、back/forward、離線 cache、keyboard、320 px、200% 字級。
- production isolation：正式 build 必須保持空 catalog 可用；任何非空 E2E announcement 只能
  由 test-only provider/fixture 注入，不能落入 public source 或 production module graph。
