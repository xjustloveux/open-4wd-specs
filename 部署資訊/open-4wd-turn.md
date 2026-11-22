---
type: deploy
domain: ["版本部署"]
summary: TURN 公版模板 repo 規格（coturn、社群營運者自行部署）
authority: null
slug: null
---

# open-4wd-turn 部署規格

> **本檔角色**：`open-4wd-turn` 的 **repo 層規格** —— coturn 設定重點、目錄結構、部署變數 / secrets、CI/CD、k8s 注意事項、社群自架指南。
> 本 repo **無自寫程式碼**——coturn 為第三方開源軟體（BSD 授權），repo 內容 = 設定模板 ＋ 部署 manifests＋CI；ICE 選擇政策見 [部署資訊.md §4.3](../部署資訊.md)。
> 共通部署模型只由 [部署資訊.md §1.1](../部署資訊.md) 定義。本 repo 的差異是只含 coturn
> 設定模板、manifests 與驗證 CI；它與 signaling 分 repo，僅在營運者明示配對時共享 secret
> 與 TURN URL。

> TURN 可與 pinning 共用一台主機，但公版 repo、process/container、port／防火牆與 secret 生命週期仍分開。

## 0. Fork 後手動一鍵部署（GKE）

公版隨附 `.github/workflows/deploy.yml`，只有 `workflow_dispatch` 且 deploy job 受
`DEPLOY_ENABLED == true` 閘保護；公版不設定任何營運值，所以不會部署。

| GitHub 項目                            | 類型           | 取得／填法                                                               |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| `KUBE_CONFIG`                          | secret         | `gcloud container clusters get-credentials` 後取得的完整 kubeconfig 文字 |
| `TURN_SHARED_SECRET`                   | secret         | `openssl rand -hex 32`；與配對 signaling 完全同值                        |
| `DEPLOY_ENABLED`                       | variable       | 固定 `true`                                                              |
| `REALM`                                | variable       | 可解析的 TURN DNS 名，例如 `turn.example.org`                            |
| `EXTERNAL_IP`                          | variable       | 綁定 coturn 落點節點的靜態公網 IPv4                                      |
| `TURN_URLS`                            | variable       | 對外 `turn:`／`turns:` URL，與 signaling 完全同值                        |
| `MIN_PORT`／`MAX_PORT`                 | variable，選配 | 預設 49152–65535；GCP VPC firewall 必須放行同一 UDP 範圍                 |
| `USER_QUOTA`／`TOTAL_QUOTA`／`MAX_BPS` | variable，選配 | 未設使用模板安全預設                                                     |

先在 GKE 建叢集、固定節點外部 IP，並放行 3478 UDP＋TCP、選配 5349 TCP、relay UDP 埠段；
再 fork → 啟用 Actions → 設上表 → Actions 的 **Deploy operator fork** 按 **Run workflow**。
流程會渲染 conf、以 Secret 承載整份 conf 並 apply workload、rollout restart，最後做真 STUN binding 與
HMAC 短期憑證 TURN allocate smoke。

## 1. 定位與職責

coturn 同一 daemon 同時提供兩種協議（[部署資訊.md §4.3](../部署資訊.md)）：

- **STUN**（無認證、無狀態、每連線幾個封包即退場）：公網地址鏡子。client 只使用玩家手動設定、所選 signaling provider 配對值或 session invite 明示的 ICE。
- **TURN**（token 認證、中繼整場流量、頻寬計費）：NAT 打洞失敗（symmetric NAT / CGNAT）時的保底路徑。token 由 signaling `/turn-token` 端點發放（TTL 300s；[程式架構/signaling-service.md §6.1](../程式架構/signaling-service.md)）、coturn 以 shared secret 驗證。

