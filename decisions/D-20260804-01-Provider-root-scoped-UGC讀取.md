---
id: D-20260804-01
date: 2026-08-04
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260728-03", "D-20260803-04", "D-20260803-06"]
domains: ["UGC版權", "版本部署", "資安"]
sources: ["2026-08-04 ─ Provider root-scoped UGC 讀取與通用供應面隔離"]
files: ["程式架構/pinning-service.md", "程式架構/interfaces.md", "版權.md", "部署資訊/open-4wd-pinning.md"]
vectors: []
deprecates: []
---

# D-20260804-01｜Provider root-scoped UGC 讀取與通用供應面隔離

## 背景與驅動力

既有 provider descriptor 能宣告 UGC read disabled，DMCA 流程也能 unpin root，但公開 Kubo
gateway 與通用 Bitswap request 都只看 block CID，不知道該 block 是從哪個 UGC root 走到的。
因此能力開關、下架狀態與共享 child 的合法 root context 無法在實際供應面執行。

## 考慮過的選項

- 只靠 Cluster unpin 與 Kubo GC：有 cache／GC 延遲，也無法阻止 direct child request，否決。
- 公開通用 gateway，再用 root deny list 猜 child 歸屬：request 沒有 root context，共享 block
  無法安全判定，否決。
- 由 app 擁有 root-scoped block API，隔離通用 UGC Bitswap／gateway（採納）。

## 決定

- Provider HTTP fallback 的每個 block request 必須攜帶 UGC root；app 以目前 pin root 的完整
  traversal index、能力開關與 deny policy 做 fail-closed 判定。
- 同一 child 可屬多個 roots；一個 root 下架只撤銷該 root context，不破壞其他仍合法 root。
- 公版不公開 Kubo gateway／RPC，Kubo 不加入 public routing。另開 generic IPFS 節點屬 operator
  的獨立供應面，不能宣稱受 provider descriptor 或案件流程控制。
- App 公共 Bitswap store 只保存 ledger blocks。Pin ingestion 從 mesh 取得的 UGC 不回填該
  store，直接送內部 Kubo；開發期直接使用新的 ledger-only storage 目錄，不做 migration。
- D-20260728-03 的本機與玩家 Bitswap 優先仍保留；只把最後一段 provider HTTP fallback 從 raw
  gateway 改成 root-scoped API。現行契約見 [pinning-service.md](../程式架構/pinning-service.md)。

## 後果與影響

`ugc_read` 現在是可執行能力而不只是宣告；成功 unpin 後，即使 Kubo 尚未 GC，provider API 也
不再供應該 root。Client 與後續 multi-block 下載必須保留 root context。若 operator 額外公開
generic IPFS，相關供應與法遵邊界不會由本協定代為承擔。
