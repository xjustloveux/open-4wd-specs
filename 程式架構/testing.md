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
| E2E            | **Playwright**                                                   | `testDir: './e2e'`、`timeout: 600_000`、`retries: 2`、5 projects（chromium / firefox / webkit / mobile-chrome Pixel 7 / mobile-safari iPhone 14）、reporter html + junit |
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

現行 `canonical-two-car-revision-2` fixture 不是空世界：固定平面場地、兩台九零件車、四筆
boost／stabilize input trace 與 120 frames；seed 奇偶選擇兩車 800W／650W 的固定 power
variant，因此 seed 會進入物理狀態而非只驗格式。`src/testing/determinism/golden-checksums.ts`
收藏 `0xCAFEBABE`／120 frames 的 SHA-256 checksum；unit 與 E2E 都直接對同一
`KNOWN_CHECKSUMS`，不可只在各 runner 內雙跑自比。任何 OS／browser 產生不同值都必須紅燈，
經調查證明是協定升版後才可更新 fixture ID 與 golden。

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

## 4. CI Matrix（`.github/workflows/ci.yml`／`nightly.yml`／`release-readiness.yml`）

| Workflow                | Job                     | 觸發                     | 矩陣 / 條件                                                                                                                                     |
| ----------------------- | ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | `validate`              | master push / PR         | ubuntu：format／lint／types／invariants／spec-const／i18n／themes／assets／scripts 等 repository gates                                          |
| `ci.yml`                | `unit`                  | master push / PR         | os = {ubuntu, macos, windows}，Node 24；依序跑 unit、三段 coverage 與 property tests                                                            |
| `ci.yml`                | `integration`           | master push / PR         | ubuntu                                                                                                                                          |
| `ci.yml`                | `e2e`                   | master push / PR         | {ubuntu, macos} × 5 Playwright projects；排除 ubuntu×webkit 與 ubuntu×mobile-safari，其餘 project 依實際 browser engine 安裝                    |
| `ci.yml`                | `e2e-canonical-assets`  | master push / PR         | ubuntu Chromium、`retries=0`；`canonical-assets-prelaunch` 只在 checked-in delivery state 為 deferred 時允許兩個 canonical title 明示 skip；missing 仍失敗 |
| `nightly.yml`           | `fuzz-performance`      | nightly schedule / 手動  | ubuntu，job `timeout-minutes: 45`；fuzz step `timeout-minutes: 30` 且 `OPEN4WD_FUZZ_PROFILE=nightly`，之後跑 `test:perf`                        |
| `nightly.yml`           | `canonical-assets-perf` | nightly schedule / 手動  | `OPEN4WD_BUILTIN_DELIVERY_GATE=strict`；重跑 shipped canonical required profile，再跑有界首幀效能採樣；skipped／missing 失敗                      |
| `release-readiness.yml` | `release-gate`          | 手動 `workflow_dispatch` | ubuntu；determinism、perf、public deployment/release assets、production build，最後跑五個 Playwright projects                                   |
| `release-readiness.yml` | `canonical-assets-perf` | 手動 `workflow_dispatch` | `release-gate` 成功後以 strict delivery gate 執行與 nightly 相同的 canonical assets／perf profiles                                               |

### 4.1 Fuzz 執行契約

`test:fuzz` 執行 `src/testing/fuzz/**/*.spec.ts` 的 bounded 隨機輸入測試。Nightly 使用固定可回報
seed 與 30 分鐘 step timeout；任何 assertion 或 timeout 都使 job 失敗。失敗報告必須保存 seed 與
最小 counterexample，讓相同輸入可在本機重現；不得把單次未命中視為性質已證明。

shipped canonical 與 authoring source 是兩種不同證據。`public/assets/builtin` 的 24 個 part GLB 與
3 個 track GLB 可供 checkout 直接驗證成品載入與完整 local-result 旅程；這個 gate 不宣稱車輛
必然抵達終點。Authoring 原始 bytes 由 specs immutable Release 與其 manifest 持有；main recipe
只以 `sourceAssetId` exact-set join，不重複來源 hash。維護者先離線 deterministic 封裝並審查，
再建立 Draft、上傳、完整下載回讀，經 exact tag 明確確認後發布。Main 在 specs public 前可使用
本機備份；之後鎖 exact specs commit、由該 commit 前 12 碼構成的 Release tag、source manifest
fingerprint／檔案 digest 與 Release manifest digest，從 Release 下載並驗 exact assetId／bytes 集合後
才執行完整 authoring profile。Canonical 成品始終不得反向替代原始來源；操作與失敗復原見
[Immutable Release](../美術資源/Immutable%20Release/README.md)。

