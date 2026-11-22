---
id: D-20260719-01
date: 2026-07-19
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-07-19 Ledger Admission v1"]
files: ["程式架構/ledger.md", "資料系統.md"]
vectors: ["ledger/admission-v1"]
deprecates: []
---

# D-20260719-01｜Ledger Admission v1（固定參數 PoW 寫入門檻）

## 背景與驅動力

帳本開放寫入：收件與 fold 守門擋的是「錯的事件」，擋不了「合法形垃圾」的量——永久 entry 由全網長期儲存，寫入成本與儲存成本不對稱。需要去中心化的抗垃圾寫入門檻，且不得引入逐筆簽核的中心化。2026-07-18 核准、07-19 落地。

## 考慮過的選項

- 治理簽章發布 difficulty epoch（finalized checkpoint 後生效、entry 標示 admission epoch）：治理者無法即時逐事件操作、易造成遷移與治理中心化——否決。
- 「同一維護者持三組 signer」湊三人門檻：形式上的假去中心化——否決。
- access-controller 內固定常數的 PoW（採納）。

## 決定

- **Admission v1（PoW）對封閉目錄內 18 種永久 ledger event 全面生效、無豁免**（checkpoint、治理、比賽、仲裁、economy 皆含）；本機編輯、匯出、離線測試、聊天與即時 P2P 不使用 PoW。
- proof 位於 Orbit entry 頂層：先完成事件簽章與一次 Orbit BaseEntry 簽章，再對含 `key`／`identity`／`sig`／parents／clock 的 canonical DAG-CBOR bytes 做 SHA-256 work；local／remote／rebuild／join／outbox ingress 共用 raw-byte canonical validator，拒未知欄位、非 canonical encoding、CID grinding 與 durable-write 旁路。
- 固定協議參數：version 1、base **18 bits**、每 4 KiB 加權至最高 **22 bits**、**8-byte nonce**、30 秒本機 work timeout、intent queue 8、outbox 32 entry／2 MiB；常數固定於 access-controller、不設動態 difficulty epoch。
- 治理 signer 現實化：真實維護者 **N=1／quorum=1 合法、N=2 非法**，至少三位獨立治理者才切 `floor(2N/3)+1`（[D-20260524-01](D-20260524-01-SignerSet治理quorum.md) 之形）。

## 後果與影響

PoW 只提高永久儲存成本，不取代事件 authorization、固定費用、多簽、仲裁或配對規則——日常事件仍 permissionless、治理者不逐筆簽核。未來改難度 ＝ 新 scheme／manifest＋ 公開 vectors＋ 治理簽章 ＋ 明確 checkpoint 遷移；舊歷史永久可讀、未知版本 fail-closed。開發期不保留 admission-free 舊資料：`UNIFIED_DB_VERSION` 維持 1、首次完整本機測試前手動重置 IndexedDB；durable outbox、parent protection 與可取消 Worker miner 保證重送冪等與 teardown。
