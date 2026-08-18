import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createDocsUvArguments,
  createDocsUvEnvironment,
} from "./docs-uv.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];

if (mode === "verify-offline" && !existsSync(join(repoRoot, ".venv"))) {
  console.error(
    "缺少已鎖定的 .venv；請先在可連線環境執行 pnpm docs:bootstrap。",
  );
  process.exit(1);
}

let args;
try {
  args = createDocsUvArguments(mode);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const result = spawnSync("uv", args, {
  cwd: repoRoot,
  env: createDocsUvEnvironment(repoRoot),
  stdio: "inherit",
});

if (result.error) {
  console.error(`無法啟動 uv：${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
