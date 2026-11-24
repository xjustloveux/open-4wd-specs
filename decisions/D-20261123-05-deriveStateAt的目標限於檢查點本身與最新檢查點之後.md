---
id: D-20261123-05
date: 2026-11-23
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-11-24 ─ deriveStateAt 的目標限於檢查點本身與最新檢查點之後（issue 001499）"]
files: ["程式架構/ledger.md", "程式架構/ledger-checkpoint.md", "程式架構/interfaces.md", "資料系統.md"]
vectors: []
deprecates: []
---

# D-20261123-05｜deriveStateAt 的目標限於檢查點本身與最新檢查點之後

## 背景與驅動力

[ledger.md](../程式架構/ledger.md) 第 11 節原本把 `deriveStateAt` 寫成「找不晚於目標 frontier 的最近帳本檢查點，
載其狀態，再 replay 到目標」，字面上支援任意目標 frontier（取代 spec 舊模型，無前 ADR）。程式沒有照這個寫法
實作：它只以最新檢查點為基底，目標不在最新檢查點之後時退回從 genesis replay（issue 001499）。

兩種做法在一般節點上都不成立。客戶端不必保留已被 finalized checkpoint 覆蓋的事件
（[ledger.md](../程式架構/ledger.md) 第 10 節，LEDGER-R-073），本機 entry store 會淘汰它們；而照原字面實作，
目標落在兩個較舊檢查點之間時，仍須 replay 較舊檢查點到目標之間的 entry，這一段同樣在可淘汰範圍內。同一個呼叫
因此會隨節點剛好留著哪些 entry 而成功或失敗；從 genesis replay 還會以另一個時鐘折疊，得到的狀態與檢查點自己
記錄的狀態不保證相同。

實際需要較早時點狀態的呼叫端是仲裁：資格與權重取抽籤檢查點的快照
（[moderation.md](../程式架構/moderation.md) 第 5 節，MOD-R-029），抽籤檢查點在期滿時必定不是最新檢查點。它要的
目標恰好是某個檢查點的 heads，不是任意 frontier。checkpoint 與簽章永久保留（LEDGER-R-075），每個檢查點都記錄
自己的 derived_state CID。

## 考慮過的選項

- **目標恰為某個檢查點時取該檢查點自己的狀態，其餘只支援最新檢查點之後（採用）**：不需要任何已可淘汰的
  entry；取回的狀態就是治理 signer 簽過的那一份，各節點逐位相同。代價是放棄兩個較舊檢查點之間的任意目標。
- **照原字面實作，並規定保留最近 K 個檢查點之間的 entry**：要把淘汰邊界從最新檢查點往回退 K 代，本機 entry
  store 的配額上限是依「只留最新檢查點之後」訂的，須一併重訂；K 以外的目標仍然做不到，介面依舊無法給出
  一致的保證。不採用。
- **由 fold 把呼叫端需要的資訊記入狀態，使呼叫端不再需要較早時點的狀態**：這是仲裁計票另案（issue 001490）
  的方向，會改變 derived state 的內容，屬於共識變更；它解決的是呼叫端的需求，`deriveStateAt` 本身對較舊目標
  的語意仍須先定下來。不在本決策採用，兩者不衝突。
- **維持從 genesis replay 作為後備**：只有保留完整歷史的節點做得到，一般節點得到 null；且結果取決於本機
  保留了什麼。不採用。

## 決定

- 目標的 head 集合與本機檢查點鏈上某個檢查點的 `log_head_cids` 完全相同時（不限最新的），回傳該檢查點自己的
  derived_state：驗 CID 與 canonical bytes 後解碼，不 replay。狀態塊本機沒有時由內容儲存向網路取，取不到回 null。
- 其餘目標只支援最新檢查點之後的 frontier，以最新檢查點為基底 replay。
- 已有檢查點時不退回 genesis replay：目標既不是某個檢查點、也不在最新檢查點之後時回 null。尚無任何檢查點時
  仍從 genesis replay。
- 自行定稿的節點把手上已驗過的內容塊（signer set、覆核時重算出的 derived_state 與新成形的 cold partition）
  寫入本機並 pin，使它之後不必向網路取自己定稿的檢查點狀態。定稿的步驟順序與失敗語意不變。
- 不訂檢查點狀態塊的保留個數，本決策不新增 unpin。

## 後果與影響

- 不改共識規則、事件格式、wire 與 derived state 的內容；改變的是本機查詢介面支援的目標範圍。
- 介面的字面承諾收窄：兩個較舊檢查點之間的任意 frontier 不再支援。現有呼叫端沒有這種目標。
- 對某個檢查點求值的結果不再取決於本機是否留有該檢查點之前的 entry，也不再隨呼叫時刻改變。
- 每個採納過的檢查點的狀態塊都持續被 pin，數量隨檢查點增加；是否設保留上限另行決定。
- 未覆核就定稿、或覆核後重啟過的節點，手上沒有可寫入的狀態 bytes，仍須由內容儲存取得。
- 現況規格：[ledger.md](../程式架構/ledger.md)、[ledger-checkpoint.md](../程式架構/ledger-checkpoint.md)、
  [interfaces.md](../程式架構/interfaces.md)、[資料系統.md](../資料系統.md)。

## 定案紀錄

2026-11-23 由使用者裁決：採「目標恰為某個檢查點時取該檢查點的狀態、已有檢查點時不退回 genesis、補上定稿者
的狀態塊寫入與 pin」的方案；狀態塊保留個數暫不訂。規格與程式於 2026-11-24 落地。
