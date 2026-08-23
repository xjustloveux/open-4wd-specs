import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createDocsUvArguments,
  createDocsUvEnvironment,
} from "./docs-uv.mjs";
import { findHistoricalProseViolations } from "./current-prose-policy.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARAMETER_AUTHORITIES = JSON.parse(
  readFileSync(join(REPO_ROOT, "scripts/parameter-authorities.json"), "utf8"),
);

function readParameterAuthorities(group) {
  return PARAMETER_AUTHORITIES[group]
    .map((relative) => readFileSync(join(REPO_ROOT, relative), "utf8"))
    .join("\n\n");
}

test("ADR deprecation metadata is mandatory and drives the generated index", () => {
  const decisionsRoot = join(REPO_ROOT, "decisions");
  const decisionFiles = readdirSync(decisionsRoot)
    .filter((name) => /^D-.*\.md$/u.test(name))
    .sort();

  assert.ok(decisionFiles.length > 0);
  for (const name of decisionFiles) {
    const source = readFileSync(join(decisionsRoot, name), "utf8");
    assert.match(source, /^deprecates: \[[^\r\n]*\]$/mu, name);
  }

  const index = readFileSync(join(decisionsRoot, "INDEX.md"), "utf8");
  assert.match(index, /^## 廢止與改名索引$/mu);
  for (const item of [
    "weapon_branch",
    "OnboardingMintEvent",
    "FORK_DEPTH_MAX",
    "GET /list",
    "RaceSnapshotEvent",
    "GossipSub spectator-chat",
  ]) {
    assert.match(index, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(index, /<id>/u, "generated table cells must escape angle brackets");
  assert.match(index, /&lt;id&gt;/u);
});

test("ADR authoring rules match the checker and use one domain registry", () => {
  const read = (relative) => readFileSync(join(REPO_ROOT, relative), "utf8");
  const readme = read("decisions/README.md");
  const template = read("decisions/TEMPLATE.md");
  const checker = read("scripts/check-decisions.mjs");
  const frontmatter = read("scripts/check-frontmatter.mjs");
  const generator = read("scripts/generate-docs.mjs");

  assert.match(readme, /全檔禁用 `§`/u);
  assert.match(readme, /scripts\/domains\.mjs/u);
  assert.match(readme, /關聯追補/u);
  assert.match(template, /^deprecates: \[\]$/mu);
  assert.match(template, /全檔禁用 `§`/u);
  for (const source of [checker, frontmatter, generator]) {
    assert.match(source, /from ["']\.\/domains\.mjs["']/u);
    assert.doesNotMatch(source, /const DOMAINS\s*=\s*\[/u);
  }
});

test("pending-work index points to authorities without copying stale canon", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const pending = read("其他.md");
  const liveCanon = [
    "總覽.md",
    "算式表.md",
    "建模參數.md",
    "UGC機制.md",
    "編輯器操作.md",
    "零件與場景.md",
    "車輛組裝.md",
    "流程/UGC上傳.md",
    "程式架構/editor.md",
  ].map(read).join("\n");

  assert.match(pending, /程式參數.*初估/u);
  assert.match(pending, /專案生命週期.*第 4 步/u);
  // 現行待辦索引只指向維護者內部 registry，不得帶私有 issue 編號；編號圖例住 歷史記錄.md 檔頭。
  assert.match(pending, /執行追蹤在維護者內部 issue registry/u);
  assert.doesNotMatch(pending, /open-4wd-workflow issue 0\d{5}|\bissue 0\d{5}/u);
  assert.match(pending, /自由朝向切面 gizmo/u);
  for (const stale of [
    "TRUESKILL_VW_TABLE_X1000",
    "settlement base",
    "120 個 vendored",
    "其他/` 資料夾",
    "五項定案鐵則",
  ]) {
    assert.doesNotMatch(pending, new RegExp(stale.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.doesNotMatch(liveCanon, /鐵則 [1-5]|playtest 後續/u);
});

test("authority projections keep navigation, versions, and UGC rules single-sourced", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const overview = read("總覽.md");
  const copyright = read("版權.md");
  const ugc = read("UGC機制.md");
  const fork = read("程式架構/ugc-fork.md");
  const peerDiscovery = read("程式架構/peer-discovery.md");
  const technology = read("使用技術.md");
  const engineering = read("文檔工程.md");

  assert.doesNotMatch(overview, /^### 其他入口$/mu);
  assert.match(copyright, /^type: canon$/mu);
  assert.match(peerDiscovery, /^domain: \["比賽房間", "版本部署"\]$/mu);
  assert.doesNotMatch(technology, /Angular（最新版本）|@serenity-kit\/opaque` 1\.1\.0|Style API v1/u);
  assert.match(engineering, /自有.*版本.*current.*版本規範.*程式參數/su);
  assert.doesNotMatch(copyright, /rigidDiff = max|functionalDiff_pass =/u);
  assert.match(ugc, /rigidDiff.*最大分量.*functionalDiff.*OR 邏輯/su);
  assert.match(fork, /rigidDiff.*最大分量.*functionalDiff.*OR 邏輯/su);
});

test("parameter roots navigate to authoritative leaves without generated projections", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const manifest = JSON.parse(read("scripts/parameter-authorities.json"));

  assert.deepEqual(manifest.program, [
    "程式參數/共通規則.md",
    "程式參數/protocol.md",
    "程式參數/network.md",
    "程式參數/ui.md",
    "程式參數/economy-config.md",
    "程式參數/calibration.md",
  ]);
  assert.deepEqual(manifest.modeling, [
    "建模參數/零件與共用介面.md",
    "建模參數/場地.md",
    "建模參數/runtime.md",
  ]);

  const programRoot = read("程式參數.md");
  const modelingRoot = read("建模參數.md");
  assert.match(programRoot, /只提供導覽/u);
  assert.doesNotMatch(programRoot, /`GRAVITY_X1000`|`PEER_TIMEOUT_MS`/u);
  assert.doesNotMatch(modelingRoot, /`auto_mass_g`|`wind_speed_mps`/u);

  for (const authority of [...manifest.program, ...manifest.modeling]) {
    const source = read(authority);
    if (manifest.program.includes(authority)) {
      assert.match(source, /本頁是所列 namespace 的內容權威/u, authority);
    }
    assert.doesNotMatch(source, /生成物.*非權威|程式參數投影/u, authority);
  }

  for (const currentCopy of [
    "程式架構/system-constants.md",
    "conformance/README.md",
  ]) {
    assert.doesNotMatch(
      read(currentCopy),
      /(?:所有常數值(?:的)?權威[^\n]{0,80}程式參數\.md|程式參數\.md[^\n]{0,80}(?:（權威）|所有常數值(?:的)?權威))/u,
      `${currentCopy} 不得把導覽根頁寫成內容權威`,
    );
  }

  for (const retired of [
    "程式參數表.md",
    "建模參數表.md",
    "建模參數-零件.md",
    "建模參數-場地.md",
    "建模參數-runtime.md",
    "scripts/generate-parameter-projections.mjs",
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, retired)), false, retired);
  }

  const packageJson = read("package.json");
  assert.doesNotMatch(packageJson, /generate-parameter-projections/u);
});

test("large authority documents expose focused volumes without duplicating source bodies", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const ledger = read("程式架構/ledger.md");
  const admission = read("程式架構/ledger-admission.md");
  const checkpoint = read("程式架構/ledger-checkpoint.md");
  const settlement = read("程式架構/ledger-settlement.md");
  const modeling = read("建模參數.md");
  const part = read("建模參數/零件與共用介面.md");
  const track = read("建模參數/場地.md");
  const runtime = read("建模參數/runtime.md");

  assert.doesNotMatch(ledger, /interface BaseEvent|interface LedgerCheckpoint|interface MatchResultEvent/u);
  assert.match(admission, /interface BaseEvent/u);
  assert.match(checkpoint, /interface LedgerCheckpoint/u);
  assert.match(settlement, /interface MatchResultEvent/u);
  assert.doesNotMatch(modeling, /^\| `(?:mass_grams|wind_speed_mps)`/mu);
  assert.match(part, /`auto_mass_g`/u);
  assert.match(track, /`weather` 區塊/u);
  assert.match(runtime, /type 定案判定/u);

  for (const authority of [
    "程式參數/共通規則.md",
    "程式參數/protocol.md",
    "程式參數/network.md",
    "程式參數/ui.md",
    "程式參數/economy-config.md",
    "程式參數/calibration.md",
  ]) {
    const source = read(authority);
    assert.match(source, /^type: registry$/mu);
    assert.doesNotMatch(source, /生成物.*非權威|程式參數投影/u);
  }
});

test("frontend, art, and architecture documents expose role-focused authorities", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const frontendIndex = read("美術資源/前端技術策略.md");
  const frontend = read("程式架構/ui-frontend.md");
  const themeSpec = read("美術資源/主題外觀與 RWD.md");
  const themeReview = read("美術資源/主題審查計畫.md");
  const artIndex = read("美術資源.md");
  const architecture = read("程式架構.md");
  const bootstrap = read("程式架構/bootstrap.md");
  const pages = read("程式架構/pages-contracts.md");
  const raceRouting = read("程式架構/race-routing.md");

  assert.match(frontend, /^type: impl$/mu);
  assert.match(frontend, /## 14\. 主題切換架構/u);
  assert.doesNotMatch(frontendIndex, /## 14\. 主題切換架構/u);
  assert.match(frontendIndex, /程式架構\/ui-frontend\.md/u);

  assert.match(themeSpec, /## 4\. 主題架構/u);
  assert.doesNotMatch(themeSpec, /## 12\. 驗收矩陣/u);
  assert.match(themeReview, /非 canon/u);
  assert.match(themeReview, /## 12\. 驗收矩陣/u);

  for (const heading of ["出貨資產", "參考與原始工程", "技術與設計契約"]) {
    assert.match(artIndex, new RegExp(`^#{2,3} .*${heading}`, "mu"));
  }

  assert.match(bootstrap, /十四域真 .*AppDataProviders/u);
  assert.match(pages, /O4Viewport.*RaceSession/su);
  assert.match(raceRouting, /local-session-<uuid>/u);
  assert.doesNotMatch(architecture, /\|\s*`bootstrap\/`\s*\|[^\n]{300}/u);
  assert.match(architecture, /程式架構\/bootstrap\.md/u);
  assert.match(architecture, /程式架構\/pages-contracts\.md/u);
  assert.match(architecture, /程式架構\/race-routing\.md/u);
});

test("information architecture uses semantic leaf names and direct single-page navigation", () => {
  const productFlows = [
    ["升版", "升版"],
    ["比賽結算", "比賽結算"],
    ["比賽進行", "比賽進行"],
    ["治理事件", "治理事件"],
    ["玩家整體旅程", "玩家整體旅程"],
    ["信譽變動", "信譽變動"],
    ["衍生", "衍生（Fork）"],
    ["配對", "配對"],
    ["檢舉與仲裁", "檢舉與仲裁"],
    ["觀戰", "觀戰"],
    ["DMCA", "DMCA"],
    ["UGC上傳", "UGC 上傳"],
  ];
  for (const [fileName, title] of productFlows) {
    const relative = join("流程", `${fileName}.md`);
    assert.ok(existsSync(join(REPO_ROOT, relative)), relative);
    assert.match(
      readFileSync(join(REPO_ROOT, relative), "utf8"),
      new RegExp(`^# ${title}$`, "mu"),
      relative,
    );
  }

  const deployment = join("部署資訊", "部署實際值與初始拓撲.md");
  assert.ok(existsSync(join(REPO_ROOT, deployment)), deployment);
  assert.match(
    readFileSync(join(REPO_ROOT, deployment), "utf8"),
    /^# 部署實際值與初始拓撲$/mu,
  );
  for (const repository of [
    "open-4wd-pinning",
    "open-4wd-signaling",
    "open-4wd-turn",
  ]) {
    const relative = join("部署資訊", `${repository}.md`);
    assert.match(
      readFileSync(join(REPO_ROOT, relative), "utf8"),
      new RegExp(`^# ${repository} 部署規格$`, "mu"),
      relative,
    );
  }

  const theme = join("美術資源", "主題外觀與 RWD.md");
  assert.ok(existsSync(join(REPO_ROOT, theme)), theme);
  assert.match(
    readFileSync(join(REPO_ROOT, theme), "utf8"),
    /^# 主題外觀與 RWD$/mu,
  );
  for (const legacy of [
    join("美術資源", "主題外觀規格.md"),
    join("美術資源", "主題外觀與多比例RWD.md"),
    join("部署資訊", "部署實際值與初期拓撲.md"),
    ...[
      "升版流程.md",
      "比賽結算流程.md",
      "比賽進行流程.md",
      "治理事件流程.md",
      "信譽變動流程.md",
      "衍生流程.md",
      "配對流程.md",
      "檢舉與仲裁流程.md",
      "觀戰流程.md",
      "DMCA流程.md",
      "UGC上傳流程.md",
    ].map((name) => join("流程", name)),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, legacy)), false, legacy);
  }

  for (const prompt of [
    join("美術資源", "提示詞", "賽中訊息圖示", "default-inspired.md"),
    join("美術資源", "提示詞", "賽中訊息圖示", "moon-rabbit.md"),
    join("美術資源", "提示詞", "賽內倒數與起跑動畫", "default.md"),
    join("美術資源", "提示詞", "賽內倒數與起跑動畫", "moon-rabbit.md"),
  ]) {
    assert.ok(existsSync(join(REPO_ROOT, prompt)), prompt);
  }
  for (const stale of [
    join("美術資源", "提示詞", "賽中訊息圖示", "default", "提示詞.md"),
    join("美術資源", "提示詞", "賽中訊息圖示", "moon-rabbit", "提示詞.md"),
    join("美術資源", "提示詞", "賽內倒數與起跑動畫", "default", "提示詞.md"),
    join("美術資源", "提示詞", "賽內倒數與起跑動畫", "moon-rabbit", "提示詞.md"),
    join("美術資源", "實際使用圖", "賽中訊息圖示", "default", "README.md"),
    join("美術資源", "實際使用圖", "賽中訊息圖示", "moon-rabbit", "README.md"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, stale)), false, stale);
  }

  const buildSite = readFileSync(join(REPO_ROOT, "scripts/build-site.mjs"), "utf8");
  assert.doesNotMatch(buildSite, /flat\('Conformance 測試向量'/u);
  assert.doesNotMatch(buildSite, /flat\('知識圖'/u);
  assert.match(buildSite, /direct\(sortPages\(conformance\)\)/u);
  assert.match(buildSite, /direct\(sortPages\(graph\)\)/u);

  for (const directory of [
    "程式架構",
    "美術資源",
    join("美術資源", "提示詞"),
    "建模參數",
    "程式參數",
  ]) {
    for (const entry of readdirSync(join(REPO_ROOT, directory), {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const source = readFileSync(join(REPO_ROOT, directory, entry.name), "utf8");
      assert.doesNotMatch(
        source,
        /^# (?:程式架構|美術資源|提示詞|建模參數|程式參數)\s*[—-]/mu,
        join(directory, entry.name),
      );
    }
  }

  for (const entry of readdirSync(
    join(REPO_ROOT, "程式架構", "程式流程"),
    { withFileTypes: true },
  )) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const source = readFileSync(
      join(REPO_ROOT, "程式架構", "程式流程", entry.name),
      "utf8",
    );
    const title = source.match(/^# .+$/mu)?.[0] ?? "";
    assert.doesNotMatch(title, /程式流程\s*[—-]|(?:技術)?流程圖/u, entry.name);
  }
});

test("implementation flow navigation is generated and bidirectional", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const flowDir = join(REPO_ROOT, "程式架構", "程式流程");
  const names = readdirSync(flowDir).filter((name) => name.endsWith(".md")).sort();

  assert.equal(names.length, 13);
  for (const name of names) {
    const flow = read(`程式架構/程式流程/${name}`);
    const authority = read(`程式架構/${name}`);
    assert.match(flow, /^type: impl-flow$/mu, name);
    assert.match(flow, new RegExp(`^authority: 程式架構/${name.replace(".", "\\.")}$`, "mu"), name);
    assert.match(
      flow,
      /^\| Implementation authority \| 產品 canon／流程 \| 全域索引 \|$/mu,
      name,
    );
    assert.match(authority, new RegExp(`程式流程/${name.replace(".", "\\.")}`, "u"), name);
  }

  const index = read("流程.md");
  assert.match(index, /<!-- generated:impl-flow-index:start -->/u);
  assert.match(index, /<!-- generated:impl-flow-index:end -->/u);
  for (const name of names) assert.match(index, new RegExp(`程式架構/程式流程/${name}`, "u"));

  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["docs:generate"], /generate-impl-flow-index\.mjs/u);
  assert.match(pkg.scripts["check:docs"], /generate-impl-flow-index\.mjs --check/u);
});

test("current canon excludes review markers, private issue pointers, and maintainer-only reset steps", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const reviewedCanon = [
    "程式架構.md",
    "程式架構/anti-piracy.md",
    "程式架構/economy.md",
    "程式架構/ledger.md",
    "程式架構/matchmaking.md",
    "程式架構/moderation.md",
    "程式架構/signaling-service.md",
    "流程/比賽進行.md",
  ].map(read).join("\n");
  const pwaCanon = [
    "程式架構/pwa-offline.md",
    "程式架構/程式流程/pwa-offline.md",
  ].map(read).join("\n");

  assert.doesNotMatch(reviewedCanon, /⭐|H7|B4|草圖勘誤|待實作輔助/u);
  assert.doesNotMatch(pwaCanon, /Issue 0\d{5}|DevTools.*IndexedDB.*刪除/su);
});

test("secondary canon links to formula and policy authorities instead of copying them", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const economy = read("經濟系統.md");
  const gameplay = read("遊戲機制.md");
  const physics = read("程式架構/physics-engine.md");
  const materials = read("材質表.md");
  const ugc = read("UGC機制.md");
  const reputation = read("信譽系統.md");
  const reputationFlow = read("流程/信譽變動.md");
  const copyright = read("版權.md");
  const moderationFlow = read("流程/檢舉與仲裁.md");
  const formulas = read("算式表.md");
  const ratingImpl = read("程式架構/ugc-rating.md");
  const dmcaFlow = read("流程/DMCA.md");
  const governanceFlow = read("流程/治理事件.md");
  const dmcaImpl = read("程式架構/dmca.md");
  const pinningImpl = read("程式架構/pinning-service.md");
  const vehicle = read("車輛組裝.md");
  const parts = read("零件與場景.md");
  const raceFlow = read("流程/比賽進行.md");
  const editor = read("編輯器操作.md");
  const themeAppearance = read("美術資源/主題外觀與 RWD.md");
  const frontend = read("程式架構/ui-frontend.md");
  const pageWireframes = read("美術資源/頁面線框.md");
  const raceDesign = read("賽內機制.md");
  const settlementFlow = read("流程/比賽結算.md");

  assert.doesNotMatch(economy, /factorX100 =|function computeRoyaltyForUgc|function nicheMultiplierX100/u);
  assert.doesNotMatch(gameplay, /skill_power_budget_mw =|v_point = v_com/u);
  assert.doesNotMatch(physics, /available_output_mw=floor/u);
  assert.doesNotMatch(materials, /entity\.fatigue \+=/u);
  assert.doesNotMatch(ugc, /70 \/ 20 \/ 10：|五層防護（/u);
  assert.doesNotMatch(reputation, /ratingWeightX100 =|if voteCount == 0|RATING_NEUTRAL_X100 =/u);
  assert.doesNotMatch(reputationFlow, /interface ReputationDelta|function deriveReputation/u);
  assert.doesNotMatch(copyright, /版權方提交 Notice|REPEAT_INFRINGER_THRESHOLD =/u);
  assert.doesNotMatch(moderationFlow, /PEER_SCORE_THRESHOLD_GRAYLIST:/u);
  assert.doesNotMatch(`${formulas}\n${ratingImpl}`, /const (?:RATING_NEUTRAL_X100|BAYESIAN_PRIOR_SAMPLES)\s*=/u);
  assert.doesNotMatch(
    [dmcaFlow, governanceFlow, dmcaImpl, pinningImpl].join("\n"),
    /REPEAT_INFRINGER_THRESHOLD\s*=/u,
  );
  assert.doesNotMatch(`${vehicle}\n${parts}\n${raceFlow}\n${editor}`, /50.?500\s*g|250\s*[×x]\s*130\s*[×x]\s*100|≤\s*300:1/u);
  assert.doesNotMatch(themeAppearance, /Bench Black `#0B0C0E`/u);
  assert.doesNotMatch(frontend, /BREAKPOINT_MOBILE_PX` 640|Default／ 月兔目前外層 tint/u);
  assert.doesNotMatch(pageWireframes, /Mobile <640/u);
  for (const projection of [raceDesign, raceFlow, settlementFlow]) {
    assert.doesNotMatch(projection, /\| `(?:network-sync|economy|matchmaking)\/` \|/u);
    assert.match(projection, /程式架構\.md §1/u);
  }
});

test("frontend implementation canon tracks the current runtime contracts", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const pwa = read("程式架構/pwa-offline.md");
  const pwaFlow = read("程式架構/程式流程/pwa-offline.md");
  const interfaces = read("程式架構/interfaces.md");
  const i18n = read("程式架構/i18n.md");
  const languages = read("語系清單.md");
  const themes = read("程式架構/themes.md");
  const settings = read("程式架構/settings.md");
  const game = read("遊戲機制.md");
  const architecture = read("程式架構.md");
  const parameters = readParameterAuthorities("program");

  for (const phase of [
    "locked",
    "launching",
    "local-ready",
    "reconnecting",
    "online-ready",
  ]) {
    assert.match(`${pwa}\n${pwaFlow}\n${interfaces}`, new RegExp(`\\b${phase}\\b`));
  }
  assert.match(pwa, /localGarageRead/);
  assert.match(pwaFlow, /capabilitiesFor/);
  assert.match(interfaces, /AppRuntimeSnapshot/);
  assert.match(pwa, /physics-manifest-receipts[^\n]*keyPath: "key"/u);
  assert.match(pwaFlow, /physics-manifest-receipts/u);
  const runtimeSnapshot = interfaces.match(
    /interface AppRuntimeSnapshot \{(?<body>[\s\S]*?)\n\}/u,
  )?.groups?.body;
  assert.ok(runtimeSnapshot, "AppRuntimeSnapshot interface must exist");
  for (const field of ["revision", "onlineEpoch", "phase", "capabilities", "failure"]) {
    assert.match(runtimeSnapshot, new RegExp(`\\b${field}:`, "u"));
  }
  assert.doesNotMatch(runtimeSnapshot, /\bgeneration:/u);
  assert.match(
    pwaFlow,
    /\{ revision, onlineEpoch, phase, capabilities, failure \}/u,
  );
  assert.match(pwaFlow, /`locked`[^\n]*只有 `identity`/u);

  assert.doesNotMatch(i18n, /\/assets\/i18n\/<lang>\.json/);
  assert.match(i18n, /Record<string, unknown>/);
  assert.match(i18n, /locale-fonts\.ts/);
  assert.match(i18n, /persist.*提示需重整/su);
  assert.match(languages, /materials.*seo/su);
  assert.match(languages, /19/);
  assert.doesNotMatch(languages, /寫 localStorage/);

  assert.match(themes, /stage\?:/);
  assert.match(themes, /fallbackReason/);
  assert.match(themes, /RESERVED_SFX_SLOTS/);
  assert.match(settings, /followCameraDistanceM/);
  assert.match(settings, /收藏清單/);
  assert.match(settings, /安全事件 JSON/);
  assert.doesNotMatch(settings, /issue 000496/);
  assert.match(game, /9\.2 隱私聲明（顯示在「隱私」）/);
  assert.doesNotMatch(architecture, /設定七大分類|七大分類設計/);
  assert.doesNotMatch(parameters, /REDUCED_MOTION_FACTOR[^\n]*玩家可在設定頁覆寫/);
});

test("architecture index matches the implemented module and interface boundaries", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const architecture = read("程式架構.md");
  const interfaces = read("程式架構/interfaces.md");
  const focusedArchitecture = [
    architecture,
    read("程式架構/bootstrap.md"),
    read("程式架構/testing.md"),
  ].join("\n");

  assert.match(architecture, /22 個產品 route/u);
  assert.match(focusedArchitecture, /十四域.*AppDataProviders/u);
  assert.match(focusedArchitecture, /connectivity proof.*28.*pair/su);
  assert.match(architecture, /@libp2p\/webrtc.*@helia\/libp2p/su);
  assert.match(architecture, /程式架構\/race-messages\.md/u);
  assert.equal(
    architecture.match(/^### 9\.1 /gmu)?.length,
    1,
    "§9.1 heading must be unique",
  );
  assert.match(architecture, /^### 9\.2 Onboarding /mu);
  for (const stale of [
    "18 routes",
    "24 個產品 route",
    "8 人 mesh 壓測",
    "模擬 8 個 client",
    "10 分鐘 race",
    "Race／Watch",
  ]) {
    assert.doesNotMatch(architecture, new RegExp(stale, "u"));
  }

  assert.match(interfaces, /五個已接線.*一個保留接縫/su);
  assert.match(interfaces, /AssetStorage.*保留接縫.*首發尚無實作/su);
  assert.match(interfaces, /positionM: Vec3/u);
  assert.match(interfaces, /widthM: number/u);
  assert.match(interfaces, /key-manager\.md §2.*唯一權威/su);
  for (const stale of [
    "positionMm",
    "widthMm",
    "PeerId 前 8 碼",
    "IPFSAssetStorage",
    "LocalAssetStorage",
  ]) {
    assert.doesNotMatch(interfaces, new RegExp(stale, "u"));
  }
});

test("UGC authoring canon has one admission matrix and one finalizer contract", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const upload = read("流程/UGC上傳.md");
  const ugc = read("UGC機制.md");
  const editorUi = read("編輯器操作.md");
  const modeling = readParameterAuthorities("modeling");
  const versioning = read("版本規範.md");
  const editorImpl = read("程式架構/editor.md");
  const derivative = read("流程/衍生.md");
  const overview = read("總覽.md");
  const stage1Ui = editorUi.match(
    /### 5\.1 Stage 1 上傳預檢提示(?<body>[\s\S]*?)### 5\.2/u,
  )?.groups?.body;
  const ugcWaveB = ugc.match(
    /### 4\.1 自動算第二波（Stage 3 wave B）(?<body>[\s\S]*?)### 4\.2/u,
  )?.groups?.body;

  assert.ok(stage1Ui, "editor Stage 1 UI section must exist");
  assert.ok(ugcWaveB, "UGC wave B section must exist");
  assert.match(upload, /node 名稱重複/u);
  assert.match(upload, /NaN\/Inf mesh/u);
  assert.match(upload, /來源總三角形數.*3M.*Stage 1.*絕對/su);
  assert.match(upload, /編輯後.*3M.*Stage 2.*decimate/su);
  assert.match(ugc, /Stage 1 拒收條件.*唯一權威.*UGC上傳/su);
  assert.match(editorUi, /current marker.*type.*不得.*覆寫/su);
  assert.doesNotMatch(stage1Ui, /PART_VERTEX_COUNT_MAX|TRACK_VISUAL_TRIANGLE_COUNT_MAX|含禁止材質/u);
  assert.match(editorUi, /normal.*patch.*Stage 3 拒收/su);
  assert.match(editorImpl, /preset `neutral`/u);
  assert.match(editorImpl, /├── import\//u);
  assert.match(editorImpl, /pages\/editor-page/u);
  assert.match(editorImpl, /重開.*baked facts.*輕量幾何事實/su);
  assert.match(versioning, /可編輯匯出.*移除 marker/su);
  assert.doesNotMatch(versioning, /匯出重匯/u);
  assert.doesNotMatch(derivative, /允許 fork/u);
  assert.doesNotMatch(overview, /兩出口/u);
  assert.match(ugc, /summary:.*本機測試.*上鏈.*可編輯 GLB/u);
  assert.match(ugc, /Stage 3：本機測試 \/ 上鏈 \/ 可編輯 GLB/u);
  assert.match(ugc, /來源總三角形數.*3M.*Stage 1.*拒收/su);
  assert.match(ugcWaveB, /typed exposure/u);
  assert.match(editorImpl, /finalizer：.*保真減面.*wave A\/B/su);
  for (const source of [ugc, editorUi, modeling, upload, editorImpl]) {
    assert.doesNotMatch(source, /AABB 縮放|canonical 縮放/u);
  }
  for (const source of [editorUi, editorImpl, overview]) assert.match(source, /三出口/u);
  for (const label of ["出口 A", "出口 B", "出口 C"]) assert.match(upload, new RegExp(label, "u"));
});

test("art index and wireframes cover the shipped asset and route surfaces", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const art = read("美術資源.md");
  const wireframes = read("美術資源/頁面線框.md");
  const frontend = read("程式架構/ui-frontend.md");
  const direction = read("美術資源/美術方向.md");
  const skin = [
    read("美術資源/主題外觀與 RWD.md"),
    read("美術資源/主題審查計畫.md"),
  ].join("\n");
  const design = read("美術資源/設計系統.md");
  const audio = read("程式架構/audio-system.md");

  for (const item of [
    "authoring-source-manifest.json",
    "release-input/parts/",
    "release-input/tracks/",
    "release-input/ui/themes/",
    "release-input/ui/race-messages/",
    "release-input/ui/race-countdown/",
    "release-input/ui/social/og/",
    "提示詞/賽中訊息圖示/",
    "提示詞/賽內倒數與起跑動畫/",
  ]) {
    assert.match(art, new RegExp(item.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(art, /Immutable Release.*唯一權威/su);
  assert.doesNotMatch(art, /參考雛形\/(?:零件|場地)/u);
  assert.match(art, /release-input.*只供投遞/su);
  assert.doesNotMatch(art, /`參考雛形\/`.*非出貨資產/u);
  assert.doesNotMatch(art, /`實際使用圖\/` \| 實際採用的母圖/u);

  for (const route of ["/inbox", "/about", "/dmca", "/dmca/transparency"]) {
    assert.match(wireframes, new RegExp(route.replace("/", "\\/"), "u"));
    assert.match(skin, new RegExp(route.replace("/", "\\/"), "u"));
  }
  assert.match(wireframes, /Inbox/u);
  assert.match(wireframes, /PIN.*必填.*兩次一致/su);
  assert.match(wireframes, /invitation/u);
  assert.match(wireframes, /圖示訊息/u);
  assert.match(wireframes, /render.*resolution.*anti-alias/su);
  assert.doesNotMatch(wireframes, /spectator password|聊天預設收合|送出雙鈕/u);

  assert.match(frontend, /public\/assets\/themes\/<id>\/assets\//u);
  assert.match(frontend, /public\/assets\/sprites\//u);
  assert.match(frontend, /CONTRIBUTING\.md/u);
  assert.match(frontend, /\/ugc.*\/editor/su);
  assert.doesNotMatch(frontend, /src\/assets\/|CONTRIBUTING-art\.md|garage\/garage-edit\/showcase|tracks 使用/u);
  assert.match(direction, /設計系統.*主題外觀與 RWD/su);
  assert.doesNotMatch(direction, /project-resources/u);
  assert.doesNotMatch(design, /`tracks` 語意/u);
  assert.match(audio, /`bgm-home`[^\n]*`\/home`/u);
});

test("race-message architecture names the flattened prompt files that actually exist", () => {
  const document = readFileSync(join(REPO_ROOT, "程式架構/race-messages.md"), "utf8");
  for (const file of [
    "美術資源/提示詞/賽中訊息圖示/default-inspired.md",
    "美術資源/提示詞/賽中訊息圖示/moon-rabbit.md",
  ]) {
    assert.match(document, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(existsSync(join(REPO_ROOT, file)), true);
  }
  assert.doesNotMatch(document, /賽中訊息圖示\/\{default,moon-rabbit\}\//u);
});

test("live public docs do not route readers to private workspace paths", () => {
  const files = [
    "流程.md",
    "遊戲機制.md",
    "美術資源.md",
    "美術資源/頁面線框.md",
    "美術資源/美術方向.md",
    "美術資源/提示詞/零件參考圖.md",
    "美術資源/提示詞/場地參考圖.md",
    "美術資源/提示詞/頁面概念圖.md",
  ];

  const overview = readFileSync(join(REPO_ROOT, "總覽.md"), "utf8").split(
    "<!-- homepage-timeline:start -->",
    1,
  )[0];
  assert.doesNotMatch(overview, /project-resources|(?:^|[`\s])企劃\//mu);

  for (const path of files) {
    const source = readFileSync(join(REPO_ROOT, path), "utf8");
    assert.doesNotMatch(
      source,
      /project-resources|(?:^|[`\s])企劃\//mu,
      path,
    );
  }

  const historyIndex = readFileSync(join(REPO_ROOT, "歷史記錄.md"), "utf8");
  assert.doesNotMatch(historyIndex, /project-resources\/[^`\s]+\/spec\.md/u);
});

test("DMCA canon stays provider-scoped and uses one blacklist contract", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const copyright = read("版權.md");
  const reputation = read("信譽系統.md");
  const flow = read("流程/DMCA.md");
  const dmca = read("程式架構/dmca.md");
  const parameters = readParameterAuthorities("program");
  const materials = read("材質表.md");
  const reports = read("流程/檢舉與仲裁.md");

  assert.match(copyright, /`\/dmca\/transparency`/);
  assert.doesNotMatch(copyright, /下架清單公開 git 歷史|下架清單變動歷史/);
  assert.doesNotMatch(reputation, /維護者審查|清單移除 \+ re-pin/);
  assert.doesNotMatch(flow, /Open4WD DMCA agent|processing time ≈ 48h|DMCA Agent/);
  assert.match(flow, /<provider name> DMCA contact/);
  assert.doesNotMatch(dmca, /addedBy:|addedAt:|approvedBy\?:|version: "v1" \| "v2"/);
  assert.match(dmca, /GET \/api\/dmca\/admin\/notices\/:id/);
  assert.match(parameters, /exact \/ substring \/ regex/);
  assert.doesNotMatch(parameters, /exact \/ substring \/ fuzzy/);
  assert.doesNotMatch(materials, /TEXT_BLACKLIST[^\n]*賽中聊天即時過濾/);
  assert.doesNotMatch(reports, /peer-discovery 廣播黑名單/);
});

test("anti-piracy flow mirrors the current similarity and arbitration canon", () => {
  const flow = readFileSync(
    join(REPO_ROOT, "程式架構", "程式流程", "anti-piracy.md"),
    "utf8",
  );

  assert.doesNotMatch(flow, /First-Mover|95-100%|90-95%|85-90%|< 85%|發起爭議/);
  assert.doesNotMatch(flow, /X 軸翻轉<br\/>三角形 winding 反轉/);
  assert.match(flow, /similarity-pending/);
  assert.match(flow, /Provider-scoped DMCA/);
  assert.match(flow, /非全域玩家黑名單/);
  assert.match(flow, /門檻數值以.*版權\.md §5\.3/su);
});

test("implementation flow diagrams exclude superseded prototype contracts", () => {
  const flowRoot = join(REPO_ROOT, "程式架構", "程式流程");
  const readFlow = (name) => readFileSync(join(flowRoot, name), "utf8");
  const ledger = readFlow("ledger.md");
  const testing = readFlow("testing.md");
  const versioning = readFlow("versioning.md");
  const signaling = readFlow("signaling-service.md");
  const discovery = readFlow("peer-discovery.md");
  const matchmaking = readFlow("matchmaking.md");
  const chat = readFlow("chat-system.md");
  const i18n = readFlow("i18n.md");
  const sync = readFlow("network-sync.md");
  const raceFlow = readFileSync(join(REPO_ROOT, "流程", "比賽進行.md"), "utf8");

  assert.doesNotMatch(ledger, /比較後續鏈長度|checksum 字典序|alice mint|從 Pinning 取最新/);
  for (const event of ["RaceLeaveEvent", "RaceAbortEvidenceEvent", "AssetVersionUpgradeEvent"])
    assert.match(ledger, new RegExp(event));
  assert.doesNotMatch(testing, /fake-indexeddb|wrtc polyfill|release tag|Canary|frames=1000|npm run/);
  assert.doesNotMatch(
    testing,
    /E2E 10%|Integration 25%|Unit 60%|Determinism 5%|Vitest \+ jsdom|< 5s|< 60s|< 10min|10-30min/,
  );
  assert.match(versioning, /六欄版本/);
  assert.doesNotMatch(versioning, /三類版本|過渡期 1 月|skipWaiting \+ reload/);
  assert.doesNotMatch(signaling, /room:<code>|match:<id>|維護者自有部署設定/);
  assert.doesNotMatch(discovery, /GitHub raw list|JSON parse|丟棄 \+ 黑名單|spectator-chat topic/);
  assert.doesNotMatch(matchmaking, /join-accepted|SettlementProposalMessage/);
  assert.doesNotMatch(chat, /#abcd|訊息歷史 100 則|CHAT_HISTORY_MAX/);
  assert.match(chat, /CHAT_HISTORY_LIMIT/);
  assert.doesNotMatch(i18n, /tPlural|Intl MessageFormat/);
  assert.match(i18n, /formatIcu/);
  assert.match(i18n, /Intl\.PluralRules/);
  assert.doesNotMatch(sync, /desync 上鏈|7-10 frames/);
  assert.doesNotMatch(raceFlow, /<br\/>⌊presentPeers\/2⌋\+1/);

  for (const file of readdirSync(flowRoot).filter((name) => name.endsWith(".md"))) {
    const source = readFileSync(join(flowRoot, file), "utf8");
    assert.doesNotMatch(source, /^\s*style\s+\S+\s+fill:\s*#[0-9a-f]{3,8}/gim, `${file} must use semantic classDef colors`);
  }
});

test("technology inventory names only current implementations and repository tools", () => {
  const technology = readFileSync(join(REPO_ROOT, "使用技術.md"), "utf8");
  const architecture = readFileSync(join(REPO_ROOT, "程式架構.md"), "utf8");
  const dataSystem = readFileSync(join(REPO_ROOT, "資料系統.md"), "utf8");
  const i18n = readFileSync(join(REPO_ROOT, "程式架構", "i18n.md"), "utf8");
  const editor = readFileSync(join(REPO_ROOT, "編輯器操作.md"), "utf8");
  const uploadFlow = readFileSync(join(REPO_ROOT, "流程", "UGC上傳.md"), "utf8");
  const art = readFileSync(join(REPO_ROOT, "美術資源.md"), "utf8");
  const security = readFileSync(join(REPO_ROOT, "資安規範.md"), "utf8");

  assert.doesNotMatch(technology, /Angular Material|官方 Cloudflare Worker|OrbitDB v2|intl-messageformat|tools\/|\| Go\s+\||\| Rust|\| Python|\| PowerShell|硬體錢包 hook（未來）|\/_\.md/);
  assert.match(technology, /o4-\*/);
  assert.match(technology, /RFC 9807 OPAQUE/);
  assert.match(technology, /pnpm check:assets/);
  assert.doesNotMatch(architecture, /跨 JS \/ Rust \/ WASM 一致/);
  assert.doesNotMatch(dataSystem, /OrbitDB v2/);
  assert.match(i18n, /Intl\.PluralRules/);
  assert.doesNotMatch(i18n, /intl-messageformat/);
  for (const source of [editor, uploadFlow, art]) {
    assert.doesNotMatch(source, /tools\/(?:inspect-glb|convert-tripo-glb)/);
  }
  assert.match(security, /`room-runtime\/`[\s\S]*RFC 9807 OPAQUE/);
});

test("contributor guidance describes the nine-domain rule contract workflow", () => {
  const readme = readFileSync(join(REPO_ROOT, "README.md"), "utf8");
  const engineering = readFileSync(join(REPO_ROOT, "文檔工程.md"), "utf8");
  const ownership = JSON.parse(readFileSync(join(REPO_ROOT, "rule-ownership.json"), "utf8"));
  const combined = `${readme}\n${engineering}`;

  for (const prefix of ["LEDGER", "ECON", "MOD", "PHYS", "TRACK", "PART", "UGC", "VERSION", "SEC"]) {
    assert.match(combined, new RegExp(`\\b${prefix}\\b`));
  }
  assert.match(readme, /rule-contracts\.json/);
  assert.match(readme, /ruleConformance/);
  assert.match(engineering, /canon anchor [\s\S]* contract [\s\S]* exact set/i);
  assert.match(engineering, /kind[\s\S]*requiredLayers[\s\S]*implementationRepos[\s\S]*testContracts/);
  assert.match(engineering, /check:constants/);
  assert.match(engineering, /check:authoring-source/);
  assert.match(engineering, /程式參數\/.*各分冊/);
  assert.doesNotMatch(engineering, /共用常數[^\n]*\[程式參數\.md\]/);
  assert.doesNotMatch(combined, /新增三域|`rule-ownership\.json` [\s\S]*執行期輸入|驗證規則：/);
  assert.equal(ownership.status, "historical-non-executable");
  assert.equal(ownership.supersededBy, "rule-contracts.json");
});

test("docs uv wrapper derives a workspace cache and preserves an override", () => {
  const inherited = { PATH: "tools" };
  const automatic = createDocsUvEnvironment(REPO_ROOT, inherited);
  const overridden = createDocsUvEnvironment(REPO_ROOT, {
    ...inherited,
    UV_CACHE_DIR: "custom-cache",
  });

  assert.equal(automatic.UV_CACHE_DIR, resolve(REPO_ROOT, "..", ".uv-cache"));
  assert.equal(automatic.UV_NO_PYTHON_DOWNLOADS, "1");
  assert.equal(overridden.UV_CACHE_DIR, "custom-cache");
  assert.deepEqual(createDocsUvArguments("verify-offline").slice(0, 3), [
    "run",
    "--offline",
    "--no-sync",
  ]);
});

test("asset projection describes the current UGC schema baseline", () => {
  const versioning = readFileSync(join(REPO_ROOT, "版本規範.md"), "utf8");
  const current = versioning.match(
    /"open4wd_version": (\d+), \/\/ pre-launch 唯一支援的 per-type schema marker/u,
  )?.[1];

  assert.ok(current, "current UGC schema marker must remain explicit");
  assert.equal(current, "1");
  assert.match(
    versioning,
    /`descriptors`／`breakingWalls` 是上述 current 開發期基線的有效輸出/u,
  );
});

test("pre-launch canon does not promise compatibility for unpublished local shapes", () => {
  const paths = [
    "程式架構/matchmaking.md",
    "程式架構/room-runtime.md",
    "程式架構/settings.md",
    "程式架構/pwa-offline.md",
    "程式架構/ledger.md",
    "程式架構/dmca.md",
    "流程/觀戰.md",
    "流程/配對.md",
  ];
  const canon = paths
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");

  for (const legacy of [
    /舊 wire 的 `matchRules\.disallowChip/u,
    /舊 `matchRules\.disallowChip`/u,
    /legacy `ipfsContribution/u,
    /已載入／遷移/u,
    /舊版 `raceLockCount`/u,
    /舊資料缺欄解讀為空集/u,
    /名稱暫留 API 相容/u,
    /public 相容欄名/u,
    /legacy challenge-response/u,
    /舊 `join-challenge`／`join-auth`/u,
    /舊六碼欄位/u,
  ]) {
    assert.doesNotMatch(canon, legacy);
  }
  assert.doesNotMatch(
    readFileSync(join(REPO_ROOT, "程式架構/dmca.md"), "utf8"),
    /version: "v1" \| "v2"/u,
  );
});

test("spectator identity and stream docs keep nickname data out of the public wire", () => {
  const roomRuntime = readFileSync(join(REPO_ROOT, "程式架構/room-runtime.md"), "utf8");
  const spectator = readFileSync(join(REPO_ROOT, "程式架構/spectator.md"), "utf8");
  const chat = readFileSync(join(REPO_ROOT, "程式架構/chat-system.md"), "utf8");
  const ugcCard = readFileSync(join(REPO_ROOT, "美術資源/UGC卡片.md"), "utf8");
  const wireframes = readFileSync(join(REPO_ROOT, "美術資源/頁面線框.md"), "utf8");

  assert.match(roomRuntime, /join-request[^\n]*nicknameSnapshot/u);
  assert.doesNotMatch(roomRuntime, /join-request[^\n]*displayName/u);
  assert.match(chat, /roster 的 nicknameSnapshot/u);
  assert.match(spectator, /onJoinRequest[^\n]*\{ peerId: PeerId \}[^\n]*=>/u);
  assert.doesNotMatch(spectator, /onJoinRequest[^\n]*password/u);
  assert.match(ugcCard, /#[0-9a-f]{8}/u);
  assert.doesNotMatch(wireframes, /name#[0-9a-f]{4}(?![0-9a-f])/u);
  assert.match(wireframes, /#[0-9a-f]{8}/u);
});

test("live canon keeps DMCA enforcement provider-scoped", () => {
  const liveCanon = [
    "主題系統.md",
    "信譽系統.md",
    "流程/信譽變動.md",
    "流程/檢舉與仲裁.md",
    "流程/治理事件.md",
    "版本規範.md",
    "程式參數/protocol.md",
    "部署資訊.md",
    "程式架構/anti-piracy.md",
    "程式架構/pinning-service.md",
    "程式架構/reputation.md",
    "資料系統.md",
  ]
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");

  assert.doesNotMatch(liveCanon, /client 下架清單/u);
  assert.doesNotMatch(liveCanon, /DMCA 清單作品維持硬擋/u);
  assert.doesNotMatch(liveCanon, /dmcaListed/u);
  assert.doesNotMatch(liveCanon, /同 DMCA 清單模式/u);
  assert.match(
    readFileSync(join(REPO_ROOT, "程式架構", "dmca.md"), "utf8"),
    /Client 不隨版攜帶全域 DMCA 下架清單/u,
  );
  const ugcAdmission = ["UGC機制.md", "流程/UGC上傳.md"]
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");
  assert.doesNotMatch(ugcAdmission, /parent[^\n]*已下架[^\n]*DMCA/u);
  assert.doesNotMatch(ugcAdmission, /仲裁黑名單\s*\/\s*DMCA/u);
  assert.doesNotMatch(ugcAdmission, /僅對活躍\s*\/\s*DMCA 對象/u);
  assert.match(ugcAdmission, /Provider-scoped DMCA 不改 client parent 資格/u);
});

test("room announcements expose current signaling discovery fields", () => {
  const discovery = readFileSync(
    join(REPO_ROOT, "程式架構", "peer-discovery.md"),
    "utf8",
  );

  assert.match(discovery, /signalingEndpoint: string \| null/u);
  assert.match(discovery, /gossipSignaling: boolean/u);
  assert.match(discovery, /signalingEndpoint[^\n]*WSS[^\n]*候選/u);
  assert.match(discovery, /gossipSignaling[^\n]*能力開關/u);
  assert.doesNotMatch(discovery, /hostMultiaddr/u);
});

test("ledger signature canon uses the chain-bound digest", () => {
  const paths = [
    "資料系統.md",
    "經濟系統.md",
    "流程/治理事件.md",
    "程式參數/economy-config.md",
    "程式架構/key-manager.md",
    "程式架構/security.md",
  ];
  const programFlowPaths = readdirSync(
    join(REPO_ROOT, "程式架構", "程式流程"),
  )
    .filter((name) => name.endsWith(".md"))
    .map((name) => `程式架構/程式流程/${name}`);
  const liveCanon = [...paths, ...programFlowPaths]
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");

  assert.doesNotMatch(
    liveCanon,
    /sign\(privateKey, sha256\(serializeForSigning\(event\)\)\)/u,
  );
  assert.doesNotMatch(liveCanon, /各 signer 對 `signingDigest/u);
  assert.doesNotMatch(liveCanon, /\bsigningDigest\(/u);
  for (const path of paths) {
    assert.match(
      readFileSync(join(REPO_ROOT, path), "utf8"),
      /ledgerSigningDigest\(ledgerAddress, event\)/u,
      `${path} must project the ledger-only digest`,
    );
  }
});

test("live canon keeps match settlement inside canonical fold", () => {
  const paths = [
    "資料系統.md",
    "經濟系統.md",
    "賽內機制.md",
    "程式參數.md",
    "版本規範.md",
    "資安規範.md",
    "流程/比賽進行.md",
    "流程/治理事件.md",
    "程式架構/economy.md",
    "程式架構/ledger.md",
    "程式架構/security.md",
    "程式架構/程式流程/matchmaking.md",
  ];
  const liveCanon = paths
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");

  for (const legacy of [
    /deriveStateAt\(baseLogHeadCids\) 機制/u,
    /內嵌 settlement 多簽背書/u,
    /settlement 內嵌簽章/u,
    /各自計算 settlement/u,
    /MatchResult 記錄該 CID/u,
    /該回合 CID = null/u,
    /settlement 收件重算/u,
    /結算收件全網重算/u,
    /settlement `base-not-synced`/u,
    /open4wd\/settlement\/<matchId>/u,
    /settlement＝match\.timestamp/u,
    /state\.match\.recentMatches\.has\(event\.matchId\)/u,
    /當月已鑄達此值 ⇒ 後續 match-result/u,
  ]) {
    assert.doesNotMatch(liveCanon, legacy);
  }

  assert.match(
    readFileSync(join(REPO_ROOT, "程式架構/economy.md"), "utf8"),
    /state\.match\.settledMatchIds\.has\(event\.matchId\)/u,
  );
});

test("voluntary post-GO leave has one signed penalty contract", () => {
  const paths = [
    "流程/比賽進行.md",
    "程式架構/程式流程/matchmaking.md",
    "賽內機制.md",
    "信譽系統.md",
    "流程/信譽變動.md",
  ];
  const liveCanon = paths
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");

  for (const legacy of [
    /leave-race/u,
    /輕微懲罰/u,
    /標準棄賽扣分/u,
    /額外「異常斷線」扣分/u,
    /自願退賽按鈕/u,
  ]) {
    assert.doesNotMatch(liveCanon, legacy);
  }
  for (const path of paths) {
    assert.match(
      readFileSync(join(REPO_ROOT, path), "utf8"),
      /RaceLeaveEvent/u,
      `${path} must project the signed voluntary-leave contract`,
    );
  }
  assert.match(liveCanon, /disconnectCounts \+1/u);
  assert.match(liveCanon, /frequent-disconnect[^\n]*[−-]5/u);
  assert.match(liveCanon, /\(matchId, peerId\)[^\n]*持久去重/u);
});

test("deployment trust roots and network limits have one current authority", () => {
  const parameters = readParameterAuthorities("program");
  const ledger = readFileSync(join(REPO_ROOT, "程式架構/ledger.md"), "utf8");
  const discovery = readFileSync(
    join(REPO_ROOT, "程式架構/peer-discovery.md"),
    "utf8",
  );
  const deployment = readFileSync(join(REPO_ROOT, "部署資訊.md"), "utf8");
  const deploymentValues = readFileSync(
    join(REPO_ROOT, "部署資訊/部署實際值與初始拓撲.md"),
    "utf8",
  );
  const pinning = readFileSync(
    join(REPO_ROOT, "部署資訊/open-4wd-pinning.md"),
    "utf8",
  );
  const upgrade = readFileSync(join(REPO_ROOT, "流程/升版.md"), "utf8");

  assert.doesNotMatch(parameters, /BOOTSTRAP_NODES_MIN/u);
  assert.doesNotMatch(ledger, /bootstrap 1 個硬下限/u);
  assert.doesNotMatch(discovery, /BOOTSTRAP_NODES_MIN/u);
  assert.match(parameters, /`LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED`\s*\| 3/u);
  assert.match(parameters, /`MAX_PEERS`\s*\| 64/u);
  assert.match(deployment, /`genesisTimestamp`[^\n]*genesis receipt/u);
  assert.match(deploymentValues, /`genesisTimestamp`[^\n]*receipt/u);
  assert.match(pinning, /GitHub secrets、variables[\s\S]{0,200}§3\.2[\s\S]{0,200}§3\.4/u);
  assert.doesNotMatch(pinning, /必填 variables：[\s\S]{0,400}`GENESIS_TIMESTAMP`/u);
  assert.match(pinning, /\| `GENESIS_TIMESTAMP`[^\n]*config \/ env/u);
  for (const legacy of [
    /open4wd-\$\{CACHE_VERSION\}/u,
    /process\.env\.VERSION/u,
    /fetch manifest 失敗/u,
    /上線前（genesis、無 ledger \/ signer set）/u,
  ]) {
    assert.doesNotMatch(upgrade, legacy);
  }
});

test("current public specifications reject retired cross-document spellings", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const samples = [
    ["\u4e3b\u984c\u7cfb\u7d71.md", /(?<!p)npm run/u],
    ["\u8a9e\u7cfb\u6e05\u55ae.md", /(?<!p)npm run/u],
    ["\u7a0b\u5f0f\u67b6\u69cb/i18n.md", /(?<!p)npm run/u],
    ["\u7a0b\u5f0f\u67b6\u69cb/testing.md", /(?<!p)npm run/u],
    ["\u8eca\u8f1b\u7d44\u88dd.md", /Qm[A-Za-z0-9]*/u],
    ["\u8cc7\u6599\u7cfb\u7d71.md", /ipfs:\/\/Qm|ledger:\/\/|config:\/\//u],
    ["\u7a0b\u5f0f\u67b6\u69cb/pwa-offline.md", /CACHE_VERSION|#0d0f12/u],
    ["\u6d41\u7a0b/\u5347\u7248.md", /CACHE_VERSION/u],
    ["\u6d41\u7a0b/\u89c0\u6230.md", /\/result\/:matchId/u],
    ["\u6d41\u7a0b/\u73a9\u5bb6\u6574\u9ad4\u65c5\u7a0b.md", /\/result\/:matchId|\u53cd\u5411\u8f38\u5165\u9a57\u8b49/u],
  ];
  for (const [path, retired] of samples)
    assert.doesNotMatch(read(path), retired, `${path} still contains ${retired}`);
});

test("active canon states current contracts without review or migration-history prose", () => {
  const excludedDirectories = new Set([
    "decisions",
    "docs",
    "歷史記錄",
    "node_modules",
    "site",
  ]);
  const excludedFiles = new Set(["docs-map.md", "歷史記錄.md", "總覽.md"]);
  const markdownFiles = [];
  const visit = (directory, relative = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !excludedDirectories.has(entry.name))
          visit(join(directory, entry.name), join(relative, entry.name));
      } else if (entry.name.endsWith(".md") && !excludedFiles.has(entry.name)) {
        markdownFiles.push(join(relative, entry.name));
      }
    }
  };
  visit(REPO_ROOT);
  const activeDocuments = markdownFiles.map((path) => ({
    path: path.replaceAll("\\", "/"),
    lines: readFileSync(join(REPO_ROOT, path), "utf8").split(/\r?\n/u),
  }));
  const activeCanon = activeDocuments.map(({ lines }) => lines.join("\n")).join("\n");

  assert.deepEqual(findHistoricalProseViolations(activeDocuments), []);
  assert.doesNotMatch(activeCanon, /重構記錄一律見|Alice#[0-9a-f]{8}/u);
  assert.doesNotMatch(activeCanon, /首版/u);
  assert.doesNotMatch(readFileSync(join(REPO_ROOT, "lint/run-zhlint.mjs"), "utf8"), /isDefer|deferCount/u);

  const reviewMarkerPaths = [
    "程式架構/i18n.md",
    "程式架構/interfaces.md",
    "程式架構/peer-discovery.md",
    "程式架構/room-runtime.md",
    "程式架構/versioning.md",
    "程式架構/ugc-rating.md",
  ];
  const reviewMarkerCanon = reviewMarkerPaths
    .map((path) => readFileSync(join(REPO_ROOT, path), "utf8"))
    .join("\n");
  assert.doesNotMatch(reviewMarkerCanon, /⭐|落地註|升級為/u);
  assert.doesNotMatch(readFileSync(join(REPO_ROOT, "版本規範.md"), "utf8"), /初估/u);
  assert.doesNotMatch(
    readFileSync(join(REPO_ROOT, "程式架構/security.md"), "utf8"),
    /程式參數 §4；初估/u,
  );

  assert.match(
    readFileSync(join(REPO_ROOT, "程式架構/physics-engine.md"), "utf8"),
    /不得另派生零摩擦、額外滾阻或 roller 軸向制動/u,
  );
  assert.match(
    readFileSync(join(REPO_ROOT, "遊戲機制.md"), "utf8"),
    /不可在積分前以 heat J 直接加到 °C 預判/u,
  );
  assert.match(
    readFileSync(join(REPO_ROOT, "程式架構/physics-engine.md"), "utf8"),
    /不另建立第二套\s*\n?`PlayerInputs`／`Snapshot`／`computeChecksum\(\)`/u,
  );
});

test("secondary canon projects current metadata, thermal, evidence, and import authorities", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const flowIndex = read("流程.md");
  const securityOverview = read("資安規範.md");
  const visualAssets = read("美術資源/提示詞/UI資產.md");
  const visualConcepts = read("美術資源/提示詞/頁面概念圖.md");
  const visualIndex = read("美術資源.md");
  const physics = read("程式架構/physics-engine.md");
  const economy = read("經濟系統.md");
  const reputation = read("信譽系統.md");
  const moderation = read("程式架構/moderation.md");
  const modeling = readParameterAuthorities("modeling");
  const about = read("ABOUT.en.md");
  const builtin = read("程式架構/builtin-assets.md");
  const conformance = read("conformance/README.md");
  const data = read("資料系統.md");
  const formulas = read("算式表.md");
  const architecture = read("程式架構.md");

  assert.doesNotMatch(flowIndex, /維運層兩層下架/u);
  assert.doesNotMatch(securityOverview, /settlement 重算/u);
  assert.doesNotMatch(visualAssets, /convert-tripo-glb\.py|src\/assets\/|Settings 七分類/u);
  assert.doesNotMatch(visualConcepts, /#0d0f12/ui);
  assert.doesNotMatch(visualIndex, /name#[0-9a-f]{4}(?![0-9a-f])/u);
  assert.doesNotMatch(physics, /voxelVolumeMm3/u);
  assert.doesNotMatch(economy, /function computeMatchPrize|場地 metadata 改/u);
  assert.doesNotMatch(
    `${reputation}\n${moderation}`,
    /PEER_SCORE_THRESHOLD_(?:GRAYLIST|REJECT)\s*:\s*-[0-9]+/u,
  );
  assert.doesNotMatch(modeling, /0\.13 \+ 0\.05|一律見 \[歷史記錄\.md\]/u);
  assert.doesNotMatch(about, /superseded models go to `歷史記錄\.md`/u);
  assert.match(builtin, /其他\.md §1/u);
  assert.doesNotMatch(conformance, /驗證 12 個家族/u);
  assert.match(
    data,
    /interface RaceAnchorConflictEvidence[\s\S]{0,300}roundIndex[\s\S]{0,300}first[\s\S]{0,300}second[\s\S]{0,300}equivocators/u,
  );
  assert.match(formulas, /actual_supply_power_w\s*=\s*drive_input_mw \/ 1000/u);
  assert.doesNotMatch(formulas, /ambient_temp|thermal_limit\) 時取 1/u);
  assert.doesNotMatch(modeling, /ambient_temp/u);
  for (const packageFamily of [
    "`helia`",
    "`@helia/*`",
    "`libp2p`",
    "`@libp2p/*`",
    "`@chainsafe/libp2p-*`",
  ]) {
    assert.match(architecture, new RegExp(packageFamily.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
});

test("deployment canon uses current Pages, fork, origin, and operator contracts", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const upgrade = read("流程/升版.md");
  const versioning = read("版本規範.md");
  const deployment = read("部署資訊.md");
  const pinning = read("部署資訊/open-4wd-pinning.md");
  const signaling = read("部署資訊/open-4wd-signaling.md");
  const turn = read("部署資訊/open-4wd-turn.md");
  const pwa = read("程式架構/pwa-offline.md");
  const security = read("程式架構/security.md");
  const pinningService = read("程式架構/pinning-service.md");
  const technology = read("使用技術.md");

  assert.doesNotMatch(upgrade, /gh-pages|待 setup|Lighthouse CI（可選）/u);
  assert.match(upgrade, /upload-pages-artifact/u);
  assert.match(upgrade, /deploy-pages/u);
  assert.match(upgrade, /lighthouse\.yml/u);
  assert.doesNotMatch(versioning, /`bootstrap\/`（節點清單）/u);

  assert.doesNotMatch(pinning, /Use this template|use-template|SSH_HOST|SSH_USER|SSH_KEY|tag／commit SHA/u);
  assert.match(pinning, /`pnpm check:vendor -- --local-only`/u);
  assert.match(pinning, /完整 commit SHA/u);
  assert.doesNotMatch(signaling, /use-template|部署 repo PR/u);
  assert.match(turn, /續期/u);
  assert.match(turn, /中斷/u);

  assert.match(pwa, /production[^\n]*root[^\n]*`\/`/u);
  assert.match(pwa, /`\/open-4wd\/`[\s\S]{0,80}preview/u);
  assert.doesNotMatch(security, /sizeMm|靜態 `CSP_META`/u);
  assert.match(security, /vendored/u);
  assert.match(pinningService, /ipfs-kubo[\s\S]{0,120}`:4101`/u);

  for (const source of [deployment, technology]) {
    assert.doesNotMatch(source, /CSP_META/u);
  }
  assert.match(deployment, /open4wd\.com[^\n]*301/u);
  assert.doesNotMatch(
    `${deployment}\n${pinning}\n${pinningService}`,
    /monitoring\.open4wd\.org|私人 Discord/u,
  );
});

test("SEO canon follows executable outputs and keeps UGC prerender optional", () => {
  const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const seo = read("程式架構/seo.md");
  const parameters = readParameterAuthorities("program");
  const deployment = read("部署資訊.md");

  assert.doesNotMatch(`${seo}\n${parameters}`, /assets\/og\/cover\.png/u);
  assert.match(`${seo}\n${parameters}`, /assets\/og\/cover\.jpg/u);
  assert.doesNotMatch(seo, /Disallow: \/spectator\//u);
  assert.match(seo, /`\/dmca`/u);
  assert.match(seo, /`\/dmca\/transparency`/u);
  assert.doesNotMatch(seo, /performance ≥|accessibility ≥|best-practices ≥|seo ≥/u);
  assert.match(seo, /\.lighthouserc\.json/u);

  for (const source of [seo, deployment]) {
    assert.doesNotMatch(source, /OrbitDB top-N|top tracks\(1000\)|creators\(500\)|每日 GitHub Actions 重生成|動態 UGC 頁面：client-side render/u);
  }
  assert.match(seo, /optional `ugcIndex`/u);
  assert.match(seo, /缺少輸入[^\n]*靜態/u);
});

test("derive-match-id vectors expose the complete grid binding", () => {
  const vectorPath = join(
    REPO_ROOT,
    "conformance/ledger/derive-match-id.vectors.json",
  );
  const fixture = JSON.parse(readFileSync(vectorPath, "utf8"));
  const decision = readFileSync(
    join(REPO_ROOT, "decisions/D-20260814-20-多人可驗算起跑格.md"),
    "utf8",
  );
  const settlementFlow = readFileSync(
    join(REPO_ROOT, "流程/比賽結算.md"),
    "utf8",
  );

  assert.equal(fixture.formatVersion, 1);
  assert.equal(fixture.version, undefined);
  assert.equal(fixture.fixtureRevision, undefined);
  for (const vector of fixture.vectors) {
    assert.match(vector.input.gridContextDigest, /^[0-9a-f]{64}$/u);
    assert.match(vector.input.gridSeed, /^[0-9a-f]{64}$/u);
  }
  assert.match(decision, /vectors: \["ledger\/derive-match-id"\]/u);
  assert.match(
    settlementFlow,
    /deriveMatchId\(sorted\(ranking ∪ disconnects\), startedAt, matchRules, gridProof\)/u,
  );
});

test("arbitration canon separates vote admission, tally, and result attestation", () => {
  const ledger = readFileSync(join(REPO_ROOT, "程式架構/ledger.md"), "utf8");
  const moderation = readFileSync(
    join(REPO_ROOT, "程式架構/moderation.md"),
    "utf8",
  );
  const reputation = readFileSync(join(REPO_ROOT, "信譽系統.md"), "utf8");
  const flow = readFileSync(
    join(REPO_ROOT, "流程/檢舉與仲裁.md"),
    "utf8",
  );
  const amendment = readFileSync(
    join(
      REPO_ROOT,
      "decisions/D-20260816-07-仲裁收件與結果自證責任分層.md",
    ),
    "utf8",
  );

  assert.match(
    ledger,
    /arbitration-result[^\n]*\(reportEventId, target, result, passRatioX100\)/u,
  );
  assert.doesNotMatch(reputation, /非面板\s*\/\s*窗外票收件即拒/u);
  assert.doesNotMatch(flow, /非面板\s*\/\s*窗外票收件即拒/u);
  assert.doesNotMatch(moderation, /收件拒非面板\s*\/\s*窗外票/u);
  for (const projection of [reputation, flow, moderation]) {
    assert.match(projection, /兩造排除[^\n]*窗[^\n]*粗篩/u);
    assert.match(projection, /面板[^\n]*tally[^\n]*終判/u);
  }
  assert.match(flow, /蒐集[^\n]*≥ quorum[^\n]*attestation[^\n]*才可寫結果事件/u);
  assert.match(
    moderation,
    /getReportStatus[^\n]*result\?: 'pass'\|'reject'\|'no-quorum'/u,
  );
  assert.match(amendment, /amends: \["D-20260703-11"\]/u);
});

test("UGC upload fees attach only to the upload event", () => {
  const economyDesign = readFileSync(join(REPO_ROOT, "經濟系統.md"), "utf8");
  const data = readFileSync(join(REPO_ROOT, "資料系統.md"), "utf8");
  const economyImpl = readFileSync(
    join(REPO_ROOT, "程式架構/economy.md"),
    "utf8",
  );
  const forkImpl = readFileSync(
    join(REPO_ROOT, "程式架構/ugc-fork.md"),
    "utf8",
  );
  const forkFlow = readFileSync(
    join(REPO_ROOT, "流程/衍生.md"),
    "utf8",
  );
  const versioning = readFileSync(join(REPO_ROOT, "版本規範.md"), "utf8");
  const programFlows = readdirSync(
    join(REPO_ROOT, "程式架構", "程式流程"),
  )
    .filter((name) => name.endsWith(".md"))
    .map((name) =>
      readFileSync(join(REPO_ROOT, "程式架構", "程式流程", name), "utf8"),
    );
  const liveCanon = [
    economyDesign,
    data,
    economyImpl,
    forkImpl,
    forkFlow,
    versioning,
    ...programFlows,
  ].join("\n");

  assert.doesNotMatch(
    liveCanon,
    /UgcUploadEvent\s*\/\s*UgcForkEvent[^\n]*(?:燒|收)費/u,
  );
  assert.doesNotMatch(
    liveCanon,
    /(?:上鏈費[^\n]*`?UgcUpload(?:Event)?`?\s*\/\s*`?(?:Ugc)?Fork(?:Event)?`?|`?UgcUpload(?:Event)?`?\s*\/\s*`?(?:Ugc)?Fork(?:Event)?`?[^\n]*(?:燒|收)上鏈費)/u,
  );
  assert.doesNotMatch(liveCanon, /`ugc-upload`\s*\/\s*`ugc-fork`[^\n]*入負/u);
  assert.match(
    economyDesign,
    /上鏈費只由 `UgcUploadEvent`[^\n]*`UgcForkEvent`[^\n]*免費/u,
  );
  assert.match(
    forkFlow,
    /UgcUploadEvent[^\n]*燒上鏈費[^\n]*UgcForkEvent[^\n]*免費/u,
  );
  assert.match(
    forkImpl,
    /type: "ugc-upload"[\s\S]{0,400}上鏈費[\s\S]{0,500}type: "ugc-fork"[\s\S]{0,160}免費/u,
  );
});

test("fork modification uses PhysicsFingerprint while mesh similarity stays anti-piracy-only", () => {
  const ugc = readFileSync(join(REPO_ROOT, "UGC機制.md"), "utf8");
  const copyright = readFileSync(join(REPO_ROOT, "版權.md"), "utf8");
  const forkFlow = readFileSync(
    join(REPO_ROOT, "流程/衍生.md"),
    "utf8",
  );
  const formulas = readFileSync(join(REPO_ROOT, "算式表.md"), "utf8");
  const forkCanon = [ugc, copyright, forkFlow].join("\n");

  assert.doesNotMatch(
    forkCanon,
    /修改幅度(?:計算|\s*＝)[^\n]*(?:mesh 幾何指紋|mesh fingerprint)/u,
  );
  assert.match(
    copyright,
    /修改幅度使用 per-type `PhysicsFingerprint` diff[^\n]*fingerprintVersion/u,
  );
  assert.match(ugc, /修改幅度[\s\S]{0,160}程式架構\/ugc-fork\.md §3–§4/u);
  assert.match(forkFlow, /修改幅度[\s\S]{0,200}程式架構\/ugc-fork\.md §3–§4/u);
  assert.match(
    copyright,
    /Similarity Threshold[\s\S]{0,1200}≥ 90%[\s\S]{0,1200}70–90%[\s\S]{0,1200}similarity-pending/u,
  );
  assert.match(
    formulas,
    /反複製相似度[\s\S]*mesh 幾何指紋[\s\S]*門檻 90\/70/u,
  );
  assert.doesNotMatch(formulas, /FORK_SIMILARITY_THRESHOLD_PERCENT/u);
});

test("active magnet strength uses the SOC-adjusted percentage power budget", () => {
  const formulas = readFileSync(join(REPO_ROOT, "算式表.md"), "utf8");
  const materials = readFileSync(join(REPO_ROOT, "材質表.md"), "utf8");
  const modeling = readFileSync(join(REPO_ROOT, "建模參數/零件與共用介面.md"), "utf8");
  const liveCanon = [formulas, materials, modeling].join("\n");

  assert.doesNotMatch(
    liveCanon,
    /allocation_pct × configured_output_w × K_MAGNET_FORCE/u,
  );
  for (const projection of [formulas, materials]) {
    assert.match(
      projection,
      /available_output_w × allocation_pct \/ 100 × K_MAGNET_FORCE/u,
    );
  }
  assert.match(
    modeling,
    /`allocation_pct` 物理意義[^\n]*SOC 降額後[^\n]*`battery\.available_output_w`/u,
  );
  assert.match(formulas, /available_output_mw \/ configured_output_mw/u);
  assert.match(
    formulas,
    /武器／技能預算只與 battery 的低 SOC `available_output_mw` 有關[^\n]*不過 motor/u,
  );
});

test("LEDGER-R-034 traces the dynamic version wall instead of the quarter partition", () => {
  const ledger = readFileSync(
    join(REPO_ROOT, "程式架構", "ledger-checkpoint.md"),
    "utf8",
  );
  const quarter = ledger
    .split(/\r?\n/u)
    .find((line) => line.includes("matchRecords") && line.includes("quarter"));
  const dynamicMin = ledger
    .split(/\r?\n/u)
    .find((line) => line.includes("minSupportedByType 推導"));

  assert.match(quarter ?? "", /LEDGER-R-033/u);
  assert.doesNotMatch(quarter ?? "", /LEDGER-R-034/u);
  assert.match(dynamicMin ?? "", /LEDGER-R-034/u);
});

test("testing and ledger canon describe the live runner and state contracts", () => {
  const testing = readFileSync(
    join(REPO_ROOT, "程式架構", "testing.md"),
    "utf8",
  );
  const ledger = [
    "程式架構/ledger.md",
    "程式架構/ledger-admission.md",
    "程式架構/ledger-checkpoint.md",
    "程式架構/ledger-settlement.md",
  ]
    .map((file) => readFileSync(join(REPO_ROOT, file), "utf8"))
    .join("\n");
  const data = readFileSync(join(REPO_ROOT, "資料系統.md"), "utf8");
  const parameters = readParameterAuthorities("program");

  assert.doesNotMatch(testing, /@fast-check\/vitest|test\.prop/u);
  assert.match(testing, /fc\.assert\(fc\.property/u);
  assert.match(testing, /\.ci\/test-catalog\.json[\s\S]*ci\.yml[\s\S]*full-manual\.yml[\s\S]*release-readiness\.yml/su);
  assert.doesNotMatch(testing, /`nightly\.yml`/u);
  assert.doesNotMatch(testing, /fake-indexeddb|`wrtc`|headless gl/u);
  assert.match(
    ledger,
    /playerSlotCounts: ReadonlyMap<PeerId, \{ vehicle: number; track: number \}>/u,
  );
  assert.doesNotMatch(ledger, /playerFormalSlotCounts/u);
  assert.match(`${ledger}\n${data}`, /21[^\n]*型別目錄[^\n]*20[^\n]*准入/u);
  assert.match(parameters, /TRACK_GLB_SIZE_MAX_MB[^\n]*80 MiB/u);
});

test("editor canon defines its deep-path module boundary", () => {
  const editor = readFileSync(join(REPO_ROOT, "程式架構", "editor.md"), "utf8");

  assert.match(editor, /深路徑模組/u);
  assert.match(editor, /`src\/editor\/index\.ts`[^\n]*不得[^\n]*import/u);
  assert.match(editor, /lazy[\s\S]{0,80}chunk/u);
});

test("docs CI runs every check from the package aggregate", () => {
  const packageJson = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );
  const aggregateChecks = [
    ...packageJson.scripts.check.matchAll(/pnpm run ([\w:-]+)/gu),
  ].map((match) => match[1]);
  const workflow = readFileSync(
    join(REPO_ROOT, ".github", "workflows", "docs-ci.yml"),
    "utf8",
  );
  const workflowChecks = new Set(
    [...workflow.matchAll(/^\s*run:\s*pnpm(?: run)? ([\w:-]+)\s*$/gmu)].map(
      (match) => match[1],
    ),
  );
  const missingChecks = aggregateChecks.filter(
    (check) => !workflowChecks.has(check),
  );

  assert.deepEqual(
    missingChecks,
    [],
    `docs-ci 缺少 package check：${missingChecks.join(", ")}`,
  );

  const installIndex = workflow.indexOf("run: pnpm install --frozen-lockfile");
  const pnpmStepPattern = /^      - (?:(?!^      - )[\s\S])*?^        run: pnpm(?! install --frozen-lockfile)(?: run)? ([\w:-]+)\s*$/gmu;
  const pnpmSteps = [...workflow.matchAll(pnpmStepPattern)];

  assert.ok(installIndex >= 0, "docs-ci 缺少 frozen-lockfile install 步驟");
  for (const step of pnpmSteps) {
    const [block, script] = step;
    assert.ok(
      step.index > installIndex,
      `docs-ci 的 pnpm ${script} 必須排在 install 之後`,
    );
    assert.match(
      block,
      /if: \$\{\{ !cancelled\(\) && steps\.install\.outcome == 'success'/u,
      `docs-ci 的 pnpm ${script} 必須在 install 成功後獨立執行`,
    );
  }
});

test("docs CI bootstraps the locked Python environment before docs tests", () => {
  const packageJson = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );
  const workflow = readFileSync(
    join(REPO_ROOT, ".github", "workflows", "docs-ci.yml"),
    "utf8",
  );
  const bootstrapIndex = workflow.indexOf("run: pnpm docs:bootstrap");
  const testsIndex = workflow.indexOf("run: pnpm test:docs");

  assert.equal(
    packageJson.scripts["docs:bootstrap"],
    "node scripts/run-docs-uv.mjs sync",
  );
  assert.ok(bootstrapIndex >= 0, "docs-ci 缺少鎖定 Python 環境的 bootstrap 步驟");
  assert.ok(
    bootstrapIndex < testsIndex,
    "docs-ci 必須先 bootstrap，才可執行離線文檔工具鏈測試",
  );
  // uv 不在 GitHub 的 ubuntu 映像裡（首跑 CI 實證：spawn uv ENOENT）；每個會跑 docs:bootstrap／
  // docs:build 的 workflow 都必須在該步驟前明確安裝 uv 與 Python 3.12，不得依賴映像預設。
  for (const [name, text] of [
    ["docs-ci.yml", workflow],
    [
      "graphify-refresh.yml",
      readFileSync(
        join(REPO_ROOT, ".github", "workflows", "graphify-refresh.yml"),
        "utf8",
      ),
    ],
  ]) {
    const uvIndex = text.indexOf("uses: astral-sh/setup-uv@");
    const pythonIndex = text.indexOf("uses: actions/setup-python@");
    const firstUvUse = text.indexOf("run: pnpm docs:");
    assert.ok(uvIndex >= 0, `${name} 缺少 astral-sh/setup-uv 步驟`);
    assert.ok(pythonIndex >= 0, `${name} 缺少 actions/setup-python 步驟`);
    assert.match(text, /python-version: "3\.12"/u, `${name} 必須固定 Python 3.12`);
    assert.ok(firstUvUse >= 0, `${name} 沒有任何 pnpm docs: 步驟`);
    assert.ok(
      uvIndex < firstUvUse && pythonIndex < firstUvUse,
      `${name} 的 setup-uv／setup-python 必須排在第一個 pnpm docs: 步驟之前`,
    );
  }
});

test("decision index sorting does not depend on the process default collation", () => {
  // 本機預設 zh-TW、CI 的 LANG=C.UTF-8 → en-US-u-va-posix；不帶 locale 的 localeCompare
  // 會讓同一份輸入排出不同 INDEX（首跑 CI 實證：check:decisions 假紅）。
  const checker = readFileSync(
    join(REPO_ROOT, "scripts", "check-decisions.mjs"),
    "utf8",
  );
  const bare = [...checker.matchAll(/localeCompare\(([^)]*)\)/gu)].filter(
    ([, args]) => !/,\s*['"][A-Za-z-]+['"]/u.test(args),
  );
  assert.deepEqual(
    bare.map(([call]) => call),
    [],
    "check-decisions.mjs 的 localeCompare 必須帶明確 locale",
  );
});

test("glob lints exclude local tool workspaces without disabling corpus lint", (t) => {
  const root = mkdtempSync(join(tmpdir(), "open4wd-docs-lint-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  copyFileSync(
    join(REPO_ROOT, ".markdownlint-cli2.jsonc"),
    join(root, ".markdownlint-cli2.jsonc"),
  );
  copyFileSync(
    join(REPO_ROOT, ".textlintignore"),
    join(root, ".textlintignore"),
  );
  writeFileSync(join(root, "valid.md"), "# Valid\n");
  for (const agentRoot of [".agents", ".claude", ".superpowers"]) {
    const skill = join(root, agentRoot, "skills", "graphify");
    mkdirSync(skill, { recursive: true });
    writeFileSync(
      join(skill, "upstream.md"),
      "### Skipped heading\n\n這是 MVP 版本。\n\n```\nbroken\n```\n",
    );
  }
  const superpowersPlan = join(root, "docs", "superpowers", "plans");
  mkdirSync(superpowersPlan, { recursive: true });
  writeFileSync(
    join(superpowersPlan, "local-plan.md"),
    "### Skipped heading\n\n這是 MVP 版本。\n\n```\nbroken\n```\n",
  );

  const markdownlint = join(
    REPO_ROOT,
    "node_modules",
    "markdownlint-cli2",
    "markdownlint-cli2-bin.mjs",
  );
  const textlint = join(
    REPO_ROOT,
    "node_modules",
    "textlint",
    "bin",
    "textlint.js",
  );
  const textlintRules = join(REPO_ROOT, "lint", "textlint-rules");
  const runLint = () =>
    spawnSync(process.execPath, [markdownlint], {
      cwd: root,
      encoding: "utf8",
    });
  const runTermLint = () =>
    spawnSync(
      process.execPath,
      [textlint, "--rulesdir", textlintRules, "**/*.md"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );

  const ignoredAgents = runLint();
  assert.equal(
    ignoredAgents.status,
    0,
    `${ignoredAgents.stdout}\n${ignoredAgents.stderr}`,
  );
  const ignoredAgentTerms = runTermLint();
  assert.equal(
    ignoredAgentTerms.status,
    0,
    `${ignoredAgentTerms.stdout}\n${ignoredAgentTerms.stderr}`,
  );

  writeFileSync(
    join(root, "broken.md"),
    "### Corpus heading\n\n這是 MVP 版本。\n",
  );
  const corpusFailure = runLint();
  assert.notEqual(
    corpusFailure.status,
    0,
    "一般 corpus 違規仍必須讓 markdownlint 失敗",
  );
  assert.match(
    `${corpusFailure.stdout}\n${corpusFailure.stderr}`,
    /broken\.md/u,
  );
  const corpusTermFailure = runTermLint();
  assert.notEqual(
    corpusTermFailure.status,
    0,
    "一般 corpus 違規仍必須讓 textlint 失敗",
  );
  assert.match(
    `${corpusTermFailure.stdout}\n${corpusTermFailure.stderr}`,
    /broken\.md/u,
  );
});

test("contributor docs do not hard-code validation-chain counts", () => {
  const contributorDocs = [
    "文檔工程.md",
    "README.md",
    "ABOUT.en.md",
    join("流程", "升版.md"),
  ];
  const staleCountPattern =
    /九步聚合|九件檢查聚合|九件套|十五件套|nine-check/gu;
  const violations = contributorDocs.flatMap((relativePath) => {
    const matches = [
      ...readFileSync(join(REPO_ROOT, relativePath), "utf8").matchAll(
        staleCountPattern,
      ),
    ];
    return matches.map((match) => `${relativePath}: ${match[0]}`);
  });

  assert.deepEqual(
    violations,
    [],
    `驗證鏈件數不可硬編：${violations.join(", ")}`,
  );
});

test("docs site loads no third-party assets", () => {
  // 站台是公開可索引 origin,且第一用途是本機開檔檢視:外連字型會把讀者 IP 送往第三方,
  // 離線時又必然失敗。資安規範 §5 對外部資源要求 SRI 與 CSP 白名單缺一不可,此處兩者皆無。
  const mkdocs = readFileSync(join(REPO_ROOT, "mkdocs.yml"), "utf8");
  assert.match(mkdocs, /^\s{2}font: false$/mu);
  assert.match(mkdocs, /extra_javascript:[\s\S]*assets\/mermaid\.min\.js/u);
  assert.doesNotMatch(mkdocs, /https:\/\/(?:unpkg\.com|cdn\.jsdelivr\.net)/u);

  // Graphify 的圖頁有兩種形狀（drill 多檔與 graph.html 單檔）,兩條複製路徑都必須先硬化;
  // 只擋一條等於站上仍留著外連。
  const build = readFileSync(join(REPO_ROOT, "scripts", "build-site.mjs"), "utf8");
  // robots.txt 的 Sitemap 位址只能來自 mkdocs.yml 的 site_url,不得另寫一份 origin。
  const robots = readFileSync(
    join(REPO_ROOT, "scripts", "site-assets", "robots.txt"),
    "utf8",
  );
  assert.match(robots, /^Sitemap: \{SITE_URL\}sitemap\.xml$/mu);
  assert.doesNotMatch(robots, /https?:\/\//u);
  assert.match(build, /replaceAll\('\{SITE_URL\}'/u);
  assert.match(build, /site_url:\\s\*\(\\S\+\)/u);

  assert.match(build, /stagedGraphLibraries/u);
  assert.match(build, /graph\.html'\), hardenGraphHtml\(/u);
  assert.match(build, /const hardened = hardenGraphHtml\(/u);
  // 兩條舊的「原樣複製」路徑都不得復活——那正是外連上站的來源。
  assert.doesNotMatch(build, /endsWith\('\.html'\)\) copy\(path\.join\(drill/u);
  assert.doesNotMatch(build, /copy\(path\.join\(out, 'graph\.html'\)/u);
});

test("Jieba dictionaries are reproducible and project-scoped", () => {
  const pyproject = readFileSync(join(REPO_ROOT, "pyproject.toml"), "utf8");
  assert.match(pyproject, /"jieba==0\.42\.1"/u);

  const mkdocs = readFileSync(join(REPO_ROOT, "mkdocs.yml"), "utf8");
  assert.match(
    mkdocs,
    /jieba_dict: scripts\/search-dictionaries\/dict\.txt\.big/u,
  );
  assert.match(
    mkdocs,
    /jieba_dict_user: scripts\/search-dictionaries\/open4wd\.txt/u,
  );

  const dictionaryRoot = join(REPO_ROOT, "scripts", "search-dictionaries");
  const dictionaryPath = join(dictionaryRoot, "dict.txt.big");
  const metadataPath = join(dictionaryRoot, "dict.txt.big.source.json");
  const userDictionaryPath = join(dictionaryRoot, "open4wd.txt");
  assert.ok(existsSync(dictionaryPath), "缺少 repo-owned dict.txt.big");
  assert.ok(existsSync(metadataPath), "缺少 dict.txt.big provenance metadata");
  assert.ok(existsSync(userDictionaryPath), "缺少 Open4WD user dictionary");

  const dictionary = readFileSync(dictionaryPath);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const expectedDictionaryHash =
    "b16011275c42955ccd81fc1adecc93a59dbb7926af69d93fc95d4943d40f6aad";
  assert.equal(
    createHash("sha256").update(dictionary).digest("hex"),
    expectedDictionaryHash,
  );
  assert.deepEqual(metadata, {
    upstream:
      "https://raw.githubusercontent.com/fxsjy/jieba/237dc6625e5c65d7a2714ffdfa5238dba5cae7d4/extra_dict/dict.txt.big",
    commit: "237dc6625e5c65d7a2714ffdfa5238dba5cae7d4",
    sha256: expectedDictionaryHash,
    license: "MIT",
    copyright: "Copyright (c) 2013 Sun Junyi",
    licenseFile: "dict.txt.big.LICENSE",
  });
  // MIT 要求 copyright notice 與 permission notice 隨複本附上：vendored 詞典旁必須有上游 notice 全文。
  const licensePath = join(dictionaryRoot, metadata.licenseFile);
  assert.ok(existsSync(licensePath), "缺少 dict.txt.big 上游 MIT notice 檔");
  const licenseText = readFileSync(licensePath, "utf8");
  assert.match(licenseText, /Copyright \(c\) 2013 Sun Junyi/u);
  assert.match(licenseText, /Permission is hereby granted, free of charge/u);
  assert.match(
    licenseText,
    /The above copyright notice and this permission notice shall be included/u,
  );
  assert.deepEqual(
    readFileSync(userDictionaryPath, "utf8").trim().split(/\r?\n/u),
    ["觀戰流程", "決策記錄", "知識圖", "共識帳本", "配對流程"],
  );
});

test("pinning deployment canon covers one-shot operator environment variables", () => {
  const canon = readFileSync(
    join(REPO_ROOT, "部署資訊", "open-4wd-pinning.md"),
    "utf8",
  );
  const operatorSection =
    canon.match(
      /### 3\.4 Genesis one-shot 與維運腳本環境變數\s+(?<body>[\s\S]*?)(?=\n## 4\.)/u,
    )?.groups?.body ?? "";
  const requiredServiceVariables = [
    "CONFIG_PATH",
    "PORT",
    "LISTEN_WS",
    "BOOTSTRAP",
    "CLUSTER_API_URL",
    "KUBO_API_URL",
    "REPUTATION_THRESHOLD",
    "METRICS_HOST",
    "DMCA_DELIVERY_RETRY_BASE_MS",
    "DMCA_DELIVERY_RETRY_MAX_MS",
    "DMCA_BUSINESS_DAY_HOLIDAYS",
    "BOOTSTRAP_PEER_ID",
    "KUBO_PEERING_APP_MULTIADDR",
  ];
  const missingServiceVariables = requiredServiceVariables.filter(
    (variable) => !canon.includes(`\`${variable}\``),
  );
  assert.deepEqual(
    missingServiceVariables,
    [],
    `pinning 部署 canon 缺少 service／deploy env：${missingServiceVariables.join(", ")}`,
  );

  const requiredVariables = [
    "GENESIS_DATA_DIR",
    "GENESIS_RECEIPT_PATH",
    "GENESIS_LISTEN",
    "GENESIS_BOOTSTRAP",
    "GOVERNANCE_SIGNERS",
    "BOOTSTRAP_PEER_PRIVKEY",
    "GENESIS_RELEASE_COMMIT",
    "DATA_DIR",
    "DMCA_EXPORT_PASSPHRASE",
    "DMCA_PROVIDER_ID",
    "DMCA_NOTICE_STORE",
    "DMCA_EXPORT_OUT",
  ];
  const missing = requiredVariables.filter(
    (variable) => !operatorSection.includes(`\`${variable}\``),
  );

  assert.deepEqual(
    missing,
    [],
    `pinning 部署 canon 缺少 operator env：${missing.join(", ")}`,
  );
  assert.match(canon, /`IMAGE_OWNER`[^\n]*\| GitHub variable[^\n]*\*\*必填\*\*/u);
  assert.match(canon, /`IMAGE_TAG`[^\n]*\| GitHub variable[^\n]*\*\*必填\*\*/u);
  for (const command of [
    "pnpm ledger:genesis",
    "pnpm ledger:rebirth-proof -- --proof",
    "pnpm ledger:rebirth-proof -- --verify",
    "pnpm dmca:export --",
  ]) {
    assert.ok(canon.includes(command), `pinning runbook 缺少命令：${command}`);
  }
  assert.match(canon, /確認 token[^\n]*access log/u);
  assert.match(canon, /X-Forwarded-For[^\n]*不採信/u);
  assert.doesNotMatch(canon, /部署 repo/u);
});

test("pinning canon matches the template layout, service config, and ingress boundary", () => {
  const deployment = readFileSync(
    join(REPO_ROOT, "部署資訊", "open-4wd-pinning.md"),
    "utf8",
  );
  const architecture = readFileSync(
    join(REPO_ROOT, "程式架構", "pinning-service.md"),
    "utf8",
  );

  for (const directory of [
    "├── app/",
    "├── e2e/",
    "├── integration/",
    "│   ├── monitoring/",
  ]) {
    assert.ok(
      deployment.includes(directory),
      `pinning repo tree 缺少 ${directory}`,
    );
  }
  assert.match(deployment, /├── node\/.*libp2p/u);
  for (const scriptFamily of [
    "vendor-*",
    "ledger-genesis*",
    "dmca-export*",
    "smoke*",
    "workflow.spec.ts",
  ]) {
    assert.ok(
      deployment.includes(scriptFamily),
      `pinning scripts 摘要缺少 ${scriptFamily}`,
    );
  }

  assert.match(architecture, /"replication_factor_min": -1/u);
  assert.match(architecture, /"replication_factor_max": -1/u);
  assert.match(
    architecture,
    /"ipfshttp":\s*\{\s*"node_multiaddress": "\/dns4\/kubo\/tcp\/5001"/u,
  );
  assert.match(architecture, /標準 Ingress 只公開.*8000/u);
  assert.match(architecture, /tcp-services/u);
  assert.match(architecture, /LoadBalancer.*NodePort/u);
  assert.match(architecture, /TCP ingress CRD/u);
});

test("TURN deployment canon uses short-lived REST credentials for production smoke", () => {
  const canon = readFileSync(
    join(REPO_ROOT, "部署資訊", "open-4wd-turn.md"),
    "utf8",
  );
  assert.match(canon, /turnutils_uclient -u .* -w /u);
  assert.doesNotMatch(canon, /turnutils_uclient -W/u);
  assert.match(canon, /公版 CI.*公開樣本.*正式部署不可照抄/u);
  assert.match(canon, /test_security_policy\.py/u);
  assert.match(canon, /test_workflow_contract\.py/u);
  assert.match(canon, /scripts\/[\s\S]{0,80}comment quality/u);
  assert.match(canon, /│   ├── README\.md[^\n]*就地部署/u);
  assert.doesNotMatch(canon, /部署 repo/u);
});

test("SEO and Pages documentation matches generated-route and artifact deployment contracts", () => {
  const seo = readFileSync(join(REPO_ROOT, "程式架構", "seo.md"), "utf8");
  const deployment = readFileSync(join(REPO_ROOT, "部署資訊.md"), "utf8");

  assert.match(seo, /"discoverRoutes": false/u);
  assert.match(seo, /"routesFile": "ssg-routes\.txt"/u);
  assert.doesNotMatch(seo, /prerender builder，routes .*\/login/u);
  assert.match(deployment, /actions\/upload-pages-artifact/u);
  assert.match(deployment, /actions\/deploy-pages/u);
  assert.doesNotMatch(deployment, /Deploy 到 `?gh-pages`? 分支/u);
});

test("public specs surfaces declare lifecycle status and keep intake inside the specs repo", () => {
  const read = (relative) => readFileSync(join(REPO_ROOT, relative), "utf8");
  const readme = read("README.md");
  const about = read("ABOUT.en.md");
  const engineering = read("文檔工程.md");
  const lifecycle = read("專案生命週期.md");
  const contacts = read(".github/ISSUE_TEMPLATE/config.yml");

  assert.match(readme, /開發中.*主遊戲尚未正式公開/su);
  for (const directory of ["decisions/", "conformance/", "歷史記錄/"]) {
    assert.match(readme, new RegExp(directory.replace("/", "\\/"), "u"));
    assert.match(about, new RegExp(directory.replace("/", "\\/"), "u"));
  }
  assert.match(about, /under active development.*main game is not yet publicly available/isu);
  assert.match(about, /local MkDocs site can be built/iu);
  assert.doesNotMatch(about, /static MkDocs site is planned/iu);
  assert.doesNotMatch(engineering, /MkDocs，規劃中/u);
  assert.match(engineering, /本機可建置/u);
  assert.match(lifecycle, /啟用.*Discussions.*private vulnerability reporting.*contact links/isu);
  assert.match(contacts, /xjustloveux\/open-4wd-specs\/discussions/u);
  assert.match(contacts, /xjustloveux\/open-4wd-specs\/blob\/master\//u);
  assert.doesNotMatch(contacts, /xjustloveux\/open-4wd(?:\/|$)/u);
});

test("release lifecycle keeps optional backup outside the public dependency sequence", () => {
  const lifecycle = readFileSync(
    join(REPO_ROOT, "專案生命週期.md"),
    "utf8",
  );
  const releaseSection = lifecycle.match(
    /^## 5\. 首次公開的跨 repo 順序\s*$([\s\S]*?)^## 6\./mu,
  )?.[1];
  assert.ok(releaseSection, "缺少首次公開的跨 repo 順序章節");

  const firstStepOffset = releaseSection.search(/^1\. /mu);
  assert.notEqual(firstStepOffset, -1, "發布順序缺少第一個編號步驟");
  const preconditions = releaseSection.slice(0, firstStepOffset);
  const numberedSequence = releaseSection.slice(firstStepOffset);
  const steps = [...numberedSequence.matchAll(/^\d+\. ([\s\S]*?)(?=^\d+\. |\n`main_source_baseline_sha`)/gmu)].map(
    ([, step]) => step,
  );

  assert.match(preconditions, /private source backup/u);
  assert.match(preconditions, /不是發布.*baseline.*依賴驗證/su);
  assert.match(steps[0], /`open-4wd-specs`[\s\S]{0,40}轉 public/u);
  assert.doesNotMatch(numberedSequence, /^\d+\. .*private source backup/mu);

  const baselineFormationSteps = steps
    .map((step, index) => ({ index, step }))
    .filter(({ step }) => /形成 `main_source_baseline_sha`/u.test(step));
  assert.equal(baselineFormationSteps.length, 1);
  assert.ok(baselineFormationSteps[0].index > 0);
  assert.match(baselineFormationSteps[0].step, /`open-4wd` 保持 private/u);
});

function corpusDocument(body, type = "index") {
  return `---
type: ${type}
domain: []
summary: 測試站點
authority: null
slug: null
---
# 測試站點

${body}
`;
}

function createStageFixture(
  t,
  body,
  { favicon = Buffer.from("approved-favicon") } = {},
) {
  const workspace = mkdtempSync(join(tmpdir(), "open4wd-site-assets-"));
  const root = join(workspace, "open-4wd-specs");
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  mkdirSync(join(root, "scripts", "site-assets"), { recursive: true });
  mkdirSync(join(root, "node_modules", "mermaid", "dist"), { recursive: true });
  for (const name of [
    "build-site.mjs",
    "graph-html-hardening.mjs",
    "history-ledger.mjs",
    "lib.mjs",
  ]) {
    copyFileSync(join(REPO_ROOT, "scripts", name), join(root, "scripts", name));
  }
  const assetCollector = join(REPO_ROOT, "scripts", "site-assets.mjs");
  if (existsSync(assetCollector)) {
    copyFileSync(assetCollector, join(root, "scripts", "site-assets.mjs"));
  }
  const sourceCollector = join(REPO_ROOT, "scripts", "site-source-files.mjs");
  if (existsSync(sourceCollector)) {
    copyFileSync(
      sourceCollector,
      join(root, "scripts", "site-source-files.mjs"),
    );
  }
  const markdownAliases = join(
    REPO_ROOT,
    "scripts",
    "site-markdown-aliases.mjs",
  );
  if (existsSync(markdownAliases)) {
    copyFileSync(
      markdownAliases,
      join(root, "scripts", "site-markdown-aliases.mjs"),
    );
  }
  writeFileSync(join(root, "scripts", "site-source-files.json"), "[]\n");
  writeFileSync(join(root, "scripts", "site-assets", "mermaid-init.js"), "");
  writeFileSync(join(root, "scripts", "site-assets", "site.css"), "");
  writeFileSync(
    join(root, "scripts", "site-assets", "robots.txt"),
    "User-agent: *\nAllow: /\nSitemap: {SITE_URL}sitemap.xml\n",
  );
  // robots.txt 的 Sitemap 位址取自 mkdocs.yml 的 site_url,staging 因此需要真實設定檔。
  copyFileSync(join(REPO_ROOT, "mkdocs.yml"), join(root, "mkdocs.yml"));
  writeFileSync(
    join(root, "node_modules", "mermaid", "dist", "mermaid.min.js"),
    "",
  );
  const faviconSource = join(root, "美術資源", "實際使用圖");
  mkdirSync(faviconSource, { recursive: true });
  writeFileSync(join(faviconSource, "favicon-master.png"), favicon);
  const dictionaryRoot = join(root, "scripts", "search-dictionaries");
  mkdirSync(dictionaryRoot, { recursive: true });
  writeFileSync(join(dictionaryRoot, "dict.txt.big"), "測試 1\n");
  writeFileSync(join(dictionaryRoot, "open4wd.txt"), "觀戰聊天\n");
  writeFileSync(join(root, "總覽.md"), corpusDocument(body));
  writeFileSync(
    join(root, "專案生命週期.md"),
    `---
type: canon
domain: ["版本部署"]
summary: 測試生命週期
authority: null
slug: null
runtime_phase: pre_launch
---
# 專案生命週期
`,
  );
  mkdirSync(join(root, "decisions"), { recursive: true });
  writeFileSync(
    join(root, "decisions", "README.md"),
    "# 決策制度\n\n[決策索引](INDEX.md)\n",
  );
  writeFileSync(
    join(root, "decisions", "INDEX.md"),
    "# 決策索引\n\n[決策制度](README.md)\n",
  );
  return { workspace, root };
}

function runStage(root, environment = {}) {
  return spawnSync(
    process.execPath,
    [join(root, "scripts", "build-site.mjs"), "--stage-only"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
}

test("site staging leaves lifecycle detail to the homepage and canon page", (t) => {
  const { root } = createStageFixture(t, "首頁");
  const commit = "1234567890abcdef1234567890abcdef12345678";
  const updatedAt = "2026-08-16T12:34:56.000Z";

  const result = runStage(root, {
    OPEN4WD_SPECS_COMMIT: commit,
    OPEN4WD_SPECS_UPDATED_AT: updatedAt,
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(join(root, ".site-src", "overrides", "main.html")), false);
  assert.doesNotMatch(readFileSync(join(root, "mkdocs.build.yml"), "utf8"), /specs commit/u);
});

test("site navigation promotes conformance and graph and flattens only singleton README sections", (t) => {
  const { root } = createStageFixture(t, "首頁");
  writeFileSync(join(root, "一般規格.md"), corpusDocument("一般規格", "canon"));
  writeFileSync(join(root, "美術資源.md"), corpusDocument("美術資源", "art"));
  writeFileSync(join(root, "歷史記錄.md"), corpusDocument("歷史記錄", "history"));
  mkdirSync(join(root, "conformance"), { recursive: true });
  writeFileSync(
    join(root, "conformance", "README.md"),
    corpusDocument("Conformance", "registry"),
  );
  mkdirSync(join(root, "美術資源", "Immutable Release"), { recursive: true });
  writeFileSync(
    join(root, "美術資源", "Immutable Release", "README.md"),
    corpusDocument("Immutable Release", "art"),
  );
  mkdirSync(join(root, "美術資源", "提示詞"), { recursive: true });
  writeFileSync(
    join(root, "美術資源", "提示詞", "UI資產.md"),
    corpusDocument("UI資產", "art"),
  );
  writeFileSync(
    join(root, "美術資源", "提示詞", "頁面概念圖.md"),
    corpusDocument("頁面概念圖", "art"),
  );
  mkdirSync(
    join(root, "美術資源", "實際使用圖", "賽內倒數與起跑動畫"),
    { recursive: true },
  );
  writeFileSync(
    join(root, "美術資源", "實際使用圖", "賽內倒數與起跑動畫", "README.md"),
    corpusDocument("賽內倒數與起跑動畫原始工程", "art"),
  );
  mkdirSync(join(root, "歷史記錄"), { recursive: true });
  writeFileSync(
    join(root, "歷史記錄", "2026-08.md"),
    corpusDocument("歷史記錄 · 2026-08", "history"),
  );
  // 決策檔：選單要讓最新的在最上面，索引與制度說明仍置頂。
  writeFileSync(
    join(root, "decisions", "D-20260101-01-舊決策.md"),
    "# D-20260101-01 舊決策\n",
  );
  writeFileSync(
    join(root, "decisions", "D-20260202-01-新決策.md"),
    "# D-20260202-01 新決策\n",
  );

  const result = runStage(root);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const navigation = readFileSync(join(root, "mkdocs.build.yml"), "utf8");
  const home = navigation.indexOf('  - "index.md"');
  const conformance = navigation.indexOf('  - "conformance/README.md"');
  const graph = navigation.indexOf('  - "graph/index.md"');
  const ordinary = navigation.indexOf('  - "一般規格.md"');
  assert.ok(home < conformance && conformance < graph && graph < ordinary, navigation);
  assert.doesNotMatch(navigation, /\n      - "Immutable Release":/u);
  assert.match(navigation, /\n      - "美術資源\/Immutable Release\/README\.md"/u);
  assert.doesNotMatch(navigation, /\n      - "實際使用圖":/u);
  assert.match(
    navigation,
    /\n      - "美術資源\/實際使用圖\/賽內倒數與起跑動畫\/README\.md"/u,
  );
  const countdown = navigation.indexOf(
    '      - "美術資源/實際使用圖/賽內倒數與起跑動畫/README.md"',
  );
  const immutableRelease = navigation.indexOf(
    '      - "美術資源/Immutable Release/README.md"',
  );
  const prompts = navigation.indexOf('      - "提示詞":');
  assert.ok(countdown < prompts && immutableRelease < prompts, navigation);
  writeFileSync(
    join(root, "美術資源", "實際使用圖", "圖示資產.md"),
    corpusDocument("圖示資產", "art"),
  );
  const groupedResult = runStage(root);
  assert.equal(groupedResult.status, 0, `${groupedResult.stdout}\n${groupedResult.stderr}`);
  const groupedNavigation = readFileSync(join(root, "mkdocs.build.yml"), "utf8");
  assert.match(groupedNavigation, /\n      - "實際使用圖":/u);
  const decisions = navigation.indexOf('  - "決策記錄":');
  const history = navigation.indexOf('  - "歷史記錄":');
  assert.ok(decisions < history, navigation);
  const decisionIndex = navigation.indexOf('      - "decisions/decision-index.md"');
  const newerDecision = navigation.indexOf(
    '      - "decisions/D-20260202-01-新決策.md"',
  );
  const olderDecision = navigation.indexOf(
    '      - "decisions/D-20260101-01-舊決策.md"',
  );
  assert.ok(
    decisions < decisionIndex &&
      decisionIndex < newerDecision &&
      newerDecision < olderDecision &&
      olderDecision < history,
    navigation,
  );
  assert.match(navigation, /  - "歷史記錄":\n      - "歷史記錄\.md"\n      - "歷史記錄\/2026-08\.md"\s*$/u);
});

function findExecutable(name) {
  const lookup = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    [name],
    {
      encoding: "utf8",
    },
  );
  assert.equal(lookup.status, 0, lookup.stderr || `找不到 ${name}`);
  return lookup.stdout.trim().split(/\r?\n/)[0];
}

test("offline docs build uses the existing venv with a cold cache", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "open4wd-docs-toolchain-"));
  t.after(() => rmSync(bin, { recursive: true, force: true }));

  const uvName = process.platform === "win32" ? "uv.exe" : "uv";
  const uvCopy = join(bin, uvName);
  copyFileSync(findExecutable("uv"), uvCopy);
  chmodSync(uvCopy, 0o755);

  if (process.platform === "win32") {
    writeFileSync(join(bin, "mkdocs.cmd"), "@exit /b 91\r\n");
  } else {
    const poison = join(bin, "mkdocs");
    writeFileSync(poison, "#!/bin/sh\nexit 91\n");
    chmodSync(poison, 0o755);
  }

  const result = spawnSync(
    process.execPath,
    [join(REPO_ROOT, "scripts", "run-docs-uv.mjs"), "verify-offline"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
        UV_CACHE_DIR: join(bin, "cache"),
        UV_NO_PYTHON_DOWNLOADS: "1",
        UV_OFFLINE: "1",
      },
    },
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /Documentation built in/);
  const decisionGuide = readFileSync(
    join(REPO_ROOT, "site", "decisions", "index.html"),
    "utf8",
  );
  const decisionIndex = readFileSync(
    join(REPO_ROOT, "site", "decisions", "decision-index.html"),
    "utf8",
  );
  const historicalPage = readFileSync(
    join(REPO_ROOT, "site", "歷史記錄", "2026-05-24.html"),
    "utf8",
  );
  assert.match(decisionGuide, /決策記錄（ADR）/u);
  assert.doesNotMatch(
    decisionGuide,
    /本檔由 <code>pnpm check:decisions --write-index<\/code> 生成/u,
  );
  assert.match(decisionIndex, /決策索引（INDEX）/u);
  assert.match(
    decisionIndex,
    /本檔由 <code>pnpm check:decisions --write-index<\/code> 生成/u,
  );
  assert.doesNotMatch(
    historicalPage,
    /href="--"/u,
    "歷史占位引用不可在發布 HTML 中成為可點擊連結",
  );
  const home = readFileSync(join(REPO_ROOT, "site", "index.html"), "utf8");
  const homepageSource = readFileSync(join(REPO_ROOT, "總覽.md"), "utf8");
  assert.match(homepageSource, /href="歷史記錄\/[^"#]+\.md#/u);
  assert.doesNotMatch(homepageSource, /href="歷史記錄\/[^"#]+\.html#/u);
  assert.match(home, /href="歷史記錄\/[^"#]+\.html#/u);
  assert.doesNotMatch(home, /href="歷史記錄\/[^"#]+\.md#/u);
  assert.match(
    home,
    /<link rel="canonical" href="https:\/\/docs\.open4wd\.org\/index\.html">/u,
  );
  assert.match(home, /<link rel="icon" href="assets\/open4wd-favicon\.png">/u);
  assert.doesNotMatch(home, /class="o4-lifecycle-banner"/u);
  assert.match(home, /主遊戲尚未正式公開/u);
  assert.doesNotMatch(home, /specs commit/u);
  assert.doesNotMatch(decisionGuide, /class="o4-lifecycle-banner"/u);
  assert.match(
    home,
    /<img[^>]+src="assets\/open4wd-favicon\.png"[^>]+alt="logo">/u,
  );
  const searchIndexPath = join(
    REPO_ROOT,
    "site",
    "search",
    "search_index.json",
  );
  const searchIndex = JSON.parse(readFileSync(searchIndexPath, "utf8"));
  const searchable = searchIndex.docs
    .flatMap(({ title = "", text = "" }) => [title, text])
    .join("\n");
  for (const term of [
    "觀戰流程",
    "決策記錄",
    "知識圖",
    "共識帳本",
    "配對流程",
  ]) {
    assert.match(
      searchable,
      new RegExp(`(?:^|\\u200b)${term}(?:\\u200b|$)`, "u"),
      `${term} 必須是完整的 Jieba token`,
    );
  }
  for (const term of [
    "Open4WD",
    "Mini 4WD",
    "Graphify",
    "ledger",
    "pinning",
    "signaling",
  ]) {
    assert.ok(searchable.includes(term), `${term} 必須原樣保留於搜尋索引`);
  }
  assert.ok(
    readFileSync(searchIndexPath).byteLength < 8_873_356,
    "Jieba 索引不得超過無 Jieba 基準的兩倍",
  );
});

test("site branding stages the approved favicon bytes", (t) => {
  const favicon = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const { root } = createStageFixture(t, "無媒體引用", { favicon });

  const result = runStage(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(
    readFileSync(join(root, ".site-src", "assets", "open4wd-favicon.png")),
    favicon,
  );
});

test("site staging demotes exact placeholder links only in historical documents", (t) => {
  const { root } = createStageFixture(t, "無歷史占位引用");
  const historyRoot = join(root, "歷史記錄");
  mkdirSync(historyRoot, { recursive: true });
  const historySource = corpusDocument(
    `保留[有效引用](../總覽.md)，降級[舊引用](--)。

行內範例 \`[示例](--)\` 保持原樣，圖片 ![舊圖](--) 也不視為連結。

\`\`\`md
[程式碼範例](--)
\`\`\``,
    "history",
  );
  const snapshotSource = corpusDocument(
    "快照中的[舊引用](--)也必須降級。",
    "snapshot",
  );
  writeFileSync(join(historyRoot, "歷史測試.md"), historySource);
  writeFileSync(join(historyRoot, "快照測試.md"), snapshotSource);

  const result = runStage(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    readFileSync(join(historyRoot, "歷史測試.md"), "utf8"),
    historySource,
    "canonical 歷史來源不可被 staging 改寫",
  );
  assert.equal(
    readFileSync(join(historyRoot, "快照測試.md"), "utf8"),
    snapshotSource,
    "canonical 快照來源不可被 staging 改寫",
  );
  const stagedHistory = readFileSync(
    join(root, ".site-src", "歷史記錄", "歷史測試.md"),
    "utf8",
  );
  const stagedSnapshot = readFileSync(
    join(root, ".site-src", "歷史記錄", "快照測試.md"),
    "utf8",
  );
  assert.match(stagedHistory, /\[有效引用\]\(\.\.\/總覽\.md\)/u);
  assert.match(stagedHistory, /降級舊引用。/u);
  assert.doesNotMatch(stagedHistory, /降級\[舊引用\]\(--\)/u);
  assert.match(stagedHistory, /`\[示例\]\(--\)`/u);
  assert.match(stagedHistory, /!\[舊圖\]\(--\)/u);
  assert.match(stagedHistory, /\[程式碼範例\]\(--\)/u);
  assert.match(stagedSnapshot, /快照中的舊引用也必須降級。/u);
  assert.doesNotMatch(stagedSnapshot, /\]\(--\)/u);
});

test("site staging fails when a required site input is missing", (t) => {
  const requiredInputs = [
    join("美術資源", "實際使用圖", "favicon-master.png"),
    join("scripts", "search-dictionaries", "dict.txt.big"),
    join("scripts", "search-dictionaries", "open4wd.txt"),
  ];

  for (const input of requiredInputs) {
    const { root } = createStageFixture(t, "中文搜尋");
    rmSync(join(root, input));

    const result = runStage(root);

    assert.notEqual(result.status, 0, `缺少 ${input} 不可靜默退回舊產物`);
    assert.ok(
      `${result.stdout}\n${result.stderr}`.includes(input),
      `錯誤訊息必須指出缺少的輸入：${input}`,
    );
  }
});

test("site staging copies a referenced local media file", (t) => {
  const { root } = createStageFixture(t, "[美術圖](media/example.png)");
  const source = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  mkdirSync(join(root, "media"), { recursive: true });
  writeFileSync(join(root, "media", "example.png"), source);

  const result = runStage(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const stagedAsset = join(root, ".site-src", "media", "example.png");
  assert.ok(
    existsSync(stagedAsset),
    "被 corpus 引用的本地媒體必須進入 staging",
  );
  assert.deepEqual(readFileSync(stagedAsset), source);
});

test("site staging fails when a referenced local media file is missing", (t) => {
  const { root } = createStageFixture(t, "[缺少的圖](media/missing.png)");

  const result = runStage(root);

  assert.notEqual(result.status, 0, "缺少的本地媒體不可被靜默略過");
  assert.match(`${result.stdout}\n${result.stderr}`, /media[/\\]missing\.png/);
});

test("site staging rejects a referenced media path outside the repository", (t) => {
  const { workspace, root } = createStageFixture(t, "[越界圖](../outside.png)");
  writeFileSync(join(workspace, "outside.png"), "outside");

  const result = runStage(root);

  assert.notEqual(result.status, 0, "repo 外的媒體不可進入站點 staging");
  assert.match(`${result.stdout}\n${result.stderr}`, /\.\.[/\\]outside\.png/);
});

test("site staging publishes an allowlisted hidden source at a public path and only rewrites the staged link", (t) => {
  const originalLink = ".github/workflows/docs-ci.yml";
  const publicPath = "repo-source/github/workflows/docs-ci.yml";
  const { root } = createStageFixture(t, `[文件 CI](${originalLink})`);
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(join(root, originalLink), "name: docs\n");
  writeFileSync(
    join(root, "scripts", "site-source-files.json"),
    `${JSON.stringify([{ source: originalLink, publicPath }], null, 2)}\n`,
  );

  const result = runStage(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    readFileSync(join(root, ".site-src", publicPath), "utf8"),
    "name: docs\n",
  );
  assert.match(
    readFileSync(join(root, ".site-src", "總覽.md"), "utf8"),
    /\(repo-source\/github\/workflows\/docs-ci\.yml\)/,
  );
  assert.match(
    readFileSync(join(root, ".site-src", "index.md"), "utf8"),
    /\(repo-source\/github\/workflows\/docs-ci\.yml\)/,
  );
  assert.match(
    readFileSync(join(root, "總覽.md"), "utf8"),
    /\(\.github\/workflows\/docs-ci\.yml\)/,
  );
});

test("site staging rejects a linked local source file that is not allowlisted", (t) => {
  const { root } = createStageFixture(t, "[工具](scripts/unlisted.mjs)");
  writeFileSync(join(root, "scripts", "unlisted.mjs"), "export {};\n");

  const result = runStage(root);

  assert.notEqual(
    result.status,
    0,
    "repo 原始檔不可未經白名單進入或遺漏於站點",
  );
  assert.match(`${result.stdout}\n${result.stderr}`, /未列入.*白名單/u);
});

test("site staging fails when an allowlisted source file is missing", (t) => {
  const { root } = createStageFixture(t, "[工具](scripts/missing.mjs)");
  writeFileSync(
    join(root, "scripts", "site-source-files.json"),
    `${JSON.stringify(
      [
        {
          source: "scripts/missing.mjs",
          publicPath: "repo-source/scripts/missing.mjs",
        },
      ],
      null,
      2,
    )}\n`,
  );

  const result = runStage(root);

  assert.notEqual(result.status, 0, "白名單來源缺檔不可被靜默略過");
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /scripts[/\\]missing\.mjs.*找不到/u,
  );
});

test("site staging rejects a source allowlist path outside the repository", (t) => {
  const { workspace, root } = createStageFixture(t, "無來源連結");
  writeFileSync(join(workspace, "outside.yml"), "outside\n");
  writeFileSync(
    join(root, "scripts", "site-source-files.json"),
    `${JSON.stringify(
      [{ source: "../outside.yml", publicPath: "repo-source/outside.yml" }],
      null,
      2,
    )}\n`,
  );

  const result = runStage(root);

  assert.notEqual(result.status, 0, "repo 外的來源不可進入站點 staging");
  assert.match(`${result.stdout}\n${result.stderr}`, /來源路徑越界/u);
});

test("site staging rejects a source allowlist public path outside staging", (t) => {
  const { root } = createStageFixture(t, "[工具](scripts/tool.mjs)");
  writeFileSync(join(root, "scripts", "tool.mjs"), "export {};\n");
  writeFileSync(
    join(root, "scripts", "site-source-files.json"),
    `${JSON.stringify(
      [{ source: "scripts/tool.mjs", publicPath: "../tool.mjs" }],
      null,
      2,
    )}\n`,
  );

  const result = runStage(root);

  assert.notEqual(result.status, 0, "發布目的地不可離開 staging");
  assert.match(`${result.stdout}\n${result.stderr}`, /發布路徑越界/u);
});

test("decision index staging alias prevents the README and INDEX output collision", (t) => {
  const { root } = createStageFixture(
    t,
    "[決策制度](decisions/README.md)／[決策索引](decisions/INDEX.md)",
  );
  mkdirSync(join(root, "decisions"), { recursive: true });
  writeFileSync(
    join(root, "decisions", "README.md"),
    "# 決策制度\n\n[決策索引](INDEX.md)\n",
  );
  writeFileSync(
    join(root, "decisions", "INDEX.md"),
    "# 決策索引\n\n[決策制度](README.md)\n",
  );

  const result = runStage(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.ok(existsSync(join(root, ".site-src", "decisions", "README.md")));
  assert.ok(
    existsSync(join(root, ".site-src", "decisions", "decision-index.md")),
  );
  assert.ok(!existsSync(join(root, ".site-src", "decisions", "INDEX.md")));
  assert.match(
    readFileSync(join(root, ".site-src", "總覽.md"), "utf8"),
    /\(decisions\/decision-index\.md\)/,
  );
  assert.match(
    readFileSync(join(root, ".site-src", "decisions", "README.md"), "utf8"),
    /\(decision-index\.md\)/,
  );
  assert.match(
    readFileSync(
      join(root, ".site-src", "decisions", "decision-index.md"),
      "utf8",
    ),
    /\(README\.md\)/,
  );
  assert.match(
    readFileSync(join(root, "總覽.md"), "utf8"),
    /\(decisions\/INDEX\.md\)/,
  );
  assert.match(
    readFileSync(join(root, "decisions", "README.md"), "utf8"),
    /\(INDEX\.md\)/,
  );
});
