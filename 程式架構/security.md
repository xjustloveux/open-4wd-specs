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

  // 4. 退化三角形（面積 < PART_DEGENERATE_TRIANGLE_AREA_MIN_M2〔protocol.md §3〕，> 5% 拒收）
  let degenerate = 0;
  for (const tri of mesh.triangles)
    if (triangleAreaM2(tri) < PART_DEGENERATE_TRIANGLE_AREA_MIN_M2)
      degenerate++;
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

`P2P_MESSAGE_TIMESTAMP_TOLERANCE_SEC = 30`、`P2P_MESSAGE_NONCE_BYTES = 16`、`P2P_NONCE_SET_MAX_ENTRIES = 8192`（資安規範 [§3.3](../資安規範.md#33-防-replay)）。Gossip 接收另使用「驗 envelope / signer / 簽章但暫不 commit nonce → topic payload schema → per-signer rate limit → commit nonce」順序；因此限流拒絕的 unique nonce 不會先灌滿 replay 集合。一般非 Gossip 呼叫仍使用一次完成驗證與 commit 的 `verifyP2PMessage`。

## 3. CSP（生產環境；build 時生成 `<meta>` 注入）

**交付機制**：主站 = GitHub Pages、**無法設自訂 HTTP header** → production build 完成 prerender
後，`scripts/inject-csp.mjs` 遍歷 dist 的每一份 HTML，呼叫 `scripts/csp-policy.mjs` 的
`contentSecurityPolicyFor(html)`，再注入 `<meta http-equiv="Content-Security-Policy">`。各路由的
inline import map、JSON-LD 與 stylesheet `onload` 內容不同，因此 policy 是**逐頁生成**，不可把
單一預先組好的 policy 複製到全部頁面。

```typescript
const baseline = [
  "default-src 'self'",
  "worker-src 'self' blob:", // Sanitize / 指紋 Worker
  "connect-src 'self' wss: https:", // scheme 級白名單：玩家可自選 signaling / pinning / gateway 節點（資安規範 §4），固定域名白名單會擋自選端點；仍擋非 TLS 外連
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

`package.json` 依賴皆 pin 精確版本（無 `^` / `~`；版號 ＝lockfile 實際解析值）。CI 兩道：主 CI `pnpm install --frozen-lockfile`（比對 lockfile）＋`.github/workflows/security.yml`（push / PR / 每週排程）`pnpm audit --audit-level moderate`——audit warning ≥ moderate 阻擋 merge（[資安規範.md §6.2](../資安規範.md)）。只允許 well-known 核心套件（Rapier / libp2p / OrbitDB…）。

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
