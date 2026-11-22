// 規則 ID registry 生成與驗證；契約見文檔工程.md §6。
// 單一權威＝canon 內文的 〔PREFIX-R-nnn〕 標記：**〔ID〕**＝主錨（每 ID 恰一）、〔ID〕＝引用錨（0+）。
// 產出 rules.json（derived、commit）；`--check`＝重生成比對、過期 exit 1；驗證＝主錨唯一性＋各域連號。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkMd, rel } from "./lib.mjs";
import {
  expandRuleContracts,
  validateRuleContractJoin,
} from "./rule-contract-schema.mjs";

const rootIndex = process.argv.indexOf("--root");
if (rootIndex >= 0 && !process.argv[rootIndex + 1]) {
  throw new Error("--root 需要目錄路徑");
}
const REPO_ROOT =
  rootIndex >= 0
    ? path.resolve(process.argv[rootIndex + 1])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const PREFIXES = [
  "LEDGER",
  "ECON",
  "MOD",
  "PHYS",
  "TRACK",
  "PART",
  "UGC",
  "VERSION",
  "SEC",
];

const rules = new Map(); // id -> { anchor: {file,line,excerpt} | null, refs: [{file,line}] }
const violations = [];
const contracts = expandRuleContracts(
  JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "rule-contracts.json"), "utf8"),
  ),
);
for (const full of walkMd(REPO_ROOT)) {
  const r = rel(REPO_ROOT, full);
  if (r.startsWith("decisions/") || r === "docs-map.md") continue; // 決策檔與生成物不掛規則主錨
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re =
      /〔((?:LEDGER|ECON|MOD|PHYS|TRACK|PART|UGC|VERSION|SEC)-R-\d{3})〕/g;
    const markers = [...line.matchAll(re)].map((m) => ({
      match: m,
      bold:
        line.slice(Math.max(0, m.index - 2), m.index) === "**" &&
        line.slice(m.index + m[0].length, m.index + m[0].length + 2) ===
          "**",
    }));
    const primaryAnchors = markers.filter((marker) => marker.bold);
    if (primaryAnchors.length > 1) {
      violations.push(`${r}:${i + 1} 一行至多一個主錨`);
    }
    for (const { match: m, bold } of markers) {
      const id = m[1];
      if (!rules.has(id)) rules.set(id, { anchor: null, refs: [] });
      const entry = rules.get(id);
      if (bold) {
        if (entry.anchor)
          violations.push(
            `${id} 主錨重複：${entry.anchor.file}:${entry.anchor.line} 與 ${r}:${i + 1}`,
          );
        else {
          const excerpt = line
            .replace(/\*\*〔[^〕]+〕\*\*\s*/g, "")
            .trim()
            .slice(0, 80);
          entry.anchor = {
            file: r,
            line: i + 1,
            excerpt,
          };
          if (!excerpt) violations.push(`${id} 主錨 excerpt 不得為空`);
        }
      } else entry.refs.push({ file: r, line: i + 1 });
    }
  }
}
for (const [id, entry] of rules) {
  if (!entry.anchor) violations.push(`${id} 缺主錨（僅引用錨）`);
}
try {
  validateRuleContractJoin(new Set(rules.keys()), contracts);
} catch (error) {
  violations.push(error.message);
}
for (const prefix of PREFIXES) {
  const nums = [...rules.keys()]
    .filter((id) => id.startsWith(prefix))
    .map((id) => Number(id.slice(-3)))
    .sort((a, b) => a - b);
  for (let expect = 1; expect <= (nums[nums.length - 1] ?? 0); expect++) {
    if (!nums.includes(expect))
      violations.push(`${prefix} 連號缺 ${String(expect).padStart(3, "0")}`);
  }
}

const doc = {
  generatedBy: "rules:generate",
  counts: Object.fromEntries(
    PREFIXES.map((p) => [
      p,
      [...rules.keys()].filter((id) => id.startsWith(p)).length,
    ]),
  ),
  rules: [...rules.entries()]
    .map(([id, e]) => {
      const contract = contracts.get(id);
      return {
        id,
        kind: contract?.kind,
        requiredLayers: contract?.requiredLayers,
        implementationRepos: contract?.implementationRepos,
        testContracts: contract?.testContracts,
        ...(contract?.calibration === undefined
          ? {}
          : { calibration: contract.calibration }),
        anchor: e.anchor,
        refs: e.refs,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1)),
};
const OUT = path.join(REPO_ROOT, "rules.json");
const wanted = `${JSON.stringify(doc, null, 2)}\n`;
if (CHECK) {
  const current = fs.existsSync(OUT)
    ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n")
    : null;
  if (current !== wanted)
    violations.push("rules.json 過期——執行 pnpm rules:generate 重生成");
} else {
  fs.writeFileSync(OUT, wanted);
}
console.log(
  JSON.stringify(
    {
      mode: CHECK ? "check" : "write",
      ids: rules.size,
      counts: doc.counts,
      violations: violations.length,
    },
    null,
    2,
  ),
);
for (const v of violations) console.log(`✗ ${v}`);
if (violations.length > 0) process.exit(1);
