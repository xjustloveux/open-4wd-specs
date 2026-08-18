---
type: impl
domain: ["前端主題"]
summary: AppSettings 資料模型／預設值／即時生效 vs 重整／persist
authority: null
slug: null
---
# settings（客戶端設定實作）

> **本檔角色**：客戶端設定的**實作層** —— `AppSettings` 資料模型、預設值、設定頁路由、即時生效 vs 需重整、重設、persist。
> 八大分類的**設計**（顯示 / 音訊 / 遊戲行為 / 網路 / 隱私 / 維護 / 帳號 / 關於 + 可關閉的開發者）見 [遊戲機制.md §9](../遊戲機制.md)。對應 `src/settings/`。

## 1. 資料模型

```typescript
interface AppSettings {
  account: AccountSettings;
  audio: AudioSettings;          // 音量持久值；音訊系統見 [audio-system.md](audio-system.md)
  display: DisplaySettings;
  network: NetworkSettings;
  gameplay: GameplaySettings;
  privacy: PrivacySettings;
  // maintenance / about 為操作或純讀取、不入模型；developer 為可關閉第 9 項
}

interface AccountSettings { hasPinSet: boolean; storedKeyType: 'pin-encrypted' | 'none'; }   // 不存實際 PIN

interface AudioSettings {
  masterVolume: number;          // 0~100, default 80
  sfxVolume: number;             // 0~100, default 100（相對 master）
  bgmVolume: number;             // 0~100, default 80（背景音樂；槽位機制見 audio-system.md）
}

interface DisplaySettings {
  language: LangCode | null;     // 見 i18n.md；預設 null＝尚未選擇（首訪 fall through 到 navigator 偵測）
  themeId: string;               // 主題 id（../主題系統.md；預設 'default'）
  effectsQuality: 'high' | 'medium' | 'low';
  renderScalePercent: number;     // 必填整數 50–100；default 100
  antialias: 'on' | 'off';        // default on；與 render scale 正交
  colorblindMode: boolean;
  uiFontSize: 'small' | 'medium' | 'large';
  motionPreference: 'system' | 'reduce'; // default system；reduce 強制減少非必要動態
}

interface NetworkSettings {
  services: {
    bootstrap: { mode: 'community' | 'manual-only' | 'offline'; entries: ManualProviderEntry[] };
    signaling: { mode: ProviderMode; entries: ManualProviderEntry[] };
    pinning: { mode: ProviderMode; entries: ManualPinningEntry[] };
    relay: { mode: ProviderMode; entries: ManualProviderEntry[] };
    ice: { mode: ProviderMode; entries: ManualIceEntry[] };
  };
  ugcContribution: { level: 'off' | 'standard' | 'generous' };
}
type ProviderMode = 'community' | 'manual-only' | 'disabled';
interface ManualProviderEntry { id: string; label: string; endpoint: string; providerId?: string; enabled: boolean; priority: number; }
interface ManualPinningEntry extends ManualProviderEntry { writeEnabled: boolean; }
interface ManualIceEntry extends ManualProviderEntry {
  turnCredentialRef?: string; // active profile namespace 內的 logical slot，不得存明文
}
interface ProfileNetworkAuthority {
  schemaVersion: 1;
  turnCredentials: Record<string, string>;
  pinningApiTokens: Record<string, string>;
  signalingCredentials: Record<string, string>;
} // master-seed sealed、profile scoped、不可攜，不屬 AppSettings

interface GameplaySettings {
  customKeyBindings: KeyBinding[];
  playTimeReminder: { enabled: boolean; intervalHours: 1 | 2 | 3 };
  followCameraDistanceM: number;          // 0.3–2.0 m；default 0.5 m，純本機 presentation
}

interface PrivacySettings {
  peerIdDisplay: 'full' | 'last4';
  blacklistCidVisible: boolean;          // IPFS 黑名單 CID 顯示開關（遊戲機制 §9 隱私）
  chatFilterEnabled: boolean;            // 只影響裝置本機 render copy
  chatFilterWords: string[];             // literal，一行一詞；不傳輸、不上鏈
}
```

Community registry 只提供公開技術發現；manual entry 永遠優先，接受的 invite route 只限當次
session 且不寫入設定。`disabled`／`offline` 會先阻擋該服務的所有遠端來源。Pinning
`writeEnabled` 逐 provider 明確授權且預設 `false`，不得從 listing 推導。`about`（關於）顯示
版本 6 欄位（[版本規範.md](../版本規範.md) / [versioning.md](versioning.md)）+ license + 治理事件，純讀取。
手動 `turn:`／`turns:` entry 可用 `turnCredentialRef` 引用 TURN secret；實際 username／credential
只存在 active profile 的 `network-authority` sealed domain，匯出一般設定、community registry、log
與遙測時都不得展開。Pinning API token 與長期 signaling credential 使用同一 domain 的獨立 slot map；
短期 token、socket、challenge 與 upload grant 只留 session 記憶體。

