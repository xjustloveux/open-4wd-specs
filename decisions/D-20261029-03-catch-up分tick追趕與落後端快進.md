---
id: D-20261029-03
date: 2026-10-29
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20261028-03", "D-20261028-04", "D-20261029-01", "D-20260812-02"]
domains: ["比賽房間"]
sources: ["2026-10-29 ─ catch-up 分 tick 追趕與落後端快進（issue 001104、001111、001107、001108、001118、001114）"]
files: ["程式架構/network-sync.md", "程式架構/程式流程/network-sync.md", "程式架構/spectator.md", "流程/觀戰.md", "程式架構/physics-engine.md", "程式架構/testing.md", "程式參數/network.md", "流程/比賽進行.md", "程式架構/security.md", "使用技術.md"]
vectors: []
deprecates: [{"item":"catch-up 一步內追到前緣","kind":"replaced","replacement":"載入 F 後依牆鐘預算分 tick 追趕"},{"item":"快照幀不新於本地即不採用","kind":"replaced","replacement":"追前緣目標不超過本地才拒絕"}]
---

# D-20261029-03｜catch-up 分 tick 追趕與落後端快進

> **2026-10-29 關聯追補**：決定第 2 項的本機輸入、lag 暫停、背景恢復與時基各條，第 4 項的暫無參考，第 5 項的逾時起算與保證入佇列，第 6 項的「只損效能」，第 9 項與「後果與影響」的內部訊息與常數數量，以及「已知限制與後續」，已由 [D-20261029-04](D-20261029-04-catch-up追趕期限驗簽心跳與背景恢復.md) 修訂：追趕差距連續 300 個正常 step 沒有縮小即以 `'lag'` 自我退出，追趕中背景恢復超過 24 幀即結束追趕並重新 catch-up，日誌驗簽以心跳順延逾時並設 676 步總上限。其餘決定不變。

## 背景與驅動力

[D-20261028-03](D-20261028-03-輸入延遲有界回滾與模擬Worker.md) 把延遲容忍固定為 (D+R)×T（D＝`INPUT_DELAY_FRAMES`＝6、R＝`ROLLBACK_FRAME_BUFFER_DEFAULT`＝2），catch-up 改為「快照＋簽章輸入日誌」後追前緣到 T＝provider front＋RTT/2，並把時鐘對齊列為待決事項 3。之後掃描發現六個相連的缺口：

- **幀時鐘偏移無法回收（issue 001104）**：peer 一旦因卡頓或 catch-up 估計誤差落後，就沒有任何機制追回；偏移持續吃掉 (D+R)×T 的容忍。改動前的重現中，catch-up 後單向延遲 1..8 幀抖動時 12 個 seed 有 7 個分歧（本決策實作後：1..6 抖動 12/12 全員一致，1..8 為 10/12，見決定第 1 項）。
- **越過對齊幀或第一位 voter 失敗即無法對齊（issue 001111）**：守門以「快照幀不新於本地即不採用」拒絕，F 早於本機時即使前緣遠在本機之後也不載入；第一位 voter 的 sync-response 未交付時，canon 寫的「同 request 重試」實際上不存在，只能等 300 幀逾時。
- **惡意 `front` 可推出殭屍車或拖垮全場（issue 001107）**：provider 灌高 `front`（+20 以上）時，恢復端追到全場之前，誠實 peer 會出現 tied／consensus-invalid，恢復端也可能成為殭屍車。
- **最壞 catch-up 在單一步內完成（issue 001108）**：載入、驗簽最多 7504 筆日誌與重播最長區段都擠在同一個 tick，卡頓數秒；最壞情況也不在效能閘內。
- **驗簽成本（issue 001118）**：noble Ed25519 同步驗簽佔主執行緒，評估改用 WebCrypto Ed25519。
- **觀戰端在來源缺號時凍結（issue 001114）**：來源 catch-up 期間輸入缺號，或參賽者流內離場後停送封包，replay 停在 catching-up／live 而沒有任何重求。

2026-10-28 使用者對六張 issue 裁決「依照建議」；2026-10-29 使用者對本批計畫的各項裁決回覆「照建議」，其中超前回收一項後經重新裁決為「P0＋保證 1–6」，`front` 下界與參考幀的審查缺口經使用者裁決「依照你的建議」，WebCrypto 經使用者確認採用。
2026-10-29 使用者審閱草稿後同意採納，各項裁決依文末「定案紀錄」定案。

## 考慮過的選項

時鐘回收（001104）：

- **甲：落後端快進，只改本機、不動 wire（採納）。**
- 乙：frame-advantage 節流（領先端減速）。需要對端的進度資訊，且領先端減速會拖慢全場（否決；其本機版的超前回收見下方 (a)，同樣否決，需 wire 交換的版本另案 issue 001127）。

catch-up 高估前緣造成的超前誤差：

- (a) catch-up 後觀察窗內，本機以預期 lead 校正後判定超前時暫停步進，不動 wire（初裁採用，經實測推翻後否決）。實測（暫停變體量測，八人、p7 斷線重連、seed 20–31）：接上暫停後 1..8 抖動回歸只剩 5/12，不接暫停是 10/12；保守版（以累積 lead 中位數估計、窗內只暫停一次）與再加上落後修正的版本也都只到 10/12。原因：抖動上限等於 D＋R 時容忍裕度為 0，偏移 ±1 幀即分歧，而窗內的超前估計雜訊大、修正來得比分歧發生更晚，還會誤觸發過衝。
- **(b) 只保證 catch-up 後 1..6 抖動時全員一致，1..8 列為已知限制（採納；使用者 2026-10-29 重新裁決「P0＋保證 1–6」）。**
- (c) 追前緣目標改為保守低估。落後誤差會讓誠實 peer 對恢復端輸入的取捨不同而互相分歧，風險高於超前（否決）。

`front` 夾限的裕度（001107）：

