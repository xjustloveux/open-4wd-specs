---
id: D-20260604-04
date: 2026-06-04
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-06-04 project-resources → 企劃 新舊脫鉤大重構","2026-07-05 程式架構/ 資料夾複審"]
files: ["資安規範.md", "程式架構/key-manager.md", "程式架構/matchmaking.md"]
vectors: []
deprecates: []
---

# D-20260604-04｜SignedPayload 簽章涵蓋四欄

## 背景與驅動力

`SignedPayload` 原本簽章只涵蓋 payload——`timestamp` 與 `nonce` 落在簽章之外，攔截者可竄改時戳原樣重放，重放防護形同虛設。project-resources 脫鉤大重構期間安全修正。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以安全修正形式成立。）

## 決定

- 簽章涵蓋 **`payload`＋`timestamp`＋`nonce`＋`signer` 四欄**；驗章 ＝±30 秒時窗 ＋nonce set 防重放。
- 現況細節見 [資安規範.md](../資安規範.md)、[程式架構/key-manager.md](../程式架構/key-manager.md)。

## 附帶決策

後續程式架構資料夾複審輪（2026-07-05）同主題收斂——配對 ／ 房間訊息協議統一：payload schema 權威集中 [程式架構/matchmaking.md](../程式架構/matchmaking.md)（他檔幽靈欄位刪除）；大廳 ／ 房間訊息一律 `SignedPayload<T>` 封裝（廢內嵌 signature 欄、sender＝signer）；wire 型名分流（`SignalingWireMessage` 家族與領域訊息型別分離）。

## 後果與影響

四欄簽章 ＋±30 秒 ＋nonce set 成為全部 P2P 即時訊息的統一封套；Ledger 事件不穿此封套（走 `BaseEvent.signature` 與多簽）、屬另一層的後續劃界。惟本決策只定「簽什麼」、未定「位元組怎麼組」——跨 client 各自序列化 ＝ 驗簽必炸的隱患，由 [D-20260706-14](D-20260706-14-簽章位元組結構釘死.md) 釘死 `buildSignedMessage` 構造式（amends 本檔）。
