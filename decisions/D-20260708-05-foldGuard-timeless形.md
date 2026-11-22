---
id: D-20260708-05
date: 2026-07-08
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-07-08 里程碑 8c matchmaking"]
files: ["程式架構/ledger.md", "流程/比賽結算.md"]
vectors: []
deprecates: []
---

# D-20260708-05｜foldGuard timeless 形＝多簽簽章集 fold 恆驗

## 背景與驅動力

帳本 access controller 為開放寫入（`write:['*']`）、歷史同步不重驗時效性條款——live 驗證不涵蓋歷史同步，而 foldGuard 對多簽型別一律放行（儲存接線輪的 staged 欠帳）→ 不合格的 match-result 會被 economy／matchmaking／reputation reducer 套用；窗內被 live 拒的條目仍在 log、refold 時照收，所以 live 拒收不能取代 fold 守門。里程碑 8c 落地複審抓出（高風險）。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以修正形式成立。）

## 決定

- 收件 gate ① 的 **timeless 形入 fold**：`verifyMatchResultSignatureSet`——eligible 與 quorum 全由事件自身推導（非 forfeit 完賽者、`⌊N/2⌋+1`）、簽章集對事件 digest 全驗、畸形 fail-closed；foldGuard 的 match-result 分支**恆驗**。
- 時效性條款（base 新鮮度、settlement 重算，承 [D-20260703-08](D-20260703-08-settlement收件全網重算.md)）維持 live 專屬；「歷史同步不重驗」限時效性條款、簽章集 fold 恆驗——**「已在鏈上」不構成多簽信任錨**。
- 其餘多簽型別維持放行：race-snapshot／desync 無 state reducer、checkpoint 另有專屬驗證。
- 現況見 [程式架構/ledger.md](../程式架構/ledger.md)、[流程/比賽結算.md](../流程/比賽結算.md)。

## 後果與影響

承 [D-20260708-03](D-20260708-03-fold層統一決定性守門.md) 的決定性守門與 [D-20260708-04](D-20260708-04-收件嚴格化整包拒收.md) 的嚴格收件語意，把同一把尺搬進 fold；翌日全專案複審將此模式抽象為守門原則（[D-20260709-02](D-20260709-02-fold守門原則.md)）。殘留洞——eligible 由事件自陳 `ranking` 推導，名單與 `matchId` 沒有綁定——由 [D-20260710-02](D-20260710-02-deriveMatchId定式.md) 閉合。
