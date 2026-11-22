import { resolve } from "node:path";

const TOOL_ROOT = resolve(
  "美術資源",
  "實際使用圖",
  "賽內倒數與起跑動畫",
);

export function createAuthoringUvEnvironment(repoRoot, environment = process.env) {
  return {
    ...environment,
    UV_CACHE_DIR:
      environment.UV_CACHE_DIR || resolve(repoRoot, "..", ".uv-cache"),
    UV_NO_PYTHON_DOWNLOADS: "1",
  };
}

export function createAuthoringUvArguments(mode, passthrough = []) {
  const common = [
    "run",
    "--locked",
    "--group",
    "authoring",
    "--python",
    "3.12",
    "--no-python-downloads",
    "python",
  ];
  if (mode === "test") {
    return [...common, resolve(TOOL_ROOT, "test_build_animation.py")];
  }
  if (mode === "build") {
    return [
      ...common,
      resolve(TOOL_ROOT, "build_animation.py"),
      ...passthrough,
    ];
  }
  throw new Error(`不支援的 authoring uv 模式：${mode}`);
}
