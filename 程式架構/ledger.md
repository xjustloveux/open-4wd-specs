---
type: impl
domain: ["共識帳本"]
summary: 事件鏈／DerivedState／檢查點／partition／sync／fork resolution
authority: null
slug: null
---

# ledger（事件鏈 / DerivedState / 帳本檢查點 實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/ledger.md](程式流程/ledger.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：ledger 穩定入口與共用 runtime/API authority。事件 wire 與收件見 [ledger-admission.md](ledger-admission.md)，狀態與檢查點見 [ledger-checkpoint.md](ledger-checkpoint.md)，比賽結算見 [ledger-settlement.md](ledger-settlement.md)。既有章節錨點保留為導覽，不複製規範正文。

## 分冊入口

| 分冊 | Authority |
|---|---|
| Admission | [ledger-admission.md](ledger-admission.md) |
| Checkpoint | [ledger-checkpoint.md](ledger-checkpoint.md) |
| Settlement | [ledger-settlement.md](ledger-settlement.md) |

## 1. BaseEvent 與簽章

本節 authority 已集中於 [ledger-admission.md](ledger-admission.md)。

### 1.0 事件目錄與 ledger 自有結構

本節 authority 已集中於 [ledger-admission.md](ledger-admission.md)。

### `serializeForSigning`（dag-cbor canonical）

本節 authority 已集中於 [ledger-admission.md](ledger-admission.md)。

### 1.1 永久 entry 的 Admission v1

本節 authority 已集中於 [ledger-admission.md](ledger-admission.md)。

### `MatchResultEvent.signatures` vs `BaseEvent.signature`

本節 authority 已集中於 [ledger-admission.md](ledger-admission.md)。

## 2. DerivedState 巢狀結構（hot / cold 兩層）

本節 authority 已集中於 [ledger-checkpoint.md](ledger-checkpoint.md)。

### 子型別（重點）

本節 authority 已集中於 [ledger-checkpoint.md](ledger-checkpoint.md)。

### Partition 切分函式（deterministic）

本節 authority 已集中於 [ledger-checkpoint.md](ledger-checkpoint.md)。

## 3. 帳本檢查點（LedgerCheckpoint）演算法

本節 authority 已集中於 [ledger-checkpoint.md](ledger-checkpoint.md)。

## 4. Sync 與 Fork Resolution

本節 authority 已集中於 [ledger-checkpoint.md](ledger-checkpoint.md)。

### 4.1 有界 entry sync 與本機持久化

本節 authority 已集中於 [ledger-checkpoint.md](ledger-checkpoint.md)。

## 5. 比賽結果與經濟結算結構

本節 authority 已集中於 [ledger-settlement.md](ledger-settlement.md)。

### `collectAllUgcUsedInMatch`（純函數）

本節 authority 已集中於 [ledger-settlement.md](ledger-settlement.md)。

### 比賽結算簽章交換協議（實作）

本節 authority 已集中於 [ledger-settlement.md](ledger-settlement.md)。

## 6. Derive Utilities

**〔LEDGER-R-055〕** `registeredAt` 與 `lastEventAt` 只能由 canonical fold 的共識時鐘推導，自報 timestamp 不得倒填。

**〔LEDGER-R-056〕** 多簽事件的 publisher `peerId` 不代表被簽署者身分，不得寫入其 `registeredAt` 或 `lastEventAt`。

