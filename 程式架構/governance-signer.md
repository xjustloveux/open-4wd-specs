---
type: impl
domain: ["共識帳本", "治理營運"]
summary: 常駐治理簽署工具：信任根、金鑰、單一實例、同步閘、主迴圈、halt、人工釋放、config-update 與打包
authority: null
slug: null
---

# governance-signer（常駐治理簽署工具）

> **本檔角色**：主 repo `tools/governance-signer/` 的實作規格與 GSIGN 規則主錨。工具是治理者的操作工具，
> 依帳本規則對檢查點提案、投票與定稿，並提供 N=1 的治理設定更新指令；它不是提供給玩家的 provider。
> 檢查點協定本身以 [ledger-checkpoint.md](ledger-checkpoint.md) 第 3 節為權威，本檔只寫工具如何執行它。
> 部署設定見 [部署資訊/open-4wd-signer.md](../部署資訊/open-4wd-signer.md)；選擇此架構的理由見
> [D-20261124-03](../decisions/D-20261124-03-常駐治理簽署工具.md)。

## 1. 定位

- 每位治理簽署者各自執行一個實例，持有一把專用治理金鑰；金鑰與玩家身分、pinning 的節點身分都分開。
- 工具在 node 執行，直接使用主 repo 的 `src/ledger` 與完整規則組裝（`assembleLedger`，full-refold），不 vendor
  任何程式；瀏覽器端與工具共用 `src/bootstrap/ledger-stack.ts` 的 `createLedgerStack` 連線流程。
- 工具只外連：預設不監聽任何 libp2p 位址、不當中繼；唯一的監聽面是只綁本機的唯讀健康端點。
- 定稿（`finalizeCheckpoint`）不需要治理金鑰，任何節點都可以做；工具也會定稿已達 quorum 的候選本體。

## 2. 目錄與元件

```text
tools/governance-signer/
├── build.mjs              # esbuild 打包（pnpm build:signer）
├── Dockerfile             # 單階段 runtime 映像
├── tsconfig.json          # 延伸根設定 paths；check:types 串接
├── dev/                   # 公開開發金鑰與說明（第 13 節）
└── src/
    ├── main.ts            # CLI 進入點與子命令分派
    ├── config.ts          # 環境變數／旗標解析
    ├── deployment.ts      # 內嵌部署值（信任根）載入與驗證
    ├── build-info.ts      # 打包時內嵌的建置資訊
    ├── log.ts             # JSON lines 記錄
    ├── health-server.ts   # /healthz、/readyz、/status
    ├── key/               # 治理金鑰來源與簽署面
    ├── node/              # node 版埠：Level 儲存、blockstore、outbox、准入計算、libp2p、資料目錄
    ├── runtime/           # 執行期組裝、主迴圈、同步閘、halt 紀錄
    └── commands/          # 各子命令
```

| 埠                         | node 版實作                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `LedgerIpfs`               | Level blockstore 兩個（內容、條目）加 `@helia/bitswap` 宿主；pins 以記憶體記帳、不跑 GC            |
| `CheckpointControlStorage` | `classic-level` 加序列佇列內的 compare-and-swap；`get` 只把 NOT_FOUND 視為缺值，其他錯誤照拋       |
| 投票鎖定紀錄               | 重用 `createCheckpointVoteLockStore`，底層為上列 control storage                                   |
| 准入 outbox                | 持久 Level 版，語意與瀏覽器 IndexedDB 版相同                                                       |
| 准入計算器                 | 行程內計算，重用 `searchAdmissionNonceBatch`，以 `setImmediate` 分段讓出                            |
| Orbit                      | 明確 `directory: <資料目錄>/orbitdb`；固定 `orbitId` 由 `createLedgerStack` 取得，node 埠只轉交（第 6 節） |
| libp2p                     | 重用 `buildNodeOptions`；transports 為 WebSockets 與 circuit relay 撥出，listen 由設定決定（預設空） |
| libp2p 身分                | 資料目錄內持久化的隨機 Ed25519，與治理金鑰分開                                                     |
| `LedgerSigner`             | 治理金鑰；推導全部重用 `src/key-manager`                                                           |

## 3. 信任根與部署值

