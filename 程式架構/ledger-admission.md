---
type: impl
domain: ["共識帳本"]
summary: ledger 事件 wire、簽章、永久 entry admission 與 anti-spam 邊界
authority: null
slug: null
---

# ledger admission

> 本檔是 ledger 事件 wire、簽章與永久 entry admission 的實作 authority；總入口見 [ledger.md](ledger.md)。

> **本檔角色**：ledger 的**實作層**細節 —— 事件結構、canonical 序列化、DerivedState 巢狀結構、partition 切分、帳本檢查點演算法、sync / fork resolution、derive utilities、LedgerApi。
> 設計與規則見 [資料系統.md](../資料系統.md)（事件清單 [§3](../資料系統.md#3-事件清單ledgerevent-union) 為權威命名、序列化原則 [§5](../資料系統.md#5-canonical-序列化)、partition [§9](../資料系統.md#9-partition-切分deterministic)、退役 [§13](../資料系統.md#13-ugc-退役)、API 介面 [§15](../資料系統.md#15-apiledgerapi)、不變式 [§18](../資料系統.md#18-不變式ci-強制)）；常數見 [protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽)。對應 `src/ledger/`。
> **注意**：本檔「Checkpoint / 檢查點」一律指**帳本檢查點**（≠ [資料系統.md §6](../資料系統.md) 的回合共識錨）。
> **事件命名以 [資料系統.md §3](../資料系統.md) 為準**；本檔只列 ledger 與跨模組入口必須共用的 current wire 結構，不另複製完整事件 union。

**〔LEDGER-R-022〕** **部署身分**：`open4wd-ledger` 是只供明確 genesis 建立時使用的 database name，`LEDGER_DB_ADDRESS` 必須是該次建立後輸出的 exact OrbitDB address：`/orbitdb/<CIDv1-base58btc>`，不得附加 database name 或其他 path segment。private/public client 缺 address 必須 fail closed，不得以名稱自動建另一座 island；open 後還會逐項核對 address、name、database type 與 access-controller contract。實際填值與初期 1 signer 見 [../部署資訊/部署實際值與初始拓撲.md](../部署資訊/部署實際值與初始拓撲.md)；bootstrap 清單硬下限為 0，玩家選取 3 個獨立故障域只屬可用性建議，不是 ledger trust root 或 release gate。

**〔LEDGER-R-090〕** **一次性 genesis 邊界**：正式 `open4wd-ledger` 只能由 pinning repo 的獨立 one-shot operator 在專用持久 identity／空資料目錄中建立；正常 service 仍須提供 exact `LEDGER_DB_ADDRESS`，不可共用 command、flag 或缺值 fallback。Operator 在任何 storage mutation 前驗證 listen、identity、release commit 與治理 signer（N=1 或 N>=3），成功核對 address／name／type／access contract 後才原子寫入不含 secret 的 receipt。Genesis provider 保持可達，直到不同 identity 的空資料 replica 以 receipt address 開啟並完成同一 contract 核對。啟動順序與復原規則見 [D-20260728-05](../decisions/D-20260728-05-Ledger-Genesis-Bring-up.md)。

## 1. BaseEvent 與簽章

```typescript
interface BaseEvent {
  type: string;
  timestamp: Timestamp;
  peerId: PeerId; // 簽署者（= 資料系統 §3 的 peerId）
  signature: Ed25519Signature; // 對 ledgerSigningDigest(ledgerAddress, event) 簽章
  parentEventCid?: CID; // 因果關係（可選）
}
```

### 1.0 事件目錄與 ledger 自有結構

現行封閉設計目錄共 21 型別；其中 `asset-version-upgrade` 是未啟用保留案，故
`LEDGER_EVENT_TYPES` persistence allowlist 實際接受 20 種。跨域事件的欄位權威仍由其責任模組
維護；下列列出 ledger／UGC／消耗入口必須共用的完整 current wire，避免流程文件各自抄一份：

```typescript
interface LedgerCheckpointEvent extends BaseEvent {
  type: "ledger-checkpoint";
  checkpointCid: CID;
  signatures: Signature[];
}
interface UgcUploadEvent extends BaseEvent {
  type: "ugc-upload";
  cid: CID;
  metadata: UGCMetadata; // immutable admission metadata；不含 name / description / tags
  presentation: UgcPresentationMetadata; // 初始 revision 0
  similarityMatches: CID[];
}
interface UgcPresentationMetadata {
  name?: string;
  description?: string;
  tags?: ReadonlyArray<string>;
}
interface UgcMetadataUpdateEvent extends BaseEvent {
  type: "ugc-metadata-update";
  cid: CID; // exact CID；不沿 successor 傳播
  presentation: UgcPresentationMetadata; // full replacement，非 patch
  revision: number; // current + 1
}
interface UgcForkEvent extends BaseEvent {
  type: "ugc-fork";
  childCid: CID;
  parentCid: CID;
}
interface SlotPurchaseEvent extends BaseEvent {
  type: "slot-purchase";
  payer: PeerId;
  amount: bigint;
  newSlotIndex: number;
}
interface UgcSponsorBurnEvent extends BaseEvent {
  type: "ugc-sponsor-burn";
  payer: PeerId;
  targetCid: CID;
  amount: bigint;
}
interface AssetVersionUpgradeEvent extends BaseEvent { // 未啟用、不得 persist
  type: "asset-version-upgrade";
  oldCid: CID;
  newCid: CID;
  descriptorId: string;
  newMetadata: VersionedUGCMetadata;
}
```

`ugc-metadata-update` 是原作者另行 chain-bound 單簽的 presentation
revision，不會改寫原 `UgcUploadEvent`、內容 CID 或既有 upload 簽章。fold 只接受 exact CID 的
下一個 revision、距上次成功 presentation 至少 1 小時、作者相同且 CID 未進全域 blacklist；未知、
stale、跳號或冷卻未滿皆 no-op。live 對未知／ahead defer，其餘明確無效 reject。retired 與
similarity-pending 可更新，但不改生命週期。費率讀 `metadata_update_minor`；burn 與 revision 必須原子，
失敗更新不扣款。revision 0 與後續更新的冷卻鐘、`presentationUpdatedAt` 都使用事件套用時已單調
推進的 `state.derivedAt`；事件尚未 fold 時，live 必須以
`max(mirrorHead.derivedAt, event.timestamp)` 投影該次 effective time，不能只讀停滯的 mirror
head。事件 `timestamp` 只供簽署、稽核與 fold 的單調推進。完整文字界限與裁決見
[D-20260816-08](../decisions/D-20260816-08-UGCPresentationMetadata可變修訂.md) 與
[D-20260818-04](../decisions/D-20260818-04-UGCPresentationCanonicalClock投影.md)。

**〔LEDGER-R-023〕** **`timestamp` 收件驗證**：新事件**首次廣播**收件時，`|event.timestamp − 收件端本地時鐘| ≤ P2P_MESSAGE_TIMESTAMP_TOLERANCE_SEC`（30s，[資料系統.md §11](../資料系統.md)），超出拒收——倒填 / 未來時間戳進不了帳本（防偽造註冊年資等 time-based gate，[ledger.md §6](ledger.md#6-derive-utilities) `registeredAt`）。歷史同步（checkpoint / log sync）不重驗（鏈上既成事實）；離線暫存的事件廣播前須重 stamp + 重簽。

### `serializeForSigning`（dag-cbor canonical）

**〔LEDGER-R-024〕** 跨 peer 須產生**位元組完全一致**的序列化（否則驗簽失敗）：

```typescript
import * as dagCbor from "@ipld/dag-cbor";
function serializeForSigning(
  event: Omit<LedgerEvent, "signature" | "signatures">,
): Uint8Array {
  return dagCbor.encode(event); // 簽章前移除簽章欄位本身
}
// ledgerSigningDigest(address, event)
//   = sha256(canonicalDagCbor({
//       domain: "open4wd-ledger-signature-v1",
//       chainId: fullCidSegment(address),
//       payload: serializeForSigning(event),
//     }))
// signature = sign(privateKey, ledgerSigningDigest(ledgerAddress, event))
// verify(peerId, ledgerSigningDigest(ledgerAddress, event), signature)
```

**〔LEDGER-R-093〕** `ledgerSigningDigest` 是 ledger-only API，與通用
`signingDigest` 分檔。視覺 hash、loadout proof、room join proof 與 signaling register auth
仍使用各自既有的通用／場次 domain，不得因 ledger chain identity 而引入 CID 依賴。

### 1.1 永久 entry 的 Admission v1

**〔LEDGER-R-025〕** 封閉目錄內 21 種事件型別中，20 種永久事件一律使用同一套 entry-level Admission v1，**不由治理者逐筆核准或簽署**。事件完成原有單簽 ／ 多簽後，local prepared writer 凍結並由 Orbit identity 簽署唯一 BaseEntry（`id / payload / next / refs / clock / v / key / identity / sig`）；Web Worker 再搜尋頂層 proof：

```text
admission: { version: 1, workNonce: Uint8Array(8) }
baseDigest = SHA-256("open4wd-ledger-admission-base-entry-v1" || canonicalDagCbor(BaseEntry))
workDigest = SHA-256("open4wd-ledger-admission-work-v1" || baseDigest || workNonce)
```

難度依完整 BaseEntry bytes 固定為 `18 + min(4, ceil(log2(max(1, ceil(bytes/4096)))))` bits，即 <=4／8／16／32／>=64 KiB 分別 18／19／20／21／22 bits。Proof 綁定事件內容、parents、clock、Orbit identity 與**那一份** Orbit signature；修改任一欄或改用另一份合法簽章都不能沿用舊 proof。最終 entry（含 proof）必須是 canonical DAG-CBOR，raw bytes 重編碼逐 byte 相同且 CID 相符；完全相同 final entry 由 CID 去重。

所有 local prepared commit、pubsub／heads stream、entry-fetch ancestor、initial checkpoint boundary、重啟 metadata rebuild、checkpoint coverage restoration 與 outbox recovery 都先走同一 canonical validator，全部通過後才可 durable write。Business reducer 的冪等守門仍不可省略：攻擊者仍可為不同 clock／parents／ 簽章的每一個新 entry 分別支付 PoW；PoW 只消除同一 proof 的免費重用，不取代 `matchId`、內容 CID、event id 等業務唯一性。

**〔LEDGER-R-026〕** Admission v1 的 hash domain、shape 與難度是 protocol 常數，不是 `economy_config` 或動態 difficulty epoch。Public freeze 後若要變更，必須推出新 admission scheme 與新 access-controller manifest，公開 vectors，並由治理簽章指定 checkpoint 遷移；舊 v1 歷史仍永久可驗，未知 scheme fail-closed。

**〔LEDGER-R-097〕** `ugc-upload` 的內容 admission 與 entry PoW admission 是不同層。事件 metadata 必須精確帶 `physicsManifestVersion` 與 64 位小寫 hex `physicsManifestDigest`；首次 CID 內容可得時，每個 peer 都在有界 Worker 內忽略 embedded manifest、從解碼後幾何與作者宣告獨立重建並重跑正式規則，重建 digest 必須同時等於 embedded 與 event reference。內容暫缺為 defer；schema、規則、型別、PhysicsFingerprint 或 digest 不符為 reject。成功後的 `(CID,version,digest)` receipt 只存在本機 IndexedDB，不寫進 event、DerivedState 或 checkpoint，也不得接受遠端自報 verified flag。完整決策見 [D-20260811-02](../decisions/D-20260811-02-Canonical-PhysicsManifest與一次性Admission.md)。

理由：CBOR canonical 編碼（RFC 8949 §4.2.1，map 鍵長度+字典序）→ deterministic；IPFS / OrbitDB 同棧；CBOR Tag 2/3 原生 bigint（economy minor units 不丟精度）；JS/Rust/Python 對齊實作。

### `MatchResultEvent.signatures` vs `BaseEvent.signature`

| 欄位                                 | 內容                                                                                                                             | 規則                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `signatures: MatchResultSignature[]` | **⌊N/2⌋+1** 完賽者集體簽章（含主 peer 自簽）；N 一律＝`ranking ∪ disconnects` 去重後的 original active roster，reason 不影響分母 | 簽 `ledgerSigningDigest(ledgerAddress, event)`（event 剔 `signatures` 欄）；涵蓋 disconnects 並兼作 removal certificate |
| `BaseEvent.signature`                | 對 match-result 不適用，固定為空 bytes                                                                                            | 由 `signatures[]` 取代                                                                                                  |

**〔LEDGER-R-027〕** `matchId` 必須綁定 `ranking ∪ disconnects` 的 original active roster、`startedAt`、`matchRules` 與完整 `gridProof`；任一 proof 欄位不符即拒收。

**〔LEDGER-R-028〕** 每位 original active roster 成員都必須有有效的 `loadoutSignatures` 參與證明。

**〔LEDGER-R-029〕** 外層 `MatchResultEvent` 必須由 original active roster 的嚴格多數簽署，且 signer 只能是非 forfeit 完賽者。

**〔LEDGER-R-030〕** `roundAnchors` 必須與 rounds 等長；每個非 null inline anchor 都要驗 match／round、120-frame tail、timestamp、present roster、嚴格多數簽章及 grid binding。

**〔LEDGER-R-031〕** `MatchResultEvent` 的時間必須滿足 `startedAt <= finishedAt <= event.timestamp`。

**〔LEDGER-R-095〕** voluntary removal 不得縮小 MatchResult quorum；門檻仍以 original active roster 計算。

`appendEvent` 對 match-result 跳過 `BaseEvent.signature`。live admission 與 timeless fold 共用同一個**自包含**驗證器；驗證不 dereference CID、不查事件指定 frontier，也不接受事件指定 payout。

`RaceConsensusAnchorEvent` 的 `BaseEvent.signature` 固定空值，signed payload 含 `matchId`、`gridContextDigest`、`gridSeed`、`roundIndex`、120-frame 對齊 `frame`、`checksum`、canonical `presentPeers`、`timestamp` 與發布者 `peerId`；`signatures[]` 必須由 `presentPeers` 的嚴格多數不同 signer 組成。外層 `MatchResultEvent` 只保存一份完整 `gridProof`，anchor 保存固定大小 binding，避免 8 人 × 5 回合合法事件超過 64 KiB。

**〔LEDGER-R-032〕** **未啟用保留案：`asset-version-upgrade`**。下列六條只保留未來設計脈絡；此型別列在 21 型別事件目錄供設計追蹤，但不在現行 20 型別 admission allowlist，custom access-controller 必須拒絕，不能 persist 或 apply。若未來啟用，須先依 Admission scheme 的事件目錄 ／deep schema／ 簽章 ／reducer／ 測試與 protocol 升版流程完整落地：① 舊 CID `open4wd_version` **低於該 type 最新破壞牆**；② `event.peerId` = 舊 CID 血緣節點創作者；③ 新舊同 `type`；④ 新 CID `open4wd_version` > 舊；⑤ 舊 CID 不在仲裁黑名單；⑥ 新舊 CID mesh 幾何指紋一致（僅 extras 差異）。在正式啟用前，跨版本資產仍走一般上傳 ／fork 的既有有效流程，不得由 client 自行產生此事件。
