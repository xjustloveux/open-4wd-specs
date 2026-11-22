/** Owner-scoped 規則 ID → 測試追溯檢查器。缺測、ghost 與 ownership 錯置皆為硬錯。 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RULE_PREFIX = "(?:LEDGER|ECON|MOD|PHYS|TRACK|PART|UGC|VERSION|SEC)";
const ID_RE = new RegExp(`〔(${RULE_PREFIX}-R-\\d{3})〕`, "g");
const CONFORMANCE_RE = new RegExp(
  `ruleConformance\\s*\\(\\s*\\{\\s*ruleId:\\s*["'](${RULE_PREFIX}-R-\\d{3})["']\\s*,\\s*layer:\\s*["']([a-z-]+)["']\\s*,\\s*contract:\\s*["']([a-z0-9-]+)["']`,
  "gu",
);
const HARNESS_IMPORT_RE =
  /import\s*\{\s*ruleConformance\s*\}\s*from\s*["'][^"']*rule-conformance["']/u;

function parseArgs(argv) {
  let rulesPath = resolve(repoRoot, "rules.json");
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rules") {
      if (!argv[i + 1]) throw new Error("--rules 缺少路徑");
      rulesPath = resolve(argv[++i]);
      continue;
    }
    if (argv[i] === "--target") {
      const value = argv[++i];
      const separator = value?.indexOf("=") ?? -1;
      if (separator <= 0 || separator === value.length - 1)
        throw new Error("--target 必須是 <repo-id>=<test-root>");
      targets.push({
        repo: value.slice(0, separator),
        root: resolve(value.slice(separator + 1)),
      });
      continue;
    }
    throw new Error(`未知參數：${argv[i]}`);
  }
  if (targets.length === 0) throw new Error("至少需要一個 --target");
  return { rulesPath, targets };
}

function collectSpecFiles(root, files) {
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    if (statSync(path).isDirectory()) collectSpecFiles(path, files);
    else if (name.endsWith(".spec.ts")) files.push(path);
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`check-trace: ${error.message}`);
    return 1;
  }

  if (!existsSync(options.rulesPath)) {
    console.error(`check-trace: 找不到 rules.json（${options.rulesPath}）`);
    return 1;
  }
  const registry = JSON.parse(readFileSync(options.rulesPath, "utf8"));
  const rules = new Map(registry.rules.map((rule) => [rule.id, rule]));
  const knownRepos = new Set(
    registry.rules.flatMap((rule) =>
      Array.isArray(rule.implementationRepos) ? rule.implementationRepos : [],
    ),
  );
  for (const target of options.targets) {
    if (!knownRepos.has(target.repo)) {
      console.error(
        `check-trace: target repo 不在 ownership registry：${target.repo}`,
      );
      return 1;
    }
    if (!existsSync(target.root)) {
      console.error(`check-trace: 找不到 test root（${target.root}）`);
      return 1;
    }
  }

  const hits = new Map();
  const ghosts = [];
  const ownershipErrors = [];
  const conformanceErrors = [];
  const conformanceHits = new Map();
  let scannedFiles = 0;
  for (const target of options.targets) {
    const specFiles = [];
    collectSpecFiles(target.root, specFiles);
    scannedFiles += specFiles.length;
    for (const file of specFiles) {
      const source = readFileSync(file, "utf8");
      const lines = source.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const match of lines[i].matchAll(ID_RE)) {
          const id = match[1];
          const location = `${relative(target.root, file).replaceAll("\\", "/")}:${i + 1}`;
          const rule = rules.get(id);
          if (!rule) {
            ghosts.push({ id, repo: target.repo, location });
            continue;
          }
          if (!rule.implementationRepos.includes(target.repo)) {
            ownershipErrors.push({ id, repo: target.repo, location });
            continue;
          }
          if (!hits.has(id)) hits.set(id, []);
          hits.get(id).push({ repo: target.repo, location });
        }
      }
      for (const match of source.matchAll(CONFORMANCE_RE)) {
        const [declaration, id, layer, contract] = match;
        const line = source.slice(0, match.index).split(/\r?\n/).length;
        const location = `${relative(target.root, file).replaceAll("\\", "/")}:${line}`;
        const rule = rules.get(id);
        if (!rule) {
          ghosts.push({ id, repo: target.repo, location });
          continue;
        }
        if (!rule.implementationRepos.includes(target.repo)) {
          ownershipErrors.push({ id, repo: target.repo, location });
          continue;
        }
        if (!hits.has(id)) hits.set(id, []);
        hits.get(id).push({ repo: target.repo, location });

        const dedicatedFile = file.endsWith(".conformance.spec.ts");
        const importsHarness = HARNESS_IMPORT_RE.test(source);
        const expectedContract = rule.testContracts?.[layer];
        if (
          !dedicatedFile ||
          !importsHarness ||
          !Array.isArray(rule.requiredLayers) ||
          !rule.requiredLayers.includes(layer) ||
          expectedContract !== contract
        ) {
          conformanceErrors.push({
            id,
            layer,
            contract,
            repo: target.repo,
            location,
            reason: !dedicatedFile
              ? "檔名必須為 *.conformance.spec.ts"
              : !importsHarness
                ? "缺 canonical rule-conformance import"
                : expectedContract === undefined
                  ? "layer 未由規則宣告"
                  : `contract 應為 ${expectedContract}`,
          });
          continue;
        }
        const tuple = `${id}:${layer}:${contract}`;
        if (!conformanceHits.has(tuple)) conformanceHits.set(tuple, []);
        conformanceHits.get(tuple).push({
          repo: target.repo,
          location,
          declaration,
        });
      }
    }
  }

  const targetRepos = [
    ...new Set(options.targets.map((target) => target.repo)),
  ];
  const ownedRules = registry.rules.filter((rule) =>
    rule.implementationRepos.some((repo) => targetRepos.includes(repo)),
  );
  const uncovered = ownedRules
    .filter((rule) => !hits.has(rule.id))
    .map((rule) => rule.id);
  const invalidContracts = ownedRules.flatMap((rule) => {
    if (
      !Array.isArray(rule.requiredLayers) ||
      rule.requiredLayers.length === 0 ||
      rule.testContracts === null ||
      typeof rule.testContracts !== "object"
    )
      return [`${rule.id}: registry 缺 requiredLayers/testContracts`];
    return rule.requiredLayers
      .filter(
        (layer) =>
          typeof rule.testContracts[layer] !== "string" ||
          rule.testContracts[layer].length === 0,
      )
      .map((layer) => `${rule.id}:${layer}: registry 缺 test contract`);
  });
  const requiredConformance = ownedRules.flatMap((rule) =>
    Array.isArray(rule.requiredLayers)
      ? rule.requiredLayers.map(
          (layer) => `${rule.id}:${layer}:${rule.testContracts?.[layer] ?? "<missing>"}`,
        )
      : [],
  );
  const missingConformance = requiredConformance.filter(
    (tuple) => !conformanceHits.has(tuple),
  );
  const duplicateConformance = [...conformanceHits.entries()].filter(
    ([, declarations]) => declarations.length > 1,
  );
  const annotated = [...hits.values()].reduce(
    (count, locations) => count + locations.length,
    0,
  );

  console.log(`check-trace: 掃描 ${scannedFiles} 個 spec 檔`);
  for (const repo of targetRepos) {
    const owned = registry.rules.filter((rule) =>
      rule.implementationRepos.includes(repo),
    );
    const covered = owned.filter((rule) => hits.has(rule.id)).length;
    console.log(`  ${repo}: ${covered}/${owned.length} 條規則有測試標註`);
  }
  console.log(
    `  標註總數 ${annotated} 處、覆蓋規則 ${hits.size}/${ownedRules.length}`,
  );
  if (uncovered.length > 0) {
    console.error(`check-trace: 缺少測試標註 ${uncovered.length} 條：`);
    console.error(`  ${uncovered.join(" ")}`);
  }

  if (ghosts.length > 0) {
    console.error(
      `check-trace: ${ghosts.length} 個 ghost 規則 ID（registry 不存在）：`,
    );
    for (const item of ghosts)
      console.error(`  ${item.id} @ ${item.repo}:${item.location}`);
  }
  if (ownershipErrors.length > 0) {
    console.error(
      `check-trace: ${ownershipErrors.length} 個 ownership 錯置標註：`,
    );
    for (const item of ownershipErrors)
      console.error(`  ${item.id} @ ${item.repo}:${item.location}`);
  }
  if (invalidContracts.length > 0) {
    console.error(`check-trace: ${invalidContracts.length} 個 registry contract 錯誤：`);
    for (const item of invalidContracts) console.error(`  ${item}`);
  }
  if (missingConformance.length > 0) {
    console.error(`check-trace: 缺少 conformance ${missingConformance.length} 個：`);
    console.error(`  ${missingConformance.join(" ")}`);
  }
  if (conformanceErrors.length > 0) {
    console.error(`check-trace: ${conformanceErrors.length} 個錯誤 conformance：`);
    for (const item of conformanceErrors)
      console.error(
        `  ${item.id}:${item.layer}:${item.contract} @ ${item.repo}:${item.location}（${item.reason}）`,
      );
  }
  if (duplicateConformance.length > 0) {
    console.error(`check-trace: ${duplicateConformance.length} 個重複 conformance：`);
    for (const [tuple, declarations] of duplicateConformance)
      console.error(
        `  ${tuple} @ ${declarations.map((item) => `${item.repo}:${item.location}`).join(", ")}`,
      );
  }
  if (
    uncovered.length > 0 ||
    ghosts.length > 0 ||
    ownershipErrors.length > 0 ||
    invalidContracts.length > 0 ||
    missingConformance.length > 0 ||
    conformanceErrors.length > 0 ||
    duplicateConformance.length > 0
  )
    return 1;
  console.log(
    "check-trace: OK（所有 owned 規則皆有一般證據與逐層 conformance，且無 ghost、ownership 或 contract 錯置）",
  );
  return 0;
}

process.exitCode = main();