信任根（帳本位址、genesis 時戳、`governanceSigners`，鏈重生時另有 `initialCheckpointProof`）不可由執行期設定：
打包時把三份部署值（`src/deployment/deployment-values.{development,private-playtest,public}.json`）內嵌進產物，
執行期以 `OPEN4WD_PROFILE` 選用一份，並以與瀏覽器相同的 `validateDeployment` 驗證。部署值格式不符或 `stage` 與 profile
不一致時一律拒絕啟動（退出碼 3）；`validateDeployment` 回報的錯誤在非 development 拒絕啟動（退出碼 3），在 development 降為
警告記錄。`governanceSigners` 為空時 `run`、`check` 與需要帳本的管理指令（`release-lock`、`config-export`、`config-update`）
一律回退出碼 3（`governance-signers-empty`）；`clear-halt` 不載入部署值，不受此限。

`SIGNER_DEPLOYMENT_VALUES_FILE` 只在 `development` 接受，供本機測試以檔案覆寫部署值。使用中部署值的 SHA-256
以 `deploymentValuesSha256` 呈現在 `/status`：內嵌時等於 build-info 中同一 profile 的值，覆寫檔時是該檔 UTF-8
內容的指紋，未打包執行時為 null。部署者以此核對線上實例的信任根。

## 4. 金鑰

- 內容為 BIP39 助記詞（12 或 24 詞）或 64 位十六進位的 32 bytes seed；推導與瀏覽器玩家身分相同（BIP39 seed
  前 32 bytes → Ed25519 → 公鑰入口檢查 → PeerId）。
- 來源（`SIGNER_KEY_SOURCE`）：
  - `file`（預設）：讀 `SIGNER_KEY_FILE`。POSIX 下權限位元對群組或其他人開放就拒絕（`--allow-loose-key-permissions`
    只供開發金鑰使用）。
  - `env`：讀 `SIGNER_KEY_MNEMONIC` 或 `SIGNER_KEY_SEED_HEX`（只能設一個），讀取後立即從行程環境刪除，並記錄
    `key-env-source-development-only` 警告；只適合開發與 CI。
  - `mnemonic-prompt`：只接受 TTY，關閉回顯。
- 金鑰物件不暴露 seed：序列化、檢視與字串插值都只得到固定字串，錯誤訊息只帶錯誤碼；結束時把 seed 歸零。
  記錄器沒有任何接收 seed 或助記詞的 API，位元組欄位只記長度。
- `keygen` 是唯一會輸出助記詞的指令，只輸出一次；`--out` 以 0600 新建檔案、已存在就拒絕。正式金鑰在未連網的機器
  產生，並離線備份；伺服器與 GitHub 都不是備份。
- `check` 會確認治理金鑰與資料目錄內的 libp2p 身分不同（相同即退出碼 5）。

## 5. 執行期設定

旗標覆寫同名環境變數。錯誤碼只描述哪個欄位不合法，不含欄位值。

| 環境變數                        | 旗標                       | 預設與限制                                                                                     |
| ------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `OPEN4WD_PROFILE`               | `--profile`                | `run`、`check` 與需要帳本的管理指令必填（`clear-halt` 不需要）；`development`／`private-playtest`／`public` |
| `SIGNER_DATA_DIR`               | `--data-dir`               | 需要帳本的指令必填                                                                             |
| `SIGNER_KEY_SOURCE`             | `--key-source`             | `file`（預設）／`env`／`mnemonic-prompt`                                                       |
| `SIGNER_KEY_FILE`               | `--key-file`               | `file` 來源必填                                                                                |
| `SIGNER_BOOTSTRAP`              | `--bootstrap`              | 逗號或空白分隔；每個位址都要合法 multiaddr 且含 `/p2p/`；非 development 至少一個                |
| `SIGNER_LISTEN`                 | `--listen`                 | 預設空清單（只外連）；不得含 `/p2p-circuit`                                                    |
| `SIGNER_MIN_SYNC_PEERS`         | `--min-sync-peers`         | development 預設 0；其他預設 1 且不得為 0                                                      |
| `SIGNER_SYNC_QUIET_MS`          | `--sync-quiet-ms`          | development 預設 5000；其他預設 120000                                                         |
| `SIGNER_TICK_MS`                | `--tick-ms`                | development 預設 30000；其他預設 60000；不得為 0                                               |
| `SIGNER_REBROADCAST_MS`         | `--rebroadcast-ms`         | 未設定時為 TICK 的 5 倍；不得為 0                                                              |
| `SIGNER_HEALTH_HOST`            | `--health-host`            | 預設 `127.0.0.1`                                                                               |
| `SIGNER_HEALTH_PORT`            | `--health-port`            | 預設 9475；0 表示不啟動健康端點                                                                |
| `SIGNER_LOG_LEVEL`              | `--log-level`              | `debug`／`info`（預設）／`warn`／`error`                                                       |
| `SIGNER_DEPLOYMENT_VALUES_FILE` | `--deployment-values-file` | 只在 development 接受                                                                          |

