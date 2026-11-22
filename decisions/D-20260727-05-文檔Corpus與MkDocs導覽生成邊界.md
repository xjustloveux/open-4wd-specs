---
id: D-20260727-05
date: 2026-07-27
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260724-04"]
domains: ["治理營運"]
sources: ["2026-07-27 ─ 文檔 corpus 與 MkDocs 導覽生成邊界（issues 000033、000034）"]
files: ["文檔工程.md", "scripts/build-site.mjs", "scripts/lib.mjs", "mkdocs.yml"]
vectors: []
deprecates: []
---

# D-20260727-05｜文檔 Corpus 與 MkDocs 導覽生成邊界

## 背景與驅動力

MkDocs 原先依 Unicode 檔名自動排序，且把同名檔案與資料夾分列，造成中文導覽次序不穩定與
入口重複。初版修正另依 domain 重組站台並讓 `README.md` 參與 corpus，反而改寫既有目錄分類、
與 [總覽](../總覽.md) 爭奪首頁，並讓 repo 說明混入文檔權威。

## 考慮過的選項

- 依 domain 重新分組並以 `README.md` 為首頁：導覽看似整齊，但破壞 corpus 原有目錄分類與首頁權威。
- 手寫完整 MkDocs nav：可精確控制，卻會形成需人工同步的第二份導覽權威。
- 鏡射 corpus 目錄、由 frontmatter type 排序並排除 repo 管理檔：保留既有分類且可自動驗證，採納。

## 決定

站台導覽鏡射 corpus 實際目錄；同名 `X.md` 是 `X/` 段落入口，根層與段內按 frontmatter type，
同型別按 `zh-Hant` 排序。首頁固定由 [總覽](../總覽.md) 產生；根層 `README.md` 是 repo 管理檔，
不屬 corpus、生成索引或 MkDocs 內容，但仍接受適用的 repository lint。

## 後果與影響

此決策細化 [D-20260724-04](D-20260724-04-corpus-frontmatter與生成式索引.md) 的生成式索引模型，
並保留 [D-20260722-02](D-20260722-02-檔名維持中文與slug預留.md) 的中文檔名可導覽性。
導覽不再靠 Unicode 偶然排序或人工 nav；新增、移動文檔時必須維持 frontmatter 與目錄責任一致。
