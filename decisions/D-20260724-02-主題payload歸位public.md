---
id: D-20260724-02
date: 2026-07-24
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260704-01"]
domains: ["前端主題"]
sources: ["2026-07-24 主題部署 payload 歸位 public"]
files: ["主題系統.md", "程式架構/themes.md", "版本規範.md"]
vectors: []
deprecates: []
---

# D-20260724-02｜主題部署 payload 歸位 public、src 僅留程式與治理 metadata

## 背景與驅動力

主題資源原以「完整主題包放 `src/themes/<id>/`、由 Angular 特殊 assets copy 複製出貨」的目錄安排交付。這使部署 payload 與程式源混居：分類（`categories.json`）與退役名單（`retired-ids.json`）這類治理 metadata 被一併帶進公開部署目錄，Angular 也需要為 `src/themes` 維持特例複製規則。

## 考慮過的選項

- 維持 `src/themes/<id>/` 完整主題包 ＋Angular 特殊複製：現狀，治理 metadata 外洩到部署目錄、build 特例長存。
- payload 歸位 `public/`（採納）：部署面與程式面按 Angular 慣例自然分離。

## 決定

- `default` 與正式非 Default 主題的 `theme.json`、`theme.css`、WebP／SVG／ 音訊改住 `public/assets/themes/<id>/`；移除 Angular 對 `src/themes` 的特殊 assets copy；執行期 URL 維持 `/assets/themes/<id>/…` 不變。
- `src/themes/` 僅保留 `ThemeService`、stylesheet loader、測試、`categories.json`、`retired-ids.json` 與生成式 registry；分類與退役名單不進公開部署目錄。
- registry generator 以 public manifests 為權威、內建完整 Default manifest 與非 Default 選擇器摘要，source code 不反向 import `public/`；`start`／`build` 在 Angular 編譯前強制重建 registry 與 Default token SCSS，token generator、validator、測試與 canonical 路徑同步調整。

## 後果與影響

取代早期「完整主題包放 `src/themes/<id>/` 再由 Angular 複製」的目錄安排（實作期慣例、無前 ADR），但保留原有 runtime URL、fallback、lazy loading 與 CI 治理語意——對 [D-20260704-01](D-20260704-01-主題系統三件套.md) 的資產目錄敘述屬部分修訂（`amends`），token／manifest／fallback 三件套與 [D-20260723-01](D-20260723-01-主題StyleAPI-v1.md) 的 Style API 契約不受影響。現況見 [主題系統.md](../主題系統.md) 與 [程式架構/themes.md](../程式架構/themes.md)。