## 6. 資料目錄與單一實例

資料目錄內容：`instance.lock`、`libp2p.key`、`halt.json`，以及 `orbitdb/`、`content-blocks/`、
`entry-blocks/`、`checkpoint-control/`、`admission-outbox/` 等 Level 儲存子目錄。POSIX 下目錄為 0700、檔案為 0600。
Orbit identity 的固定 id 與瀏覽器相同，由 `createLedgerStack` 存在該鏈的 checkpoint control storage
（`checkpoint-control/`，鍵 `__ledger_orbit_id_v1__:<chainId>`），每條鏈一個，重啟後不變；動態 genesis 的暫時開庫不帶 id
（[ledger.md](ledger.md) 第 10 節）。

**〔GSIGN-R-002〕** 同一資料目錄同時只有一個工具行程：`instance.lock` 以獨占建立方式原子寫入持有者的 pid、主機名稱、
啟動時間與心跳時間，持有期間每 60 秒更新心跳。既有鎖的處理：同主機且 pid 等於本行程 pid、但不是本行程目前持有的鎖
（容器內重啟時新行程拿到相同 pid）→ 視為過期鎖接手；同主機且 pid 仍存活 → 拒絕；同主機但行程已結束 → 接手；不同主機
→ 心跳距今超過 3 個心跳間隔才接手，否則拒絕；內容無法解析（含缺心跳欄位）→ 拒絕。接手時 `run` 與需要帳本的管理指令記錄
`instance-lock-taken-over` 警告，`clear-halt` 在 stderr 提示。接手以獨占建立的接手權杖（`instance.lock.takeover-<舊鎖內容雜湊>`）仲裁，取得權杖且鎖檔內容未變才原子覆蓋，同時
接手同一份過期鎖的多個行程只有一個成功，其餘拒絕；接手途中被強制終止會留下權杖檔，之後對同一份舊鎖的接手都拒絕，需確認沒有實例在
運作後人工刪除。
心跳更新時發現鎖檔已被換掉或刪除，常駐實例 halt（`instance-lock-lost`）。`clear-halt`、`release-lock`、
`config-export` 與 `config-update` 都要先取得同一把鎖，取不到回退出碼 5，因此管理指令必須在常駐實例停止後執行。
`check` 不取實例鎖、不修改資料目錄，常駐實例運作中也可以執行。

同主機的判斷（pid 存活檢查與 pid 重用例外）都假設主機名稱相同即共用同一 PID 命名空間：共用同一資料目錄的實例不得
設定相同主機名稱（例如共用宿主機的 UTS 命名空間、`hostNetwork`，或手動指定相同 hostname），否則後啟動的一方會把仍在
運作的另一方的鎖判為已結束行程或自己舊行程的鎖而接手，先啟動的一方要到下一次心跳才 halt（`instance-lock-lost`）。

同一把治理金鑰只能有一個運作中的實例。實例鎖只防止共用資料目錄的雙開；跨主機的最終防線是節點專屬金鑰、
ReadWriteOnce 資料卷與主迴圈的 foreign-instance 偵測（第 9 節）。跨主機接手依賴兩台主機的時鐘，時鐘偏差會直接影響
過期判斷。

## 7. 指令與退出碼

| 指令                                                                               | 作用                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `run`                                                                              | 常駐執行；記錄以 JSON lines 寫到 stdout；SIGTERM／SIGINT 後依序關閉，以 0 結束 |
| `check [--storage-self-test]`                                                      | 啟動前離線檢查：設定、部署值、金鑰、簽署者集合與治理 PeerId、libp2p 身分、Level 儲存 |
| `peer-id`                                                                          | 只印出治理 PeerId                                                        |
| `keygen [--out <path>]`                                                            | 產生 24 詞助記詞                                                         |
| `status [--json]`                                                                  | 讀取本機健康端點 `/status`                                               |
| `clear-halt [--confirm <字串>]`                                                     | 解除 halt（第 10 節）                                                    |
| `release-lock [--dry-run] [--confirm <字串>] [--acknowledge-hidden-quorum-risk]`    | 卡死時人工釋放投票鎖定並改投（第 11 節）                                  |
| `config-export [--out <path>]`                                                     | 輸出下一代治理設定範本（第 12 節）                                       |
| `config-update --file <path> --rationale <文字> [--dry-run] [--confirm <字串>]`     | 簽署並寫入治理設定更新，限簽署者一位（第 12 節）                           |
| `--version`                                                                        | 以一行 JSON 印出 `{version, commit, builtAt, ruleEpochs}`                |