## 2. 預設值

```typescript
const DEFAULT_SETTINGS: AppSettings = {
  account: { hasPinSet: false, storedKeyType: 'none' },
  audio: { masterVolume: 80, sfxVolume: 100, bgmVolume: 80 },
  display: { language: null, themeId: 'default', effectsQuality: 'high', renderScalePercent: 100, antialias: 'on', colorblindMode: false, uiFontSize: 'medium', motionPreference: 'system' },
  network: {
    services: {
      bootstrap: { mode: 'community', entries: [] },
      signaling: { mode: 'community', entries: [] },
      pinning: { mode: 'community', entries: [] },
      relay: { mode: 'community', entries: [] },
      ice: { mode: 'community', entries: [] },
    },
    ugcContribution: { level: 'off' },
  },
  gameplay: { customKeyBindings: [], playTimeReminder: { enabled: false, intervalHours: 2 }, followCameraDistanceM: 0.5 },
  privacy: { peerIdDisplay: 'last4', blacklistCidVisible: false, chatFilterEnabled: true, chatFilterWords: [] },
};
```

啟動語言偵測順序 **URL 前綴 → persist（`DisplaySettings.language`，未選 ＝null）→ `navigator.language` → `en`**（未匹配語系終極 fallback `en`；[i18n.md](i18n.md) / [語系清單.md §6](../語系清單.md)）。

## 3. 設定頁路由

```text
/settings          → 顯示（預設）
/settings/display  /settings/audio      /settings/gameplay
/settings/network  /settings/privacy    /settings/maintenance
/settings/account  /settings/about
```

`/settings/:section?` 是**公開 route**，未登入、離線或身分尚未解鎖皆可進入；開啟設定頁不得初始化玩家 Ledger、車庫、APP_DATA 或 P2P session。支援深層連結（從特定情境直接導向特定分類）。

導覽固定依「顯示、音訊、遊戲行為、網路、隱私、維護、帳號、關於」排列；`/settings` 與未知
section 都回到顯示。`about` 不得改寫成 maintenance：六欄版本、MIT license、source／discussion
連結與治理事件真實空狀態都在獨立唯讀分類。帳號分類固定存在，能力由 runtime 身分狀態決定；
第九個 developer 分類由注入旗標
`SETTINGS_DEVELOPER_ENABLED` 明確控制，正式預設 `false`，不得僅靠隱藏 CSS 或猜測 build mode。

### 3.1 未登入與登入後能力

設定頁維持同一套分類與 URL，依 runtime capability 決定單項是否可編輯，不另建 `/preferences`：

| 分類 | 未登入可用 | 需登入／解鎖 |
|---|---|---|
| 顯示 | 語系、主題、UI 字級、特效品質、3D 算圖解析度、反鋸齒、色盲模式、減少動態效果 | 無 |
| 音訊 | master / SFX / BGM 三軸 | 無 |
| 遊戲行為 | 鍵盤／手把 binding、遊戲時長提醒、跟車距離 | 無 |
| 網路 | 非敏感 Bootstrap／Pinning 節點與 UGC 本機分享保留可預先設定；不得因此啟動 P2P | TURN credential 與需要玩家身分的連線能力 |
| 隱私 | UGC 貢獻偏好與遊戲時長提醒資料的裝置儲存／無集中式遙測說明、第三方 client／P2P IP／聊天證據三項安全揭露、聊天顯示過濾開關與本機詞表 | PeerId 顯示、身分分域收藏清單管理與依玩家狀態產生的診斷項目 |
| 維護 | PWA／離線快取狀態、已下載主題、清除 UGC 快取、裝置偏好、儲存空間、本機安全事件 JSON 匯出 | 刪除私鑰、身分與玩家資料 |
| 帳號 | 顯示「建立／匯入身分」入口 | 以目前 PIN 驗證後修改 PIN、登出、紙本備份純驗證與身分刪除；助記詞不保存且不可事後檢視 |
| 關於 | 版本、授權、專案資訊與更新狀態 | 無 |

需身分的列在未登入時保留可理解的標籤與「登入後可用」原因，但不得讀取或製造 PeerId、餘額、CID、節點連線成功等假狀態。裝置級偏好跨登入 ／ 登出保留；profile sealed secret 與身分資料仍使用既有受保護儲存邊界。

