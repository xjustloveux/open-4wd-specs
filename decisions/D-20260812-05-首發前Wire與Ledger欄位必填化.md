---
id: D-20260812-05
date: 2026-08-12
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260802-03", "D-20260802-11"]
domains: ["比賽房間", "共識帳本", "版本部署"]
sources: ["2026-08-12 首發前 Wire 與 Ledger 欄位必填化"]
files: ["程式架構/room-runtime.md", "程式架構/spectator.md", "程式架構/ledger.md", "流程/比賽結算.md"]
vectors: []
deprecates: []
---

# D-20260812-05｜首發前 Wire 與 Ledger 欄位必填化

## 背景與驅動力

專案尚未發布且正式 Ledger 尚未建立，但 room-state 與 RoundResult 仍以「舊 wire／舊紀錄」為由
接受缺欄形狀。這些 producer 實際不存在；保留 optional 會擴大信任邊界，並讓非 host 觀戰來源在
沒有權威配置時走 fail-open fallback。

## 考慮過的選項

- 保留 optional，等首發後再清理：沒有相容對象，卻提前承擔雙形狀測試與維護成本，棄。
- 缺欄時正規化為空名冊或本機重選來源：會掩蓋畸形 room-state，且不同 participant 可能得出不同
  admission 判定，棄。
- 把 current producer 已固定輸出的欄位設為必填並在邊界拒收缺欄（採納）。

## 決定

- `RoomStateWire.spectators` 與 `spectatorSources` 成對必填；配置必須與觀戰名冊一對一，來源必須在
  participant roster。participant source 只接受明確配置給自己的連線。
- `RoundResult.endReason` 必填、納入 canonical 多簽內容；Ledger admission、正式 MatchSummary 與
  pinning vendor mirror 都拒絕缺欄。
- `SpectatorState.hud` 不在本決策必填化：依 D-20260812-02，deterministic replay 是主路徑，該欄
  只屬精簡 presentation fallback，並非不存在版本的共識相容欄位。
- `disallowChip` 維持語意性選填；本決策不建立 production migration catalog。

## 後果與影響

room-state、結算事件與結果頁只有一種首發 current shape，缺欄資料提早在 decode／admission 邊界
失敗，不再靜默降級。代價是開發機上先前產生的暫存資料不能當正式紀錄續讀；這符合尚未發布階段
的版本原則，也避免未來真正需要 migration 時混入開發期殘留分支。