退出碼：0 成功、2 用法錯誤、3 設定錯誤（設定或部署值不合法、金鑰無法載入、`governanceSigners` 為空）、4 執行錯誤
（執行期啟動或關閉失敗、健康端點無法綁定或連不上、儲存自我測試失敗）、5 前置條件不符（設定合法但環境狀態不允許）。
`run` 以外的子命令把診斷記錄寫到 stderr，stdout 只放結果。需要確認字串的指令在 TTY 下逐字輸入，非 TTY 必須以
`--confirm` 帶入，缺少或不符都回 5。`--dry-run` 在前置檢查（`release-lock`）或設定檔驗證（`config-update`）通過後，只印出
確認字串並以 0 結束；前置或驗證不通過時照常回 5 或 3。`check --storage-self-test` 在系統暫存目錄建立暫存的 Level 儲存，
暫存目錄必須可寫。

## 8. 同步閘

**〔GSIGN-R-003〕** 主迴圈、`release-lock`、`config-export` 與 `config-update` 在同步閘通過前不對帳本做任何寫入或定稿。
通過條件依序為：ledger topic 的訂閱者數 ≥ `SIGNER_MIN_SYNC_PEERS`；帳本自動復原為 idle；待定稿索引可讀（啟動對帳
完成、未隔離、沒有 ingest failure）；之後連續 `SIGNER_SYNC_QUIET_MS` 毫秒 heads、最新檢查點、待定稿索引（本體與票）
都不變，期間也沒有事件或投票通知。沒有逾時放行。通過後，訂閱者數低於下限、或曾有訂閱者而歸零時，閘重新關上，
必須再走一次完整條件。

未通過的原因以 `notReadyReason` 呈現：`sync-peers-below-minimum`、`sync-quiet-pending`、`ledger-not-ready[:<code>]`（帳本回報
協定錯誤碼時才帶 `:<code>`）、
`ledger-recovery-<phase>`。靜默只代表這段時間沒有新內容，不代表已取得網路上全部條目；這是同步閘目前的已知限制。

帳本開啟成功但最新檢查點的狀態塊暫時取不到時（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-048〕），工具照常啟動：
同步閘在帳本恢復前不通過（`ledger-recovery-ingest-recovery`），工具不提案、不投票、不定稿、不 halt，`/status` 的 `recovery` 為
`ingest-recovery`；狀態塊補回後帳本自行恢復，工具以帳本的「業務狀態可讀」通知重讀狀態（[ledger.md](ledger.md) 〔LEDGER-R-078〕）。
經同步閘的管理指令（〔GSIGN-R-003〕）在恢復前同樣不通過。定稿公告待送出不影響同步閘。

## 9. 主迴圈

排程為 single-flight：依 `SIGNER_TICK_MS` 定時執行；帳本事件與投票通知 debounce 2 秒後觸發；輪次結束時加 0 到 5 秒
抖動；退避期間通知不提前觸發。每次 tick 依序：

1. 已 halt → 不做任何帳本動作。
2. 同步閘（第 8 節）。
3. 讀待定稿索引與輪次資訊。
4. 規則紀元：帳本狀態的 `deriveRuleEpoch` 不在工具內建 rulebook（`composeGlobalRulebook()` 的 era id）→ halt
   `rule-epoch-unknown`。工具不以比賽紀錄中參賽者自報的版本判定任何暫停。
5. 索引顯示本節點自身重複簽署 → halt `self-equivocation`。
6. foreign-instance：本行程第一次過閘時記下自己已有票的本體為基準；之後索引出現自己的票，且該本體不在基準、
   不是本行程投的、也不在本機鎖定紀錄中 → halt `foreign-instance`。比對以本體 CID 為準：投票條目被檢查點切面拒絕或成為孤兒、
   由寫入器以同一事件重新建立（[ledger-admission.md](ledger-admission.md) 〔LEDGER-R-109〕）時，條目 CID 不同、本體相同，不觸發。