- 以 RTT 為裕度（issue 001107 原建議）。provider 可刻意延遲回應灌大 RTT（否決）。
- **上界固定 D+R，追前緣目標也以「參考幀＋D+R」為上限（採納）。**

`front` 夾限的下界與參考幀（001107，審查發現的缺口經使用者裁決「依照你的建議」）：

- 只設上界。provider 壓低 `front` 可讓恢復端落後、誠實 peer tied 或被驅逐（否決）。
- 固定下界 −M（−8）。實測壓低 −4／−6／−8 都放行，且部分 seed 誠實 peer tied 119 筆、誠實 p0 被驅逐（否決）。
- **下界取實測誠實最小值再減 1：`CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES`＝4（採納）。**
- 參考幀取「排除 provider 的遠端觀測最大值」。少數同謀以超前 input／checksum 即可抬高參考幀使夾限失效（否決）。
- **參考幀取非 provider 新觀測的嚴格多數第 k 大，並忽略荒謬超前的觀測（採納）。**

provider 漏筆或竄改日誌（001107 第二段）：

- **丙：接受現狀。前提是 `front` 已夾限，漏筆或竄改只會讓恢復端被驅逐，不影響其他 peer（採納）。**
- 為日誌引入 quorum 背書：要改 sync wire 與 offer 流程（否決）。

驗簽減量（001108、001118）：

- **主執行緒快取跳過、本機輸入比對、非同步分片（採納）。**
- 驗簽移入 Worker。與 D-20261028-03 第 9 節的執行緒表（驗簽在主執行緒）衝突；量測也顯示 WebCrypto 在 Worker 內無額外效益（否決）。
- **WebCrypto Ed25519 依 C1–C5 量測決定：兩瀏覽器五條全成立，採用並以 noble 複核（採納；使用者 2026-10-29 確認）。**
- 單用 WebCrypto 結果判定。WebCrypto 的接受集合是 noble 的真子集，且 Chromium 與 Firefox 彼此不同，會讓各瀏覽器判定分歧（否決）。

非同步驗簽後的交付順序（001118）：

- 所有訊息含 sync-response 排同一到達序列。7504 筆日誌會阻塞其後所有 live input，超過 R 即丟包分歧（否決）。
- **sync-response 在日誌驗完時才取序號（入到達順序佇列尾端），其他訊息維持全域到達順序（採納）。**

catch-up 最壞情況的效能口徑（001108）：

- 維持 D-20261028-04 第 5 節的「只報告」診斷（否決）。
- **新增 provisional 回歸閘 `catch-up-worst`，加單 tick 追趕耗時斷言（採納）。**

觀戰端流內離場者（001114）：

- 對離場 peer 改採 Hold 預測：issue 原評估需改 wire 與簽章離場標記（否決）。
- **replay 對已 quit 的車免收後續封包，以 replay 自身模擬出的已雜湊 `quitAtFrame` 判定，不改 wire（採納，本批一併做）。**

sync-response 未交付的補救（001111）：

- 新增 `sync-unavailable` wire 或改快照冷卻（否決，issue 裁決明示不做）。
- **responder 有上限、有間隔地自動重送同一 response（採納）。**

## 決定

本決策的常數一律放在 `Network.localPolicy`（本機處置政策，非協定，不進 wire、快照或 hash），值寫在 [程式參數/network.md](../程式參數/network.md) 第 8.2 節（含「模組層推導常數」表）。下列記號：D＝`INPUT_DELAY_FRAMES`＝6、R＝`ROLLBACK_FRAME_BUFFER_DEFAULT`＝2、M＝D＋R＝8。協定常數全部不改值。

### 1. 幀時鐘：落後端快進；不實作本機超前暫停

**落後端快進**（001104 甲，穩態漂移；單一權威為 [network-sync](../程式架構/network-sync.md) 第 7.5 節「幀時鐘偏移與落後端快進」）：

- lead 沿用 network-sync 第 7.3 節的「最近 lead」（input 幀扣 D、checksum 幀原樣，減本機目前幀），以最近一步收訊時的幀計。
- 觸發看**嚴格多數遠端**：k＝floor(遠端數/2)＋1，取各遠端 lead 的第 k 大值 `quorumLead`（至少 k 名遠端的 lead ≥ 此值）；觀測數 < k 時視為無值。兩人場的 k＝1，唯一對手即多數，兩人場也快進；對手灌高幀號最多讓本機快進到 lead 24 以內。
- 遲滯：`quorumLead` 落在 (R, 2×`STATE_BUFFER_MAX_FRAMES`]＝(2, 24] 時啟動；啟動中每個 tick 建議額外步數＝min(`CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS`, `quorumLead` − `CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES`)；`quorumLead` ≤ `CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES`、> 24 或無值時停止並回 0。lead > 24 交由 network-sync 第 7.2 節的自動 catch-up 處理，不快進。
- 詢問時機：`RaceLoop` 只在本 tick 跑過至少一個固定步、且固定步數未達 `MAX_SUBSTEPS` 時，於固定步之後詢問一次。沒有固定步的 tick 重複詢問會超調；固定步已達上限表示裝置跟不上。
- 已上報 lag、已上報不可恢復 lag、catch-up 快照階段，或正在分 tick 追趕（第 2 項）時不快進，遲滯狀態重設；catch-up 對齊時也重設。
- 額外步是正常的模擬步：照常收訊、照常取樣並送出本機輸入、照常受 rollback 與前緣快照規則約束，重播長度仍 ≤ R。只改本機的步進節奏，不改 wire。
- 常數：`CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS`＝2（每 tick 額外步上限），不變式 1 ≤ 值 ≤ `Protocol.physics.MAX_SUBSTEPS`；`CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES`＝0（停止點；比 issue 原寫的「lead ≤ R」多留裕度），不變式 值 < R。停止點維持 0、不再調整：lead 恆比真實進度舊約一個單程延遲，殘留落後屬 001127。
- 第 7.3 節持續落後自我驅逐的 lead 統計與兩人場例外不變。

