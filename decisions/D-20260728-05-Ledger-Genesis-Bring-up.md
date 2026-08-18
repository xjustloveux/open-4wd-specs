---
id: D-20260728-05
date: 2026-07-28
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260524-01", "D-20260713-01"]
domains: ["共識帳本", "版本部署"]
sources: ["2026-07-28 Ledger genesis 與 replica bring-up"]
files: ["部署資訊/部署實際值與初始拓撲.md", "程式架構/ledger.md"]
vectors: []
deprecates: []
---

# D-20260728-05｜Ledger genesis 與 replica bring-up

## 背景與驅動力

既有裁決已釘死正式鏈身分來自 `open4wd-ledger` 首次建立後的 exact OrbitDB address，卻未指定誰執行、如何留存、何時啟動 replica，以及失敗時是否可以重建。正常 pinning service 又必須先取得 `LEDGER_DB_ADDRESS`，因此需要把「一次性建立」與「日常複寫」分成兩條明確入口。

## 考慮過的選項

- 由瀏覽器 development island 或正常 service 在缺 address 時自動建庫：會依本機身分建立不同 island，否決。
- 把 genesis 當正常 service 的啟動 flag：容易在設定遺漏或重啟時誤建新鏈，否決。
- 由 pinning repo 提供獨立 one-shot operator，產生可稽核 receipt 後才啟動 replica：採納。

## 決定

- 官方維護者在 private bring-up 階段，以 `open-4wd-pinning` 的獨立 one-shot command 建立唯一 `open4wd-ledger`；瀏覽器與正常 service 都不是 genesis authority。
- Genesis 必須使用專用、持久且已備份的 libp2p identity 與資料目錄；治理 signer 僅接受 1 個或至少 3 個 distinct canonical PeerId，2 個一律拒絕。
- Command 至少需要一個明示 listen multiaddr，並輸出不含 secret 的 version-1 receipt：exact ledger address、database name/type、access-controller contract、genesis PeerId、排序後 signer、建立時間與 release commit。
- Receipt 與資料目錄都必須是空白的新目標；已存在 receipt、未識別資料或部分部署一律 fail closed，不自動覆蓋或刪除。
- 啟動順序固定為：完成本機優化與 public specs → private main → 發布週邊 repo 並修正整合問題 → one-shot genesis → 保存 receipt 並填入正式設定 → genesis provider 保持可達 → 以不同 identity／空資料目錄啟動 replica 並驗證 exact address → 啟動其餘 provider → 最後才公開 main client。
- 正常 pinning service 繼續硬性要求 `LEDGER_DB_ADDRESS`，不得 fallback 到 database name。

## 復原規則

- Verified receipt 產生前失敗：不得把任何候選 address 填入 client 或 replica；保留現場供人工判讀。
- Receipt 已存在但 replica 尚未同步：使用同一 identity 與資料目錄恢復 genesis provider，不得再依名稱建立替代鏈。
- 所有 provider 在公開活動前不可逆遺失：視為 launch 失敗，需人工記錄後以新 address 重新開始。
- Public 活動開始後不得靜默換鏈；任何遷移另走治理與版本升級裁決。

## 後果與影響

Repo 建置仍不依賴 runtime address，不形成 main 對週邊 repo 的反向依賴；只有正式 service 啟動與 client activation 依賴 genesis receipt。Receipt 可公開，identity 私鑰、seed、token 與憑證不得寫入 receipt 或 log。
