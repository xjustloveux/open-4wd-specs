---
id: D-20260524-03
date: 2026-05-24
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["建模物理"]
sources: ["2026-05-24 Critical 10 項回填"]
files: ["程式架構.md", "程式架構/physics-engine.md"]
vectors: []
deprecates: []
---

# D-20260524-03｜`DeterministicWorld` 介面＋Rapier 版本鎖定

## 背景與驅動力

平行掃描 project-resources 舊 spec 三十六份、整理 50+ 項缺漏後的 Critical 10 項回填之一：物理引擎當時沒有明文介面契約，引擎版本升級對模擬行為的影響也無規範——P2P 對戰下，任何引擎行為差異都是跨 peer desync 與共識分歧的直接來源。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以缺漏回填形式成立。）

## 決定

- 定義 **`DeterministicWorld` 介面**：`step`／`snapshot`／`restore`／`computeChecksum`／`engineVersion` 五方法，物理世界一律經此契約驅動。
- **Rapier 版本鎖定**：引擎升級受控，**major bump 視同 protocol bump**。介面現況見 [程式架構/physics-engine.md](../程式架構/physics-engine.md)。

## 後果與影響

決定性自此有了介面層錨點：快照 checksum、rollback、共識層驗算全掛在 `computeChecksum`／`engineVersion` 之上。同軸延伸：接觸係數合成不變式（[D-20260609-01](D-20260609-01-接觸係數合成不變式.md)）把決定性從介面層推進到參數層，決定性紀律（[D-20260707-01](D-20260707-01-決定性紀律.md)）再收束為全專案守則。