**不實作本機超前暫停（P0）**（2026-10-29 使用者重新裁決「P0＋保證 1–6」，取代先前採用 (a) 的規格補充；先前的暫停設計被實測推翻）：catch-up 高估前緣時恢復端會領先全場，本批不以本機暫停步進回收，也不新增任何暫停相關常數、模組或接線（`ClockSettlePause` 已全數移除）。

- **實測依據**（暫停變體量測；八人、p7 在 tick 600–900 凍結並斷線、seed 20–31、`clockSync: true`）：

| 變體 | 1..6 抖動 | 1..8 抖動 |
|---|---|---|
| P0 不接暫停（採納） | 12/12 | 10/12 |
| 接上暫停（先前規格補充） | 12/12 | 5/12 |
| 保守版（累積 lead 中位數估計、窗內只暫停一次且不越過估計 0） | 12/12 | 10/12 |
| 保守版再加落後修正 | 12/12 | 10/12 |

- **原因**：抖動上限等於 D＋R 時容忍裕度為 0，偏移 ±1 幀即分歧；窗內超前估計的雜訊又大（樣本不足即誤判），修正來得比分歧發生更晚，還會因誤估而過衝，把原本八票一致的 seed 變成恢復端被驅逐。落後端的 seed 21、28 則是 catch-up 低估前緣，修正同樣太晚。
- **保證範圍**：catch-up 後單向延遲 1..6 幀抖動時，全員（含恢復端）每輪 checksum 一致，12 個 seed 全過。此範圍內不需要超前回收，留有 2 幀裕度。
- **1..8 為已知限制**：見「已知限制與後續」，併入 issue 001127。
- **測試**：001104 的回歸測試為 1..6 抖動 12 seed 全員一致；卡頓回收矩陣依格分流（大卡頓格的限制見「已知限制與後續」）：k＝4 全員一致，其餘只斷言非落後端零 desync、落後端只因 checksum 被驅逐、無 lag／window 驅逐。

### 2. catch-up 分 tick 追趕

- `applyCatchUp` 只做三件事：載入 F、以日誌權威段重建時間線、發出 `reset(F)`；之後進入「追趕」狀態，不在同一步追到前緣。載入時已在目標上則不進入追趕。
- 追趕由 `RaceLoop` 依牆鐘預算分散到多個 tick：本 tick 至少跑過一個固定步、且固定步數未達 `MAX_SUBSTEPS` 時，在 `CATCH_UP_CHASE_TICK_BUDGET_MS` 內重複推進追趕幀，至少一幀；預算自 tick 開始計，已含本 tick 固定步耗時。沒有固定步或固定步達上限的 tick 不追趕。追趕中不取快進建議。常數 `CATCH_UP_CHASE_TICK_BUDGET_MS`＝10（ms），不變式 0 < 值 < 1000／`FIXED_FRAMERATE_HZ`。
- 追趕目標在追趕期間每次正常 `step()` 加 1（live peers 同時前進一幀）；`currentFrame` ≥ 目標時結束追趕。
- 追趕期間**不排程本機輸入**：不寫也不廣播本機 input；event 型按鍵公告丟棄；hold 由下一次取樣重建；pending leave 保留到第一個真正排程的步，排程幀＝追趕結束時的幀＋D。這是對 [D-20261029-01](D-20261029-01-回合終局一致性.md) 第 1 項「catch-up 跳號時取跳號後的值」的細化。
- 追趕期間超前的遠端輸入**持續暫存並晉升**：每推進一幀，把 frame ≤ current＋2×`STATE_BUFFER_MAX_FRAMES` 的暫存條目晉升進 InputBuffer；與日誌同 (peer, frame) 但值相異者照 live 路徑判 equivocation。對齊時放回暫存的條目在全部晉升前不清空。
- 追趕期間暫停 lag 累計、自動 catch-up 與不可恢復 lag 判定（只記觀測不判定），也不受理新的 catch-up 請求（含 reconnect 觸發者）；追趕結束時清空最大 lead 統計與持續落後計數，若仍落後由既有流程處理。
- 追趕中切到背景再回前景時，目標加上隱藏期間換算的幀數；距目標超過 `CATCH_UP_MAX_ADVANCE_FRAMES` 即走不可恢復 lag。
- requester 端的 RTT、probe 與快照逾時、自動 catch-up 冷卻改以本機 step 數為時基（只由正常 step 遞增，追趕幀與載入跳號不計）。provider 端的 offer TTL 與 sync-response 冷卻仍以模擬幀計，追趕中會提早到期，只會少回應、不會回錯。
- 追趕幀不計入每幀實付（不呼叫 frame cost 回報），與 [D-20261028-04](D-20261028-04-效能預算三層口徑.md) 第 2 節「catch-up 追趕的耗時屬 L2 與診斷」一致。

### 3. 守門、倒退載入與 responder 重送

- 守門改為：追前緣目標（第 4 項的 `target`）≤ `currentFrame` 時不載入；此時若參考幀仍領先本機超過 R，表示 provider 回報偏低，記 `invalid-catch-up` 並換下一位 voter，否則靜默結束本次 attempt（不記 misbehavior）。F 早於本機但目標晚於本機時照常載入（倒退載入）。取代「快照幀不新於本地即不採用」。目標晚於本機也保證之後的本機排程幀晚於舊時間線已送出者，簽章 nonce 單調。
- 允許倒退載入後，必須同時成立下列保護：
  1. **已投 checksum 輪不重投**：引擎記錄已廣播的 checksum 幀（修剪 `< currentFrame − CHECKSUM_PAST_HORIZON_FRAMES`），重播經過這些幀時不再記暫定 hash、不再廣播；否則對端會把本機的兩張票判成 checksum equivocation。倒退超過 150 幀時，已修剪的輪可能重廣播，他人視為過舊票丟棄，判定無害。
  2. **舊時間線的本機票不再自判**：刪除 `ownHashes` 中 key > F 的條目（已送出的票對端照常裁定）。`consecutiveDesyncs` 不歸零：計數只來自真正裁定過的輪，若在 catch-up 成功時歸零，持續分歧的 peer 就能藉 catch-up 清掉累積的 strike。
  3. **錨與觀戰 checkpoint 丟棄 F 之後的舊值**：回合共識錨丟棄本機在 F 之後記錄的 hash；觀戰來源目前錨的幀 > F 時只清除錨，已驗簽的 input／checksum backlog 保留（backlog 與本機時間線無關，清掉會讓 late join 缺 input）。倒退深度超過一個錨間隔時，來源以 `#backlogCompleteFrom` 記下被丟棄的錨幀，之後早於此幀的新錨帶有缺口、不採用，≥ 此幀的錨才採用並解除限制。同回合 F 之後的 abort 證據摘要一併刪除。以上都在記錄新 settled 錨之前執行。
  4. **`reset(F)` 可早於已發出記錄**：`SettledEvent` 的 `reset(F)` 語意擴充為「F 可小於已發出的最後 record 幀」，所有消費端必須丟棄 F 之後的舊值。
