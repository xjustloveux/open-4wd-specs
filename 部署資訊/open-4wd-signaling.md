---
type: deploy
domain: ["版本部署"]
summary: signaling 公版模板 repo 規格（scoped signed v1）
authority: null
slug: null
---

# open-4wd-signaling 部署規格

> **本檔角色**：`open-4wd-signaling` 的 **repo 層規格** —— 目錄結構、部署變數 / secrets、CI 驗證與社群自架指南。
> **wire 協議與伺服器實作**（`SignalingWireMessage` / 協定核心 ＋ 傳輸適配器 / 伺服器義務與安全規則 / rate limit / TURN token 發放）見 [程式架構/signaling-service.md](../程式架構/signaling-service.md)；部署政策見 [部署資訊.md §4](../部署資訊.md)。
> 共通部署模型只由 [部署資訊.md §1.1](../部署資訊.md) 定義。本 repo 的差異是提供協定核心、
> Node／Cloudflare Worker adapters、模板與驗證 CI；兩種 adapter 協定地位相同。

## 0. Fork 後手動一鍵部署（Cloudflare Workers）

公版隨附 `.github/workflows/deploy.yml`，只有 `workflow_dispatch`；deploy job 另受
`DEPLOY_ENABLED == true` 閘保護。公版不設定該 variable 或任何 secret，故不會部署。

| GitHub 項目             | 類型           | 取得／填法                                                               |
| ----------------------- | -------------- | ------------------------------------------------------------------------ |
| `DEPLOY_ENABLED`        | variable       | 固定 `true`；明示此 fork 可部署                                          |
| `CLOUDFLARE_ACCOUNT_ID` | secret         | Cloudflare Dashboard 帳號首頁複製 Account ID                             |
| `CLOUDFLARE_API_TOKEN`  | secret         | My Profile → API Tokens 建立只允許目標帳號 Workers Scripts Edit 的 token |
| `INTERNAL_HMAC_SECRET`  | secret         | `openssl rand -hex 32`；只供本部署使用                                   |
| `TURN_SHARED_SECRET`    | secret，選配   | 與配對 coturn 完全同值；必須與 `TURN_URLS` 成對                          |
| `TURN_URLS`             | variable，選配 | 逗號分隔 `turn:`／`turns:` URL；必須與 TURN secret 成對                  |

操作：fork → 啟用 fork Actions → 設上表 → Actions 的 **Deploy operator fork** 按
**Run workflow**。流程依序執行 frozen install、types、tests、Wrangler dry-run、secret binding
注入與 deploy。預設使用 Cloudflare 配發的 workers.dev WSS；Custom Domain 從 Worker Dashboard
設定，TLS 由 Cloudflare edge 自動簽發與續期，不需修改 repo。

## 1. 定位與職責

- **WebRTC 握手中介**（交換 SDP / ICE candidate；純傳輸層）。配對不經本服務——主路徑 ＝GossipSub（演算法與 payload schema 權威 = [程式架構/matchmaking.md](../程式架構/matchmaking.md)），本 repo 無配對端點。
- client 使用 scoped Signaling v1；依設定順序只開第一個健康 WSS，並同時保留
  `GossipSub` fallback。Gossip adapter 在主 repo，不在本 repo；WSS 全掛時不阻斷
  已加入 libp2p mesh 的玩家。
