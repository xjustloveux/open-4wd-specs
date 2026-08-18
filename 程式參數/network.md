---
type: registry
domain: ["比賽房間", "版本部署"]
summary: 同步、signaling、節點發現與版本參數
authority: null
slug: null
---

# Network

> 本頁是所列 namespace 的內容權威；[程式參數](../程式參數.md) 只提供導覽。

## 8. `network/sync`（網路同步）

| 常數                                                 | 值         | 說明                                                                                                                                         |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROLLBACK_FRAME_BUFFER_DEFAULT`                      | 8          | 輸入可受理／回滾深度基準值；過舊 input（`current - 8` 之前）直接丟棄                                                                         |
| `ROLLBACK_FRAME_BUFFER_MIN`                          | 7          | 界標常數（不變式用）                                                                                                                         |
| `ROLLBACK_FRAME_BUFFER_MAX`                          | 10         | 界標常數（不變式用；`STATE_BUFFER_MAX_FRAMES` ≥ 此值）                                                                                       |
| `STATE_BUFFER_MAX_FRAMES`                            | 12         | **StateBuffer 儲存容量**；精確保留 12 個 pre-step 快照，非一般 input acceptance window；catch-up offer 會複製 pin 對齊候選，不依賴其後續保留 |
| `SNAPSHOT_INTERVAL_FRAMES`                           | 120        | 2 秒                                                                                                                                         |
| `SNAPSHOT_CHECKSUM_BYTES`                            | 32         | SHA-256                                                                                                                                      |
| `MAX_INPUT_EVENTS_PER_FRAME`                         | 4          | chip 技能槽上限；同 skill 每幀至多一筆                                                                                                       |
| `SYNC_SNAPSHOT_MAX_BYTES`                            | 4_194_304  | catch-up SavedState 單包上限（4 MiB）                                                                                                        |
| `RACE_MESSAGE_MAX_BYTES`                             | 4_194_688  | race raw packet 解碼前上限（snapshot 加 wire／PeerId／簽章裕度）                                                                             |
| `INGRESS_INPUT_TOKEN_BUCKET_MESSAGES`                | 120        | 依 DataChannel 真 peer、跨 `drain()` 的 input burst token 容量；合法 60Hz 不得誤丟                                                           |
| `INGRESS_INPUT_TOKEN_REFILL_PER_SECOND`              | 90         | input 持續補充率（tokens/s）；高於合法 60Hz，保留傳輸抖動裕度                                                                                |
| `INGRESS_CONTROL_TOKEN_BUCKET_MESSAGES`              | 32         | checksum 與四種 catch-up 控制訊息的獨立低頻 burst 容量                                                                                       |
| `INGRESS_CONTROL_TOKEN_REFILL_PER_SECOND`            | 32         | 低頻控制訊息持續補充率（tokens/s）；不得借用 input 90/s 配額                                                                                 |
| `INGRESS_TOKEN_BUCKET_BYTES`                         | 4_260_224  | decode 前每 peer、跨 `drain()` raw byte token 容量（單一最大 race packet + 64 KiB）                                                          |
| `INGRESS_TOKEN_BUCKET_REFILL_MS`                     | 1_000      | message/byte token bucket 由空補滿時間；呼叫 `drain()` 不重置                                                                                |
| `VERIFIED_QUEUE_MAX_MESSAGES_PER_PEER`               | 256        | 每 peer 驗簽後尚未 drain 訊息數上限                                                                                                          |
| `VERIFIED_QUEUE_MAX_BYTES_PER_PEER`                  | 4_259_840  | 每 peer 驗簽後 queue byte 預算（4 MiB + 64 KiB）                                                                                             |
| `CONTROL_MESSAGE_MAX_BYTES`                          | 262_144    | ordered control DataChannel 的 DAG-CBOR decode 前單包上限                                                                                    |
| `CHAT_MAX_LENGTH`                                    | 500        | 單則聊天 Unicode code-point 上限                                                                                                             |
| `CHAT_MAX_PER_SECOND`                                | 5          | per-sender 聊天 token bucket 每秒上限                                                                                                        |
| `ROOM_CHAT_MESSAGE_CAPACITY`                         | 20         | host 全房聊天每秒 message bucket 容量／補充率                                                                                                |
| `ROOM_CHAT_BYTE_CAPACITY`                            | 32_000     | host 全房聊天每秒 raw byte bucket 容量／補充率                                                                                               |
| `SPECTATOR_MAX_PENDING_OPENS`                        | 8          | host 同時未完成 spectator channel open 的上限                                                                                                |
| `CONTROL_INGRESS_TOKEN_BUCKET_MESSAGES`              | 32         | 每個真實 remote peer 的 control 訊息 burst 容量                                                                                              |
| `CONTROL_INGRESS_MESSAGE_REFILL_PER_SECOND`          | 16         | control 持續訊息補充率；與 race channel 的 catch-up bucket 分離                                                                              |
| `CONTROL_INGRESS_TOKEN_BUCKET_BYTES`                 | 327_680    | 每 peer control raw byte burst 容量（單包上限 + 64 KiB）                                                                                     |
| `CONTROL_INGRESS_BYTE_REFILL_PER_SECOND`             | 262_144    | control raw byte 持續補充率                                                                                                                  |
| `CONTROL_WIRE_VIOLATION_LIMIT`                       | 3          | oversized／非 binary／畸形或 schema 不符累積到此值即關 link、標記 offline                                                                    |
| `CONTROL_RACE_ID_MAX_BYTES`                          | 256        | key announce 的 raceId UTF-8 byte 上限                                                                                                       |
| `CONTROL_APP_TYPE_MAX_BYTES`                         | 64         | app payload discriminator 的 UTF-8 byte 上限                                                                                                 |
| `CONTROL_KEY_ANNOUNCES_MAX_PER_PEER`                 | 8          | 每 peer 早到 key announce 保留筆數；配合固定 32/64-byte key/signature 與 raceId 上限形成總 byte 硬界                                         |
| `ROOM_INGRESS_TOKEN_BUCKET_MESSAGES`                 | 64         | 每條 waiting-room control link 的一般訊息 burst 容量                                                                                         |
| `ROOM_INGRESS_MESSAGE_REFILL_PER_SECOND`             | 32         | room-control 一般訊息持續補充率                                                                                                              |
| `ROOM_INGRESS_TOKEN_BUCKET_BYTES`                    | 327_680    | room-control 在 decode 前的 raw byte burst 容量（256 KiB 單包上限 + 64 KiB）                                                                 |
| `ROOM_INGRESS_BYTE_REFILL_PER_SECOND`                | 262_144    | room-control raw byte 持續補充率                                                                                                             |
| `ROOM_EXPENSIVE_TOKEN_BUCKET_MESSAGES`               | 8          | OPAQUE／join／state／簽章／grid／chat／match-start 等高成本 wire 的獨立 burst 容量                                                           |
| `ROOM_EXPENSIVE_MESSAGE_REFILL_PER_SECOND`           | 4          | 高成本 room wire 的持續補充率                                                                                                                |
| `ROOM_INGRESS_CONSECUTIVE_DROP_CLOSE_THRESHOLD`      | 16         | oversized、畸形或 quota overflow 連續達此數即關閉 link；成功分派會清除此連續計數                                                             |
| `SPECTATOR_WIRE_MAX_BYTES`                           | 262_144    | source→viewer 非 checkpoint JSON 的 UTF-8 decode 前單包上限                                                                                  |
| `SPECTATOR_REPLAY_WIRE_MAX_BYTES`                    | 5_657_942  | 4 MiB SavedState 的 canonical base64url 加 metadata 裕度；只供 canonical checkpoint prefix                                                   |
| `SPECTATOR_CLIENT_WIRE_MAX_BYTES`                    | 128        | viewer→source exact mode-select 的 decode 前單包上限                                                                                         |
| `SPECTATOR_SOURCE_INGRESS_TOKEN_BUCKET_MESSAGES`     | 120        | source→viewer replay/fallback message burst；容許合法 60Hz replay                                                                            |
| `SPECTATOR_SOURCE_INGRESS_MESSAGE_REFILL_PER_SECOND` | 90         | source→viewer 持續 message 補充率                                                                                                            |
| `SPECTATOR_SOURCE_INGRESS_TOKEN_BUCKET_BYTES`        | 6_706_518  | 一份最大 checkpoint 加 1 MiB late-join backlog 的 raw byte burst                                                                             |
| `SPECTATOR_SOURCE_INGRESS_BYTE_REFILL_PER_SECOND`    | 4_194_304  | source→viewer 持續 raw byte 補充率                                                                                                           |
| `SPECTATOR_CHECKPOINT_TOKEN_BUCKET_MESSAGES`         | 1          | 大型 checkpoint 在 UTF-8／JSON 前的獨立 burst                                                                                                |
| `SPECTATOR_CHECKPOINT_MESSAGE_REFILL_PER_SECOND`     | 0.2        | 大型 checkpoint 最快每 5 秒補一個 token                                                                                                      |
| `SPECTATOR_VIEWER_INGRESS_TOKEN_BUCKET_MESSAGES`     | 8          | viewer→source mode-select burst                                                                                                              |
| `SPECTATOR_VIEWER_INGRESS_MESSAGE_REFILL_PER_SECOND` | 4          | viewer→source 持續 message 補充率                                                                                                            |
| `SPECTATOR_VIEWER_INGRESS_TOKEN_BUCKET_BYTES`        | 1_024      | viewer→source raw byte burst                                                                                                                 |
| `SPECTATOR_VIEWER_INGRESS_BYTE_REFILL_PER_SECOND`    | 512        | viewer→source 持續 raw byte 補充率                                                                                                           |
| `SPECTATOR_INGRESS_CONSECUTIVE_DROP_CLOSE_THRESHOLD` | 16         | 任一方向 oversized、畸形或 quota overflow 連續達此數即關閉 spectator link                                                                    |
| `SYNC_REQUEST_COOLDOWN_FRAMES`                       | 120        | 同 peer 成功把完整 snapshot 交給 DataChannel 後 2 秒內不再服務；send false/throw 不啟動 cooldown，保留 pinned offer 供同 request 重試        |
| `CATCH_UP_OFFER_ALIGNMENT_FRAMES`                    | 8          | offer candidate 對齊間隔；最近兩個候選讓 current 相差最多 7 幀的 peers 仍可共享一個 aligned frame                                            |
| `CATCH_UP_OFFER_CANDIDATES`                          | 2          | 每個 requester offer 最多 pin 的 snapshot 數量                                                                                               |
| `CATCH_UP_OFFER_TTL_FRAMES`                          | 900        | pinned offer TTL（15 秒 reconnect horizon）                                                                                                  |
| `CATCH_UP_PROBE_TIMEOUT_FRAMES`                      | 60         | signed offer 遺失時的 probe timeout；逾時以**相同 offerId**重送，讓 responder 重用 pinned bytes/hash                                         |
| `CATCH_UP_PROBE_RETRY_LIMIT`                         | 2          | 每個 peer 在 t=60／120 以相同 offerId bounded 重送；t=180 才結束等待且不再送                                                                 |
| `CATCH_UP_PROBE_REPLACE_AFTER_FRAMES`                | 120        | 新且單調 requestId 最早可安全取代舊 attempt 的時間，恰與最後一次重送重合；更早的新 id 與所有 unordered 舊 id 均拒絕                          |
| `CATCH_UP_REQUEST_TIMEOUT_FRAMES`                    | 300        | 4 MiB snapshot 等待 5 秒；逾時先取消 transport pending，再切換下一 voter                                                                     |
| `CATCH_UP_OFFER_MAX_ENTRIES`                         | 8          | responder 全域 pinned offer entry 上限；同 requester 同 offerId 冪等重送不重複 copy/hash                                                     |
| `CATCH_UP_OFFER_MAX_BYTES`                           | 67_108_864 | 全域 pinned snapshot byte 硬上限（8 × 2 × 4 MiB）；超額 fail-closed                                                                          |
| `PEER_DESYNC_TOLERANCE_FRAMES`                       | 30         | checksum 等待容差（0.5 秒；逾窗未到 = 該輪缺席、不阻塞多數決）                                                                               |
| `CATCH_UP_MAX_ADVANCE_FRAMES`                        | 900        | 重連 catch-up 快照相對請求幀的最大前跳（15 秒 × 60Hz）；超界回應丟棄，防簽章 peer 以巨幅未來幀凍結／跳過賽程                                 |
| `CHECKSUM_PAST_HORIZON_FRAMES`                       | 150        | 已逾 checksum 週期 120 + 等待窗 30 的舊票丟棄，不得重建票倉                                                                                  |
| `DESYNC_STRIKE_LIMIT`                                | 3          | 連續 checksum mismatch 達此值 → persistent-desync（mismatch 不 rollback、僅累積）                                                            |
| `SPECTATOR_BROADCAST_INTERVAL_MS`                    | 100        | 僅精簡 presentation fallback 的 state broadcast 10Hz；deterministic replay 不使用此節拍                                                      |

## 9. `network/signaling`（連線握手）

| 常數                            | 值                 | 說明                                                                                                                                        |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDSHAKE_TIMEOUT_MS`          | 30_000             |                                                                                                                                             |
| `TURN_TOKEN_TTL_SEC`            | 300                | TURN REST auth 憑證 TTL（signaling 發放、coturn shared secret 驗證；部署資訊 [§4.3](../部署資訊.md#43-turn--stuncoturnopen-4wd-turn-repo)） |
| `TURN_TOKEN_RESPONSE_MAX_BYTES` | 32 × 1024          | client 讀取 `/turn-token` 成功回應的 byte 硬上限；先驗 `Content-Length`，無宣告時逐 chunk 累計，超限立即 cancel                             |
| `RETRY_MAX`                     | 3                  |                                                                                                                                             |
| `RETRY_BACKOFF_MS`              | [1000, 2000, 4000] |                                                                                                                                             |

**伺服器端常數（`open-4wd-signaling` repo）**——單一權威在本表；repo 規格檔（[部署資訊/open-4wd-signaling.md §3](../部署資訊/open-4wd-signaling.md)）的 env 表引用之。下表前四個具名常數加上本節 client 表的 `TURN_TOKEN_TTL_SEC`，由 signaling `pnpm check:constants` 透過 `O4_SPECS_DIR` 或 sibling workspace 比對；值 drift hard fail。`MAX_PEERS` 另由 signaling `protocol-limits` 與 client parser 做協定同值檢查，其他列不納入 owner gate：

| 常數                         | 值      | 說明                                                                                                    |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `RATE_LIMIT_PER_MIN`         | 60      | 每 IP 每分鐘連線級限流，逾額 429（預設值；部署 env 可調）                                               |
| `PEER_TIMEOUT_MS`            | 90_000  | 成員存活逾時（**唯一時窗旋鈕**、部署 env 可調）；ping 間隔派生＝本值 1/3（「容許連丟兩次 pong」不變量） |
| `REGISTER_DEADLINE_MS`       | 10_000  | 連線須在此窗內完成 register 否則關閉（固定常數、不開放 env）                                            |
| `MESSAGE_RATE_LIMIT_PER_MIN` | 1_200   | 已註冊連線的訊息級限流（每連線每分鐘）；逾額靜默丟棄不斷線                                              |
| `MAX_PEERS`                  | 64      | 單一 signaling room 的已註冊連線上限；觀戰者 register 亦短暫佔一席，超額回 `room-full`                  |
| 傳輸層 maxPayload            | 256 KiB | ws 單 frame 上限＝協定單訊息上限（`MAX_WIRE_BYTES`）同值；超限由 ws 以 1009 關閉                        |

### 9.1 `network/providers`（公開 provider 觀測）

| 常數                                        | 值  | 說明                                                                                                             |
| ------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------- |
| `LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED` | 3   | 公開帳本 bootstrap 與健康 pinning 服務的 best-effort 獨立 provider 故障域建議；只供 UI／維運觀測，不構成留存保證 |

## 10. `network/peer-discovery`（節點發現）

| 常數                                 | 值         | 說明                                                          |
| ------------------------------------ | ---------- | ------------------------------------------------------------- |
| `BOOTSTRAP_DIAL_TIMEOUT_MS`          | 15_000     |                                                               |
| `DHT_QUERY_TIMEOUT_MS`               | 10_000     |                                                               |
| `DHT_QUERY_SELF_INTERVAL_MS`         | 600_000    | kad-dht `querySelfInterval`；10 分鐘                          |
| `ROOM_REANNOUNCE_INTERVAL_MS`        | 30_000     | 公開房公告／presence 名目刷新間隔；timer 只負責喚醒           |
| `ROOM_PRESENCE_LEASE_TTL_MS`         | 120_000    | 公告 lease；涵蓋一分鐘級背景節流的一次漏拍與網路延遲          |
| `ROOM_TTL_MAX_MS`                    | 300_000    | 接收端自報 TTL 生效上限，防超長 lease 灌表                    |
| `TOPIC_RATE_WINDOW_MS`               | 60_000     | 每 authenticated source 跨所有 topic 共用的訊息限速窗（初估） |
| `TOPIC_RATE_MAX_PER_WINDOW`          | 30         | source 跨 topic 窗內合計上限、逾額丟棄（初估）                |
| `TOPIC_RATE_COUNTERS_MAX`            | 4096       | source counter map 硬上限；滿載時淘汰最久未活動來源           |
| `GOSSIP_SOURCE_STATES_MAX`           | 4096       | per-source replay registry 狀態硬上限；LRU 淘汰               |
| `GOSSIP_NONCES_PER_SOURCE_MAX`       | 64         | 單一 authenticated source 的 replay nonce 上限                |
| `GOSSIP_MESSAGE_MAX_BYTES`           | 65_536     | dag-cbor decode 前的單訊息 64 KiB 上限                        |
| `GOSSIP_GLOBAL_WINDOW_MS`            | 60_000     | 不隨 source LRU churn 重置的全來源固定窗口                    |
| `GOSSIP_GLOBAL_RAW_BYTES_MAX`        | 67_108_864 | 全來源 raw bytes／window；在 dag-cbor decode 前扣額度         |
| `GOSSIP_GLOBAL_RAW_MESSAGES_MAX`     | 4096       | 全來源 raw messages／window                                   |
| `GOSSIP_GLOBAL_VERIFICATIONS_MAX`    | 2048       | 全來源 signature verification tokens／window                  |
| `GOSSIP_PAYLOAD_MAX_DEPTH`           | 8          | room／match／signal payload 巢狀深度上限                      |
| `GOSSIP_PAYLOAD_MAX_ENTRIES`         | 512        | payload 可遍歷 entries 總上限                                 |
| `GOSSIP_STRING_MAX_BYTES`            | 32_768     | payload 單字串 UTF-8 bytes 上限                               |
| `GOSSIP_MULTIADDR_MAX_CHARS`         | 2048       | multiaddr 字串長度上限                                        |
| `GOSSIP_RESOURCE_ID_MAX_CHARS`       | 512        | room／match 資源識別字長度上限                                |
| `GOSSIPSUB_MESH_DEGREE`              | 6          | GossipSub 原生 mesh 目標 `D`                                  |
| `GOSSIPSUB_HEARTBEAT_INTERVAL_MS`    | 1000       | GossipSub 原生 `heartbeatInterval`                            |
| `GOSSIPSUB_SCORE_GOSSIP_THRESHOLD`   | -10        | GossipSub 原生 `gossipThreshold`                              |
| `GOSSIPSUB_SCORE_PUBLISH_THRESHOLD`  | -50        | GossipSub 原生 `publishThreshold`                             |
| `GOSSIPSUB_SCORE_GRAYLIST_THRESHOLD` | -80        | GossipSub 原生 `graylistThreshold`                            |

## 11. `network/versioning`（版本升版）

| 常數                             | 值         | 說明                                                                                                                                                                                                                                           |
| -------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROTOCOL_VERSION_CURRENT`       | `'1.0.0'`  | 尚未公開發版前直接確立的首個基線：current SavedState（零件損毀交易、直接致毀統計、Track Entity intact lifecycle、projectile clearance、route progress、weather scheduler／active descriptors）、strict input/catch-up admission 與 quorum sync |
| `CLIENT_VERSION_CURRENT`         | `'0.1.0'`  | 當前 client 版本                                                                                                                                                                                                                               |
| `RAPIER_VERSION_CURRENT`         | `'0.19.3'` | 當前 Rapier 版本（6 版本欄位之 `rapier_version`，[版本規範.md §1](../版本規範.md)）                                                                                                                                                            |
| `DERIVE_LOGIC_VERSION_CURRENT`   | 1          | 當前 derive_logic 版本                                                                                                                                                                                                                         |
| `BUILTIN_ASSETS_VERSION_CURRENT` | 1          | Pre-launch 首發 baseline；目前 candidate 含 LaunchExit 幾何離膛與純視覺碎片 descriptor rebake，正式公開前不保留舊公版 bytes 相容層                                                                                                             |
| `FINGERPRINT_VERSION`            | 1          | 指紋演算法版本（**derive_logic 軸**、隨 client 發版 +1；舊作品鎖原版、跨版本比對一律放行；impl 落點 `src/ugc-fork`）                                                                                                                           |
| `UPDATE_CHECK_INTERVAL_MS`       | 3_600_000  | 每小時檢查升版                                                                                                                                                                                                                                 |
| `UPDATE_FORCE_GRACE_PERIOD_MS`   | 86_400_000 | 24 小時軟性升級寬限                                                                                                                                                                                                                            |
| `VERSION_COLLECT_TIMEOUT_MS`     | 3_000      | 開賽前收集各 peer 版本的等待窗                                                                                                                                                                                                                 |
| `VERSION_COLLECT_RETRY`          | 1          | 版本收集逾時重廣播次數                                                                                                                                                                                                                         |

> 上表為 **A 軸 client 版本**。**B 軸資產 schema 的 per-type 最低支援版不是靜態常數**，而是 ledger 衍生的動態值（由 `DEPRECATED_TO_UNUSABLE_THRESHOLD` + 鏈上升級件數推導、單調 ratchet），見 [版本規範.md §19](../版本規範.md) 與 [資料系統.md §4 `AssetVersionDerivedState`](../資料系統.md)。client 僅靜態保有各 schema 版本的映射路徑（供降版本運算）。