- **任何 catch-up 成功都作廢自身 offer**：前進或倒退載入成功時，刪除本機擔任 provider 時 pin 住的全部 offer 並清空待重送；已受理真值與基準已換成新時間線，舊 offer 的日誌無法再完整重建。代價：向本機索取的 requester 要等逾時換人。`front < F` 時 responder 不回應。
- **responder 重送**：sync-response 同步送出回 false、拋例外，或回執 `delivered:false` 時，responder 保留 offer 並登記重送：第一次在下一步，之後每次距上一次送出至少 `SYNC_RESPONSE_RESEND_SPACING_STEPS`＝6 步（模組層推導值＝`MAX_SUBSTEPS`＋`CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS`，必跨 tick，同一 tick 內不會連續用完重送次數），在收訊開頭重跑同一請求的應答流程（重建日誌、重新簽章），最多 `SYNC_RESPONSE_RESEND_LIMIT` 次。requester 不在 roster、offer 過期或被取代、cooldown 成立時放棄。重送成功才進 cooldown 並刪除 offer。常數 `SYNC_RESPONSE_RESEND_LIMIT`＝2，不變式 ≥ 1。不新增 wire（重送的是同型 sync-response），不改快照冷卻。

### 4. `front` 夾限、追前緣目標上限與漏筆丙案

- **參考幀**：本次 catch-up 發起（重連或自動）或背景恢復之後收到的**新觀測**（input 幀扣 D、checksum 幀原樣，同 peer 取最大）中，排除 provider，取**嚴格多數第 k 大**（k＝floor(n/2)＋1，n＝非 provider 遠端人數），與快進的 `quorumLead` 同口徑。少數同謀以超前 input／checksum 抬不動參考幀，provider 自送的超前觀測也不計入；斷線前的舊觀測不計入，避免誠實 provider 被舊觀測誤判。
- **忽略荒謬觀測**：超過本機 current＋`CATCH_UP_MAX_ADVANCE_FRAMES`（900）＋`CATCH_UP_MAX_OBSERVED_AHEAD_FRAMES`（24）的觀測在收到時即不採計，取參考幀時再過濾一次。基準取 current＋900＋24 而非 current＋24：後者會讓落後超過約 32 幀的恢復端失去所有觀測，catch-up 完全失效。
- **暫無參考**：有效新觀測不足 k 名時，保留已驗回應，之後每步以新觀測重判；自交付起最多保留 `CATCH_UP_REQUEST_TIMEOUT_FRAMES`（300）步，逾時靜默放棄本次 attempt，交由自動 catch-up 冷卻後重試；不記 provider `invalid-catch-up`、不換 voter。
- **夾限**：front 依到達後經過的步數順延（第 5 項）後，須落在 [參考幀 − `CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES`, 參考幀＋M] 內：
  - 灌高 → `front-ahead-of-observed`；壓低 → `front-behind-observed`；
  - 被拒時記 provider `invalid-catch-up`，並在同一 attempt 換下一位 voter；全部 voter 被拒則等冷卻重試。參考觀測陳舊時誠實 provider 也可能被拒，同樣換人、不驅逐。
- **下界的量測依據**：`CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES`＝4，不變式 1 ≤ 值 < D＋R。延遲不為負，誠實 front 與參考幀之差只來自單程延遲的抖動差。mesh harness 誠實情境（4、8 人；固定單程 1、2、4、8 幀，各加 0 或 1..6 幀抖動；seed 20–31；最後一位 peer 在 tick 600–900 凍結並斷線）量得 front − 參考幀最小 −3、最大 +3；固定延遲時恆為 0。下界取最小值減 1；上界 +M 不會誤拒誠實最大值 +3。量測只涵蓋實際單程 ≤ 8 的格（單程 5..14 的格未進入採用判定，超出 D＋R 屬 001127）。
- **追前緣目標**：`target`＝min(front＋round(max(0, `rttFrames`)／2), 參考幀＋M)。固定裕度 M 取代 issue 001107 原建議的 RTT 裕度：延遲回應灌大 RTT 也無法把目標推到參考幀＋M 之外。
- **兩人場**：除 provider 外沒有其他遠端時，改以本機對 provider 本身的觀測為參考。依 canon，兩人場的 probe quorum 需兩張遠端票、隱藏恢復也直接走不可恢復 lag，本就不 catch-up；此規則實際不可達，僅防禦性。
- **攻擊回歸結果**（8 人，抖動 1..4，seed 23–26）：
  - 壓低 −1／−2：全部放行，誠實 peer 一致；−4：依 seed 放行或擋下（seed 決定誠實差），誠實 peer 一致；−6／−8／−10：全部擋下並換下一位 voter，誠實 peer 一致。24 格全部無 desync、裁定全為 consistent、每輪 8 票一致。
  - 同謀 p1 以超前 500 幀的 input 或 checksum 抬高參考幀，同時 p0 灌高 +20／+22／+40／+100：8 格全部擋下，第二位 voter 對齊，全場一致、無 tied、無殭屍車。
  - 延遲回應 200 幀（4、8 人，seed 20–31，24 格）：目標被夾在參考幀＋M，恢復端對齊時超前 5–7 幀，約 307–432 tick 後由 checksum strike 單獨被驅逐；誠實 peer 0 desync。
