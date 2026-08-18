---
id: D-20260813-01
date: 2026-08-13
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260706-02"]
domains: ["治理營運", "版本部署"]
sources: ["2026-08-13 註解語言與公開 Template CI 劃界"]
files: ["程式架構.md", "部署資訊/open-4wd-pinning.md", "部署資訊/open-4wd-signaling.md", "部署資訊/open-4wd-turn.md"]
vectors: []
deprecates: []
---

# D-20260813-01｜註解語言與公開 Template CI 劃界

## 背景與驅動力

主 repo 已依繁體中文註解規範完成清理並接入 strict CI；三個 service repo 則依
[D-20260706-02](D-20260706-02-週邊repo-Template化.md) 供第三方 use-template／fork 後自行部署。
若將維護者的繁中偏好複製為可攜式 CI 或部署前置，非繁中營運者即使沒有功能、安全或設定錯誤，
仍會因註解語言而無法維持自己的部署。

## 考慮過的選項

- 四 repo 全部使用繁中硬閘：一致但把官方維護偏好誤作第三方部署契約，否決。
- 全部移除語言檢查：fork 最自由，但主產品已核准的維護規範失去自動看守，否決。
- 官方主 repo 保留繁中硬閘，公開 Template 與部署路徑採語言中立（採納）。

## 決定

- 主 repo 的註解品質與繁中語言檢查拆開；只有官方上游執行繁中 strict gate，fork 的建置不受該語言政策阻擋。
- Pinning、Signaling、TURN 不把註解語言加入 CI、build 或 deploy 前置。第一方公開註解可使用英文或繁中，營運設定、公開 API 與安全邊界優先採較廣泛可讀的英文。
- Vendor 內容保留來源擁有者的語言與 provenance，不因語言單獨翻譯或建立漂移副本。
- 自足、零失效文檔引用與必要公開 API 說明仍可作為官方上游的語言中立品質規則，但不得成為 fork 部署成功的必要條件。

## 後果與影響

主產品維持既有繁中可讀性，三個公開 Template 則不會把語言能力變成部署權限。官方上游仍可在
review 中維持 API 文件品質；第三方 fork 只需通過格式、型別、測試、安全與設定等功能契約。
既有週邊 repo 英文註解不再構成待清理缺陷，日後也不得把語言檢查藏入聚合的 test／build／deploy 指令。
