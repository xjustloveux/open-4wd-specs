// 保留既有命令入口；製作已改用共用 PNG 動畫工程，不再產生簡易 SVG 倒數。
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const result = spawnSync(
  process.env.PYTHON || "python",
  [path.join(__dirname, "build-countdown.py")],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
