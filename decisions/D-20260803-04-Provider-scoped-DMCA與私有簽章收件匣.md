---
id: D-20260803-04
date: 2026-08-03
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260702-02", "D-20260706-04", "D-20260708-07", "D-20260720-01", "D-20260727-03", "D-20260728-02", "D-20260803-03"]
domains: ["UGC版權", "版本部署", "資安"]
sources: ["2026-08-03 Provider-scoped DMCA 與私有簽章收件匣（issue 000165）"]
files: ["程式架構/dmca.md", "程式架構/moderation.md", "流程/DMCA.md", "版權.md", "部署資訊/open-4wd-pinning.md"]
vectors: []
deprecates: []
---

# D-20260803-04｜Provider-scoped DMCA 與私有簽章收件匣

## 背景與驅動力

先前草案假設主專案營運官方 pinning／索引，將單一案件同步成 client 隨版下架清單，並以
公開詳情頁通知匿名上傳者。D-20260803-03 已移除官方與預設 pinning，但尚未把通知、反通知、
恢復及原上傳者通知收斂到各獨立 provider。Ledger 只有原上傳 PeerId，沒有 email、電話或
地址；案件個資亦不得進公開 P2P 資料面。

## 考慮過的選項

- 維持全域 client 下架清單：會把單一 provider 的決定冒充全網裁決，否決。
- 將通知個資寫入 Ledger 或公開 inbox：無法刪除且會向無關 peer 揭露，否決。
- 下架內容保留隔離副本以便恢復：增加持續持有爭議內容與共用 block 誤刪風險，否決。
- 每個 provider 自動執行形式完整的案件流程，以 provider 簽章最小 inbox 通知可信原上傳
  PeerId，法律狀態與 bytes 可用性分離（採納）。

## 決定

- 每個 provider 只處理自己控制的 pin、gateway 與供應出口；一個 provider 的下架不得形成
  client 全域 use-gate、官方清單或其他節點的命令。
- 權利人通知完成 email 確認後，provider 擷取自身 pin metadata 的可信 uploader PeerId，
  自動 unpin 並停止供應。unpin 失敗保留可重試狀態，由背景 sweep 補做；不採信通知表單
  自報的 `creatorPeerId`。
- Provider 不為可能恢復特別保留內容。Kubo 於內容不再被其他 pin／DAG 引用時由 repo GC
  清除 blocks；不得逐 block 強刪而破壞共用 DAG。玩家本機 cache 與其他 provider 不受影響。
- 營運者可撤銷明顯誤判；一般爭議走反通知。有效反通知轉寄原通知人並起算 14 個工作日；
  有效法院行動由營運者人工確認 `hold`，否則背景 sweep 解除法律阻擋。
- 恢復時只對 provider 本地仍有 exact-CID bytes 的內容 re-pin。法律狀態可為 restored，同時
  資源狀態為 available／partial／missing；missing 等待一般 exact-CID 補件，不製造假 pin。
- 原上傳者以目前 PeerId 對單一 provider 簽章查詢。Provider 回傳自身金鑰簽章的最小 inbox，
  只含 provider、subject、案件 id、CID、法律狀態、資源狀態、期限、hold 與時間；請求與回應
  都有 64 KiB、五分鐘 freshness、nonce 防重放及嚴格 schema／簽章驗證。
- 姓名、地址、電話、email、簽名與敘述只留在 provider 私有案卷及維運 mail，不進 Ledger、
  UGC block、公開 inbox 或透明度統計。Client 只查玩家設定的 provider，且始終保留來源。
- `legal_notice`／`counter_notice` 能力與 `ugc_read`／`ugc_write` 正交。流程 disabled 不代表
  UGC disabled，也不表示營運者免除任何法律責任。
- 公版提供流程與安全工具，不替任何營運者完成 Copyright Office 登記或主張美國法
  17 U.S.C. 512 安全港。
  `designated_agent_registration` 只顯示營運者自述，`safe_harbor_eligibility` 固定
  `not-asserted`。
- 本契約是尚未發布專案的唯一初始介面；沒有 v2／v3、migration、dual-read 或相容分支。

## 後果與影響

主 client 可直接向玩家選定的 provider 送通知／反通知並顯示 provider-scoped 案件，但不會
因任何單一案件封鎖本機或其他來源的 UGC。節點下架後沒有 bytes 可恢復時，狀態可正確表達
「法律阻擋已解除、內容仍缺失」；任一持有 exact bytes 的玩家可經一般內容尋址流程補回。

D-20260728-02 的 Admin Bearer、選配外層身分／MFA、最小列表與私有案卷規則繼續有效；其中
「官方 hostname／官方部署」只作當時未發布草案背景，不再是現行部署要求。先前 ADR 與規格
中的官方索引、全域下架清單、隨版恢復及公開詳情頁通知說法，以本決策為準。
