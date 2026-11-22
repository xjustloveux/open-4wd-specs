---
id: D-20260802-12
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260710-06", "D-20260802-03"]
domains: ["比賽房間"]
sources: ["2026-08-02 觀戰公開報廢 presentation 快照（issue 000135）"]
files: ["流程/觀戰.md", "程式架構/spectator.md", "程式架構.md"]
vectors: []
deprecates: []
---

# D-20260802-12｜觀戰公開報廢 presentation 快照

> **2026-08-14 關聯追補**：淘汰來源已由 [D-20260814-05](D-20260814-05-車輛零件損毀交易與純視覺碎片.md) 修訂為只有 chassis broken；battery／motor broken 不再令車輛淘汰。

## 背景與驅動力

外部 spectator 不跑物理，只以 10Hz `state-broadcast` 重建顯示幀。過去這個快照只有
位姿，觀戰端把破壞與淘汰固定成無損；因此已報廢車雖然仍留在固定車序，卻會顯示成
完好車輛。若直接傳送完整 part state，又會多暴露耐久、溫度與其他參賽者私有 HUD。

## 考慮過的選項

- 觀戰端依碰撞動畫猜測破壞：無物理權威，且 late join 無法還原，否決。
- 傳完整 PartState：不必要增加流量與資訊暴露，否決。
- 只傳公開顯示鍵與淘汰布林（採納）。

## 決定

- `SpectatorVehicleState` 新增必填 `brokenPartIds: string[]` 與 `eliminated: boolean`。前者
  只是 viewport 顯示鍵，必須以 ASCII 字典序去重，每車最多 64 筆、每鍵 1–128 字元；
  任一欄缺失、型別錯誤、超限、重複或非遞增排序時，整幀 fail-closed 丟棄。
- 廣播端仍以 meta 固定車序投影；已破壞 part 只映射成 `partIdsOf` 顯示鍵，
  `eliminated` 只由 chassis／battery／motor 致命破壞推導。不傳耐久、溫度、電量、
  技能、input 或 checksum。
- 位置與旋轉照舊在 100ms 視覺窗內插值；離散的破壞／淘汰欄位在視覺時間走到
  next snapshot 時一次切換，不產生半破壞狀態。新進車直接使用當幀完整 presentation。
- 此快照僅是 presentation，不是物理、淘汰資格、MatchResult 或結算權威；觀戰終局
  仍依 D-20260802-11 獨立讀取已驗 ledger MatchResult。

## 後果與影響

外部觀戰可顯示已報廢車輛並保留跟車／固定車序，而不擴張成第二個物理狀態流。
這是 wire 的 fail-closed 破壞式變更；舊客戶端或缺欄幀會被拒絕，必須由相同版本的
room/race admission 進入。source failover 與 `sourceEpoch` 仍由獨立的觀戰來源接替決策負責。
