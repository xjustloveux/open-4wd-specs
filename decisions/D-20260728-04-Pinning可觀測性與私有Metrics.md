---
id: D-20260728-04
date: 2026-07-28
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260720-01", "D-20260724-01"]
domains: ["版本部署", "資安"]
sources: ["2026-07-28 Pinning 可觀測性與官方私有 Metrics"]
files: ["程式架構/pinning-service.md", "部署資訊/open-4wd-pinning.md", "部署資訊.md"]
vectors: []
deprecates: []
---

# D-20260728-04｜Pinning 可觀測性與官方私有 Metrics

## 背景與驅動力

既有 `/stats` 只有節點摘要，無法區分 Bitswap、Circuit Relay、Gateway 或控制面流量，亦不足以
回答官方頻寬與故障來源。公版需要可攜的低耦合 instrumentation，官方則需要私有儀表板與告警，
但不能因此把玩家識別資訊或 raw metrics 暴露到 Internet。

## 考慮過的選項

- 延用 `/stats` 當完整監控：維度不足，且健康摘要與時序監控職責混淆——否決。
- 公開 `/metrics` 與 Grafana：方便但暴露容量、拓撲與可能的攻擊訊號——否決。
- Email 加 Discord 並設外部 heartbeat：覆蓋較廣，但現階段增加寄件與付費服務成本——延後。
- 公版預設關閉 Prometheus adapter，官方私有 Prometheus／Grafana／Alertmanager——採納。

## 決定

公版提供獨立且預設關閉的 Prometheus metrics listener、強型別 port 與 no-op adapter，禁止
PII 與高基數 labels。官方 overlay 以 `monitoring.open4wd.org` 的 Access／MFA＋Tunnel 保護
Grafana，raw metrics 只供內網 Prometheus 抓取，Alertmanager 只送私人 Discord；暫不設 Email
與外部 uptime heartbeat。指標與告警契約見 [pinning-service](../程式架構/pinning-service.md)
與[open-4wd-pinning 部署規格](../部署資訊/open-4wd-pinning.md)。

## 後果與影響

公版自架者可選擇零監控成本或接入既有 Prometheus，官方能量化各資料面流量並私下告警；
沒有外部 heartbeat 意味整站或監控棧同時失效時不會由第三方主動發現，這是目前經費限制下
接受的盲點。後續若加 Email 或外部探測，需另行評估憑證、費用與故障域。實作追蹤於 issue
`000048`。
