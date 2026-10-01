---
type: impl
domain: []
summary: Vitest／Playwright／確定性 harness／CI matrix／coverage
authority: null
slug: null
---

# testing（測試基礎設施）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/testing.md](程式流程/testing.md)。
<!-- generated:impl-flow-backlink:end -->

> **本檔角色**：測試**基礎設施層** —— 框架選型（Vitest / Playwright / fast-check）、確定性測試 harness、8 人 mesh 模擬、CI matrix、mock 策略、coverage 門檻、perf budget、私密漏洞重現、fixtures。
> 跨瀏覽器確定性矩陣總覽見 [程式架構.md §7](../程式架構.md)；各模組測試重點見 [§11](#11-跨模組對接測試重點)。單元測試與程式 colocate；共享 suites 位於 `src/testing/`，瀏覽器流程位於 `e2e/`，repository contract tests 位於 `scripts/`。

## 1. 框架選型

| 層級           | 框架                                                             | 設定要點                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit           | **Angular unit-test builder + Vitest**（`environment: 'jsdom'`） | `coverage.provider: 'v8'`，門檻見 [§7](#7-coverage-門檻)；測試置於 `src/**/*.spec.ts`                                                                                    |
| Integration    | Vitest（`environment: 'node'`）                                  | libp2p memory transport 等 Node-only 測試獨立執行、`testTimeout: 60_000`                                                                                                 |
| E2E            | **Playwright**                                                   | `playwright.config.ts` 收集一般必要 UI；`playwright.specialized.config.ts` 供 catalog 精確執行 canonical／authoring／效能／determinism；一般 `timeout: 120_000`、`retries: 0`、失敗保留 trace、5 projects（chromium / firefox / webkit / mobile-chrome Pixel 7 / mobile-safari iPhone 14） |
| Property-based | **fast-check**                                                   | Vitest `it(...)` 內以 `fc.assert(fc.property(...))` 執行可重現的不變式測試                                                                                               |

## 2. 確定性測試 harness

跨瀏覽器 / 跨 OS 同一 fixed input 必產出**相同 checksum**（deterministic 物理的核心保證）：

```typescript
interface DeterministicSimResult {
  finalState: RaceState;
  checksum: string;
  frameCount: number;
  durationMs: number;
}

async function runDeterministicSim(opts: {
  seed: number;
  inputs: InputEvent[];
  frames: number;
}): Promise<DeterministicSimResult> {
  const sim = new Simulator({ seed: opts.seed });
  for (let f = 0; f < opts.frames; f++) {
    sim.applyInputs(opts.inputs.filter((i) => i.frame === f));
    sim.step();
  }
  return {
    finalState: sim.getState(),
    checksum: computeChecksum(sim.getState()),
    frameCount: opts.frames,
    durationMs: 0,
  };
}

const KNOWN_CHECKSUMS: Record<string, string> = {
  "seed-0xCAFEBABE-1000frames": "a3f1b2c4...",
};
```

現行 `canonical-two-car-revision-3` fixture 不是空世界：固定平面場地、兩台九零件車、四筆
boost／stabilize input trace 與 120 frames；seed 奇偶選擇兩車 800W／650W 的固定 power
variant，因此 seed 會進入物理狀態而非只驗格式。`src/testing/determinism/golden-checksums.ts`
收藏 `0xCAFEBABE`／120 frames 的 SHA-256 checksum；unit 與 E2E 都直接對同一
`KNOWN_CHECKSUMS`，不可只在各 runner 內雙跑自比。任何 OS／browser 產生不同值都必須紅燈，
更新 fixture ID 與 golden 前，必須定位相同輸入下的來源與 SDK 差異，確認變更已正式採用，
再核對 Node 與瀏覽器的逐幀原生快照、完整保存狀態及原有應用程式 harness。不得移除斷言、
放寬容差或增加 retry 來接受差異。Pre-launch 採內部 fixture 修訂，不為未發布格式保留舊版。

目前修訂使用來源 COM／慣量的三個 collider 質量建構分支，以及所選 solver contact 的輪胎
負載讀回；舊基準對應自動凸包質量與幾何接觸讀回、Rapier npm 0.19.3。現行固定原生核心
WASM SHA-256 為 `d92e03c056234eb1996de4c3dc3ac94fe62fb49831c191afd9b5d5083ccb227c`；
`0xCAFEBABE`／120 frames 的 checksum 為
`1bbc3d4e0bd753471a88f303f3337404cb2eba298c0bdffb186bf5d4d8890849`。
此接受值由 Windows Node／Chromium 相同完整狀態支持；Firefox／WebKit 與其他 OS 尚須依
既有 CI 矩陣執行，不能由單一環境驗證推定通過。

共識數學 ESLint 防線涵蓋 `physics-engine`、PhysicsManifest 重建、canonical editor pipeline、
anti-piracy、mount assembly、match terminal orchestration 與 ledger entry admission；這些路徑禁用
ECMAScript 允許實作近似的 `Math.hypot`／三角／對數／冪函數及 `**`。向量長度固定使用明示連乘
加 `Math.sqrt`，風向使用固定 range-reduction 多項式，admission ceil-log2 使用整數 bit-length。
純顯示與 Editor `reopen` 反向投影不產生共識值，明確排除。repository contract test 會對每個
受保護路徑注入禁用運算，避免未來縮小 glob 後仍因 production 當下剛好沒有命中而假綠。

在 Playwright 內對各瀏覽器跑 `/internal/sim-harness?seed=...&frames=...`，比對
`KNOWN_CHECKSUMS`。`seed`／`frames` 是非機密的確定性測試輸入，且 `frames` 必須為
1–600 的整數；PIN 等 secret 不得放入 URL、query、fragment、history state 或 referrer，
只能由 Playwright isolated context 的不可列舉 init global 傳入。

此 harness 是 **E2E test-build-only** 能力，不是 production route：Angular E2E
configuration 以 file replacement 加入 route，production route graph 與所有輸出 chunk 都
不得含 harness sentinel。E2E 靜態伺服器每次執行產生 runner token，除 health check 外的
請求都必須帶正確 header；自行開啟瀏覽器、只偽造 global 或錯誤 header 必須得到 401。
`pnpm build` 在 CSP／precache 後處理前執行 production isolation gate，route、chunk、穩定
sentinel 任一洩漏都 fail closed。`InputEvent` 型別見 [interfaces.md §3.1](interfaces.md)。
catalog 的 `determinism` suite 同時執行 `src/testing/determinism/` 與專屬 Playwright 檔，並由
profile runner 先準備一次 E2E build；Private 日常因其為 required-long 而排除，Public 日常在
Linux common job 執行一次，full 則依三平台同內容合約執行。
`unit-core` 排除 property、determinism、fuzz、performance 與 integration 的專屬檔；當 profile
同時選到 coverage 時，由 coverage supersede `unit-core`，再由各專屬 suite 各跑一次，避免
Public daily 與 full 把相同測試重複收集。
profile runner 先依 catalog 順序完成所有不需要 E2E build 的 suite，再建立一次 E2E 產物並依
原相對順序執行 determinism 與 browser suites；production build 因此不會覆寫待重用的 E2E 產物。

## 3. 8 人 Mesh connectivity proof

```typescript
class MockMesh {
  private peers: Libp2p[] = [];
  async startNPeers(n: number): Promise<void> {
    /* createLibp2p with memory() transport */
  }
  async fullMesh(): Promise<void> {
    /* 兩兩 dial */
  }
}

test("8 peers establish every pairwise connection", async () => {
  const mesh = new MockMesh();
  await mesh.startNPeers(8);
  await mesh.fullMesh();
  const result = mesh.inspect();
  expect(result.peers).toBe(8);
  expect(result.connections).toBe(28);
  expect(result.disconnects).toBe(0);
});
```

用 `@libp2p/memory` transport，無真實網路。此 proof 只證明同一 process 內 8 個 libp2p
nodes 能建立 28 條 pairwise connections；不模擬 packet loss、latency、60 秒賽事流量或
checksum 收斂，也不得宣稱抗損韌性。真正 impairment 測試必須在會承載 application traffic
的 transport／proxy 層實際 drop／delay frames，再觀察重連與 checksum，不能用只保存參數的
setter 代替。

## 4. CI test catalog 與 profile matrix

`.ci/test-catalog.json` 是 suite ID、命令、scope、necessity、duration、evidence、平台、artifact 與
受管路徑的唯一機器權威。`resolve-ci-profile.mjs` 依 lifecycle、trigger、platform、stage 產生固定
順序 plan；workflow 只決定 policy 與 runner placement，不得自行拼 grep、spec 檔名或 eligibility
旗標。未知輸入、空 plan、重複 ID、full 平台缺口或未分類受管路徑一律 fail closed。

| 入口／profile | 觸發與 runner | 測試政策 |
| --- | --- | --- |
| `ci.yml` private core | private master PR／push；GitHub-hosted Linux | `required + short + machine + common` |
| `ci.yml` private E2E | 同上，與 core 平行；GitHub-hosted Linux | `required + short + machine + Linux platform`；Chromium 與 canonical smoke 共用一次 build |
| `ci.yml` public common | public master PR／push 與 `public` event；GitHub-hosted Linux | 所有 `required + machine + common`，不以 duration 排除 |
| `ci.yml` public platform | 同上；GitHub-hosted Ubuntu／Windows／macOS | 各平台所有 `required + machine + platform`，不重複 common suite |
| `full-manual.yml` | 手動選 Linux hosted、Windows self-hosted 或 macOS self-hosted | 三平台同一 full contract；含 optional、long、authoring 與 human-visual |
| `release-readiness.yml` | 手動；三個 GitHub-hosted 平台 | 與 manual 完全相同的 full contract，供首次公開前與 release readiness |
| `CI / required` | 每次 `ci.yml` | 只要求 visibility 選中的 jobs success；selected skipped／cancelled／missing 失敗 |

共用 full workflow 同時接收 lifecycle／trigger 身分：手動 self-hosted 證據標記為
`private-manual-full`，三平台 hosted readiness 標記為 `release-full`；兩者的 suite IDs 與命令仍
由 catalog 契約保證完全相同。

Private 與 Public 日常都不選 human-visual。self-hosted runner 不接收 push、PR、schedule 或
`public` event，離線不影響日常 required check。repository 轉 Public 時直接依 event payload 的
實際 visibility 切換 policy，不需要再推 CI 設定。

### 4.1 Fuzz 執行契約

`test:fuzz` 執行 `src/testing/fuzz/**/*.spec.ts` 的 bounded 隨機輸入測試。它由 full catalog profile
執行並使用可回報 seed 與具名 timeout；任何 assertion 或 timeout 都使 job 失敗。失敗報告必須保存 seed 與
最小 counterexample，讓相同輸入可在本機重現；不得把單次未命中視為性質已證明。

shipped canonical 與 authoring source 是兩種不同證據。`public/assets/builtin` 的 24 個 part GLB 與
3 個 track GLB 可供 checkout 直接驗證成品載入與完整 local-result 旅程；代表性 smoke 不宣稱車輛
必然抵達終點，full contract 的三個 dedicated completion profiles 才要求九組自然完賽。
Authoring 原始 bytes 由 specs immutable Release 與其 manifest 持有；main recipe
只以 `sourceAssetId` exact-set join，不重複來源 hash。維護者先離線 deterministic 封裝並審查，
再建立 Draft、上傳、完整下載回讀，經 exact tag 明確確認後發布。Main 在 specs public 前可使用
本機備份；之後鎖 exact specs commit、由該 commit 前 12 碼構成的 Release tag、source manifest
fingerprint／檔案 digest 與 Release manifest digest，從 Release 下載並驗 exact assetId／bytes 集合後
才執行完整 authoring profile。Canonical 成品始終不得反向替代原始來源；操作與失敗復原見
[Immutable Release](../美術資源/Immutable%20Release/README.md)。

> **手動平台證據**：Windows／Mac runner 平時可離線，且 `Full / manual` 永不成為自動 required
> check。維護者啟動單一 runner 後選擇 target；不提供任意 SHA／ref input，同一最新 default-branch
> revision 可重複執行。首次公開前，Linux hosted、Windows self-hosted、macOS self-hosted full 與
> 三平台 hosted `Release readiness` 必須對同一候選 commit 全綠；任一平台不能冒充另一平台證據。

> **按需 Linux parity**：Docker Desktop 不需常駐，也不是 pre-push／required CI 前置。只有首次推版、
> toolchain／shell 參數語意改動或 hosted-only 差異調查時，維護者才手動啟動 Linux container 驗證；
> 永久防回歸由 catalog、resolver 與 `check:e2e-ci-gates` 拒絕 workflow-local suite 選擇，Docker 結果不替代
> Windows、macOS 或 GitHub-hosted 候選證據。

## 5. 測試命名與組織

```text
src/module/feature.ts + src/module/feature.spec.ts # unit 與程式同放
src/testing/conformance/                       # 跨實作 conformance
src/testing/determinism/                       # checksum／跨環境決定性
src/testing/fixtures/                          # 跨頁面共用測試 fixture
src/testing/fuzz/                              # bounded fuzz suites
src/testing/integration/                       # 跨模組與真依賴整合
src/testing/performance/                       # 校準後性能 gate
e2e/full-race-flow.spec.ts                     # Playwright 瀏覽器流程
scripts/import-boundaries.test.mjs             # repository contract tests
```

### 5.1 `e2e/` 分組與執行 profile

`e2e/*.spec.ts` 依證據種類分組，而不是另建一套產品模組樹：app shell／頁面／responsive／accessibility 屬一般跨瀏覽器 UI；`editor-*` 與 `ugc-journey` 屬 Editor／UGC；`full-race-flow`、`race-config` 與 `determinism` 屬賽事行為；`builtin-canonical-*` 與 `builtin-local-*` 驗證 repository 內 shipped canonical GLB；`builtin-authoring`、`editor-real-part-import`、`full-real-local-race` 驗證 specs sibling 或其 immutable Release 的 authoring source。共用載入、session 與證據 helper 放在 `e2e/helpers/` 或同層具名 helper，不以無測試內容的根層 `test/` 目錄表示覆蓋。

一般 config 排除所有由 catalog 專屬 suite 擁有的檔案；專屬命令必須指定
`playwright.specialized.config.ts` 與精確檔案／title。這使 full 仍涵蓋全部有效 suite，但不會由
一般 browser matrix 重複執行。`issue116-track-probe.spec.ts` 只供帶 prepared source 的歷史本機
診斷，兩個 CI config 都不把它計為有效 coverage。

### 5.2 視覺證據與自動 gate 分界

判斷依據是測試輸出是否會被機器轉成產品斷言，不是底層有沒有呼叫 browser screenshot API。
Canvas 非黑畫面／對比、縮圖透明度、元素幾何、必要操作可達性與 document 溢位等可判定的產品
行為維持自動 CI gate；Playwright `only-on-failure` screenshot 與失敗 trace 也維持自動保存。

只產生成功截圖供人觀看、驗證 viewport evidence helper 本身，或建立完整頁面視覺稽核 inventory
的案例集中在 `e2e/manual-visual/`。一般 `playwright.config.ts` 永遠排除該目錄；只有 catalog full
profile 或維護者直接使用 `playwright.manual-visual.config.ts`，並明確設定
`OPEN4WD_VISUAL_ARTIFACTS=1`，才會收集。`CI` 存在本身不得改變 suite eligibility；它只能調整
workers、reporter 或診斷等執行細節。`OPEN4WD_RWD_AUDIT_ARTIFACTS=1` 若仍用於混合功能案例的
附加人工圖，也只能由 catalog runner 設定，不能成為另一套 eligibility 清單。所有人工 artifact
維持 `retries=0`；workflow 成功只代表 artifact 產生完整，不代表人工核准。

`OPEN4WD_E2E_REQUIRED_PROFILE` 是 runner 根據 catalog 設定的 required coverage 執行細節；reporter
的 expected titles 也由同一 catalog 讀取，並列出 executed／authorized deferred skip／skipped／
missing。只有 `provisional-assets-smoke` 配合 `OPEN4WD_BUILTIN_DELIVERY_GATE=development` 可授權兩個代表 title
的 skip；其他 required profile 的任何 skip／missing 都失敗。九組自然完賽沒有 dedicated series
profile 時一律 skip，避免一般五瀏覽器矩陣重複執行長測試。`OPEN4WD_BUILTIN_DELIVERY_GATE` 只
接受未設定／`development`／`strict`；full 與 asset-ready 固定 strict，未知值 fail closed。下列
執行旗標只能由 catalog plan 設定，不能取代 suite eligibility：

| 旗標                          | 控制 suite／用途                                                                              | 素材／前置                                                                                               | current CI 與 skip 語意                                                                                                                    | target／解除條件                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `OPEN4WD_REAL_GLB_TEST=1`     | `editor-real-part-import.spec.ts` 及 `full-real-local-race.spec.ts` 的原始 GLB 匯入與完整旅程 | 本機 specs sibling，或 lock 驗證後的 `O4_AUTHORING_RELEASE_DIR`                                          | 一般 main CI 在 specs public 前未設定，測試明示 `skipped`；不得算 pass。啟用 template 後 required profile 對漏跑 fail closed               | specs public 並取得 immutable commit／Release 後啟用 main adoption workflow |
| `OPEN4WD_BUILTIN_AUTHORING=1` | `builtin-authoring.spec.ts` 經可見 Editor 控制重新 author selected builtin                    | main recipe＋specs source manifest exact-set；可用 `OPEN4WD_BUILTIN_IDS` 選集合；預設只寫 `test-results` | 一般 main CI 在 specs public 前未設定；availability 與 manifest join 仍必跑；只有維護者手動另設 `OPEN4WD_BUILTIN_WRITE=1` 才可替換正式公版 | 與 `OPEN4WD_REAL_GLB_TEST` 共用 authoring-sources adoption job              |
| `OPEN4WD_REAL_GLB_RESUME=1`   | `full-real-local-race.spec.ts` 從已保存匯入 checkpoint 續跑；並排除同檔完整重匯旅程           | 先由相同 source GLB 建立 checkpoint                                                                      | CI 未設定，測試明示 `skipped`；`authoring-sources-resume` required profile 已定義但未接 job                                                | 可攜 checkpoint 產製／傳遞流程與 source hash 驗證接入專用或排程 job 後啟用  |
| `OPEN4WD_RACE_PERF_ONLY=1`    | `full-real-local-race.spec.ts` 只跑 shipped canonical 首幀有界效能採樣，並排除 resume         | repository 內 canonical loadout／track；`OPEN4WD_E2E_REQUIRED_PROFILE=canonical-assets-perf`             | full catalog 的 `canonical-performance` suite 設定；required title skipped／missing 即失敗                                                   | 維持 full suite，不混入日常功能矩陣                                         |

這些旗標的 workflow 接線另由 `check:e2e-ci-gates` 驗證；完整正式命令與 job evidence 見 [toolchain.md](toolchain.md)。

## 6. Mock / Fake 策略

| 對象             | 策略                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Time             | 時序測試優先 `vi.useFakeTimers()`；真牆鐘只限明確的 integration / E2E                          |
| Random           | seed-based PRNG（可重現）                                                                      |
| Network / WebRTC | Node proof 用 `@libp2p/memory`；真正 browser WebRTC 路徑由 Playwright 覆蓋，不裝 Node polyfill |
| Storage          | 模組自有 `Memory*Store`／手寫 IDB port fake；需要真 IndexedDB 語意時在 browser runner 驗證     |
| Crypto           | **真實 noble，不 mock**（簽章 / 加密正確性）                                                   |
| WebGL / Three.js | Node unit 只測純資料／手寫 renderer doubles；真 WebGL 呈現由 Playwright browser 覆蓋           |
| Rapier WASM      | **真實載入**；測試前 init                                                                      |

AppShell 的線上全鏈維持 dynamic import 與 code-splitting，但不得由測試重建完整來源模組
namespace。production-owned `AppShellDynamicDeps` 只列 AppShell 實際消費的成員；正式 loader
投影該窄介面，各分組 module double 亦須以同一型別 `satisfies`。來源模組新增未被消費的 export
不要求假件同步；AppShell 新增被消費成員時，漏改假件必須由全量 typecheck 直接失敗，不能等到
獨立 Vitest 的動態載入才暴露。

## 7. Coverage 門檻

`pnpm test:coverage` 依序執行三個互不稀釋的 coverage gate：

| Gate                          | 量測範圍                                                                                                                              | 門檻（statements / branches / functions / lines） |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `coverage-core`               | 排除 `src/pages/**`、下列五個 browser bootstrap adapters 與無行為的 `src/bootstrap/index.ts`，其餘 production TypeScript              | `80 / 75 / 80 / 80`                               |
| `coverage-pages`              | `src/pages/**/*.ts`（含 Angular template）                                                                                            | lines `50`                                        |
| `coverage-bootstrap-adapters` | `arbitration-adapter.ts`、`browser-ports.ts`、`garage-store.ts`、`race-deps.ts`、`room-deps.ts`，由 `src/bootstrap/**/*.spec.ts` 驅動 | `50 / 45 / 35 / 50`                               |

五個 bootstrap adapters 不是 coverage 例外：它們因 browser port／dependency assembly 特性而以獨立 gate 量測，避免拉低 core gate；只有純 re-export barrel `src/bootstrap/index.ts` 不含可執行行為，因此不納入量測。不得用降低 core global threshold 或新增未量測排除的方式讓例外通過。

門檻只記錄 CI 實際執行的 hard gate。提高個別模組門檻前，必須先有可重現的獨立量測與對應設定；新增測試後應以不降低既有門檻為原則逐步 ratchet。不得在規範宣稱尚未由 runner 強制的 per-module 數字。

### 7.1 重複碼量測

`check:duplicates` 與 `check:duplicates:tests` 分別以 production 與 test 專用 jscpd 設定量測 clone；
兩者依各自設定檔的門檻退出，不把測試樣板稀釋 production 報告，也不以忽略清單隱藏新重複。
報告是重構訊號與 CI hard gate，不代表語意相同；共識／安全敏感程式仍須人工確認抽取後的
依賴方向與行為不變。

## 8. 性能基準（perf budget，`perf-baseline.json`）

| 基準                          | p99 目標 |
| ----------------------------- | -------- |
| `physics-step-60fps-8players` | 4.0 ms   |
| `snapshot-checksum-compute`   | 1.0 ms   |
| `rollback-recovery`           | 8.0 ms   |
| `key-manager-unlock`          | 500 ms   |
| `ugc-sanitize-25k-tris`       | 200 ms   |

固定毫秒值是**產品診斷目標**，`meetsProductTarget` 必須在效能報表中獨立呈現，但目前不是
共享 runner 的 hard gate。共享 CI runner 先執行固定 CPU／記憶體校準，再以正規化後相對
reference 的退化比例判定：超 +10% 警告、超 +25% 阻擋，避免 runner CPU 世代與即時負載
造成假失敗；`test:unit:performance` 只是 `test:perf` 的相容別名，full catalog 只執行一次；
release-readiness 必須執行同一 `test:perf` regression gate。只有在 repository
另行固定並記錄 CPU／OS／runtime／power mode 的參考環境及可重現 runner 後，才能增加
`meetsProductTarget` hard gate；在此之前不得宣稱固定毫秒值會阻擋 release。

`ugc-sanitize-25k-tris` 的完整 GLB fixture 尚未納入 repository 時必須明確標記 `skipped`，不得假裝通過；一般 PR 可繼續，release gate 必須在 fixture 具備後強制執行。

> **note**：rollback recovery 基準的 frame 數對齊 [network-sync.md](network-sync.md) 的 StateBuffer 視窗（rollback 視窗大小以 network-sync 為權威）。

## 9. 安全漏洞重現規則

安全漏洞先依 [資安規範.md §10–11](../資安規範.md) 私密通報。修補與 coordinated disclosure 前，重現步驟、exploit、log、附件及可直接濫用的測試程式不得進入公開 issue、PR、一般 CI artifact 或 repo 固定路徑；maintainer 在隔離的私密環境重現並於原通報管道回覆結果。

修復完成或協調揭露後，才可把最小化、去敏且不含 secret／可直接濫用細節的樣本改寫為一般 regression test，放入對應模組既有的 `*.spec.ts`、`src/testing/integration/`、`src/testing/fuzz/` 或 `e2e/` 路徑並由正常 CI 執行。漏洞通報與獎勵政策只由 [資安規範.md §11](../資安規範.md) 定義。

## 10. 測試 Fixtures

可重用 pure fixtures 放在 `src/testing/*-fixtures.ts`；suite 專用 fixture 與其 `*.spec.ts` colocate。E2E 的動態 HTTP／公告 fixture 放在 `e2e/`，視覺 fixture 由 `src/app/*.e2e-*.fixture.ts` 供測試 build 專用 routes 使用。大型 GLB fixture 未納入前必須維持明示 skip，不建立空的根層 `test/` 目錄充當已覆蓋證據。

## 11. 跨模組對接（測試重點）

| 模組                                   | 測試重點                  |
| -------------------------------------- | ------------------------- |
| `physics-engine`                       | 確定性、量化邊界          |
| [network-sync.md](network-sync.md)     | rollback、checksum        |
| [key-manager.md](key-manager.md)       | 簽章 / encrypt 測試向量   |
| [anti-piracy.md](anti-piracy.md)       | fingerprint property test |
| [ugc-fork.md](ugc-fork.md)             | 衍生樹結構不變式          |
| [matchmaking.md](matchmaking.md)       | TrueSkill fairness        |
| [security.md](security.md)             | sanitize fuzz             |
| [peer-discovery.md](peer-discovery.md) | mesh load                 |
