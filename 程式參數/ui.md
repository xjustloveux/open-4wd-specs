---
type: registry
domain: ["前端主題"]
summary: 動畫、音訊、版面、語系與 SEO 參數
authority: null
slug: null
---

# UI

> 本頁是所列 namespace 的內容權威；[程式參數](../程式參數.md) 只提供導覽。

## 12. `ui/animation`（動畫行為常數）

| 常數                | 值   | 說明 |
| ------------------- | ---- | ---- |
| `TOAST_DURATION_MS` | 4000 |      |

> 本節只收**行為常數**（時序邏輯、非視覺風格）。視覺轉場時長（fade／slide／hover 等）= design token `--anim-duration-*`——名錄與預設值權威 = `themes/default/theme.json`（[主題系統.md](../主題系統.md)），設計級距表見 [ui-frontend.md §7](../程式架構/ui-frontend.md)。

### 12.1 `ui/fragments`（純視覺碎片）

| 常數                                   | 值   | 說明                                                      |
| -------------------------------------- | ---- | --------------------------------------------------------- |
| `VISUAL_FRAGMENT_PRESENTATION_VERSION` | 1    | 純呈現重建演算法版本；不進 protocol／SavedState／結果驗證 |
| `VISUAL_FRAGMENT_LIFETIME_MS`          | 5000 | 車輛與場地純視覺碎片共用存續時間                          |
| `VISUAL_FRAGMENT_FADE_MS`              | 1000 | 存續期末段淡出時間                                        |

## 13. `ui/audio`（BGM 轉場）

| 常數               | 值   | 說明                                                                                         |
| ------------------ | ---- | -------------------------------------------------------------------------------------------- |
| `BGM_CROSSFADE_MS` | 1000 | BGM 異曲轉場淡出淡入時長（初估；[程式架構/audio-system.md §4](../程式架構/audio-system.md)） |

> **槽位與保留 SFX 單一權威 ＝ `src/audio-system/slots.ts`**；它們是封閉名錄而非可調參數，不在本表另抄。**音量預設單一權威 ＝settings**（[遊戲機制.md §9](../遊戲機制.md)／ [程式架構/settings.md](../程式架構/settings.md)：master 80 / sfx 100 / bgm 80，0–100 整數）——本表不另列音量常數；三路玩家可覆寫、持久於 settings。音訊系統（槽位 ／ 轉場 ／ 混音）見 [程式架構/audio-system.md](../程式架構/audio-system.md)。

## 14. `ui/layout`（版面）與主題常數

| 常數                        | 值                      | 說明                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NAV_COMPACT_CONTAINER_REM` | 72                      | public shell 的 content-fit 守門；容器可用寬度 `≤72rem` 時切 compact navigation，自然涵蓋窄 viewport 與文字放大，不是第四個裝置桶                                                                                                                                                                               |
| `LOW_HEIGHT_LANDSCAPE_REM`  | 32                      | 橫向可用高度 `≤32rem` 時壓縮非核心 chrome、保留主操作與安全觸控目標                                                                                                                                                                                                                                             |
| `GAME_SURFACE_ULTRAWIDE_PX` | 1920                    | `≥1920` 的遊戲 Stage／Event Board／Start Gate 可開始超寬流式擴張；em 實作＝120em                                                                                                                                                                                                                                |
| `GAME_SURFACE_MAX_PX`       | 1792                    | 超寬遊戲面的最大內容寬 112rem；閱讀／工具頁不套用此例外                                                                                                                                                                                                                                                         |
| `THEME_RESERVED_TOKENS`     | 24 tokens               | 主題不可覆蓋：既有狀態三色、觸控下限與 HUD 字級 8 項，加上過熱 `cool/warm/critical`、疲勞 `ok/warning/critical`、`self-ring`、`eliminated` 與 `racer-1`～`racer-8` 共 16 項 `--o4-gameplay-*` 競賽判讀色；色覺辨識模式由 safety layer 覆寫同組 gameplay token，不由主題控制（[主題系統.md §1](../主題系統.md)） |
| `THEME_SIZE_MAX_MB`         | 20                      | 單一主題資產上限（初估；BGM 為大頭，[主題系統.md §7](../主題系統.md)）                                                                                                                                                                                                                                          |
| `THEME_FONT_MAX_FILES`      | 4                       | 單一主題結構化 WOFF2 face 檔數上限；base／mono／display 合計，不接受 collection（[主題系統.md §5.1.1](../主題系統.md)）                                                                                                                                                                                         |
| `THEME_FONT_MAX_BYTES`      | 524288 bytes（512 KiB） | 單一主題所有 WOFF2 壓縮 bytes 子預算；仍同時計入 `THEME_SIZE_MAX_MB`（[主題系統.md §5.1.1](../主題系統.md)）                                                                                                                                                                                                    |

### 14.1 `ui/social`（身份社交資料）

| 常數            |  值 | 說明                                                                             |
| --------------- | --: | -------------------------------------------------------------------------------- |
| `FAVORITES_MAX` | 200 | 每個 sealed identity container 的玩家收藏上限；第 201 筆拒絕，不做 FIFO 自動淘汰 |

### 14.2 `ui/asset-policy`（匯入 guidance）

| 常數                      | 值                            | 說明                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPRECATED_MATERIAL_IDS` | （client 隨附清單、動態增長） | 已廢止材質 id 集合；僅上傳時驗證（Stage 2 不可選／Stage 3 拒收新上鏈）、零賽中足跡，屬 client minor 且不擋配對。它與鏈上衍生的 `DEPRECATED_TO_UNUSABLE_THRESHOLD` 不同；機制／絕版品行為見 [材質表.md §11](../材質表.md)，版本規則見 [版本規範.md §4](../版本規範.md) |

