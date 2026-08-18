---
id: D-20260803-02
date: 2026-08-03
status: superseded
supersedes: []
superseded_by: D-20260804-02
amends: ["D-20260525-02"]
domains: ["UGC版權", "共識帳本"]
sources: ["2026-08-03 UGC GLB 改用 raw CID（issue 000163）"]
files: ["資料系統.md", "UGC機制.md"]
vectors: []
deprecates: []
---

# D-20260803-02｜UGC GLB 使用 raw CID

## 背景與驅動力

上鏈管線把最終 GLB 原始 bytes 交給 Ledger 的共用 block writer；該 writer 固定產生
dag-cbor CID，因此 CID 宣告內容可依 DAG-CBOR 解碼，實際 block 卻是 GLB。單純以 CID
取 bytes 時不一定暴露問題，但 CAR／IPLD 工具會依 multicodec 解碼或遍歷，無法可靠保存
與補回 UGC。專案尚未發布正式 UGC，現在修正不需要維持既有內容身分。

## 考慮過的選項

- 保留 dag-cbor GLB CID，CAR 端把 root 當特殊例外：延續錯誤內容宣告，所有通用工具都要
  知道 Open4WD 特例，否決。
- 將 GLB 包進一層 DAG-CBOR manifest：會改變「UGC CID 直接鎖定最終 GLB bytes」的既有
  邊界，且目前單檔內容不需要額外結構，否決。
- GLB 使用 raw CID，Ledger canonical blocks 維持 dag-cbor CID（採納）。

## 決定

UGC GLB 固定以 `CIDv1(raw, sha2-256)` 定址；只有實際經 canonical DAG-CBOR 編碼的
Ledger 內容使用 `CIDv1(dag-cbor, sha2-256)`。共用 block access 必須以不同 writer 明確
選擇 codec，讀取驗證則保留請求 CID 的 codec 並重算 digest，不以內容 decoder 猜測。

因尚無正式 UGC 資料，不提供舊 dag-cbor GLB CID alias、雙讀、轉換表或 migration。現行
canon 由 [資料系統.md 的 CID 命名空間](../資料系統.md#2-cid-命名空間) 與
[UGC機制.md 的上鏈動作](../UGC機制.md#43-上鏈動作) 定義。

## 後果與影響

同一份 GLB bytes 仍具唯一且可重算的內容身分，但 multicodec 現在如實表示 opaque raw
內容。玩家保存包可把當前 UGC 表示為單一 raw root block；日後若引入多 block DAG，無需
為今天的錯誤 codec 保留例外。Ledger checkpoint 與 derived state 的 CID、簽章及共識規則
不變。
