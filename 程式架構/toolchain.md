---
type: impl
domain: []
summary: 正式建置、驗證與測試命令對映，以及目前 CI 執行事實
authority: null
slug: null
---

# 工具鏈與驗證入口

本檔回答「用哪個穩定命令驗證、實作在哪裡、目前由哪個 workflow 執行」。規則本身仍以各領域 canon／ADR 為權威；本檔不複製規則全文。`package.json` 的正式命令是人工與 CI 的共同入口，`.github/workflows/*.yml` 是 current execution 的事實來源，`scripts/architecture-inventory.test.mjs` 對兩者與下表做雙向檢查。

正式入口 selector 收錄 `proof:*`、`build`／`build:*`、`test:*`、`check:*`，以及 `lint`、`format:check`、`themes:validate`、`i18n:validate`、`i18n:usage`、`lighthouse`；`generate:*`、`start`、`watch` 等 mutation／開發 helper 不屬驗證 inventory。current execution 定義如下：

- `ci-required`：至少一個非純排程 workflow 的指定 job 無 step condition 執行該命令。
- `ci-conditional`：非純排程 workflow 只在表列 step condition 成立時執行。
- `scheduled`：只由含 `schedule` trigger 的 workflow 執行。
- `local`：workflow 沒有直接呼叫此 package command；若它被 build 或其他實作內嵌，仍不冒充直接 CI 入口。

「子命令」只列 compound package command 直接呼叫的其他正式入口；Node／Angular／Playwright helper 仍由「主要 entrypoint」表示。workflow evidence 是所有直接呼叫去重後的精確集合。

註解品質另有不納入正式命令 inventory 的回饋層：ESLint 使用同一 AST analyzer；
`comments:hook:staged` 只讀 Git index blob，`comments:hook:full` 掃全庫；
`comments:hooks:setup -- <maintainer|contributor>` 與 `comments:hooks:disable` 只修改 repo-local
Git config，clone／fork 不會自動啟用。workflow issue 的 `處理中 → 已處理` 在任何狀態寫入前，
依 affected repos 執行 maintainer full gate；失敗時 issue 與 claim 均保持不變。這些 helper 不以
`check:*` 命名，避免被誤列成可取代 CI 的正式完成證據。

四個 Node repo 固定使用 `pnpm@11.18.0`，並在 repo-local
`pnpm-workspace.yaml` 明定 `verifyDepsBeforeRun: error`。`pnpm run`／`pnpm exec`
發現 `node_modules` 與 lockfile 不一致時必須直接失敗，不得自動安裝或重建。
只有取得該次精確安裝命令的明確授權後，才可執行 frozen install。直接呼叫既有
`node_modules` 工具入口只供唯讀診斷，且紀錄必須註明已繞過依賴新鮮度檢查。

