---
id: D-20260805-01
date: 2026-08-05
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260803-04"]
domains: ["UGC版權", "版本部署", "資安"]
sources: ["2026-08-05 第一層 Provider-scoped Inbox"]
files: ["程式架構/inbox.md", "程式架構/dmca.md", "流程/DMCA.md", "程式架構.md", "流程/玩家整體旅程.md"]
vectors: []
deprecates: []
---

# D-20260805-01｜第一層 Provider-scoped Inbox 與本機最小快照

## 背景與驅動力

D-20260803-04 已決定由 client 對玩家選定的 provider 查詢私有簽章收件匣，但當時只有短暫
toast 與 `/dmca` deep link。Toast 關閉後沒有固定入口、未讀或可重開案件；重新整理、lock、
跨分頁登出與 PeerId 切換也缺少完整隔離契約。

## 考慮過的選項

- 把私有案件嵌入公開 `/dmca`：混合 Notice／Counter-Notice 表單與身分私有清單，否決。
- 新增二層 `/dmca/inbox`：與既有 Player 導覽全為第一層目的地的資訊架構不一致，否決。
- 建立全域通知中心並聚合所有 provider：會暗示共同 authority，且超出目前真實來源，否決。
- 新增第一層 `/inbox`，以真實來源 tab、provider-scoped 查詢、本機已讀與 signed stale
  snapshot 組成持久 client 入口（採納）。

## 決定

- `/inbox` 是受解鎖 guard 保護的第一層 Player route；目前只有 `dmca` tab。公開 `/dmca`
  繼續只負責 Notice／Counter-Notice 表單，案件 action deep-link 回該表單。
- `InboxCoordinator` 聚合 `InboxSource`，但 item、錯誤、retry、來源 label 與 action 始終保留
  provider 邊界。主 repo 不提供預設 provider、官方 Inbox、全域案件清單或跨 provider 裁決。
- 已讀只存在本機，以 PeerId＋kind＋providerId＋itemId 對應 read `updatedAt`；只有開啟個別
  item 才標記。Toast dismiss、進 Inbox 或切 tab 都不算已讀。
- 本機只保存最後一次驗證通過的 provider signed envelope、`receivedAt` 與最小 read marker；
  不保存 provider URL、通知雙方聯絡資料、法律敘述或人類簽名。密碼學簽章必須保留以便離線
  重驗，且 snapshot 不跨裝置、不回寫 provider、不進 Ledger。
- Live response 走 exact schema、provider／subject 綁定、簽章、五分鐘 freshness 與 nonce replay
  guard；cache 走相同 schema／綁定／簽章，但不套 live freshness、不污染 replay guard，只能
  標示 stale。成功 live response 取代 cache，空成功 response 刪除，失敗保留舊 snapshot。
- 未解鎖不讀 snapshot、不查 provider、不顯示 badge。每次 bind identity 都增加 session epoch、
  abort 舊請求並立即清空 UI／badge／toast；所有 async 完成點在寫入前重驗 epoch＋PeerId＋
  refresh id，遲到 response 不得跨身分生效。
- Unlock 立即更新；進 Inbox 超過一分鐘、回前景超過五分鐘、前景連線每 30 分鐘加 ±10%
  jitter、provider／watch target 改變及手動操作會更新。Provider 失敗採 1／5／15／60 分鐘
  backoff，單點失敗不遮蔽其他來源。
- 同輪新項目由 Inbox 合併為單一摘要 toast；位於對應 tab 時只更新清單、badge 與 aria-live。
  `taken_down` 只有在 provider 可用且沒有 litigation hold 時才提供 Counter-Notice 準備入口。
- 統一 IndexedDB `open-4wd` 使用 `UNIFIED_DB_VERSION = 2`，新增 `inbox-snapshots` 與
  `inbox-read-markers`；持久化失敗退化記憶體並明示警告。

## 後果與影響

玩家關閉 toast 後仍可從第一層 Inbox 找回案件；離線時可讀最後一次已驗的最小 stale 狀態，
但不能把它當成 provider 仍在線或提交成功。Lock 與身分切換會立即撤銷敏感畫面，而一般登出
不刪除原 PeerId 的本機快照；刪除 profile 或清除網站資料才清除持久狀態。

本決策補足 D-20260803-04 的 client 生命週期，不改變其 provider 自治、無全域下架、無官方
節點與案件個資不得進公開資料面的結論。
