---
id: D-20260710-02
date: 2026-07-10
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-07-10 首測前第二輪複審"]
files: ["程式架構/ledger.md", "程式架構/room-runtime.md"]
vectors: ["ledger/derive-match-id"]
deprecates: []
---

# D-20260710-02｜deriveMatchId 定式＝matchId 由名單推導

## 背景與驅動力

foldGuard timeless 形（[D-20260708-05](D-20260708-05-foldGuard-timeless形.md)）的 eligible 由事件**自陳** `ranking` 推導：單人 ranking→quorum 1→ 自簽即通過——任意 peer 可搶佔任意 `matchId` 先行 settle，毒化持久去重集（[D-20260710-03](D-20260710-03-settledMatchIds持久去重集.md)）使真結果被冪等閘吞。初裁 staged（隨房間開賽拍）；同日使用者定則「repo 除公版 GLB 外須可直上 public git、共識層不留 TODO」（開源 P2P 的攻擊面 ＝ 協議非 UI）→ 驗證側同日全落地。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以修正 ／ 收斂形式成立。）

## 決定

- **`deriveMatchId(roster, startedAt, matchRules)`**＝canonical 形 `{type:'match-id', roster 去重字典序, startedAt, matchRules}` 之 sha-256 hex。
- **三處同式**：收件 ⓪（不符 ＝`matchid-roster-mismatch` 拒收）／foldGuard ⓪（timeless 恆驗、先於簽章集）／race-session 開賽自洽閘（不符拒開、不建連）。
- `RaceStartContext` 補 `startedAt`：結算事件 `startedAt` 改由開賽時戳供給——同房連場 id 區異，順帶關掉原 `room.createdAt` 撞 id 窗。
- 現況見 [程式架構/ledger.md](../程式架構/ledger.md)、[程式架構/room-runtime.md](../程式架構/room-runtime.md)。

## 後果與影響

matchId 從自由字串變成**名單綁定的推導值**：自組名單自簽只能佔到自己名單推導出的 id、「佔他人場 id」結構不可能——閉合 eligible 自陳洞與去重集毒化面。生成端（房間開賽編排 `startMatch`）隨房間流程接線、契約由三處驗證與 canon 鎖死；conformance 向量家族 `ledger/derive-match-id` 看守定式。