以下只影響 fresh import 編輯器提示與自動 fit，不進 protocol、canonical admission 或配對 gate。

| 常數                                | 值                                                                                                                 | 說明                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `TRACK_IMPORT_TARGET_M`             | 150                                                                                                                | 無 marker 場地首次匯入目標最長邊（m）                   |
| `TRACK_IMPORT_COMFORT_M`            | [120, 180]                                                                                                         | 場地首次匯入舒適帶（m）                                 |
| `PART_IMPORT_TARGET_LONGEST_EDGE_M` | `{ chassis: 0.13, body: 0.13, tire: 0.032, motor: 0.024, battery: 0.06, roller: 0.011, chip: 0.03, weapon: 0.06 }` | 無 marker 零件首次匯入各 type 目標最長邊（m）           |
| `PART_IMPORT_GEOMETRY_TARGET`       | 90_000                                                                                                             | 自動減面目標，為 100k canonical 硬上限預留 10% headroom |

> **RWD 語意**：40／64／90em 是主要內容分桶，禁機型綁定；72rem compact navigation 是 public shell 的 container content-fit 守門，32rem／orientation／aspect-ratio 是高度與比例守門，120em／112rem 是遊戲面超寬例外，均不是第四套網格桶。寬度單位是 CSS 邏輯像素；主要寬度 media query 以 em、content-fit 以 container rem、低高度以 rem、畫面形狀以 orientation／aspect-ratio 實作。完整規則見 [美術資源/主題外觀與 RWD.md §7](../美術資源/主題外觀與%20RWD.md)。

### 14.3 `ui/storage`（本機 UGC 保留與容量）

