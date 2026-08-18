---
id: D-20260803-06
date: 2026-08-03
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260706-02", "D-20260706-03", "D-20260713-01", "D-20260724-01", "D-20260728-04", "D-20260731-03", "D-20260803-03", "D-20260803-04"]
domains: ["比賽房間", "UGC版權", "版本部署", "治理營運"]
sources: ["2026-08-03 Runtime provider 全面社群化與專案權威分界"]
files: ["部署資訊.md", "程式架構.md", "程式架構/interfaces.md", "程式架構/settings.md"]
vectors: []
deprecates: []
---

# D-20260803-06｜Runtime provider 全面社群化

## 背景與驅動力

D-20260803-03 已取消官方／預設 pinning，但現行 canon 仍把 signaling、bootstrap、relay、
ICE／TURN、固定服務域名、monitoring 與 release checks 綁定到專案維護者的持續部署。這會讓
去中心化 client 依賴一組未上線、可停機且不屬協定權威的營運服務，也把維護者個人部署誤認
為專案承諾。

Open4WD 仍需要唯一公共 Ledger 位址與 genesis governance signer set，否則玩家會進入互不
相容的帳本宇宙。需要移除的是 runtime 營運權威，不是主線 client、規格 canon 或網路身分。

## 考慮過的選項

- 由專案繼續提供一組官方／預設／保底 provider：形成持續營運與 release dependency，否決。
- 將 registry 或任意 provider identity 提升為 Ledger trust root：會讓技術發現取代治理信任，
  否決。
- 保留單一 Ledger／genesis 信任根，將所有持續在線服務改為平等、可替換且由 operator 自負責
  的 community provider（採納）。

## 決定

- `project-maintained` 只表示主 client、specs、releases、conformance vectors 與主 repo 收錄
  資產；不表示專案持續營運任何 runtime endpoint。
- `community-listed` 只表示 provider 在上次檢核時可被技術發現，不構成 endorsement、信任、
  合法性、可用性、留存、寫入授權或安全港資格。
- `operator` 是負責一個 deployment 的人或組織；`provider` 是一個 runtime capability endpoint；
  `self-hosted` 是由玩家或社群自行營運的 deployment。
- Client 固定使用同一公共 `ledgerAddress`，並以 genesis `governanceSigners` 作為治理信任根。
  Registry、邀請與 provider identity 都不得改寫這兩項權威。
- Pinning、signaling、bootstrap、relay、gateway、monitoring、ICE／TURN 與 DMCA deployment
  都不得稱為官方、預設、主要、推薦、可信、驗證或保底 provider。各 operator 對自己的服務、
  secrets、內容供應、法律流程與退役負責。
- 主 repo 發布五份 v1 community registry：`bootstrap.json`、`signaling.json`、`pinning.json`、
  `relay.json`、`ice.json`。Registry 只保存公開技術資料，允許為空；下載失敗依序使用最後成功
  快取與 build snapshot。
- 每類服務先由玩家選擇 `community`、`manual-only` 或 `disabled`／`offline`。手動設定永遠
  優先；玩家接受的邀請 route 只限當次 session 且不得自動持久化；disabled／offline 不使用
  registry、邀請或其他遠端來源。
- Registry listing 不授予 pinning write；read fallback 只查玩家選取的有限集合。Provider
  identity 改變視為新 provider，不繼承 write authorization 或案件信任。
- 維護者可沿用 `*.open4wd.org` 營運一般 community provider，但域名不產生 badge、排序、
  信任或持續供應承諾。服務只有實際上線並通過相同檢核時才可列入 registry，關閉不需 client
  發版或網路級交棒。
- `open-4wd-pinning`、`open-4wd-signaling` 與 `open-4wd-turn` 是 reusable implementation／
  template，不代表 deployment。Operator 可自行決定 deployment repo 的可見性與名稱。
- D-20260724-01 的 Cloudflare Worker／Node adapter、協定與安全邊界保留；兩種 adapter 地位
  相同，移除官方 Cloudflare deployment、固定服務域名與 private deployment repo 前提。
- D-20260706-03 的 coturn template、manifests、安全預設與 signaling token 配對契約保留；
  移除未來官方 TURN、固定 deploy repo 與硬編碼 public STUN fallback。TURN credentials 只能
  來自玩家手動設定、配對的 signaling provider 或已接受的 session ICE configuration。
- D-20260803-04 的 provider-scoped notice、counter-notice、hold、恢復、私有案卷與簽章 inbox
  全部保留。Legal capability 與 UGC read／write 正交；主 client 與 registry 不代理、彙整或
  判定案件，也不替 operator 主張 17 U.S.C. 512 安全港。
- 專案尚未發布相容契約；本決策直接形成唯一 v1 baseline，不建立 official parser、v2／v3、
  dual-read、migration 或 compatibility shim。

## 後果與影響

維護者自己的 provider 與其他社群 provider 使用相同 schema、health check、選擇與降級規則，
可隨時離線或永久關閉。任何 provider failure 都不得阻止 client 啟動、讀取本地資料、匯入
CAR、透過玩家 mesh 傳遞內容或驗證公共 Ledger。

主 repo 與 specs 仍是協定與 release 的專案權威；community registry 只是可替換的發現資料。
現行文件、UI、設定、測試與 release gate 必須移除官方／預設 provider 與未來 private deploy
承諾。歷史 ADR 原文保留，本決策只覆寫其中的專案營運前提，不移除其 adapter、template、
protocol-security 或 provider-scoped DMCA 技術決定。
