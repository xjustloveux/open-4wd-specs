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
// 多簽事件（match-result／config-update／race-consensus-anchor／desync／ledger-checkpoint-certificate）BaseEvent.peerId＝發布者、
//    非密碼學綁定身分（fold 不驗其單簽）：共通 fold **不以其驅動 registeredAt／lastEventAt 歸屬**——否則冒名
//    peerId 重新發布的他人多簽事件會被誤記為該 peer 的活動（影響 UGC 退役）或註冊時點。finisher 場數改由
//    reputation reducer 以已驗 ranking 記、註冊時點由本人單簽事件定；多簽事件僅推進 clock／套用計數。
```

> **〔LEDGER-R-054〕** **不變式**：所有 time-based derive 規則（退役判定、24h 覆蓋防抖、cold 切分、pendingReports expire）**必須用 `consensusNow`，不得用 `Date.now()`**。此為跨 peer 共識安全的硬規則。

**檢查點協定的本機時鐘**：檢查點多簽協定是治理者的操作流程，不是 derive，下列四處讀本機時鐘並影響協定判定：提案者以本機時鐘**先定**本體 `timestamp`（狀態再以此 timestamp 為 fold 時鐘成形，不讀牆鐘）；提案者與 `getCheckpointRound` 以本機時鐘判斷目前輪次與指定提案者；覆核只接受 timestamp 不晚於本機時鐘加 30 秒的本體；人工釋放鎖定以本機時鐘判斷卡死是否已滿 24 小時。另有只作紀錄、不影響任何判定的讀取：本機鎖定紀錄的 `lockedAt`（投票、人工釋放補寫鎖定，以及啟動對齊時找不到該票事件 timestamp 的補寫）。待定稿索引的收錄、卡死判定與卡死起點只由帳本條目推出，不讀牆鐘（[ledger-checkpoint.md §3](ledger-checkpoint.md)〔LEDGER-R-099〕〔LEDGER-R-104〕）。

### 6.1 fold 守門（foldGuard）—— 歷史 append 繞過收件驗證的最後防線

**〔LEDGER-R-057〕** log 的 access controller 為 `write:['*']`；live 收件的 ±30 秒時間窗只在首播時檢查、歷史同步不重驗，不構成共識邊界。凡「錯誤事件被 fold 套用即造成不可逆傷害」的驗證，必須是 timeless 且只依賴事件自身或 canonical state。match-result 因此讓 live admission 與 fold 共用同一自包含 facts validator；經濟公式則只在 fold 依事件位置前態計算，事件不能選擇 base 或 payout。

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
| **〔LEDGER-R-066〕** `blacklist-cid`（anti-piracy）                          | 須存在一筆 `result === 'pass'` 且 `target === cid` 的仲裁結果，否則整筆 no-op（其信任根＝上列 arbitration-result 恆驗）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **〔LEDGER-R-067〕** `report`（moderation）                                  | `targetKind ∈ {cid, peer}`；同一檢舉者對同一對象已有案錄時，`timestamp` 必須晚於該案錄的檢舉時戳，否則整筆 no-op（[moderation.md §4](moderation.md)）；其餘資格門檻見 [moderation.md §5.6](moderation.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

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

**`reason:'retire'` 守門**：收件 / apply 驗 `payer === 該 CID 血緣節點創作者`（[資料系統.md §4.1](../資料系統.md)），不符 ＝ 事件無效 no-op（同燒幣守門模式，[economy.md §2](economy.md)），退役只能由創作者本人發起。`renew` / `unretire` 維持任何人可付。

**〔LEDGER-R-070〕** apply 時：扣 payer `burnAmount`（**費率收口**：必須 ＝`state.economyConfig.ugc_lifecycle.maintenance_burn_minor`、不符 no-op，[§6.1](#61-fold-守門foldguard-歷史-append-繞過收件驗證的最後防線)）、清 `maintenanceCandidateSince`、`retired=false`（若 unretire）、`lastMaintenanceAt = event.timestamp`（renew／unretire 記 grace 屏障；retire 不動）；**`lastUsedAt` 不更新**（續租不算使用，避免付費延期但無人用造成 pinning 浪費）。續租只買一個 grace 窗、買不到永久保留。設計見 [資料系統.md §13](../資料系統.md)。

## 8. Config Update

帳本檢查點的提案、投票與定稿公告是三種帳本事件（`ledger-checkpoint-proposal`／`ledger-checkpoint-signature`／`ledger-checkpoint-certificate`，wire 見 [ledger-admission.md §1](ledger-admission.md#1-baseevent-與簽章)、協定見 [ledger-checkpoint.md §3](ledger-checkpoint.md)）；簽章歷史因此可由帳本推出，簽署者不必同時在線。

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

**〔LEDGER-R-073〕** OrbitDB log append-only 永久累積；客戶端不必本地保留已被 finalized checkpoint 覆蓋的事件。因此本機對 log 的讀取一律以**本機保留範圍**為界：從 log 自己的 eviction boundary（不含 boundary entry）到目前 heads，尚無 boundary 時才是 genesis 到 heads。目前 heads 是檢查點切面 S 的極大元素；孤兒雖仍在本機條目儲存，但不在保留範圍內（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-045〕）。event log 埠與 `LedgerApi` 都沒有讀全部事件的專用入口，任何路徑不得假設本機有完整歷史。以空的起點呼叫區間走訪（`entriesBetween` 的起點為空集合、`entriesAfter` 不帶起點、`syncEventsSince` 傳空集合）仍等於從 genesis 走訪：尚無 checkpoint 時的重建與 `deriveStateAt` 即如此讀取；已有 checkpoint 後，走訪經過已被淘汰的 entry 就會拋錯，呼叫端不得依賴它成功。保留範圍的起點取 log 自己的 boundary，不讀 CheckpointStore 的 effective 指標。兩者只在衝突隔離後不同：sibling 衝突隔離把 effective 退回共同 previous 時，log 的 boundary 不隨之後退，已淘汰的 entry 也不會因此回到本機；重啟時 log 的 boundary 以最後一個已採納的 checkpoint（control 的 `latest`）的 `log_head_cids` 重建（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-040〕、〔LEDGER-R-043〕），沒有衝突隔離時它就是 effective checkpoint，隔離後它不隨 effective 後退。runtime 使用 wire-compatible 的 bounded Events/Sync adapter，entry fallback 是**專屬本機** IDB blockstore，不是 Helia/Bitswap broker；不得直接換回 stock Sync（stock 路徑會在 raw size admission 前 decode remote entry）：

```typescript
const LRU_ENTRY_LIMIT = 10000; // protocol-adjacent 固定本機硬上限；不得依裝置動態改共識可得性。切面另有業務上限 LEDGER_CUT_BUSINESS_ENTRY_LIMIT（9,000）
const LRU_HEADS_LIMIT = 64;
// entryStorage = TraversalBudgetStorage(ComposedStorage(LRUStorage, boundedLocalEntryStorage))
```

- 單 entry block `256 KiB`；本機 ledger blockstore `128 MiB / 10,000 blocks`；單次 remote traversal `64 MiB / 2,048 entries`。串流 block 在累計超限當下中止，不先全量配置。開庫時由 `getAll()` 列舉既有 block 重建 byte/count accounting；列舉讀取失敗、單塊超過上限或記帳後超過 byte/count 上限時自動重試一次列舉，仍中斷即開庫失敗，拋出固定 `code` 為 `entry-store-bootstrap-interrupted`、附中斷原因（`read-failed`／`block-too-large`／`entry-limit`／`byte-limit`）的錯誤供上層辨識，不以記帳不完整的狀態開庫。列舉回來的 CID 無法解析屬資料損毀，不重試，立即以同一 `code`、原因 `invalid-key` 開庫失敗，原始錯誤保留在 `cause`。每次列舉前清空記帳，前一次列舉多出的 block 不留作淘汰候選。
- quota eviction **只可**淘汰已被目前 checkpoint 覆蓋且非 boundary 的 block；沒有安全 victim 就拒絕新寫入。explicit delete 同步更新 byte/count accounting。entry block 只經寫入進入專屬 store；讀取時底層讀取失敗、未命中或 quota 檢查失敗都只拋錯，不刪除被讀取的 block；淘汰仍只依上述 quota eviction 規則（只淘汰已被涵蓋者）。
- Orbit identity：`openOrbitEventLog` 的選填 `orbitId`（非空字串，空字串在建立任何資源前拒絕）原樣傳給 `createOrbitDB` 的 `id`，同一 keystore 加同一 id 得到同一 identity；不傳時 OrbitDB 每次開庫隨機產生。`createLedgerStack` 在已知最終 chainId 的正式開庫前，從該鏈的 checkpoint control storage 讀取鍵 `__ledger_orbit_id_v1__:<chainId>` 作為 `orbitId`：值為小寫 UUID 的 UTF-8 bytes（36 bytes、無換行）；缺值時以 `crypto.randomUUID()` 產生並以 compare-and-swap 首寫，首寫失敗代表他人已寫入，改讀回並沿用贏家的值；既有值不是嚴格 UTF-8 或不符小寫 UUID 格式時以 `ledger-orbit-id-corrupt` 開庫失敗，不覆寫。因此每個裝置、每條鏈固定一個 Orbit 寫入者身分，准入 outbox 的待送出紀錄與寫入者 identity 在重啟後一致；id 只是本機 keystore 的標籤，不從玩家或治理金鑰推導。動態 genesis 的暫時開庫（尚未分鏈）不帶 `orbitId`、不讀寫 control storage，每次以空位址啟動會多一個不寫任何條目的隨機 identity。瀏覽器與治理簽署工具走同一段程式，簽署工具的 node 埠只轉交（[governance-signer.md](governance-signer.md) 第 6 節）。連線流程由 `src/bootstrap/ledger-stack.ts` 的 `createLedgerStack` 提供，瀏覽器 `createBrowserLedgerStack` 是帶瀏覽器預設 factory 的薄包裝，工具注入 node 版 factory。
- Admission outbox 的 row、查詢、quota、更新與刪除一律以完整 `chainId` scope；共用同一
  IndexedDB 時，row key 形如 `<chainId>:<entryCid>`，list 不得回傳其他 chain 的 prepared
  entry。CID-keyed entry/content blockstore 仍以 CID 去重，不為相同 bytes 建立鏈別副本。
- remote head 在 `Entry.decode` 前先過 `256 KiB/head`、每 authenticated libp2p peer `1 MiB + 256 messages / 60s`，最多追蹤 4,096 peer state；另有全來源 `16 MiB + 4,096 messages / 60s` 與等待 queue `4 MiB / 64 messages` 硬上限，source LRU churn 不會重置 global budget。dial/receive 失敗必須 abort/close stream 並釋放 peer state，允許後續重連。
- remote join 只沿 `next` 因果 parent traversal；`refs` 是 skip-list 查詢捷徑，不決定完整性，故不跟隨，但仍驗 canonical CID、禁止 self/duplicate，且上限 `next=64`、`refs=128`。checkpoint boundary 每次使用前 canonicalize，遇到 boundary 即停止往前抓取。
- remote join 先完成 canonical Admission proof、shape、access-controller、Orbit identity signature、CID/encode 與 traversal 驗證，再 staged commit entry/index/heads；本機只接受 `commitPrepared(finalEntryBytes, cid)`，同樣在 transaction view 完成後才 commit 三層，禁止 direct `Log.append`／`db.add` 旁路。任一步驟失敗回滾，回滾本身失敗即寫 durable poison、當前與重啟 runtime 都 fail-closed。本機 prepare 以檢查點切面 S 的極大元素為 `next`、時鐘為其最大值加 1，`refs` 固定為空陣列，不分有無 checkpoint boundary；遠端 join 與本機提交都依 [ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-045〕、〔LEDGER-R-107〕 判定條目有效性，heads 交換只送出 S 的極大元素。本機提交被切面拒絕時由寫入器以同一事件重新建立條目（[ledger-admission.md](ledger-admission.md) 〔LEDGER-R-109〕）。切面容量判定（業務上限、硬上限與保留批次，[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-045〕、〔LEDGER-R-110〕）排在上述驗證與切面判定之後；遠端 join 以容量為第一個不通過的檢查時整批不落盤，其中的定稿公告交給採納流程（〔LEDGER-R-046〕）。
- **〔LEDGER-R-076〕** finalized checkpoint 完整驗簽後，定稿與採納都先 prepare boundary（唯讀驗證：新 boundary 必須是舊 boundary 在本地已驗 next 鏈上的單調後繼），失敗時不留下任何持久變更。通過後依序：content-addressed artifacts、本體與憑證存檔 → 邊界推進紀錄（定稿另在同一次 control CAS 把本體加入公告待送出清單）→ latest pointer → commit boundary → 完成推進紀錄 →（定稿）寫宣告 → 重建；順序與 [ledger-checkpoint.md](ledger-checkpoint.md) 的 `finalizeCheckpoint` 條及 〔LEDGER-R-041〕 相同。latest 寫入之前不 commit boundary；commit 之後完成推進紀錄失敗時同步 rollback boundary，推進紀錄留著，之後補做：待送出清單非空時，宣告送出的每一輪在送出前補做（推進紀錄所指的本體已是 latest 而紀錄尚未完成，定稿或採納留下的都算）；另外，定稿端再次定稿時、採納端由同一則宣告再次處理時也補做。清單為空時送出的那一輪不補做：採納端由同一則宣告再次處理或背景重掃收斂，限制是那則宣告未落盤時要等對方再送或重啟。宣告在 boundary 推進之後才寫，寫入失敗不改變定稿結果，本體留在待送出清單由帳本依退避重送。送出前在本機保留範圍（boundary 到目前 heads）找同一 checkpoint CID、且憑證有效的既有宣告（判定見 [ledger-checkpoint.md](ledger-checkpoint.md)「定稿公告的寫入與重送」），有就只清除待送出紀錄，不讀更早的 entry。既有宣告的驗證結果以 entry 為單位記住、記住期間同一 entry 不重驗，每一輪新驗的量有上限（以宣告所帶的簽章份數計），還沒驗到的不算有效、該輪照常寫出宣告；宣告寫入成功而清除紀錄失敗時，在紀錄清除之前，同一執行期之後各輪只重試清除、不再寫出同一 checkpoint 的宣告（上限、清除時機與限制見同一段）。保留範圍因目前 heads 含有不經過 boundary 的分支而以連續性錯誤拒絕時，這一段無法界定，視為沒有既有宣告並照常寫出宣告；既有宣告若存在就會多出一則，重複的宣告在採納時冪等。這項處理只適用連續性錯誤：讀取因其他原因失敗時（例如走訪經過的 entry 不可得）不視為沒有宣告，該輪送出記為失敗、宣告留在待送出清單，定稿結果不變。驗證、prepare 或 latest 失敗皆不留下錯誤 eviction boundary；宣告失敗時 boundary 已正確推進。
- LRU miss 只查專屬本機 entry IDB；remote ancestor 只能向送出該 head 的 authenticated peer 走有界 entry-fetch protocol，禁止回退到 Helia/Bitswap 任意 provider。peer 離線或 frame/CID 不符即整次 join fail-closed；derived state／cold CID 等一般內容塊才可走 Bitswap/pinning。
- **〔LEDGER-R-075〕** **Checkpoint + 簽章永遠保留**（獨立 `LevelStorage`、不走 LRU），否則新玩家無法驗 derived state。
- **〔LEDGER-R-074〕** persistence admission 使用 `open4wd-ledger` custom access-controller：manifest `write:['*']` 只代表 permissionless author，不代表任意 payload。落盤前強制 Orbit identity、operation exact shape、event `64 KiB / depth 16 / 2,048 entries`、**封閉 23 種已實作 event allowlist**、逐型別 exact deep schema／CID／PeerId／ 整數 ／ 容器上限與 stateless intrinsic authorization；unknown 與未啟用 `asset-version-upgrade` 拒絕。match-result／desync／config／arbitration 等簽章容器須實際驗章，不只驗 64-byte 外形。AC reject 時 entry/index/heads 零寫入。live 時效與 state-dependent 業務共識仍由收件/fold 層負責。

### 10.1 Anti-spam 完成邊界與殘餘風險

永久 log 的零成本合法形狀 ／business no-op 洪水已由 Admission v1 收斂：每個不同 final entry 都要對完整已簽 BaseEntry 支付固定 18–22 bits 工作量，proof、canonical bytes、CID、Orbit identity 與封閉事件 schema 全過後才可 durable write。配合 raw transport 四層 admission、stream pool/timeout、staged atomic commit/poison、128 MiB/10,000 entry quota、checkpoint-only eviction、checkpoint adoption queue/negative cache，攻擊者不能靠換 PeerId、換 topic、重送同一 proof 或送畸形資料取得免費永久寫入。

**〔LEDGER-R-077〕** 這是**成本與損害上限**，不是絕對阻擋大型攻擊者：有足夠 CPU／ 裝置的攻擊者仍可為大量不同 entry 逐筆付費；本機 quota 滿載會 fail-closed，也不會神奇縮小全網歷史。檢查點切面的本機上限分為業務上限與硬上限：超過業務上限後業務 entry 被拒，檢查點提案與投票在兩者之間仍可寫入（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-110〕），定稿公告被拒時改由採納流程處理（〔LEDGER-R-046〕）；硬上限也滿時 fail-closed 的範圍包含檢查點控制事件（issue 001563），三位以上簽署者時保留額度的涵蓋範圍另有限制（issue 001566）。因此保留 transport global budgets、儲存 quota、checkpoint、事件 intrinsic authorization 與 reducer business idempotency；不得因已有 PoW 就移除任一層。若 public 後實測顯示成本不足，只能依 [流程/升版.md §8.4](../流程/升版.md) 推出新 scheme／manifest 與治理 checkpoint 遷移，不得把本機負載、牆鐘 rate limit 或 runtime 自動難度搬入同一 AC 造成 persistence 分叉。

## 11. LedgerApi

```typescript
interface LedgerApi {
  open(myPeerId: PeerId): Promise<Result<void>>; // 連線目標＝LEDGER_DB_ADDRESS（protocol.md §5；鏈身分＝資料系統 §1.1）
  appendEvent<T extends LedgerEvent>(
    event: Omit<T, "signature" | "peerId" | "timestamp">,
  ): Promise<Result<EventId>>;
  appendPreSigned(event: LedgerEvent): Promise<Result<EventId>>; // 治理等預簽定稿事件原樣上鏈（不重 stamp / 不重簽，§8）
  readEvents(sinceCheckpoint: CID): AsyncIterable<LedgerEvent>; // 該 checkpoint 之後到目前 heads；checkpoint 不在本機即拋錯，沒有全史讀取（§10）
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
  deriveStateAt(logHeadCids: ReadonlyArray<CID>): Promise<DerivedState | null>; // 完整 frontier 純函數（見 資料系統 §15.1）；支援的目標見本節下方
  proposeCheckpoint(): Promise<Result<CheckpointProposeOutcome>>; // 先回表內通過覆核的本體（existing）；無本體通過時須為指定提案者（ledger-checkpoint.md §3）
  signCheckpoint(checkpointCid: CID): Promise<Result<CheckpointSignOutcome>>; // 覆核後寫入投票事件
  finalizeCheckpoint(checkpointCid: CID): Promise<Result<CID>>; // 以索引中的票組憑證定稿；回傳本體 CID
  getPendingCheckpoints(): Promise<Result<PendingCheckpointView>>;
  getCheckpointRound(): Promise<Result<CheckpointRoundInfo>>;
  releaseCheckpointVoteLock(request: CheckpointVoteLockReleaseInput): Promise<Result<void>>; // 卡死滿 24 小時後的人工釋放
  getLatestCheckpoint(): Promise<Result<CID>>;
  getCheckpointHistory(limit: number): Promise<LedgerCheckpoint[]>;
  syncFromCheckpoint(): Promise<Result<void>>;
  syncEventsSince(cids: ReadonlyArray<CID>): Promise<Result<number>>; // 完整 multi-head frontier
  getLatestLogHeads(): Promise<ReadonlyArray<CID>>; // 診斷／同步用完整 frontier；空帳本回 []
  onEvent(handler: (e: LedgerEvent) => void): Unsubscribe; // 同一事件以事件鍵去重，但仍可能重複、跨次送出不保證順序；訂閱者須冪等（ledger-checkpoint.md 〔LEDGER-R-049〕）
  getRecoveryStatus(): LedgerRecoveryStatus; // 自動復原狀態與定稿公告待送出的情形，供介面顯示（ledger-checkpoint.md §4.1）
}
interface LedgerRecoveryStatus {
  phase: "idle" | "ingest-recovery" | "checkpoint-scan-retry";
  attempts: number; // 該階段已失敗並排定下一次重試的重建（啟動掃描為掃描）次數；第一次立即 recovery 的失敗也計入
  lastError: string | null; // 錯誤名稱與訊息的截短摘要，不含事件內容
  pendingAnnouncement?: LedgerPendingAnnouncementStatus; // 有定稿公告待送出時才存在；與 phase 互不遮蓋
}
interface LedgerPendingAnnouncementStatus {
  count: number; // 待送出筆數（上限 24）
  oldestCheckpointCid: CID; // 最舊一筆＝目前要送或卡住的那一筆
  attempts: number; // 連續失敗的送出輪數；任何一輪把清單送完即歸零
  lastErrorCode: "cut-full" | "announcement-backlog-full" | "certificate-unavailable" | "send-failed" | null;
  lastError: string | null; // 錯誤名稱與訊息的截短摘要
}
```

`pendingAnnouncement` 的資料來源是記憶體中的清單快照（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-040〕）。`lastErrorCode` 是最近一次的錯誤：`cut-full` 為公告因切面容量被拒，`announcement-backlog-full` 為清單已滿而新的定稿被拒，`certificate-unavailable` 為該本體的憑證在本機取不到，`send-failed` 為其他寫入或儲存失敗；清單已滿時前兩者可能交替出現，是否已滿以 `count` 判斷。清單非空而尚無任何一輪失敗時為 null；衝突隔離期間清單保留、欄位照常存在，沒有專屬代碼。

檢查點協定方法的型別與錯誤碼見 [interfaces.md §5](interfaces.md#5-ledger)；協定層的拒絕以帶 `code` 的 `CheckpointProtocolError` 回報；儲存與 log 的失敗原樣回傳，其中公告待送出清單已滿時是 `CheckpointAnnouncementBacklogError`（`code` 為 `announcement-backlog-full`）。規則見 [ledger-checkpoint.md §3](ledger-checkpoint.md)。`getCheckpointCertificate(cid)`（本機保存的憑證）與 `onCheckpointVotingChange(handler)`（待定稿索引改變通知）只在具體類 `Open4wdLedger` 上提供。

**〔LEDGER-R-078〕** `getDerivedState`、`getMatchRecord`、`getMatchFromPartition`、`getRecentMatchesForPlayer` 共用同一 business-read readiness gate：呼叫前與 state queue drain 後都檢查。startup checkpoint reconciliation 未達 stable watermark 時以 `checkpoint startup reconciliation 尚未完成` 拒絕；durable sibling conflict 時以 `checkpoint sibling conflict：帳本已隔離` 拒絕；ingest recovery 尚未完成時原樣拋出其 ingest error。不得在這三種狀態下回傳 stale／fallback business view；gate 清除後恢復正常讀取。`open` 回成功不代表 business view 已可讀：啟動掃描超過前景等待上限時 reconciliation 仍在進行；最新 checkpoint 的狀態塊取不到時 runtime 處於 ingest recovery（[ledger-checkpoint.md](ledger-checkpoint.md) 〔LEDGER-R-048〕，此時拋出的 ingest error 帶 code `checkpoint-state-unavailable`）。呼叫端須以 `getRecoveryStatus` 或讀取結果判斷，不得以 `open` 的結果代替。具體類 `Open4wdLedger` 另提供 `onBusinessReady(handler)`：startup reconciliation 達成 stable 時、以及 ingest failure 由成功的重建解除時通知（當下仍被其他條件擋下時不通知，可能重複，訂閱者拋錯不影響帳本）；開庫就在 recovery 的 runtime 恢復時既有 entry 併入 notified baseline、沒有 `onEvent`，持有狀態快照的呼叫端以此重讀。定稿公告待送出與採納的背景重掃不屬 business readiness gate，不影響業務讀寫；前者由 `getRecoveryStatus` 的 `pendingAnnouncement` 回報，後者不反映在 `getRecoveryStatus`。`readEvents`、head、`getRecoveryStatus` 與 sync/checkpoint 診斷面不屬 business view，仍可用於同步與修復；其中沒有讀全部事件的入口（§10）。`readEvents` 讀指定 checkpoint 的 `log_head_cids` 到目前 heads：這組 heads 就是 log 的 boundary 時（一般是最新已採納的 checkpoint），讀到的是本機保留範圍；指定較舊的 checkpoint 時，這一段含 boundary 之前的 entry，本機仍留著就一併回傳，已被淘汰則拋錯、不回傳部分結果。

`deriveStateAt` **純函數**（不改本機 cache、每次產生新 DerivedState object），依目標 `logHeadCids` 分三種情形：

- **目標恰為某個帳本檢查點**：目標的 head 集合與本機檢查點鏈上某個檢查點的 `log_head_cids` 完全相同（不限最新的；比對與順序無關）→ 取**該檢查點自己的** derived_state 塊，驗 CID 與 canonical bytes 後解碼回傳，不 replay 任何 entry。鏈上有多個檢查點的 `log_head_cids` 與目標相同時（相鄰檢查點之間沒有新條目），取其中最新的一個。該塊本機沒有時由內容儲存向網路取，取不到回 null。
- **目標在最新檢查點之後**：載最新檢查點的 derived_state → replay 其 `log_head_cids` 到目標之間的完整 DAG。尚無任何檢查點時，才從 genesis replay 到目標。
- **其餘目標不支援**：已有檢查點，而目標既不是某個檢查點、也不在最新檢查點之後（例如落在兩個較舊檢查點之間）→ 回 null，不退回 genesis replay。那一段的 entry 依 〔LEDGER-R-073〕 可被本機淘汰，求值結果不得取決於它們是否剛好還在本機。

本機未同步則等 OrbitDB + IPFS 拉；`DERIVE_STATE_TIMEOUT_MS`（10 秒）是整次呼叫的總時限，涵蓋取塊、取條目與折疊，逾時回 null。檢查點的提案與覆核不經 `deriveStateAt`，以本體 timestamp 為 fold 時鐘做候選折疊，不受此時限。需要較早時點狀態的功能一律以該時點的檢查點為目標（仲裁取抽籤檢查點的快照即是，[moderation.md §5](moderation.md)）。目前正式程式的呼叫端只有仲裁協調器（取抽籤檢查點的快照）；比賽執行期的 ledger 埠也由組裝層接上 `deriveStateAt`，但比賽流程沒有呼叫點。B 軸房間閘直接讀已驗 pinned checkpoint，match settlement 禁止事件指定 frontier。
