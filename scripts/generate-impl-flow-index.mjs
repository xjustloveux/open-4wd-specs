import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const HEADER_START = "<!-- generated:impl-flow-header:start -->";
const HEADER_END = "<!-- generated:impl-flow-header:end -->";
const BACKLINK_START = "<!-- generated:impl-flow-backlink:start -->";
const BACKLINK_END = "<!-- generated:impl-flow-backlink:end -->";
const INDEX_START = "<!-- generated:impl-flow-index:start -->";
const INDEX_END = "<!-- generated:impl-flow-index:end -->";

const FLOWS = [
  { name: "anti-piracy.md", module: "anti-piracy/", canon: [["版權", "../../版權.md"], ["檢舉與仲裁", "../../流程/檢舉與仲裁.md"]] },
  { name: "chat-system.md", module: "chat-system/", canon: [["賽內機制", "../../賽內機制.md"], ["配對", "../../流程/配對.md"]] },
  { name: "i18n.md", module: "i18n/", canon: [["語系清單", "../../語系清單.md"]] },
  { name: "ledger.md", module: "ledger/", canon: [["資料系統", "../../資料系統.md"], ["比賽結算", "../../流程/比賽結算.md"]] },
  { name: "matchmaking.md", module: "matchmaking/", canon: [["配對", "../../流程/配對.md"], ["比賽結算", "../../流程/比賽結算.md"]] },
  { name: "network-sync.md", module: "network-sync/", canon: [["比賽進行", "../../流程/比賽進行.md"]] },
  { name: "peer-discovery.md", module: "peer-discovery/", canon: [["配對", "../../流程/配對.md"]] },
  { name: "pwa-offline.md", module: "pwa-offline/", canon: [["玩家整體旅程", "../../流程/玩家整體旅程.md"], ["遊戲機制", "../../遊戲機制.md"]] },
  { name: "signaling-service.md", module: "signaling-service/", canon: [["配對", "../../流程/配對.md"], ["資安規範", "../../資安規範.md"]] },
  { name: "spectator.md", module: "spectator/", canon: [["觀戰", "../../流程/觀戰.md"]] },
  { name: "testing.md", module: "testing/", canon: [["程式架構", "../../程式架構.md"], ["升版", "../../流程/升版.md"]] },
  { name: "ugc-fork.md", module: "ugc-fork/", canon: [["UGC 機制", "../../UGC機制.md"], ["衍生", "../../流程/衍生.md"]] },
  { name: "versioning.md", module: "versioning/", canon: [["版本規範", "../../版本規範.md"], ["升版", "../../流程/升版.md"]] },
];

const changed = [];

function replaceManaged(source, start, end, block) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex >= 0 && endIndex > startIndex) {
    return source.slice(0, startIndex) + block + source.slice(endIndex + end.length);
  }
  const title = source.match(/^# .+$/mu);
  if (!title) throw new Error("document has no H1");
  const insertAt = title.index + title[0].length;
  return source.slice(0, insertAt) + `\n\n${block}` + source.slice(insertAt).replace(/^\r?\n*/u, "\n");
}

function stage(relative, desired) {
  const full = path.join(REPO_ROOT, relative);
  const current = fs.readFileSync(full, "utf8");
  if (current === desired) return;
  changed.push(relative.replaceAll(path.sep, "/"));
  if (!CHECK) fs.writeFileSync(full, desired, "utf8");
}

for (const flow of FLOWS) {
  const flowRelative = path.join("程式架構", "程式流程", flow.name);
  const flowFull = path.join(REPO_ROOT, flowRelative);
  let source = fs.readFileSync(flowFull, "utf8");
  source = source.replace(/^authority:.*$/mu, `authority: 程式架構/${flow.name}`);
  const canonLinks = flow.canon.map(([label, target]) => `[${label}](${target})`).join(" · ");
  const header = [
    HEADER_START,
    "> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。",
    "",
    "| Implementation authority | 產品 canon／流程 | 全域索引 |",
    "| --- | --- | --- |",
    `| [${flow.name}](../${flow.name}) | ${canonLinks} | [流程.md §2](../../流程.md#2-各模組流程圖索引) |`,
    HEADER_END,
  ].join("\n");
  source = replaceManaged(source, HEADER_START, HEADER_END, header);
  stage(flowRelative, source);

  const authorityRelative = path.join("程式架構", flow.name);
  const authorityFull = path.join(REPO_ROOT, authorityRelative);
  let authority = fs.readFileSync(authorityFull, "utf8");
  const backlink = [
    BACKLINK_START,
    `> 對應 implementation flow：[程式流程/${flow.name}](程式流程/${flow.name})。`,
    BACKLINK_END,
  ].join("\n");
  authority = replaceManaged(authority, BACKLINK_START, BACKLINK_END, backlink);
  stage(authorityRelative, authority);
}

const indexRelative = "流程.md";
const indexFull = path.join(REPO_ROOT, indexRelative);
const indexCurrent = fs.readFileSync(indexFull, "utf8");
const rows = FLOWS.map((flow) => {
  const canonLinks = flow.canon
    .map(([label, target]) => `[${label}](${target.replace(/^\.\.\/\.\.\//u, "")})`)
    .join(" · ");
  return `| \`${flow.module}\` | [程式架構/${flow.name}](程式架構/${flow.name}) | [程式架構/程式流程/${flow.name}](程式架構/程式流程/${flow.name}) | ${canonLinks} |`;
});
const indexBlock = [
  INDEX_START,
  "| 模組 | Implementation authority | 技術流程圖 | 產品 canon／流程 |",
  "| --- | --- | --- | --- |",
  ...rows,
  INDEX_END,
].join("\n");
const section2 = indexCurrent.indexOf("## 2. 各模組流程圖索引");
const section3 = indexCurrent.indexOf("## 3. 圖表工具與風格規範");
if (section2 < 0 || section3 <= section2) throw new Error("流程.md section markers missing");
const section2Prefix = [
  "## 2. 各模組流程圖索引",
  "",
  "mermaid 流程圖按性質分流：程式／技術流程圖由下表自 13 份 `impl-flow` frontmatter 與固定表頭投影；業務／治理／遊戲流程位於對應 `流程/*.md`。",
  "",
  indexBlock,
  "",
].join("\n");
const indexDesired = indexCurrent.slice(0, section2) + section2Prefix + indexCurrent.slice(section3);
stage(indexRelative, indexDesired);

console.log(JSON.stringify({ mode: CHECK ? "check" : "write", flows: FLOWS.length, stale: changed }, null, 2));
if (CHECK && changed.length > 0) process.exit(1);
