---
id: D-20260804-04
date: 2026-08-04
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260706-02", "D-20260803-03", "D-20260803-06"]
domains: ["版本部署"]
sources: ["2026-08-04 ─ Pinning Template 資源政策（issue 000162）"]
files: ["部署資訊/open-4wd-pinning.md", "程式架構/pinning-service.md"]
vectors: []
deprecates: []
---

# D-20260804-04｜Pinning Template 資源政策

## 背景與驅動力

公開 Pinning template 無法替所有 operator 預設同一組 CPU／RAM 限制；硬編數值會讓小型部署無法
啟動，也會讓大型部署誤把示例當容量保證。另一方面，完全不提供 sizing 與故障注入路徑，會讓
operator 無法依自己的 DAG、流量、儲存與節點拓撲建立可驗證配置。

## 考慮過的選項

- base 直接固定 requests／limits：部署最省步驟，但把示例值誤表達成通用容量保證。
- 完全不提供 sizing、量測或故障注入指引：保持中立，卻把失效模式與資源責任隱藏給 operator。
- base 保持 overlay-only，另提供可複製 sizing、量測與故障注入範例：採納。

## 決定

Compose 與 Kubernetes base 不硬編 CPU／RAM requests／limits；以選配 override／overlay、量測方法、
故障注入與 app-level storage／DAG hard bounds 表達相同責任邊界。兩種部署面必須清楚區分公版
base、operator 自選 overlay 與經實測取得的部署值，不能把範例值冒充專案保證。

## 後果與影響

此決策延續公開 template 與全面社群化模型；公版可攜性不再以假容量數字交換。Kubo routing、
generic block 供應面與 root-scoped policy 的既有決定仍由
[D-20260804-01](D-20260804-01-Provider-root-scoped-UGC讀取.md) 單獨承載，本決策不重複建立第二個權威。