7. 本節點不是本代簽署者 → idle。
8. heads 重送檢查（下文）。
9. 有可定稿的候選本體 → `finalizeCheckpoint`。
10. 卡死 → 停止自動提案與投票，等待人工處理（第 11 節）。
11. 本機有鎖定、鎖定的本體是候選本體，但索引沒有自己的票 → 對鎖定的本體補投（`signCheckpoint`）。鎖定的本體不是候選
    本體時這一步不動作，交由第 12 步；`proposeCheckpoint()` 回 `locked` 時維持等待並記錄 `locked-without-votable-candidate`。
12. 觸發條件成立或已有候選本體 → `proposeCheckpoint()`（重提案、鎖定後重送同一本體與投票對象由帳本規則決定）。

未 halt 的每個 tick 在同步閘之前另讀一次 `getRecoveryStatus()`，把復原階段與定稿公告待送出的情形記到對外狀態；公告的情形
（筆數、最舊一筆、錯誤代碼）改變時記錄一次 `announcement-pending`，清空時記錄 `announcement-delivered`，只有失敗次數增加不重複
記錄。公告由帳本在背景重送（[ledger-checkpoint.md](ledger-checkpoint.md) `finalizeCheckpoint` 條之後的說明），待送出不使主迴圈
退避或 halt，phase 不變。

**〔GSIGN-R-005〕** 檢查點協定錯誤碼的處置是封閉對照表，新增錯誤碼時必須同時決定處置：`reconciliation-pending`、
`ingest-failure`、`state-unavailable` 依 `LEDGER_RECOVERY_RETRY_DELAYS_MS` 退避；`conflict`、`self-equivocation`、
`lock-store-unavailable` halt；`not-signer` idle；`not-designated`、`trigger-not-met`、`locked`、`unknown-checkpoint`、
`below-quorum` 等下一次排程、不退避；`stale-previous` 立即重跑一次，連續第二次改為等待；`invalid-checkpoint`、
`recompute-mismatch` 略過該本體並計數；只屬人工釋放的 `not-stalled`、`stall-too-short`、`release-not-allowed`、
`confirmation-mismatch` 記錄並退避。非協定例外一律退避、不 halt：其中切面容量拒絕（提案或投票事件寫不進）`lastErrorCode` 記
`cut-full`，公告待送出清單已滿使定稿被拒時記 `announcement-backlog-full`，其餘記 `runtime-error`。

**heads 重送**：本節點在目前錨已投票（含自己的提案）的候選本體，自首次看到這張票起逾 `SIGNER_REBROADCAST_MS` 仍未
定稿，就把目前所有 heads 的條目 bytes 重新廣播到 ledger topic；訊息與寫入時的 heads 更新相同，收件端走既有 join 補取
祖先，不改帳本協定或 wire。之後間隔加倍，上限為 8 倍，錨改變時重設；廣播失敗（例如沒有訂閱者）只記錄
`heads-rebroadcast-failed` 並照間隔再試。

## 10. halt

**〔GSIGN-R-004〕** 偵測到 `self-equivocation`、`foreign-instance`、`conflict`、`lock-store-unavailable`、`rule-epoch-unknown`
或 `instance-lock-lost` 時，主迴圈停止所有自動帳本動作並把 `{version, reason, detail, at}` 寫入資料目錄的 `halt.json`；
已有紀錄時保留第一筆。halt 不隨重啟解除：`run` 啟動時讀到紀錄即維持 halted。`halt.json` 無法解析時同樣視為 halted，
原本的原因已無從得知，以專屬原因碼 `halt-record-corrupt` 回報（`/status` 的 `haltReason`、`/readyz` 的
`halted:halt-record-corrupt`、`clear-halt` 的顯示），以 `clear-halt corrupt` 確認解除。`halt.json` 存在但無法讀取（權限不足、
不是一般檔案等）時同樣視為 halted，以另一個專屬原因碼 `halt-record-unreadable` 回報；`clear-halt` 遇到這種情況只顯示原因與
「修正檔案權限或型別後再執行」的提示，不刪除該檔，以退出碼 4 結束。這兩個原因碼只用於回報，不冒用上列任何原因碼，
也不是 `halt.json` 可接受的原因碼；主迴圈不改寫該檔。唯一的解除方式是在常駐實例停止後
執行 `clear-halt`，逐字確認 `clear-halt <reason> <at>`（紀錄損毀時為 `clear-halt corrupt`）；缺確認或不符回退出碼 5，
紀錄保持不變。

