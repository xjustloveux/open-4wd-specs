---
type: impl
domain: ["資安"]
summary: Sanitize Worker／P2P 驗簽／CSP・SRI／依賴管控
authority: null
slug: null
---

# security（資安實作）

> **本檔角色**：資安的**實作層** —— UGC Mesh Sanitize Worker、P2P 訊息驗簽、CSP / SRI、依賴管控、Pinning Server 安全 Header、本地安全事件記錄、CVE 通報模板。
> 設計、防禦層次、簽章覆蓋表、不變式見 [資安規範.md](../資安規範.md)；身分 / 簽章原語 / `SignedPayload` 見 [key-manager.md](key-manager.md)；序列化見 [ledger-admission.md §1](ledger-admission.md)。對應 `src/security/`。

## 1. UGC Mesh Sanitize Worker

**所有不可信 GLB 的首次解析都走本 isolated Web Worker、同一限額**——上傳前清洗、收件驗證的指紋重算前置解析、車庫預覽 / 進房首次載入（信任模型見 [資安規範.md §2.4](../資安規範.md)）。上傳情境拒收即丟棄、不寫 IPFS；載入情境解析失敗 / 超時 / 超限 = 本地拒用該資產（fail-fast）。

### 1.1 介面

```typescript
type SanitizeRequest = {
  meshBuffer: ArrayBuffer; // GLB（管線唯一格式）
};
type SanitizeResult =
  | { ok: true; sanitized: ArrayBuffer; stats: MeshStats }
  | { ok: false; reason: SanitizeFailReason; details: string };

type SanitizeFailReason =
  | "parse-error"
  | "external-url-ref"
  | "malicious-extras"
  | "invalid-coordinates"
  | "degenerate-triangles"
  | "too-many-triangles"
  | "out-of-bounds"
  | "texture-too-large";

interface MeshStats {
  triangleCount: number;
  vertexCount: number;
  boundingBox: { min: Vec3; max: Vec3 };
}
```

### 1.2 限制常數

```typescript
// 結構安全「絕對天花板」——只擋任何 type 都不可能合法的 GLB。
// per-type / per-stage 幾何・質量・密度檢核歸 Stage 1–3 pipeline
//（protocol.md §3 PART_* / VEHICLE_* / TRACK_*、零件與共用介面.md §7、runtime.md §10、UGC機制 §9.5），sanitize 不重複設限。
const SANITIZE_LIMITS = {
  MAX_GLB_BYTES: TRACK_GLB_SIZE_MAX_MB * 1024 * 1024, // 全 type 最大 = 場地 80 MiB（protocol.md §3）
  MAX_TRIANGLES: TRACK_VISUAL_TRIANGLE_COUNT_MAX, // 全 type 最大 = 場地 visual 3M（protocol.md §3）
  MAX_AABB_M: TRACK_AABB_MAX_M, // 全 type 最大 = [500, 500, 100] m（protocol.md §3）
  MAX_TEXTURE_EDGE_PX: SOURCE_TEXTURE_EDGE_MAX_PX, // 首次來源 admission 上限 = 8192px
  MAX_JSON_BYTES: SANITIZE_JSON_CHUNK_MAX_BYTES, // 16 MiB；TextDecoder / JSON.parse 前拒絕
  MAX_DOCUMENT_ENTRIES: SANITIZE_DOCUMENT_MAX_ENTRIES, // 250,000；全 JSON document 走訪成本
  MAX_DOCUMENT_DEPTH: SANITIZE_DOCUMENT_MAX_DEPTH, // 64；全 document 結構深度
  MAX_EXTRAS_BYTES: SANITIZE_EXTRAS_MAX_BYTES, // 16 MiB——extras 總量非檔案大小；場地 route[]/entity extras 合法可達 MiB 級（protocol.md §4）
  MAX_EXTRAS_DEPTH: SANITIZE_EXTRAS_MAX_DEPTH, // 8（protocol.md §4）
} as const;

const SANITIZE_TIMEOUT_MS = 5_000; // 對齊 資安規範 §2.2
const SANITIZE_WORKER_VERSION = "v1"; // JSON / collection admission schema；live 後 bump 即升 protocol
```