> **本地 Windows 測試（e2e / determinism 的 windows 補位）**：CI 僅 `unit` 含 windows、e2e / determinism 無 windows runner。Windows 開發機以 `pnpm exec playwright test`（chromium / firefox / webkit 桌面三引擎皆有 Windows build）＋ `pnpm run test:determinism`（`KNOWN_CHECKSUMS` 比對）本地跑同套 fixture；**釋出（minor / major）前手動過一輪**。矩陣總覽見 [§2](#2-確定性測試-harness)。

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

`OPEN4WD_E2E_REQUIRED_PROFILE` 是 required coverage 的 fail-closed 選擇器：reporter 會列出 expected title 的 executed／authorized deferred skip／skipped／missing。只有 `canonical-assets-prelaunch` 配合 checked-in `deferred-prelaunch` 可授權兩個 canonical title 的 skip；missing、delivery 已切為 delivered 後的 skip，以及 `canonical-assets`／`canonical-assets-perf` 的任何 skip 都失敗。`OPEN4WD_BUILTIN_DELIVERY_GATE` 只接受未設定／`development`／`strict`；nightly、release 與 asset-ready 固定 strict，未知值 fail closed。下列舊式 opt-in 旗標只控制特定測試本身，不能取代 required profile：

| 旗標                          | 控制 suite／用途                                                                              | 素材／前置                                                                                               | current CI 與 skip 語意                                                                                                                    | target／解除條件                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `OPEN4WD_REAL_GLB_TEST=1`     | `editor-real-part-import.spec.ts` 及 `full-real-local-race.spec.ts` 的原始 GLB 匯入與完整旅程 | 本機 specs sibling，或 lock 驗證後的 `O4_AUTHORING_RELEASE_DIR`                                          | 一般 main CI 在 specs public 前未設定，測試明示 `skipped`；不得算 pass。啟用 template 後 required profile 對漏跑 fail closed               | specs public 並取得 immutable commit／Release 後啟用 main adoption workflow |
| `OPEN4WD_BUILTIN_AUTHORING=1` | `builtin-authoring.spec.ts` 經可見 Editor 控制重新 author selected builtin                    | main recipe＋specs source manifest exact-set；可用 `OPEN4WD_BUILTIN_IDS` 選集合；預設只寫 `test-results` | 一般 main CI 在 specs public 前未設定；availability 與 manifest join 仍必跑；只有維護者手動另設 `OPEN4WD_BUILTIN_WRITE=1` 才可替換正式公版 | 與 `OPEN4WD_REAL_GLB_TEST` 共用 authoring-sources adoption job              |
| `OPEN4WD_REAL_GLB_RESUME=1`   | `full-real-local-race.spec.ts` 從已保存匯入 checkpoint 續跑；並排除同檔完整重匯旅程           | 先由相同 source GLB 建立 checkpoint                                                                      | CI 未設定，測試明示 `skipped`；`authoring-sources-resume` required profile 已定義但未接 job                                                | 可攜 checkpoint 產製／傳遞流程與 source hash 驗證接入專用或排程 job 後啟用  |
| `OPEN4WD_RACE_PERF_ONLY=1`    | `full-real-local-race.spec.ts` 只跑 shipped canonical 首幀有界效能採樣，並排除 resume         | repository 內 canonical loadout／track；`OPEN4WD_E2E_REQUIRED_PROFILE=canonical-assets-perf`             | nightly 與 release 的 `canonical-assets-perf` job 已設定；required title skipped／missing 即失敗                                           | 維持效能 job，不混入一般功能矩陣                                            |

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
造成假失敗；release-readiness 必須執行同一 `test:perf` regression gate。只有在 repository
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
