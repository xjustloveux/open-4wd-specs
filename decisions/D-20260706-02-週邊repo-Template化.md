---
id: D-20260706-02
date: 2026-07-06
status: accepted
supersedes: ["D-20260705-06"]
superseded_by: null
amends: []
domains: ["版本部署"]
sources: ["2026-07-06 週邊 repo 全面 Template 化定案"]
files: ["部署資訊.md", "程式架構.md", "部署資訊/open-4wd-pinning.md", "部署資訊/open-4wd-signaling.md", "部署資訊/open-4wd-turn.md", "程式架構/pinning-service.md", "程式架構/dmca.md"]
vectors: []
deprecates: []
---

# D-20260706-02｜週邊 repo 全面 Template 化：公版零 secrets＋部署 repo 同路

## 背景與驅動力

使用者提案：部署設定與流程人人不同，pinning 也應比照 TURN 做成「公版 ＋use-template 微調後部署」。前一日的 [D-20260705-06](D-20260705-06-D1部署模型.md) 把 repo 本體當部署單元，意味官方部署的 secrets 與微調住在公版 repo，官方與社群自架走不同的路。

## 考慮過的選項

- 舊模型「fork 後設 secrets」：官方與社群路徑分岔、公版 repo 沾 secrets，廢除。
- 自架 Harbor registry：GHCR 公開 image 出現後失去必要性，整組退場。
- 公版 Template＋ 部署 repo（採納）。

## 決定

- 三週邊 repo 統一模型：公版 Template repository（零 secrets、驗證 ／ 發佈 CI、永不部署）＋ 官方部署 repo（use-template 產生、與社群自架同一條路、微調與 secrets 全住部署 repo）；差異僅時程（pinning／signaling 官方 day-one 部署、turn 延後）。
- GHCR 關鍵改良：公版 CI 以內建 `GITHUB_TOKEN` 發佈 public image → 部署 repo 免 build、免 registry secret、免 imagePullSecrets；部署憑證三選一（`KUBE_CONFIG` 遠端 ／SSH 節點端 ／compose 免 CI）屬部署 repo 私事。
- 跟版 ＝ 部署 repo `git remote add upstream` 定期 merge（use-template 無 fork 連結）。
- 部署 repo 命名慣例 `<公版名>-deploy`（官方即 `open-4wd-pinning-deploy` 等三 repo）；環境分流走 branch → namespace、不用環境詞。
- 金鑰產生 runbook 文檔化：節點身分、`CLUSTER_SECRET`、`DMCA_ADMIN_TOKEN`、玩家 PeerId 各自產法；助記詞永不進 GitHub。

## 後果與影響

官方部署與社群自架收斂為同一條路、自架指南由官方持續 dogfood；公版 repo 可安全公開。此模型成為後續部署決策的底座：[D-20260706-03](D-20260706-03-TURN公版先建不部署.md) 的 TURN 時程與 [D-20260724-01](D-20260724-01-signaling-v2部署拓撲.md) 的私有 deploy repo 拓撲皆直接沿用。模型權威見 [部署資訊.md](../部署資訊.md) 與 [部署資訊/open-4wd-pinning.md](../部署資訊/open-4wd-pinning.md)。
