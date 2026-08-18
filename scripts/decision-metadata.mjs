// ADR metadata 邊界：files 是安全的歷史 repo-relative path；vectors 是穩定 family ID。
import fs from "node:fs";
import path from "node:path";

const VECTOR_FAMILY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEPRECATION_KINDS = new Set(["removed", "renamed", "replaced"]);

function idDate(id) {
  const compact = id.slice(2, 10);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

export function validateRelationshipAddendum(id, body, entries) {
  if (!body.includes("關聯追補")) return [];
  const violations = [];
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = body.match(
    new RegExp(
      `^# ${escapedId}｜[^\\n]+\\n\\n(> \\*\\*\\d{4}-\\d{2}-\\d{2} 關聯追補\\*\\*：[^\\n]*(?:\\n> [^\\n]*)*)\\n\\n## 背景與驅動力$`,
      "mu",
    ),
  );
  if (!match) {
    return ["關聯追補必須緊接 H1，格式為「> **YYYY-MM-DD 關聯追補**：…」"];
  }

  const block = match[1];
  const date = block.match(/^> \*\*(\d{4}-\d{2}-\d{2}) 關聯追補\*\*：/u)?.[1];
  const targets = [...new Set([...block.matchAll(/D-\d{8}-\d{2}/gu)].map((item) => item[0]))];
  if (targets.length === 0) violations.push("關聯追補至少須連結一份後續 ADR");
  for (const targetId of targets) {
    const target = entries.get(targetId);
    if (!target) {
      violations.push(`關聯追補目標不存在：${targetId}`);
      continue;
    }
    if (targetId <= id) violations.push(`關聯追補只能指向較後的 ADR：${targetId}`);
    if (idDate(targetId) !== date)
      violations.push(`關聯追補日期 ${date} 必須等於目標 ${targetId} 的日期 ${idDate(targetId)}`);
    const reverse = [...(target.fm.amends ?? []), ...(target.fm.supersedes ?? [])];
    if (!reverse.includes(id))
      violations.push(`關聯追補目標 ${targetId} 的 amends 或 supersedes 未回指 ${id}`);
  }
  return violations;
}

export function validateDeprecations(deprecations) {
  const violations = [];
  const seen = new Set();
  for (const [index, entry] of deprecations.entries()) {
    const label = `deprecates[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      violations.push(`${label} 必須是物件`);
      continue;
    }
    const keys = Object.keys(entry).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["item", "kind", "replacement"]))
      violations.push(`${label} 只能含 item、kind、replacement`);
    if (
      typeof entry.item !== "string" ||
      entry.item !== entry.item.trim() ||
      entry.item.length === 0 ||
      entry.item.length > 160 ||
      /[\r\n|]/u.test(entry.item)
    )
      violations.push(`${label}.item 必須是 1–160 字、無換行與 table delimiter 的字串`);
    if (!DEPRECATION_KINDS.has(entry.kind))
      violations.push(`${label}.kind 必須是 removed、renamed 或 replaced`);
    if (entry.kind === "removed" && entry.replacement !== null)
      violations.push(`${label} removed 的 replacement 必須為 null`);
    if (
      (entry.kind === "renamed" || entry.kind === "replaced") &&
      (typeof entry.replacement !== "string" ||
        entry.replacement !== entry.replacement.trim() ||
        entry.replacement.length === 0 ||
        entry.replacement.length > 240 ||
        /[\r\n|]/u.test(entry.replacement))
    )
      violations.push(`${label} renamed／replaced 必須有 1–240 字的 replacement`);
    if (seen.has(entry.item)) violations.push(`${label}.item 在同一 ADR 重複：${entry.item}`);
    seen.add(entry.item);
  }
  return violations;
}

function isSafeRepoRelativePath(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) return false;
  if (value.includes("\\") || /^[A-Za-z]:/u.test(value)) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (path.posix.normalize(value) !== value) return false;
  return value
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

export function validateHistoricalFiles(files) {
  const violations = [];
  const seen = new Set();
  for (const value of files) {
    if (!isSafeRepoRelativePath(value))
      violations.push(`files 含不安全或未正規化的 repo-relative path：${value}`);
    if (seen.has(value)) violations.push(`files 含重複路徑：${value}`);
    seen.add(value);
  }
  return violations;
}

function walkVectorFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (entry.name.endsWith(".vectors.json")) files.push(target);
    }
  }
  return files.sort();
}

export function collectVectorFamilies(repoRoot) {
  const conformanceRoot = path.join(repoRoot, "conformance");
  const families = new Map();
  const violations = [];
  for (const file of walkVectorFiles(conformanceRoot)) {
    const relative = path.relative(repoRoot, file).split(path.sep).join("/");
    let document;
    try {
      document = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      violations.push(`${relative} 無法解析 JSON：${error.message}`);
      continue;
    }
    if (typeof document.family !== "string" || !VECTOR_FAMILY_RE.test(document.family)) {
      violations.push(`${relative} 的 family 不是合法 family ID：${document.family}`);
      continue;
    }
    const owners = families.get(document.family) ?? [];
    owners.push(relative);
    families.set(document.family, owners);
  }
  for (const [family, owners] of families) {
    if (owners.length !== 1)
      violations.push(`conformance family ${family} 必須恰有一份向量檔：${owners.join(", ")}`);
  }
  return { families, violations };
}

export function validateVectorFamilies(vectors, families) {
  const violations = [];
  const seen = new Set();
  for (const family of vectors) {
    if (typeof family !== "string" || !VECTOR_FAMILY_RE.test(family))
      violations.push(`vectors 含非法 family ID：${family}`);
    if (seen.has(family)) violations.push(`vectors 含重複 family ID：${family}`);
    seen.add(family);
    const owners = families.get(family) ?? [];
    if (owners.length !== 1)
      violations.push(`vectors family 必須恰好解析到一份向量檔：${family}`);
  }
  return violations;
}
