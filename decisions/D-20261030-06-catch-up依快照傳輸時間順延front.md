---
id: D-20261030-06
date: 2026-10-30
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20261029-03", "D-20261029-04"]
domains: ["比賽房間"]
sources: ["2026-10-30 ─ catch-up 依快照傳輸時間順延 front（issue 001130）"]
files: ["程式架構/network-sync.md", "程式參數/network.md"]
vectors: []
deprecates: [{"item":"front 越出夾限或守門判定偏低即記 provider invalid-catch-up","kind":"replaced","replacement":"只換下一位 voter、不記 misbehavior；壞簽、壞 hash、不合格日誌與載入失敗仍記"},{"item":"完整快照到達前自送出請求起算固定 300 步逾時","kind":"replaced","replacement":"傳輸進度心跳順延逾時，自送出請求起 900 步總上限"},{"item":"race 通道未完成重組自首段起 5 秒逾時","kind":"replaced","replacement":"自最近一段起 5 秒閒置逾時，另設自首段起 15 秒總上限"}]
---

# D-20261030-06｜catch-up 依快照傳輸時間順延 front

## 背景與驅動力

記號沿用 [D-20261029-03](D-20261029-03-catch-up分tick追趕與落後端快進.md)：D＝`INPUT_DELAY_FRAMES`＝6、R＝`ROLLBACK_FRAME_BUFFER_DEFAULT`＝2、M＝D＋R＝8。

D-20261029-03 第 4 項把 catch-up 的 `front` 夾在 [參考幀 − `CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES`, 參考幀＋M] 內，下界容差 4 取自 mesh harness 的誠實量測；[D-20261029-04](D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md) 的「已知限制」記下這個下界沒有計入大快照的傳輸時間（issue 001130）。harness 中所有訊息延遲相同，但真實網路下 sync-response 帶 1 MB 級快照，比小封包的 live input 晚到一段傳輸時間 X。`front` 是 provider 送出當下的幀，引擎只依到達之後的步數順延，參考幀卻來自較新的 live 觀測，誠實 provider 的「順延後 front − 參考幀」因此恰為 −X。

2026-10-30 的量測（harness 新增只對 sync-response 追加 X 幀的選項，3／8 人、單程 1..5 幀與 1..4 抖動）：

- 結果只取決於 X，與基礎延遲及人數無關。X ≤ 4 全數放行；X ≥ 5 時每位誠實 voter 都被判 `front-behind-observed`，catch-up 永不成功。加上抖動時，X＝4 起就出現誤拒。
- 公版三場八車的 SavedState 最大 0.73–1.11 MB。換算 X（60 Hz）：20 Mbps 約 18–27 幀、5 Mbps 約 71–107 幀，只有約 100 Mbps 以上且快照偏小時 X 才 ≤ 4。一般家用上行頻寬下，問題必然出現。
- 附帶發現兩個問題：
  - 1 Mbps 時傳輸本身約 352–536 幀，超過 `CATCH_UP_REQUEST_TIMEOUT_FRAMES`（300）。race 通道的重組逾時 `DATA_CHANNEL_REASSEMBLY_TIMEOUT_MS`（5 秒，自首段起）也會在傳完前丟棄整筆。
  - 失敗格中，恢復端對誠實 provider 記了最多 50 次 `invalid-catch-up`。

2026-10-30 維護者裁決：

- `front` 依快照的實際傳輸時間順延，幀號以既有的固定步時鐘對齊。
- 同時修正兩個相關問題：
  - (a) 回應仍在傳輸時，請求逾時改看進度，比照 D-20261029-04 的驗簽心跳：分段持續到達就順延，另由既有常數推得有界的總上限，不無限等待。
  - (b) 只因 `front` 夾限被拒時不記 misbehavior，只換 voter；能證明無效的回應（壞簽、壞 hash、結構不合格）照記。

## 考慮過的選項

傳輸時間從哪裡來：

- **接收端在本機量測，wire 不變（採納）。** 量測區間為 sync-response 第一個分段到達，到重組完成。量測只在恢復端本機進行，不需信任 provider 自報的數值，也不需雙方牆鐘對齊。
- provider 在 wire 上附送出時戳。需要雙方牆鐘對齊，且 provider 可謊報時戳（否決）。
- 以 RTT 估計傳輸時間。RTT 已含傳輸時間，provider 也能刻意晚回應灌大 RTT（D-20261029-03 已因此改用固定裕度 M，否決）。
- 下界依快照大小縮放。大小相同時，傳輸時間仍隨頻寬相差數十倍，無法用固定比例涵蓋（否決）。