- **漏筆採丙**：provider 竄改或漏掉日誌輸入只會讓恢復端被驅逐，不影響其他 peer。此結論的前提是 `front` 已依本項夾限；夾限失效時丙案不成立。
- **根本限制**：參考幀來自遠端自簽進度，比真實前緣舊約一個單程延遲；夾限只能把誤差限制在容忍內，無法消除「輸入落在回滾窗邊緣使誠實 peer 互判分歧」。根本解需以 wire 交換 frame advantage，併入 issue 001127（已與下界、參考幀的審查缺口一併裁決）。

### 5. 驗簽減量

- **快取**：已驗過的 (peer, frame, digest, signature) 記入快取（live 路徑驗過的遠端 input、本機簽出的 input、先前驗過的日誌條目），相同 (peer, frame) 只保留首筆；以「已見最大幀 − `SYNC_INPUT_LOG_MAX_SPAN_FRAMES` − 2×`STATE_BUFFER_MAX_FRAMES`」修剪。日誌條目命中快取即跳過驗簽；簽章或 digest 差一 byte 即不命中。快取只省驗簽成本，不影響任何判定。
- **快取上限防禦**：不收超過本機最近簽出幀＋`CATCH_UP_MAX_ADVANCE_FRAMES`＋2×`STATE_BUFFER_MAX_FRAMES` 的條目，防止惡意 peer 以超遠未來幀推高「已見最大幀」而把整個快取修剪掉。
- **本機輸入比對**：本機簽出 input 時即寫入快取，日誌中的本機條目以快取比對，不呼叫驗簽。
- **分片**：未命中的日誌條目逐筆驗簽，每筆驗完檢查本片已耗時（含 WebCrypto 拒絕後的 noble 複核），達 `SYNC_LOG_VERIFY_SLICE_MS` 即讓出主執行緒，每片至少一筆。讓出以 `MessageChannel` 觸發下一片（環境沒有時退回 `setTimeout(0)`）：瀏覽器巢狀 `setTimeout` 至少 4 ms 的節流會讓 7504 筆冷快取的牆鐘超過 300 步逾時。分片期間其他 peer 的 live input 照常驗簽與交付。常數 `SYNC_LOG_VERIFY_SLICE_MS`＝4（ms），不變式 0 < 值 < 1000／`FIXED_FRAMERATE_HZ`。任一條目驗簽失敗或驗簽拋錯，整份日誌不採用（以 `inputLog: null` 交付，沿用現行語意）。
- **`sync-response-arrived`**：外層簽章驗過後，立即對模擬端送內部訊息 `sync-response-arrived`（非 wire）；日誌全部驗完才把 sync-response 放入到達順序佇列尾端（排在此刻之前已到達、仍在驗簽的訊息之後）。引擎以到達步重新起算逾時（step 數 − 到達步 ≥ `CATCH_UP_REQUEST_TIMEOUT_FRAMES`），`rttFrames` 改以到達步計，驗簽耗時不灌進 RTT。
- **front 依到達後步數順延**：驗簽期間參考幀持續前進；若 front 只順延交付後的步數，驗簽耗時 ≥ 5 步時誠實 provider 就會被下界誤判。因此夾限判定時 front 依到達後經過的步數順延（日誌權威段仍以原 front 為準）；第 4 項「暫無參考」的保留計時則自交付起算，驗簽耗時不吃掉 300 步保留額度。
- **保證入佇列**：到達通知與驗完的 sync-response 本體不受 per-peer 訊息數與 bytes 上限限制；每 peer 同時只有一份 pending correlation，最多超額一則通知加一份回應，仍有界。
- 回合收攤（transport dispose）或 correlation 已取消、被新請求取代時，進行中的驗簽結果丟棄、不交付；同一 correlation 重複到達不重驗。
- 驗簽**不移入 Worker**；D-20261028-03 第 9 節「驗簽在主執行緒」不變。
- 最壞 7504 筆的 verify 呼叫數：冷快取 7505（外層 1＋日誌 7504），典型快取命中情境 3849，連線中落後型 catch-up 下限 1。

### 6. WebCrypto Ed25519（001118，採用）

**量測**（Windows 11 單機；Chromium 151 與 Firefox 151，headless，主執行緒與 dedicated Worker；對照產品 `verifyMessage`＝noble 2.2.0 預設 zip215=true）：

| 項目 | Chromium noble | Chromium WebCrypto | Firefox noble | Firefox WebCrypto |
|---|---|---|---|---|
| 單筆 P50／P95（主執行緒，ms） | 0.315／0.410 | 0.035／0.040 | 0.980／1.100 | 0.060／0.100 |
| 7504 筆批次牆鐘（主執行緒，ms） | 2668.7 | 269.7–289.9 | 7241.2 | 158.1（主執行緒同步佔用約 21） |
| 7 遠端 × 60 Hz 負載的主執行緒忙碌（ms/s） | 170.0 | 31.8 | 570.3 | 15.2 |
| 負載下 await 往返 P95（ms） | — | 0.745 | — | 0.260 |

- 兩瀏覽器的執行位置不同：Chromium 的 WebCrypto Ed25519 在呼叫執行緒同步完成（只是單筆便宜約 9 倍），Firefox 在背景執行緒完成。Worker 內數字與主執行緒相同，無額外效益。
- 語意對照語料 2518 筆（隨機合法、單 bit 竄改、S ≥ L、八個小階點組合、y ≥ p 非正規編碼、全零、長度錯誤）：兩瀏覽器「WebCrypto 接受而 noble 拒絕」皆為 0；不一致（Chromium 76、Firefox 80 筆）全部是 noble 接受、WebCrypto 拒絕，且全在非誠實類別；合法類別 1000/1000 一致。Chromium 與 Firefox 的接受集合彼此也不同。

