---
id: D-20260824-01
date: 2026-08-24
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260811-17"]
domains: ["版本部署", "資安", "治理營運"]
sources: ["2026-08-24 ─ Pre-launch 公開 Q&A 延後至 Main（issue 000825）"]
files: ["專案生命週期.md", "資安規範.md", ".github/ISSUE_TEMPLATE/config.yml", ".github/ISSUE_TEMPLATE/docs.yml"]
vectors: []
deprecates: []
---

# D-20260824-01｜Pre-launch 公開 Q&A 延後至 Main

## 背景與驅動力

Specs 與三個 service template 已先行公開，但 Main 仍是 private。公開 repo 的 Issue Forms 若連到
Main Discussions，未獲 Main 權限的讀者會遇到不可達入口；Specs 自行開 Discussions 又會在 Main
公開後留下兩套一般問答入口。安全通報則不能跟著一般問答關閉，仍須提供公開可讀的私密通報說明。

## 考慮過的選項

- 連 Main Discussions 並等待 Main 公開：設定最少，但 pre-launch 公開讀者實際無法使用，否決。
- Specs 與各 service repo 各自開 Discussions：立即可用，但分散問答、搜尋與維護責任，否決。
- Main 保留 private 協作者用 Discussions，公開 Q&A 延後到 Main public，再由所有 repo 集中導流；
  安全通報獨立維持（採納）。

## 決定

Pre-launch 時不提供公開一般 Q&A：Specs、pinning、signaling、TURN 的 Discussions 關閉，Issue Forms
不顯示 Discussions contact link。Main 可在 private 階段保留 Discussions，供已獲權限的協作者整理，
但不把它描述為公開入口。Main 轉為 public 時，啟用其可回答的 `Q&A` 分類，並一次同步五個 repo 的
一般問題 contact link。安全通報全程獨立存在，公開 repo 指向公開 Specs 安全 canon，並在受影響的
repo 使用 Private Vulnerability Reporting。

## 後果與影響

Pre-launch 公開讀者不再看到 404 或分散的問答入口；代價是 Main public 前不提供一般諮詢管道。
安全弱點仍有私密通報路徑。Main visibility 轉換新增一項不可漏的同步工作，現行操作與時序由
[專案生命週期.md](../專案生命週期.md) 承接，安全管道由 [資安規範.md](../資安規範.md) 承接。
