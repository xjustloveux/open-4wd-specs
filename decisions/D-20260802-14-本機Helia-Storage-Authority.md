---
id: D-20260802-14
date: 2026-08-02
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260802-13"]
domains: ["版本部署", "資安"]
sources: ["2026-08-02 本機 Helia Storage Authority（issue 000152）"]
files: ["程式架構/pwa-offline.md", "程式架構/settings.md", "遊戲機制.md"]
vectors: []
deprecates: []
---

# D-20260802-14｜本機 Helia Storage Authority

## 背景與驅動力

[D-20260802-13](D-20260802-13-瀏覽器Helia-UGC貢獻保留.md) 把 UGC 貢獻收斂為既有瀏覽器
Helia cache 的保留政策，但第一版把 LRU authority 放在已驗身分的 online Helia generation。
真實離線啟動時沒有該 generation，physical disconnect 又會銷毀它，因此啟動用量嚴格
`> 0.9` 的 forced GC 與離線降級的 deferred-cleanup 狀態，在 production browser path 沒有
可持續的 storage owner。

同一 IndexedDB blockstore／datastore 若同時由兩個 Helia instance 擁有，兩邊各自只有 process-local
lock；一邊 GC 可能與另一邊寫入交錯。這不是新增第二個 cache 就能安全修補的生命週期缺口。

## 考慮過的選項

- 在 offline shell 與 online generation 各建一個 owning Helia：形成兩套 pin／GC lock 與 close
  authority，同一 origin 可在寫入中被另一套 GC 刪除，否決。
- online generation 不存在時直接另開 raw `IDBBlockstore`，連線時再交回 generation：會讓本機
  CID、Ledger storage 與 LRU 分裂成多個 owner，失敗時也可能靜默 fallback，否決。
- shell lifetime 只建一個 networkless storage authority，online generation 以 non-owning adapter
  借用同一 storage identity（採納）。

## 決定

- `AppShell` 在支援 IndexedDB 的 browser 中，以 single-flight 初始化一個 shell-lifetime
  `BrowserUgcCacheAuthority`。它可在未登入與 physical offline 時建立，開啟 Ledger content
  blockstore／pin datastore，以無 libp2p、無 Bitswap 的 `createHeliaLight` 建立本機 Helia，並擁有
  唯一 `UgcCacheLruService` 與 local CID reader；初始化不得發出網路請求。
- 公開設定頁保存 `ugcContribution` 仍是純 settings action：不建立、啟動或重試 authority，亦不
  初始化身分、Ledger、Helia networking 或 P2P。authority 由正常 shell lifecycle 獨立初始化；只有
  authenticated online generation 才新增 libp2p／Bitswap、peer serving、Orbit entry store 與
  transport。
- 每個 online generation 都借用 authority 的同一組 blockstore／datastore／pin adapter object，
  且不擁有其 `open`／`close`／`start`／`stop`。generation stop／logout／disconnect 只關閉自己
  的網路與 Ledger generation 資源，不關閉 borrowed content storage、pin state、local CID reader
  或 LRU；reconnect 建新 generation，仍借用相同 authority identity。
- authority 提供兩個刻意分離的 surface：LRU 使用的 internal pin／GC surface，以及 online Helia
  使用的 borrowed Ledger surface。所有 block mutation、pin mutation、streamed／batched mutation
  與 datastore `batch().commit()` 都通過同名 origin-exclusive Web Lock；`putMany`、`deleteMany`、
  `getMany`、`getAll`、`query`、`queryKeys` 也遵守已安裝介面契約。online Helia 可保留自己的
  generation-local lock，但 persistent mutation 最終都進此 origin lock，且只有 authority 可執行
  GC。LRU internal surface 已在同一 non-reentrant lock 內時不得重取鎖。
- local CID source 只借用 authority 的 locked blockstore reader，不再另開 raw
  `IDBBlockstore`。跨 tab 以相同 Web Lock name 序列化 online mutation 與 authority GC。
- offline startup 若 `usage/quota > 0.9`，networkless authority 可在不啟動身分或網路的前提下，
  forced GC 至目前 active-policy target；等於 0.9 不進 forced branch。一般 downgrade 在 offline
  仍只保存新 level、保留同一 LRU，清理延後並在超過新 trigger 時回報
  `cleanup-deferred-offline`；reconnect 後由借用同一 authority 的新 online generation 重新評估。
- authority creation failure 必須 fail-closed：shell 保持 local UI，storage pressure 不得假報成功，
  online Ledger/cache 不得 fallback 到第二個 direct-IDB owner。非 `off` 顯示
  `runtime-not-started`，`off` 仍依優先序顯示 `inactive`。settings／status 操作不觸發 retry；只有
  明示的 online shell lifecycle 可重試失敗初始化。
- final disposal 先同步阻止新 race session，啟動並等待 tracked race lease abort／restore，使其在
  generation provider 尚有效時完成；再關閉 active app 與 replaceable online generation，等待
  in-flight launch、identity 與 contribution work，detach authority callback，接著
  `lru.shutdown()`，最後 close-once authority／IndexedDB handle。每一步失敗都保留原 error，後續
  cleanup 繼續，最終依確定順序單獨丟出或以 `AggregateError` 彙整；disposal-won initialization 的
  late `authority.close()` 失敗也不得被誤記或吞掉。

## 後果與影響

未登入 shell 可以持有一個純本機、networkless Helia storage authority，但這不代表登入、連線、
provider health 或 peer serving。online generation 可替換而不重建 storage owner，斷線、logout、
reset 與 reconnect 也不使 LRU／pin／local CID authority 漂移；雙 Helia／雙 GC lock 被排除。

本決策只修正 D-20260802-13 的 storage-authority lifetime：不新增 Kubo、local port、CSP exception、
共識或 rule ID、global seed、關閉瀏覽器後的 background service。Issue 000149 的 takedown／race
lease ownership 保持不變；是否對 DMCA 做 immediate purge 仍只由 issue 000153 裁決。
