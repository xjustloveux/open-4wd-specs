---
type: deploy
domain: ["版本部署"]
summary: pinning 公版模板 repo 規格（TypeScript app＋kubo＋cluster）
authority: null
slug: null
---

# open-4wd-pinning 部署規格

> **本檔角色**：`open-4wd-pinning` 的 **repo 層規格** —— 目錄結構、部署變數 / secrets、CI/CD 管線、自架指南、維運 runbook。
> 服務**內部實作**（管理 API schema / Ed25519 授權 / IPFS Cluster 組態 / 檢查點訂閱 pin / 下架與拒服務）見 [程式架構/pinning-service.md](../程式架構/pinning-service.md)；部署政策見 [部署資訊.md §3](../部署資訊.md)。
> 共通部署模型只由 [部署資訊.md §1.1](../部署資訊.md) 定義。本 repo 的差異是提供 TypeScript
> app、config／manifests／CI，並發布 public GHCR image；帳本語意程式碼自主 repo 逐字 vendored。

> 初期 pinning、bootstrap 與 TURN 可共用同一台 server，但 repo、process/container、port／ 防火牆、資料卷與 secrets 邊界仍獨立；完整取捨見 [部署實際值與初始拓撲.md](部署實際值與初始拓撲.md)。

## 0. Fork 後手動一鍵部署（GKE）

公版隨附 dispatch-only `.github/workflows/deploy.yml`；只有 fork 明示設定
`DEPLOY_ENABLED=true` 才執行。公版沒有部署 secrets，不會產生官方 endpoint。

