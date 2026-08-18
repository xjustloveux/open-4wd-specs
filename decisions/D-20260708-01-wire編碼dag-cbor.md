---
id: D-20260708-01
date: 2026-07-08
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["共識帳本"]
sources: ["2026-07-08 里程碑 5a：站 4 邏輯核心"]
files: ["程式架構/peer-discovery.md"]
vectors: []
deprecates: []
---

# D-20260708-01｜gossip wire 編碼定案 dag-cbor

## 背景與驅動力

peer-discovery canon 草圖以 JSON 為 gossip topic 的 wire 編碼，但傳輸單位是 `SignedPayload`——內含 `Uint8Array` 簽章欄位，JSON 無法無損往返二進位；且 dag-cbor 已是簽章路徑的 canonical 序列化（[D-20260706-14](D-20260706-14-簽章位元組結構釘死.md)），再留 JSON＝ 雙編碼棧與轉換 drift 面。里程碑 5a 落地時定案。同輪並發現房間表 ttl 為公告者自報、無上限：惡意公告塞極大 ttl＋ 多房號灌表（限流下每分鐘 30 筆）＝ 表無界成長。

## 考慮過的選項

- JSON（canon 草圖）：`Uint8Array` 欄位無損往返不可能，需另立編碼約定。
- dag-cbor（採納）：既有 canonical 棧、單一編碼、簽章與傳輸同構。

## 決定

- gossip topic 的 wire 編碼 ＝**dag-cbor**（單一編碼棧）；JSON 僅限 signaling server 通道（該通道無二進位欄位），兩通道分工明確。
- 房間表 sweep 時 ttl 夾生效上限 **`ROOM_TTL_MAX_MS`**（300 秒 ＝ 重公告間隔 10 倍），防自報 ttl 灌表。
- 現況見 [程式架構/peer-discovery.md](../程式架構/peer-discovery.md)。

## 後果與影響

`SignedPayload` 從簽章訊息構造到 wire 傳輸全鏈路同一 canonical 編碼、跨 client 位元組級一致；房間表無界成長面關閉（房主本就每 30 秒重公告、誠實流量不受影響）。
