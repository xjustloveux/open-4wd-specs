---
type: impl
domain: ["UGC版權", "資安"]
summary: 第一層 Provider-scoped Inbox、簽章快照、已讀與更新生命週期
authority: null
slug: null
---

# inbox（Provider-scoped 持久收件匣）

> **本檔角色**：定義 client 的第一層 `/inbox`、來源抽象、本機最小快照、已讀標記、
> 更新排程與身分隔離。Provider 端 DMCA wire 與案件處理見 [dmca.md](dmca.md)，玩家流程見
> [DMCA.md](../流程/DMCA.md)。對應 `src/inbox/` 與
> `src/pages/inbox-page/`。

## 1. 邊界與導覽

- `/inbox` 是 Player Shell 的第一層固定目的地，受 `requireUnlockedGuard` 保護；目前唯一真實
  tab 是 `/inbox?tab=dmca`。未知 tab 正規化為 `dmca`，未來只有接上真實 `InboxSource` 才新增
  tab，不預建空類型。
- 未解鎖時不讀本機快照、不查 provider、不顯示 badge；安全的 `returnUrl` 會保留
  `/inbox?tab=dmca`，解鎖後回到原頁並將焦點移到標題。
- Inbox 只收身分定向且需再次處理的持久事項。一般遊戲提示仍是短暫 toast，不進 Inbox。
- 每筆資料保留 `providerId` 與 UI 用 label；沒有全域、官方或跨 provider 的 Inbox。單一
  provider 的案件不形成 client 的 UGC use-gate。

## 2. 公開型別與分層

`src/inbox/types.ts` 的核心契約如下：

```typescript
type InboxKind = "dmca";
type InboxBucket = "actionable" | "pending" | "resolved";
type InboxCacheState = "live" | "stale";

interface InboxSource {
  readonly kind: InboxKind;
  discover(signal: AbortSignal): Promise<readonly InboxProviderDiscovery[]>;
  loadProvider(
    provider: InboxProviderRef,
    peerId: PeerId,
    signal: AbortSignal,
  ): Promise<InboxProviderLoad>;
  restore(record: InboxSnapshotRecord, peerId: PeerId): readonly InboxItem[];
  subscribeInvalidation(listener: () => void): () => void;
}
```

分層責任：

| 元件 | 責任 |
|---|---|
| `InboxCoordinator` | 綁定 PeerId、還原本機狀態、逐來源更新、錯誤隔離、排序、未讀、toast 與排程 |
| `InboxSource` | 發現自身 provider、載入單一 provider、驗證並正規化 item、還原可信 snapshot |
| `DmcaInboxSource` | 將 `ProviderDmcaInboxEntry` 映射為 bucket、action 與 stale/live 狀態 |
| `InboxLocalStore` | 保存 PeerId-scoped signed snapshot 與 read marker，不認識 DMCA 法律語意 |
| `ProviderDmcaAccess` | 只列玩家設定或已 watch 的 DMCA provider，逐目標載入並保留 provider 邊界 |

`InboxCoordinator.state` 發布 `InboxState`：`peerId`、排序後 `items`、`unreadCount`、
`activeKind`、頁內 `announcement`、`refreshing`、逐 provider `providerErrors` 與
`persistence`。一個 provider 失敗只產生自己的錯誤與 backoff，不遮蔽其他成功來源。

## 3. 本機儲存

Inbox 使用統一 IndexedDB `open-4wd`，`UNIFIED_DB_VERSION = 1`；開發期直接在 current v1
store 名錄包含兩個 keyPath `id` 的 object store：

| Store | Key | 內容 |
|---|---|---|
| `inbox-snapshots` | `[peerId, kind, providerId]` 的 JSON tuple | `peerId`、`kind`、`providerId`、`receivedAt`、provider signed envelope |
| `inbox-read-markers` | `[peerId, kind, providerId, itemId]` 的 JSON tuple | `updatedAt` 版本化已讀標記 |

`InboxSnapshotRecord` 不保存 provider URL、通知人或上傳者姓名、email、電話、地址、法律
敘述或人類簽名。Signed envelope 必須保留 provider 的密碼學簽章與最小 entries，否則離線時
無法重新驗證 signer 與內容；這不等於保存 Notice／Counter-Notice 的人類簽名。

`IndexedDbInboxLocalStore` 每次操作經 `openUnifiedDb()` 開啟並用畢關閉。
`FallbackInboxLocalStore` 在持久層失敗後切到 `MemoryInboxLocalStore`，UI 顯示 memory warning；
不得把持久化失敗偽裝成成功。刪除 profile 呼叫 `deletePeer(peerId)`，清除網站資料呼叫
`clearAll()`；一般 lock／登出只清記憶體，不刪該 PeerId 的持久資料。

## 4. Live 與 cache 驗證