halted 時行程不退出，持續提供健康端點：`/healthz` 仍回 200，`/readyz` 回 503 與 `halted:<reason>`。部署端因此必須
監看 `/status` 或記錄，而不是依賴程序重啟（[部署資訊/open-4wd-signer.md](../部署資訊/open-4wd-signer.md)）。

## 11. 卡死時的人工釋放（`release-lock`）

**〔GSIGN-R-006〕** `release-lock` 只在下列前置全部成立時才釋放並改投，任一不符回退出碼 5：取得實例鎖（常駐實例已停止）；
通過同步閘；本機前置檢查全部通過——沒有 halt、本節點是本代簽署者、沒有自身重複簽署、目前錨卡死且卡死已滿
`CHECKPOINT_LOCK_RELEASE_MIN_STALL_HOURS`、本節點恰綁一個本體且本錨尚未釋放過、綁定的本體不是投票對象；非 TTY 執行時另需
`--acknowledge-hidden-quorum-risk` 與正確的 `--confirm`。指令先印出待定稿表、前置檢查結果與殘餘風險提示，之後才要求確認；
帳本規則（[ledger-checkpoint.md](ledger-checkpoint.md) 第 3 節〔LEDGER-R-104〕）拒絕時同樣回 5，其他失敗回 4。

釋放後以 `signCheckpoint` 投給全網一致的投票對象。改投的票靠 `run` 連線時的 heads 交換傳出，完成後必須重新啟動 `run`；
若仍未送達，主迴圈在逾時未定稿時重送 heads。

執行前的人工確認（殘餘風險，issue 001545、001546）：

- 帳本只看得到已公開的票。逐一聯絡其他簽署者，確認各自只投過一個本體、沒有任何本體已達 quorum（包括尚未公開的票）；
  無法確認時不釋放。`--acknowledge-hidden-quorum-risk` 代表已完成這項確認。
- 改投前確認投票對象有誠實簽署者的第一票支撐；這項確認不成立時不釋放。

## 12. 治理設定更新（`config-export`、`config-update`）

`config-export` 在同步閘通過後讀 `DerivedState.economyConfig`，輸出 `epoch + 1` 的範本：`signedAt`、`signers` 依
[程式參數/economy-config.md](../程式參數/economy-config.md) 第 17.3 節留空，其餘欄位沿用目前值；`--out` 以新建方式寫檔，已存在回 5。

**〔GSIGN-R-007〕** `config-update` 只在目前簽署者恰為一位、且就是本節點時寫入：簽署者不是恰好一位回退出碼 5 並說明多人收簽由
issue 001539 實作；本節點不是那位簽署者回 5。新設定依序檢查結構（`isEconomyConfigShape`）、`signedAt` 為 0 且 `signers`
為空、revShare 不變式、新簽署者集合合法（N=1 或 N≥3）、epoch 連號、確有變更；前四項不符屬設定錯誤（3），後兩項屬前置
條件（5）。另需 `--rationale`（UTF-8 不超過 4096 bytes）、沒有 halt，以及確認字串
`config-update <prev>-><epoch> <設定檔原始 bytes 的 SHA-256 前 16 hex>`。

通過後工具以當下時間為事件時戳，依 [程式參數/economy-config.md](../程式參數/economy-config.md) 第 17.3 節填入 `newConfig` 的
`signedAt`、`signers`，事件 `signers` 為本節點，對 `ledgerSigningDigest(ledgerAddress, 事件)` 簽章；先以 `applyConfigUpdate` 在本機預檢，狀態沒有推進就回 4 且不寫入，
通過後 `appendPreSigned`，並等本機狀態推進到新 epoch（上限 30 秒，逾時回 4）。完成後必須重新啟動 `run`，事件靠連線時的
heads 交換傳出。

簽署者集合變更時，指令印出新增與移除的成員、新門檻與換代提醒：新成員須各自部署並啟動工具；擴編到多位後的任何設定調整
都需要多人收簽；部署值的 `governanceSigners` 是 genesis 信任根，不隨擴編修改。多人收簽的產生端屬
[流程/治理事件.md](../流程/治理事件.md) 第 4 節。

## 13. 開發金鑰與一鍵啟動

`tools/governance-signer/dev/development-governance.key` 是刻意公開的開發用治理金鑰，PeerId 為
`z6MkqLkZ9bmbjJcW7CVAbKEwmw9Ci3n4vPinMK5woAsQzyFh`，填在 development 部署值的 `governanceSigners`。

