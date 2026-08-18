---
type: impl
domain: ["前端主題"]
summary: PWA manifest／SW 快取分路／離線 UI／UGC 快取 LRU
authority: null
slug: null
---

# pwa-offline（PWA / 離線快取實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/pwa-offline.md](程式流程/pwa-offline.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：PWA 與離線能力的**實作層** —— manifest、Service Worker 快取分路、線上偵測 / 離線 UI、IndexedDB schema、持久化儲存、容量警示、UGC 本地快取 LRU（Helia GC）。
> SW 快取策略總表見 [部署資訊.md §6.2](../部署資訊.md)；升版整合見 [版本規範.md §8](../版本規範.md) · [流程/升版.md §5](../流程/升版.md)；多語系 manifest 文案見 [語系清單.md §2](../語系清單.md)。對應 `src/pwa-offline/`。

## App Shell runtime 狀態與能力

連線狀態不是 `online/offline` 布林值，而是 `src/bootstrap/runtime-state.ts` 的五態
`locked | launching | local-ready | reconnecting | online-ready`。合法轉移固定如下；不在表內的
轉移一律拒絕，舊 generation 的晚到結果也不得改寫新狀態：

| 目前狀態 | 可轉移至 |
|---|---|
| `locked` | `launching` |
| `launching` | `locked`、`local-ready`、`online-ready` |
| `local-ready` | `locked`、`reconnecting` |
| `reconnecting` | `locked`、`local-ready`、`online-ready` |
| `online-ready` | `locked`、`local-ready`、`reconnecting` |

UI 不得從狀態名稱或 `navigator.onLine` 猜功能；只讀同一 snapshot 的能力 flags。固定能力名為
`identity`、`onboarding`、`localGarageRead`、`localGarageWrite`、`localAssetRead`、
`localAssetWrite`、`localUgcEdit`、`glbImport`、`glbExport`、`localRace`、`ledgerRead`、
`ledgerWrite`、`ugcPublish`、`ugcFork`、`slotUnlock`、`matchmaking`、`room`、`chat`、
`spectator`、`turnRelay`、`rating`、`moderation`、`arbitration`。`capabilitiesFor` 直接由 phase 與
service availability 推導：`identity` 始終為 true；`locked` 的其他能力全為 false；`launching`、
`local-ready`、`reconnecting` 開啟 onboarding 與本機能力；`online-ready` 再依 peer mesh、WSS／
Gossip signaling、room discovery 與 TURN availability 開啟遠端能力。任何缺欄、未知狀態或
service health 不明都 fail closed。型別見 [interfaces.md](interfaces.md)，流程圖見
[程式流程/pwa-offline.md](程式流程/pwa-offline.md)。

## 1. PWA Manifest（四語系）

四語系各產一份 `manifest.{lang}.json`（zh-TW / zh-CN / en / ja），`<head>` 以相對於 `document.baseURI` 的 URL 載入。`name` / `short_name` 跨語系統一保留品牌；`description` 用 i18n `app.tagline` + 「平台 / Platform」。

```json
{
  "name": "Open4WD: Decentralized 4WD Racing",
  "short_name": "Open4WD",
  "description": "去中心化四驅競速平台",
  "start_url": "./",
  "display": "standalone",
  "orientation": "any",
  "theme_color": "#0B0C0E",
  "background_color": "#0B0C0E",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "icons/maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ],
  "categories": ["games", "entertainment"],
  "lang": "zh-TW",
  "dir": "ltr"
}
```

Custom-domain production profile 的 base 是 origin root `/`；`/open-4wd/` 是獨立的 GitHub Pages
preview profile。兩者都在所有注入完成後產生與各自最終 `index.html` byte-identical 的 `404.html`
作 SPA deep-link fallback。SW scope、precache、`version.json`、reset 與 builtin URL 全從
registration／document base 推導，不硬編任一 profile。E2E 必分別從 root production 與
`/open-4wd/` preview 直接進深層路由並 reload；只通過其中一種不算完成。

> `theme_color` / `background_color` ＝ default 主題 `--color-bg-canvas`（權威 ＝ [主題系統.md](../主題系統.md) default manifest；`themes:validate` 守門 `index.html` theme-color 同步）。

| lang  | description                           |
| ----- | ------------------------------------- |
| zh-TW | 去中心化四驅競速平台                  |
| zh-CN | 去中心化四驱竞速平台                  |
| en    | Decentralized 4WD Racing Platform     |
| ja    | 分散型 4WD レーシングプラットフォーム |

