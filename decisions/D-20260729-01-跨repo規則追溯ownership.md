---
id: D-20260729-01
date: 2026-07-29
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260725-06"]
domains: ["治理營運"]
sources: ["2026-07-29 文檔工程：跨 repo 規則追溯改採 ownership 模型"]
files: ["rule-ownership.json", "rules.json", "scripts/check-trace.mjs", "文檔工程.md"]
vectors: []
deprecates: []
---

# D-20260729-01｜跨 repo 規則追溯改採 ownership 模型

## 背景與驅動力

[D-20260725-06](D-20260725-06-規則到測試追溯制度.md) 建立時，規範性規則與測試都位於
主 repo；`LEDGER-R-090` 的 one-shot genesis 實作與測試改由 pinning repo 承擔後，原本
「掃主 repo 全部測試即可代表全 registry」的隱含前提不再成立。規則已有真實測試，追溯報告
卻固定顯示缺測。

## 考慮過的選項

- 由主 repo CI checkout 所有 implementation repo 後集中掃描：repo 增加時會同步增加權限、
  可用性與 lock 耦合，且違反一個實作 repo 只驗自己交付物的責任邊界，棄。
- 保留主 repo 模型並為跨 repo 規則建立例外清單：會把真實測試排除於追溯之外，缺口永久
  失去訊號，棄。
- 由 Specs 記錄規則 ownership，各實作 repo 只驗自己擁有的規則，另保留 workspace 聚合
  報告（採納）。

## 決定

- Specs 的 `rule-ownership.json` 是 ownership 輸入；生成式 `rules.json` 每條規則皆帶
  `implementationRepos`。未覆寫規則預設屬 `open-4wd`，`LEDGER-R-090` 屬
  `open-4wd-pinning`。
- 通用 checker 由 Specs 提供。每個 target 必須明列 repo id 與 test root；已知規則若掛在
  非 owner repo，與 ghost ID 一樣硬紅。owner 規則零標註仍維持 report mode。
- 主 repo 的既有 `check:trace` 只委派 `open-4wd/src` owner scope；本機 sibling workspace
  另以顯式 target 聚合 main 與 pinning，禁止 checker 自動發現其他 repo。
- 本階段不接 GitHub Actions。待 Specs 公開並取得 immutable commit SHA 後，各實作 repo
  CI 只 checkout 自身與 pinned Specs，不 checkout 其他 implementation repo。

## 後果與影響

主 repo 報告從全域 198／199 改為自身 198／198，workspace 聚合則能如實顯示 199／199；
coverage 分母不再隨別的 repo 新增規則而污染。Specs 同時成為規則語意與 ownership 權威，
implementation repo 只負責自身測試標註。

代價是新增或搬移跨 repo 規則時，必須同步更新 ownership 輸入；本機 aggregate 的 target 清單
也需顯式接入新 repo。這項顯式成本用來避免 GitHub Actions 悄悄形成跨所有 repo 的中心依賴。