**C1–C5 判定**（兩瀏覽器皆成立）：

- **C1 可用**：主執行緒與 Worker 都能 import raw 公鑰並 verify。成立。
- **C2 語意**：不安全條目 0；採「WebCrypto 接受即接受，拒絕或拋錯時以 noble 複核」後，最終接受集合等於 noble。成立。
- **C3 效益**：單筆 P50 約 1/9（Chromium）、1/16（Firefox）；7504 筆批次約 1/9.2、1/45.8，皆 ≤ noble ÷ 3。成立。
- **C4 延遲**：單則 await 往返 P95 0.040、0.100 ms；負載下晚一幀 0 次。成立。
- **C5 主執行緒**：負載下忙碌約 0.19×、0.027×，皆 ≤ noble ÷ 2。成立。

**決定**：採用（使用者於 2026-10-29 確認）。採用條件：

- **保留分片**：Chromium 的 WebCrypto 仍在主執行緒同步執行，第 5 項的 4 ms 分片與讓出不可移除；分片預算逐筆檢查，含 noble 複核耗時。
- **以 noble 為準**：WebCrypto 接受且簽章 S < L 才直接採用；回 false、拋錯（含 import 失敗）一律以 noble 複核，noble 結果為最終判定。接受集合因此與 noble 相同，各瀏覽器判定一致。
- **支援偵測含負向向量**：以固定向量偵測，RFC 8032 合法向量必須接受，竄改簽章、竄改訊息、S＋L 三個負向向量必須拒絕；任一不符、拋錯或逾時即整個環境改用 noble。沒有 `crypto.subtle` 時直接用 noble。CryptoKey 依公鑰快取，import 失敗不快取。
- **逾時**：`SIGNATURE_VERIFY_TIMEOUT_MS`＝50。單筆 WebCrypto import＋verify 超過此值未完成，該筆改由 noble 判定，該回合的驗簽器之後一律改用 noble。依據為合法情境最壞單則 await 往返 P95 約 2.6 ms（Chromium 4× 降頻、7 則同時等待），取約 20 倍裕度；不變式 1000／`FIXED_FRAMERATE_HZ` ≤ 值 ≤ D × 1000／`FIXED_FRAMERATE_HZ`。主執行緒停頓 > 50 ms 的誤判只損效能、不影響正確性。
- **有序交付**：非同步驗簽下每則收件依到達順序取得交付位置，只交出最前面一則未完成者之前的已完成前綴，驗簽失敗者不佔位；寫入快取與觀戰 relay 也在交付時執行。sync-response 例外：日誌驗完後才入到達順序佇列尾端（第 5 項）。
- 簽章格式、digest 與 `src/key-manager/ed25519.ts` 都不變；驗簽器注入點在正式賽每回合建立 transport 處，未注入時的同步路徑只供測試與 harness。
- 實作後實測：Chromium 7504 筆真簽章日誌交付牆鐘 2763 → 331 ms，每片 P95 4.04 ms、無 long task，live input 依序交付；live 負載主執行緒忙碌 171.7 → 38.3 ms/s；產品驗簽器對語料與 noble 0 不一致。
- WebKit 未量測，不作為決策依據；Safari 的正確性由支援偵測與 noble 複核保障，效能未知。

### 7. catch-up 效能閘

- 新增 provisional 回歸閘 `catch-up-worst`：量測完整驗證載入外來快照、冷快取驗簽 `SYNC_INPUT_LOG_MAX_ENTRIES` 筆（與產品同一 digest 與驗簽器）、重播 `SYNC_INPUT_LOG_MAX_SPAN_FRAMES` 幀，取 P95。閘規則沿用 [D-20260809-07](D-20260809-07-效能回歸與BootstrapCoverage可執行門檻.md)（惡化 10% 警告、25% 失敗），參考機重建前只警告。`referenceMs`＝109（校準正規化值；採用 WebCrypto 後本機 5 次量測的中位數，provisional）。採用前的 noble 路徑暫置值為 2450，已失去守門意義而改定。
- 另加斷言 `catch-up-chase-tick-max`（不寫入 `perf-baseline.json`，失敗即 `test:perf` 失敗）：以真實 `RaceLoop` 分 tick 追趕 `SYNC_INPUT_LOG_MAX_SPAN_FRAMES` 幀，每個 tick 扣掉該 tick 最後一個追趕步的實測耗時後 ≤ `CATCH_UP_CHASE_TICK_BUDGET_MS`＋`engine.step` 的 P95。此式精確表達「每個追趕步開始前，本 tick 已耗時不超過預算」；直接以 tick 最大值比較時，落在預算邊界的那一步碰上 GC 尖峰就會誤紅（字面版實測 6 次 1 紅）。
- 修訂 D-20261028-04 第 5 節：「catch-up 最壞追趕耗時」由只報告的診斷移入回歸閘；載入、日誌驗簽與重播分項仍只輸出診斷。

### 8. 觀戰看門狗與已 quit 車免收

