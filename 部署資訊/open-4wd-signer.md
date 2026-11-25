---
type: deploy
domain: ["治理營運", "版本部署"]
summary: 治理簽署工具部署 repo 規格（映像引用、k8s／systemd、部署 workflow 與營運程序）
authority: null
slug: null
---

# open-4wd-signer 部署規格

> **本檔角色**：`open-4wd-signer` 的 **repo 層規格**——映像來源與引用、目錄結構、部署變數、k8s 與 systemd 範本、
> 版本識別與營運程序。工具本身的行為（CLI、退出碼、主迴圈、halt、健康端點）以
> [程式架構/governance-signer.md](../程式架構/governance-signer.md) 為權威。
> 本 repo **只放部署設定**：不含程式、不建置映像、不含任何金鑰；映像由主 repo 建置並以 digest 引用。
> 與 pinning、signaling、TURN 三個公版 Template repo 不同，治理簽署工具只由治理簽署者部署，不是玩家選用的 provider
> （[部署資訊.md §1.2](../部署資訊.md)）。

## 1. 映像

| 項目       | 值                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| 建置來源   | 主 repo `tools/governance-signer/Dockerfile`，建置內容為 `pnpm build:signer` 的 `dist/governance-signer/` |
| 建置流程   | 主 repo `.github/workflows/signer-image.yml`                                                             |
| 名稱       | `ghcr.io/<owner 小寫>/open-4wd-governance-signer`                                                        |
| 推送標籤   | `sha-<commit>`；不打 latest                                                                              |
| 引用方式   | 一律 digest：`ghcr.io/<owner>/open-4wd-governance-signer@sha256:<64 hex>`                                |
| 基底       | `node:24-alpine`，與 pinning 釘同一 digest                                                               |
| 執行身分   | uid／gid 10001；程式檔歸 root                                                                            |
| 內容       | `/app/main.mjs`、`/app/node_modules/`（classic-level 閉包）、`/app/build-info.json` 與授權檔；不含套件管理器或建置工具鏈 |
| 預設環境   | `SIGNER_DATA_DIR=/data`、`SIGNER_HEALTH_HOST=127.0.0.1`、`SIGNER_HEALTH_PORT=9475`；不帶金鑰或預設 profile |
| 進入點     | `node /app/main.mjs`，預設 `run`                                                                         |

`signer-image.yml` 只有 `workflow_dispatch`，且 repository 變數 `SIGNER_IMAGE_ENABLED` 為 `true`、在預設分支時才執行。
同一次 dispatch 依序：完整 `test:signer`（N=4 整合測試必須存在且通過）與打包測試 → 以 commit 時間為 `SOURCE_DATE_EPOCH`
打包 → 確認 musl prebuild 存在 → 建置映像 → 唯讀根檔案系統、無網路、`/data` 與 `/tmp` 掛 tmpfs 的煙霧測試（以公開開發金鑰驗 `peer-id`、
`check --storage-self-test` 載入 LevelDB、`--version`）→ 推送 GHCR → 以 job output 與 step summary 輸出 digest。
外部 actions 鎖完整 commit SHA，唯一 secret 為 `GITHUB_TOKEN`。

### 1.1 版本識別

`build-info.json` 的 `version` 取主 repo `package.json`；工具以 commit 與映像 digest 識別，不另設獨立版本號。部署前以映像內
`/app/build-info.json` 核對 `commit`、`mainSha256`、`ruleEpochs` 與 `deploymentValuesSha256`；部署後 `/status` 的
`deploymentValuesSha256` 必須等於 build-info 中同一 profile 的值。工具的規則版本必須與 client 同一切點升級
（[流程/升版.md](../流程/升版.md) 第 8 節）。

## 2. Repo 目錄結構