```typescript
// P2P deterministic「現在」：derive 禁用 Date.now()（各 peer 機器時間不同 → 結果不一致 → 驗簽炸裂）
function consensusNow(events: ReadonlyArray<LedgerEvent>): Timestamp {
  return events.reduce((max, e) => Math.max(max, e.timestamp), 0); // 空 ledger 回 0
}
// 特定 peer 最近寫 ledger 的事件 timestamp（P5 退役「創作者離開」判定用）
// —— 已具體化為 DerivedState.lastEventAt 索引（ledger-checkpoint.md §2）：共通 fold 對每筆事件記
//    lastEventAt[e.peerId] = 套用時鐘 clock = max(先前 head, 自報 timestamp)（同 registeredAt 反倒填語意）；未活動回 0
function lastEventTimestampOf(peerId: PeerId, state: DerivedState): Timestamp {
  return state.lastEventAt.get(peerId) ?? 0;
}

// registeredAt：該 peer 首筆事件「套用時」的 consensusNow（= max(先前 head, 該事件自報 timestamp)）
// —— 自報 timestamp 倒填無效（防偽造年資過 30 天仲裁門檻 / 濫用 7 天新手下限；ledger-admission.md §1 收件容差為第一道防線、本定義為第二道）
// applyEvent 時：if (!state.reputation.registeredAt.has(e.peerId)) registeredAt.set(e.peerId, consensusNow(eventsUpTo(e)))
// 多簽事件（match-result／config-update／race-consensus-anchor／desync／ledger-checkpoint）BaseEvent.peerId＝發布者、
//    非密碼學綁定身分（fold 不驗其單簽）：共通 fold **不以其驅動 registeredAt／lastEventAt 歸屬**——否則任一 peer
//    以舊時戳重播他人真多簽＋冒名 peerId 即可灌活動（延後受害者 UGC 退役）／預釘其註冊時點。finisher 場數改由
//    reputation reducer 以已驗 ranking 記、註冊時點由本人單簽事件定；多簽事件僅推進 clock／套用計數。
```

> **〔LEDGER-R-054〕** **不變式**：所有 time-based derive 規則（退役判定、24h 覆蓋防抖、cold 切分、pendingReports expire）**必須用 `consensusNow`，不得用 `Date.now()`**。此為跨 peer 共識安全的硬規則。

### 6.1 fold 守門（foldGuard）—— 歷史 append 繞過收件驗證的最後防線

**〔LEDGER-R-057〕** log 的 access controller 為 `write:['*']`，任何 peer 都可用舊時戳條目繞過 live ±30 秒檢查。凡「錯誤事件被 fold 套用即造成不可逆傷害」的驗證，必須是 timeless 且只依賴事件自身或 canonical state。match-result 因此讓 live admission 與 fold 共用同一自包含 facts validator；經濟公式則只在 fold 依事件位置前態計算，事件不能選擇 base 或 payout。

**〔LEDGER-R-058〕** **Admission 不取代業務冪等**：完全相同的 final entry 由 CID 去重，同一 proof 也不能跨 clock／parents／Orbit signature 免費重用；但攻擊者仍可把觀察到的同一已簽 payload 包進 parents／clock 不同的新 entry，逐筆支付 PoW。故**累積型** reducer（餘額扣減 ／ 鑄幣 ／ 費用 ／ 計數）必須自帶 `matchId`／CID／事件 id／signed-intent digest 等 fold 冪等守門；**冪等型** reducer（Set add／Map set 覆蓋）才是天然安全。

`ugc-sponsor-burn` 與 `ugc-maintenance` 的鍵為 `paymentIntentDigest`：對 canonical unsigned payload 與其單簽加 domain 後取 SHA-256。該簽章已覆蓋 exact ledger chain identity，因此鍵具 chain scope；輸入刻意不含 Orbit entry parents、clock、identity、Orbit signature 或 admission proof。同一已簽 payload 換 entry 仍命中，真正不同的已簽意圖則得到不同鍵。`processedPaymentIntents` 只在全部業務守門通過並成功扣款時原子加入，永不逐出、隨 checkpoint canonical 序列化；pre-launch checkpoint 缺欄或 digest 非 64 位小寫 hex 一律 fail-closed。

**〔LEDGER-R-059〕** **fold 迴圈前置時鐘防毒閘**：fold 於 reducer 之前一律排除**未來時戳**（`event.timestamp > fold 時鐘`）條目——放行會把 consensus clock 推去未來、癱瘓全部 time-based derive；此為迴圈前置、**非 reducer 守門**（不入下表），各誠實 peer 於各自 fold 時刻同判定 ＝ 隨時間推進收斂（近未來戳 ＝ 兩造短暫不一致 → 拒簽重試、fail-closed）。

fold 守門目錄（各 reducer 於 apply 首行判定、無效 ＝ 回傳原 state 的 no-op）：

