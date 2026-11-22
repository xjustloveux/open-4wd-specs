import { resolve } from "node:path";

export function createDocsUvEnvironment(repoRoot, environment = process.env) {
  return {
    ...environment,
    UV_CACHE_DIR:
      environment.UV_CACHE_DIR || resolve(repoRoot, "..", ".uv-cache"),
    UV_NO_PYTHON_DOWNLOADS: "1",
  };
}

export function createDocsUvArguments(mode) {
  const common = ["--locked", "--python", "3.12", "--no-python-downloads"];

  switch (mode) {
    case "sync":
      return ["sync", ...common];
    case "build":
      return ["run", ...common, "node", "scripts/build-site.mjs"];
    case "build-offline":
      return [
        "run",
        "--offline",
        ...common,
        "node",
        "scripts/build-site.mjs",
      ];
    case "verify-offline":
      return [
        "run",
        "--offline",
        "--no-sync",
        ...common,
        "node",
        "scripts/build-site.mjs",
      ];
    default:
      throw new Error(`不支援的 docs uv 模式：${mode}`);
  }
}