第一段自身的傳輸時間：接收端看不到第一段到達之前的傳輸。以 256 KiB 分段時，未量測的第一段在 20 Mbps 下約 6 幀，已超過容差 4。

- **以其後各段的平均速率外推第一段（估計值＝量得時間 × 總長 ÷（總長 − 第一段長）），並讓 sync-response 改用最小段長 16 KiB 分段（採納）。** 段長是送出端的選擇，分段框格式不變，接收端原本就接受任何不低於最小段長的段長。分段數變多，標頭開銷仍可忽略：1.1 MB 約 68 段、約 1.4 KB。
- 只外推、維持 256 KiB 分段。頻寬在傳輸初期爬升時（壅塞控制起步），第一段比其後各段慢，外推會低估（未採用）。
- 只改小段長、不外推。1 Mbps 下 16 KiB 第一段仍約 8 幀（未採用）。

順延是否鬆動上界：

- **傳輸步數以「送出請求到到達」經過的步數封頂，順延後的 front 仍須 ≤ 參考幀＋M（採納）。** provider 刻意放慢傳輸，順延量也只等於實際多花的時間，換得的結果與誠實的慢速 provider 相同；目標仍被夾在參考幀＋M。若 provider 把 front 壓低 Y 幀再多拖 Y 幀傳輸，順延後與誠實回應等價：日誌權威段縮短，其後的真值由恢復端從 live 路徑補上，不造成分歧。
- 順延量另設固定上限。量測已有實際經過步數這個上限，固定值只會讓低頻寬下的誠實 provider 再被拒（否決）。

傳輸期間的逾時：

- **傳輸層對分段傳輸進度送內部心跳（`sync-response-receiving`），引擎據此順延逾時；自送出請求起另設總上限 `CATCH_UP_OFFER_TTL_FRAMES`（900 步）（採納）。** race 通道的重組也改為 5 秒閒置逾時，另設 15 秒總上限，與引擎同長。
- 逾時依快照大小縮放。需要假設最低頻寬，且大小在請求時未知（否決）。
- 總上限另設新常數（例如以最低支援頻寬推得）。會多一個需要校準的 local-policy 常數；offer 保留期已是 catch-up 可用的時間尺度，900 步可讓 1.1 MB 快照以約 0.6 Mbps 傳完（未採用）。

`front` 越界與 misbehavior：

- **越出夾限，或守門判定偏低（目標 ≤ 本機而參考幀仍領先超過 R），只換下一位 voter、不記 misbehavior（採納）。** 參考幀是遠端自簽進度，可能陳舊；傳輸量測也有誤差。兩者都能讓誠實 provider 越界，越界本身無法證明 provider 不誠實。
- 只對下界越界免記，上界照記。上界越界同樣可能來自陳舊參考幀或量測高估，D-20261029-03 的「唯一參考 peer 停滯」回歸就是誠實 provider 越過上界的例子（否決）。

倒退載入的真值保留：實作時發現，X＝352 起恢復端在等待期間越過 provider 的 front 達數十幀，倒退載入需要的 [max(F, front − R), current) 真值已依回滾窗（2×`STATE_BUFFER_MAX_FRAMES`）修剪，只能以預測重播，因此與全場分歧。

- **快照階段的已受理真值自 F 起不修剪（採納）。** 保留期受傳輸與驗簽總上限，以及 offer 保留期約束，有界。
- 等待越過 front 時放棄本次回應。低頻寬下 catch-up 會永遠失敗（否決）。

## 決定

本決策只修訂 D-20261029-03 與 D-20261029-04 的下列條文，其餘決定不變。不新增 local-policy 或協定常數，新增值都是由既有常數在模組內推得。現況規則的單一權威為 [network-sync](../程式架構/network-sync.md) 第 6.1 節與第 7.1 節第 2、4、5 步，推導常數列在 [程式參數/network.md](../程式參數/network.md) 第 8.2 節。

### 1. 傳輸時間量測（接收端、wire 不變）