**〔GSIGN-R-008〕** 公開開發金鑰只允許出現在 development：部署值的 `stage` 不是 `development` 而 `governanceSigners` 含此 PeerId 時，
`validateDeployment` 與 `check:deployment` 報 `governance-signer-development-key`；簽署工具以內嵌部署值載入時同樣拒絕
（退出碼 3）。

`pnpm start:signer` 每次先重新打包，再以打包產物執行 `run`；預設 `OPEN4WD_PROFILE=development`、開發金鑰、資料目錄
`tmp/governance-signer-dev`、listen `/ip4/127.0.0.1/tcp/4012/ws`，並在 stderr 印出可貼到設定頁 bootstrap 的
`/ip4/127.0.0.1/tcp/4012/ws/p2p/<網路 PeerId>`。瀏覽器能撥號到這個 loopback WebSocket 位址，是因為 development 部署階段的撥號閘
（[peer-discovery.md](peer-discovery.md) 第 1 節）；其他部署階段不放行。

## 14. 瀏覽器不簽

**〔GSIGN-R-001〕** 瀏覽器 client 不提案、不投票、不釋放鎖定：主 repo `src/` 中帳本核心（`src/ledger/`）與測試輔助（`src/testing/`）
以外的程式與元件範本不得呼叫 `proposeCheckpoint`、`signCheckpoint` 或 `releaseCheckpointVoteLock`，瀏覽器也不載入治理金鑰。
這三個操作只由簽署工具執行；`finalizeCheckpoint` 不受此限。

## 15. 健康端點與記錄

健康端點（`node:http`）預設只綁 `127.0.0.1:9475`，只接受 GET：

