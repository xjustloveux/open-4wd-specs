---
id: D-20260725-04
date: 2026-07-25
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260716-01"]
domains: ["版本部署", "比賽房間"]
sources: ["2026-07-25 正式上線、本機離線與連線測試標準確認"]
files: ["部署資訊.md", "程式架構/pwa-offline.md", "程式架構/interfaces.md"]
vectors: []
deprecates: []
---

# D-20260725-04｜正式 build 可選 runtime 測試策略

## 背景與驅動力

[D-20260716-01](D-20260716-01-連線狀態機離線能力.md) 已定義唯一連線狀態機、
`local-ready` 能力與線上能力 fail-closed，但尚未定義如何在本機及已部署的同一份 build
中，確定性地選擇純離線、強制連線或正式自動降級路徑。E2E 若以啟動時序或暫時攔截網路
來推測狀態，可能在瀏覽器已完成連線後才斷網，形成競態與假陰性。

## 考慮過的選項

- 以不同 build／environment 檔分離離線與連線測試：容易讓測試產物偏離正式產物，棄。
- 只靠瀏覽器網路攔截與連線時序：不能保證 network assembly 尚未啟動，棄。
- 同一份 build 以不持久化的 URL query 明示 launch policy（採納）。

## 決定

- `?runtime=local` 強制不啟動 network assembly，只建立 storage-only `local-ready`。
- `?runtime=network` 要求 network assembly 成功；失敗時登入嘗試 fail-closed，不自動假裝
  online，也不降級成測試成功。
- 省略 query 或 `?runtime=auto` 是正式預設；連線失敗時依既有能力模型安全降級
  `local-ready`。
- 未知值、重複的 `runtime` 參數或內部 policy 名稱一律視為 `auto`。
- runtime query 只控制本次啟動，不寫入玩家設定、IndexedDB 或其他持久資料，也不得改變
  D-20260716-01 的能力閘。

## 後果與影響

本機與已上線網站可使用完全相同的 production 行為驗證純離線、強制連線及正式自動降級；
E2E 不再依賴瀏覽器與 transport 的競速。公開 URL 多出測試控制面，因此所有非公開 policy
值均 fail-safe 回到 `auto`，且不得成為繞過線上能力閘的入口。操作權威見
[部署資訊.md](../部署資訊.md)。