- 分段重組完成時回報估計傳輸時間（毫秒）：第一個到達的段到最後一段的時間 × 總長 ÷（總長 − 第一段長）。未分段的訊息為 0。
- race 傳輸層把估計值附在內部訊息 `sync-response-arrived` 的 `transferMs`；未分段時省略。
- 引擎把估計值換算成固定步數 round(`transferMs` × `FIXED_FRAMERATE_HZ` ÷ 1000)，以「送出請求到到達」經過的步數封頂，記為傳輸步數。
- `rttFrames` 改為到達步 − 送出請求步 − 傳輸步數。傳輸時間改以順延 front 計入，不灌進 RTT；否則追前緣目標會多算半個傳輸時間。
- sync-response 以 `DATA_CHANNEL_FRAGMENT_MIN_PAYLOAD_BYTES`（16 KiB）為段長送出，超過即分段，即使單包放得下。模組推導常數 `SYNC_RESPONSE_FRAGMENT_PAYLOAD_BYTES`。

### 2. `front` 依傳輸步數順延

修訂 D-20261029-03 第 4 項「夾限」一條，以及第 5 項「front 依到達後步數順延」一條：

- 夾限判定時，front 依傳輸步數加上到達後經過的步數順延。日誌權威段仍以原 front 為準。
- 夾限區間 [參考幀 − 4, 參考幀＋M] 與追前緣目標上限（參考幀＋M）都不變。下界容差 4 不改值。

### 3. 傳輸期間的進度逾時與總上限

修訂 D-20261029-04 第 7 項「逾時」一條：

- 分段傳輸期間，index 0 開頭對上現行 correlation 的 sync-response 每收到一段，傳輸層就對模擬端送內部訊息 `sync-response-receiving`（帶 requestId、target、sender）。這則心跳不上 wire，保證入佇列；兩次 drain 之間每個 provider 至多一則；correlation 取消或被取代後不再產生。
- 引擎只接受符合目前 pending、尚未到達的同一 correlation 的心跳。
- 進展依序取最近一次心跳（到達前為傳輸進度心跳、到達後為驗簽心跳）、到達步、送出請求步；自最近一次進展起滿 `CATCH_UP_REQUEST_TIMEOUT_FRAMES`（300）步即逾時。到達時重設進展。
- 到達前另有總上限：自送出請求起滿 `SYNC_RESPONSE_TRANSFER_MAX_STEPS`（＝`CATCH_UP_OFFER_TTL_FRAMES`，900 步）一律逾時。到達後的 `SYNC_LOG_VERIFY_MAX_STEPS`（676 步，自到達起）不變。
- race 通道的未完成重組改為自最近一段起的 `DATA_CHANNEL_REASSEMBLY_TIMEOUT_MS`（5 秒）閒置逾時，另設自第一段起的總上限 `RACE_REASSEMBLY_MAX_DURATION_MS`（＝900 個固定步，15 秒）。control 與 spectator 通道不變。

### 4. `front` 越界不記 misbehavior

修訂 D-20261029-03 第 3 項「守門」一條與第 4 項「被拒時記 provider `invalid-catch-up`」一條：

- `front-ahead-of-observed`、`front-behind-observed`，以及守門判定 front 偏低（目標 ≤ 本機而參考幀仍領先超過 R），都只在同一 attempt 換下一位 voter，不記 `invalid-catch-up`。
- 壞簽、日誌驗簽失敗、hash 或內外 frame 不符、日誌語意不合格、載入拋錯，照舊記 `invalid-catch-up` 並換 voter。

### 5. 快照階段保留已受理真值

補充 D-20261029-03 第 3 項倒退載入的前提：catch-up attempt 存續期間（自選定 commitment 起，含傳輸、日誌驗簽與暫無參考保留），本機的已受理真值自快照幀 F 起不依回滾窗修剪。

### 6. pre_launch：wire、golden、conformance 不變

依 [專案生命週期.md](../專案生命週期.md) 的 `pre_launch`，本決策不加相容層。

- sync／spectator wire 不改：分段框格式不變，只改 sync-response 的段長選擇。
- determinism golden 與 conformance 向量不變。
- 內部訊息（非 wire）新增 `sync-response-receiving`，`sync-response-arrived` 新增選填欄位 `transferMs`。
- `RaceWirePort` 擴充三處：`sendRaceTo` 可指定段長、`onRaceMessage` 回呼多一個傳輸時間參數、新增 `onRaceMessageProgress`。

## 後果與影響

