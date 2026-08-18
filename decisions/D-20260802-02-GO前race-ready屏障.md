---
id: D-20260802-02
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260710-02", "D-20260710-06"]
domains: ["比賽房間"]
sources: ["2026-08-02 GO 前全員 race-ready 屏障（issue 000133）", "2026-08-12 賽前協議窗改用絕對 deadline"]
files: ["賽內機制.md", "流程/比賽進行.md", "程式架構/room-runtime.md", "程式參數.md"]
vectors: []
deprecates: []
---

# D-20260802-02｜GO 前全員 race-ready 屏障

## 背景與驅動力

正式 match 原本在各 client 完成本機 world／network 後各自開始倒數；較慢 peer 的場地、車資產或第一個真實 render 尚未完成時，較快 peer 已可能啟動 frame pump。這會讓同一 roster 在不同 wall-clock 時刻進入模擬，並把純載入失敗誤推進賽中斷線、棄賽或結算語意。

## 考慮過的選項

- 只等待 world 與 network：無法證明玩家實際看得到完整場地與車輛。
- 用任意 heartbeat 延長等待：惡意或故障 peer 可無限續命，且不能證明進度。
- 由 host 單點宣告 GO：host 無法可信觀測其他 client 的 presentation，亦會把賽內 mesh 再中心化。
- 全 roster 有限單調 milestone 屏障（採納）：每端互相驗證進度，只有真進度可延長有限等待。

## 決定

- 每一回合建立綁定 `matchId + roundIndex + roster` 的 `RaceReadyCoordinator`；觀戰者不參與。
- milestone 固定為 `world-built → network-ready → presentation-ready`。只接受傳輸來源等於 sender、屬 roster 且嚴格遞進的訊息；重送／倒退不算進度。
- `presentation-ready` 只能由 viewport 在場地與全車資產成功完成、且完成後實際 render 至少一幀後回報；同賽道的下一回合也重開世代。
- 最新本機 milestone 週期重送；無嚴格進度 30 秒或 GO 前 `peer-left` 即取消。只有全 roster 到達最後 milestone 才能建立 countdown 與 frame pump。
- 30 秒 stall 與 2 秒 resend 都以注入的單調時鐘保存絕對 deadline；timer 只是喚醒器。瀏覽器由背景回前景時立即重評，逾期 stall 當下取消；只有 resend 逾期時補送一次，不追補成 burst。嚴格 milestone 前進才建立新的 stall deadline。
- GO 前取消不產生 settlement、forfeit、斷線或信譽後果。房主移除 missing 的非 host participant、保留 host，房間回 waiting、清舊 match、ready 歸零；在線 participant 回 canonical `/room/:roomId`。再次 start 必須以新 `startedAt` 推導新 `matchId`。

## 後果與影響

正式賽的模擬入口從「各端本機初始化完成」收斂為全 roster 的可驗證共同屏障；資產失敗會在 GO 前安全取消，不再污染賽中結果。代價是最慢健康 participant 決定起跑時間，且任一成員可拒絕進度阻止該場開始；30 秒有限 stall 窗與移除 missing 後重新 start 將擾亂限制在單一舊 `matchId`。
