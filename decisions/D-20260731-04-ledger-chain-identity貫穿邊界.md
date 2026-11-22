---
id: D-20260731-04
date: 2026-07-31
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260731-02"]
domains: ["共識帳本", "資安"]
sources: ["2026-07-31 ledger chain identity 貫穿邊界"]
files: ["資料系統.md", "程式架構/ledger.md", "程式架構/peer-discovery.md"]
vectors: ["ledger/signing-digest"]
deprecates: []
---

# D-20260731-04｜ledger chain identity 貫穿簽章、mutable storage 與 topic

## 背景與驅動力

`ledgerAddress` 原本只負責開啟 OrbitDB。ledger 事件簽章摘要不含鏈識別，checkpoint
control、checkpoint IndexedDB 與 Admission outbox 也未分鏈；同一瀏覽器 origin 同時使用
測試鏈與正式鏈時，簽章可跨鏈重放，mutable state 也可能互相覆寫。GossipSub topic 的分鏈
契約已由 [D-20260731-02](D-20260731-02-GossipSub-topic-namespace契約.md) 定案，但仍需
與簽章及本機儲存使用同一 identity。

通用 `signingDigest` 同時供視覺 hash、loadout proof、room proof 與 signaling register auth
使用，不能直接全域加入 ledger address。CID-keyed blockstore 則以 bytes 決定 CID，相同內容
共用並不構成 mutable authority 覆寫，無須為鏈隔離複製。

## 考慮過的選項

- 全域修改 `signingDigest`：會讓非 ledger protocol 無端依賴 CID／OrbitDB，否決。
- 將所有 blockstore 逐鏈複製：浪費空間且破壞 content-addressed 去重，否決。
- 新增可配置的短 chain name：會形成與 ledgerAddress 漂移的第二權威，否決。
- 由 canonical ledgerAddress 推導完整 chainId，僅貫穿 ledger authority 與跨鏈
  namespace（採納）。

## 決定

- `chainId` 唯一定義為 `/orbitdb/<CIDv1-base58btc>` 的完整 canonical CID segment；不得
  截短、另 hash 或配置 alias。
- 新增 ledger-only `ledgerSigningDigest(ledgerAddress, event)`，摘要涵蓋：
  `domain = open4wd-ledger-signature-v1`、完整 `chainId` 與剔除簽章欄位後的 canonical
  payload。標準事件、match-result、race-snapshot、desync、config-update 與 checkpoint
  的產生、live admission、歷史 fold 全部同式。
- 通用 `serialize.ts` 不 import chain identity；ledger-only digest 分檔，避免 signaling
  vendor 因 register auth 被迫引入 CID 套件。
- checkpoint DB 名稱、control key 與 Admission outbox row/query/quota 全部帶 chainId。
  動態 genesis 可先用空暫存取得 OrbitDB address，但第一筆 application write 前必須關閉
  暫存並以新 chainId 重開。
- identity/profile store 屬使用者，不分鏈；CID-keyed content／entry blockstore 維持內容
  尋址共用。
- GossipSub 使用同一 chainId 與
  `/open4wd/<chainId>/<topic>/v1[/<scope>]` grammar。peer-discovery 是 topic factory／parser
  唯一 owner，chat-system 不再保存 wire prefix。

## 後果與影響

這是首次公開與首次多人測試前的 baseline 收斂，不提供舊 digest、未分鏈 control/outbox 或
舊 topic 的 reader、migration、dual publish。既有本機開發資料與舊向量直接失效並重建；
conformance vectors 以 chain-bound digest 重產，pinning／signaling 依 owner-first 順序
re-vendor。跨鏈測試必須證明同事件簽章在另一 chain 失效、mutable storage 不互見、同一
spectator channel 只被同 chain allowlist 接受。
