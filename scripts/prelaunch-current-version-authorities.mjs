import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rel, walkMd } from "./lib.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function checkPrelaunchAuthorityContent(registry, contentsByFile) {
  const violations = [];
  for (const authority of registry.authorities) {
    const content = contentsByFile.get(authority.file);
    if (content === undefined) {
      violations.push(`${authority.id}: missing ${authority.file}`);
      continue;
    }
    const matches = [...content.matchAll(new RegExp(authority.pattern, "g"))];
    if (matches.length === 0) {
      violations.push(`${authority.id}: authority pattern not found`);
      continue;
    }
    for (const match of matches) {
      if (match[1] !== "1")
        violations.push(
          `${authority.id}: pre-launch current baseline is ${match[1]}`,
        );
    }
  }
  for (const forbidden of registry.forbiddenCurrentLabels) {
    const content = contentsByFile.get(forbidden.file);
    if (content !== undefined && new RegExp(forbidden.pattern).test(content)) {
      violations.push(`${forbidden.id}: active internal v2+ label remains`);
    }
  }
  return violations;
}

/** 判斷 Markdown 是否屬 pre-launch current canon 掃描面。 */
export function isPrelaunchActiveCanonPath(registry, file) {
  const normalized = file.replaceAll("\\", "/");
  const corpus = registry.activeCanonCorpus;
  return (
    !corpus.excludeFiles.includes(normalized) &&
    !corpus.excludePrefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

/** 掃描全部 active canon 的自有 v2+ 標籤。 */
export function checkPrelaunchActiveCanonCorpus(registry, contentsByFile) {
  const violations = [];
  for (const [file, original] of contentsByFile) {
    let content = original;
    for (const allowed of registry.activeCanonCorpus.thirdPartyAllowlist)
      content = content.replace(new RegExp(allowed.pattern, "gu"), (match) =>
        " ".repeat(match.length),
      );
    for (const forbidden of registry.activeCanonCorpus.forbiddenLabels) {
      const pattern = new RegExp(forbidden.pattern, "gu");
      for (const match of content.matchAll(pattern)) {
        const line = content.slice(0, match.index).split(/\r?\n/u).length;
        violations.push(
          `${forbidden.id}: ${file}:${line} active internal v2+ label remains`,
        );
      }
    }
  }
  return violations;
}

export async function checkRepositoryPrelaunchCanon(root = repoRoot) {
  const lifecycle = await readFile(join(root, "專案生命週期.md"), "utf8");
  const phase = lifecycle.match(/^runtime_phase:\s*([^\s]+)$/m)?.[1];
  if (phase !== "pre_launch") return [];
  const registry = JSON.parse(
    await readFile(
      join(root, "scripts", "prelaunch-current-version-authorities.json"),
      "utf8",
    ),
  );
  const files = new Set([
    ...registry.authorities.map((entry) => entry.file),
    ...registry.forbiddenCurrentLabels.map((entry) => entry.file),
  ]);
  const contents = new Map(
    await Promise.all(
      [...files].map(async (file) => [
        file,
        await readFile(join(root, file), "utf8"),
      ]),
    ),
  );
  const activeCanonFiles = walkMd(root)
    .map((file) => [rel(root, file), file])
    .filter(([file]) => isPrelaunchActiveCanonPath(registry, file));
  const activeCanonContents = new Map(
    await Promise.all(
      activeCanonFiles.map(async ([file, path]) => [
        file,
        await readFile(path, "utf8"),
      ]),
    ),
  );
  return [
    ...checkPrelaunchAuthorityContent(registry, contents),
    ...checkPrelaunchActiveCanonCorpus(registry, activeCanonContents),
  ];
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  const violations = await checkRepositoryPrelaunchCanon();
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation);
    process.exitCode = 1;
  } else {
    console.log("pre-launch current canon version authorities verified");
  }
}