GitHub secrets、variables、條件必填關係與替代自架路徑只由
[§3.2](#32-維運者-fork-與替代自架路徑)／[§3.4](#34-genesis-one-shot-與維運腳本環境變數)
的變數表定義；本節只描述操作順序。

叢集前置：GKE、nginx ingress、cert-manager 與名為 `letsencrypt-prod` 的 ClusterIssuer；DNS 的
`DOMAIN` 指向 ingress。手動 Run workflow 後，流程在 checkout 外渲染全部 `REPLACE_` 佔位，
apply Kubernetes Secret 與 kustomization，等待 rollout，再對 `https://DOMAIN` 跑 strict smoke；
失敗自動 rollout undo。Certificate 由 cert-manager 自動續期並寫入
`open4wd-pinning-tls`，nginx ingress 熱載，不重啟 app pod。

## 1. 定位與職責

- **獨立 pinning provider**：依營運者政策供應其持有的 IPFS 內容；UGC read/write、retention、
  legal 與 transparency 能力各自聲明。任一節點與 `LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED: 3`
  都只提供 best-effort 可得性觀測，不保證永久保存、持續上線或日後可恢復。
- **可選兼任**：libp2p bootstrap 節點（獨立登錄 community `bootstrap.json`）、DMCA notice 後端 API、帳本檢查點訂閱自動 pin、下架 / Repeat Infringer 拒服務執行點；這些能力彼此獨立宣告。
- 候選來源 = [interfaces.md §7](../程式架構/interfaces.md) `PinningProvider.source`：`manual` / `session` / `community`；來源不是信任層級，玩家設定頁自行新增、選擇與移除節點。
- 主 repo 不維護預設節點清單、不聚合成官方服務；節點可自願公開能力與透明度摘要，client 只對玩家已選節點讀取可用資料。
- 自建 `app` 映像與 `deploy/k8s/` manifests 須符合[資安規範.md §8](../資安規範.md) 容器安全基線；本 repo 是三顆 Template 中唯一發布 public image 者，基線在首次推 GHCR 前必須滿足。

## 2. Repo 目錄結構

```text
open-4wd-pinning/
├── core/
│   └── vendor/                   # 主 repo 逐字 vendored：ledger / peer-discovery / key-manager ＋傳遞依賴（MANIFEST.json 記 sha256）
├── app/
│   └── main.ts                   # service 組合根：設定、依賴與 listener 啟動
├── node/                         # Node 端 ports、libp2p runtime（ws listener / 自訂 DHT / 選配 relay）、identity 與帳本節點
├── subscriber/                   # 帳本檢查點採納 → reconcile：pin / 退役 unpin / 黑名單 / repeat-infringer（pinning-service.md §7–§9）
├── pinning/                      # kubo（block put）／cluster（pin / unpin / list）客戶端＋metadata 記帳與配額彙算
├── api/                          # /provider /stats /pin /unpin（schema 見 pinning-service.md §2）＋簽章 middleware＋rate limit
├── auth/                         # SignedPayload 驗章（vendored key-manager）＋授權：白名單 ∪ 信譽閾值（§3）
├── dmca/                         # provider-scoped notice／counter／簽章 inbox／Admin API
├── dmca/openapi.ts               # OpenAPI 3.1 契約；Swagger UI 選配且預設關閉
├── metrics/                      # Prometheus adapter＋no-op adapter；獨立 listener、預設關閉
├── config/
│   ├── config.example.yaml       # auth（authorized_signers / reputation_threshold）/ quotas / rate limit
│   └── service.json              # IPFS Cluster 組態模板（ipfs-cluster 標準檔名；pinning-service.md §4）
├── scripts/                      # vendor-* / ledger-genesis* / dmca-export* / smoke* / workflow.spec.ts 等維運與契約門檻
├── e2e/                          # ledger auto-pin 跨程序 E2E 與 compose 測試拓撲
├── integration/                  # genesis replica 與 pin-flow 整合測試
├── deploy/
│   ├── k8s/                      # base manifests＋opt-in sizing-example Kustomize overlay
│   ├── docker/                   # base compose＋opt-in compose.resources.example.yml
│   ├── monitoring/               # Prometheus／Alertmanager 設定、告警規則與 runbook
│   └── sizing/README.md          # 實測、headroom、故障注入與 routing 資源影響
├── .github/workflows/cicd.yml    # 驗證＋GHCR 發佈
├── .github/workflows/deploy.yml  # dispatch-only＋DEPLOY_ENABLED opt-in
├── LICENSE                       # 同主專案 license
└── README.md                     # 自架 quickstart（= 本檔 §5 摘要）
```

## 3. 部署變數與 Secrets

### 3.1 公版 repo＝零 secrets

無任何 secret；deploy workflow 只是未啟用的機制。CI 以內建 `GITHUB_TOKEN`（`packages: write`）發佈 public image 至 **GHCR**（[§4](#4-ci公版與營運者部署)）——非自設 secret。

### 3.2 維運者 fork 與替代自架路徑

| 變數                                                               | 位置                          | 說明                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公版 workflow 部署憑證                                             | GitHub secret                 | `KUBE_CONFIG`（k8s API 可遠端連）；SSH 與 compose 若由營運者另行採用，屬其 fork／clone 外自行維護的替代自架流程，不是公版 workflow 輸入                                                       |
| `IMAGE_OWNER`                                                      | GitHub variable               | **必填**；公版 GHCR image owner，須符合 GitHub owner 字元規則；workflow 轉小寫後渲染 `ghcr.io/<owner>/open-4wd-pinning-app`                                                                   |
| `IMAGE_TAG`                                                        | GitHub variable               | **必填**；已通過公版 CI／provenance gate 的明確 image tag；不得依賴未審核的隱含預設值                                                                                                       |
| `CONFIG_PATH`                                                      | service env                   | 選填 YAML 路徑；未設時讀 `config/config.yaml`。env 仍覆寫 YAML，YAML 再覆寫內建預設                                                                                                           |
| `PORT` / `DATA_DIR` / `LISTEN_WS` / `BOOTSTRAP`                    | config / env                  | 管理 API port、持久資料根、libp2p WebSocket listen multiaddr 與 bootstrap multiaddr 清單；`LISTEN_WS`／`BOOTSTRAP` 多值以逗號分隔                                                             |
| `AUTHORIZED_SIGNERS`                                               | config.yaml（CI 注入）        | 授權 pin/unpin 的 peer_id 白名單（或信譽閾值模式，[pinning-service.md §3](../程式架構/pinning-service.md)）——填**公開 PeerId**、非機密（產生見 [§3.3](#33-金鑰token-產生runbook)）                    |
| `REPUTATION_THRESHOLD`                                             | config / env                  | 選填正整數；未設即停用信譽授權，只認 `AUTHORIZED_SIGNERS` 白名單                                                                                                                               |
| `GOVERNANCE_SIGNERS`                                               | config / env                  | checkpoint 多簽的初始公開 trust root，須與主網 signer set 一致；空值＝checkpoint 自動 pin fail-closed，授權 `/pin`／`/unpin` 不受影響                                                                 |
| `CLUSTER_SECRET`                                                   | secret → cluster-service.json | IPFS Cluster 叢集共享密鑰（每叢集自產、不可沿用他人；[§3.3](#33-金鑰token-產生runbook)）                                                                                                              |
| `CLUSTER_API_URL` / `KUBO_API_URL`                                 | config / env                  | app 連往 Cluster／Kubo 管理 API 的內部 URL；預設為 `http://127.0.0.1:9094`／`http://127.0.0.1:5001`，不得公開成玩家 gateway                                                                     |
| `DOMAIN` / TLS                                                     | ingress                       | policy-aware API 端點域名——**與主站 origin 解耦**（[部署資訊.md §8.4](../部署資訊.md) CI 不變式）；不公開 Kubo gateway                                                                                   |
| `CORS_ALLOWED_ORIGINS`                                             | config / env                  | 可呼叫管理 API 的瀏覽器 origin 逗號清單；維運者只填明確允許的完整 origin（scheme＋host＋選填 port）。空值＝不開放跨來源；拒絕 `*`、credentials、path、query、fragment                                 |
| `QUOTA_*`／`KUBO_STORAGE_MAX`／PVC 大小                             | config / manifests            | 三者依實際資源一起調整，固定維持 app global quota < Kubo StorageMax < volume/filesystem capacity 並留 GC headroom（範本 64GiB < 80GB < 100Gi）；公版 Deployment 固定 `replicas: 1`，不能直接調高 replicas |
| `KUBO_ROUTING_TYPE`                                                | kubo env                      | 預設 `none`＝只用明示 Peering、不參與 public DHT；明示改成 production routing mode 即恢復 public bootstrap，須重做 sizing 並揭露 generic block 供應、root-policy 旁路與隱私邊界                    |
| `RATE_LIMIT_*` / `SIGNER_RATE_LIMIT_*`                             | config / env                  | 管理 API 的 per-IP 預驗章桶與 per-signer 驗章後桶；兩者同時生效且各自設定 capacity／refill，避免單靠換 IP 繞過身分限流                                                                                |
| `BOOTSTRAP_PEER_PRIVKEY`                                           | secret                        | **app 容器**的固定 libp2p identity（僅在營運者選擇兼任 bootstrap 時需要；公開 multiaddr 可提交 community `bootstrap.json`，listing 不授權 relay）；選擇性（產生見 [§3.3](#33-金鑰token-產生runbook)） |
| `BOOTSTRAP_PEER_ID` / `KUBO_PEERING_APP_MULTIADDR`                 | deploy env                    | 固定 app identity 的公開 PeerId 與 Kubo 撥向 app 的內部 multiaddr；兩者都存在才寫入 Kubo `Peering.Peers`，任一缺席即略過                                                                       |
| `LEDGER_DB_ADDRESS`                                                | config                        | 帳本 OrbitDB address——app 作為帳本 peer 同步事件鏈的目標（與主專案部署值一致）                                                                                                                        |
| `GENESIS_TIMESTAMP`                                                | config / env                  | ordinary genesis public receipt 的正整數 UTC 毫秒；service／replica 必須逐字一致，缺值、0、非安全整數或本機啟動時間一律 fail closed                                                                  |
| `RELAY_ENABLE`                                                     | config                        | app 的 circuit relay v2（給嚴格 NAT 瀏覽器保留 slot）；預設開、可關                                                                                                                                   |
| `PROVIDER_UGC_READ_ENABLE` / `PROVIDER_UGC_WRITE_ENABLE`           | config / env                  | 分別宣告此節點是否供應／接受 UGC；write 關閉只拒絕新 `/pin`，不關閉 `/unpin`，也不受 `DMCA_ENABLE` 連動                                                                                               |
| `PROVIDER_TRANSPARENCY_ENABLE`                                     | config / env                  | 是否公開該節點的聚合透明度資料；仍須同時啟用 DMCA。未提供時 client 忽略，不推論違法或不可信                                                                                                           |
| `PROVIDER_POLICY_{UGC,LEGAL,PRIVACY,RETENTION}_URL`                | config / env                  | 四類選填公開政策頁；只接受無 credentials／query／fragment 的 HTTPS URL。存在只代表營運者提供連結，不代表主專案背書或推導合規                                                                          |
| `DMCA_ENABLE`                                                      | config                        | legal notice／counter-notice API 總開關，預設關；與 UGC read/write 完全獨立。開啟即承擔此節點的收件與處理責任（見 [§5](#5-自架指南)）                                                                 |
| `DMCA_DESIGNATED_AGENT_REGISTRATION`                               | config                        | 維運者聲明 `not-declared`／`registered`；僅描述登記事實，不代表 client 或公版 repo認定其安全港資格                                                                                                    |
| `DMCA_ADMIN_TOKEN`                                                 | secret                        | Admin API 應用層 Bearer；`DMCA_ENABLE=true` 時**必要**，缺席即 fail-fast，不得自動產生不可取得的值（token 產生見 [§3.3](#33-金鑰token-產生runbook)）                                                  |
| `DMCA_ADMIN_OPERATOR_ID` / `DMCA_TRUST_CLOUDFLARE_ACCESS_IDENTITY` | config                        | 以部署標籤記錄操作者；只有 origin 封閉於 Tunnel/Access 後才可信任 Cloudflare email header                                                                                                             |
| `DMCA_ADMIN_DOCS_ENABLE`                                           | config                        | self-host Swagger UI 開關，預設關；OpenAPI 契約仍隨公版交付。啟用後 docs 與 Admin API 必須套同一外層存取政策                                                                                          |
| `SMTP_URL` / `DMCA_AGENT_EMAIL`                                    | secret / config               | DMCA email 確認、反通知轉寄與私有維運信箱；個資不得寫入公開 inbox，僅 `DMCA_ENABLE` 開啟時需要                                                                                                        |
| `DMCA_DELIVERY_RETRY_BASE_MS` / `DMCA_DELIVERY_RETRY_MAX_MS`       | config / env                  | 寄送重試的正整數下限／上限，預設 60 秒／24 小時；依序採有界退避，max 不得小於 base                                                                                                                   |
| `DMCA_BUSINESS_DAY_HOLIDAYS`                                       | config / env                  | 營運地適用的 `YYYY-MM-DD` 逗號清單；納入反通知工作日計算，空值表示只排除週末                                                                                                                        |
| `METRICS_ENABLE` / `METRICS_HOST` / `METRICS_PORT`                 | config / env                  | Prometheus listener 選配，預設關且綁 `127.0.0.1:9464`；跨容器抓取才改 host 並以網路政策限制來源，port 不得與管理 API 共用                                                                             |

image 一律引用公版 GHCR（public、**免 registry secret、免 imagePullSecrets**）；要用私有 registry（如自架 Harbor）＝ 自行 mirror、非必要。

### 3.3 金鑰／token 產生（runbook）

| 對象                                       | 步驟                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **節點身分**（`BOOTSTRAP_PEER_PRIVKEY`）   | ① `docker run -d --name keygen ipfs/kubo`（啟動即自動 init；**kubo 在此僅為產 key 工具**——key 格式可攜，identity 實際掛 **app 容器**）② `docker exec keygen ipfs id` → 記下 `ID`（節點 PeerId；init 未完會報錯、稍候一兩秒重試）③ `docker exec keygen ipfs config Identity.PrivKey` → 私鑰＝機密（**可預產**：先存密碼管理器、營運者 fork 準備好後再入 GitHub secret）④ `docker rm -f keygen` 銷毀臨時容器 ⑤ 若要公開 bootstrap，將 multiaddr `/dns4/<域名>/tcp/443/wss/p2p/<PeerId>` 提交 community registry 檢核；TLS 由 ingress 終止、轉 app 的 `:4001/ws` |
| `CLUSTER_SECRET`                           | `openssl rand -hex 32` → GitHub secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `DMCA_ADMIN_TOKEN`                         | `openssl rand -base64 32`——純隨機 Bearer 口令、與任何金鑰無關；存部署 secret＋自留一份於密碼管理器。Swagger 只在當次頁面記憶體使用，不寫入瀏覽器持久儲存                                                                                                                                                                                                                                                                                                                                                                                                  |
| **玩家 PeerId**（`AUTHORIZED_SIGNERS` 用） | 助記詞 → key-manager 派生工具（隨主專案實作，如 `pnpm run keytool`）→ **公開 PeerId** 填 config。**助記詞／私鑰永不進 GitHub**（個人身分的根、只在自己保管）；派生路徑由 [key-manager.md](../程式架構/key-manager.md) 定——**勿用泛用工具預產**（會與遊戲內身分對不上）                                                                                                                                                                                                                                                                                    |

### 3.4 Genesis one-shot 與維運腳本環境變數

本節是正常 service `AppConfig` 之外 operator 環境變數的部署權威。Genesis CLI 的同名命令列參數優先於環境變數；`dmca:export` 的輸出路徑則依「位置參數 → `DMCA_EXPORT_OUT` → 時戳檔名」取值。這些變數不得混入正常 service yaml 作為隱藏 toggle。

| 流程        | 變數                     | 必要性      | 契約                                                                                                           |
| ----------- | ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- |
| Genesis     | `GENESIS_DATA_DIR`       | 必填        | 不存在或完全空白的專用持久目錄；不得等於正常 replica 的 `DATA_DIR`。                                           |
| Genesis     | `GENESIS_RECEIPT_PATH`   | 必填        | 必須位於 `GENESIS_DATA_DIR` 外，且執行前不得已存在；成功後以 exclusive atomic publish 寫入。                   |
| Genesis     | `GENESIS_LISTEN`         | 必填        | 至少一個合法 multiaddr；多值以逗號分隔。                                                                       |
| Genesis     | `GENESIS_BOOTSTRAP`      | 選填        | 要撥號的合法 bootstrap multiaddr；多值以逗號分隔，空值表示不預先撥號。                                         |
| Genesis     | `GOVERNANCE_SIGNERS`     | 必填        | 恰為 1 個或至少 3 個 canonical Open4WD PeerId，逗號分隔；空值、重複與非 canonical 值一律拒絕。                 |
| Genesis     | `BOOTSTRAP_PEER_PRIVKEY` | 必填 secret | protobuf 私鑰的 base64，提供可復原的持久 genesis identity；禁止臨時 identity。                                 |
| Genesis     | `GENESIS_RELEASE_COMMIT` | 必填        | 已審核 pinning release 的完整小寫 40 字元 commit SHA，寫入 receipt 供審計。                                    |
| Rebirth     | `GENESIS_INITIAL_CHECKPOINT_BUNDLE_PATH` | rebirth 必填 | 位於 `GENESIS_DATA_DIR` 外的 version-1 self-contained proof bundle；普通 genesis 必須省略。CLI 讀入時先完整離線驗 CID／canonical bytes／來源簽章鏈／ceremony cut point，再把已驗 blocks 預載給新鏈。 |
| 共用路徑    | `DATA_DIR`               | 選填        | 正常 service 資料根；Genesis 設定時用於拒絕與 `GENESIS_DATA_DIR` 共目錄，DMCA export 未設 store 時作為預設根。 |
| DMCA export | `DMCA_EXPORT_PASSPHRASE` | 必填 secret | AES-256-GCM 匯出密碼，只能由環境變數提供，不接受命令列值，避免進入 shell history 或 process list。             |
| DMCA export | `DMCA_PROVIDER_ID`        | 必填        | 此節點固定的 provider PeerId；寫入受驗證的匯出 header，使案卷與出具者身分不可分離。                            |
| DMCA export | `DMCA_NOTICE_STORE`      | 選填        | 要匯出的案卷 store；未設時為 `<DATA_DIR 或 ./data>/dmca-notices`。store 使用獨佔鎖，須停服務或指向副本。       |
| DMCA export | `DMCA_EXPORT_OUT`        | 選填        | 加密輸出路徑；位置參數優先，兩者皆未設時使用 `dmca-export-<timestamp>.bin`。                                   |

Genesis 必須使用專用 identity 與資料目錄完成建立、關閉、以 exact address 重開驗證後才發布 version-1 receipt。Receipt 明示 `genesisMode` 與 ordinary genesis 單次取得的正整數 `genesisTimestamp`；service/replica 的 `GENESIS_TIMESTAMP` 必須逐字對齊 receipt，缺值、0、非安全整數或以本機啟動時間替代都 fail closed。此值初始化 canonical `DerivedState.derivedAt` 與 UTC 月錨。rebirth 另公開 proof commitment、來源 ledger、來源 checkpoint CID／timestamp 與 initial state CID，並延續 checkpoint state。Rebirth 的 `GOVERNANCE_SIGNERS` 必須與 proof `targetGovernanceSigners` 完全一致，新位址不得等於來源位址，ordinary／rebirth 不建相容 fallback。

環境變數依上表準備完成後，ordinary ceremony 直接執行：

```sh
pnpm ledger:genesis
```

建立 rebirth bundle 時，先從封存的來源 proof 與其引用 blocks 產出 self-contained bundle，再做一次獨立驗證；兩步都拒絕覆寫既有輸出：

```sh
pnpm ledger:rebirth-proof -- --proof <proof.json> --blocks-dir <blocks-dir> --output <bundle.json>
pnpm ledger:rebirth-proof -- --verify <bundle.json>
```

驗證成功後設定 `GENESIS_INITIAL_CHECKPOINT_BUNDLE_PATH=<bundle.json>`，再執行 `pnpm ledger:genesis`。ordinary ceremony 必須省略該變數；兩種模式都要保存 public receipt，並以不同 identity、空白 replica 目錄驗證 exact address。

DMCA 案卷匯出須先停服務，或將 `DMCA_NOTICE_STORE` 指向 store 副本以避開 LevelDB 獨佔鎖；密碼只由環境變數提供：

```sh
pnpm dmca:export -- <output-path>
```

輸出路徑已存在時指令會拒絕覆寫。公開確認連結把一次性確認 token 放在 query；反向代理 access log 必須遮蔽 query 或停記完整 URL，避免確認 token 進入 access log。DMCA 與一般 API 的來源桶只採 socket peer，對 `X-Forwarded-For` 不採信；所有請求經同一反向代理連入時會共用代理位址的桶，營運者須在可信邊界另設前置限流，不得改成直接信任可偽造 header。

## 4. CI（公版）與營運者部署

- **公版 repo CI＝test＋ 發佈、永不部署**：push `master` → `pnpm lint` → `pnpm check:types` → `pnpm test`（＋ 整合測試：真 kubo／cluster service containers）→ `pnpm check:vendor -- --local-only`（只驗 MANIFEST 與本機 vendored bytes）→ **只 build `app` image**（kubo / ipfs-cluster 用上游官方 image、manifests 直接引用）→ tag＝ **時間戳 ＋ 短 SHA** → push **GHCR**（public；內建 `GITHUB_TOKEN`）。Main 公開且 provenance 前置成立後，另由 remote provenance gate 比對 immutable 上游 commit 與 npm 帳本套件版本。**actions 一律鎖完整 commit SHA**，禁 tag 或 `@master` 浮動引用。
- 註解語言不屬映像或部署契約，不加入公版 CI、聚合 test、build 或營運者 deploy 前置；英文與繁中皆可，vendored core 保留來源語言。
- **維運者 fork** 設 `DEPLOY_ENABLED=true` 後才啟用 dispatch-only deploy job：
  1. 手動 dispatch → secrets／公開 trust roots 注入（`AUTHORIZED_SIGNERS` / `GOVERNANCE_SIGNERS` / `CLUSTER_SECRET` → checkout 外的 kustomize render）。
  2. 公版 workflow 以 `KUBE_CONFIG` 執行 `kubectl apply`，用 `Recreate` 更新單一 pod（RWO PVC 不允許 surge pod；會有短暫停機）。SSH／compose 是營運者在 fork／clone 外自行維護的替代路徑。
  3. **部署後 strict smoke**：執行 `pnpm exec tsx scripts/smoke.ts --strict https://<pinning-origin>`，要求 `GET /stats` 回 200、`node_id` 非空、`ipfs_cluster_peers ≥ 1` 且 `available_space_bytes > 0`；失敗執行 `kubectl rollout undo` 回到前一 pod template。本機 liveness smoke 不帶 `--strict`，只驗 app 行程，不可替代部署閘。
  4. image 引用公版 GHCR（免 build）；**跟版**＝fork 同步上游的 pinned commit，或在 clone 中更新 upstream remote；只採 image 的營運者則明示更新 image tag。

宿主端執行任何 `pnpm exec tsx scripts/smoke.ts` 前，必須先使用 Node.js 24、pnpm 11 執行
`pnpm install --frozen-lockfile`；Docker image 內的依賴不能取代 host smoke 的 locked install。

## 5. 自架指南

- **所有部署走同一條路**：維護者 fork 後依 §0 手動 dispatch；公版 repo 本身不部署。fork 名稱與使用公版 image 都不代表主專案背書。
- **最低需求**：一台有硬碟的機器（模板理想值 ≥ 100GB；小容量亦可——quota／PVC 依 [§3.2](#32-維運者-fork-與替代自架路徑) 調整；cold partition 隨年線性成長，pinning-service.md [§7](../程式架構/pinning-service.md#7-訂閱帳本檢查點自動-pin)）。k8s 或 docker-compose 二選一。
- **步驟**：fork → 設 §0 secrets／vars（或跳過 Actions 用 compose）→ 手動 workflow dispatch → strict smoke 通過 → 把節點 URL 公告給玩家（設定頁自選節點）。
- **免 CI 路徑**：`git clone` → 填 config → `docker compose up -d`（image 拉公版 GHCR、免認證）。
- **選擇性兼任**：
  - bootstrap 節點：產 libp2p peer key → 公開 multiaddr 可提交 community `bootstrap.json`；玩家仍須明示選取。
  - DMCA API：**注意法遵責任**——啟用者自行處理該 provider 的 notice、counter、14 工作日
    sweep 與人工 hold。確認 notice 會自動 unpin；Kubo 在 blocks 無其他引用時由 repo GC 清除，
    不逐 block 強刪共用 DAG。此能力與 UGC read/write 分離；關閉 DMCA 不關閉 UGC。Admin
    Bearer 必要，Access／Tunnel／Swagger 選配；SMTP 是 email 確認及私有轉寄依賴。
  - 原上傳者通知走 `POST /api/dmca/inbox`：requester 以自己的 PeerId 簽章，provider 以固定
    identity 簽章回應。部署若要讓重啟前後的 inbox 可驗證，必須持久保存
    `BOOTSTRAP_PEER_PRIVKEY`；臨時 identity 只適合開發。
  - Metrics：已有 Prometheus 才啟用；不得直接把 `/metrics` 暴露到公網，至少以內網、loopback、NetworkPolicy 或反向代理 ACL 限制抓取者。

## 6. 維運 Runbook

| 事項     | 作法                                                                                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 升級     | 單節點以 `Recreate` 更新（先停舊 pod 再啟新 pod，接受短暫停機）；失敗回滾 `kubectl rollout undo`                                                                                                                                          |
| 健康檢查 | 拉 `GET /stats`（pinned count / logical size / accepting pins / unique referenced block quota used+limit / Kubo available space / cluster peers / last_sync_timestamp）供 smoke 與低敏感度摘要；它不是 Prometheus metrics                |
| 監控     | 選配 Prometheus 拉獨立 listener 的 `/metrics`；分開 Bitswap／Relay／Gateway／DHT-Gossip／storage／cluster／ledger／API／DMCA sweep，labels 不含 PeerId、IP、CID、RoomId、案件 id 或自由文字；磁碟水位達 `global_max_size_tb` 前告警       |
| 資料保全 | `cluster-pvc`＋`app-pvc` 快照頻率由營運者自訂（後者含帳本 replica 與 dmca-notices）；DMCA 開啟者另有**加密匯出指令**做異地副本（AES-GCM、存放自決、不內建寄信排程）。退場可預告並停止 registry 廣告，但不宣稱能確認全網副本或保證移交成功 |
| 訂閱堵塞 | 檢查點 reconcile 單筆失敗只 log Warn 不中斷（pinning-service.md [§7](../程式架構/pinning-service.md#7-訂閱帳本檢查點自動-pin)）；冷分區 orphan 以 Cluster 現況持久辨識，下一次採納會再次嘗試 unpin；其餘失敗可對最新檢查點重跑 reconcile |
| 域名遷移 | 主站換域**不動本 repo**（端點解耦，部署資訊 [§8.4](../部署資訊.md#84-技術前置檢核維護者)）                                                                                                                                                |

### 6.1 DMCA Admin 部署範本

- 每個營運者使用自己的 provider origin；若採 Cloudflare Tunnel，將該 hostname 導向
  private origin，防火牆不另開可繞過 Tunnel 的管理入口。
- 同一個 Access self-hosted application 覆蓋 `/admin/*` 與 `/api/dmca/admin/*`，policy 只允許
  維運群組並要求 MFA；應用仍驗 `DMCA_ADMIN_TOKEN`。範本不以 IP allowlist 作必要條件。
- 維運者只有在 origin 防火牆已禁止繞過 Tunnel 時，才能設
  `DMCA_TRUST_CLOUDFLARE_ACCESS_IDENTITY=true`、信任 `Cf-Access-Authenticated-User-Email`，
  並以 `access:<email>` 寫入裁決稽核。
- `/admin/docs` 啟用 self-host Swagger，設定 `persistAuthorization: false`、
  `validatorUrl: null`，不預載 token；OpenAPI 與 UI 靜態資產皆符合 self-host CSP。
- Tunnel／Access／Token 的逐步操作與 Swagger、curl、Postman、PowerShell 範例見
  [DMCA 流程 §5.3](../流程/DMCA.md)。

### 6.2 Metrics 部署範本

- private network 內由 Prometheus 抓 raw `/metrics`；不建立 public ingress。
- app 的 pull-time collector 直接提供 Kubo repo／StorageMax 與 global quota used／limit 四個無
  labels gauge；Kubo 不可讀時 scrape 回 503，不保留舊容量值。公版 alerts 內建 Kubo 與 quota
  兩條持續 80% 告警（10 分鐘至少三次樣本，且持續 10 分鐘）；filesystem 仍須接 node exporter。
- Grafana 僅可經營運者自選的私有入口（例如 `<operator-grafana-host>` 搭配 Access／MFA）存取，
  並與 DMCA Admin 使用不同 application／群組，避免觀測權限自動取得法務裁決權限。
- Alertmanager 通知通道由各營運者自選；公版不預設私人通道、Email 或外部 uptime 供應商。
  告警規則同時要求持續時間與最低樣本數，避免初期低流量單點雜訊。

## 7. 耦合點

| 對象                 | 耦合                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 主專案 client        | [interfaces.md §7](../程式架構/interfaces.md) `PinningProvider`（nodeUrl / source / descriptor）；只有玩家明示選取的節點，無專案預設清單                                              |
| community registries | pinning 與 bootstrap 分別登錄、分別檢核；同一部署可同時出現，但任一 listing 不會自動授予另一能力或 relay 權限                                                                         |
| ledger               | app＝帳本 OrbitDB peer（vendored 棧同步事件鏈）；檢查點採納→自動 pin（[程式架構/ledger.md](../程式架構/ledger.md)・[程式架構/pinning-service.md §7](../程式架構/pinning-service.md)） |
| DMCA / moderation    | Provider-scoped DMCA unpin、仲裁黑名單拒 pin、Repeat Infringer 拒服務（[程式架構/pinning-service.md §9](../程式架構/pinning-service.md)）                                           |
| 資安                 | 安全 header / Ed25519 授權（[資安規範.md §7](../資安規範.md)）                                                                                                                        |
