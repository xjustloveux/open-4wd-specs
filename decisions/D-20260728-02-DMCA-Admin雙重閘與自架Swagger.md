---
id: D-20260728-02
date: 2026-07-28
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260706-04", "D-20260720-01", "D-20260724-01"]
domains: ["UGC版權", "版本部署", "資安"]
sources: ["2026-07-28 DMCA Admin 雙重閘與自架 Swagger"]
files: ["程式架構/dmca.md", "部署資訊/open-4wd-pinning.md", "流程/DMCA.md"]
vectors: []
deprecates: []
---

# D-20260728-02｜DMCA Admin 雙重閘與自架 Swagger

## 背景與驅動力

原設計以單人 curl／Postman 搭配 Bearer token 為維運面，但正式部署後仍缺 origin 隱藏、
MFA、瀏覽器操作面與個資最小揭露。實作甚至在 token 缺席時生成不輸出的隨機值，形成看似
啟用、實際無法管理的狀態；Admin 列表也直接回完整案卷，狀態轉移與操作者稽核未封閉。

## 考慮過的選項

- 只保留 Bearer API：自架簡單，但官方人工作業缺少身分／MFA 外層與安全瀏覽器入口——否決。
- 為人工裁決開 Cloudflare Service Auth：適合機器，不具人員 MFA，且會弱化責任歸屬——否決。
- 立即製作完整 Admin SPA：需求目前只涵蓋少量 API 操作，維護成本過早——否決。
- 公版選配 self-host Swagger；官方用 Access／MFA＋Tunnel＋應用 Bearer 雙重閘——採納。

## 決定

`DMCA_ENABLE=true` 時 `DMCA_ADMIN_TOKEN` 必填，缺席即 fail-fast。Admin 資料面採有界摘要列表
加單案詳情，排除 confirm token，封閉 action／status 矩陣、reason 與 operator 稽核。
公版提供 self-host OpenAPI 與預設關閉的 Swagger；官方以 `dmca.open4wd.org` 同 origin 的
`/admin/*`、`/api/dmca/admin/*` 套 Cloudflare Access 身分／MFA、Tunnel 與應用 Bearer，
且不得預載或持久化 token。操作契約與步驟見 [DMCA 流程](../流程/DMCA.md)與
[open-4wd-pinning 部署規格](../部署資訊/open-4wd-pinning.md)。

## 後果與影響

官方 origin 不直接暴露，人工裁決同時需要人員身分與應用 secret；Swagger 提供可檢查的
低成本操作面，未膨脹成完整管理產品。社群自架仍可只用 Bearer，Cloudflare 元件全部選配；
DMCA 收件所需 SMTP 仍是功能依賴，不因 Admin 邊界改變。本決策細化早期 curl／Postman 與
pinning 部署裁決，實作追蹤於 issue `000046`。
