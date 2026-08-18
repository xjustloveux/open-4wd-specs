---
id: D-20260731-02
date: 2026-07-31
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260731-01"]
domains: ["版本部署", "資安"]
sources: ["2026-07-31 GossipSub topic namespace 契約裁決"]
files: ["程式架構/peer-discovery.md", "程式架構/程式流程/peer-discovery.md"]
vectors: []
deprecates: []
---

# D-20260731-02｜GossipSub topic namespace 契約

## 背景與驅動力

現行 rooms、matchmaking、signaling 與 spectator-chat topic 分別混用無前導斜線、有無
`v` 前綴、裸數字版本與不同版本位置。它們也尚未包含由 `ledgerAddress` 決定性推導的
`chainId`，不同測試鏈與正式鏈會進入同一 GossipSub namespace。

此外 spectator-chat 的發送端與 admission 端各自寫死一份相同 prefix，沒有 import
關係或跨模組契約測試；任一側單獨改名時，既有單元測試仍可全綠，但 bootstrap 串接會在
`TopicSubscriber` 的 subscribe／publish allowlist 失敗。

## 考慮過的選項

- 移除 topic 版本：開發期字串較短，但首次公開後無法在路由層隔離不相容 payload，否決。
- 使用全域版本 `/open4wd/<chainId>/v1/<topic>`：任一訊息家族升版都迫使其他 topic
  一起遷移，粒度過粗，否決。
- 每個 topic 家族各自版本化，並由單一 owner 建構與解析（採納）。

## 決定

- 所有 Open4WD GossipSub topic 採同一 canonical grammar：
  `/open4wd/<chainId>/<topic>/v<major>[/<scope>]`。
- 一律保留前導 `/`，版本一律使用可辨識的 `v1`，不用裸的 `1`；版本放在 topic 名稱後，
  動態 scope／channel 放在版本後。
- 首次公開 baseline 為：
  - `/open4wd/<chainId>/rooms/v1`
  - `/open4wd/<chainId>/matchmaking/v1`
  - `/open4wd/<chainId>/signaling/v1/<canonical-scope>`
  - `/open4wd/<chainId>/spectator-chat/v1/<channel>`
- `chainId` 只由 `ledgerAddress` 決定性推導，不新增可獨立配置、可能漂移的第二份鏈識別。
- 版本屬於各 topic 家族；未來只有該家族出現真實不相容 wire contract 時才升 major，
  不連帶要求其他 topic 改名。
- peer-discovery 是 topic grammar 的單一 owner，對外提供要求 `chainId` 的建構器與
  fail-closed parser／allowlist。chat-system、matchmaking、room 與 signaling 模組不得
  各自複製 wire prefix；需要保持 domain 與 transport 解耦時，由 bootstrap 注入 canonical
  topic factory。
- 測試不得只用被測模組自己的常數組 expected value；至少一支跨 bootstrap 邊界的契約測試
  必須證明各發送端建出的 topic 可被同一 canonical parser／allowlist 接受。
- D-20260731-01 的 signaling v1 裁決不變；本決策補足所有 GossipSub topic 共用的命名、
  chain namespace 與 ownership 規則。

## 後果與影響

此變更屬首次公開前 baseline 收斂，不建立舊 topic 的 dual subscribe、dual publish 或
migration。`open-4wd` 的 topic 建構、peer scoring、bootstrap adapters、tests 與 current
canon 必須在同一修復批次更新；不同鏈即使連到相同 pubsub mesh，也不會訂閱彼此的 Open4WD
application topics。topic major 與 payload discriminator 分屬路由隔離及訊息解析兩層，
兩者可同時存在且必須由 conformance tests 保持一致。
