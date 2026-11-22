---
id: D-20260803-03
date: 2026-08-03
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260706-02", "D-20260724-01", "D-20260728-01"]
domains: ["UGC版權", "版本部署"]
sources: ["2026-08-03 Pinning 無官方節點，開發期 baseline 重設為 v1（issue 000164）"]
files: ["部署資訊.md", "部署資訊/open-4wd-pinning.md", "程式架構/interfaces.md", "程式架構/pinning-service.md", "程式架構/settings.md"]
vectors: []
deprecates: []
---

# D-20260803-03｜Pinning 無官方節點，開發期 baseline 重設為 v1

## 背景與驅動力

先前草案把主專案維護者部署的 pinning 稱為「官方節點」，由 deployment config 注入 client
預設清單，並把 2026-07-24 加入 SignedPayload、64 KiB response limit、timeout、strict parsing
與 reactive availability 的第二輪內部強化稱為 `PinningProvider v2`。兩者都超出目前事實：專案
仍在開發、沒有公開 pinning endpoint、已發布 client、外部自架相容對象或正式持久資料。

維護者決定不營運官方 pinning，也不讓主 repo 為特定節點背書。公版 pinning repo 只交付
可由任何維運者使用的實作、image 與部署模板。每個節點自行決定 UGC 與法遵能力，玩家自行
設定節點；主 client 不以節點是否啟用 DMCA 決定 UGC 是否可用。

## 考慮過的選項

- 保留官方／預設節點：會讓主專案與特定供應者的內容供應及法遵營運重新耦合，否決。
- 保留 v2 或升 v3並提供 dual-read／migration：沒有真實相容對象，只會製造虛假公開歷史與
  額外 parser 分支，否決。
- 保留全部能力，以無官方節點與唯一初始 v1 contract 直接收斂（採納）。

## 決定

- 主 repo 不提供官方／預設 pinning 節點清單，也不從 deployment config 注入 endpoint；玩家
  可新增、排序、選擇與移除 `community`／`self-hosted` 節點。
- `open-4wd-pinning` 公版 repo 本體不部署；任何維運者可 use-template／fork，使用其 image 或
  程式碼不代表主專案背書。兼任 bootstrap 亦不使其成為官方或預設 pinning provider。
- 節點以 `GET /provider` 分別聲明 `ugc_read`、`ugc_write`、`legal_notice`、
  `counter_notice`、`transparency`。`DMCA_ENABLE=false` 不得停用 UGC read/write；維運者亦可
  關閉公開 write、只供應其自行審核的內容。
- 指定代理人登記只允許營運者聲明 `not-declared`／`registered`；
  `safe_harbor_eligibility` 固定為 `not-asserted`，client 與公版 repo 不替節點作法律認定。
- Client 可讀取玩家已選節點自願提供的透明度資料；缺少資料時忽略，不跨節點推論或集中
  建立官方統計。
- `PinningProvider` 的首次公開介面 baseline 為唯一 `interfaceVersion = 1`。2026-07-24 的安全
  與穩健性強化全部保留，但「v2」只代表第二輪內部開發，不形成公開版本。沒有 v2／v3、
  dual-read、migration、compatibility shim 或 legacy fallback。
- 首次公開凍結後，只有真實不相容契約已存在且需要區隔時才可升版，並須另立 ADR、相容
  策略與測試 vectors。

## 後果與影響

主 client 在未設定 pinning 節點時仍可依玩家間 Helia／Bitswap 與本機資源運作，但不承諾
遠端持久供應。下架後本地自然淘汰的內容保留 metadata；沒有實體資源時回到一般缺資源
狀態，日後由任何持有相同 bytes 的玩家重新供應。各 pinning 節點只對自己的儲存、供應、
通知與恢復流程負責。

舊 `official` trust label、`pinningUrls` deployment 值及 v2 測試文字都是未發布開發資料，
直接移除，不提供遷移或相容層。後續 DMCA 端到端通知／反通知流程仍由 issue 000165／000153
收斂；本決策先固定節點責任與能力邊界。
