---
id: D-20260813-03
date: 2026-08-13
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260809-02"]
domains: ["資安", "版本部署"]
sources: ["2026-08-13 Specs CI 外部 Action 不可變鎖定"]
files: [".github/workflows/docs-ci.yml", "scripts/check-workflows.mjs", "package.json", "文檔工程.md"]
vectors: []
deprecates: []
---

# D-20260813-03｜Specs CI 外部 Action 不可變鎖定

## 背景與驅動力

Docs CI 的 pnpm dependency 由 lockfile 鎖定，但 workflow 直接以 major tag 載入三個外部 GitHub
Actions。Tag 被改指時，runner 會執行不同程式碼；`contents: read` 只能縮小 token 權限，不能讓
執行內容不可變。週邊部署 workflow 已採完整 commit SHA，Specs CI 卻沒有相同 guard。

## 考慮過的選項

- 保留 major tag 並只依賴最小權限：更新方便，但供應鏈程式仍可在 repo 未變時改變，棄。
- 只把目前三行人工換成 SHA：解除當下風險，日後新增 Action 仍會復發，棄。
- 完整 SHA 加 repo 內 workflow policy checker，版本更新連同 SHA 一起審查（採納）。

## 決定

- Specs 所有 workflow 的外部 `uses:` 必須鎖 40 位 commit SHA；repo 內 `./` Action 不受此限。
- Docs CI 現有 checkout、pnpm setup 與 Node setup 使用 workspace 已驗證的完整 SHA，並保留版本
  註解供維護者辨識。
- `check:workflows` 加入 `pnpm check` 與 Docs CI；mutable tag 一律 fail closed。

## 後果與影響

Specs CI 執行的外部 Action 版本只會在 repo 變更並通過審查時更新，不再隨 tag 改指漂移。
代價是升版必須同步查核新 SHA；版本註解只供閱讀，真正執行權威是 immutable commit。
