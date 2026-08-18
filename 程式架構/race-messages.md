---
type: impl
domain: ["比賽房間"]
summary: 賽中圖示訊息目錄、圖庫、九格 loadout、wire 與 HUD 契約
authority: null
slug: null
---
# 賽中圖示訊息（race-messages）

> 本模組是獨立於網站 `ThemeService` 的參賽者快速溝通系統。等待房自由文字仍由 [chat-system.md](chat-system.md) 負責；進入比賽後只使用本模組的受審查圖示訊息。

## 1. 語意目錄

中央 `MessageDefinition` 以只新增不改義的 `messageKey` 表示共同文字語意。每筆必須有 `zh-TW`／`zh-CN`／`en`／`ja` label、無障礙描述、分類與搜尋詞，且不得含 HTML 或 URL。v1 固定 12 類 × 8 筆，共 96 keys：

| 類別 | keys |
|---|---|
| 基本回答 | `yes`、`no`、`okay`、`understood`、`not-sure`、`maybe`、`please`、`one-more-time` |
| 問候／開場 | `hello`、`welcome`、`nice-to-meet-you`、`good-luck`、`have-fun`、`lets-go`、`wait-a-moment`、`here-we-go` |
| 行車／位置 | `on-your-left`、`on-your-right`、`coming-through`、`go-ahead`、`after-you`、`slowing-down`、`stopping`、`make-way` |
| 一般危險 | `watch-out`、`danger`、`obstacle-ahead`、`crash-ahead`、`debris-ahead`、`slippery-road`、`rough-road`、`narrow-path` |
| 賽道／戰鬥 | `jump-ahead`、`trap-ahead`、`incoming-attack`、`behind-you`、`wrong-way`、`blocked-path`、`wait-for-me`、`catching-up` |
| 自身狀態 | `im-stuck`、`im-lost`、`i-crashed`、`im-damaged`、`low-energy`、`cant-move`、`recovering`、`im-out` |
| 正向稱讚 | `nice`、`great`、`amazing`、`awesome`、`impressive`、`well-done`、`clean-move`、`respect` |
| 情緒／幽默 | `wow`、`lol`、`oops`、`no-way`、`close-one`、`lucky`、`unlucky`、`facepalm` |
| 禮貌／修復關係 | `thanks`、`sorry`、`my-bad`、`excuse-me`、`no-problem`、`its-okay`、`please-stop`、`no-hard-feelings` |
| 競技表現 | `nice-hit`、`good-dodge`、`good-save`、`good-defense`、`that-hurt`、`comeback`、`great-overtake`、`photo-finish` |
| 鼓勵 | `keep-going`、`dont-give-up`、`you-can-do-it`、`take-your-time`、`almost-there`、`nice-try`、`all-good`、`next-time` |
| 賽後互動 | `good-game`、`well-played`、`congratulations`、`nice-race`、`great-finish`、`good-effort`、`rematch`、`goodbye` |

倒數／GO、Ready、正式斷線、排名、圈數、完賽、處罰、checksum／desync、資源下載及網路品質都是 runtime 可判定事實，不進玩家自選目錄。現行 8 人 FFA 也不提供結盟、集火或指定玩家訊息。

## 2. 圖庫與資產

`RaceMessagePackManifest` 可只覆蓋中央目錄任意子集。同一 `messageKey` 可有 standard／cheerful／meme 等多個視覺資產；語意或 wording 真正不同時才新增 key。玩家選擇的是 `packId + assetId + revision + digest` 精確資產，接收者必須顯示發送者選取的資產，不得換成接收者自己的 pack。

- runtime path：`public/assets/race-message-packs/<packId>/manifest.json` 與同層 WebP。
- 每張圖固定 256×256、有 alpha、無字、無商標，WebP hard cap 64 KiB；manifest 帶 byte size 與 SHA-256 digest。
- pack identity immutable；內容變動必須新 revision／digest，讓等待房快取只下載缺少項。
- pack 不位於網站 themes 目錄，也不隨 `themeId` 自動切換。
- 只有已取得可公開散布權、provenance 可稽核且通過 CI decode／digest／尺寸／透明／容量檢查的圖庫可進 Git。既然正式隨 Git 出貨，所有玩家都可選用、發送、下載與觀看，不設 entitlement gate。
- 缺圖或下載失敗不阻擋 match-start、race-ready 或倒數；以中央四語 label 與 core fallback icon 顯示。

首批 runtime pack `default-inspired` 與 `moon-rabbit` 各覆蓋 v1 全 96 keys，但網站主題只是美術靈感，不是 runtime 關聯。提示詞與原始 PNG 位置：

