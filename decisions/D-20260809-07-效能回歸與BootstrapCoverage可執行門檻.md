---
id: D-20260809-07
date: 2026-08-09
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260712-02"]
domains: ["治理營運"]
sources: ["2026-08-09 ─ 效能回歸與 Bootstrap Coverage 改採可執行門檻（issues 000300、000301）"]
files: ["程式架構/testing.md", "程式架構/程式流程/testing.md", "程式架構/toolchain.md"]
vectors: []
deprecates: []
---

# D-20260809-07｜效能回歸與 Bootstrap Coverage 可執行門檻

## 背景與驅動力

共享 CI runner 沒有固定 CPU、OS、runtime 與 power mode，卻曾把產品毫秒目標寫成可阻擋 release
的承諾；同時規範列出若干 per-module coverage 數字，實際 runner 並未逐模組執行。兩者都會讓文件
看似嚴格、實際證據卻不可重現或根本沒有執法點。

## 考慮過的選項

- 固定產品毫秒作 release hard gate：目標直接，但共享 runner 未固定時容易誤判。
- 固定值降為診斷，release 改跑校準相對 regression gate：保留可執行防線，採納。
- Bootstrap exclusions 只補文件，或改由獨立 coverage gate 接管：採後者；未執法的 per-module 數字移除。

## 決定

共享 runner 的效能 hard gate 使用校準 reference：相對惡化 10% 警告、25% 失敗；固定產品毫秒與
`meetsProductTarget` 僅供診斷，直到有可重現參考環境才可另行升格。Release readiness 必須執行
performance suite。Bootstrap adapters 以獨立 runner 量測正式 bootstrap specs，門檻為 statements
50%、branches 45%、functions 35%、lines 50%；未執法的 per-module 數字移除，純 re-export barrel
才可維持無行為排除。

## 後果與影響

Release gate 只宣稱它實際能重現與執行的證據。固定值仍能提示產品目標偏離，卻不因共享硬體
波動阻斷；bootstrap 關鍵 adapter 不再躲在聚合 coverage 後，任何排除都必須有可執行接管者。
