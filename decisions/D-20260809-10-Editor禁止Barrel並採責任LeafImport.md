---
id: D-20260809-10
date: 2026-08-09
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["治理營運"]
sources: ["2026-08-09 ─ Editor 禁止 Barrel 並改採責任 Leaf Import（issue 000264）"]
files: ["程式架構/editor.md", "程式架構/toolchain.md"]
vectors: []
deprecates: []
---

# D-20260809-10｜Editor 禁止 Barrel 並採責任 Leaf Import

## 背景與驅動力

Editor 同時包含 browser UI、lazy chunk、Worker 與 Node-only 壓縮葉檔。統一從 `src/editor/index.ts`
barrel 匯入會讓瀏覽器 bundler 解析不屬於該 consumer 的 Node-only dependency，即使實際沒有呼叫也
可能擴大 chunk 或直接建置失敗。

## 考慮過的選項

- 保留單一 barrel 並以 lint 強制跨模組使用：入口一致，但會擴大 browser chunk 並混入 Node-only 依賴。
- 移除 Editor barrel，consumer 按責任 leaf-pick，共享型別下沉到 leaf type module：採納。

## 決定

Production 與測試 consumer 不得 import `src/editor/index.ts`；跨模組依責任直接引用 leaf module，
共享型別放入不帶 runtime dependency 的 leaf type module。Import-boundary gate 同時要求 retired
barrel 實體不存在、production 與 tests 都沒有 consumer。Browser、Worker 與 Node-only 邊界不得
再由方便入口重新混合。

## 後果與影響

匯入路徑較長，但每個 consumer 的環境與 chunk 依賴可被靜態驗證。新增 Editor 能力時必須先選擇
責任 leaf 與執行環境；不得以重建 barrel 解決 discoverability，導覽責任留給 canon 與檔案結構。