```text
open-4wd-specs/美術資源/提示詞/賽中訊息圖示/default-inspired.md
open-4wd-specs/美術資源/提示詞/賽中訊息圖示/moon-rabbit.md
open-4wd-specs/release-input/ui/race-messages/{default,moon-rabbit}/
```

兩套各 96 張無字 RGBA PNG 已依提示詞逐張生成並保留於 specs；main repo 的 `scripts/generate-race-message-packs.mjs --complete` 會縮放、壓縮為 256×256 WebP 並產生含 byte size 與 SHA-256 的 manifest，`scripts/check-race-message-packs.mjs --complete` 則逐張解碼驗證完整性、尺寸、alpha、64 KiB 上限與 digest。runtime 產物位於：

```text
open-4wd/public/assets/race-message-packs/{default-inspired,moon-rabbit}/
```

## 3. 玩家九格與凍結時點

設定頁最終提供九個快捷槽，玩家可跨 pack 選九個不同 `messageKey` 的精確圖示資產。participant 完成房間 admission、進入等待房時，runtime 複製並簽署不可變 `RaceMessageLoadout`；該 `RoomSession` 存續期間只使用此快照，玩家必須離房回設定頁才能修改。

這個凍結點是「房間 admission 完成」，**不是賽內 3、2、1、GO**。GO 不讀設定、不重新凍結、不重新仲裁圖庫。房主建立自己的 waiting session 時採相同規則。

等待房 host-star 只交換已簽 loadout 與 manifest reference；每個 participant／spectator 從正式靜態 origin 預載自己缺少的 WebP。設定瀏覽完整圖庫時必須 lazy-load／virtualize；進房則只有固定名單的 9 × participant 上界。

## 4. Wire 與角色

賽中送包以 `SignedPayload<RaceMessageWire>` 傳輸：

```typescript
interface RaceMessageWire {
  type: 'race-message';
  matchId: string;
  sender: PeerId;
  loadoutDigest: string;
  slotIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  sequence: number;
  messageId: string;
  timestamp: Timestamp;
}
```

接收端驗 `sender === signer`、matchId、participant roster、loadout digest、slotIndex、單調 sequence、messageId 去重、簽章、timestamp 與限速。送端與每個收端都施加 token bucket：平均每 2 秒一則、burst 2；每個 sender 的 sequence 狀態只依固定 participant roster 建立，避免未界定成長。wire 不傳自由文字、`messageKey` 或 URL；它們都由已鎖定 loadout 解出。只有 canonical participant 可送，participant 與 spectator 均可收。

participant 經 RaceMesh 的 ordered app-control envelope 傳送；必須至少有一條可寫 control link 才能回報成功，簽章或傳輸失敗不消耗限速 token。participant source 向 spectator relay 的是同一份原始 participant 簽章 envelope；spectator 以目前 match、固定 roster 與原 signer 重驗，不能信任 source 重包後自稱的 sender。source payload 被改動會使原簽章失效。spectator 中途加入先取完整 participant loadout snapshot；同一 match 內 round 變更或 source 切換保留 sequence／messageId 防重放狀態，切到新 match 才清除。

## 5. HUD

賽內由單一圖示按鈕展開／關閉 3×3 九宮格；選取一格後嘗試發送並立即收合。固定 HUD 依 canonical participant roster 為每個 sender 保留最多一條，不排隊：新接受訊息立即取代同 sender 舊訊息並把該 sender 的期限重設為 5 秒。因此 A 在第 2 秒再送時，接收者看見第一則 2 秒，第二則再看 5 秒。較舊 sequence 晚到不得覆蓋較新訊息。

## 6. 實作分工

- `src/race-messages/catalog.ts`：96 詞四語目錄。
- `src/race-messages/contracts.ts`：pack／asset／九格 loadout／wire schema 與 validator。
- `src/race-messages/builtin-packs.ts`：內建 manifest registry、精確資產解析與預設九格。
- `src/race-messages/loadout-reference.ts`：房間 admission 的 canonical digest、不可變快照與簽署 reference 驗證。
- `src/race-messages/transport.ts`：participant ordered app-control transport、簽章、名冊與限速。
- `src/race-messages/portable.ts`：spectator relay 的可攜 signed envelope 編解碼。
- `src/race-messages/hud.ts`：固定 roster、每位 sender 一條、5 秒 replacement HUD。
- `scripts/generate-race-message-packs.mjs`／`scripts/check-race-message-packs.mjs`：PNG → WebP／manifest 產生與完整資產 gate。
- [room-runtime.md](room-runtime.md)：等待房 loadout 凍結與交換。
- [network-sync.md](network-sync.md)：participant mesh transport。
- [spectator.md](spectator.md)：spectator 唯讀 relay 與中途加入 snapshot。
- [賽內機制.md §2.5](../賽內機制.md)：九宮格與固定 HUD 使用者行為。
