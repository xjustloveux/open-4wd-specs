import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  prepareAuthoringRelease,
  verifyPreparedAuthoringRelease,
} from "./authoring-release.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const root = resolve(import.meta.dirname, "..");

async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "open4wd-authoring-release-"));
  const input = join(temporary, "input");
  await mkdir(join(input, "vehicles"), { recursive: true });
  await mkdir(join(input, "images", "parts"), { recursive: true });
  await mkdir(join(input, "audio", "engines"), { recursive: true });
  await writeFile(
    join(input, "vehicles", "sport.glb"),
    Buffer.from("glTF fixture"),
  );
  await writeFile(
    join(input, "images", "parts", "wheel.png"),
    Buffer.from("png fixture"),
  );
  await writeFile(
    join(input, "audio", "engines", "idle.wav"),
    Buffer.from("wav fixture"),
  );
  const sourceBytes = Buffer.from("glTF fixture");
  return {
    temporary,
    input,
    sourceManifest: {
      schemaVersion: 1,
      candidateEpoch: 1,
      assets: [
        {
          assetId: "builtin:sport",
          logicalPath: "release-input/vehicles/sport.glb",
          releaseAsset: "sport.glb",
          sha256: createHash("sha256").update(sourceBytes).digest("hex"),
          size: sourceBytes.length,
        },
      ],
    },
  };
}

test("prepare creates deterministic release bytes and preserves logical archive paths", async () => {
  const { temporary, input, sourceManifest } = await fixture();
  const outputs = [join(temporary, "one"), join(temporary, "two")];
  const manifests = [];
  for (const outputDirectory of outputs) {
    manifests.push(
      await prepareAuthoringRelease({
        inputDirectory: input,
        outputDirectory,
        sourceSha: SHA,
        sourceManifest,
      }),
    );
    await verifyPreparedAuthoringRelease(outputDirectory);
  }
  assert.deepEqual(manifests[0], manifests[1]);
  assert.equal(manifests[0].tag, `authoring-source-${SHA.slice(0, 12)}`);
  assert.deepEqual(
    manifests[0].inputs.map(
      ({ assetId, logicalPath, releaseAsset, archivePath }) => ({
        assetId,
        logicalPath,
        releaseAsset,
        archivePath,
      }),
    ),
    [
      {
        assetId: null,
        logicalPath: "audio/engines/idle.wav",
        releaseAsset: "authoring-audio.zip",
        archivePath: "audio/engines/idle.wav",
      },
      {
        assetId: null,
        logicalPath: "images/parts/wheel.png",
        releaseAsset: "authoring-images.zip",
        archivePath: "images/parts/wheel.png",
      },
      {
        assetId: "builtin:sport",
        logicalPath: "vehicles/sport.glb",
        releaseAsset: "sport.glb",
        archivePath: null,
      },
    ],
  );
  for (const name of [
    "SHA256SUMS",
    "authoring-audio.zip",
    "authoring-images.zip",
    "authoring-release-manifest.json",
    "sport.glb",
  ])
    assert.deepEqual(
      await readFile(join(outputs[0], name)),
      await readFile(join(outputs[1], name)),
      name,
    );
});

test("verify rejects changed assets", async () => {
  const { temporary, input, sourceManifest } = await fixture();
  const output = join(temporary, "output");
  await prepareAuthoringRelease({
    inputDirectory: input,
    outputDirectory: output,
    sourceSha: SHA,
    sourceManifest,
  });
  await writeFile(join(output, "sport.glb"), Buffer.from("tampered"));
  await assert.rejects(
    verifyPreparedAuthoringRelease(output),
    /differs from manifest/u,
  );
});

test("verify rejects a release manifest whose GLB identity binding is missing", async () => {
  const { temporary, input, sourceManifest } = await fixture();
  const output = join(temporary, "output");
  const prepared = await prepareAuthoringRelease({
    inputDirectory: input,
    outputDirectory: output,
    sourceSha: SHA,
    sourceManifest,
  });
  prepared.inputs.find(({ logicalPath }) =>
    logicalPath.endsWith(".glb"),
  ).assetId = null;
  await writeFile(
    join(output, "authoring-release-manifest.json"),
    `${JSON.stringify(prepared, null, 2)}\n`,
  );
  await assert.rejects(
    verifyPreparedAuthoringRelease(output),
    /prepared authoring release input is invalid/u,
  );
});