- 一般上行頻寬下，誠實 provider 的大快照不再被 `front` 下界誤拒。回歸格（3／8 人、單程 1..5 與 1..4 抖動、X＝0..12、18、27、71、107、352、536）全部一次成功，零拒收、零 `invalid-catch-up`；順延後的誠實差，固定延遲恆為 0，抖動為 −2..+2。
- 低頻寬下（1 Mbps 約 352–536 幀）快照能傳完。上限 900 步可讓 1.1 MB 級快照以約 0.6 Mbps、單包上限（約 4.26 MB）的快照以約 2.3 Mbps 傳完；更慢的連線仍會逾時換人。
- 誠實 provider 不再因參考幀陳舊或量測誤差被記 misbehavior。
- 代價與已知限制：
  - **惡意拖延上界變長**：惡意 provider 可先慢傳到 900 步前一刻，再以最大日誌拖滿 676 步驗簽，單一 voter 最壞約 1575 步（原約 975 步）。拖延仍有界、只傷害恢復端，但更容易耗盡後面 voter 的 offer 壽命（D-20261029-04 已知限制的延伸）。
  - **越界不再累積計數**：惡意 provider 反覆回越界的 front 不累積 `invalid-catch-up`，只讓恢復端每次多等一個往返加傳輸時間後換人。
  - **量測誤差**：傳輸時間只在接收端量測，第一段以外推補足。頻寬在傳輸中劇烈變動時估計仍可能偏差；≤ 16 KiB 的單包回應不量測。偏差超出夾限時只換 voter，不影響其他 peer。harness 以理想化的固定傳輸時間驗證；真實網路下的量測準確度尚未實測。
  - **記憶體**：race 通道每 peer 的未完成重組最長可保留 15 秒（原 5 秒），仍受 `RACE_REASSEMBLY_MAX_BYTES_PER_PEER` 限制。快照階段的已受理真值保留量隨等待時間增加，有界。
- 新增模組推導常數三個，列在 [程式參數/network.md](../程式參數/network.md) 第 8.2 節的推導常數表：`SYNC_RESPONSE_TRANSFER_MAX_STEPS`（rollback-engine，900 步）、`RACE_REASSEMBLY_MAX_DURATION_MS`（mesh，15000 ms）、`SYNC_RESPONSE_FRAGMENT_PAYLOAD_BYTES`（race-transport，16384 B）。`src/system-constants/**` 不變，不需要 pinning vendor 同步。
- 現況規格：[network-sync](../程式架構/network-sync.md) 第 1 節（內部訊息型別）、第 5 節（主迴圈第二遍註解）、第 6.1 節（指定段長、race 閒置逾時與總上限、傳輸時間與進度）、第 7.1 節第 2 步（逾時）、第 4 步（傳輸進度心跳、傳輸時間）、第 5 步（夾限順延、越界與守門不記 misbehavior、快照階段保留真值）與已知限制；[程式參數/network.md](../程式參數/network.md) 的 `DATA_CHANNEL_REASSEMBLY_TIMEOUT_MS`、`CATCH_UP_REQUEST_TIMEOUT_FRAMES`、`CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES` 說明與第 8.2 節推導常數表。
- 與既有決策的關係：
  - amends [D-20261029-03](D-20261029-03-catch-up分tick追趕與落後端快進.md)：第 3 項守門判定偏低不記 misbehavior，倒退載入補上快照階段保留真值的前提；第 4 項夾限的 front 加計傳輸步數，被拒不記 misbehavior；第 5 項 RTT 扣除傳輸步數；第 9 項與「後果與影響」的內部訊息表新增 `sync-response-receiving` 與 `transferMs`。
  - amends [D-20261029-04](D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md)：第 7 項逾時的「進展」加入到達前的傳輸進度心跳，並新增到達前的傳輸總上限；第 8 項保證入佇列的超額上限多一則傳輸進度心跳；第 11 項內部訊息同上；「已知限制與後續」中 issue 001130 一條由本決策處理，惡意 provider 拖延上界改為約 1575 步。
  - D-20261029-04 的 H1 之後加註一段說明指回本決策；D-20261029-03 已有一段指向 D-20261029-04 的加註，修訂關係改由本決策的 amends 欄位記錄。兩者原文不改寫。

## 定案紀錄

2026-10-30 使用者審閱後同意採納：接收端自量快照傳輸時間並順延 front（上界不變）、收件中以心跳延長請求逾時並設 900 步總上限、front 上下界與前緣過低只換 voter 不記 misbehavior、catch-up 進行中保留自 F 起的已簽章輸入；惡意 provider 最壞拖延時間拉長列為已知限制。