貼圖邊長分成兩個不可混用的 protocol 階段：

- `SOURCE_TEXTURE_EDGE_MAX_PX = 8192`：首次 admission 對 encoded source image 的絕對天花板；8192px 是合法輸入，sanitize 不得以 canonical 成品預算提前拒收。
- `CANONICAL_TEXTURE_EDGE_MAX_PX = 4096`：Stage 3 canonical finalizer 等比降採樣與轉換後的成品上限；finalizer 必須以壓縮後成品重驗，任何邊超過 4096px 即拒收。

因此 `SANITIZE_LIMITS.MAX_TEXTURE_EDGE_PX` 映射前者；場地 4K 貼圖預算與 strict canonical validation 使用後者。兩值皆以 [protocol.md §4](../程式參數/protocol.md#4-protocolsecurity安全) 為數值權威，不得收斂成單一常數。

主要 glTF collection 另有逐類硬上限：`nodes 50,000`、`meshes 10,000`、`accessors / bufferViews 100,000`、`buffers 64`、`images / textures / samplers / materials 4,096`、`scenes 64`、`animations 1,024`、`skins / cameras 4,096`、`extensionsUsed / extensionsRequired 128`；全 mesh primitives 合計上限 `50,000`。任何欄位不是 array 或超額均在幾何、extras 走訪前以 `parse-error` 拒絕。

> **質量 / 密度不在 sanitize 檢核**——質量 = 體積 × 材質密度、材質 Stage 2 才指派（[算式表.md §1](../算式表.md)）；per-type 質量 / 密度比檢核見 [protocol.md §3](../程式參數/protocol.md#3-protocolugcugc-規格約束) + [零件與共用介面.md §7](../建模參數/零件與共用介面.md#7-約束限制stage-1--stage-3-嚴格檢核)。**non-manifold 不拒收**——volume 解析有 watertight → voxel 備援鏈（[runtime.md §10.1](../建模參數/runtime.md#10-stage-對應的處理流程)），non-watertight mesh 屬合法輸入。

### 1.3 嚴格隔離（資安規範 [§2.3](../資安規範.md#23-嚴格隔離)）

Worker 跑在 isolated context：**無 DOM、無 network（不得 `fetch`）**，先由解碼前輸入大小與文件／collection／幾何／extras 結構天花板限制配置成本，逾時即 `terminate()`；拒收後 GLB 丟棄。瀏覽器沒有可攜的 per-worker heap 硬上限，因此規格不得宣稱固定 MB 記憶體配額。

### 1.4 檢查順序

```typescript
async function sanitizeMesh(req: SanitizeRequest): Promise<SanitizeResult> {
  // 0a. 輸入大小（parse 前擋，防解壓炸彈進 parser）
  if (req.meshBuffer.byteLength > SANITIZE_LIMITS.MAX_GLB_BYTES)
    return {
      ok: false,
      reason: "parse-error",
      details: `GLB ${req.meshBuffer.byteLength}B > absolute ceiling`,
    };

  let mesh;
  try {
    mesh = await parseMesh(req.meshBuffer, "glb");
  } catch (err) {
    return { ok: false, reason: "parse-error", details: String(err) };
  }

  // 0b. GLB 結構（資安規範 §2.1）：JSON chunk 先驗 16 MiB 再 TextDecoder / JSON.parse；
  //     parse 後先驗主要 collection、全文件 entries / depth，再走幾何與 extras。
  //     拒外部 URL 參照、拒惡意 extras（> MAX_EXTRAS_BYTES / 巢狀 > MAX_EXTRAS_DEPTH / 可執行 payload）
  if (hasExternalUrlRef(mesh))
    return {
      ok: false,
      reason: "external-url-ref",
      details: "embedded external URI",
    };
  if (hasMaliciousExtras(mesh, SANITIZE_LIMITS))
    return {
      ok: false,
      reason: "malicious-extras",
      details: "oversized/deep/executable extras",
    };

  // 1. 三角形數（絕對天花板；per-type 上限由 pipeline 檢核）
  if (mesh.triangleCount > SANITIZE_LIMITS.MAX_TRIANGLES)
    return {
      ok: false,
      reason: "too-many-triangles",
      details: `${mesh.triangleCount} > ${SANITIZE_LIMITS.MAX_TRIANGLES}`,
    };

  // 2. 座標 NaN / Infinity
  for (const v of mesh.vertices)
    if (
      !Number.isFinite(v[0]) ||
      !Number.isFinite(v[1]) ||
      !Number.isFinite(v[2])
    )
      return {
        ok: false,
        reason: "invalid-coordinates",
        details: "NaN or Infinity vertex",
      };

  // 3. Bounding box（絕對天花板，m；per-type AABB 上下限由 pipeline 檢核）
  const bbox = computeBoundingBox(mesh.vertices);
  const sizeM = [
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ]; // 原始軸 [X, Y, Z]
  // MAX_AABB_M 軸序＝[長, 寬, 高]＝[Z, X, Y]：canonical 軸序重排後逐項對照（editor 檢核同款重排；
  // 逐 index 直比會把高 Y 對到寬上限、長 Z 對到高上限＝誤放高／誤拒長）
  const sizeCanonical = [sizeM[2], sizeM[0], sizeM[1]];
  if (sizeCanonical.some((s, axis) => s > SANITIZE_LIMITS.MAX_AABB_M[axis]))
    return { ok: false, reason: "out-of-bounds", details: `bounds-m ${sizeM}` };

  // 4. 退化三角形（面積 < min(PART_DEGENERATE_TRIANGLE_AREA_MIN_M2,
  //    PART_DEGENERATE_TRIANGLE_AREA_DIAGONAL_RATIO × 世界 AABB 對角線²)〔protocol.md §3〕，> 5% 拒收；
  //    大型零件與場地落在絕對值，小零件依尺寸放寬）
  const diagonal = Math.hypot(...sizeM);
  const minAreaM2 = Math.min(
    PART_DEGENERATE_TRIANGLE_AREA_MIN_M2,
    PART_DEGENERATE_TRIANGLE_AREA_DIAGONAL_RATIO * diagonal * diagonal,
  );
  let degenerate = 0;
  for (const tri of mesh.triangles)
    if (triangleAreaM2(tri) < minAreaM2) degenerate++;
  if (degenerate > mesh.triangleCount * 0.05)
    return {
      ok: false,
      reason: "degenerate-triangles",
      details: `${degenerate} degenerate`,
    };

  // 5. encoded source texture 邊長（canonical 4096px 成品上限由 Stage 3 finalizer 負責）
  if (
    mesh.textures.some(
      (t) => Math.max(t.width, t.height) > SANITIZE_LIMITS.MAX_TEXTURE_EDGE_PX,
    )
  )
    return {
      ok: false,
      reason: "texture-too-large",
      details: `> ${SANITIZE_LIMITS.MAX_TEXTURE_EDGE_PX}px`,
    };

  // 6. 通過 → 正規化重打包
  return {
    ok: true,
    sanitized: serializeNormalized(mesh),
    stats: {
      triangleCount: mesh.triangleCount,
      vertexCount: mesh.vertices.length,
      boundingBox: bbox,
    },
  };
}
```

### 1.5 主執行緒呼叫（timeout + transferable）

```typescript
class MeshSanitizer {
  async sanitize(req: SanitizeRequest): Promise<SanitizeResult> {
    const worker = new Worker(
      new URL("./sanitize.worker.ts", import.meta.url),
      { type: "module" },
    );
    return new Promise((resolve) => {
      const done = (r: SanitizeResult) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(r);
      };
      const timer = setTimeout(
        () => done({ ok: false, reason: "parse-error", details: "timeout" }),
        SANITIZE_TIMEOUT_MS,
      );
      worker.addEventListener("message", (e: MessageEvent<SanitizeResult>) =>
        done(e.data),
      );
      worker.addEventListener("error", () =>
        done({ ok: false, reason: "parse-error", details: "worker error" }),
      );
      worker.postMessage(req, [req.meshBuffer]); // transferable，零拷貝
    });
  }
}
```

> 場地 UGC 的規格外攻擊（巨大 AABB / 三角爆量 / 內容空洞）對策主表見 [UGC機制.md §9.5](../UGC機制.md)；本 Worker 為零件 / 場地共用的 mesh 層 sanitize。

## 2. P2P 訊息驗簽

`SignedPayload` 定義見 [key-manager.md §9](key-manager.md)（**timestamp + nonce 在簽章涵蓋內**）。先驗 envelope 固定五欄、signer 長度、safe-integer timestamp、nonce 恰 16 bytes、signature byte-string；再走白名單 + 時戳 + nonce + 簽章四關：

```typescript
async function verifyP2PMessage<T>(
  signed: SignedPayload<T>,
  trustedPeers: Set<PeerId>,
  nonceSet: NonceSet,
): Promise<Result<T>> {
  if (!trustedPeers.has(signed.signer)) return error("untrusted-peer"); // 1. 房間成員白名單
  if (Math.abs(Date.now() - signed.timestamp) > 30_000)
    return error("timestamp-out-of-range"); // 2. ±30s
  if (nonceSet.has(signed.nonce)) return error("nonce-replay"); // 3. nonce 不在 30s set
  const message = buildSignedMessage(
    signed.payload,
    signed.timestamp,
    signed.nonce,
    signed.signer,
  ); // key-manager.md §9
  if (!(await keyManager.verify(message, signed.signature, signed.signer)))
    return error("invalid-signature"); // 4. 簽章
  if (!nonceSet.add(signed.nonce, signed.timestamp))
    return error("nonce-capacity"); // 8,192 硬上限、容量滿 fail-closed
  return ok(signed.payload);
}
```

簽章一律以 `verifyMessage` 驗（RFC 8032 嚴格模式：非正規編碼、S ≥ L 與小階公鑰一律驗不過，方程式為 cofactored）；`signer` 經 `peerIdToPublicKey` 解碼，小階、全零或非正規編碼公鑰的 PeerId 視為格式不符（[key-manager.md §3](key-manager.md)、[D-20261030-02](../decisions/D-20261030-02-Ed25519改RFC8032嚴格驗簽.md)）。

`P2P_MESSAGE_TIMESTAMP_TOLERANCE_SEC = 30`、`P2P_MESSAGE_NONCE_BYTES = 16`、`P2P_NONCE_SET_MAX_ENTRIES = 8192`（資安規範 [§3.3](../資安規範.md#33-防-replay)）。Gossip 接收另使用「驗 envelope / signer / 簽章但暫不 commit nonce → topic payload schema → per-signer rate limit → commit nonce」順序；因此限流拒絕的 unique nonce 不會先灌滿 replay 集合。一般非 Gossip 呼叫仍使用一次完成驗證與 commit 的 `verifyP2PMessage`。

賽內回合訊息（Race Sign Key 簽的 input、checksum、catch-up 訊息與輸入日誌條目）另走非同步驗簽器：只有可作身分的公鑰（非小階、非全零、正規編碼）才交 WebCrypto Ed25519，WebCrypto 接受才採用，拒絕、拋錯或逾時一律以 noble 嚴格模式複核並以 noble 為準，接受集合與 noble 相同；規則見 [network-sync.md §7.1](network-sync.md)「驗簽器」。

## 3. CSP（生產環境；build 時生成 `<meta>` 注入）

**交付機制**：主站 = GitHub Pages、**無法設自訂 HTTP header** → production build 完成 prerender
後，`scripts/inject-csp.mjs` 遍歷 dist 的每一份 HTML，呼叫 `scripts/csp-policy.mjs` 的
`contentSecurityPolicyFor(html)`，再注入 `<meta http-equiv="Content-Security-Policy">`。各路由的
inline import map、JSON-LD 與 stylesheet `onload` 內容不同，因此 policy 是**逐頁生成**，不可把
單一預先組好的 policy 複製到全部頁面。

```typescript
const baseline = [
  "default-src 'self'",
  "worker-src 'self' blob:", // 模擬 Worker（同源 module chunk）、Sanitize / 指紋 Worker、KTX2 transcoder（同源生成 Worker）、three DRACOLoader（blob:）
  "connect-src 'self' blob: wss: https:", // scheme 級白名單：玩家可自選 signaling / pinning / gateway 節點（資安規範 §4），固定域名白名單會擋自選端點；仍擋非 TLS 外連；blob: 供 three 以 fetch 讀 GLB 內嵌貼圖
  "img-src 'self' data: blob:", // GLB texture 可能用 blob
  "style-src 'self' 'unsafe-inline'", // Angular
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

// 每份 HTML 另生成：
// script-src 'self' 'wasm-unsafe-eval' <每個 inline script 的 sha256>
// 有 inline event handler 時才加入 'unsafe-hashes' 與各 handler 的 sha256
```

`script-src` 永不加入 `'unsafe-inline'`；hash 由實際 UTF-8 內容計算並去重。`upgrade-insecure-requests`
保留為 production 縱深防禦；Chromium localhost smoke 已確認本機 HTTP 位址仍依 potentially
trustworthy 例外保留，不需要為本機驗證移除 production directive。

**`connect-src` 的 `blob:`**：GLTFLoader 先把 GLB 內嵌影像包成 `blob:` URL，再由 KTX2Loader（經
FileLoader）或 ImageBitmapLoader（PNG／JPEG）以 `fetch()` 讀取；`fetch()` 受 `connect-src` 約束，
缺 `blob:` 時讀取被擋，GLTFLoader 會把貼圖靜默改成 `null`，模型照載但沒有貼圖。`blob:` 只能指向本源
自建的 Blob，不能用來外連或外洩資料。

**正式 CSP 實跑防線**：e2e 建置不注入 CSP，因此另有 `scripts/verify-csp-dist.mjs`：在已注入 meta CSP
的 dist 上以 Chromium 跑公版車＋公版場地的本機測試，斷言 `securitypolicyviolation`、console CSP
拒絕訊息與 Worker 內 CSP 拒絕（以 pageerror 浮出）皆為 0、至少一張 KTX2 貼圖經 `blob:` 讀取且 transcode 成功、three 沒有貼圖載入失敗；
任一不符即 exit 1。判準邏輯由 `scripts/verify-csp-dist.test.mjs` 覆蓋（`test:scripts`）。Pages 部署 workflow
在自己的 `build:custom-domain` 之後、上傳部署產物之前以 Chromium 執行 `pnpm verify:csp-dist`，未通過不部署；
e2e 啟動會重建同一個 `dist/`，因此這道防線不可接在 e2e 之後。

**Worker 的 CSP 來源**：以 `http(s)` 腳本 URL 建立的 dedicated Worker，CSP 只來自 Worker 腳本自己的 HTTP 回應 header，不繼承建立它的文件；以 `blob:` URL 建立的 Worker（例如 three DRACOLoader 的 decoder pool）則繼承建立它的文件的 CSP，`script-src` 不含 `'unsafe-eval'`，Worker 內 `eval`／`new Function` 會被擋。KTX2Loader 的 Basis transcoder 以 embind 動態產生函式，放在 `blob:` Worker 會在正式 CSP 下初始化失敗，因此改為同源生成 Worker；主文件 `script-src` 不為它加入 `'unsafe-eval'`。對同源腳本 Worker，meta CSP 只約束主文件與「能否建立該 Worker」（`worker-src`）。GitHub Pages 無法替 Worker 腳本送 header，因此**模擬 Worker 與其他同源腳本 Worker 在正式部署下沒有 CSP**——Worker 內 `eval`／`new Function` 可執行、跨源 fetch 不受 `connect-src` 限制（Chromium 與 Firefox 實測）。對應的約束：

- 模擬 Worker 只以同源 module chunk 建立（`new Worker(new URL(…, import.meta.url), { type: 'module' })`），Worker 內只載入本站同源模組；不得以 `blob:` 或跨源 URL 建立模擬 Worker。
- Worker 內的 Rapier WASM 內嵌於 chunk（base64），載入時先核對 wasm sha256 再 `WebAssembly.instantiate`；主文件的 `'wasm-unsafe-eval'` 不延伸到 Worker，Worker 端也不需要它。
- Worker 內 Draco 解碼器是建置時生成的 ESM 包裝：上游 three `draco_decoder.js` 原樣複製並在檔尾補 default export，輸出到 gitignored 的 `public/vendor/draco-gltf-module/`。生成器拒收含 `eval`、`Function`（含間接呼叫與經 `constructor` 取得）、`importScripts` 或 DOM 注入的來源，`--check` 比對生成物與上游逐位元一致；這是 Worker 內動態程式碼的唯一防線，字串拼接出的名稱靠上游逐位元複製約束。
- KTX2 transcoder Worker 只從同源生成物 `vendor/basis-worker/ktx2-transcoder.js` 建立（以 `document.baseURI` 解析，`KTX2Loader` 子類別在上游 `init()` 解析後替換 worker creator），不得以 `blob:` 或跨源 URL 建立。生成物由 `scripts/generate-ktx2-transcoder-worker.mjs` 依上游 `KTX2Loader.init()` 的組法（常數＋`basis_transcoder.js` 原文＋`BasisWorker` 本體）輸出到 gitignored 的 `public/vendor/basis-worker/`，內容與上游 blob 逐位元一致，`--check` 守門；Worker 只處理主執行緒傳入的 transcoder 與 KTX2 bytes。
- 模擬 Worker 只接受已 admission 的資產；不可信 GLB 解析仍只走 Sanitize Worker（[§1](#1-ugc-mesh-sanitize-worker)）。GLB 由主執行緒 fetch 後以私有複本 Transferable 傳入。

> **meta CSP 限制**：`frame-ancestors` 經 `<meta>` 交付**無效**（規格明定）、GH Pages 亦無法送 `X-Frame-Options` → **主站無框架保護**。風險評估 = 無 cookie / 無跨源授權狀態（身分為本地金鑰、PIN 只在本地驗證），clickjacking 攻擊面有限，**接受**；自架 pinning server 走 HTTP header（[§6](#6-pinning-server-安全-header)）不受此限。signaling 為 **wss**、pinning 走 **HTTPS** API。

## 4. SRI 工具

```typescript
async function computeSRI(
  url: string,
  algo: "sha384" = "sha384",
): Promise<string> {
  const buffer = await (await fetch(url)).arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-384", buffer);
  return `${algo}-${btoa(String.fromCharCode(...new Uint8Array(hash)))}`;
}
```

CI build 時為 build 產物（bundle）自動生成 SRI hash——runtime 原則上無第三方 JS / CSS（[資安規範.md §5](../資安規範.md)）。實作 ＝`angular.json` production `"subresourceIntegrity": true`（bundle 自動帶 `integrity` 屬性）；`computeSRI` 供腳本 ／ 診斷用。

## 5. 依賴管控

```ini
# .npmrc
save-exact=true       # 禁 ^ / ~，鎖死版本
engine-strict=true
```

`package.json` 依賴皆 pin 精確版本（無 `^` / `~`；版號 ＝lockfile 實際解析值）。CI 兩道：主 CI `pnpm install --frozen-lockfile`（比對 lockfile）＋`.github/workflows/security.yml`（PR / 每週排程）`pnpm audit --audit-level moderate`——每週排程整份 audit ≥ moderate 紅燈；PR 以 base 分支的 lockfile／`pnpm-workspace.yaml`（含 `audit.ignore`）另跑一次 audit 當基線，`scripts/check-audit-diff.mjs` 以 GHSA＋套件名比對、只擋 PR 新引入的 advisories，基線既有的列出不擋，由排程紅燈與人工升版清償（[資安規範.md §6.2](../資安規範.md)、[D-20261103-01](../decisions/D-20261103-01-PR依賴稽核只擋新增.md)）。npm 依賴不交 Dependabot（`.github/dependabot.yml` 只追 GitHub Actions 的 SHA pin），升版與 `pnpm-workspace.yaml` 的 `overrides` 由維護者人工審查。只允許 well-known 核心套件（Rapier / libp2p / OrbitDB…）。

### 5.1 Vendored 檔案政策

Vendored 原始碼或二進位必須有 manifest／provenance 記錄來源、immutable 版本與 SHA-256；
`check:vendored` 對 repository bytes 與 manifest 做 fail-closed 比對。遠端上游比對只在可取得
公開 immutable provenance 的 gate 執行，不能讓 private／離線 CI 依賴浮動 raw URL；任何更新
都必須同批更新來源紀錄、雜湊與授權資訊，不接受未記錄的手改。

## 6. Pinning Server 安全 Header

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: <如 §3>
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

> `Cross-Origin-Embedder-Policy` / `Cross-Origin-Opener-Policy` 屬 pinning server 的通用強化 header（本服務無 SharedArrayBuffer 需求）。**主站不適用**：GH Pages 無法設此二 header → 主站無 cross-origin isolation、SharedArrayBuffer 不可用——亦不需要（Rapier deterministic build 與 SIMD / parallel feature 互斥，物理一律單執行緒）。

## 7. 本地安全事件記錄（不傳遠端）

`APP_SECURITY_LOG` 是瀏覽器 bundle 內唯一的 app-scope `LocalSecurityLog`；只存記憶體、採 500 筆
環形上限，重新整理即清空，且**沒有任何遠端 transport**。事件來源固定為：

- `MeshSanitizer` 的 Worker timeout／error／拒收，以及 editor 純函式 admission 拒收；
- `verifyP2PMessage`／`verifyP2PEnvelope` 的所有 canonical `P2pRejectReason`；
- app 啟動時掛上的 `securitypolicyviolation` listener；
- pin／session 模組日後接入的 `pin-attempt`、`session-expired`。

寫入時即依事件類型正面表列欄位，而不是先保存原始 details 再於 UI 遮蔽：sanitize／驗章／session
只保留最長 96 字元 `reason`；pin 只保留 `outcome`／`reason`；CSP 的 `blockedURI`、`sourceFile`
只保留 HTTP(S)／WS(S) origin 或非網路 scheme，另可保留 directive 與非負 line number。payload、
signature、PeerId、URL path／query／fragment 與未知欄位一律不落記錄。`list()` 回傳 defensive copy，
呼叫端不能改寫內部事件。

設定頁的維護區只提供玩家主動下載；`exportJson()` 固定輸出 `{ "version": 1, "events": [...] }`
的 UTF-8 JSON，沿用同一份已去識別 snapshot，不會自動上傳、持久化或附加其他診斷資料。

## 8. CVE 通報

`SECURITY.md`（通報 channel = GitHub Security Advisories + PGP email）：

CVE 等級 / 回應時限見 [資安規範.md §10](../資安規範.md)。

漏洞通報、協調揭露時限與獎勵政策的唯一權威見 [資安規範.md §11](../資安規範.md)。未修補漏洞的重現資料只在該節指定的私密通報管道中交換，不得以公開 issue／PR 提交；修復或協調揭露後才可加入去敏 regression test。

## 9. 不變式

不變式見 [資安規範.md §16](../資安規範.md)（sanitize 拒收不上鏈 / 不可信 GLB 不進主執行緒解析 / 驗章失敗不 apply / nonce 重複或 timestamp>30s reject / MatchResult 攜帶 payout／frontier 或 facts／多簽無效即 reject / CSP-SRI 違規阻擋 merge / 本地安全記錄不保存識別資訊且不傳遠端）。

## 10. 跨模組對接

| 模組                                               | 對接                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `key-manager/`（[key-manager.md](key-manager.md)） | 簽章原語 / `SignedPayload`                                                     |
| `ledger/`（[ledger.md](ledger.md)）                | event sign + `ledgerSigningDigest(ledgerAddress, event)` + 帳本檢查點 multisig |
| `network-sync/`                                    | ephemeral checksum + sign                                                      |
| `ugc-fork/`                                        | upload sign + 反複製 mesh 指紋（[anti-piracy.md](anti-piracy.md)）             |
| `pinning-service/`                                 | sign 上傳請求 + 安全 Header                                                    |
| `moderation/`（[moderation.md](moderation.md)）    | 檢舉 / 仲裁                                                                    |