Account 的 `IdentityData.changePin(oldPin, newPin)` 必須把兩值原樣交給 KeyManager 驗證與重加密，
不得把舊 PIN 寫死為空字串或為假想 pre-PIN profile 設例外。UI 要求目前 PIN、新 PIN、再次輸入
新 PIN；空值與不一致在呼叫前拒絕，provider 的 `I18nError` 參數原樣顯示。成功後立即清空三個
欄位。登出使用同一 `IdentityData.signOut()` lifecycle，撤銷已解鎖 generation 後回到本分類的
建立／匯入入口。專案為 pre-launch，只支援這個 current shape，不設舊欄位、雙讀或 migration。

紙本備份驗證必須由使用者主動啟動並重新確認 PIN。助記詞輸入元件只能在 AppShell
`secret-entry guard` 已停止舊 online generation、transport、健康檢查與所有 AppShell 管理的網路
出口後掛載；active race／match、launch 或 ledger admission 非 idle 時拒絕進入。驗證只回相符／
不相符，不持久化結果。成功、失敗、取消、pagehide、document hidden 或元件銷毀皆立即 unmount
並清除應用狀態，之後只建立全新 generation；重啟失敗維持離線。UI 必須明示軟體環境無法阻止
擴充套件、OS 或惡意主機側錄，也不能保證 JavaScript 字串物理抹除。刪除前提供同一流程，但未驗證
或不相符者仍可勾選不可復原警告後覆寫，且首次鏈上操作不強制驗證。

## 4. 即時生效 vs 需重整

| 設定項 | 即時 | 需重整 |
|---|---|---|
| 音量 / 特效品質 / 3D 算圖解析度 / 反鋸齒 / 色盲模式 / 主題 / 減少動態效果 / Pinning 節點 / UGC 本機分享保留 / 自訂按鍵 | ✅ | |
| 語言 | | ⚠️ 提示需重整 |
| TURN Server | | ⚠️ 下次連線生效 |

### 4.1 Runtime consumer 與能力真實性