| reducer                                                                      | fold 守門（timeless、state 可判）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 〔ECON-R-043〕 〔ECON-R-042〕 **〔LEDGER-R-060〕** `match-result`（economy） | timeless 自包含驗證：matchId/grid proof、loadout participation、original-roster quorum、逐回合 inline anchor 的 grid binding／tail／present roster／嚴格多數全部有效；`matchId` 已入帳＝重播 no-op。事件無 payout/frontier；fold 由 `state.economyConfig`、rating 與 `state.derivedAt` 算 settlement。`monthMinted + incomingMint > month_hard_cap_minor` 時 outcome=`monthly-hard-cap`、零入帳但仍留 MatchRecord，exact cap 允許。 |
| **〔LEDGER-R-061〕** `ugc-upload`（economy 費）                              | `cid` record 已存在＝已收過費、重播 no-op（record 由本事件後的 ugc reducer 建、首次不誤擋）；費額直接取 `state.economyConfig` 現值（事件不自報金額）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **〔LEDGER-R-062〕** `slot-purchase`（economy）                              | `payer === peerId`（冒名守門）；`amount === state.economyConfig.expansion_costs.vehicle_slot_minor`（**費率收口**——低報含負額自鑄、高報誤植皆無效；config 切換競態＝安全向拒、付舊價重試）；餘額足；`newSlotIndex` 防跳級                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **〔LEDGER-R-063〕** `ugc-sponsor-burn`（economy）                           | `paymentIntentDigest` 已在 `processedPaymentIntents`＝重播 no-op；`payer === peerId`；`amount ≥ max(1, state.economyConfig.sponsorship.min_amount_minor)`；target record 必須存在且非 builtin／黑名單／付款人自己的作品；餘額足。live 對已消費 intent reject、record 尚未同步採 defer，其餘違規 reject；fold 共用同一 digest／政策並以 no-op 作最後防線；成功扣款才原子記 digest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **〔LEDGER-R-064〕** `ugc-maintenance`（economy）                            | `paymentIntentDigest` 已在 `processedPaymentIntents`＝重播 no-op；`payer === peerId`；`burnAmount === state.economyConfig.ugc_lifecycle.maintenance_burn_minor`（費率收口）；`retire` 限血緣創作者；餘額足；成功扣款才原子記 digest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **〔LEDGER-R-065〕** `config-update`（economy 治理）                         | `prevEpoch === state.economyConfig.epoch` 且 `epoch === prevEpoch+1`（連號；重播天然 no-op）；`newConfig` 結構逐欄驗（壞形入 state＝毒化後續費率驗證／治理斷鏈）＋`newConfig.epoch === epoch`＋revShare 總和 100；簽章集：distinct 有效 signer ∈ **prevEpoch** `governanceSigners` 達門檻（N=1 時 1；N>=3 時 ⌊2N/3⌋+1；N=2 非法；digest＝ledgerSigningDigest(ledgerAddress, 事件剔 signature\|signatures)）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 〔MOD-R-046〕 `arbitration-result`（moderation）                             | panel-signature-set **恆驗**：≥ quorum 面板 attestation（distinct、∈ arbiters、非兩造、年資／場數穩定必要條件、簽章對 `(reportEventId, target, result, passRatioX100)` digest 有效）；池不足流局（arbiters=[]）＝限 no-quorum＋合格池上界 < 7；timestamp ≥ 程序下界；案錨摘要與 state 案錄逐位一致＋同案首筆有效（[moderation.md §5.6](moderation.md)）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **〔LEDGER-R-066〕** `blacklist-cid`（anti-piracy）                          | 須存在一筆 `result === 'pass'` 且 `target === cid` 的仲裁結果——否則任一 peer 一筆事件即可全網下架任意 UGC（其信任根＝上列 arbitration-result 恆驗）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **〔LEDGER-R-067〕** `report`（moderation）                                  | `targetKind ∈ {cid, peer}`；其餘資格門檻見 [moderation.md §5.6](moderation.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**〔LEDGER-R-068〕** **畸形事件 fold 韌性**：fold 迴圈對每筆事件的 applier 呼叫包 try/catch——applier 拋錯（欄位缺失 ／ 型別違規 ／ 簽章畸形）時**確定性跳過該筆**、繼續 fold，而非整鏈 brick。確定性來自「所有 peer 對同一畸形輸入都拋錯」；跳過是純函數行為、不寫狀態。對應 `src/ledger/`（`#applyEntry`／`#foldEntries`）。

## 7. UGC 退役生命週期（P5，純 derive）

**〔LEDGER-R-069〕** 退役判定**完全自動、純 derive、不寫事件**；pinning service 看到 `retired: true` 自動 unpin。

```typescript
function deriveRetireStatus(
  rec: UgcRecord,
  state: DerivedState,
  cfg: EconomyConfig,
  now: Timestamp,
): { retired: boolean; maintenanceCandidateSince: Timestamp | null } {
  // builtin / blacklist 不走退役流程
  // 候選條件（任一）：noUseRecently（久未使用）/ lowRatingNoUse（低評分且久未用）/ creatorGone（創作者離開）
  //   閾值取自 cfg.ugc_lifecycle.*；now = consensusNow
  // 已退役 → 保持（除非 unretire）；候選期內有使用/續租 → 取消候選；過 maintenance_grace_ms → 自動退役
  //
  // 觸發點精確式（實作即權威，src/economy/lifecycle.ts）：lastUsed = usage.lastUsedAt ?? uploadedAt
  //   noUse           = lastUsed + candidate_no_use_ms
  //   lowRatingNoUse  = rating(ratingApiFor) < candidate_low_rating_threshold_x100 時：lastUsed + candidate_low_rating_no_use_ms
  //   creatorGone     = max(lastEventTimestampOf(author), lastUsed) + candidate_creator_gone_ms   // 離開「且」該窗內無人用才候選
  //   since = max(min(成立觸發點), rec.lastMaintenanceAt ?? 0)   // 續租屏障：renew/unretire 只買一個 grace 窗
  //   since > now ＝ 非候選；now > since + maintenance_grace_ms ＝ 自動退役；否則候選（回 since）
  // 讀取端一律傳共識可決 now（含 settlement 均為 state.derivedAt）——禁牆鐘與 event.timestamp
}
```

`UgcMaintenanceEvent`（UGC 生命週期事件；**自動退役本身不寫事件**，手動 retire / 續租 / 重啟才寫）：

```typescript
interface UgcMaintenanceEvent extends BaseEvent {
  type: "ugc-maintenance";
  cid: CID;
  payer: PeerId; // renew / unretire 任何人可付（利他續命）；retire 限創作者本人（見下守門）
  burnAmount: bigint; // cfg.ugc_lifecycle.maintenance_burn_minor
  reason: "retire" | "renew" | "unretire"; // retire=手動立即退役 / renew=取消候選 / unretire=重啟
}
```

`deriveRetireStatus` 除自動條件外，另吃**手動 retire 事件**（見到 `reason:'retire'` → 立即退役）。

**`reason:'retire'` 守門**：收件 / apply 驗 `payer === 該 CID 血緣節點創作者`（[資料系統.md §4.1](../資料系統.md)），不符 ＝ 事件無效 no-op（同燒幣守門模式，[economy.md §2](economy.md)）——否則任何人付一筆 burn 即可下架他人熱門 UGC、斷其 royalty。`renew` / `unretire` 維持任何人可付。

**〔LEDGER-R-070〕** apply 時：扣 payer `burnAmount`（**費率收口**：必須 ＝`state.economyConfig.ugc_lifecycle.maintenance_burn_minor`、不符 no-op，[§6.1](#61-fold-守門foldguard-歷史-append-繞過收件驗證的最後防線)）、清 `maintenanceCandidateSince`、`retired=false`（若 unretire）、`lastMaintenanceAt = event.timestamp`（renew／unretire 記 grace 屏障；retire 不動）；**`lastUsedAt` 不更新**（續租不算使用，避免付費延期但無人用造成 pinning 浪費）。續租只買一個 grace 窗、買不到永久保留。設計見 [資料系統.md §13](../資料系統.md)。

## 8. Config Update

economy-config 變更走治理 multisig，事件結構（epoch 模型、含 `rationale`）見 [資料系統.md §12](../資料系統.md) `ConfigUpdateEvent`——**單一事件族**（config 值 / signer set / 緊急回滾 ＝ 設回舊值，皆同型別）。治理 signer set 由 genesis config 初始化（`EconomyConfig.governanceSigners`）：只允許 `N = 1`（初期單一真治理者，quorum 1）或 `N >= 3`（quorum `floor(2N/3)+1`），`N = 2` 拒絕。不得由同一人為湊數量來製造三個虛假獨立身分。增減 signer 須透過 `ConfigUpdateEvent`（改該欄）並達**既有（prevEpoch）** signer set quorum。

**〔LEDGER-R-071〕** **簽章與上鏈形（實作即權威，src/economy/governance.ts）**：提案流程定稿 `timestamp`／`peerId`（提案者）後，各 signer 對 `ledgerSigningDigest(ledgerAddress, 事件剔 signature|signatures)` 簽章（`signers[]`／`newConfig`／`rationale` 全在涵蓋內——簽後任何篡改使簽章失效，且不可跨 chain 重放）；達 quorum 以 `appendPreSigned` **原樣上鏈**（不得重 stamp）。**fold 守門 ＝reducer 首行（timeless）**：epoch 連號 ＋ 結構逐欄驗 ＋ 不變式 ＋ 簽章集 quorum（[§6.1](#61-fold-守門foldguard-歷史-append-繞過收件驗證的最後防線) 目錄）——歷史 append 與 live 首播同一判定；epoch 化後 `DerivedState.economyConfig`（[§2](#2-derivedstate-巢狀結構hot--cold-兩層)）即 fold 位置的生效 config，固定費率事件（slot／maintenance／upload 費）對其精確驗證。

## 9. DesyncEvent

```typescript
interface DesyncEvent extends BaseEvent {
  type: "desync";
  raceId: string;
  frame: number;
  participatingPeers: PeerId[];
  hashes: Readonly<Record<PeerId, string>>;
  signatures: Signature[]; // 被踢者自簽（欄容多簽、他端自願附簽為開放項）
}
```

**〔LEDGER-R-072〕** 不影響玩家信譽，純供開發者調查 desync。寫入者 ＝ 被踢者本人（自報其觀測的 hash 票面；無法強制他人為調查記錄簽章）——無 state reducer、收件放行（[流程/比賽進行.md §6](../流程/比賽進行.md)）。

## 10. 客戶端 Storage 與同步安全邊界

**〔LEDGER-R-073〕** OrbitDB log append-only 永久累積；客戶端不必本地保留已被 finalized checkpoint 覆蓋的事件。runtime 使用 wire-compatible 的 bounded Events/Sync adapter，entry fallback 是**專屬本機** IDB blockstore，不是 Helia/Bitswap broker；不得直接換回 stock Sync（stock 路徑會在 raw size admission 前 decode remote entry）：

```typescript
const LRU_ENTRY_LIMIT = 10000; // protocol-adjacent 固定本機硬上限；不得依裝置動態改共識可得性
const LRU_HEADS_LIMIT = 64;
// entryStorage = TraversalBudgetStorage(ComposedStorage(LRUStorage, boundedLocalEntryStorage))
```

- 單 entry block `256 KiB`；本機 ledger blockstore `128 MiB / 10,000 blocks`；單次 remote traversal `64 MiB / 2,048 entries`。串流 block 在累計超限當下中止，不先全量配置；重啟時由 `getAll()` 重建 conservative accounting，無法確認時飽和 fail-closed。
- quota eviction **只可**淘汰已被目前 checkpoint 覆蓋且非 boundary 的 block；沒有安全 victim 就拒絕新寫入。explicit delete 同步更新 byte/count accounting。
- Admission outbox 的 row、查詢、quota、更新與刪除一律以完整 `chainId` scope；共用同一
  IndexedDB 時，row key 形如 `<chainId>:<entryCid>`，list 不得回傳其他 chain 的 prepared
  entry。CID-keyed entry/content blockstore 仍以 CID 去重，不為相同 bytes 建立鏈別副本。
- remote head 在 `Entry.decode` 前先過 `256 KiB/head`、每 authenticated libp2p peer `1 MiB + 256 messages / 60s`，最多追蹤 4,096 peer state；另有全來源 `16 MiB + 4,096 messages / 60s` 與等待 queue `4 MiB / 64 messages` 硬上限，source LRU churn 不會重置 global budget。dial/receive 失敗必須 abort/close stream 並釋放 peer state，允許後續重連。
- remote join 只沿 `next` 因果 parent traversal；`refs` 是 skip-list 查詢捷徑，不決定完整性，故不跟隨，但仍驗 canonical CID、禁止 self/duplicate，且上限 `next=64`、`refs=128`。checkpoint boundary 每次使用前 canonicalize，遇到 boundary 即停止往前抓取。
- remote join 先完成 canonical Admission proof、shape、access-controller、Orbit identity signature、CID/encode 與 traversal 驗證，再 staged commit entry/index/heads；本機只接受 `commitPrepared(finalEntryBytes, cid)`，同樣在 transaction view 完成後才 commit 三層，禁止 direct `Log.append`／`db.add` 旁路。任一步驟失敗回滾，回滾本身失敗即寫 durable poison、當前與重啟 runtime 都 fail-closed。checkpoint 後本機 prepare 固定 `referencesCount=0`，不依賴負數的未文件化 core 行為，也不穿越 boundary 產生 refs。
- **〔LEDGER-R-076〕** finalized checkpoint 完整驗簽後先 prepare boundary；content-addressed artifacts 與唯一宣告完成後同步 commit boundary，再寫 latest pointer。latest 失敗即同步 rollback boundary；重試以 checkpoint CID 掃 log 復用已存在宣告。新 boundary 必須是舊 boundary 在本地已驗 next 鏈上的單調後繼；驗證、prepare、announcement 或 latest 失敗皆不留下錯誤 eviction boundary。
- LRU miss 只查專屬本機 entry IDB；remote ancestor 只能向送出該 head 的 authenticated peer 走有界 entry-fetch protocol，禁止回退到 Helia/Bitswap 任意 provider。peer 離線或 frame/CID 不符即整次 join fail-closed；derived state／cold CID 等一般內容塊才可走 Bitswap/pinning。
- **〔LEDGER-R-075〕** **Checkpoint + 簽章永遠保留**（獨立 `LevelStorage`、不走 LRU），否則新玩家無法驗 derived state。
- **〔LEDGER-R-074〕** persistence admission 使用 `open4wd-ledger` custom access-controller：manifest `write:['*']` 只代表 permissionless author，不代表任意 payload。落盤前強制 Orbit identity、operation exact shape、event `64 KiB / depth 16 / 2,048 entries`、**封閉 20 種已實作 event allowlist**、逐型別 exact deep schema／CID／PeerId／ 整數 ／ 容器上限與 stateless intrinsic authorization；unknown 與未啟用 `asset-version-upgrade` 拒絕。match-result／desync／config／arbitration 等簽章容器須實際驗章，不只驗 64-byte 外形。AC reject 時 entry/index/heads 零寫入。live 時效與 state-dependent 業務共識仍由收件/fold 層負責。

### 10.1 Anti-spam 完成邊界與殘餘風險

永久 log 的零成本合法形狀 ／business no-op 洪水已由 Admission v1 收斂：每個不同 final entry 都要對完整已簽 BaseEntry 支付固定 18–22 bits 工作量，proof、canonical bytes、CID、Orbit identity 與封閉事件 schema 全過後才可 durable write。配合 raw transport 四層 admission、stream pool/timeout、staged atomic commit/poison、128 MiB/10,000 entry quota、checkpoint-only eviction、checkpoint adoption queue/negative cache，攻擊者不能靠換 PeerId、換 topic、重送同一 proof 或送畸形資料取得免費永久寫入。

**〔LEDGER-R-077〕** 這是**成本與損害上限**，不是絕對阻擋大型攻擊者：有足夠 CPU／ 裝置的攻擊者仍可為大量不同 entry 逐筆付費；本機 quota 滿載會 fail-closed，也不會神奇縮小全網歷史。因此保留 transport global budgets、儲存 quota、checkpoint、事件 intrinsic authorization 與 reducer business idempotency；不得因已有 PoW 就移除任一層。若 public 後實測顯示成本不足，只能依 [流程/升版.md §8.4](../流程/升版.md) 推出新 scheme／manifest 與治理 checkpoint 遷移，不得把本機負載、牆鐘 rate limit 或 runtime 自動難度搬入同一 AC 造成 persistence 分叉。

## 11. LedgerApi

```typescript
interface LedgerApi {
  open(myPeerId: PeerId): Promise<Result<void>>; // 連線目標＝LEDGER_DB_ADDRESS（protocol.md §5；鏈身分＝資料系統 §1.1）
  appendEvent<T extends LedgerEvent>(
    event: Omit<T, "signature" | "peerId" | "timestamp">,
  ): Promise<Result<EventId>>;
  appendPreSigned(event: LedgerEvent): Promise<Result<EventId>>; // 治理等預簽定稿事件原樣上鏈（不重 stamp / 不重簽，§8）
  readEvents(sinceCheckpoint?: CID): AsyncIterable<LedgerEvent>;
  getAllEvents(): Promise<ReadonlyArray<LedgerEvent>>; // consensusNow / derive 用；entry miss 由 bounded peer fetch 補齊
  getDerivedState(): Promise<DerivedState>; // economy config 讀點＝DerivedState.economyConfig（無獨立 getter）
  getMatchRecord(matchId: string): Promise<MatchRecord | null>; // hot miss → 推 partition key → cold lazy fetch
  getMatchFromPartition(
    key: ColdPartitionKey,
    matchId: string,
  ): Promise<MatchRecord | null>;
  getRecentMatchesForPlayer(
    peerId: PeerId,
    request?: { limit?: number; cursor?: MatchHistoryCursor | null },
  ): Promise<{
    records: ReadonlyArray<MatchRecord>;
    status: "complete" | "partial" | "failure";
    nextCursor: MatchHistoryCursor | null;
    failedPartitions: ReadonlyArray<ColdPartitionKey>;
  }>; // hot＋quarter-desc bounded cold lazy fetch；排序／去重／游標規則見資料系統 §10.1
  deriveStateAt(logHeadCids: ReadonlyArray<CID>): Promise<DerivedState | null>; // 完整 frontier 純函數（見 資料系統 §15.1）
  proposeCheckpoint(): Promise<Result<LedgerCheckpointProposal>>;
  signCheckpoint(p: LedgerCheckpointProposal): Promise<Result<Signature>>;
  finalizeCheckpoint(
    p: LedgerCheckpointProposal,
    sigs: Signature[],
  ): Promise<Result<CID>>;
  getLatestCheckpoint(): Promise<Result<CID>>;
  getCheckpointHistory(limit: number): Promise<LedgerCheckpoint[]>;
  syncFromCheckpoint(): Promise<Result<void>>;
  syncEventsSince(cids: ReadonlyArray<CID>): Promise<Result<number>>; // 完整 multi-head frontier
  getLatestLogHeads(): Promise<ReadonlyArray<CID>>; // 診斷／同步用完整 frontier；空帳本回 []
  onEvent(handler: (e: LedgerEvent) => void): Unsubscribe;
}
```

**〔LEDGER-R-078〕** `getDerivedState`、`getMatchRecord`、`getMatchFromPartition`、`getRecentMatchesForPlayer` 共用同一 business-read readiness gate：呼叫前與 state queue drain 後都檢查。startup checkpoint reconciliation 未達 stable watermark 時以 `checkpoint startup reconciliation 尚未完成` 拒絕；durable sibling conflict 時以 `checkpoint sibling conflict：帳本已隔離` 拒絕；ingest recovery 尚未完成時原樣拋出其 ingest error。不得在這三種狀態下回傳 stale／fallback business view；gate 清除後恢復正常讀取。`readEvents`／`getAllEvents`／head 與 sync/checkpoint 診斷面不屬 business view，仍可用於同步與修復。

`deriveStateAt` **純函數**（不改本機 cache）：找不晚於目標 frontier 的最近帳本檢查點 → 載其 derived_state → replay 完整 DAG 到目標 `logHeadCids`（本機未同步則等 OrbitDB + IPFS 拉，總超時 10 秒，超時回 null）→ 產生新 DerivedState object。它供 checkpoint review、復原稽核與診斷使用；B 軸房間閘直接讀已驗 pinned checkpoint，match settlement 禁止事件指定 frontier。