以下為 client-local 常數，不進共識、帳本或 rule ID；`trigger`／`target` 必須與
[pwa-offline.md](../程式架構/pwa-offline.md) 的 active-level policy 同步，並受 [§19.2](共通規則.md#192-常數不變式pnpm-run-checkinvariants) 硬閘保護。

| 常數                                             |   值 | 說明                                                                    |
| ------------------------------------------------ | ---: | ----------------------------------------------------------------------- |
| `STORAGE_CRITICAL_USAGE_RATIO`                   |  0.9 | 啟動 critical GC 的嚴格使用率門檻；僅 `usage/quota > 0.9` 進入 critical |
| `MAX_CONTRIBUTION_TRIGGER_USAGE_RATIO`           | 0.85 | 所有 UGC contribution trigger 的上限，必須低於 critical 門檻            |
| `UGC_CACHE_DESKTOP_OFF_TRIGGER_USAGE_RATIO`      |  0.7 | desktop／non-iOS，`off` 的 trigger                                      |
| `UGC_CACHE_DESKTOP_OFF_TARGET_USAGE_RATIO`       |  0.6 | desktop／non-iOS，`off` 的 GC target                                    |
| `UGC_CACHE_DESKTOP_STANDARD_TRIGGER_USAGE_RATIO` |  0.8 | desktop／non-iOS，`standard` 的 trigger                                 |
| `UGC_CACHE_DESKTOP_STANDARD_TARGET_USAGE_RATIO`  |  0.7 | desktop／non-iOS，`standard` 的 GC target                               |
| `UGC_CACHE_DESKTOP_GENEROUS_TRIGGER_USAGE_RATIO` | 0.85 | desktop／non-iOS，`generous` 的 trigger                                 |
| `UGC_CACHE_DESKTOP_GENEROUS_TARGET_USAGE_RATIO`  | 0.75 | desktop／non-iOS，`generous` 的 GC target                               |
| `UGC_CACHE_IOS_OFF_TRIGGER_USAGE_RATIO`          |  0.5 | iOS／iPadOS，`off` 的 trigger                                           |
| `UGC_CACHE_IOS_OFF_TARGET_USAGE_RATIO`           |  0.4 | iOS／iPadOS，`off` 的 GC target                                         |
| `UGC_CACHE_IOS_STANDARD_TRIGGER_USAGE_RATIO`     |  0.6 | iOS／iPadOS，`standard` 的 trigger                                      |
| `UGC_CACHE_IOS_STANDARD_TARGET_USAGE_RATIO`      |  0.5 | iOS／iPadOS，`standard` 的 GC target                                    |
| `UGC_CACHE_IOS_GENEROUS_TRIGGER_USAGE_RATIO`     |  0.7 | iOS／iPadOS，`generous` 的 trigger                                      |
| `UGC_CACHE_IOS_GENEROUS_TARGET_USAGE_RATIO`      |  0.6 | iOS／iPadOS，`generous` 的 GC target                                    |

### 14.4 `ui/camera`（跟車 presentation）

| 常數                                             |                  值 | 說明                                             |
| ------------------------------------------------ | ------------------: | ------------------------------------------------ |
| `FOLLOW_CAMERA_DISTANCE_MIN_M`                   |               0.3 m | 跟車偏好直線距離下限                             |
| `FOLLOW_CAMERA_DISTANCE_MAX_M`                   |                 2 m | 跟車偏好直線距離上限                             |
| `FOLLOW_CAMERA_DISTANCE_DEFAULT_M`               |               0.5 m | 舊設定／非有限輸入 fallback 與 HUD 重設值        |
| `FOLLOW_CAMERA_DISTANCE_STEP_M`                  |              0.05 m | HUD 與滑鼠滾輪每次調整量                         |
| `FOLLOW_CAMERA_ELEVATION_RAD`                    | `atan2(0.22, 0.45)` | 固定仰角；後距與高度隨直線距離等比例縮放         |
| `FOLLOW_CAMERA_UPRIGHT_DOT_MIN`                  |                 0.5 | 車體 up 與世界 up 的安全朝向更新門檻             |
| `FOLLOW_CAMERA_HORIZONTAL_EPSILON`               |              0.0001 | 水平車頭投影退化門檻                             |
| `FOLLOW_CAMERA_HEADING_HALF_LIFE_MS`             |              120 ms | 安全 yaw 接回的 elapsed-time half-life           |
| `FOLLOW_CAMERA_POSITION_HALF_LIFE_MS`            |               90 ms | 跟車目標位置平滑 half-life                       |
| `FOLLOW_CAMERA_OBSTRUCTION_RELEASE_HALF_LIFE_MS` |              180 ms | 遮擋解除後向 preferred distance 恢復的 half-life |
| `FOLLOW_CAMERA_GAMEPAD_DEAD_ZONE`                |                0.18 | 手把右搖桿 Y dead zone                           |
| `FOLLOW_CAMERA_GAMEPAD_RATE_M_PER_SEC`           |            0.75 m/s | 手把滿行程距離調整速率                           |
| `FOLLOW_CAMERA_GAMEPAD_MAX_ELAPSED_MS`           |              250 ms | 單次 gamepad 取樣 elapsed 上限，防背景恢復跳滿   |
| `FOLLOW_CAMERA_PERSIST_IDLE_MS`                  |              250 ms | 裝置本機偏好合併寫入 idle 時窗                   |

以上全為本機 presentation 常數，不進 physics、rollback、spectator protocol、room state、ledger 或 checksum（[D-20260810-01](../decisions/D-20260810-01-跟車距離與世界水平穩定視角.md)）。

## 15. `ui/i18n-defaults`（語系預設）

| 常數              | 值                               | 說明 |
| ----------------- | -------------------------------- | ---- |
| `DEFAULT_LANG`    | `'zh-TW'`                        |      |
| `FALLBACK_LANG`   | `'en'`                           |      |
| `SUPPORTED_LANGS` | `['zh-TW', 'zh-CN', 'en', 'ja']` |      |

詳見 [語系清單.md](../語系清單.md)。

## 16. `ui/seo`

| 常數                 | 值                            | 說明                                                                 |
| -------------------- | ----------------------------- | -------------------------------------------------------------------- |
| `CANONICAL_BASE_URL` | `'https://open4wd.org'`       | 正式 canonical；private 期不發布，第一次公開部署即使用 custom domain |
| `OG_IMAGE_PATH`      | `'/assets/og/cover.jpg'`      |                                                                      |
| `OG_IMAGE_WIDTH`     | 1200                          |                                                                      |
| `OG_IMAGE_HEIGHT`    | 630                           |                                                                      |
| `HREFLANG_MAP`       | `{ 'zh-TW': '/zh-TW/', ... }` | i18n hreflang 對應                                                   |

詳見 [部署資訊.md §SEO](../部署資訊.md)。
