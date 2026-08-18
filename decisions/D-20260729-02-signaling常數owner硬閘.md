---
id: D-20260729-02
date: 2026-07-29
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260725-08"]
domains: ["治理營運"]
sources: ["2026-07-29 文檔工程：signaling 常數改採 owner hard gate"]
files: ["程式參數.md"]
vectors: []
deprecates: []
---

# D-20260729-02｜signaling 常數改採 owner hard gate

## 背景與驅動力

[D-20260725-08](D-20260725-08-常數表硬比對閘.md) 的 comparator 只掃主 repo
`system-constants`；[程式參數.md 第 9 節](../程式參數.md) 的四個 signaling server
常數實作於獨立公版 repo，因此一直被歸為預期 table-only 缺口。人工核對雖然一致，單邊改值
仍沒有機器訊號。

## 考慮過的選項

- 由 Specs 生成或 vendor runtime 常數：會推翻文件表達力與 TypeScript 型別／fail-fast
  表達力並存的雙手編決策，且 derived runtime artifact 自身成為新漂移面，棄。
- 維持人工同步：沒有可重跑證據，無法解決原本的單邊修改風險，棄。
- 擴充主 repo checker 並由 main 集中 checkout signaling：會讓 GitHub Actions 形成
  main＋signaling＋Specs 的跨 implementation repo 耦合，棄。
- 由 signaling repo 擁有 comparator，只消費 pinned／sibling Specs（採納）。

## 決定

- `open-4wd-signaling` 提供獨立 `check:constants`，只比對 `RATE_LIMIT_PER_MIN`、
  `PEER_TIMEOUT_MS`、`REGISTER_DEADLINE_MS`、`MESSAGE_RATE_LIMIT_PER_MIN`。
- Specs 路徑可由 `O4_SPECS_DIR` 注入；本機未指定時使用 sibling `open-4wd-specs`。Specs
  文件缺席時 fail closed，不讀 live branch 或 remote raw。
- 延續 D-20260725-08 的閘語意：兩側有值但數值不同才 hard fail；命名覆蓋缺口列報不紅。
  comparator 不生成、不修改、不 vendor runtime 常數。
- 本階段不接 GitHub Actions，以維持公版 template 的 standalone 測試。待 Specs 公開並取得
  immutable commit SHA 後，signaling CI 只 checkout 自身與 pinned Specs。

## 後果與影響

四個 server default 的單邊改值可在本機 workspace 立即轉紅，且 normal signaling unit tests
不因 Specs 缺席而失去 standalone 能力。正式 CI 上線後也只增加一個 immutable Specs
dependency，不需要 main 或其他 implementation repo。

代價是 comparator 與 package command 必須由 signaling repo 維護；immutable Specs checkout
啟用前，它仍是顯式本機 gate，而非公版 GitHub Actions gate。