- `/healthz`：行程存活即 200。
- `/readyz`：phase 為 ready 時 200，否則 503 並附原因碼。
- `/status`：JSON 狀態，欄位固定為 `phase`、`haltReason`、`notReadyReason`、`governancePeerId`、`profile`、`ledgerAddress`、
  `deploymentValuesSha256`、`connections`、`latestCheckpointCid`、`round`、`pending`、`recovery`、`pendingAnnouncement`、
  `lastErrorCode`、`buildInfo`。`pendingAnnouncement` 為 null 或 `{count, oldestCheckpointCid, attempts, lastErrorCode}`
  （定稿公告待送出的筆數、最舊一筆、連續失敗輪數與最近一次錯誤代碼，不輸出錯誤訊息；代碼見 [ledger.md §11](ledger.md#11-ledgerapi)）。
  輸出逐欄投影，provider 誤帶的其他屬性不會出現。`phase` 為 `starting`、`syncing`、`ready`、`idle`、`halted`、`stopping`
  之一；`buildInfo` 為 `{version, commit, builtAt, ruleEpochs}`。

其他路徑回 404，已知路徑的其他方法回 405。`status` 指令只連設定的健康位址（萬用位址改連 `127.0.0.1`），不接受任意 URL。

記錄是每筆一行的 JSON（`{ts, level, event, ...}`），低於設定層級的不輸出。主要事件：`key-loaded`、`runtime-started`、
`libp2p-listening`（`addresses`，預設不監聽時為空陣列）、`health-server-listening`、`loop-state`、`sync-gate-passed`、
`checkpoint-proposed`、`checkpoint-voted`、`checkpoint-vote-restored`、`checkpoint-finalized`、`checkpoint-skipped`、
`loop-backoff`、`heads-rebroadcast`、`heads-rebroadcast-failed`、`announcement-pending`、`announcement-delivered`、`halted`、`halted-on-start`、`halt-record-corrupt`、
`halt-record-unreadable`、`instance-lock-taken-over`、`instance-lock-lost`、
`governance-peer-not-in-signers`、`shutdown-requested`、`stopped`。

## 16. 打包與映像

`pnpm build:signer`（`tools/governance-signer/build.mjs`）以 esbuild 打包成 `dist/governance-signer/main.mjs`（node24 ESM，
external 為 `classic-level` 與 `node-datachannel`）。`node-datachannel` 被頂層靜態 import 即建置失敗；`classic-level` 及其
依賴閉包從 repo 的 `node_modules` 複製到 `dist/governance-signer/node_modules/`，保留全部平台的 prebuild。輸出另含 `LICENSE`、
`THIRD_PARTY_NOTICES.md`、`THIRD_PARTY_LICENSES.txt` 與 `build-info.json`；`main.mjs` 或 `build-info.json` 含 repo 路徑或家目錄即
建置失敗。

`build-info.json` 欄位：`schema`、`name`、`version`、`commit`、`builtAt`（`SOURCE_DATE_EPOCH` 優先）、`ruleEpochs`、`commitDirty`、
`target`、`esbuild`、`mainSha256`、`deploymentValuesSha256`（三個 profile 各一）、`runtimePackages`、`bundledPackages`；不含環境
變數、金鑰或秘密。`version` 取主 repo `package.json`，實際以 commit 與映像 digest 識別。

映像由主 repo `.github/workflows/signer-image.yml` 建置：只手動觸發、repository 變數 `SIGNER_IMAGE_ENABLED` 為 `true` 且在預設
分支才執行；先跑 `test:signer`（要求 N=4 整合測試通過）與 `test:signer:slow`（依條目數提前觸發的整合測試，不在 `test:signer`
的預設集合內，要求報告中有測試且全部通過），再打包、建置單階段 runtime 映像、煙霧測試，推到 GHCR 並輸出
digest，不打 latest。映像與部署細節見 [部署資訊/open-4wd-signer.md](../部署資訊/open-4wd-signer.md)。

## 17. 已知限制

- 同步閘以靜默判斷追上網路，尚未與對等節點比對最新檢查點（第 8 節）。
- 內容區塊沒有 GC，資料目錄隨帳本成長（issue 001548）。
- 同步層對遺失的 heads 更新沒有保證時效的補送；工具只對自己有票的本體以 heads 重送緩解（issue 001549）。
- 提案者寫入鎖定後、寫出提案前中斷時，下一次 `proposeCheckpoint()` 由內容塊取回同一本體重送；本體塊取不到時主迴圈維持等待並記錄
  `locked-without-votable-candidate`（issue 001544）。
- 切面的硬上限也滿時提案與投票事件寫不進，工具以 `cut-full` 退避（issue 001563）；保留額度在三位以上簽署者時的限制見
  [ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-110〕（issue 001566）。
- 定稿公告待送出清單中最舊一筆的憑證在本機取不到時，帳本每輪都停在那一筆，`pendingAnnouncement` 不會自行清空，目前沒有人工移除的
  指令（issue 001567）。清單滿 24 筆後新的定稿以 `announcement-backlog-full` 被拒，工具退避、不 halt。
- 帳本的採納背景重掃不反映在 `/status`（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-041〕）。
- 只有一個瀏覽器加簽署工具的拓撲下，開房的房間公告因 rooms topic 沒有其他訂閱者而失敗；工具只訂閱帳本 topic，不改變這個
  限制（issue 001550）。
- 正式部署前，pinning 節點 vendored 的帳本必須接受檢查點控制事件，否則會拒收工具寫出的事件；也必須套用檢查點切面與時鐘規則
  （[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-045〕、〔LEDGER-R-107〕、〔LEDGER-R-108〕），否則會保留並交換孤兒 heads（issue 001488）。
- 以空位址（動態 genesis）啟動時，暫時開庫會在內容區塊與 keystore 多留一個不簽任何條目的 Orbit identity；數量隨空位址啟動次數增加
  （併 issue 001548 觀察）。
- 簽署者多於一位時無法 `config-update`，直到多人收簽落地（issue 001539）。

## 18. 跨模組對接

| 對象                                                                 | 內容                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [ledger-checkpoint.md](ledger-checkpoint.md)                         | 檢查點本體、輪次、投票、鎖定、卡死與釋放、憑證、錯誤碼                                 |
| [ledger.md](ledger.md)                                               | `orbitId`、條目儲存與同步邊界、`LedgerApi`                                             |
| [流程/治理事件.md](../流程/治理事件.md)                               | `config-update` 事件與 signer set 變更                                                 |
| [流程/升版.md](../流程/升版.md)                                       | 規則版本與工具同時升級                                                               |
| [部署資訊/open-4wd-signer.md](../部署資訊/open-4wd-signer.md)          | 映像、k8s／systemd 部署、營運程序                                                    |
| [部署資訊/部署實際值與初始拓撲.md](../部署資訊/部署實際值與初始拓撲.md) | `governanceSigners` 實際值與開發金鑰                                                 |
| [toolchain.md](toolchain.md)                                         | `test:signer`、`test:signer:slow`、`build:signer`                                    |