```text
open-4wd-signer/
├── deploy/
│   ├── k8s/
│   │   ├── namespace.yaml        # open4wd-signer；Pod Security 只以 restricted warn／audit
│   │   ├── pvc.yaml              # open4wd-signer-data，ReadWriteOnce
│   │   ├── deployment.yaml       # open4wd-governance-signer
│   │   ├── networkpolicy.yaml    # open4wd-signer-egress-only：拒絕全部入站
│   │   ├── admin-job.yaml        # 管理指令 Job 範本 open4wd-signer-admin（不在 kustomization 內）
│   │   └── kustomization.yaml    # namespace、pvc、deployment、networkpolicy
│   └── systemd/
│       ├── open4wd-governance-signer.service
│       ├── signer.env.example
│       └── README.md
├── scripts/
│   ├── render.mjs                # 驗證並渲染 REPLACE_* 佔位
│   └── render.test.mjs           # manifest 與 workflow 不變式（只用 node 內建）
├── .github/workflows/deploy.yml  # dispatch-only＋變數閘
├── package.json                  # 無依賴；test、render
├── LICENSE                       # MIT
└── README.md                     # 營運者指南
```

公開 repo 只含佔位值；節點名稱、bootstrap 位址與映像 digest 由營運者的 repository 變數提供，在 checkout 外渲染。
`render.test.mjs` 同時掃描 repo 內不得出現 IP、email 與本機路徑。

## 3. 部署 workflow 與變數

`.github/workflows/deploy.yml` 只有 `workflow_dispatch`，job 以 `vars.SIGNER_DEPLOY_ENABLED == 'true'` 為閘並只接受預設分支；
`permissions: contents: read`，environment 為 `production`，`concurrency` 不取消進行中的部署。流程：manifest 不變式測試 →
`render.mjs` 渲染到 `$RUNNER_TEMP` → `kubectl apply -k` → 等 rollout → 顯示 `status`（只顯示、不作為成敗依據）。
workflow 永不接觸治理金鑰。

| 名稱                    | 種類        | 說明                                                       |
| ----------------------- | ----------- | ---------------------------------------------------------- |
| `SIGNER_DEPLOY_ENABLED` | variable    | `true` 才執行                                              |
| `SIGNER_IMAGE`          | variable    | 映像 digest 參照；`render.mjs` 拒絕標籤形式                |
| `SIGNER_NODE_NAME`      | variable    | 放金鑰檔的節點（`kubernetes.io/hostname`）                 |
| `SIGNER_PROFILE`        | variable    | 只接受 `private-playtest` 或 `public`                       |
| `SIGNER_BOOTSTRAP`      | variable    | 逗號分隔的 bootstrap multiaddr，每個都含 `/p2p/<PeerId>`    |
| `KUBE_CONFIG`           | secret      | 叢集連線設定；唯一的 secret                                |
| `production`            | environment | 可設定審核者                                               |

## 4. Kubernetes

- `replicas: 1`、`strategy: Recreate`、ReadWriteOnce 資料卷、`nodeSelector` 指定金鑰節點。
- 金鑰以節點專屬 hostPath 唯讀掛入：節點上 `/etc/open4wd-signer/governance.key`（擁有者 10001、權限 0400），容器內
  `/key/governance.key`；資料目錄為 `/data`。
- 安全設定：`runAsNonRoot`、uid／gid 10001、`allowPrivilegeEscalation: false`、`readOnlyRootFilesystem`、丟棄全部能力、
  `RuntimeDefault` seccomp、不掛 service account token；`/tmp` 為 emptyDir。
- 工具預設只外連、不監聽，因此沒有 containerPort 與 Service；NetworkPolicy 拒絕全部入站、出站不限，涵蓋常駐 pod 與管理 Job
  的 pod（以兩者共有的 `app.kubernetes.io/part-of: open4wd-governance-signer` 標籤選取）。
- 只設 liveness：容器內以 exec 存取 `/healthz`。不設 readiness，因為沒有 Service 依賴就緒狀態，而 `/readyz` 在同步閘未過、
  非簽署者或 halted 時回 503，會讓 rollout 誤判失敗。
- halted 時行程不退出、`/healthz` 仍回 200，k8s 看不到 halt。營運者必須另外監看 `/status` 的 `phase`／`haltReason`，或收集
  JSON lines 記錄並對 `level: error` 告警。

