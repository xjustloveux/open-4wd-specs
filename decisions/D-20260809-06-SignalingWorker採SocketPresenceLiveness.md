---
id: D-20260809-06
date: 2026-08-09
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260722-01", "D-20260729-02"]
domains: ["比賽房間", "版本部署"]
sources: ["2026-08-09 ─ Signaling Worker 改採 Socket Presence Liveness（issue 000277）"]
files: ["程式架構/signaling-service.md", "程式架構/程式流程/signaling-service.md", "部署資訊/open-4wd-signaling.md"]
vectors: []
deprecates: []
---

# D-20260809-06｜Signaling Worker 採 Socket Presence Liveness

## 背景與驅動力

Node adapter 可用 transport ping／pong 判斷連線，Cloudflare Durable Object hibernation 模式卻可能在
socket 仍存在時長時間沒有 application message。若兩端共用「最後訊息時間」回收 peer，合法 idle
房間會只在 Worker adapter 被誤踢；新增 client heartbeat 又會擴大公開 wire 與背景節流面。

## 考慮過的選項

- 新增 client application heartbeat：跨 adapter 一致，但增加協定、流量與背景節流風險。
- Durable Object 自動回應 heartbeat：仍需要新 wire，且不能直接證明 runtime socket 已消失。
- Node 保留 transport liveness；Worker 以 hibernatable socket presence 更新存活：採納。

## 決定

Node adapter 繼續使用平台 ping／pong。Worker alarm 每次以實際 hibernatable WebSocket snapshot 判定
已註冊 peer 是否仍存在；存在的 idle socket 視為 alive，只有 runtime presence 消失後才依共同
peer timeout 回收。尚未 REGISTER 的 socket 仍受 register deadline 限制。不新增 client heartbeat
或平行 keepalive message。

## 後果與影響

兩個 adapter 保持相同對外 signaling 行為，但 liveness 證據依平台能力不同；共用 timeout 常數仍由
既有 owner 與 parity gate 看守。客戶端不需為 server 平台差異承擔額外協定與電量成本。
