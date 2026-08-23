import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
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

function storeZip(entries) {
  const chunks = [];
  for (const [name, value] of entries) {
    const fileName = Buffer.from(name, "utf8");
    const bytes = Buffer.from(value);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(bytes.length, 18);
    header.writeUInt16LE(bytes.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    chunks.push(header, fileName, bytes);
  }
  return Buffer.concat(chunks);
}

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
  assert.match(build, /buildViewerProjection/u);
  assert.match(build, /viewer-data\.js/u);
  assert.doesNotMatch(build, /nodes\.filter[\s\S]*slice\(0,\s*200\)/u);
});

test("immutable package keeps pre-launch manifest v1 and exactly four native-style adaptive viewer files", async () => {
  const { extractStoreZip, validateManifest } =
    await import("./refresh-graphify-releases.mjs");
  const files = extractStoreZip(
    storeZip([
      ["graph.json", "{}"],
      ["index.html", "<div id=graph></div>"],
      ["viewer-data.js", "window.__OPEN4WD_GRAPH__={};"],
      ["vis-network.min.js", "/*! vis-network 9.1.6 */"],
    ]),
  );
  assert.deepEqual([...files.keys()].sort(), [
    "graph.json",
    "index.html",
    "viewer-data.js",
    "vis-network.min.js",
  ]);
  const sourceSha = "abcdef0123456789abcdef0123456789abcdef01";
  const manifest = {
    schemaVersion: 1,
    repository: "xjustloveux/open-4wd",
    sourceSha,
    tag: `graphify-${sourceSha.slice(0, 12)}`,
    graphifyVersion: "0.9.25",
    generatedAt: "2026-08-23T00:00:00.000Z",
    graph: { nodes: 5_001, edges: 9_000 },
    viewer: {
      mode: "community-drill",
      threshold: 5_000,
      engine: "vis-network-9.1.6",
      data: "viewer-data.js",
    },
    assets: [{ name: "graphify-site.zip", size: 1, sha256: "a".repeat(64) }],
  };
  assert.equal(
    validateManifest(manifest, "open-4wd", { tag_name: manifest.tag }).viewer
      .mode,
    "community-drill",
  );
  assert.throws(
    () =>
      validateManifest({ ...manifest, schemaVersion: 2 }, "open-4wd", {
        tag_name: manifest.tag,
      }),
    /schema/u,
  );
  assert.throws(
    () =>
      extractStoreZip(
        storeZip([
          ["graph.json", "{}"],
          ["index.html", ""],
        ]),
      ),
    /exactly/u,
  );
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