- **無進度看門狗**（001114）：觀戰端在 replay 模式、phase 為 catching-up 或 live、未在等待重求的 checkpoint、看門狗已武裝、且本回合尚未終局時，若 replay 的 simTick 超過 `RESYNC_TIMEOUT_MS`（2×`SNAPSHOT_INTERVAL_FRAMES` 以本機單調鐘換算，60 Hz 下 4 秒）未前進，就走既有重求流程並計為一次重求；連續超過 `SPECTATOR_REPLAY_RESYNC_LIMIT` 沿用既有降級。來源端不改。
  - **武裝條件**：simTick 越過 D；或接受的錨已越過 D（之後每一幀都需封包，否則離場者停送後拿到的新錨會無聲凍結）；錨 ≤ D 時，收到 frame ≥ D 的已驗 input 或本回合 GO（`countdown` 歸零）即為倒數已結束的證據，自取得證據時起算。倒數期間 replay 停在 D 不觸發。`countdown` 不具權威，只用來提前武裝。
  - 接受 checkpoint 時重新起算進度時刻（錨 > D 時武裝、≤ D 時解除）；重新準備 replay、重求與降級時解除武裝。重連期間不觸發也不計數，換綁後重新起算。
  - **`resetForCheckpoint` 一律清空**：非 fatal 時都清空 replay 最新輸出（原本只在 checksum-mismatch 時清空），否則殘留的舊幀會被當成前進、把 phase 推回 live，使新錨被丟棄。
  - 重求後新錨可能早於畫面停留的幀，畫面最多倒退約一個 checkpoint 間隔（約 2 秒）後快速追回；這只發生在已停滯 4 秒之後，屬預期行為。
- **已 quit 車免收**：replay 判定「幀完整」時，不要求 replay 世界狀態中 `RaceProgress.quitAtFrame` 已設定的車提供封包，缺封包者餵空輸入；引擎在 quit 之後忽略輸入，state hash 不受影響（真引擎測試證實 quit 後餵空輸入與隨機 skill-trigger 的 hash 相同）。
  - **以已簽 leave 前瞻計算緩衝**：jitter 緩衝前瞻時，掃到某 peer 的已驗 leave 輸入後，其後各幀也暫不要求它的封包，讓緩衝能越過離場幀；否則離場集合要等步進完 leave 幀才更新，leave 幀永遠湊不滿緩衝而死鎖。實際步進前一律以目前狀態重判，引擎未記下離場（例如場地沒有 race progress）時照常等待。leave 是引擎消費的同一份已簽輸入，不是另一個 wire 標記。
  - 步進前防禦檢查：frame ≥ D 且有未離場者缺封包時以可重求的失敗處理，不靜默以空輸入步進（沿用 `checksum-mismatch` 失敗種類）。
  - ICE 斷線（無 leave）仍等待，交由看門狗處理。不改 wire。
  - 三個 builtin 場地都有 race progress、leave 會寫入 `quitAtFrame`，以守門測試鎖住。

### 9. pre_launch：wire、golden、conformance 不變

依 [專案生命週期.md](../專案生命週期.md) 的 `pre_launch`，本決策不保留舊行為、不加相容層。實測確認：sync／spectator wire 不改，determinism golden 與 conformance 向量不變；perf-baseline 新增 `catch-up-worst` 一項；內部訊息（非 wire）新增 `sync-response-arrived`，`replay-status` 新增 `latestInputFrame` 一欄（見「後果與影響」）。

## 後果與影響

- 卡頓或 catch-up 造成的落後可由本機自行回收，不再持續吃掉 (D+R)×T；catch-up 後 1..6 抖動時全員一致，1..8 為已知限制（issue 001127）。catch-up 不再單步卡頓數秒，追趕期間畫面持續更新但本機無法操作（不排程輸入）。
- F 早於本機或第一位 voter 失敗時仍可對齊；惡意 `front`（灌高、壓低超過容忍、同謀抬高參考幀）只會讓 provider 被記 `invalid-catch-up` 並換下一位 voter，不再造成全場 tied 或殭屍車。
- 驗簽改用 WebCrypto＋noble 複核：最壞 catch-up 的驗簽從數秒降到數百 ms 級，live 負載主執行緒佔用約降為 1/5（Chromium）至 1/40（Firefox），接受集合不變。
- 觀戰端在來源缺號時最多約 4 秒後自行重求；流內離場者不再讓觀戰端降級。
- wire、golden、conformance 影響：

| 項目 | 影響 |
|---|---|
| sync wire | 不改。快進只改本機步進；追趕期間本機不送 input，語意同 canon「自 T＋D 恢復」；responder 重送的是同型 sync-response；WebCrypto 不改簽章格式與 digest。 |
| spectator wire | 不改。看門狗走既有重求；quit 免收以 replay 自身模擬的 `quitAtFrame` 與已簽 leave 判定。 |
| 內部訊息（非 wire） | `NetworkMessage` 新增 `sync-response-arrived`，模擬 Worker 協定的 `net-in` 隨之擴充；`SettledEvent.reset` 語意擴充為可早於已發出記錄；`SimToHost` 的 `replay-status` 新增 `latestInputFrame`（自目前錨起收到的已驗 input 最大幀）。 |
| determinism golden `KNOWN_CHECKSUMS` | 不變（物理、state hash 與快照內容都不動）。 |
| conformance | 不變（`ledger/signing-digest` 不含 input digest，其餘 family 不受影響）。 |
| perf-baseline | 新增 provisional `catch-up-worst`（`referenceMs` 109）。 |

- 新 local-policy 常數八個：`CLOCK_FAST_FORWARD_MAX_EXTRA_STEPS`、`CLOCK_FAST_FORWARD_STOP_LEAD_FRAMES`、`CATCH_UP_CHASE_TICK_BUDGET_MS`、`SYNC_RESPONSE_RESEND_LIMIT`、`SYNC_LOG_VERIFY_SLICE_MS`、`CATCH_UP_MAX_OBSERVED_AHEAD_FRAMES`、`CATCH_UP_FRONT_BEHIND_TOLERANCE_FRAMES`、`SIGNATURE_VERIFY_TIMEOUT_MS`。另有模組層推導值（重送間隔 6 步、已驗快取上限與保留窗）只列在 [程式參數/network.md](../程式參數/network.md) 第 8.2 節的推導常數表，不受 check:constants 解析。`src/system-constants/**` 是 pinning 的 vendored 檔，pinning vendor 同步於本批末端另取同意後執行。
- 與既有決策的關係：
  - amends [D-20261028-03](D-20261028-03-輸入延遲有界回滾與模擬Worker.md)：解決待決事項 3（時鐘對齊）；第 6 節的「一步內追到前緣」改為分 tick 追趕、T 的估計加上上下界夾限與多數參考幀、已知限制中 001107、001108、001104 的敘述由本決策取代；第 9 節驗簽仍在主執行緒，但改為非同步 WebCrypto＋noble 複核並依到達順序交付，sync-response 加例外；第 10 節觀戰重求加無進度看門狗。D、R 與其餘協定語意不變。
  - amends [D-20261028-04](D-20261028-04-效能預算三層口徑.md)：第 5 節「catch-up 最壞追趕耗時」由只報告移入 provisional 回歸閘；其餘口徑不變。
  - amends [D-20261029-01](D-20261029-01-回合終局一致性.md)：追趕期間的 pending leave 延到追趕結束後才排程；已知限制中引用 001104 的「斷線車預測基準分歧」改由 issue 001126 追蹤。
  - amends [D-20260812-02](D-20260812-02-觀戰Deterministic-Replay與精簡Fallback.md)（觀戰 replay）：對已 quit 的車不再要求其封包（以 `quitAtFrame` 判定、缺封包者餵空輸入，緩衝以已簽 leave 前瞻），因此改變 replay「幀完整」的判定；wire 不變。