<!-- toolchain-inventory:start -->
| command | 類別 | 主要 entrypoint／suite | 子命令 | 職責 | canon／ADR | current execution | workflow evidence | 需求 | skip／failure 語意 | target execution | tracked issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `build` | 建置 | Angular production pipeline 與 post-build scripts | check:asset-migrations<br>check:deployment<br>check:production-isolation | public production artifact | [版本規範](../版本規範.md) | `ci-required` | lighthouse.yml#lighthouse<br>release-readiness.yml#release-gate | checkout 與 Node 24 | 任一步非零即失敗 | 維持 | — |
| `build:custom-domain` | 建置 | Angular production custom-domain pipeline | check:asset-migrations<br>check:deployment<br>check:production-isolation | custom-domain Pages artifact | [部署資訊](../部署資訊.md) | `ci-required` | pages.yml#build | public deployment profile | 任一步非零即失敗 | 維持 | — |
| `build:github-pages` | 建置 | Angular GitHub Pages pipeline | check:asset-migrations<br>check:deployment<br>check:production-isolation | subpath Pages artifact | [部署資訊](../部署資訊.md) | `local` | — | public deployment profile | 任一步非零即失敗 | local | — |
| `build:local` | 建置 | Angular development pipeline | check:deployment | 本機完整 artifact | [版本規範](../版本規範.md) | `local` | — | development profile | 任一步非零即失敗 | local | — |
| `build:private-playtest` | 建置 | Angular private-playtest pipeline | check:deployment | 私人測試 artifact | [版本規範](../版本規範.md) | `local` | — | private-playtest profile | 任一步非零即失敗 | local | — |
| `check:announcements` | 生成檢核 | `scripts/generate-announcements.mjs --check` | — | 公告 catalog 無漂移 | [announcements.md](announcements.md) | `local` | — | 公告來源檔 | 漂移即失敗 | local | — |
| `check:asset-migrations` | 生成檢核 | `scripts/generate-asset-migrations.mjs --check` | — | 資產 migration 產物無漂移 | [builtin-assets.md](builtin-assets.md) | `local` | — | builtin 資產 | 漂移即失敗 | 維持由 build compound 執行 | — |
| `check:assets` | 資產檢核 | `scripts/check-builtin-glbs.mjs` | `check:race-message-packs` | shipped GLB 與賽中圖示訊息 pack 完整性 | [builtin-assets.md](builtin-assets.md)<br>[race-messages.md](race-messages.md) | `ci-required` | ci.yml#validate | delivery authority、repository builtin GLB 與賽中圖示訊息 packs | `deferred-prelaunch` 明示回報但非 strict 可繼續；未知狀態、一般缺檔或不合規失敗 | 維持 | #723 |
| `check:authoring-source-adoption` | 資產檢核 | `scripts/check-authoring-source-adoption.mjs` | — | specs／lock／Release 三方 authoring identity | [builtin-assets.md](builtin-assets.md) | `local` | — | public specs lock 與下載後 Release 目錄 | 任一 commit／tag／manifest／asset 漂移即失敗 | specs public 後啟用 adoption template | #519 |
| `check:authoring-source-availability` | 資產檢核 | `scripts/check-authoring-source-availability.mjs` | — | specs sibling authoring source 可用性證據 | [testing.md §4](testing.md) | `ci-required` | ci.yml#validate | main recipe＋specs source manifest | 整個 specs manifest 不存在報 unavailable；部分缺檔或 hash 漂移失敗 | 維持；public 後另由 adoption gate | #519 |
| `check:builtin-authoring` | 測試 | `scripts/builtin-assets/*.test.mjs` | — | Editor recipe、specs source join 與 output 契約 | [builtin-assets.md](builtin-assets.md) | `ci-required` | ci.yml#validate | main recipe＋可用時的 sibling source manifest | test fail 即失敗 | 維持 | #519 |
| `check:builtin-physics-manifests` | 資產檢核 | `scripts/run-builtin-physics-manifests.mjs` | — | builtin physics manifest 可重建 | [builtin-assets.md](builtin-assets.md) | `local` | — | builtin GLB | 不一致即失敗 | local | — |
| `check:comment-language` | 靜態檢核 | `scripts/check-comments.mjs --language-only` | — | 註解語言規則 | [程式架構.md §14](../程式架構.md) | `ci-conditional` | ci.yml#validate @if github.repository == 'xjustloveux/open-4wd' | canonical repository identity | 違規即失敗；條件未成立不是 pass 證據 | 維持條件式 | — |
| `check:comment-quality` | 靜態檢核 | `scripts/check-comments.mjs --quality-only` | — | 註解品質規則 | [程式架構.md §14](../程式架構.md) | `ci-required` | ci.yml#validate | source tree | 違規即失敗 | 維持 | — |
| `check:comments` | 靜態檢核 | `scripts/check-comments.mjs --strict` | — | 完整註解規則 | [程式架構.md §14](../程式架構.md) | `local` | — | source tree | 違規即失敗 | local | — |
| `check:community-registry` | 資料檢核 | `scripts/check-community-registry.ts` | — | community provider registry schema | [pinning-service.md](pinning-service.md) | `local` | — | registry sources | 不合規即失敗 | 維持由 test:scripts compound 執行 | — |
| `check:constants` | 規格追蹤 | `scripts/check-constants.mjs` | — | spec 與常數宣告對齊 | [system-constants.md](system-constants.md) | `local` | — | sibling specs repo | 漂移即失敗 | 由 test:scripts compound 執行 | #62 |
| `check:deployment` | 部署檢核 | `scripts/check-deployment.mjs` | — | deployment profile 邊界 | [部署資訊](../部署資訊.md) | `ci-required` | pages.yml#build<br>release-readiness.yml#release-gate | profile argument | 設定不合規即失敗 | 維持 | — |
| `check:duplicates` | 靜態檢核 | `jscpd src` | — | production clone 報告 | [testing.md §7.1](testing.md) | `ci-required` | ci.yml#validate | source tree | 依 `.jscpd.json` 門檻退出 | 維持 | — |
| `check:duplicates:tests` | 靜態檢核 | `jscpd src` test config | — | test clone 報告 | [testing.md §7.1](testing.md) | `ci-required` | ci.yml#validate | test sources | 依 `.jscpd-tests.json` 門檻退出 | 維持 | — |
| `check:e2e-ci-gates` | CI 契約 | `scripts/check-e2e-ci-gates.mjs` | — | required E2E profile 接線 | [testing.md §4](testing.md) | `ci-required` | ci.yml#validate | 三份 E2E workflows | job／profile 漂移即失敗 | 維持 | #508 |
| `check:e2e-isolation` | 邊界檢核 | `scripts/check-production-isolation.mjs --expect-e2e` | — | E2E-only surface 存在 | [testing.md](testing.md) | `local` | — | E2E build/source | 邊界缺失即失敗 | local | — |
| `check:garage-fidelity` | 生成檢核 | `scripts/generate-garage-fidelity.mjs --check` | — | Garage lazy CSS 投影無漂移 | [themes.md](themes.md) | `ci-required` | ci.yml#validate | SCSS source 與 public projection | 漂移即失敗 | 維持 | #512 |
| `check:invariants` | 單元閘門 | `src/system-constants/invariants.spec.ts` | — | 系統常數不變式 | [system-constants.md](system-constants.md) | `ci-required` | ci.yml#validate | Angular test runtime | test fail 即失敗 | 維持 | — |
| `check:materials` | 規格追蹤 | `scripts/check-materials.mjs` | — | 材質表與 canon 對齊 | [程式參數](../程式參數.md) | `ci-required` | ci.yml#validate | sibling specs repo | 漂移即失敗 | 維持 | — |
| `check:prelaunch-versions` | 版本檢核 | `scripts/prelaunch-version-authorities.mjs` | — | pre-launch 自有 current baseline 全維持 v1 | [專案生命週期](../專案生命週期.md) | `ci-required` | ci.yml#validate | machine-readable authority registry 與 generated/vendor projections | 自有 v2+、漏列或投影漂移即失敗；第三方版本明確排除 | 維持至 main public 觸發 live | #533 |
| `check:production-isolation` | 邊界檢核 | `scripts/check-production-isolation.mjs` | — | production artifact 排除測試面 | [版本規範](../版本規範.md) | `local` | — | built artifact | 洩漏即失敗 | 維持由 build compound 執行 | — |
| `check:pwa` | 生成檢核 | `scripts/generate-pwa.mjs --check` | — | PWA manifest 無漂移 | [pwa-offline.md](pwa-offline.md) | `ci-required` | ci.yml#validate | PWA sources | 漂移即失敗 | 維持 | — |
| `check:race-message-packs` | 資產檢核 | `scripts/check-race-message-packs.mjs --complete` | — | 賽中圖示訊息 pack schema、檔案與完整詞語覆蓋 | [race-messages.md](race-messages.md) | `local` | — | 賽中圖示訊息 pack manifest 與 WebP 資產 | schema、檔案或必要詞語覆蓋不完整即失敗 | 維持由 `check:assets` compound 執行 | #579 |
| `check:release-assets` | 資產檢核 | `scripts/check-builtin-glbs.mjs --strict` | — | release shipped GLB 嚴格完整性 | [builtin-assets.md](builtin-assets.md) | `ci-required` | release-readiness.yml#release-gate | delivered state、完整 release assets 與 rights provenance | deferred、缺檔、provenance 缺失／placeholder 或資產不合規即失敗 | 維持 | #723 |
| `check:seo` | 生成檢核 | `scripts/generate-seo.mjs --check` | — | SEO 產物無漂移 | [seo.md](seo.md) | `ci-required` | ci.yml#validate | route metadata | 漂移即失敗 | 維持 | — |
| `check:style-budget` | artifact 檢核 | `scripts/global-style-budget.mjs` | — | 唯一 global CSS 與 50 KiB 上限 | [ui-frontend.md](ui-frontend.md) | `local` | — | built browser artifact | 缺失、多檔或超限即失敗 | 維持由 build 實作內嵌 | #512 |
| `check:style-layers` | 靜態檢核 | `scripts/check-style-layers.mjs` | — | emitted CSS 必須位於允許 layer | [themes.md](themes.md) | `ci-required` | ci.yml#validate | SCSS/CSS source | unlayered rule 即失敗 | 維持 | #511 |
| `check:tokens` | 生成檢核 | `scripts/generate-tokens.mjs --check` | — | design tokens 無漂移 | [themes.md](themes.md) | `ci-required` | ci.yml#validate | token sources | 漂移即失敗 | 維持 | — |
| `check:trace` | 規格追蹤 | `scripts/check-trace.mjs` | — | requirement trace 完整性 | [文檔工程.md §5.1](../文檔工程.md) | `local` | — | sibling specs repo | 缺失引用即失敗 | local | — |
| `check:types` | 靜態檢核 | `tsconfig.typecheck.json` | — | TypeScript 全專案型別 | [程式架構.md](../程式架構.md) | `ci-required` | ci.yml#validate | Node 24 | compiler error 即失敗 | 維持 | — |
| `check:vendored` | 供應鏈檢核 | `scripts/check-vendored.mjs` | — | vendored 檔案政策 | [security.md](security.md) | `ci-required` | ci.yml#validate | repository files | 政策違反即失敗 | 維持 | — |
| `check:visual-boundaries` | 視覺檢核 | `scripts/template-visual-boundaries.mjs` | — | template 視覺邊界 | [ui-frontend.md](ui-frontend.md) | `local` | — | templates | 違規即失敗 | local | — |
| `format:check` | 靜態檢核 | Prettier | — | repository formatting | [程式架構.md §14](../程式架構.md) | `ci-required` | ci.yml#validate | repository files | 差異即失敗；不寫檔 | 維持 | — |
| `i18n:usage` | 靜態檢核 | `scripts/i18n-usage.mjs --strict` | — | UI key 使用完整性 | [i18n.md](i18n.md) | `ci-required` | ci.yml#validate | source 與字典 | 缺失／未用 key 即失敗 | 維持 | — |
| `i18n:validate` | 資料檢核 | `scripts/i18n-validate.mjs` | — | 四語字典 schema／同構 | [i18n.md](i18n.md) | `ci-required` | ci.yml#validate | locale JSON | 不同構即失敗 | 維持 | — |
| `lighthouse` | 瀏覽器稽核 | LHCI autorun | — | production web quality budgets | [seo.md](seo.md) | `ci-required` | lighthouse.yml#lighthouse | production build 與 Chromium | budget 未達即失敗 | 維持 | — |
| `lint` | 靜態檢核 | Angular ESLint | — | TypeScript／template lint | [程式架構.md §14](../程式架構.md) | `ci-required` | ci.yml#validate | source tree | lint error 即失敗 | 維持 | — |
| `proof:builtin-tracks` | 領域 proof | `builtin-track-surface-proof.spec.ts` | — | builtin track surface 證據 | [builtin-assets.md](builtin-assets.md) | `local` | — | builtin tracks | assertion fail 即失敗 | local | — |
| `proof:ugc-multisource` | 領域 proof | `ugc-multisource.integration.spec.ts` | — | UGC 多來源排程證據 | [builtin-assets.md](builtin-assets.md) | `local` | — | Node integration runtime | assertion fail 即失敗 | local | — |
| `test:app-shell-lru` | 專項測試 | `app-shell-lru-mutual-exclusion.spec.ts` | — | app shell LRU 互斥 | [pwa-offline.md](pwa-offline.md) | `local` | — | jsdom | assertion fail 即失敗 | 維持由 unit／coverage compound 執行 | — |
| `test:conformance` | 專項測試 | `src/testing/conformance/conformance.spec.ts` | — | 跨實作契約 | [testing.md](testing.md) | `local` | — | Angular test runtime | assertion fail 即失敗 | local | — |
| `test:coverage` | 覆蓋率 | 三段 Angular coverage suites | test:app-shell-lru<br>test:orbit-log-lifecycle | 分域 coverage gates | [testing.md §7](testing.md) | `ci-required` | ci.yml#unit | 三 OS matrix | coverage 或 assertion 未達即失敗 | 維持 | — |
| `test:determinism` | 決定性 | `src/testing/determinism/**/*.spec.ts` | — | checksum fixtures | [testing.md §2](testing.md) | `ci-required` | release-readiness.yml#release-gate | release manual workflow | checksum 漂移即失敗 | 維持 | — |
| `test:e2e` | 瀏覽器測試 | Playwright `e2e/*.spec.ts` | — | 跨模組 UI／資產旅程 | [testing.md §4–5](testing.md) | `ci-required` | ci.yml#e2e<br>ci.yml#e2e-canonical-assets<br>nightly.yml#canonical-assets-perf<br>release-readiness.yml#canonical-assets-perf<br>release-readiness.yml#release-gate | 對應 browser／delivery authority／assets／profile | prelaunch profile 僅授權 deferred canonical skip；strict profiles 的 skipped 或 missing 令 run 失敗 | 維持分層 profiles | #508<br>#723 |
| `test:fuzz` | Fuzz | `src/testing/fuzz/**/*.spec.ts` | — | bounded 隨機輸入 | [testing.md §4.1](testing.md) | `scheduled` | nightly.yml#fuzz-performance | nightly seed／30 分鐘 budget | assertion 或 timeout 即失敗 | scheduled | — |
| `test:integration` | 整合測試 | `src/testing/integration` 與 ledger integration | — | 真依賴跨模組行為 | [testing.md](testing.md) | `ci-required` | ci.yml#integration | Node runtime | assertion fail 即失敗 | 維持 | — |
| `test:orbit-log-lifecycle` | 專項測試 | `orbit-log-lifecycle.spec.ts` | — | Orbit log lifecycle | [ledger.md](ledger.md) | `local` | — | Node runtime | assertion fail 即失敗 | 維持由 unit／coverage compound 執行 | — |
| `test:perf` | 效能測試 | `src/testing/performance/**/*.spec.ts` | — | 非瀏覽器性能 budgets | [testing.md §8](testing.md) | `ci-required` | nightly.yml#fuzz-performance<br>release-readiness.yml#release-gate | 校準環境 | budget 未達即失敗 | 維持 nightly 加 release | — |
| `test:property` | Property test | `src/testing/property.spec.ts` | — | 生成式領域不變式 | [testing.md](testing.md) | `ci-required` | ci.yml#unit | fast-check | counterexample 即失敗 | 維持 | — |
| `test:scripts` | Repository contract | `scripts/*.test.mjs` | check:community-registry<br>check:constants | scripts 與跨 repo contracts | [程式架構.md](../程式架構.md) | `ci-required` | ci.yml#validate | sibling specs repo；可用 `O4_SPECS_DIR` 覆寫 | 任一 contract 或 snapshot 漂移即失敗 | 維持 | #513 |
| `test:theme-font-browser` | 瀏覽器 smoke | `scripts/theme-font-browser-smoke.mjs` | — | 主題字型實際載入 | [themes.md](themes.md) | `ci-required` | ci.yml#validate | Chromium | 字型未載入即失敗 | 維持 | — |
| `test:unit` | 單元測試 | Angular unit suites | test:app-shell-lru<br>test:orbit-log-lifecycle | runtime modules 與 pages | [testing.md](testing.md) | `ci-required` | ci.yml#unit | 三 OS matrix | assertion fail 即失敗 | 維持 | — |
| `themes:validate` | 主題檢核 | theme Node tests 與 registry／CSS validator | — | theme schema／fallback／CSS | [themes.md](themes.md) | `ci-required` | ci.yml#validate | theme assets | test 或 validator error 即失敗 | 維持 | — |
<!-- toolchain-inventory:end -->

## 變更規則

新增、刪除或改名正式入口時，必須同一變更更新本表。workflow 新增正式 `pnpm` 呼叫時也必須更新 current execution 與完整 evidence；compound command 新增／移除正式子命令同理。只改 target 不代表 current 已接線，skip 也不得寫成 pass。Editor／hook／issue gate helper 若未進 selector，必須在表外如實說明其非權威角色，不得偽裝成 CI evidence。
