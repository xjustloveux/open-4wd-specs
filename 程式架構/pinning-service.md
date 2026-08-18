---
type: impl
domain: ["版本部署"]
summary: IPFS pinning 自架／管理 API／授權／Cluster／自動 pin
authority: null
slug: null
---

# pinning-service（IPFS Pinning 自架實作）

> **本檔角色**：玩家可自架的 IPFS pinning 服務**實作層** —— TypeScript app 節點（ledger-peer ＋ 管理 API）、Ed25519 簽章驗證、IPFS Cluster 組態、k8s / CI/CD 模板、配額與 rate limit、訂閱帳本檢查點自動 pin（cold partition + P5 退役 unpin）、下架與拒服務（黑名單 / DMCA / Repeat Infringer，[§9](#9-下架與拒服務黑名單--dmca政策權威-dmcamd-5--moderationmd)）。
> 部署面（fork 後手動部署 / 與 ledger 整合）見 [部署資訊.md §3](../部署資訊.md)；安全 header 見 [資安規範.md §7](../資安規範.md) · [security.md](security.md)；退役 / DerivedState derive 規則見 [ledger.md](ledger.md)。對應 **open-4wd-pinning repo（TypeScript，與主專案同語言；帳本語意程式碼自主 repo 逐字 vendored）**；client 端契約見 [interfaces.md §7](interfaces.md)，HTTP adapter 位於 `src/pinning/`（沒有把 server 搬進 client）。Repo 層規格（目錄 ／ 變數 ／CI／ 自架）見 [../部署資訊/open-4wd-pinning.md](../部署資訊/open-4wd-pinning.md)。

## 1. 服務組成

`open-4wd-pinning` 公版 Template repo，部署單元 ＝ 一 pod 三容器：

| 容器           | image                                | 職責                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`          | 本 repo 唯一自建 image（TypeScript） | **ledger-peer node**（vendored 主 repo 帳本＋peer-discovery＋key-manager 棧）＝OrbitDB peer、libp2p bootstrap 門口（`/wss`＋自訂 DHT、選配 circuit relay）、檢查點訂閱自動 pin（[§7](#7-訂閱帳本檢查點自動-pin)–[§9](#9-下架與拒服務黑名單--dmca政策權威-dmcamd-5--moderationmd)）；**policy-aware API**（`:8000`，[§2](#2-管理-api)）＝簽章管理、root-scoped UGC 讀取、配額、rate limit＋選配 DMCA |
| `ipfs-kubo`    | 上游官方 image                       | 大容量內容倉庫；`:5001` RPC 與 `:8080` gateway 只在 pod／compose network 內，沒有公開 generic gateway                                                                                                                                                                                                                                                                                               |
| `ipfs-cluster` | 上游官方 image                       | 跨節點副本管理（`:9094` API、pod 內）                                                                                                                                                                                                                                                                                                                                                               |

app 為何必須是 TypeScript：檢查點事件走**帳本自身的 OrbitDB 複寫**（[§7](#7-訂閱帳本檢查點自動-pin)），其 entry 語意（Admission 准入、自訂 heads／entry-fetch 協定）只存在於主專案 TS 程式碼；bootstrap 門口需要瀏覽器 transports（`/ws`／`/wss`）與自訂 DHT 協定，同樣只有主專案 libp2p 組態能提供。kubo 是內容倉庫，不具備上述任何一項。

## 2. 管理 API

| Endpoint                           | 用途                | 摘要                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /provider`                    | 節點能力描述        | UGC read/write、legal notice、counter-notice、transparency 各自分欄；指定代理人登記為營運者自聲明，`safe_harbor_eligibility` 固定 `not-asserted`；可附 UGC／legal／privacy／retention 四類公開政策 HTTPS URL                                                                    |
| `GET /stats`                       | 節點狀態            | `node_id` / `version` / `uptime` / `total_pinned_count` / `total_size_bytes`（logical root bytes）/ `accepting_pins` / `quota_used_bytes` / `quota_limit_bytes`（Cluster roots 引用的唯一 block bytes）/ `available_space_bytes` / `ipfs_cluster_peers` / `last_sync_timestamp` |
| `GET /api/ugc/<root>/blocks/<cid>` | 受控 UGC block 讀取 | `ugc_read` 啟用、root 未 deny、root 仍 pin 且 traversal index 包含 cid 才回 raw block；invalid CID＝400，其餘 policy deny／missing＝404；`Cache-Control: private, no-store`                                                                                                     |
| `POST /pin`                        | pin 一個 CID        | body＝SignedPayload（[§3](#3-簽章驗證與授權)）、payload `{ type:'pinning-pin', cid, category, sizeHintBytes }`；403 `SIG_INVALID` / `NOT_AUTHORIZED` / `BLACKLISTED` / `REPEAT_INFRINGER`、413 超限、429 逾率、507 超配額                                                       |
| `POST /unpin`                      | unpin 一個 CID      | body＝SignedPayload、payload `{ type:'pinning-unpin', cid }`；僅原 signer 或白名單成員可 unpin                                                                                                                                                                                  |

公開簽章 API 的 `category` 是封閉詞彙：`'track' | 'part'`；未知值一律以 `SIG_INVALID`
拒絕。`checkpoint`、`derived-state`、`signer-set`、`cold-partition` 等只屬節點內部
`source:'auto'` metadata，不得由 `/pin` 客戶端宣告，也不與公開 API 詞彙混用。
配額拒絕固定回 `507 { error:'QUOTA_EXCEEDED', reason }`，其中 `reason` 只允許
`'signer-pins' | 'signer-size' | 'global-size'`。
服務不提供公開 pin inventory 列舉；cluster list 只在節點內供 `/stats`、配額與 reconcile 使用。

`GET /provider` 的 `ugc_read` 必須宣告 `open4wd-unixfs-1m-balanced-v1`、raw/dag-pb roots、
sha2-256、1 MiB chunks、80 MiB logical、81 blocks，以及 root-scoped path template、CORS 模式與
CAR v1 支援狀態。現行 provider 只供 block API，故 `car_v1:false`；CAR 組裝與保存由 client 負責。
pin ingestion／reconcile 對 dag-pb root 解碼 UnixFS Data，驗 blocksizes/raw leaves/深度與 limits，
Kubo 寫入 root 使用 `cid-codec=dag-pb`；非 canonical DAG fail-closed。

線上 UGC 讀取順序固定為本機快取 → 玩家／社群 Helia Bitswap（短 timeout）→ 玩家所選
provider 的 root-scoped HTTP API。Provider fallback 的每個 block request 必須同時帶 UGC root；
不得把 raw `/ipfs/<cid>` 視為受 provider policy 控制的候選。每條路徑共用 CID 驗證、回應／
DAG 大小上限與 GLB sanitizer。有限 provider candidates 採 first-valid-wins：transport 2xx 但
CID／GLB／sanitizer 驗證失敗只淘汰該 candidate，必須繼續下一個；不可在外層拒絕後提早終止
整組 fallback。Bootstrap／DHT 只發現 peer，不承載 UGC payload；只有某個
app 實際經 ledger-only Bitswap 供塊、作 Circuit Relay 轉送，或回應 root-scoped API 時，流量才
經該營運者伺服器。初期不強制 Bitswap 排除任何 peer，以[§10](#10-可觀測性與告警)分來源指標
與 relay 上限觀察。

browser client 以有界 HTTP adapter 呼叫：response 上限 64 KiB、預設 5 秒 timeout、
嚴格 JSON shape／CID 驗證；descriptor 的政策 URL 限 2,048 字元、HTTPS 且不得含
credentials／query／fragment，未知鍵一律拒絕。先確認 `GET /provider` 的 UGC write capability，再要求
`GET /stats` 的 cluster peer 數與剩餘空間都大於 0 才算 available。主站與任一 pinning API
可能跨 origin，因此 API 必須以部署 allowlist
處理 CORS 與 `OPTIONS` preflight；禁止用無條件 `Access-Control-Allow-Origin: *`
搭配認證。實作欄位為 env `CORS_ALLOWED_ORIGINS`（逗號分隔）／YAML
`cors_allowed_origins`：只接受明示的 `http(s)://host[:port]` origin，拒絕 wildcard、
credentials、path、query 與 fragment；空值預設不回 CORS header。可信 origin 的
GET／POST 回應逐 request 回顯同一 origin，preflight 只允許 GET／POST 與
`content-type`，且不啟用 credentials。

client 只有在 507 body 同時符合 exact shape、`error:'QUOTA_EXCEEDED'` 與上述封閉 reason
時才保留 `PinningHttpError.reason`；未知、畸形或超過 64 KiB 的 error body 一律只留下
`code:'quota-exceeded'`，不暴露上游 body。其他 HTTP status 不讀取錯誤 body。

## 3. 簽章驗證與授權

`/pin`／`/unpin` 的 body 是 [key-manager.md](key-manager.md) 的 **SignedPayload**（`{ nonce, timestamp, signer, payload, signatureHex }`），簽章 message＝`sha256(dagCbor.encode({ nonce, payload, signer, timestamp }))`（`buildSignedMessage` 同式；驗章直接用 vendored key-manager，與 client 端位元組相容天生成立）。防護三件套：

- `payload.type`（`'pinning-pin'`／`'pinning-unpin'`）＝ 域分隔，pin 簽章不可重放為 unpin；
- `timestamp` ±30 秒窗（與協定時戳容忍窗同源常數）；
- `nonce` 去重（記憶體、TTL＝2× 窗；重啟後窗外請求由時戳擋）。

授權 ＝ 兩模式**聯集**（兩者皆未設 ＝ 拒所有 API pin；[§7](#7-訂閱帳本檢查點自動-pin) 的自動 pin 不受影響）：

```yaml
# config.yaml
auth:
  authorized_signers: # 模式一：靜態白名單（公開 PeerId）
    - "12D3KooWMainProject..."
    - "12D3KooWCommunity1..."
  reputation_threshold: 650 # 模式二：信譽 ≥ 閾值自動授權（缺省＝停用）
```

信譽讀**節點自己 derive 的 DerivedState**（[reputation.md](reputation.md) · [ledger.md](ledger.md)）——app 本身就是帳本 replica，不依賴任何外部服務。

## 4. IPFS Cluster 組態

```jsonc
// service.json
{
  "cluster": {
    "secret": "<secret>",
    "replication_factor_min": -1,
    "replication_factor_max": -1,
  },
  "ipfs_connector": {
    "ipfshttp": {
      "node_multiaddress": "/dns4/kubo/tcp/5001",
    },
  },
  "consensus": { "crdt": { "cluster_name": "open-4wd-pinning" } },
}
```

> **注意 cluster replication 與 provider 故障域不同層**：現行 template 的 `replication_factor_min/max` 為 `-1/-1`，表示在該 pinning cluster 的所有現有 peers 配置內容；[protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽) 的 `LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED: 3` 是跨獨立 provider 故障域的 best-effort 可得性建議。前者是 cluster 配置，後者只是 UI／營運觀測；兩者都不是永久留存或恢復保證。

kubo 另設 Peering 指向同 pod 的 app 節點；app 的公共 Bitswap store 只使用全新的
`ledger-blocks` 目錄，pin ingestion 從 mesh 取回的 UGC 不回填該 store，而是由 app 驗證後直接
block put Kubo（[§7](#7-訂閱帳本檢查點自動-pin)）。公版固定
`KUBO_ROUTING_TYPE=none`、清除 public bootstrap、停用 mDNS／NAT traversal／relay，僅使用明示
Peering；gateway 設 `NoFetch=true`，且不由 Docker host、Kubernetes Service 或 Ingress 公開。
另行開放 public Kubo／generic Bitswap 的 deployment 不屬本 provider descriptor 的受控供應面。

## 5. k8s / CI/CD 模板

公版 k8s 範本固定 `replicas: 1`，單一 pod 含 3 容器：`ipfs-kubo`（:5001 API /
:8080 Gateway / `:4101` Swarm；避開同 netns 的 app listener）、`ipfs-cluster`（:9094/:9095/:9096）、`app`
（:8000 管理 API、:4001/ws libp2p 監聽；同 pod 預設以
`CLUSTER_API_URL=http://127.0.0.1:9094`、`KUBO_API_URL=http://127.0.0.1:5001`
互連）；掛 `ipfs-pvc`(100Gi) + `cluster-pvc`(10Gi) + **`app-pvc`**
（blockstore／datastore／orbitdb log／dmca-notices）。三顆 PVC 皆為 ReadWriteOnce，
不可直接提高 Deployment replicas；真正多節點需改為每副本獨立 volume（例如
StatefulSet＋volumeClaimTemplates）並另設路由，非本公版範本範圍。`Service`／ingress
的標準 Ingress 只公開 policy-aware API（→8000）；libp2p `wss`（app :4001）刻意不放進
這份 HTTP Ingress。維運者須依 controller 明示選擇一條 TCP 路線：nginx-ingress 在 controller
層設定 `tcp-services` ConfigMap 並開對應 Service port；以獨立 LoadBalancer／NodePort Service
公開 4001 並使用另一個 port／子網域；或使用 Traefik 等 controller 專屬的 TCP ingress CRD。
三者都須另行配置 TLS 與 `/wss` multiaddr，不能把標準 HTTP Ingress 描述成已經公開 wss。

Base Compose／Kubernetes 不硬編 CPU／RAM requests/limits。Repo 必須提供 opt-in Compose
resource override、Kustomize sizing overlay 與量測 runbook；範例值只供複製後依 pinset、合法最大
DAG、並行量、gateway／bootstrap／relay／routing 角色實測調整，不構成公版容量保證。Kubo
`GOMEMLIMIT` 管整個 Go process；`Swarm.ResourceMgr.MaxMemory` 只管 libp2p，不得混稱。

CI/CD 管線（build ／ secrets 注入 ／ 部署 ／ smoke ／ 回滾）**以 [../部署資訊/open-4wd-pinning.md §4](../部署資訊/open-4wd-pinning.md) 為權威**（repo 層）；本節只留 k8s 部署形狀。

## 6. 配額與 Rate Limit

```yaml
quotas:
  per_signer_max_pins: 10000
  per_signer_max_size_gb: 50
  global_max_size_tb: 0.0625
```

per-signer 件數與 logical 用量的事實來源是 Cluster pin metadata（每筆 pin 記 `signer`／
`category`／`logicalSizeBytes`／`physicalSizeBytes`／`source:'api'|'auto'`）；provider-global
physical 用量則以「目前所有 Cluster roots 引用的唯一 Kubo blocks」為權威。啟動時列出 roots、
逐一量測完整 DAG 並建立記憶體引用索引，之後在 pin/unpin 成功後增量維護，零獨立資料庫。

- per-signer 件數與容量使用完整 DAG 的 logical referenced bytes；auto pin 不計 signer 配額。
- provider-global 配額是所有 roots 的 block CID 聯集大小總和；跨 root shared child 只計一次，
  任一 root unpin 不會釋放仍被其他 root 引用的 bytes，最後一個引用解除才扣除。API、checkpoint
  reconcile 與 DMCA restore 共用同一 admission，Cluster pin/unpin 成功後才更新引用索引。
- metadata `physicalSizeBytes` 保留該 root 當次 ingress 實際新增 bytes 作診斷與恢復 provenance，
  不作 provider-global quota 權威；同 CID replacement 先移除舊引用再套新實量。
- `total_size_bytes` 是目前 root logical bytes 合計；`quota_used_bytes`／`quota_limit_bytes` 與
  `accepting_pins` 是 provider-global unique referenced block 帳本。`available_space_bytes` 則是 Kubo
  repo 容量訊號，兩者不可混稱。
- unique referenced blocks 仍不是 Kubo 即時磁碟占用：GC 前未 pin cache 與非本服務資料不計入。
  部署必須維持 `app global quota < Kubo StorageMax < volume/filesystem capacity`，三者一起調整並
  替 repo metadata、未 pin cache 與 GC 保留 headroom。範本一致起點為 64 GiB < 80 GB < 100 Gi，
  不是容量保證；`StorageMax` 也不是 filesystem hard quota。

Cluster pin 列表不可讀、任一 root 在 Kubo 的 DAG 不完整或量測失敗時，服務仍啟動但配額帳標成
不可用：新 pin／auto pin／restore reservation 一律 fail-closed，`accepting_pins=false`；unpin 與
DMCA takedown 保持可用。修復依賴後必須重啟並完整重建，不得以空帳本繼續收件。

超 `per_signer_max_pins`、per-signer logical 或 provider-global unique referenced block bytes 即拒。
HTTP rate limit 由兩個 token bucket 並行：讀 body 前先依 TCP remote IP 限制；驗章後再依
signer 身分限制，故換 IP 不能繞過身分層。兩桶各有獨立 `capacity`／`refill_per_sec` 設定，
逾額皆回 429。

`sizeHintBytes` 是簽章涵蓋的**正整數、完整 DAG logical bytes 硬上限**，不是可低報的估值。
流程固定為：以 hint 對 signer logical 與 provider-global 最壞新增 physical 做 in-flight
reservation → 有界搬運 → 以 `logicalDagBytes`、`newPhysicalBytes` 與完整 block 清單實量複查 →
Cluster pin → reservation 原子轉正式 metadata 與引用索引。不同 CID 的並行 reservation 會互相占額度；同 CID 同時只允許
一筆。超限、逾時、實量複查或 Cluster 失敗均釋放 reservation，不留下可供應的 Cluster pin；
先前已寫入但未 pin 的 Kubo blocks 只屬可由 repo GC 淘汰的 cache。

所有 `raw`／`dag-cbor` 搬運（含 checkpoint reconcile）共用硬界：預設 logical bytes 2 GiB、
4,096 blocks、graph depth 128、每 block 1,024 links、decoded IPLD container nesting 64；API
的 byte 上限另取 `min(sizeHintBytes, 2 GiB)`。超 byte 會在該 block 寫入 Kubo 前停止；
AbortSignal 於來源讀取、CID 驗證、Kubo 查詢／寫入等非同步步驟邊界檢查。`GET /stats` 直接讀
啟動全量重建、之後增量更新的 quota snapshot，不因公開查詢掃描整份 Cluster pinset。

## 7. 訂閱帳本檢查點：自動 pin

**機制**：`LedgerCheckpointEvent` 沒有獨立廣播頻道——它與其他永久事件一樣走**帳本自身的 OrbitDB 複寫**（gossipsub topic＝ 帳本 address、自訂 heads／entry-fetch 協定、Admission 准入）。app 節點以 vendored 帳本棧作為真 OrbitDB peer 同步事件鏈，checkpoint 事件（薄指標：`checkpointCid`＋ 多簽）經採納路徑驗證後，觸發 reconcile，pin 三類資料：

**採納模式**：帳本檢查點採納分兩級——`full-refold`（驗證者語意：驗多簽後以全域
applier registry 重摺整窗、逐位比對 derived state；主 repo 客戶端預設）與
`quorum-follow`（跟隨者語意：驗多簽 quorum→ 解碼 checkpoint 內 derived state→ 自採納
state 讀取下一 epoch `governanceSigners` 鏈式推進信任根；epoch 單調 ＋prev checkpoint
鏈接連續性防回滾）。**pinning app 已明確接用 `quorum-follow`**；主 repo 客戶端仍以
`full-refold` 為預設。領域事件窗 E2E 必須讓產生端具備 replica 未載入的 reducer，並證明
replica 採納 canonical state 與觸發 auto-pin，避免退回「兩端剛好同 registry」的假通過。
信任根 bootstrap 由部署 config `GOVERNANCE_SIGNERS` 提供，啟動時固定排序並寫入 ledger
genesis；它不是可在 ledger options 旁路注入的 signer callback。空值就是 genesis 的空集合，
遠端 checkpoint 採納與自動 pin 均 fail-closed。

1. **檢查點本體** — `checkpointCid`、`checkpoint.derived_state_cid`、`checkpoint.signer_set_cid`
2. **Cold match partitions** — 從 `DerivedState.coldMatchPartitions` 解出每個 quarter 的 partition CID 全 pin
3. 掃描 Cluster 現有 pin，只對 `source:'auto'` 且 `category:'cold-partition'` 的服務自動 pin
   比對目前 `coldMatchPartitions`；unpin 已不再被引用的舊 CID（正常只在 partition 併入更大
   區間或 P5 退役才消失）。API pin、其他 auto 類別與缺少完整 metadata 的記錄一律不碰。

**資料流**：app 的 helia 自遊戲 mesh 抓全 DAG → 依每塊 CID 自帶 codec 驗證並 block put 尚缺的
block 進 kubo（CID 不變；raw 是 opaque leaf、dag-cbor 才解析 links，未知 codec fail-closed）→
套用 §6 的 byte／block／depth／fan-out／IPLD nesting 硬界 → 共用 provider-global quota
admission → cluster pin（metadata
`source:'auto'`＋雙計量）→ 成功後即時記帳。單筆搬運、配額或 cluster 失敗只 log 警告、
不中斷其餘。冷分區清理以 Cluster 持久 pin 現況對目前 state 做全量差集，不依賴相鄰 checkpoint
diff；所以 unpin 失敗的 orphan 仍留在下一輪候選，會持續重試。unpin 只在 Cluster 成功後釋放帳面用量。

```ts
async function onCheckpointAdopted(cp: LedgerCheckpoint): Promise<void> {
  await pinDag(cp.cid, "checkpoint");
  await pinDag(cp.derived_state_cid, "derived-state");
  const state = await fetchDerivedState(cp.derived_state_cid);
  for (const [key, cid] of Object.entries(state.coldMatchPartitions)) {
    try {
      await pinDag(cid, `cold-match-${key}`);
    } catch (error) {
      logWarn(`pin cold partition ${key}`, error);
    } // 不中斷，續 pin 其他
  }
  await reconcileColdPartitions(state.coldMatchPartitions);
}
```

Cold partition 引用的唯一 block bytes 計入 `global_max_size_tb` 配額；隨年數每季 +1
partition 線性增長，單 partition 容量受時間切片上限。

> **註**：pinning 訂閱的 `LedgerCheckpointEvent` 是**治理層帳本檢查點**（≠ 賽道 `Checkpoint_<n>` / 回合錨 `RaceConsensusAnchorEvent`，見 [ledger.md](ledger.md)）。

## 8. P5：UGC 退役自動 unpin

同一 reconcile 迴圈，從 `DerivedState.ugc.ugcRecords` 掃 `retired: true` 的 CID → 自動 unpin（連帶釋出 global 配額）；單筆失敗 log 警告不中斷。

退役**非黑名單**：任何玩家若仍有 local cache 可重新 `/pin`（個人配額足夠即可）；或寫 `UgcMaintenanceEvent { reason: 'unretire' }` 主動激活，下次檢查點套用後自動恢復 pin。退役 derive 規則（自動條件 + 手動 `UgcMaintenanceEvent reason:'retire'`）與執行邊界見 [ledger.md](ledger.md) · [moderation.md](moderation.md)。

## 9. 下架與拒服務（黑名單 / DMCA；政策權威 [dmca.md §5](dmca.md) / [moderation.md](moderation.md)）

與 [§8](#8-p5ugc-退役自動-unpin) 同一檢查點訂閱迴圈，多掃兩類：

- **仲裁黑名單 CID**（`DerivedState.moderation.blacklist`，[ledger-checkpoint.md §2](ledger-checkpoint.md)）→ 自動 unpin（同退役機制）；**拒絕重新 `/pin`**（與退役不同——黑名單 = 下架，退役可復活）。
- **DMCA 下架**：`unpin(cid)` 由各 provider 自己的 DMCA 處理流程觸發（notice 受理 → 下架，[dmca.md §5](dmca.md)）；案件不建立 client-wide 清單或全網 use-gate。
- **DMCA 與 quota 同帳**：下架前把原 category/source/signer 與雙計量存入 provider 私有案卷；
  每筆 Cluster unpin 成功才釋放 quota。恢復重新驗完整 DAG／量 logical bytes，以原 physical
  attribution reserve，Cluster pin 成功才 commit，不建立缺 metadata 或零計量的恢復 pin。
- **Repeat Infringer 拒服務**：takedown 未恢復數達 `REPEAT_INFRINGER_THRESHOLD` → 拒 pin 該創作者新上傳。它是 **pinning 維運政策常數、非治理 config**；值只由 [protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽) 定義，流程見 [dmca.md §5](dmca.md)。
- **DMCA notice 後端 API（可選，`DMCA_ENABLE` 預設關）**：app 同行程掛 dmca-notices 受理 / publicView / admin 裁決（[dmca.md §2](dmca.md)；notices 存**節點本地 level 儲存**（app-pvc、可真刪除 ／ 歸檔抹除、絕不進 content-addressed 供應面——[dmca.md §3](dmca.md)）、email 確認關走 SMTP；**僅限單一實例掛載**（`replicas>1` 以 ingress 固定路由）；[../部署資訊.md §3.4](../部署資訊.md)）。

## 10. 可觀測性與告警

`GET /stats` 保留為低敏感度健康摘要與部署 smoke，不等同 Prometheus 時序資料。公版另提供
**預設關閉**的獨立 metrics listener：設定明確的 metrics port 才啟動 `/metrics`，關閉時
注入 no-op adapter，避免業務碼散落開關分支；metrics listener 不與公開管理 API 共用 ingress。

Prometheus labels 只使用低基數枚舉（例如 `transport=bitswap|relay|gateway`、
`result=ok|timeout|error`），禁止 PeerId、IP、CID、RoomId、notice id、email 或自由文字 reason。
每次 scrape 以 pull-time collector 讀 Kubo `RepoSize`／`StorageMax` 與 quota snapshot，輸出
`open4wd_pinning_repo_size_bytes`、`open4wd_pinning_storage_max_bytes`、
`open4wd_pinning_quota_global_used_bytes`、`open4wd_pinning_quota_global_limit_bytes` 四個無 labels
gauge；Kubo 不可讀時 `/metrics` 回 503，不輸出可能過時的容量值。
至少量測：

- Bitswap 供應／取得 bytes、request、timeout 與來源角色；
- Circuit Relay reservation、active stream、拒絕數、轉送 bytes 與容量水位；
- HTTP Gateway request、bytes、status class、latency；
- DHT／Gossip control bytes 與錯誤、storage／cluster 容量與 peer 健康；
- ledger 同步落後、管理 API rate-limit／錯誤、DMCA 每日 sweep 成功／失敗／延遲。

公版 overlay 使用 Prometheus＋Grafana＋Alertmanager；raw `/metrics` 只在內網由 Prometheus
抓取。Grafana 私有入口、Access／MFA 與 Alertmanager 通知通道均由營運者自行選擇；公版不
指定維護者域名、私人通道、Email 或外部 uptime 供應商。告警需同時
設定持續時間與最低樣本數，避免低流量時以單一錯誤觸發。Kubo repo／StorageMax 與 global
quota／limit 各有一條 `> 80%` 告警，均要求 10 分鐘內至少三次 scrape 且持續 10 分鐘；宿主
filesystem 仍由 node exporter 等部署層資料源負責。公版部署範例見
[open-4wd-pinning §6](../部署資訊/open-4wd-pinning.md)。

## 11. 跨模組對接

| 模組                                                          | 對接                                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ledger.md](ledger.md)                                        | app＝帳本 OrbitDB peer；檢查點採納 / DerivedState（coldMatchPartitions / ugcRecords）/ 退役 derive                                                 |
| [peer-discovery.md](peer-discovery.md)                        | app 可選兼任 libp2p bootstrap 門口（`/wss`＋自訂 DHT、選配 circuit relay）；公開 multiaddr 可分別登錄 community registry，listing 不自動授權 relay |
| [moderation.md](moderation.md)                                | 退役執行邊界；黑名單 ≠ 退役；黑名單 CID unpin（[§9](#9-下架與拒服務黑名單--dmca政策權威-dmcamd-5--moderationmd)）                                  |
| [dmca.md](dmca.md)                                            | Provider-scoped DMCA unpin + Repeat Infringer 拒服務 + notice API（[§9](#9-下架與拒服務黑名單--dmca政策權威-dmcamd-5--moderationmd)）             |
| [reputation.md](reputation.md)                                | 信譽分 ≥ 閾值自動授權（讀自家 DerivedState）                                                                                                       |
| [key-manager.md](key-manager.md) · [security.md](security.md) | SignedPayload 簽章（vendored、位元組相容）/ 安全 header                                                                                            |
| [部署資訊.md §3](../部署資訊.md)                              | fork 後手動部署 / 玩家自架說明                                                                                                                     |