test("prepare fails closed on unsupported input and flat GLB collisions", async () => {
  const { temporary, input, sourceManifest } = await fixture();
  await writeFile(join(input, "notes.txt"), "not a release asset");
  await assert.rejects(
    prepareAuthoringRelease({
      inputDirectory: input,
      outputDirectory: join(temporary, "unsupported"),
      sourceSha: SHA,
      sourceManifest,
    }),
    /unsupported release input extension/u,
  );

  const collisionInput = join(temporary, "collision");
  await mkdir(join(collisionInput, "a"), { recursive: true });
  await mkdir(join(collisionInput, "b"), { recursive: true });
  await writeFile(join(collisionInput, "a", "same.glb"), "one");
  await writeFile(join(collisionInput, "b", "same.glb"), "two");
  const collisionManifest = {
    ...sourceManifest,
    assets: [
      {
        ...sourceManifest.assets[0],
        logicalPath: "release-input/a/same.glb",
        releaseAsset: "same.glb",
        sha256: createHash("sha256").update("one").digest("hex"),
        size: 3,
      },
      {
        ...sourceManifest.assets[0],
        assetId: "builtin:sport-two",
        logicalPath: "release-input/b/same.glb",
        releaseAsset: "same.glb",
        sha256: createHash("sha256").update("two").digest("hex"),
        size: 3,
      },
    ],
  };
  await assert.rejects(
    prepareAuthoringRelease({
      inputDirectory: collisionInput,
      outputDirectory: join(temporary, "collision-output"),
      sourceSha: SHA,
      sourceManifest: collisionManifest,
    }),
    /releaseAsset collision/u,
  );
});

test("tracked BAT entrypoints remain thin and never mutate Git or install tools", async () => {
  for (const [name, target] of [
    ["prepare-authoring-release.bat", "prepare-authoring-release.ps1"],
    ["publish-authoring-release.bat", "publish-authoring-release.ps1"],
  ]) {
    const content = await readFile(join(root, name), "utf8");
    assert.match(content, new RegExp(target.replaceAll(".", "\\."), "u"));
    assert.doesNotMatch(
      content,
      /(?:npm|pnpm|pip) install|git (?:add|commit|push|tag)|GH_TOKEN|PRIVATE_KEY/iu,
    );
  }
});

test("publish script uses Draft, readback and exact confirmation gates", async () => {
  const content = await readFile(
    join(root, "scripts", "publish-authoring-release.ps1"),
    "utf8",
  );
  assert.match(content, /'auth', 'status'/u);
  assert.match(content, /'release', 'create'[\s\S]*'--draft'/u);
  assert.match(content, /'release', 'upload'/u);
  assert.match(content, /'release', 'download'/u);
  assert.match(content, /ConfirmImmutablePublish/u);
  assert.match(content, /'release', 'edit'[\s\S]*'--draft=false'/u);
  // 空集合的成員列舉（$x.assets.name）在 PowerShell 回傳 $null，@() 包裝後成為含 $null 的
  // 一元素陣列，會讓「剛建立、尚無 asset 的 Draft」誤觸 unexpected asset 檢查而無法上傳。
  assert.doesNotMatch(content, /@\(\$\w+\.(?:assets|releaseAssets)\.name\)/u);
  assert.match(content, /\$release\.assets \| ForEach-Object \{ \$_\.name \}/u);
  assert.doesNotMatch(
    content,
    /(?:npm|pnpm|pip) install|git (?:add|commit|push|tag)|GH_TOKEN|PRIVATE_KEY/iu,
  );
});

