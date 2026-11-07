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

本表是 protocol 綁定常數：任一值改動都可能讓同場 peer 對訊息受理範圍、回滾窗或終局產生不同判斷，須升 protocol major、不協商（[共通規則.md §20](共通規則.md#20-變更流程)）。輸入延遲 D、回滾窗 R 與相關上限由 [D-20261028-03](../decisions/D-20261028-03-輸入延遲有界回滾與模擬Worker.md) 推導，彼此關係由 [共通規則.md §19.2](共通規則.md#192-常數不變式pnpm-run-checkinvariants) 的不變式守門；語意見 [network-sync.md §2–§3](../程式架構/network-sync.md)。catch-up 輸入日誌的兩個衍生上限 `SYNC_INPUT_LOG_MAX_SPAN_FRAMES`（＝`CATCH_UP_OFFER_TTL_FRAMES` ＋ `STATE_BUFFER_MAX_FRAMES`）與 `SYNC_INPUT_LOG_MAX_BYTES`（最壞日誌 wire 長度，現值 617,385 B）由下表常數推導、定義在 wire 編解碼模組，不另列常數。

| 常數                                                 | 值         | 說明                                                                                                                                         |
| ---------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `INPUT_DELAY_FRAMES` | 6 | 固定輸入延遲 D：本機在 frame c 取樣的技能事件排到 c+D 才生效；全房同值、不協商（D-20261028-03） |
| `ROLLBACK_FRAME_BUFFER_DEFAULT` | 2 | 輸入可受理／回滾深度基準值 R；過舊 input（`current - 2` 之前）直接丟棄 |
| `ROLLBACK_FRAME_BUFFER_MAX` | 3 | 回滾頓挫上限 R_max（不變式用；R ≤ 此值） |
| `SKILL_INPUT_DELAY_MAX_MS` | 100 | 技能反應延遲上限；不變式 D×1000 ≤ 此值×`FIXED_FRAMERATE_HZ` |
| `NETWORK_ONE_WAY_LATENCY_TOLERANCE_MS` | 133 | 單向網路延遲容忍；不變式 (D+R)×1000 ≥ 此值×`FIXED_FRAMERATE_HZ` |
| `STATE_BUFFER_MAX_FRAMES` | 12 | **StateBuffer 稀疏快照保留時窗（幀）**；只保留距最近一次寫入 12 幀內的前緣／對齊快照，不保證每幀皆有；非一般 input acceptance window；catch-up offer 會複製 pin 對齊候選，不依賴其後續保留 |
| `SNAPSHOT_INTERVAL_FRAMES`                           | 120        | 2 秒                                                                                                                                         |
| `SNAPSHOT_CHECKSUM_BYTES`                            | 32         | SHA-256                                                                                                                                      |
| `MAX_INPUT_EVENTS_PER_FRAME`                         | 4          | chip 技能槽上限；同 skill 每幀至多一筆                                                                                                       |
| `SYNC_SNAPSHOT_MAX_BYTES`                            | 4_194_304 | catch-up 單包上限（4 MiB）：快照＋輸入日誌合計；offer 候選快照須 ≤ 本值減 `SYNC_INPUT_LOG_MAX_BYTES`；不可變形狀以登錄參照寫入快照後公版三場八車最大 1,170,176 B（27.9%，snowy-heavy8 960 幀）（[D-20261028-02](../decisions/D-20261028-02-靜態形狀登錄參照快照.md)），001091 的短期 8 MiB 已撤回 |
| `RACE_MESSAGE_MAX_BYTES`                             | 4_194_688 | race raw packet 解碼前上限（snapshot 加 wire／PeerId／簽章裕度）                                                                             |
| `INGRESS_INPUT_TOKEN_BUCKET_MESSAGES`                | 120        | 依 DataChannel 真 peer、跨 `drain()` 的 input burst token 容量；合法 60Hz 不得誤丟                                                           |
| `INGRESS_INPUT_TOKEN_REFILL_PER_SECOND`              | 90         | input 持續補充率（tokens/s）；高於合法 60Hz，保留傳輸抖動裕度                                                                                |
| `INGRESS_CONTROL_TOKEN_BUCKET_MESSAGES`              | 32         | checksum 與四種 catch-up 控制訊息的獨立低頻 burst 容量                                                                                       |
| `INGRESS_CONTROL_TOKEN_REFILL_PER_SECOND`            | 32         | 低頻控制訊息持續補充率（tokens/s）；不得借用 input 90/s 配額                                                                                 |
| `INGRESS_TOKEN_BUCKET_BYTES`                         | 4_260_224 | decode 前每 peer、跨 `drain()` raw byte token 容量（單一最大 race packet + 64 KiB）                                                          |
| `INGRESS_TOKEN_BUCKET_REFILL_MS`                     | 1_000      | message/byte token bucket 由空補滿時間；呼叫 `drain()` 不重置                                                                                |
| `VERIFIED_QUEUE_MAX_MESSAGES_PER_PEER`               | 256        | 每 peer 驗簽後尚未 drain 訊息數上限                                                                                                          |
| `VERIFIED_QUEUE_MAX_BYTES_PER_PEER`                  | 4_259_840 | 每 peer 驗簽後 queue byte 預算（4 MiB + 64 KiB） |
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
| `SPECTATOR_REPLAY_WIRE_MAX_BYTES`                    | 5_657_942 | 4 MiB SavedState 的 canonical base64url 加 metadata 裕度；只供 canonical checkpoint prefix |
| `SPECTATOR_CLIENT_WIRE_MAX_BYTES`                    | 128        | viewer→source exact mode-select 的 decode 前單包上限                                                                                         |
| `SPECTATOR_SOURCE_INGRESS_TOKEN_BUCKET_MESSAGES`     | 120        | source→viewer replay/fallback message burst；容許合法 60Hz replay                                                                            |
| `SPECTATOR_SOURCE_INGRESS_MESSAGE_REFILL_PER_SECOND` | 90         | source→viewer 持續 message 補充率                                                                                                            |
| `SPECTATOR_SOURCE_INGRESS_TOKEN_BUCKET_BYTES`        | 6_706_518 | 一份最大 checkpoint 加 1 MiB late-join backlog 的 raw byte burst                                                                             |
| `SPECTATOR_SOURCE_INGRESS_BYTE_REFILL_PER_SECOND`    | 4_194_304  | source→viewer 持續 raw byte 補充率                                                                                                           |
| `SPECTATOR_CHECKPOINT_TOKEN_BUCKET_MESSAGES`         | 1          | 大型 checkpoint 在 UTF-8／JSON 前的獨立 burst                                                                                                |
| `SPECTATOR_CHECKPOINT_MESSAGE_REFILL_PER_SECOND`     | 0.2        | 大型 checkpoint 最快每 5 秒補一個 token                                                                                                      |
| `SPECTATOR_VIEWER_INGRESS_TOKEN_BUCKET_MESSAGES`     | 8          | viewer→source mode-select burst                                                                                                              |
| `SPECTATOR_VIEWER_INGRESS_MESSAGE_REFILL_PER_SECOND` | 4          | viewer→source 持續 message 補充率                                                                                                            |
| `SPECTATOR_VIEWER_INGRESS_TOKEN_BUCKET_BYTES`        | 1_024      | viewer→source raw byte burst                                                                                                                 |
| `SPECTATOR_VIEWER_INGRESS_BYTE_REFILL_PER_SECOND`    | 512        | viewer→source 持續 raw byte 補充率                                                                                                           |
| `SPECTATOR_INGRESS_CONSECUTIVE_DROP_CLOSE_THRESHOLD` | 16         | 任一方向 oversized、畸形或 quota overflow 連續達此數即關閉 spectator link                                                                    |
| `DATA_CHANNEL_MESSAGE_FALLBACK_BYTES`               | 65_536     | SCTP `maxMessageSize` 未知或非法時的單訊息上限（RFC 8841 未宣告 `max-message-size` 的預設值） |
| `DATA_CHANNEL_MESSAGE_SAFE_MAX_BYTES`                | 262_144    | 單訊息安全上限（Chromium 協商值）；實際上限＝min(協商值, 此值) |
| `DATA_CHANNEL_FRAGMENT_HEADER_BYTES`                 | 21         | 分段框標頭：marker `0xff`＋messageId／index／count／totalLength／fragmentBytes 各 u32 big-endian |
| `DATA_CHANNEL_FRAGMENT_MIN_PAYLOAD_BYTES`            | 16_384     | 多段訊息每段（末段除外）最小酬載；限制單訊息段數與標頭放大，協商上限容不下時整筆不送 |
| `DATA_CHANNEL_REASSEMBLY_TIMEOUT_MS`                 | 5_000      | 未完成重組的逾時：control 與 spectator 自首段起；race 自最近一段起（閒置），另受推導常數 `RACE_REASSEMBLY_MAX_DURATION_MS` 總上限（[network-sync.md §6.1](../程式架構/network-sync.md#61-應用層分段issue-001093)）；＝`CATCH_UP_REQUEST_TIMEOUT_FRAMES` 換算毫秒（不變式） |
| `DATA_CHANNEL_SEND_BUFFER_MAX_BYTES`                 | 16_777_216 | 多段訊息送第一段前 `bufferedAmount`＋全部段長的上限（Chromium 送出佇列 16 MiB 即關通道）；超量整筆不送 |
| `RACE_REASSEMBLY_MAX_BYTES_PER_PEER`                 | 4_259_840  | race 通道每 peer 未完成重組位元組上限＝`VERIFIED_QUEUE_MAX_BYTES_PER_PEER`（≥ `RACE_MESSAGE_MAX_BYTES`） |
| `CONTROL_REASSEMBLY_MAX_BYTES_PER_PEER`              | 327_680    | control 通道每 peer 未完成重組位元組上限＝`CONTROL_INGRESS_TOKEN_BUCKET_BYTES` |
| `SPECTATOR_REASSEMBLY_MAX_BYTES_PER_PEER`            | 6_706_518 | 觀戰 source→viewer 每連線未完成重組位元組上限＝`SPECTATOR_SOURCE_INGRESS_TOKEN_BUCKET_BYTES` |
| `SYNC_REQUEST_COOLDOWN_FRAMES`                       | 120        | 同 peer 成功把完整 snapshot 交給 DataChannel 後 2 秒內不再服務；send false/throw 或回執未交付不啟動 cooldown，保留 pinned offer，由 responder 依 `SYNC_RESPONSE_RESEND_LIMIT` 自動重送同一 request |
| `CATCH_UP_OFFER_ALIGNMENT_FRAMES` | 8 | offer candidate 對齊間隔，與回滾視窗 R 脫鉤；current 相差最多 7 幀的 peers 仍可共享一個 aligned frame；只取已 final（≤ current − R）的對齊幀 |
| `CATCH_UP_OFFER_CANDIDATES`                          | 2          | 每個 requester offer 最多 pin 的已 final 對齊 snapshot 數量；剛過對齊幀後的 R 幀內只有一個合格候選                                           |
| `CATCH_UP_OFFER_TTL_FRAMES`                          | 900        | pinned offer TTL（15 秒 reconnect horizon）                                                                                                  |
| `CATCH_UP_PROBE_TIMEOUT_FRAMES`                      | 60         | signed offer 遺失時的 probe timeout；逾時以**相同 offerId**重送，讓 responder 重用 pinned bytes/hash                                         |
| `CATCH_UP_PROBE_RETRY_LIMIT`                         | 2          | 每個 peer 在 t=60／120 以相同 offerId bounded 重送；t=180 才結束等待且不再送                                                                 |
| `CATCH_UP_PROBE_REPLACE_AFTER_FRAMES`                | 120        | 新且單調 requestId 最早可安全取代舊 attempt 的時間，恰與最後一次重送重合；更早的新 id 與所有 unordered 舊 id 均拒絕                          |
| `CATCH_UP_REQUEST_TIMEOUT_FRAMES`                    | 300        | 完整快照請求的無進展逾時（5 秒）：自最近一次進展（送出請求、傳輸進度心跳、到達、日誌驗簽心跳）起算，分段持續到達或驗簽持續推進即順延；傳輸另受推導常數 `SYNC_RESPONSE_TRANSFER_MAX_STEPS`、驗簽受 `SYNC_LOG_VERIFY_MAX_STEPS` 封頂（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 2 步）；逾時先取消 transport pending，再切換下一 voter |
| `CATCH_UP_OFFER_MAX_ENTRIES`                         | 8          | responder 全域 pinned offer entry 上限；同 requester 同 offerId 冪等重送不重複 copy/hash                                                     |
| `CATCH_UP_OFFER_MAX_BYTES`                           | 67_108_864 | 全域 pinned snapshot byte 硬上限（8 × 2 × 4 MiB）；超額 fail-closed |
| `PEER_DESYNC_TOLERANCE_FRAMES`                       | 30         | checksum 等待容差（0.5 秒；逾窗未到 = 該輪缺席、不阻塞多數決）                                                                               |
| `CATCH_UP_MAX_ADVANCE_FRAMES`                        | 900        | 重連 catch-up 快照相對請求幀的最大前跳（15 秒 × 60Hz）；超界回應丟棄，防簽章 peer 以巨幅未來幀凍結／跳過賽程                                 |
| `CHECKSUM_PAST_HORIZON_FRAMES`                       | 150        | 已逾 checksum 週期 120 + 等待窗 30 的舊票丟棄，不得重建票倉                                                                                  |
| `DESYNC_STRIKE_LIMIT`                                | 3          | 連續 checksum mismatch 達此值 → persistent-desync（mismatch 不 rollback、僅累積）                                                            |
| `SPECTATOR_BROADCAST_INTERVAL_MS`                    | 100        | 僅精簡 presentation fallback 的 state broadcast 10Hz；deterministic replay 不使用此節拍                                                      |

### 8.1 `network/perf`（效能預算口徑）

非協定常數：不進 wire、快照或 hash，改值不升 protocol；只影響本機效能閘與警告（[D-20261028-04](../decisions/D-20261028-04-效能預算三層口徑.md)）。公式、量測口徑與效能警告判定只寫在 [network-sync.md §8](../程式架構/network-sync.md)。

| 常數 | 值 | 說明 |
| ---- | -- | ---- |
| `PERF_LOW_END_FACTOR` | 2 | 最低支援裝置相對參考機的慢速倍數 k；L0 預算＝T ÷ k |
| `PERF_STEADY_HEADROOM_DIVISOR` | 2 | L1 穩態餘裕除數：P50 每幀實付 ≤ T ÷ 此值 |
| `PERF_ROLLBACK_STUTTER_FRAMES` | 3 | L2 回滾頓挫預算（幀數）：P95 最深回滾事件耗時 ≤ 此值 × T；不除以 k |
| `PERF_SNAPSHOT_BYTES_TARGET_DIVISOR` | 4 | 快照 bytes 目標除數：目標＝`SYNC_SNAPSHOT_MAX_BYTES` ÷ 此值 |

### 8.2 `network/local-policy`（本機處置政策）

非協定常數：只決定本機如何處置自己的落後與重同步，不進 wire、快照或 hash，改值不升 protocol。快進、分 tick 追趕、`front` 夾限、驗簽分片與 WebCrypto 逾時等常數的取捨見 [D-20261029-03](../decisions/D-20261029-03-catch-up分tick追趕與落後端快進.md)。追趕無進展期限、追趕中背景恢復上限與日誌驗簽總上限的取捨見 [D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)。快進上界（三人以上 D＋R、兩人場 2×`STATE_BUFFER_MAX_FRAMES`）與越窗卡頓轉 catch-up 見 [D-20261030-05](../decisions/D-20261030-05-越窗卡頓改走catch-up.md)，不新增常數。catch-up 依快照傳輸時間順延 `front`、傳輸期間以進度順延請求逾時、`front` 越界不記 misbehavior，同樣不新增 local-policy 常數，傳輸總上限、race 重組總上限與 sync-response 段長為下表的推導常數。

| 常數 | 值 | 說明 |
| ---- | -- | ---- |
| `PERSISTENT_LAG_DEMOTE_FRAMES` | 300 | 嚴格過半且至少兩名遠端的最近 lead > R 連續達此幀數（5 秒）即自我驅逐 `lag-evicted`（不自動以觀戰者重新加入，[network-sync.md §7.3](../程式架構/network-sync.md)）；同值也是 catch-up 追趕的無進展期限：追趕差距連續此數個正常 step 沒有縮小即同樣以 `lag-evicted` 自我退出（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 6 步）；不變式：> `STATE_BUFFER_MAX_FRAMES` × 2 |
| `SPECTATOR_REPLAY_RESYNC_LIMIT` | 3 | 觀戰 replay checksum 失配時允許連續重求 checkpoint 的次數；第 4 次連續失配才降級為精簡 fallback，成功對帳一次即歸零（[spectator.md §3](../程式架構/spectator.md)）；不變式：≥ 1 |
| `CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS` | 2 | 落後端快進：每個 render tick 在固定步之外最多追加的步數；嚴格多數 lead 在 (R, 上界] 時啟動，上界三人以上為 D＋R、兩人場為 2×`STATE_BUFFER_MAX_FRAMES`（規則見 [network-sync.md §7.5](../程式架構/network-sync.md#75-幀時鐘偏移與落後端快進)）；不變式：1 ≤ 值 ≤ `MAX_SUBSTEPS` |
| `CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES` | 0 | 落後端快進的停止點：嚴格多數遠端 lead ≤ 此值即停止；比「lead ≤ R」多留裕度（[network-sync.md §7.5](../程式架構/network-sync.md#75-幀時鐘偏移與落後端快進)，已知限制 issue 001127）；不變式：< `ROLLBACK_FRAME_BUFFER_DEFAULT` |
| `CATCH_UP_CHASE_TICK_BUDGET_MS` | 10 | catch-up 分 tick 追趕：每個 render tick 推進追趕幀的牆鐘預算（毫秒，自 tick 開始計、含本 tick 固定步耗時；至少一幀；[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 6 步）；不變式：0 < 值 < 1000 / `FIXED_FRAMERATE_HZ` |
| `SYNC_RESPONSE_RESEND_LIMIT` | 2 | catch-up responder 對未交給通道的 sync-response 自動重送同一 request 的次數上限（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 3 步）；不變式：≥ 1 |
| `CATCH_UP_MAX_OBSERVED_AHEAD_FRAMES` | 24 | catch-up 參考幀的觀測上限：只採計不超過本機 current＋`CATCH_UP_MAX_ADVANCE_FRAMES`＋此值（現值 current＋900＋24）的遠端觀測；以可 catch-up 的最大前跳為基準再加一個未來窗——只用 current＋此值會讓落後超過約 32 幀的恢復端失去所有觀測（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 5 步）；不變式：D+R ≤ 值 ≤ `STATE_BUFFER_MAX_FRAMES` × 2 |
| `CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES` | 4 | catch-up `front` 夾限下界：provider 的 front 依本機量得的快照傳輸步數與到達後步數順延後，低於參考幀超過此值即拒收、換下一位 voter（不記 misbehavior；[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 5 步）。依實測：mesh harness 誠實情境（4、8 人；固定單程 1、2、4、8 幀與 1..6 幀抖動；seed 20..31）的 front − 參考幀最小 −3、最大 +3，取最小值 − 1；sync-response 另加 0..536 幀傳輸時間（3、8 人；固定單程 1..5 與 1..4 抖動）時，順延後誠實差固定延遲恆為 0、抖動 −2..+2，零拒收；保證範圍同 catch-up 後單程抖動 1..6；不變式：1 ≤ 值 < D+R |
| `SYNC_LOG_VERIFY_SLICE_MS` | 4 | catch-up 日誌驗簽分片：每片的牆鐘預算（毫秒，至少一筆），片間讓出主執行緒（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 4 步）；不變式：0 < 值 < 1000 / `FIXED_FRAMERATE_HZ` |
| `SYNC_LOG_VERIFY_ENTRY_MAX_MS` | 1.5 | catch-up 日誌驗簽總上限的單筆成本上界（毫秒，[D-20261029-04](../decisions/D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)）：`SYNC_LOG_VERIFY_MAX_STEPS`＝ceil(`SYNC_INPUT_LOG_MAX_ENTRIES` × 此值 × `FIXED_FRAMERATE_HZ` ÷ 1000)（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 2 步）。依實測：Firefox 主執行緒 noble 驗 7504 筆 7241 ms（約 0.97 ms／筆），取約 1.5 倍裕度涵蓋分片讓出與主執行緒分時；不涵蓋 Chromium 4× 降頻的 noble（約 2.34 ms／筆）。上限不得長於 offer TTL：快照階段本機照常 step、落後不隨驗簽累加，約束來自各 voter 在 probe 時 pin 的 offer 會在 `CATCH_UP_OFFER_TTL_FRAMES` 後過期；不變式：`CATCH_UP_REQUEST_TIMEOUT_FRAMES` ≤ 換算步數 ≤ `CATCH_UP_OFFER_TTL_FRAMES` |
| `SIGNATURE_VERIFY_TIMEOUT_MS` | 50 | 非同步驗簽逾時：WebCrypto Ed25519 的 import／verify 超過此牆鐘時間（毫秒）未完成即改以 noble 判定（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊)「驗簽器」）；依據為合法情境最壞的單則 await 往返 P95 約 2.6 ms（低階裝置模擬、7 則同時等待），取約 20 倍裕度；不變式：1000 / `FIXED_FRAMERATE_HZ` ≤ 值 ≤ `INPUT_DELAY_FRAMES` × 1000 / `FIXED_FRAMERATE_HZ` |

**模組層推導常數**：下列值不在 `@open4wd/system-constants`，由上表與 [§8](#8-networksync網路同步) 的常數在模組內推得，改值只能經由改動來源常數。

| 模組常數 | 所在模組 | 推導 | 現值 | 說明 |
| -------- | -------- | ---- | ---- | ---- |
| `SYNC_RESPONSE_RESEND_SPACING_STEPS` | `network-sync/rollback-engine` | `MAX_SUBSTEPS`＋`CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS` | 6 步 | sync-response 第二次起的重送間隔（第一次為下一步）：一個 render tick 至多此步數，間隔必跨 tick，同一 tick（`bufferedAmount` 不會下降）內不會連續用完重送次數 |
| `SYNC_LOG_VERIFY_MAX_STEPS` | `network-sync/rollback-engine` | ceil(`SYNC_INPUT_LOG_MAX_ENTRIES` × `SYNC_LOG_VERIFY_ENTRY_MAX_MS` × `FIXED_FRAMERATE_HZ` ÷ 1000) | 676 步 | sync-response 到達後，日誌驗簽心跳可順延快照請求逾時的總上限（自到達起算）；惡意 provider 對單一 voter 的驗簽拖延也以此封頂 |
| `CHASE_SUSPENSION_MAX_FRAMES` | `network-sync/rollback-engine` | min(`STATE_BUFFER_MAX_FRAMES` × 2, floor(`VERIFIED_QUEUE_MAX_MESSAGES_PER_PEER` × `SNAPSHOT_INTERVAL_FRAMES` ÷ (`SNAPSHOT_INTERVAL_FRAMES`＋1))) | 24 幀 | catch-up 追趕中背景恢復時可直接延長追趕目標的隱藏幀數上限；後項＝每遠端每幀一則 input、每 `SNAPSHOT_INTERVAL_FRAMES` 幀一則 checksum 時已驗佇列不丟訊息的幀數（253），取較保守的前項；超過即結束追趕、重新 catch-up |
| `CACHE_AHEAD_LIMIT_FRAMES` | `network-sync/race-transport` | `CATCH_UP_MAX_ADVANCE_FRAMES`＋`STATE_BUFFER_MAX_FRAMES` × 2 | 924 幀 | 已驗快取只收不超過本機最近簽出幀＋此值的 input，避免荒謬幀號把整個快取修剪掉 |
| `CACHE_RETAIN_FRAMES` | `network-sync/race-transport` | `SYNC_INPUT_LOG_MAX_SPAN_FRAMES`＋`STATE_BUFFER_MAX_FRAMES` × 2 | 936 幀 | 已驗快取的保留跨度：以已見最大幀往回此值修剪 |
| `SYNC_RESPONSE_TRANSFER_MAX_STEPS` | `network-sync/rollback-engine` | `CATCH_UP_OFFER_TTL_FRAMES` | 900 步 | 完整快照尚未到達時，傳輸進度心跳可順延快照請求逾時的總上限（自送出請求起算）；1.1 MB 級快照約需 0.6 Mbps、單包上限的快照約需 2.3 Mbps 才能在此內傳完；惡意 provider 以慢傳拖延單一 voter 也以此封頂（[network-sync.md §7.1](../程式架構/network-sync.md#71-state-catch-up重連後對齊) 第 2 步） |
| `RACE_REASSEMBLY_MAX_DURATION_MS` | `network-sync/mesh` | `CATCH_UP_OFFER_TTL_FRAMES` × 1000 ÷ `FIXED_FRAMERATE_HZ` | 15000 ms | race 通道單一分段訊息自首段起的重組總上限，與 `SYNC_RESPONSE_TRANSFER_MAX_STEPS` 同長；閒置逾時仍為 `DATA_CHANNEL_REASSEMBLY_TIMEOUT_MS`（[network-sync.md §6.1](../程式架構/network-sync.md#61-應用層分段issue-001093)） |
| `SYNC_RESPONSE_FRAGMENT_PAYLOAD_BYTES` | `network-sync/race-transport` | `DATA_CHANNEL_FRAGMENT_MIN_PAYLOAD_BYTES` | 16384 B | sync-response 的分段酬載上限：超過者即使單包放得下也分段，接收端從第一段到達起量測傳輸時間，第一段自身以外推補足，段愈小外推愈短 |
| `RESYNC_TIMEOUT_MS` | `spectator/join` | 2 × `SNAPSHOT_INTERVAL_FRAMES` ÷ `FIXED_FRAMERATE_HZ` × 1000 | 4000 ms | 觀戰重求 checkpoint 的等待逾時，也是無進度看門狗的停滯門檻（[spectator.md §3](../程式架構/spectator.md)） |

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
| `RAPIER_VERSION_CURRENT`         | `'0.20.0-open4wd+open4wd.ea74eae7b3eeacfbe08047b7bb198e453203b1edf5a3aa9fcbab01cb1f4afd1e'` | 當前 Rapier runtime 完整核心版本（6 版本欄位之 `rapier_version`，與初始化後的 `rapierVersion()` 全等、含內嵌 WASM digest；wire／Ledger 上限 128 UTF-8 bytes，[版本規範.md §1](../版本規範.md)） |
| `DERIVE_LOGIC_VERSION_CURRENT`   | 1          | 當前 derive_logic 版本                                                                                                                                                                                                                         |
| `BUILTIN_ASSETS_VERSION_CURRENT` | 1          | Pre-launch 首發 baseline；目前 candidate 含 LaunchExit 幾何離膛與純視覺碎片 descriptor rebake，正式公開前不保留舊公版 bytes 相容層                                                                                                             |
| `FINGERPRINT_VERSION`            | 1          | 指紋演算法版本（**derive_logic 軸**、隨 client 發版 +1；舊作品鎖原版、跨版本比對一律放行；impl 落點 `src/ugc-fork`）                                                                                                                           |
| `UPDATE_CHECK_INTERVAL_MS`       | 3_600_000  | 每小時檢查升版                                                                                                                                                                                                                                 |
| `UPDATE_FORCE_GRACE_PERIOD_MS`   | 86_400_000 | 24 小時軟性升級寬限                                                                                                                                                                                                                            |
| `VERSION_COLLECT_TIMEOUT_MS`     | 3_000      | 開賽前收集各 peer 版本的等待窗                                                                                                                                                                                                                 |
| `VERSION_COLLECT_RETRY`          | 1          | 版本收集逾時重廣播次數                                                                                                                                                                                                                         |

> 上表為 **A 軸 client 版本**。**B 軸資產 schema 的 per-type 最低支援版不是靜態常數**，而是 ledger 衍生的動態值（由 `DEPRECATED_TO_UNUSABLE_THRESHOLD` + 鏈上升級件數推導、單調 ratchet），見 [版本規範.md §19](../版本規範.md) 與 [資料系統.md §4 `AssetVersionDerivedState`](../資料系統.md)。client 僅靜態保有各 schema 版本的映射路徑（供降版本運算）。