- `customKeyBindings` 目前只接受比賽確實消費的 `skill-1`～`skill-4`，鍵盤欄位使用 `KeyboardEvent.code`；重複 action、鍵碼或手把按鈕與不支援值在載入 sanitizer 被移除。自訂後該技能原本的 `Digit1`～`Digit4`／`Numpad1`～`Numpad4` 預設綁定讓位。
- `playTimeReminder` 由 App runtime 排程，設定變更會取消舊 timer 並重排；App 銷毀時必清除 timer。提醒只顯示本機 toast，不上鏈、不發網路請求。
- `ugcContribution` 偏好與 `playTimeReminder` 的設定／提醒計時只存於目前裝置，兩項功能不新增集中式遙測。這項聲明不涵蓋 authenticated online play、peer serving 或 signaling／TURN／peer 基礎設施；它們仍依既有邊界處理網路識別碼與傳輸中繼資料。
- `effectsQuality` 同時控制 DOM 特效與 Three.js render profile：`medium` 關閉 outline post-processing，`low` 另把 toon 階數降為 2；主題本身仍可用。
- `renderScalePercent` 的 min／max／step／default 集中為 50／100／1／100，資料模型接受範圍內任意整數；50／75／100 僅是 UI 快捷值。current display shape 的 `renderScalePercent` 與 `antialias` 都必填，缺欄直接回到本版 display default；專案為 pre-launch，不加入舊欄、dual-read 或 migration。
- `O4ThreeStage` 以 `clamp(devicePixelRatio, 1, 2) × renderScalePercent / 100` 計算 drawing-buffer ratio，再受 8,000,000 總像素、`MAX_RENDERBUFFER_SIZE` 與 renderer `maxTextureSize` 共同截斷。`setSize` 使用原生 CSS viewport 尺寸，故 canvas CSS、HUD、文字與 hit target 不縮放；viewport／DPR／設定變更只重建 presentation buffers。實際比例由 viewport 回報 `PresentationSettingsRuntime`，設定頁只在小於玩家選擇時顯示截斷值。
- `antialias: on|off` 只決定 `WebGLRenderer` 的 antialias 建構選項；與 render scale 正交。切換造成 stage 替換 renderer 並釋放舊 context／post-processing presentation 資源，不改變 scene descriptor、物理、共識、SavedState、replay hash 或輸入語意。dynamic resolution 不屬本版；若加入，須另案定義 frame-time 穩定器與上下限。
- `motionPreference` 與 `effectsQuality` 正交。唯一有效 reduced motion 為「玩家選 `reduce` 或 OS `prefers-reduced-motion: reduce`」；`system` 不得覆蓋 OS 無障礙偏好。runtime 監聽 OS 變更並投影 `data-motion=reduce|full`；靜態／SSG 初始 `pending` 視同 reduce-safe。Home／Garage／Result 的展示車只停止角度增量，Viewport render loop 與比賽／Editor 邏輯維持運行。
- `peerIdDisplay` 在設定頁顯示本人識別預覽；一般 UI 遵守完整 ／ 末四碼選擇，診斷用途才可明確要求完整值。`blacklistCidVisible` 沒有資料時只顯示真實空狀態，不製造 CID。
- `chatFilterEnabled` 與 `chatFilterWords` 是裝置本機顯示偏好。詞表最多 512 筆、單筆最多 48 Unicode code points、拒絕控制字元、NFKC／case-fold 去重；只在儲存時寫入 IndexedDB `settings/privacy`。Git starter list 只有玩家明確匯入時複製，更新不得覆蓋本機副本。關閉或修改詞表不改 SignedPayload、網路傳輸、聊天歷史或檢舉證據原文。
- Provider health 由 composition root 透過 `SETTINGS_RUNTIME_STATUS` 注入；只檢查目前服務模式允許且玩家已選取的有限候選。狀態只使用 `reachable`、`unreachable`、`incompatible`、`unknown`，不產生 trust／recommendation badge。Pinning 先讀 `/provider`，只有玩家逐節點啟用 write 才執行對應 `/stats`／write 檢核；前一個失敗不能遮蔽後續候選。
- `ugcContribution` 是未驗身分的裝置偏好；從公開設定頁保存只更新本地設定，永遠不得建立或重試 storage authority，也不得啟動 P2P、Helia networking、Ledger 或身分。`off` 不加長 LRU 保留期，但不清除普通快取，也不保證 online app 不服務既有 block。新選擇 `standard`／`generous` 時必須先取得 persistent storage；請求被拒或 API 不可用時不保存這次選擇，原保存值保持不變。已載入的非 `off` 偏好則仍可存在；persistence 未確認時只休眠額外 retention，不把保存值改回 `off`。此拒絕語意由 [D-20260803-01](../decisions/D-20260803-01-持久儲存拒絕保留既有UGC偏好.md) 裁決。authority 已存在時，設定在下一個快取決策生效；提高等級不強制寫入或 GC，降低等級排程一次正常 `maybeRunGc()`。
- 正常 `AppShell` lifecycle 可在未登入／offline 時獨立 single-flight 初始化唯一的 networkless 本機 Helia storage authority；這不是設定 action 的副作用，且不得發出網路請求。authority 持有 LRU、pin state、Ledger content storage 與 local CID reader。只有 authenticated online generation 才建立 libp2p／Bitswap／Orbit／transport，並以 non-owning adapter 借用相同 storage identity；logout、disconnect、reset 與 reconnect 只替換 online generation，不關閉本機 authority。
- 貢獻不屬 external provider。設定頁顯示獨立狀態而不套用 provider health：

  ```typescript
  type UgcContributionState =
    | 'inactive'
    | 'runtime-not-started'
    | 'storage-not-persistent'
    | 'active';

  interface UgcContributionStatus {
    state: UgcContributionState;
    level: 'off' | 'standard' | 'generous';
  }
  ```

  runtime 狀態依以下優先序解析，與四語系「已保存但休眠」文案一致：

  1. 已保存 `level: 'off'` 為 `inactive`：沒有額外 retention，但普通 cache 與 active app 對既有
     block 的服務不因此保證停止。
  2. 已保存 `standard`／`generous`，但 persistent storage 尚未確認時為
     `storage-not-persistent`：保存偏好保持非 `off`，額外 retention 休眠至確認成功。
  3. 已保存非 `off`、storage persistent、但本機 authority 尚未完成或初始化失敗時為
     `runtime-not-started`；設定／status refresh 不得建立或重試 authority，只有明示 online shell
     lifecycle 可重試既有失敗。
  4. 已保存非 `off`、storage persistent 且本機 LRU authority 已安裝時為 `active`；這可發生在
     未登入／offline shell，只表示額外本機 retention 已生效，不代表 P2P 或 peer serving 已啟動。

  使用者手勢新選擇非 `off` 若 persistence 請求被拒，controller 回報拒絕且不寫入該選擇；若先前為
  `off`，狀態仍是 `inactive`，UI 以獨立拒絕訊息說明原因，不冒充上述已保存偏好的
  `storage-not-persistent`。

## 5. 重設與持久化