本 repo 零自建映像（只引用上游 coturn），[資安規範.md §8](../資安規範.md) 容器安全基線中僅 k8s manifest 一面適用；relay 埠段需 `hostNetwork` 屬基線明列的例外，理由記於本檔[§6](#6-k8s-注意事項)。

## 2. Repo 目錄結構

```text
open-4wd-turn/
├── config/
│   └── turnserver.conf.tmpl      # coturn 設定模板（§3；部署端／CI 以 envsubst 渲染）
├── deploy/
│   ├── README.md                 # repo 就地部署、TLS／網路與同步 runbook
│   ├── docker-compose.yml        # 單機自架路徑
│   ├── .env.example              # 變數樣本（樣本值、無真實 secret）
│   ├── coturn-image.txt          # CI／compose／k8s 共用的上游 image pin
│   ├── k8s/                      # deployment（hostNetwork）+ secret（TLS 鍵名形狀樣板）+ service（UDP）
│   ├── test_security_policy.py   # manifest／coturn 安全政策契約
│   └── test_workflow_contract.py # CI／deploy workflow 契約
├── scripts/                      # comment quality／hook 的本機維護工具
├── .github/workflows/ci.yml      # 公版驗證（§5）
├── .github/workflows/deploy.yml  # dispatch-only＋DEPLOY_ENABLED opt-in
├── LICENSE                       # 本 repo 模板 license＝MIT（coturn 本體 = BSD、上游 image 引用）
└── README.md                     # 自架 quickstart（= 本檔 §7 摘要）
```

## 3. coturn 設定重點（`turnserver.conf.tmpl`）

| 設定                                      | 值 / 說明                                                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `listening-port`                          | 3478（UDP＋TCP）；可選 `tls-listening-port 5349`（`turns:`，需 TLS 憑證）                                                                                                      |
| `use-auth-secret` ＋ `static-auth-secret` | `${TURN_SHARED_SECRET}`——REST API auth：signaling 以同一 secret 簽發短期 username/credential（TTL = `TURN_TOKEN_TTL_SEC: 300`）、coturn 本地驗證、**兩 repo 部署變數須同值**   |
| `realm`                                   | `turn.<域名>`（端點域名與主站 origin 解耦，[部署資訊.md §8.4](../部署資訊.md)）                                                                                                |
| `external-ip`                             | 公網 IP（hostNetwork 下必填）                                                                                                                                                  |
| `min-port` / `max-port`                   | relay port range（預設 49152–65535、可收窄）                                                                                                                                   |
| **安全必開**                              | `no-multicast-peers`；`denied-peer-ip` = RFC1918 三段／loopback／link-local／CGNAT（100.64.0.0/10）／0.0.0.0/8 與對應 IPv6 段全段（**防止被當跳板中繼打內網**）；`fingerprint` |
| 資源帽                                    | `user-quota` / `total-quota` / `max-bps`（TURN 流量計費的自我保護）                                                                                                            |
| STUN                                      | 零額外設定即服務（binding 無認證；回應大小 ≈ 請求、無放大攻擊價值）                                                                                                            |

## 4. 部署變數與 Secrets

公版 repo＝ **零 secrets**（CI 純驗證，[§5](#5-ci公版-repo與營運者-fork-部署)）；下表全屬營運者環境：

| 變數                                     | 位置                  | 說明                                                                                                                                                                                                                                                         | fork 自架            |
| ---------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| 部署憑證                                 | GitHub secret         | 正式 workflow 主線為 `KUBE_CONFIG`（k8s API 可遠端連）；SSH 節點端與 compose 是營運者自行維護的替代路徑                                                                                                                                                      | **必改**             |
| `TURN_SHARED_SECRET`                     | GitHub secret         | **與 `open-4wd-signaling` 同值**（跨 repo 耦合；輪換兩邊同步）；隨渲染後 conf（`static-auth-secret`）整份以 Secret `open4wd-turn-conf` 承載、掛成 `/etc/coturn/turnserver.conf`，**不走 ConfigMap**；repo 內 `secret.yaml`＝TLS 鍵名形狀樣板、**不被 apply** | 必改                 |
| `REALM`                                  | GitHub vars           | turn 域名——渲染入 conf Secret；慣例＝可解析 DNS 名（兼部署後 smoke 連線主機）                                                                                                                                                                                | 必改                 |
| `EXTERNAL_IP`                            | GitHub vars           | 節點公網 IP——渲染入 conf Secret；hostNetwork 下與落點節點綁定（多節點叢集自行加 nodeSelector）                                                                                                                                                               | 必改                 |
| `TURN_URLS`                              | GitHub vars           | 配對 signaling 原樣下發給 client 的 `turn:`／`turns:` URL 清單；coturn conf 不讀此欄，但兩端部署值必須一致                                                                                                                                                   | 必改（提供 TURN 時） |
| `MIN_PORT` / `MAX_PORT`                  | GitHub vars（有預設） | relay 埠段（預設 49152–65535）                                                                                                                                                                                                                               | 可調                 |
| `USER_QUOTA` / `TOTAL_QUOTA` / `MAX_BPS` | GitHub vars（有預設） | 配額 / 頻寬帽                                                                                                                                                                                                                                                | 可調                 |
| `tls.crt` / `tls.key`                    | 叢集內 Secret（可選） | `turns:` 支援——營運者**手動**建立／維護叢集內 `open4wd-turn-secret`（workflow 不建立也不 apply 此 Secret）；掛載路徑 `/etc/coturn-tls`（[§6](#6-k8s-注意事項)）                                                                                              | 選擇性               |

必填四鍵（`TURN_SHARED_SECRET`／`REALM`／`EXTERNAL_IP`／`TURN_URLS`）任一缺值 ＝workflow 渲染步驟**直接紅燈**，且 URL 只接受 `turn:`／`turns:`（envsubst 對未設變數靜默代入空字串，故前置 `:?` 硬檢）。

## 5. CI（公版 repo）與營運者 fork 部署

- **公版 repo CI＝ 純驗證、永不部署**（`.github/workflows/ci.yml`；零 secrets）：① 樣本值渲染與鍵集合比對 ② compose／k8s／deploy workflow YAML 驗證 ③ 真 coturn STUN＋TURN 冒煙（smoke 容器以 CLI `--allowed-peer-ip` 為 runner 自身位址開洞，讓 `uclient -y` 的 client-to-client peer 通過正式 conf 的 `denied-peer-ip`；模板與渲染檔不變）。公版 CI 的 `-W` 只傳公開樣本 secret，正式部署不可照抄；外部 actions 一律鎖完整 commit SHA。
- 註解語言不屬設定或部署契約，不加入公版 CI、YAML／coturn 驗證或營運者 deploy 前置；自然語言說明可用英文或繁中，固定設定語法保持原文。
- **營運者 fork** 設 `DEPLOY_ENABLED=true` 後才會啟用 dispatch-only deploy job：
  1. 手動 dispatch → 必填值硬檢（[§4](#4-部署變數與-secrets)）→ `envsubst` 渲染 `turnserver.conf` → 渲染檔整份以 Secret `open4wd-turn-conf` 生成（conf 含 shared secret，不走 ConfigMap）→ apply workload → 顯式 rollout restart（會中斷進行中的中繼會話）。
  2. **coturn 用上游官方 image、不自 build**（本 repo 無程式碼可編譯）。
  3. `concurrency` 序列化：同時只跑一份部署、後到排隊不取消（半套 apply 比等待更糟）。
  4. **部署後 smoke**：對 `REALM`（可解析 DNS 名）發 STUN binding request → 收到 `XOR-MAPPED-ADDRESS` 即通過；TURN 依 REST auth 形狀令 `TURN_USER = <now+300>:smoke`，以 `base64(HMAC-SHA1(TURN_SHARED_SECRET, TURN_USER))` 算出 `TURN_CRED`，再執行 `turnutils_uclient -u "$TURN_USER" -w "$TURN_CRED" -y -c "$REALM"` 完成一次 allocate。長期 shared secret 不進命令列。

## 6. k8s 注意事項

- **`hostNetwork: true`**（或 NodePort UDP range）——TURN relay 需要一段 UDP port，一般 Service 模型不友善；**單 node 單 replica**（port 衝突；deployment＝`Recreate`）。
- LoadBalancer 對 UDP 的支援視雲商而定；裸機 / VM 直接 hostNetwork 最單純。
- TLS（`turns:`）憑證掛載路徑 ＝**`/etc/coturn-tls`**——獨立 volume、**不巢於 conf Secret 唯讀掛載 `/etc/coturn` 內**（巢狀掛載點在唯讀父層可能建不出來）。
- 公版 deploy workflow **不簽發也不續期** `turns:` 憑證；營運者須自行維護簽發、續期、Secret 更新與到期監控。coturn 不保證對掛載檔案無中斷熱載，更新後的 reloader／rollout restart 可能中斷進行中的 relay；應排在低流量窗並由 client 重連驗證。
- 可與 pinning 節點同機（同 cluster 不同 workload），STUN/TURN 對磁碟零需求。

### 6.1 容器執行身分例外

公版 manifest 釘定 `coturn/coturn:4.14.0`，並套用 `allowPrivilegeEscalation: false`、移除全部 Linux capabilities 與 `RuntimeDefault` seccomp。由於本模板沒有上游映像在所有目標平台上的權威數字 UID 證據，基底不猜測 `runAsUser`，也不直接開啟 Kubernetes 無法對名稱型 image user 證明的 `runAsNonRoot`。

這是[資安規範.md §8](../資安規範.md) 的明列例外，不代表完全符合 non-root 基線。正式部署必須對同一釘版映像執行 `docker image inspect coturn/coturn:4.14.0 --format '{{json .Config.User}}'`，取得並驗證數字 UID/GID，以該身分完成 STUN 與 TURN allocate 冒煙，再由營運者 overlay 加上數字 `runAsUser`、`runAsGroup` 與 `runAsNonRoot: true`；無法驗證時應阻擋正式上線。此例外與 §6 的 `hostNetwork` 拓撲例外分開裁決。

## 7. 社群自架指南

- **k8s 路徑**：依 §0 fork → 設 `KUBE_CONFIG`／`TURN_SHARED_SECRET` 與 vars → 手動 dispatch。repo 名稱、可見性與同步策略由營運者自決。
- **單機路徑**：`git clone` → 填 env → 渲染 conf → `docker compose up -d`（envsubst 只讀行程環境變數、渲染前須先 `set -a; . ./.env; set +a` 匯入；conf 為 bind-mount、變更後重渲染 ＋`docker compose restart coturn`）；或直接用 `open-4wd-signaling` repo 的 all-in-one compose（`deploy/docker/docker-compose.all-in-one.yml`＝**signaling＋coturn** 一台全包；signaling 為 in-memory 單行程、無外部儲存）。
- **純 STUN 自架** ＝`TURN_SHARED_SECRET` **仍填高熵隨機值**、不提供給任何 signaling 部署——無人能簽發 token＝TURN 面實質停用、STUN 照常服務；要**徹底關閉 TURN 面** ＝ 渲染後 conf 加 `stun-only`。**嚴禁留空或沿用樣本值**：空值 ／ 週知值 ＝ 任何人可自算 HMAC 憑證 ＝ 把節點當開放中繼用。**自架 TURN** 必須同步 shared secret 到自己的 signaling（token 才驗得過）。
- 玩家端使用：設定頁 TURN 欄位（URL＋credentials）本就存在；STUN 自填同家族欄位。

## 8. 耦合點

| 對象                 | 耦合                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open-4wd-signaling` | `TURN_SHARED_SECRET` 同值（token 發放 ↔ 驗證）；其 all-in-one compose 與本 repo 同值釘版 coturn image（coturn 組態走 CLI 旗標、與本 repo conf 模板同義）                                                     |
| 主專案 client        | ICE 只來自玩家手動設定、所選 signaling provider 的配對 `/turn-token` 或 session invite；不內建固定 endpoint、不自動改連未選 provider（[程式架構/signaling-service.md §6](../程式架構/signaling-service.md)） |
| 程式參數              | `TURN_TOKEN_TTL_SEC: 300`                                                                                                                                                                                    |
| 資安                 | STUN/TURN server 只見 IP＋port＋時間 metadata（P2P IP 可見性立場見 [資安規範.md §15](../資安規範.md)）；`denied-peer-ip` 防內網中繼（[§3](#3-coturn-設定重點turnserverconftmpl)）                            |
