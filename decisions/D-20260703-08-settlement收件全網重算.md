---
id: D-20260703-08
date: 2026-07-03
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["經濟"]
sources: ["2026-07-03 經濟系統.md 新時代首〜四輪複審"]
files: ["程式架構/ledger.md", "程式架構/economy.md", "經濟系統.md", "流程/比賽結算.md", "資料系統.md", "程式參數.md", "賽內機制.md"]
vectors: []
deprecates: []
---

# D-20260703-08｜settlement 收件全網重算＋`mintEligible`＋base 新鮮度錨

## 背景與驅動力

二輪複審 H1：結算收件原僅驗「多簽達 ⌊N/2⌋+1」、apply 不重算直接套用——全員共謀房（8/8 同農場）多簽對抗性歸零，可內嵌任意金額，月軟曲線與各上限形同虛設。三輪再發現 base 新鮮度無界：挑舊 log head 當計算基準即可繞過全部限流器。另 `K=5` 組合閘與鑄幣各面（獎金 ／royalty／ 使用統計）閘位不一，留有繞道。

## 考慮過的選項

- 維持「多簽達門檻即信」：對全房共謀零對抗性（未採）。
- 對 lag 窗內並行放大殘餘再加 apply 端二次檢查：複雜度不值、殘餘有界（使用者裁接受、不做）。
- 收件端全網重算 ＋ 統一鑄幣謂詞 ＋ 新鮮度錨（採納）。

## 決定

- `MatchEconomySettlement` 新增 **`baseLogHeadCid`**；首播收件以 `deriveStateAt(baseLogHeadCid)` 重算結算、**逐位比對不符拒收**；歷史同步不重驗；base 未同步 ＝ 暫緩排隊重試、非拒收。
- 場級鑄幣統一謂詞 **`mintEligible`**＝`finisherCount` 至少 3 且 combo 未達上限；prizes／royalties／`ugcUsageStats` **三者同閘**，僅合格場佔 `K=5` 窗。
- **base 新鮮度雙條款**：base 必含本場最後一筆 `RaceSnapshotEvent`，且 lag 不超過 `SETTLEMENT_BASE_MAX_LAG_SEC`（600、初估待 playtest）；整場無快照僅接受 `mintEligible = false`。配套：每回合終局強制一筆賽內快照；`RaceSnapshotEvent` 最小 schema（`matchId`＋`roundIndex`＋`frame`＋`checksum`＋`signatures`）首次定義。

## 後果與影響

「結算金額全網可驗算」入列 [資料系統.md](../資料系統.md) 不變式：假名次 P2P 本無從外驗，但金額回到被公式與各閘封頂。已知殘餘 ＝lag 窗內同 PeerId 並行多場的短窗放大（有界、月軟曲線兜底、playtest 觀察）。`finisherCount` 閘源自 [D-20260602-02](D-20260602-02-斷線結算finisherCount.md)；歷史 append 繞 live 的最後缺口其後由 [D-20260709-01](D-20260709-01-鑄幣月硬頂.md) 以 fold 端月硬頂收口。
