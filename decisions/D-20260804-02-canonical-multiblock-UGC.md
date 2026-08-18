---
id: D-20260804-02
date: 2026-08-04
status: accepted
supersedes: ["D-20260803-02", "D-20260803-05"]
superseded_by: null
amends: ["D-20260804-01"]
domains: ["UGC版權", "版本部署", "資安"]
sources: ["2026-08-04 ─ Canonical multi-block UnixFS UGC"]
files: ["資料系統.md", "UGC機制.md", "程式架構/interfaces.md", "程式架構/pinning-service.md", "程式架構/pwa-offline.md"]
vectors: []
deprecates: []
---

# D-20260804-02｜Canonical multi-block UnixFS UGC 與多來源取得

## 背景與驅動力

80 MiB GLB 不應以單一 80 MiB raw block 傳遞；這會失去 IPFS 的分片、跨來源合併、partial resume
與共享 block 去重能力。專案尚未發布，沒有正式 UGC 或舊 client 相容義務，適合直接建立唯一
canonical profile，而不是保留過渡版本。

## 考慮過的選項

- 維持單一 raw block：實作簡單，但無法分片、跨來源合併、partial resume 或 block 去重，否決。
- 另建 v2/v3 或雙讀過渡格式：專案尚未發布，會製造沒有使用者價值的相容負擔，否決。
- 固定一套 canonical UnixFS profile，並讓 client 與 provider 共用 root-scoped block 契約（採納）。

## 決定

UGC 身分是 canonical UnixFS root：CIDv1、sha2-256、1 MiB fixed chunks、balanced layout、raw
leaves、無 name/mode/mtime。≤ 1 MiB 可由 raw root 表示，較大檔案使用 dag-pb root；logical 上限
80 MiB、完整 blocks 上限 81。接收者逐 block 驗 CID，完整重組後以同 profile 重匯，root 與
reachable block set 不一致即拒絕。

取得層以 `rootCid + blockCid` 為最小請求，對房內/Bitswap 與玩家所選 provider 做有界
first-valid-wins。privacy-first 延遲 hedge，speed-first 可立即 hedge；任何來源都不能以自報
fingerprint 或 transport 2xx 取代 CID、完整 GLB 與 sanitizer 驗證。

CAR v1 保存一個 root 與完整 reachable block set，允許 frame 任意排序，拒絕重複、缺漏、額外
不可達 block 或非 canonical DAG。本地 retention 分開記 logical GLB 與 physical DAG bytes。
Provider root-scoped API 可供 raw/dag-pb blocks；provider descriptor 必須誠實聲明 profile、limits、
CORS 與 CAR 支援狀態。

## 後果與影響

不同玩家或 provider 各持部分 blocks 時仍可合併完成下載，已驗 partial blocks 可安全保留作續傳，
但完整 root 驗證前不可 render、建立 trusted fingerprint 或宣稱資產可用。舊的一 root/一 raw
block 描述直接失效；不提供 v2/v3、alias、雙讀或 migration。
