// GitHub Actions 供應鏈檢核：本地 Action 可用 ./；外部 Action 必須鎖完整 commit SHA。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PINNED_ACTION_RE = /^[^@\s]+@[0-9a-f]{40}$/u;

export function analyzeWorkflows(repoRoot = REPO_ROOT) {
  const workflowRoot = path.join(repoRoot, ".github", "workflows");
  const files = fs.existsSync(workflowRoot)
    ? fs
        .readdirSync(workflowRoot)
        .filter((name) => /\.ya?ml$/u.test(name))
        .sort()
    : [];
  const violations = [];
  let uses = 0;

  for (const name of files) {
    const lines = fs.readFileSync(path.join(workflowRoot, name), "utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*([^#\s]+)(?:\s+#.*)?$/u);
      if (!match) continue;
      uses++;
      const reference = match[1];
      if (reference.startsWith("./")) continue;
      if (!PINNED_ACTION_RE.test(reference)) {
        violations.push(
          `${name}:${index + 1} 外部 Action 必須鎖定 40 位 commit SHA：${reference}`,
        );
      }
    }
  }

  return { files: files.length, uses, violations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : REPO_ROOT;
  const result = analyzeWorkflows(repoRoot);
  console.log(
    JSON.stringify(
      { files: result.files, uses: result.uses, violations: result.violations.length },
      null,
      2,
    ),
  );
  for (const violation of result.violations) console.log(`✗ ${violation}`);
  if (result.violations.length > 0) process.exit(1);
}