`ProviderDmcaClient.loadInbox()` 對 `POST /api/dmca/inbox` 使用原上傳 PeerId 簽章請求。Live
response 必須通過：

1. 64 KiB response 上限與 exact schema；entries 最多 100 筆。
2. response signer、payload `providerId` 與目前 descriptor provider PeerId 完全一致。
3. payload `subjectPeerId` 等於目前已解鎖 PeerId。
4. Ed25519 簽章、payload 與 wire timestamp 五分鐘 freshness。
5. 共用 `ProviderDmcaReplayGuard` 的 signer＋nonce 防重放。

`verifyCachedProviderDmcaInbox()` 走同一 exact schema、signer、subject 與簽章驗證，但刻意不套
live freshness，也不寫入 live replay guard。通過後只產生 `cacheState: "stale"` 的顯示資料；
不得用 cache 假報即時案件、提交成功或 provider 可用。成功 live response 取代該 provider
舊項目；空成功 response 刪除 snapshot，失敗則保留最後一次已驗 snapshot。

## 5. 身分與競態生命週期

`InboxCoordinator.bindIdentity(peerId)` 是唯一 session 邊界：

1. 每次 PeerId 改變先增加 session epoch 與 refresh id、abort in-flight request、取消 timer、
   dismiss Inbox summary toast，立即清空 DOM 所依賴的 state。
2. `peerId === null` 到此停止，不讀 IndexedDB、不 discover provider。
3. 新 PeerId 先平行讀 snapshot 與 read marker；每個完成點都重驗 epoch＋PeerId。
4. 還原完成後發布 stale state，再執行 `refresh("unlock")`。
5. Live discovery、load、snapshot write、badge 與 toast 前再次驗 epoch＋PeerId＋refresh id；
   舊身分或舊輪次的遲到 response 全部丟棄。

同分頁 lock、跨分頁 lock、登出與身分切換都經此邊界，因此頁面、badge、toast 與記憶體會
同步撤銷。`/inbox` 若在已顯示後失去已解鎖身分，立即導回 `/login` 並保留安全 return URL。

## 6. 更新政策

實作常數位於 `src/inbox/refresh-policy.ts`：

| 名稱 | 值 | 行為 |
|---|---:|---|
| `ENTER_REFRESH_MS` | 60,000 ms | 進 Inbox 且距上次 attempt 超過一分鐘才更新 |
| `FOREGROUND_REFRESH_MS` | 300,000 ms | 回前景／恢復連線且距上次 attempt 超過五分鐘才更新 |
| `PERIODIC_REFRESH_MS` | 1,800,000 ms | 只在前景且 online 排程；jitter 為 0.9–1.1 倍 |
| `PROVIDER_BACKOFF_MS` | 60,000／300,000／900,000／3,600,000 ms | 同 provider 連續失敗的 1／5／15／60 分鐘上限 |

Unlock、provider 設定或 watch target 改變會立即觸發更新；使用者可手動 refresh 或個別 retry，
manual retry 可略過該 provider 的時間 backoff，但仍要求 online 與 visible。App 關閉、背景、
offline 或未解鎖時不輪詢。

## 7. DMCA 顯示與 action 矩陣

| `legalStatus` | Bucket | UI action |
|---|---|---|
| `received` | actionable | 查看案件，不提供反通知按鈕 |
| `taken_down` | actionable | provider 可用且沒有 `litigationHold` 時提供準備 Counter-Notice |
| `pending-email-confirm`／`pending-identity-review` | pending | 顯示等待進度 |
| `rejected_by_admin`／`restored_after_counter` | resolved | 顯示結案；資源仍可是 `missing` |

排序固定為未讀 actionable、已讀 actionable、pending、resolved；各層以 `updatedAt` 新到舊。
開啟個別 row 才呼叫 `openItem(key)` 寫入 read marker；dismiss toast、進入 Inbox 或切 tab 都不
批次標記已讀。Stale、provider unavailable、resource availability 與 litigation hold 分開顯示，
hold 絕不暗示自動恢復或可提交反通知。

## 8. 摘要通知與無障礙

非目前 tab 的同輪變更由 `InboxCoordinator` 合併為一個 generic Inbox warning toast，action
導向 `/inbox`；只有單一 kind 時帶 `?tab=<kind>`。位於對應 tab 時不顯示 toast，只更新清單、
badge 與 `aria-live` announcement。Player 導覽固定顯示 Inbox，未讀數以 badge 與可讀的
`aria-label` 呈現。

Inbox 標題可程式化聚焦；row trigger 有 `aria-expanded`／`aria-controls`，收合後焦點回原 row。
手機、平板、桌面與 ultrawide 均允許長 provider id、notice id 與 CID 換行，不以細小固定角落
裝飾壓縮法律狀態或操作區。
