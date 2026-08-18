import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createAuthoringUvArguments,
  createAuthoringUvEnvironment,
} from "./authoring-uv.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [mode, ...passthrough] = process.argv.slice(2);

let args;
try {
  args = createAuthoringUvArguments(mode, passthrough);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const result = spawnSync("uv", args, {
  cwd: repoRoot,
  env: createAuthoringUvEnvironment(repoRoot),
  stdio: "inherit",
});

if (result.error) {
  console.error(`無法啟動 uv：${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
