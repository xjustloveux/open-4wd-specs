import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const specsRoot = resolve(import.meta.dirname, "..");
const repositories = [
  "open-4wd",
  "open-4wd-pinning",
  "open-4wd-signaling",
  "open-4wd-turn",
];

test("specs refresh is allowlisted, partial-success, and independent of dispatch payload", async () => {
  const refresh = await readFile(
    join(specsRoot, "scripts", "refresh-graphify-releases.mjs"),
    "utf8",
  );
  const workflow = await readFile(
    join(specsRoot, ".github", "workflows", "graphify-refresh.yml"),
    "utf8",
  );
  const build = await readFile(
    join(specsRoot, "scripts", "build-site.mjs"),
    "utf8",
  );
  for (const repository of repositories)
    assert.match(refresh, new RegExp(`'${repository}'`, "u"));
  assert.match(refresh, /graphify-site\.zip/u);
  assert.match(refresh, /graphify-manifest\.json/u);
  assert.match(refresh, /sha256/u);
  assert.match(
    workflow,
    /repository_dispatch:[\s\S]*graphify-release-published/u,
  );
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /schedule/u);
  assert.match(workflow, /concurrency/u);
  assert.match(workflow, /node scripts\/refresh-graphify-releases\.mjs/u);
  assert.doesNotMatch(workflow, /client_payload\.(?:repository|tag|url)/u);
  assert.doesNotMatch(build, /7,240/u);
});

test("release cache records all four repositories even without remote artifacts", async () => {
  const { refreshGraphifyReleases } =
    await import("./refresh-graphify-releases.mjs");
  const cacheRoot = await mkdtemp(join(tmpdir(), "open4wd-graphify-cache-"));
  const fetchImpl = async (url) => {
    if (url.includes("/open-4wd/releases"))
      return new Response(JSON.stringify([]), { status: 200 });
    if (url.includes("/open-4wd-pinning/releases"))
      return new Response("", { status: 404 });
    if (url.includes("/open-4wd-signaling/releases"))
      throw new Error("offline");
    return new Response(
      JSON.stringify([
        {
          tag_name: "graphify-invalid",
          draft: false,
          prerelease: false,
          assets: [],
        },
      ]),
      { status: 200 },
    );
  };
  const result = await refreshGraphifyReleases({ cacheRoot, fetchImpl });
  assert.deepEqual(
    result.map(({ repository, status }) => ({ repository, status })),
    [
      { repository: "open-4wd", status: "missing" },
      { repository: "open-4wd-pinning", status: "private" },
      { repository: "open-4wd-signaling", status: "fetch-failed" },
      { repository: "open-4wd-turn", status: "missing" },
    ],
  );
  assert.deepEqual((await readdir(cacheRoot)).sort(), ["status.json"]);
});
