---
id: D-20260705-02
date: 2026-07-05
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["治理營運"]
sources: ["2026-07-05 美術資源.md 資料夾總複審"]
files: ["版權.md", "美術資源.md", "程式架構/seo.md"]
vectors: []
deprecates: []
---

# D-20260705-02｜開源 License 定案 MIT

## 背景與驅動力

License 長期處「待選」狀態；美術資源與資料夾總複審輪一併把授權面收口——待選拖越久、drift 越多，seo 的 JSON-LD 已在待選期間硬編了錯值。

## 考慮過的選項

（流水帳未記錄替代方案；本決策以修正 ／ 收斂 ／ 翻案形式成立）——License 由「待選」經使用者直裁 MIT。

## 決定

- **開源 License＝MIT**：主 repo 與週邊 repo 各附 `LICENSE`；turn repo 的 coturn 本體維持上游 BSD 引用。權威 ＝ [版權.md](../版權.md)、[美術資源.md](../美術資源.md) 鏡像。
- 順修既有 drift：[程式架構/seo.md](../程式架構/seo.md) 的 JSON-LD `license` 硬編 `Apache-2.0` 錯值改 MIT、引授權權威。
- 同輪順帶：動畫視覺時長權威收斂為 design token `--anim-*`（名錄與預設值權威 ＝`themes/default/theme.json`、設計級距表 ＝ [ui-frontend.md](../程式架構/ui-frontend.md)），程式參數表僅留動畫行為常數。

## 後果與影響

授權面單一定案、終結「待選」漂移源；營運模式評估（[D-20260706-01](D-20260706-01-營運模式捐助制.md)）以「MIT 明文允許營利且雙向（任何 fork 亦可）」為前提展開。
