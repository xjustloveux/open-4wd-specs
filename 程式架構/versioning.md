---
type: impl
domain: ["版本部署"]
summary: 版本收集／相容性／開賽前驗證／SW 升版／build
authority: null
slug: null
---
# versioning（版本系統實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/versioning.md](程式流程/versioning.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：A 軸 client 版本系統的**實作層**細節 —— 版本收集協議、相容性檢查、開賽前驗證、升版檢查 API、Service Worker 升版、強制重整、build 整合。
> 設計與六欄位定義見 [版本規範.md](../版本規範.md)（[§1](../版本規範.md#1-六欄位版本)–[§13](../版本規範.md#13-不變式ci-強制) A 軸）；常數見 [network.md §11](../程式參數/network.md#11-networkversioning版本升版)。對應 `src/versioning/`（SW 通用快取策略與 `src/pwa-offline/` 共用）。

## 1. 版本收集協議

開賽前**全員對稱收集互驗**（非 host 單端收集）：各參與者同時掛 `serveVersionRequests`（應答他端 `version-request`）＋ 各自跑 `collectVersionsFromAllPeers` 收齊互驗——任一端收不齊即該端拒開（**fail-closed**；[版本規範.md §6](../版本規範.md)）：

- 廣播 `version-request` → 各 peer 回 `{ type:'version-info', sender, payload: VERSION_INFO }`。
- 嘗試 `1 + VERSION_COLLECT_RETRY` 次，每次等 `VERSION_COLLECT_TIMEOUT_MS`（[network.md §11](../程式參數/network.md#11-networkversioning版本升版)）。
- **收齊性檢查（防靜默放行）**：少任一 peer → 整體失敗，不得以不全的版本集開賽。
- **身分綁定**：handler 收傳輸層認證身分 `from`，自報 `sender !== from` ＝ 冒名丟棄（與 roster／ 結算訊息同規）。

```typescript
function serveVersionRequests(wire, myPeerId, myInfo): Unsubscribe {   // host / member 都掛
  return wire.onMessage((message, from) => {
    if (message.type !== 'version-request' || message.sender !== from) return;   // sender ≠ from＝冒名丟棄
    if (message.sender === myPeerId) return;                                     // 不應自己的 request
    wire.send({ type: 'version-info', sender: myPeerId, payload: myInfo() });
  });
}

async function collectVersionsFromAllPeers(roomMembers, wire, myPeerId): Promise<Map<PeerId, ClientVersionInfo>> {
  const collected = new Map([[myPeerId, VERSION_INFO]]);
  const expected = roomMembers.filter(p => p !== myPeerId);
  const unsubscribe = wire.onMessage((message, from) => {
    if (message.type !== 'version-info' || !expected.includes(message.sender)) return;
    if (message.sender !== from) return;                    // 身分綁定：自報 sender ≠ 連線來源 → 丟棄
    collected.set(message.sender, message.payload);
  });
  for (let i = 0; i <= VERSION_COLLECT_RETRY; i++) {
    wire.send({ type: 'version-request', sender: myPeerId });
    await waitUntil(() => expected.every(p => collected.has(p)), VERSION_COLLECT_TIMEOUT_MS);
    if (expected.every(p => collected.has(p))) break;
  }
  unsubscribe();
  return collected;  // 收齊性由 §3 preRaceVersionCheck 把關
}
```

## 2. 相容性檢查

六欄位任一不同 → 拒配對（[版本規範.md §5](../版本規範.md)）。`client_version` 比 major 段，`rapier_version` / `protocol_version` / `derive_logic_version` / `builtin_assets_version` / `economy_config_version` 全等比對。

```typescript
function checkCompatibility(mine, peerVersions): { compatible: boolean; incompatible: { peer; reasons }[] } {
  const myMajor = parseClientVersion(mine.client_version).major;
  const incompatible = [];
  for (const [peer, v] of peerVersions) {
    const reasons = [];
    if (parseClientVersion(v.client_version).major !== myMajor) reasons.push('client_version major');
    if (v.rapier_version        !== mine.rapier_version)        reasons.push('rapier');
    if (v.protocol_version      !== mine.protocol_version)      reasons.push('protocol');
    if (v.derive_logic_version  !== mine.derive_logic_version)  reasons.push('derive_logic');
    if (v.builtin_assets_version !== mine.builtin_assets_version) reasons.push('builtin_assets');
    if (v.economy_config_version !== mine.economy_config_version) reasons.push('economy_config');
    if (reasons.length) incompatible.push({ peer, reasons });
  }
  return { compatible: incompatible.length === 0, incompatible };
}
```

`parseClientVersion` 以 `CLIENT_VERSION_REGEX = /^\d+\.\d+\.\d+$/` 驗證後拆三段（不符即 throw）。

## 3. 開賽前驗證

```typescript
async function preRaceVersionCheck(roomMembers, signaling, myPeerId): Promise<Result<void>> {
  const all = await collectVersionsFromAllPeers(roomMembers, signaling, myPeerId);
  const missing = roomMembers.filter(p => !all.has(p));
  if (missing.length) return error(`版本收集失敗，缺：${missing.map(p => p.slice(-4)).join(', ')}`);  // 防靜默放行
  const r = checkCompatibility(VERSION_INFO, all);
  if (!r.compatible) return error(formatIncompatible(r.incompatible));
  return ok();
}
```

最終驗另含 ledger `economy_config_version` 一致 + builtin-assets CID 比對（[版本規範.md §7](../版本規範.md)）。

## 4. 升版檢查 API

`UpdateChecker` 定期（`UPDATE_CHECK_INTERVAL_MS`）呼叫：

```typescript
class UpdateChecker {
  async checkForUpdate(): Promise<UpdateInfo | null> {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    try { await reg.update(); } catch { return null; }
    if (!reg.waiting) return null;
    const newVersion = await (await fetch('/version.json', { cache: 'no-cache' })).json().then(d => d.client_version);
    return { hasUpdate: true, currentVersion: VERSION_INFO.client_version, newVersion,
             isMajor: VERSION_INFO.client_version.split('.')[0] !== newVersion.split('.')[0] };
  }
  async applyUpdate(): Promise<void> {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.waiting) return;
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    location.reload();
  }
}
```

`UPDATE_FORCE_GRACE_PERIOD_MS`（24h）後強制升版（[版本規範.md §10](../版本規範.md)）。

## 5. Service Worker（版本升版部分）

- `install`：cache `PRECACHE_ASSETS`；**不自行 `skipWaiting`**。
- `activate`：只清 `open4wd-` namespace 下非當前 `ACTIVE_CACHE_NAMES` 的舊 cache；保留同 origin
  foreign cache，且不碰 IndexedDB／localStorage。
- `message SKIP_WAITING` → `skipWaiting()`；由 UI 層在「2 分鐘後自動套用（minor）/ 立即更新（major）」時觸發，**觸發前先過 idle guard**（比賽 / 房間 / Stage 2 編輯中不觸發、延後至離開後的下一個 idle 時點；[版本規範.md §8.2](../版本規範.md) 套用時機 guard）。
- `fetch`：`BYPASS_PATHS = ['/version.json']`，另以 `/reset/` 子樹前綴判斷 → network-only（連 cache 都不查；reset 拆外部 JS＝CSP `script-src 'self'` 相容）；`/api/` 不 cache；**導航 / HTML → network-first**（升版拉得到新 shell 的前提）；其餘靜態 → cache-first。完整分路表以 [pwa-offline.md §2](pwa-offline.md) 為準。
- `CACHE_NAME` 嵌入 client_version 與 builtin_assets_version（build 時更新，[§7](#7-build-整合)），
  client 或公版資產版本改變都會隔離快取。

> 通用 PWA 快取策略（cache-first / network-first 分路）與 `src/pwa-offline/` 共用，本節僅涵蓋版本升版相關部分。

## 6. 強制重整 + `/reset/`

- `forceReload()`：unregister 所有 SW + clear 所有 caches + reload（[版本規範.md §9.1](../版本規範.md)）。
- `/reset/`：純 static、僅依賴瀏覽器原生 API、整個子樹由 SW 白名單放行；SW 卡死、SPA 無法載入時的逃生口（[§9.2](../版本規範.md#92-reset-逃生口)）。設定頁與「版本不符」對話框 ／toast 都應顯示其連結兜底。

## 7. Build 整合

GitHub Actions：

- 產 `version.json`（含六欄位 + build_timestamp + commit_hash）。
- 更新 SW `CACHE_NAME` 為當前 client／builtin 版本
  （`open4wd-${CLIENT_VERSION}-assets-${BUILTIN_ASSETS_VERSION}`）。
- CI 驗 `client_version` 符合 `CLIENT_VERSION_REGEX`，不符拒 deploy（[版本規範.md §1.1](../版本規範.md)）。