- 現況規格：[network-sync](../程式架構/network-sync.md) 第 4.1、5、6、7.1（含「驗簽器」段與已知限制）、7.2、7.3、7.4、8、9 節與新增第 7.5 節「幀時鐘偏移與落後端快進」（快進規則的單一權威），[程式流程/network-sync](../程式架構/程式流程/network-sync.md)，[spectator](../程式架構/spectator.md) 第 3 節（幀完整判定、無進度看門狗、`replay-status`），[流程/觀戰.md](../流程/觀戰.md) 第 4 項，[流程/比賽進行.md](../流程/比賽進行.md)，[physics-engine](../程式架構/physics-engine.md) fixed timestep 段，[testing](../程式架構/testing.md) 第 8 節，[security](../程式架構/security.md)，[使用技術.md](../使用技術.md)，[程式參數/network.md](../程式參數/network.md) 第 8.2 節。

### 已知限制與後續

- **斷線車預測基準分歧（issue 001126，另案）**：網路斷線車以 Hold 延續預測模擬，各 peer 最後收到的真值可能不同，預測基準因而分歧。D-20261029-01 的已知限制把它歸在 001104，但落後端快進不處理它；本批不在範圍內。
- **有界回滾窗的固有限制（issue 001127）**：根本解都需以 wire 交換 frame advantage 或新的輸入排程機制，不在本批。包括：
  - **大卡頓**：單次卡頓 s 幀加單程延遲 L 超過 D＋R 時，落後端恢復後的首批輸入到達他人時已過舊而被丟棄；s − L＋D 超過 2×`STATE_BUFFER_MAX_FRAMES` 時，他人的輸入超出落後端的未來窗。快進只回收時鐘偏移，救不回已越窗的輸入，落後端由 checksum strike 處置。
  - **快進停止點**：lead 以遠端自簽進度計，恆比真實進度舊約一個單程延遲 L，停在 lead 0 會殘留真實落後約 L；2L > D＋R 時落後端之後的輸入到達他人時都已過舊。
  - **catch-up 後 1..8 抖動不保證全員一致**：保證範圍僅到 1..6（決定第 1 項）。抖動上限等於 D＋R 時容忍裕度為 0；本機暫停與落後修正都實測無法補救（10/12 為上限）。seed 21、28 是 catch-up 低估前緣，導致誠實 peer 之間 tied，其餘失敗為恢復端單獨被驅逐。延遲回應攻擊下恢復端超前 5–7 幀後被驅逐，也屬同一限制。
  - **受理窗邊界使誠實 peer 分歧**：參考幀比真實前緣舊約一個單程，夾限只能把誤差壓在容忍內；輸入落在回滾窗邊緣時誠實 peer 可能互判分歧（決定第 4 項「根本限制」）。下界容差 4 只比量到的誠實最小值寬 1 幀，抖動大於 1..6 時誠實 provider 可能被拒並換 voter（不會分歧）。
- **zip215 驗簽語意（issue 001128）**：產品 Ed25519 驗簽採 noble 預設 zip215=true，接受小階點／全零公鑰與非正規編碼。本決策刻意維持 noble 的接受集合不變（WebCrypto 只作加速），語意是否收緊另案處理。
- **Argon2 效能閘雜訊（issue 001129）**：`test:perf` 的 `key-manager-unlock`（Argon2）回歸閘接近 25% 失敗門檻，單機可偶發紅燈；與本決策無關，量測期間發現而另案追蹤。
- 參考機重建前，`catch-up-worst` 只警告不失敗；`referenceMs` 為本機 Node 代理量測，校準係數浮動大，重建時應重定並增加樣本數。
- WebCrypto 量測只涵蓋單機 headless 的 Chromium 151 與 Firefox 151；Firefox 153、WebKit／Safari、行動裝置未量。Firefox 改為逐筆 await 後日誌牆鐘估計約 0.44 s，未實測。
- **pinning vendor 同步（待使用者同意）**：`src/system-constants/**` 的新常數需經 pinning `vendor:sync` 帶入；於本批末端執行，執行前須再取得使用者同意。

## 定案紀錄

2026-10-29 使用者審閱草稿後同意採納。本批計畫的各項裁決已全部定案並實作：兩人場也快進；常數值（額外步上限 2、停止點 lead ≤ 0、追趕預算 10 ms、重送上限 2、分片 4 ms）；不實作超前暫停並保證 1..6（重新裁決）；`front` 上界 D＋R 並以多數參考幀夾限（含下界 4 與忽略門檻）；sync-response 驗完才入佇列尾端；驗簽不移入 Worker、WebCrypto 採用；納入效能閘並 amends D-20261028-04；倒退載入保護；斷線車預測基準分歧另案（issue 001126）；已 quit 車免收本批一併做；序號取 D-20261029-03。

pinning vendor 同步尚待使用者同意，見「已知限制與後續」。