### 4.1 Pod Security 例外

Pod Security 的 baseline 與 restricted 都禁止 hostPath；叢集或此 namespace enforce 這兩級時 pod 會被拒。namespace 因此不設
`enforce`，只以 restricted 發出 `warn` 與 `audit`。理由：金鑰只存在單一節點、不進任何 Kubernetes 物件或 etcd，配合單一副本、
`Recreate`、ReadWriteOnce 與 nodeSelector 構成「同一把金鑰只在一處執行」的防線。叢集預設 enforce 時，由叢集管理者對此 namespace
明確放寬，並以准入政策或稽核限制此 namespace 只有這一個工作負載。這是[資安規範.md §8](../資安規範.md) 的明列例外。

### 4.2 管理指令

`clear-halt`、`release-lock`、`config-export`、`config-update` 與常駐的 `run` 共用資料目錄與實例鎖，執行前必須先停
常駐實例（`kubectl scale … --replicas=0` 並等 pod 結束），否則退出碼 5。`check` 不取實例鎖、不修改資料目錄，常駐實例運作中
也可以執行。k8s 以 `admin-job.yaml` 範本在同一節點與資料卷執行（`backoffLimit: 0`、健康端點停用，與常駐 pod 同受拒絕入站的
NetworkPolicy 涵蓋）；Job 不是 TTY，需要確認字串的指令先以 `--dry-run` 取得確認字串，再以
`--confirm '<確認字串>'` 重跑。`release-lock` 與 `config-update` 完成後必須把常駐實例啟動回來，寫入的票或設定更新靠
`run` 連線時的 heads 交換傳出。

## 5. systemd

不使用 Kubernetes 時，從映像以 digest 取出 `/app` 安裝到 `/opt/open4wd-signer`，以非 root 服務帳號 `open4wd-signer` 執行
`/usr/bin/node /opt/open4wd-signer/main.mjs run`：

- 設定檔 `/etc/open4wd-signer/signer.env`（範本不含金鑰與 `SIGNER_LISTEN`）；資料目錄 `/var/lib/open4wd-signer`
  （`StateDirectory`，0700）；金鑰檔權限 0400、擁有者為服務帳號。
- `RestartPreventExitStatus=2 3 5`：用法、設定與前置條件錯誤不自動重啟；`ProtectSystem=strict` 等加固；不設監聽 socket。
- 先 `check` 再啟動；需要實例鎖的管理指令（`clear-halt`、`release-lock`、`config-export`、`config-update`）須先 `systemctl stop`。

## 6. 營運程序

### 6.1 正式部署前置

- pinning 節點 vendored 的帳本必須接受檢查點控制事件（issue 001488）；完成前只做本機與開發驗證，不部署到
  private-playtest 或 public。
- 部署值的 `governanceSigners` 必須是正式治理金鑰的 PeerId；公開開發金鑰在非 development 一律被拒
  （[程式架構/governance-signer.md](../程式架構/governance-signer.md) 〔GSIGN-R-008〕）。

### 6.2 金鑰

正式金鑰在未連網的機器以 `keygen --out` 產生並離線備份（紙本等）；只放在一個節點。同一把金鑰絕不同時在兩處執行。
上線前確認部署用 kubeconfig 只限此 namespace，且此 namespace 以外禁止任意 hostPath。

### 6.3 遷移與接手

- 嚴禁新舊實例同時運作：先停舊實例、確認已停，再起新實例。資料可不搬：鎖定可由帳本推出，本機鎖定紀錄能一併帶過去更好。
- 工具的實例鎖跨主機接手依賴兩台主機的時鐘；搬移資料卷前先確認舊實例已停、兩台主機都已校時。
- 實例鎖格式含心跳欄位；缺心跳欄位的鎖檔會被拒絕，確認沒有實例在跑之後人工刪除資料目錄內的 `instance.lock`。
- 容器在同一 Pod 內重啟（新行程拿到與舊行程相同的 pid）時，工具把舊鎖視為過期鎖接手並記錄 `instance-lock-taken-over`，
  不需人工處理。接手途中行程被強制終止會留下 `instance.lock.takeover-*` 權杖檔，之後對同一份舊鎖的接手都拒絕（`run` 啟動失敗、
  管理指令回退出碼 5）；確認沒有實例在跑之後人工刪除該權杖檔。