- 每分類有「重設此分類為預設」。未建立身分時，「重設全部裝置偏好」使用二次確認；存在身分時，任何會碰到私鑰 ／ 玩家資料的重設或刪除仍需 PIN 確認與「資產全失」提示。
- persist 於本地 `localStorage` / IndexedDB，**不上鏈**；多裝置同步衝突採 LWW。
- 設定 sanitizer 只接受 current schema；缺欄或畸形 `ugcContribution` 一律解析為 `off`。
- Pinning 節點沒有 deployment default 或 `official` 信任層級；只能由玩家自行新增／選擇，且每一筆都可刪除。讀取與 `update()` 共用完整 schema sanitizer（列舉、finite number、URL、TURN 明文清除），不合法的 `official` 標籤直接丟棄；先等 IndexedDB transaction commit 才更新 signal。私鑰刪除需 PIN 確認 + 「資產全失」提示。

TURN credential 不屬一般 `network` row：`turnCredentialRef` 只在 active profile namespace 解析，
秘密保存於不可攜的 `network-authority` sealed domain；解鎖後明文只留當次 session。換 PIN 不重封，
切換／登出／跨分頁撤銷／刪除與 shell dispose 都同步清除；晚到非同步結果不得復活明文。專案仍為
pre-launch，不讀取或遷移先前裝置全域密文。

### 5.1 本機資料備份

維護頁提供單一 `.open4wd-backup` 匯出／匯入：可多選身分 sealed portable domains、設定分類與個別
`local-parts`／`local-tracks`。密碼至少 12 個 Unicode code point 且需再次確認；忘記後無法復原。
匯出 network 分類時移除 `turnCredentialRef`，並永不包含 `network-authority`、TURN／pinning／
signaling secrets、助記詞、private key 或
`encryptedSeed`。匯入必須先顯示 new／overwrite／skip／reject、較新本機資料警示與 quota 估算，
使用者確認後才逐分段提交。格式與安全邊界見
[D-20260808-06](../decisions/D-20260808-06-多身分封存與加密本機備份.md)。

### 5.2 資產庫維護

登入後的維護分類列出目前身份資產庫，區分已取回與待取回，可逐項取回或移除。移除只移除目前
身份名單與對應 `library` 引用，不刪鏈上作品，也不覆寫 `mine`、`loadout`、`race-lock` ownership。
`.open4wd-backup` 包含 sealed 名單但不含鏈上 UGC bytes，因此匯入後項目可呈現待取回。

### 5.3 已下載主題與儲存空間

設定頁只透過 `AppMaintenance` provider 讀取維護資料，不直接存取瀏覽器全域。瀏覽器 adapter 以
Cache Storage 中 URL path 符合 `/assets/themes/<formal-theme-id>/` 的 request 判定已下載正式主題，
跨 cache 依 URL 去重並顯示 entry 數；`default` 是離線安全基線，不提供逐主題清除。其他正式主題
可逐項刪除相符 request；若正作用中，UI 先切回 default。Cache Storage 不支援、拒絕或列舉失敗
時回 `downloadedThemes: null`，UI 顯示明確不可用狀態，不捏造空清單。

儲存空間使用 `navigator.storage.estimate()` 的 `usage`／`quota`，僅在兩者為有限合法值時顯示用量
與 progress；API 不支援、權限拒絕或資料不完整時回 `storage: null`。主題清理、Storage estimate
與既有 UGC LRU 清理互相獨立；主題清理不得碰 IndexedDB 身分、設定、車庫、鏈上內容或 UGC
ownership。

## 6. 跨模組對接

| 模組 | 對接 |
|---|---|
| [遊戲機制.md §9](../遊戲機制.md) | 八大正式分類 + 可關閉第九開發者分類的設計權威 |
| [i18n.md](i18n.md) · [語系清單.md](../語系清單.md) | 語言設定 / 切換 |
| [themes.md](themes.md) · [../主題系統.md](../主題系統.md) | 主題選擇（`DisplaySettings.themeId`、即時生效）|
| [audio-system.md](audio-system.md) | 音量三軸（master / sfx / bgm）|
| [../賽內機制.md §2.4.1](../賽內機制.md) | 「自訂按鍵」範圍 = 鍵盤＋手把重綁（觸控佈局固定）；預設鍵位權威 |
| [key-manager.md](key-manager.md) | PIN / 助記詞 / 刪除本地資料 |
| [pinning-service.md](pinning-service.md) · [signaling-service.md](signaling-service.md) | 節點清單 / TURN |
| [versioning.md](versioning.md) · [版本規範.md](../版本規範.md) | 關於頁版本 6 欄位 / 檢查更新 |