test("repository policy is Release-first and local staging is ignored", async () => {
  const attributes = await readFile(join(root, ".gitattributes"), "utf8");
  const ignore = await readFile(join(root, ".gitignore"), "utf8");
  const workflow = await readFile(
    join(root, ".github", "workflows", "authoring-source-release.yml"),
    "utf8",
  );
  assert.doesNotMatch(attributes, /filter=lfs|git lfs/iu);
  assert.match(ignore, /^\/release-input\/$/mu);
  assert.match(ignore, /^\/release-output\/$/mu);
  assert.match(workflow, /workflow_dispatch/u);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /gh release|git lfs|contents: write/iu);
});

test("tracked art PNGs are limited to review previews and favicons", async () => {
  const artRoot = join(root, "美術資源");
  const trackedPngs = [];

  async function collect(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath =
        prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory())
        await collect(join(directory, entry.name), relativePath);
      else if (
        entry.isFile() &&
        entry.name.toLocaleLowerCase("en-US").endsWith(".png")
      )
        trackedPngs.push(relativePath);
    }
  }

  await collect(artRoot);
  const unexpected = trackedPngs
    .filter(
      (path) =>
        !/^\u53c3\u8003\u96db\u5f62\/\u5b9a\u7248\/[^/]+\.png$/u.test(path) &&
        !/^\u5be6\u969b\u4f7f\u7528\u5716\/(?:favicon-master|favicon-source-chroma|favicon-source|open4wd-favicon-source)\.png$/u.test(
          path,
        ),
    )
    .sort((a, b) => a.localeCompare(b, "en"));

  assert.deepEqual(unexpected, []);
});

test("operator documentation records backup retention, readback and superseding decision", async () => {
  const operations = await readFile(
    join(root, "美術資源", "Immutable Release", "README.md"),
    "utf8",
  );
  const decision = await readFile(
    join(
      root,
      "decisions",
      "D-20260818-01-Authoring大型原始資產Release-first.md",
    ),
    "utf8",
  );
  assert.match(operations, /release-input/u);
  assert.match(operations, /prepare-authoring-release\.bat/u);
  assert.match(operations, /publish-authoring-release\.bat/u);
  assert.match(operations, /下載回讀/u);
  assert.match(operations, /備份/u);
  assert.match(operations, /失敗|復原/u);
  assert.match(decision, /supersedes: \["D-20260815-01"\]/u);
  assert.match(decision, /Git LFS/u);
  assert.match(decision, /唯一權威/u);
});

test("operator documentation gives every supported audio master one canonical input root", async () => {
  const operations = await readFile(
    join(root, "美術資源", "Immutable Release", "README.md"),
    "utf8",
  );
  const artIndex = await readFile(join(root, "美術資源.md"), "utf8");

  for (const document of [operations, artIndex]) {
    assert.match(document, /release-input\/audio\//u);
  }
  assert.match(operations, /WAV.*FLAC|FLAC.*WAV/su);
  for (const category of ["vehicles/", "tracks/", "ui/", "music/"]) {
    assert.match(operations, new RegExp(category, "u"));
  }
});

test("race animation authoring uses the single locked uv authority without entering docs CI", async () => {
  const pyproject = await readFile(join(root, "pyproject.toml"), "utf8");
  const lock = await readFile(join(root, "uv.lock"), "utf8");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const readme = await readFile(
    join(root, "美術資源", "實際使用圖", "賽內倒數與起跑動畫", "README.md"),
    "utf8",
  );
  const bat = await readFile(join(root, "build-race-animation.bat"), "utf8");

  assert.match(pyproject, /\[dependency-groups\][\s\S]*authoring\s*=\s*\[[\s\S]*pillow==/u);
  assert.match(lock, /name = "pillow"/u);
  assert.match(packageJson.scripts["authoring:animation:test"], /run-animation-authoring\.mjs test/u);
  assert.match(packageJson.scripts["authoring:animation:build"], /run-animation-authoring\.mjs build/u);
  assert.doesNotMatch(packageJson.scripts.check, /authoring:animation/u);
  assert.match(readme, /pnpm authoring:animation:(?:test|build)/u);
  assert.doesNotMatch(readme, /python-with-pillow/u);
  assert.match(bat, /pnpm run authoring:animation:build/u);
  assert.doesNotMatch(bat, /(?:pip|uv)\s+(?:install|sync)/iu);
});