- 同主機的鎖判斷（pid 存活檢查與 pid 重用接手）假設主機名稱相同即共用同一 PID 命名空間。共用同一資料卷的實例不得設定
  相同主機名稱（不使用 `hostNetwork`、不共用宿主機 UTS 命名空間、不手動指定相同 hostname）；k8s 的 Pod 名稱各不相同，本 repo 的範本也不使用這些設定。

### 6.4 halt

halt 不會自行解除。依 `/status` 的 `haltReason` 或記錄排除原因，停掉常駐實例後以 `clear-halt` 逐字確認解除：

| `haltReason`             | 意義與處置                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `self-equivocation`      | 同一金鑰對同一錨投了兩個本體：金鑰可能在別處運作或外洩；確認只剩一個實例，必要時換金鑰           |
| `foreign-instance`       | 帳本出現不是本實例寫入的本金鑰投票：停掉其他實例並確認金鑰沒有外洩                             |
| `conflict`               | 帳本出現檢查點衝突並已隔離：人工調查後才可解除                                                 |
| `lock-store-unavailable` | 投票鎖定紀錄不可用：先修復資料目錄的 `checkpoint-control` 儲存                                  |
| `rule-epoch-unknown`     | 帳本的規則版本不在本版工具的 rulebook：升級工具                                                |
| `instance-lock-lost`     | 實例鎖被別的實例接手或刪除：確認只剩一個實例在運作                                             |
| `halt-record-corrupt`    | `halt.json` 無法解析，原本的原因已無從得知：從記錄的 `halted` 事件查出原因並處理後，以 `clear-halt corrupt` 解除 |
| `halt-record-unreadable` | `halt.json` 存在但無法讀取（權限不足、不是一般檔案）：修正檔案權限或型別後再執行 `clear-halt`；此時 `clear-halt` 不刪除該檔，回退出碼 4 |

### 6.5 卡死時的人工釋放

`release-lock` 只在卡死滿 24 小時等前置成立時可用，前置與殘餘風險確認見
[程式架構/governance-signer.md](../程式架構/governance-signer.md) 第 11 節。執行前必須逐一聯絡其他簽署者完成確認；
完成後重新啟動 `run`。

### 6.6 擴編（N=1 → N≥3）

1. 新成員各自產生治理金鑰並離線備份，交付 PeerId。
2. 現任簽署者停掉常駐實例，以 `config-export` 取得下一代範本，修改 `governanceSigners`（以及要一併調整的欄位）。
3. `config-update --file … --rationale … --dry-run` 核對差異與確認字串，再以 `--confirm` 寫入。
4. 重新啟動現任簽署者的 `run`；新成員各自部署工具並啟動。名單變更自下一個檢查點才取得檢查點 authority。
5. 部署值的 `governanceSigners` 是 genesis 信任根，不修改。

擴編到多位之後，任何治理設定調整都需要多人收簽，在 issue 001539 落地前無法進行；擴編前先確認這個限制可接受。

## 7. 耦合點

| 對象                          | 耦合                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------- |
| 主 repo `open-4wd`            | 程式、打包、映像建置與內嵌部署值；映像以 digest 引用                                     |
| `open-4wd-pinning`            | bootstrap 對象之一；vendored 帳本須接受檢查點控制事件（issue 001488）                    |
| 部署值                        | `governanceSigners` 填正式治理金鑰 PeerId（[部署實際值與初始拓撲](部署實際值與初始拓撲.md)） |
| 資安                          | [資安規範.md §8](../資安規範.md) 容器基線；hostPath 金鑰為明列例外（§4.1）               |