## 2. Service Worker 快取分路

快取分路對齊 [部署資訊.md §6.2](../部署資訊.md) 策略總表：

| 資源                                                             | 策略                                                                                         |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 導航 / HTML（`/`、`index.html`）                                 | **Network-first**，離線 fallback cache（再退 `index.html` 殼）                               |
| JS / CSS（hash 檔名；含四語系字典 chunk 與 Rapier WASM 內嵌 JS） | Cache-first ＋ **install 全量 precache**（build 後掃 dist 注入清單——首次安裝後可離線開 app） |
| 字型 / icon / OG 靜態圖 / vendor 解碼器（draco 等）              | Cache-first（runtime 首用即快取）                                                            |
| `/api/*`、`/version.json`、`/reset/` 子樹                        | **Network-only bypass**（連 cache 都不查——逃生口與升版檢查前提）                             |
| `/help/*`、`*.md`                                                | Stale-while-revalidate                                                                       |
| 跨源（signaling / TURN / IPFS gateway）                          | 不經 SW                                                                                      |
| IPFS GLB（CID）                                                  | 不走 SW 快取，由 Helia 管理（見 [§6](#6-ugc-本地快取-lruhelia-gc)）                          |
| 公告 index／tag registry                                         | 隨 shell precache；依生成 digest 更新                                                        |
| 公告語系 JSON／圖片                                              | 公告專用 bounded cache；URL digest 與 response SHA-256 相符才可寫入                          |
| 公告附件                                                         | 非圖片不 precache、不因開頁自動下載；玩家明確開啟時走一般網路回應                            |

Precache 清單雙層：SW 源檔只列穩定檔名（`/`、`index.html`、manifest×4、favicon），`inject-precache`（build 後、`scripts/`）掃 dist 根改寫為全量（hash 檔名 JS/CSS＋icons；決定性排序 ＝SW byte 穩定不誤觸升版偵測）。此外，腳本讀取**已通過驗證的 default theme manifest**，把其 `theme.json` 與所有非 null runtime 資產加入 install-time precache；其他主題不加入，維持選用後 cache-first lazy。manifest 路徑必須留在該主題目錄內，路徑穿越直接使 build gate 失敗。install 走**逐資產** `cache.add(...).catch()`（`addAll` 為原子——任一缺席整批全滅）；`cache.put` 僅收 `status === 200`（206 partial 進 Cache API 必 throw）且寫入 best-effort。四語系字典 ＝ 動態 import 隨 bundle chunk（precache 全 JS 涵蓋、無獨立 `/assets/i18n/`）。

`CLIENT_VERSION` 與 `BUILTIN_ASSETS_VERSION` 由 `generate:pwa` 注入，主快取名稱為
`open4wd-${CLIENT_VERSION}-assets-${BUILTIN_ASSETS_VERSION}`（`check:pwa` 守門一致）。activate 只清
`open4wd-` namespace 下的非 active cache，再執行 `clients.claim()`；同 origin foreign cache、
IndexedDB 與 localStorage 都不動。install 不 `skipWaiting`——`SKIP_WAITING` 訊息由 UI 層過 idle
guard 後觸發。

`networkFirst`：先 fetch，成功更新快取並回傳，失敗回 cache（導航再退 `index.html` 殼）。`cacheFirst`：命中即回，否則 fetch 並快取。`staleWhileRevalidate`：回快取同時背景更新。三者離線最終 fallback `503 Offline`。導航 / HTML 走 `networkFirst` 配合 SW 升版檢查（[版本規範.md §8](../版本規範.md)）即時拉新 shell。

公告另有專用快取：install 只預載最新候選公告的四語 JSON 與 512 KiB 以下 cover；runtime
最多保留固定筆數。Service Worker 必從 URL 讀取唯一 `v=sha256`，對 response raw bytes 計算
SHA-256，驗證成功才 `cache.put`；缺少、重複或 mismatch 皆回應但不快取。成功寫入時附加
`X-Open4WD-Announcement-Cached-At` header，詳情頁只在實際離線時顯示；不得用公告發布時間代替。

## 3. 線上偵測

```typescript
class OnlineStatusService {
  private isOnlineSubject = new BehaviorSubject(navigator.onLine);
  online$ = this.isOnlineSubject.asObservable();
  constructor() {
    window.addEventListener("online", () => this.isOnlineSubject.next(true));
    window.addEventListener("offline", () => this.isOnlineSubject.next(false));
  }
  /** 主動 ping 確認真連得上（onLine=true 只代表有網卡） */
  async verifyConnectivity(): Promise<boolean> {
    if (!navigator.onLine) return false;
    // ping 目標＝/version.json（SW network-only bypass、同源必在——靜態部署無 /api）
    try {
      await fetch("/version.json", {
        method: "HEAD",
        cache: "no-cache",
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch {
      return false;
    }
  }
}
```

## 4. 離線狀態 UI

- **`OfflineBannerComponent`**：離線 ＝「離線模式 / 僅本地功能可用」常駐橫幅；恢復連線 ＝「連線已恢復」短暫提示後收（常駐 live region 容器內切換內容——SR 對動態插入節點播報不穩）。
- **`RequireOnlineDirective`（`[o4RequireOnline]`）**：離線時加 `.offline-disabled` 灰化 ＋`aria-disabled`＋**capture 相位**攔截 click（掛在元件宿主上也擋得住內層 button 發射）＋toast「離線無法使用此功能」。套在需連線的操作（配對三鈕、UGC 評分、上鏈等）。

## 5. IndexedDB（原生 `indexedDB.open`）

統一 DB `open-4wd`（**原生 `indexedDB.open`、零套件**；`openUnifiedDb` 工廠、onblocked 顯式回報不卡死），**單一 upgrade 集中建 12 stores**：

```typescript
// openUnifiedDb（src/pwa-offline/idb.ts）：indexedDB.open(UNIFIED_DB_NAME='open-4wd', UNIFIED_DB_VERSION=1)
// onupgradeneeded 依 UNIFIED_DB_STORES 名錄補建缺席 stores：
db.createObjectStore("local-parts", { keyPath: "id" });
db.createObjectStore("local-tracks", { keyPath: "id" });
db.createObjectStore("settings", { keyPath: "key" });
db.createObjectStore("cached-ugc-thumbnails", { keyPath: "cid" });
db.createObjectStore("ugc-cache-meta", { keyPath: "cid" }); // §6 LRU
db.createObjectStore("recent-teammates", { keyPath: "peerId" }); // 近 50 隊友 FIFO（chat-system.md）
db.createObjectStore("blocklist", { keyPath: "peerId" }); // 個人封鎖清單（賽內機制.md §1.7；永不上鏈）
db.createObjectStore("composed-vehicle-thumbnails", { keyPath: "cacheKey" });
db.createObjectStore("ledger-admission-outbox", { keyPath: "cid" }); // 完整 sealed final entry
db.createObjectStore("physics-manifest-receipts", { keyPath: "key" }); // 已驗 manifest receipt
db.createObjectStore("inbox-snapshots", { keyPath: "id" }); // provider signed envelope 快照
db.createObjectStore("inbox-read-markers", { keyPath: "id" }); // 本機已讀標記
```

加密金鑰**不在統一 DB**＝ 獨立 `open4wd-keys`（[key-manager.md §5](key-manager.md) 權威——鎖定生命週期與安全隔離、不與大流量 store 同域）。**單一 upgrade 集中建全部 stores**（`openUnifiedDb` 工廠、`src/pwa-offline/`）——分散各模組自建 ＝ 版本競合（無版本 open 不觸發 upgrade、缺 store 直接 throw）；各模組經工廠取連線、**用畢即 close**（長持連線擋版本升級）。所有 readwrite 操作必等 `transaction.oncomplete` 才回報成功；`request.onsuccess` 後 transaction 仍可能因 quota／abort 回滾。共用 helper 同時監聽 `onerror`／`onabort`，UI signal 只能在 durable commit 後更新。

玩家收藏不新增 unified DB object store；它使用 `open4wd-keys` 的 sealed identity container
`favorites` domain，避免未解鎖時洩漏社交偏好，詳見 [player-favorites.md](player-favorites.md)。

`ledger-admission-outbox` 每列是 exact closed record：`cid / identity / entryBytes / parentHashes / createdAt / byteSize / state / broadcastAttempted / rejectionCode`。`entryBytes` 是已含頂層 proof、準備公開的 canonical final Orbit block，不是裸 event；不含私鑰。每次讀寫都重驗 record、entry bytes、CID、identity、parents 與 byte size；同 CID 唯一，上限 32 筆或 2 MiB，損毀 fail-closed。重啟先由 outbox 恢復 parent protection，再允許 checkpoint eviction；retry 只交回同一組 bytes／CID，不得重新 `db.add`。

schema version 為 `UNIFIED_DB_VERSION=1`，新建資料庫必須包含完整 12-store 名錄。程式不得自動 `deleteDatabase` 或靜默清資料；缺少必要 store 時 fail closed 並要求使用產品內明示的重設流程。`local-parts` 只存非 track 的本機測試資產；組裝車輛 loadout 的唯一權威是目前 profile 中 `open4wd-keys` 的 sealed `garage-loadouts` identity domain。pre-launch 期間若本機 schema 不相容，使用產品內明示重設，不匯入舊資料。

**持久化**：onboarding 階段 `navigator.storage.persist()` 請求 persistent storage（防瀏覽器靜默清除）。UGC 本機分享保留新選擇 `standard`／`generous` 也必須確認 `navigator.storage.persisted() === true`；請求失敗或 API 不可用時不保存這次選擇。已載入的非 `off` 偏好可保持保存，但 persistence 未確認時額外 retention 休眠並顯示 `storage-not-persistent`。公開設定頁可顯示 raw usage，但 pre-runtime quota check 不得依舊固定 0.70 門檻發出貢獻警告；貢獻感知的清理與警告只屬已安裝 LRU authority 的 app runtime。

## 6. UGC 本地快取 LRU（Helia GC）

玩過的 UGC GLB 會在本地 Helia 累積 pin（GLB 大小上限見 [零件與共用介面.md §7.2](../建模參數/零件與共用介面.md#72-場地約束)，單件雖有上限但長期累積可達 0.5–1GB），配合 ledger 本地保留（[ledger.md § 客戶端 Storage](ledger.md)），無 LRU 則約 2–3 年觸 quota 上限被靜默清掉。LRU 只自管「哪些 CID 保留 pin / 何時 unpin」，實際 block 移除交給 Helia 原生 `helia.gc()`（reference-counting GC）+ `helia.pins.add/rm`。

### Shell-lifetime storage authority

支援 IndexedDB 的 production browser 由 `AppShell` single-flight 建立一個
`BrowserUgcCacheAuthority`，生命週期不依賴登入或 physical connectivity。它只啟動無 libp2p／
Bitswap 的 `createHeliaLight`，一次開啟 Ledger content blockstore 與 pin datastore，擁有唯一
`UgcCacheLruService` 與 locked local CID reader；offline／未登入初始化不得發出網路請求。公開
settings 保存 `ugcContribution` 仍是純資料 action，永遠不建立或重試 authority。

authenticated online generation 各自擁有 libp2p／Bitswap Helia、Orbit entry store 與 transport，
但只以 non-owning adapter 借用 authority 的同一 blockstore／datastore／pin identity。borrowed
adapter 沒有 owning `open`／`close`／`start`／`stop`；generation stop、logout、disconnect、reset
與 reconnect 不關閉 content storage、pin state、local CID reader 或 LRU，新 generation 繼續借用
同一 authority。

authority 的 borrowed Ledger surface 對讀取轉送，並讓所有 block／pin mutation、streamed／batched
mutation 與 datastore `batch().commit()` 取得同名 origin-exclusive Web Lock；介面完整涵蓋
`putMany`、`deleteMany`、`getMany`、`getAll`、`query` 與 `queryKeys`。online Helia 自己的
generation-local lock 不取代此 boundary，只有 authority 可執行 GC。LRU 的 internal pin／GC
surface 已持有同一 non-reentrant origin lock 時不得重取；跨 tab 也以相同 Web Lock name 序列化。

authority creation failure 保留 local UI，但 pressure fail-closed，且 online Ledger/cache 不得另開
direct-IDB owner；非 `off` 顯示 `runtime-not-started`，`off` 仍為 `inactive`。settings／status refresh
不 retry，只有明示 online shell lifecycle 可重試。final disposal 先阻止新 race session，於 generation
provider 尚有效時 abort／drain tracked race lease，再清 online app／generation 與 in-flight work；
之後 detach callback、`lru.shutdown()`，最後 close-once authority／IndexedDB handle。每步失敗仍
繼續後續 cleanup，最後依確定順序丟出原 error 或 `AggregateError`；disposal-won initialization 的
late close failure 也納入同一彙整。

### Pin 分類（保留優先級）

| 類別                                           | 規則                                                                              | unpin 時機                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `builtin:*` 公版資產                           | **隨版靜態檔＋SW cache-first**（非 Helia pin、不入 LRU 記帳；離線效果等價永 pin） | —（隨版本快取汰換）                                            |
| 玩家自己上傳的 UGC                             | 永 pin；active takedown 時移除 `mine` 永久來源                                    | 玩家明確刪除，或 takedown 後依 LRU 自然衰減                    |
| 身份資產庫中的 UGC                             | 永 pin；`library` 與其他 ownership 獨立                                            | 最後一個身份移除入庫，或身份成功刪除後                         |
| 當前 loadout 引用的 UGC（`carRotation`、N 台） | 永 pin；active takedown 時移除 `loadout` 永久來源                                 | 切換 loadout 或 takedown 後降「最近使用」                      |
| 當前房間他人 loadout UGC                       | 永 pin（**race lock**）                                                           | 比賽結束後降「最近使用」                                       |
| 最近使用過的 UGC                               | LRU 候選                                                                          | 超過目前平台／貢獻等級的 trigger 後依 LRU 順序 unpin 至 target |

> **race lock 硬規**：比賽期間絕不可 unpin 任何 race-relevant CID，否則賽到一半 GLB 消失 → 物理算崩潰。

資產庫名單位於 per-identity sealed `asset-library` domain；裝置 GC 投影只保存 CID reference count 與
conservative flag，不保存 owner mapping。刪除 profile 時先以 PIN 驗證的 callback-scoped key 解密並
準備差異，profile／container 成功刪除後才減少引用。加密備份匯入無法在鎖定狀態得知名單內容，故
先標記 conservative，寧可暫時過度保留，不可讓 GC 低估保護集。

Takedown 規則高於 `mine`／`loadout` 永久來源：active DMCA／moderation takedown
在 ownership normalization 移除這兩類來源，之後只按一般 LRU 自然衰減；仍有效的 race lease 不受
影響。現行契約不要求立即 purge。

### 離線組裝與本機測試

- 本機可用的鏈上 CID 集合 ＝ 所有本機 loadout 引用的 CID 聯集，且必須由 authority 的 locked
  local CID reader 以 storage-only `has/get` 讀出；不得另開第二個 raw
  `IDBBlockstore('open4wd/ledger/blocks')`、啟動 Bitswap，或以 metadata／pin 記錄假定 bytes 存在。
- 正式車位一般候選為公版與目前身份資產庫；只有 local CID reader 證明 bytes 存在且 canonical
  驗證成功者可裝。本機測試車位再加 `local-parts`。
- `local-tracks` 只可用於 local-test；正式房間 ／ 配對 ／ 賽事提交再次拒絕 `local:` 場地。
- 任一 bytes 缺席時保留 loadout，但禁止測試並列出缺少資源；不可使用 proxy GLB。
- App「清除 UGC 快取」只清 `lru`，不登出，也不清 `loadout`／`mine`／`race-lock`。

### CAR 保存與 exact-root 本機補回

`UgcArchiveAccess` 是 local-only port，只有 `exportCar(root)` 與 `importCar(bytes)`；不得暴露
creator submission、ledger 或 provider mutation。匯出遍歷 canonical UnixFS root 的完整 exact
block set 再建立標準 CAR v1。匯入驗一 root、全部 reachable blocks、CID digest、80 MiB logical、
1 MiB 單 block、81 blocks 與 canonical re-import root，再以一個 verified batch 交給唯一 storage
authority。寫入中斷留下的已驗 partial blocks只可作 resumable cache，不得宣稱 root 完整可用。

LRU metadata 分開記 `logicalSizeBytes` 與 root 可達的 `physicalBlockBytes`；共享 block 的實際全庫
去重占用由 blockstore/quota authority 計算，不得把 logical bytes 當磁碟用量。已存在的 block
可視為成功；新補回的 root best-effort 記為 `lru`，不升為 `mine`、`loadout`
或永久 pin。匯入流程不啟動網路，也不依賴登入、Ledger 或 pinning capability；日後正常建立
online generation 時，同一 authority 的 block 才可能經 Bitswap 供應。匯入不是 UGC 上傳，
不得呼叫 similarity、文字黑名單、收費、簽章或 `ugc-upload` 路徑。

### LRU Service

```typescript
@Injectable({ providedIn: "root" })
export class UgcCacheLruService {
  constructor(
    private helia: Helia,
    private idb: UnifiedDb,
    private online: OnlineStatusService,
    private usagePolicy?: () => {
      triggerUsageRatio: number;
      targetUsageRatio: number;
    },
  ) {} // idb＝§5 openUnifiedDb 連線（原生）

  async touch(cid: CID): Promise<void> {
    /* 更新 lastUsedAt */
  }
  async pin(
    cid: CID,
    category: UgcCacheMeta["pinCategory"],
    sizeBytes: number,
  ): Promise<void> {
    /* helia.pins.add + 寫 meta */
  }
  async reclassify(cid: CID, c: UgcCacheMeta["pinCategory"]): Promise<void> {
    /* loadout 切換 / race lock 解除 */
  }

  /** 觸發 LRU GC，回收至本次 snapshot 的 active-policy target */
  async maybeRunGc(
    options: { forceWhenCritical?: boolean } = {},
  ): Promise<{ ranGc: boolean; freedBytes: number }> {
    // 一次 serial GC 固定擷取同一對 policy，未提供 getter 時維持既有 0.70／0.60。
    const { triggerUsageRatio, targetUsageRatio } = this.usagePolicy?.() ?? {
      triggerUsageRatio: 0.7,
      targetUsageRatio: 0.6,
    };
    const online = await this.online.verifyConnectivity();
    if (options.forceWhenCritical !== true && !online)
      return { ranGc: false, freedBytes: 0 }; // 一般離線不 GC
    const est = await navigator.storage.estimate();
    const usage = est.usage ?? 0;
    const quota = est.quota ?? 0;
    const ratio = quota > 0 ? usage / quota : 0;
    if (quota <= 0 || ratio <= triggerUsageRatio)
      return { ranGc: false, freedBytes: 0 };
    if (
      options.forceWhenCritical === true &&
      ratio <= STORAGE_CRITICAL_USAGE_RATIO &&
      !online
    )
      return { ranGc: false, freedBytes: 0 }; // offline 只允許 strict critical
    let needFree = usage - quota * targetUsageRatio,
      freed = 0;
    const evictable = (await this.idb.getAll("ugc-cache-meta"))
      .filter((m) => m.pinCategory === "lru")
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt); // 最舊先 evict
    for (const m of evictable) {
      if (needFree <= 0) break;
      await this.helia.pins.rm(m.cid);
      await this.idb.delete("ugc-cache-meta", m.cid);
      freed += m.sizeBytes;
      needFree -= m.sizeBytes;
    }
    await this.helia.gc();
    return { ranGc: true, freedBytes: freed };
  }
}
```

`UgcCacheMeta`：`{ cid, pinCategory: 'builtin'|'mine'|'loadout'|'race-lock'|'lru', sizeBytes, lastUsedAt, pinnedAt }`（時間為本地牆鐘，純客戶端快取 metadata，不入帳本 / derive）。

> **併發互斥**：pin／reclassify／GC 全走單一操作佇列（serialize）與 authority 的 origin-exclusive lock，且 evict 逐筆重讀 meta 現值、非 `lru` 即跳過——GC 迭代期間的 race-lock 升類不得被過期快照覆滅。online borrowed mutation 也走同一 origin lock；LRU internal pin／GC 已持鎖時不重取 non-reentrant lock。

### GC 觸發時機

| 時機                                    | 行為                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 啟動時（恆定執行）                      | `releaseAllRaceLocks()` 在既有 exclusive CID guard 下只降級 stale／expired owner lease；live owner lease 保留 |
| 每次比賽結束（settling → closed 後 5s） | `maybeRunGc()`                                                                                                |
| 玩家手動「清除 UGC 快取」（設定頁）      | 強制 GC 所有 `lru` 類，不看用量                                                                               |
| 啟動時 quota > 90%                      | networkless authority 即使 offline／未登入也直接強制 GC 至 active target；等於 90% 不觸發                     |
| 上傳新 UGC 前                           | 預先 `maybeRunGc()`，避免上傳中途 quota 失敗                                                                  |

每筆 race lock 必須有合法 owner／expiry lease；缺欄或形狀錯誤直接拒絕。reconciliation 與 GC
都在相同 exclusive guard 下重讀並尊重 live owner lease；不得因另一個 tab 的 lease尚有效而把
CID 降為 `lru` 或 evict。

### 容量警告與貢獻政策

`usagePolicy()` 由最新 sanitizer 後的 `ugcContribution.level` 與既有 iOS／iPadOS 偵測解析；不重建
`UgcCacheLruService`，以保留其 serialize、origin lock、race lease 與永久所有權。每次 GC 起始時
固定擷取一對 trigger／target；未注入 getter 的 test／host 維持 0.70／0.60。

| 平台             | `off`       | `standard`  | `generous`  |
| ---------------- | ----------- | ----------- | ----------- |
| desktop／non-iOS | 0.70 → 0.60 | 0.80 → 0.70 | 0.85 → 0.75 |
| iOS／iPadOS      | 0.50 → 0.40 | 0.60 → 0.50 | 0.70 → 0.60 |

箭頭左側是 trigger、右側是 GC target。只有一套 active-level 警告規則：

1. 解析目前平台／level 的 trigger 與 target；用量小於或等於 trigger 時不警告。
2. 用量超過 trigger 且離線時不 unpin，顯示 `cleanup-deferred-offline`，待連線後正常 GC。
3. 用量超過 trigger 且在線時執行正常 GC、重新 estimate；結果仍高於 target 時顯示
   `insufficient-evictable-space`，GC 失敗時顯示 `cleanup-failed`。
4. 啟動時嚴格 `usage/quota > 0.9` 只作為進入 forced GC 的門檻：即使離線也朝同一 active-policy
   target 強制回收，重估後仍套用第 3 點。仍嚴格大於 0.9 可顯示 `critical-after-cleanup`；若已低於
   0.9 但仍高於 target，必須顯示 `insufficient-evictable-space`，而非靜默。GC 失敗顯示
   `cleanup-failed`；等於 0.9 不進 forced critical 路徑。

離線正常 GC 不執行，因 unpin 後無法重抓 UGC；只有上述啟動 critical 路徑可由 networkless authority
離線回收。設定降級立刻保存並保留同一 LRU，但正常 GC 延後；超過新 trigger 時顯示
`cleanup-deferred-offline`，reconnect 後由借用相同 authority 的新 online generation 重新評估。若
用量未超過新 trigger，不製造警告。storage estimate 不可得時不虛構警告或 active 成功。

### 6.1 加密本機備份 I/O

`.open4wd-backup` 不走無界 `Blob`：可用 File System Access 時直接寫出 CAR frames；否則先寫 OPFS
暫存檔，再由 `File` 觸發下載；兩者都不可用時才允許具硬上限的記憶體後援。外層 ciphertext 與
匯入後的 verified plaintext chunks 同樣使用 OPFS spool，工作完成或失敗都清除暫存。匯入先完成
AEAD／CID／CAR／schema 驗證與 GLB 重驗，正式 IndexedDB 寫入不得兼作暫存。

## 7. iOS Safari 補強

| 限制                                   | 緩解                                     |
| -------------------------------------- | ---------------------------------------- |
| PWA install 流程不直觀（需從分享按鈕） | onboarding 圖示說明                      |
| 7 天未開的儲存可能被清除               | 請求 persistent storage + 提示備份助記詞 |
| Service Worker 限制較多                | 用標準 API，不依賴 Apple 不支援功能      |
| WebRTC 後台被暫停                      | 比賽中提示「請保持應用前景」             |

iOS／iPadOS 使用上表較低的每等級 policy；persistent storage 已授予也不改變此平台判定。

## 8. 跨模組對接

| 模組                                                                          | 對接                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------- |
| [部署資訊.md §6](../部署資訊.md)                                              | manifest / SW 策略總表 / 離線可玩範圍          |
| [版本規範.md §8](../版本規範.md) · [流程/升版.md §5](../流程/升版.md) | SW 升版機制 / `CLIENT_VERSION` build 嵌入      |
| [key-manager.md](key-manager.md)                                              | `encrypted-keys` store（加密助記詞 / profile） |
| [ledger.md](ledger.md)                                                        | 客戶端 Storage 保留 / Helia pin                |
| [建模參數.md](../建模參數.md)                                             | GLB 大小上限（LRU 容量估算）                   |
| [i18n.md](i18n.md) · [語系清單.md §2](../語系清單.md)                         | 四語系 manifest 文案（`app.tagline`）          |
