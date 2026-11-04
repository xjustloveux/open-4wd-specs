---
id: D-20261104-01
date: 2026-11-04
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260818-01"]
domains: ["版本部署", "治理營運"]
sources: ["2026-11-04 ─ Tripo 時期 authoring-source Release 棄用（issue 001269）"]
files: ["美術資源/Immutable Release/README.md"]
vectors: []
deprecates: [{"item":"immutable Release authoring-source-509d0a0a3e83 作為 authoring 來源","kind":"replaced","replacement":"authoring-source-5fe3877815e7 起的程序化公版 Release"}]
---

# D-20261104-01｜Tripo 時期 authoring-source Release 棄用

## 背景與驅動力

2026-08-18 依 [D-20260818-01](D-20260818-01-Authoring大型原始資產Release-first.md) 發布的第一顆 immutable Release
`authoring-source-509d0a0a3e83` 以當時的公版為內容，其中 27 顆零件與場地 GLB 是 Tripo 生成的原件。
[D-20261022-01](D-20261022-01-公版場地程序化交付與零件維持延後.md) 與
[D-20261030-01](D-20261030-01-公版零件程序化交付.md) 把公版改為程序化從零生成後，新 Release
`authoring-source-5fe3877815e7` 已不含任何 Tripo 原件，但舊 Release 仍公開可下載，而
[D-20261031-01](D-20261031-01-authoring來源新增e2e匯入素材.md) 公開承認 Tripo 服務條款是否允許公開再散布尚未確認。
[版權.md](../版權.md) 的規則是未證實再散布權的暫行 bytes 不進公開 Git；公開 Release 等同公開散布，舊 Release
與這條規則衝突（issue 001269，push-safety 複審發現）。

## 考慮過的選項

- 先查 Tripo 條款，允許才保留：條款結果不確定且查證需時，期間舊 Release 持續公開散布。
- 直接處置舊 Release（採納）：不以條款結果為前提，把舊 Release 退出可用集合；能刪就刪，不能刪就明示棄用。
- 維持現狀只補風險承擔句：等於承認自家規則有例外，否決。

## 決定

1. `authoring-source-509d0a0a3e83` 自本決策起棄用：不得作為任何 authoring 來源、測試素材或參考輸入；main 的
   dependency lock 不得再指向它（現行 lock 已釘 `authoring-source-5fe3877815e7`）。
2. 處置順序：維護者先嘗試刪除該 Release（含 tag）；GitHub 的 immutable 設定若拒絕刪除，則在
   [美術資源/Immutable Release/README.md](../美術資源/Immutable%20Release/README.md) 的「棄用的 Release」節
   明示該 Release 已棄用、內容不得再使用，並以本決策為依據。
3. 自本決策起，只有 desired state 全部通過權利審閱（程序化生成或已證實再散布權）的 authoring 來源才可發布為
   immutable Release；發布前的權利審閱紀錄留在兩份 PROVENANCE。
4. 本機保留的 Tripo 原件與其衍生的內部參考模型維持 [D-20261030-01](D-20261030-01-公版零件程序化交付.md) 的
   處理：只作量測參考、不修改、不入 Git、不入 Release。

## 後果與影響

- 舊 Release 若能刪除，歷史 Release 清單少一顆；若不能刪除，公開頁上仍可下載，但文件已明示棄用，與自家規則的
  衝突轉為已揭露的歷史狀態。
- 不影響 main 的任何 adoption gate：lock 早已指向新 Release。
- 條款查證仍可另行進行；查證結果只影響是否補充「允許再散布」的註記，不改變棄用。

## 定案紀錄

2026-11-04 使用者裁決乙：直接處置舊 Release。

2026-11-04 維護者已刪除該 Release 與 tag（GitHub 接受刪除，未觸發 immutable 拒絕），README「棄用的 Release」列保留為歷史紀錄。
