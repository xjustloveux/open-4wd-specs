---
id: D-20260823-01
date: 2026-08-23
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260815-02"]
domains: ["治理營運", "版本部署"]
sources: ["2026-08-23 ─ 註解 hook 改為本機 wrapper 生成（issues 000744、000789、000791）"]
files: ["程式架構/toolchain.md"]
vectors: []
deprecates: []
---

# D-20260823-01｜註解 hook 改為本機 wrapper 生成

## 背景與驅動力

[D-20260815-02](D-20260815-02-註解品質本機前移與多語PR流程.md) 讓每個產品 repo 提供 opt-in
`.githooks`，並規定 setup 只寫該 repo 的 local `core.hooksPath` 與 `open4wd.commentProfile`。
這把可執行位的責任留給版控的 Git tree mode：主 repo 在 Windows（`core.filemode=false`）重建
`.git` 後，兩支 hook 以 `100644` 進入 index，Linux CI 的 hook 模式守門即紅燈（issue 000744）；
pinning、signaling、TURN 三個公開 Template 的 `.githooks` 也一直是 `100644`，POSIX clone 執行
setup 後 Git 會以「hook was ignored because it is not set as executable」靜默略過（issue 000789）。
主 repo 於 000744 已改為 setup 生成本機 wrapper，Template 於 000789 比照移植，但決策檔文字仍停在
`core.hooksPath` 設計（issue 000791）。

## 考慮過的選項

- 維持 tracked `100755`，每次從 Windows 工作樹重建歷史都手動補可執行位：一般 clone 無問題，但
  流程脆弱且已實際回歸一次，否決。
- 完全移除 optional hooks：最簡單，但失去 push 前的本機 preflight，否決。
- setup 讀取版控 template、生成目前 clone 的本機 wrapper 並設可執行位（採納）。

## 決定

- `.githooks/pre-commit` 與 `.githooks/pre-push` 只是版控 template，不要求 Git tree mode；setup 以
  `git rev-parse --git-dir` 解析目前 clone 的 hooks 目錄，把 template 內容寫入 `pre-commit` 與
  `pre-push` 並設 `0755`，同時寫入 repo-local `open4wd.commentProfile`，不設定 `core.hooksPath`，
  不觸碰全域 Git 設定。
- template 首行之後帶「# Open4WD 管理的本機註解品質 hook。」標記；setup 與 disable 只覆寫或移除
  缺席、與 template 相同、或帶該標記的 hook，遇到非 Open4WD 的既有 hook 或自訂 `core.hooksPath`
  一律拒絕；舊版 `core.hooksPath=.githooks` 的 clone 由 setup 遷移（unset）。disable 只移除自有
  wrapper 並清除 profile。
- 主 repo 與 pinning、signaling、TURN 三個 Template 採同一設計；各 repo 的 setup 測試須涵蓋
  idempotent、legacy migration、marked upgrade、disable-only-owned、refuse custom／occupied 與
  POSIX 可執行位斷言。
- 其餘規則沿用 D-20260815-02：pre-commit 只讀 Git index blob、pre-push 跑全庫、缺 profile 與
  Git／parse／blob 錯誤一律 fail closed、profile 語意與官方 CI 定位不變。

## 後果與影響

fresh clone 或重建 `.git` 後可直接 commit、push、跑 CI，只有想啟用本機 hooks 時才執行一次
setup；版控不再攜帶平台相關的可執行位，CI 也不必再守門 tree mode。代價是 hook 內容在 setup 時
複製到 `.git/hooks`，template 更新後需重跑 setup（setup 對帶標記的舊 wrapper 會直接升級）。本決策
只修訂 D-20260815-02 的 hook 安裝機制，不改變其註解品質規則、profile 與 PR 流程。