- **TURN token 發放端**：與 `open-4wd-turn` 以 shared secret 耦合（[§3](#3-部署變數與-secrets)、[§7](#7-耦合點)）。
- 連線建立後即直接 P2P，signaling 不在賽中路徑上；無持久資料（房間狀態 ephemeral）。
- Worker 的 SQLite 只保存短期成員順序、限流與 replay nonce，不保存 SDP／ICE 或遊戲資料。
- Node adapter 的自建映像須符合[資安規範.md §8](../資安規範.md) 容器安全基線（Worker 路徑不涉容器）。

## 2. Repo 目錄結構

```text
open-4wd-signaling/
├── core/                          # 平台無關協定核心：零 I/O 純函式、時鐘注入
│   ├── protocol/                  # vendored 協定層（唯一入口 index.ts；vendor/=自主 repo 逐字搬入、MANIFEST hash）
│   ├── room.ts                    # 純 reducer：step(state, input, now) → { state, effects }
│   ├── state.ts                   # RoomState 型別與初始值
│   ├── rate-limit.ts              # 純函式固定窗計數（計數器儲存由適配器提供）
│   ├── turn-token.ts              # TURN 短期憑證組造（signaling-service.md §6.1）
│   └── constants.ts               # 伺服器常數（單一權威=程式參數/network.md §9 伺服器段）
├── adapters/node/                 # 薄傳輸適配器：ws server＋HTTP 路由＋ping 排程＋限流儲存
│   ├── server.ts                  # /ws?room= 升級、POST /turn-token、其餘 404
│   └── config.ts                  # 環境變數讀取（§3）
├── adapters/worker/               # Cloudflare Worker＋SQLite-backed Durable Objects
│   ├── worker.ts                  # public router；只信 CF-Connecting-IP
│   ├── room-object.ts             # per-scope WebSocket hibernation／成員與 nonce
│   ├── admission-object.ts        # opaque bucket fixed-window admission
│   └── token-object.ts            # TURN token proof／replay／rate limit
├── e2e/                           # 真 Node／local workerd 伺服器 E2E
├── deploy/docker/                 # Dockerfile＋docker-compose.yml（signaling 單體）
│                                  # ＋docker-compose.all-in-one.yml（signaling＋coturn 一台全包）
├── deploy/cloudflare/             # Wrangler 公版設定、types、local workerd E2E 與 dry-run
├── scripts/                       # check-vendor.ts＋check-constants.ts＋smoke.ts
├── .github/workflows/ci.yml       # 公版驗證
├── .github/workflows/deploy.yml   # dispatch-only＋DEPLOY_ENABLED opt-in
├── LICENSE
└── README.md                      # 自架 quickstart（= 本檔 §5 摘要）
```

`core/protocol/vendor/` 與主專案的位元組一致性由**雙層漂移檢查**維護：本地 MANIFEST hash 比對（防手改、永遠執行；公版 CI 以 `pnpm check:vendor -- --local-only` 自給自足，不讀取其他 repository）＋ main 公開後對 locked main SHA 的 remote provenance gate（逐檔抓上游原檔比對，上游變動即 fail；main 尚 private 時不啟用、也不用暫時 PAT 或 GitHub App，見 [專案生命週期 §5](../專案生命週期.md#5-首次公開的跨-repo-順序)）；同步以 `pnpm check:vendor -- --write` 執行。

## 3. 部署變數與 Secrets

公版 repo＝ **零 secrets**（deploy workflow 只提供機制、未啟用，[§4](#4-ci公版與營運者部署)）。下表先列 Node adapter 自架變數；
Cloudflare 營運值（account、route、custom domain、API Token、`INTERNAL_HMAC_SECRET`、
選配 TURN secret 與限流值）全部只存在各營運者的部署環境。

| 變數                 | 預設     | 說明                                                                                                                                                                    | fork 自架                                    |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `PORT`               | 8080     | 監聽埠                                                                                                                                                                  | 可調                                         |
| `TRUST_PROXY`        | `false`  | 是否採信反向代理的 client IP 標頭。**預設關閉**——無條件採信＝任何人可偽造標頭繞過限流；僅在代理確定會覆寫該標頭時設 `true`                                              | 視部署拓撲                                   |
| `RATE_LIMIT_PER_MIN` | 60       | 每 IP 每分鐘連線上限，逾額 429（[程式架構/signaling-service.md §5](../程式架構/signaling-service.md)）                                                                  | 可調                                         |
| `PEER_TIMEOUT_MS`    | 90000    | 成員存活逾時（**唯一時窗旋鈕**；ping 間隔自動派生＝本值 1/3）                                                                                                           | 可調                                         |
| `TURN_SHARED_SECRET` | （未設） | TURN token 簽發密鑰——**跨 repo 耦合：與 `open-4wd-turn` 部署變數同值**；輪換須兩邊同步。與 `TURN_URLS` 皆備才掛 `POST /turn-token`，任一缺席（含空值）＝端點不掛（404） | 必改（與自架 turn 配對；無自架 turn 則不設） |
| `TURN_URLS`          | （未設） | 簽發 token 時原樣下發的 TURN URL 清單（逗號分隔、僅接受 `turn:`／`turns:` 前綴）                                                                                        | 同上                                         |

其餘時窗（register 期限、時戳容忍窗）與協定行為耦合 ＝ 固定常數、不開放環境變數；伺服器常數的單一權威 ＝ [network.md §9](../程式參數/network.md#9-networksignaling連線握手) 伺服器段。all-in-one 部署另需 `REALM`／`EXTERNAL_IP`（必填四鍵 `:?` 硬檢、任一缺值拒絕啟動）＋ 可選 `MIN_PORT`／`MAX_PORT`／`USER_QUOTA`／`TOTAL_QUOTA`／`MAX_BPS`——語義見 [部署資訊/open-4wd-turn.md](open-4wd-turn.md)。

## 4. CI（公版）與營運者部署

- **公版 repo CI＝ 純驗證、永不部署**：frozen install → format → lint → types → unit →
  Node／local workerd E2E → vendor check（`--local-only`）→ Worker types check／dry-run → docker build。
- 註解語言不屬服務或部署契約，不加入公版 CI、聚合 test、build 或營運者 deploy 前置；英文與繁中皆可，vendor 保留來源語言。
- **營運者部署**（fork 後由 §0 workflow 明示 opt-in；既有基礎設施亦可）：
  1. Cloudflare Worker 與 Node docker adapter 是平等選項；營運者自行設定發布核准與憑證。
  2. 部署前必跑相同測試、types 與 dry-run；部署後以 canonical scope 完成
     WSS register／`room-state` smoke。
  3. 鎖定公版來源 commit；fork 以 PR／受保護分支審核升級與回滾，clone 則由營運者自行保留等價審計軌跡。

## 5. 社群自架指南

- **社群 Cloudflare 路徑**：依 §0 fork → 設 secrets／vars → 手動 dispatch；workflow 建立／更新
  Durable Objects 並 `wrangler deploy`，可各自在免費額度內提供 WSS endpoint。
- **最快路徑（一台 VM）**：fork／clone → 填環境變數（[§3](#3-部署變數與-secrets)）→ `docker compose -f deploy/docker/docker-compose.yml up -d`（signaling 單體、in-memory 單行程）→ 置 TLS 反代後得 `wss://` URL → 玩家設定頁填自架 signaling。
- **all-in-one**＝ 另檔 `docker-compose.all-in-one.yml`（**signaling＋coturn**＝ 一台機器全包 signaling＋STUN／TURN；`TURN_SHARED_SECRET` 單一變數同時餵兩邊；可與 pinning 同機）。
- **注意**：signaling 只有在營運者為同一部署明示配對 TURN，且同時提供
  `TURN_SHARED_SECRET`＋`TURN_URLS` 時才掛 `/turn-token`；否則端點回 404，client 只使用玩家
  手動設定、其他已選 provider 或 session invite 明示的 ICE，不連未選後備服務。

## 6. 維運 Runbook

| 事項     | 作法                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 升級     | 房間狀態 ephemeral——部署即升級、無資料遷移                                    |
| 回滾     | redeploy 上一 commit／tag（docker image 重建）                                |
| 監控     | 容器日誌／反向代理指標（請求量 / 錯誤率）；429 佔比（rate limit 健康度）      |
| 全掛演練 | WSS 全滅時 scoped mux 轉 Gossip；已建立的 WebRTC mesh 不受 signaling 下線影響 |

## 7. 耦合點

| 對象            | 耦合                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-4wd-turn` | `TURN_SHARED_SECRET` 同值（token 發放 ↔ 驗證）；`TURN_URLS` 原樣下發                                                                                       |
| 主專案 client   | `SignalingProvider.openSession({ localPeerId, scope })`；canonical `room:<uuid-v4>`／`match:<id>`；signed `signal-v1`；設定頁玩家自架 URL                  |
| matchmaking     | 配對不經本服務（主路徑＝GossipSub；演算法與 payload schema 權威 = [程式架構/matchmaking.md §2](../程式架構/matchmaking.md)）                               |
| 程式參數         | 常數單一權威＝[network.md §9](../程式參數/network.md#9-networksignaling連線握手)（`PEER_TIMEOUT_MS` / `MESSAGE_RATE_LIMIT_PER_MIN` 等在伺服器段；`TURN_TOKEN_TTL_SEC` 在同表 client 塊） |
