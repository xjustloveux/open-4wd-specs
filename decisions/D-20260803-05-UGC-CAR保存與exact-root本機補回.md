---
id: D-20260803-05
date: 2026-08-03
status: superseded
supersedes: []
superseded_by: D-20260804-02
amends: ["D-20260803-02", "D-20260802-14"]
domains: ["UGC版權", "資安"]
sources: ["2026-08-03 UGC CAR 保存與 exact-root 本機補回"]
files: ["UGC機制.md", "版權.md", "程式架構/pwa-offline.md"]
vectors: []
deprecates: []
---

# D-20260803-05｜UGC CAR 保存與 exact-root 本機補回

## 背景與驅動力

UGC 內容由玩家之間與各自選擇的 pinning provider 供應，任一遠端副本都不保證永久存在。
只下載裸 GLB 雖能保存內容，卻沒有標準容器攜帶原 root CID；全網副本消失後，仍持有 bytes
的玩家無法安全地把同一內容身分補回本機 Helia。專案尚未發布，因此不需要為開發期間的
舊格式或舊 CID 提供相容層。

## 考慮過的選項

- 重新走 UGC 上傳：會錯誤地建立新作品、重新判定作者、收費並進入相似度流程，否決。
- 由 pinning provider 保存或恢復：把玩家自主持有綁到特定遠端服務，也無法保證全網仍有
  provider，否決。
- 使用標準 CAR v1，驗證後 exact-root 寫回本機內容庫（採納）。

## 決定

目前 UGC 保存包固定使用標準 CAR v1，且只接受一個 root、一個 block。root 必須是
`CIDv1(raw, sha2-256)`；唯一 block 的 CID 必須等於 root，bytes 重算 digest 必須相符，封包不得
有尾隨第二個 block。block 上限沿用單件 Ledger content block 的 64 MiB，上層 framing 另給
1 KiB。

作品詳情提供 CAR 下載；UGC 瀏覽頁提供 CAR 匯入。匯入先完成 framing、codec、root、block 數、
大小與 digest 驗證，再經唯一的本機 storage authority exact-write。這只是補回既有 CID 的
bytes，不建立 `ugc-upload`、不變更作者／血緣／評分／可用性、不收費、不進入相似度或文字
檢核，也不要求登入、帳本、pinning 或遠端連線。成功補回後只列為一般本機 LRU 資源，仍會依
容量政策自然淘汰。

目前只有這一種格式與行為；不建立 v2、v3、舊格式雙讀、alias 或 migration。日後若 UGC 真正
改成多 block DAG，必須另立決策與新測試，不能把現在未實作的能力寫成既有相容承諾。

## 後果與影響

任何持有合法保存包的玩家都能讓原 CID 在自己的裝置重新可用，並在其正常 P2P 連線期間重新
參與內容供應；作品身分與權利資料完全沿用帳本既有紀錄。保存包不保證永久 pin，也不繞過
provider-scoped DMCA：各 provider 是否提供該 CID 仍由各自維運狀態決定。惡意或損毀封包在
寫入前拒絕，匯入失敗不得留下部分 block。
