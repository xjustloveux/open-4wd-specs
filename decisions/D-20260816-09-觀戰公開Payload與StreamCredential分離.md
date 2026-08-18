---
id: D-20260816-09
date: 2026-08-16
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260802-07", "D-20260806-01", "D-20260812-02", "D-20260816-01", "D-20260816-03"]
domains: ["比賽房間", "資安"]
sources: ["2026-08-16 ─ 觀戰公開 payload 與 room 暱稱快照收斂（issue 000599）"]
files: ["程式架構/peer-discovery.md", "程式架構/room-runtime.md", "程式架構/spectator.md", "流程/觀戰.md"]
vectors: []
deprecates: [{"item":"GossipSub spectator-chat topic／payload／adapter／public ChatData capability","kind":"replaced","replacement":"waiting RoomPage 文字聊天與 RacePage participant 圖示訊息"},{"item":"spectator wrong-password 拒因","kind":"replaced","replacement":"credential 失敗統一 join-rejected"},{"item":"stream plane password／invitation","kind":"replaced","replacement":"room snapshot admission 與 source assignment"},{"item":"join-request displayName","kind":"renamed","replacement":"nicknameSnapshot"}]
---

# D-20260816-09｜觀戰公開 Payload 與 Stream Credential 分離

## 背景與驅動力

RoomSession 角色 admission、OPAQUE、deterministic replay、賽中圖示訊息與 PeerId 顯示身分先後
落地後，觀戰 fallback 仍重複傳送暱稱，索源 API 仍保留 password 位置參數，spectator-stream
server 也殘留第二次密碼判定。這會擴大公開資料面，並讓 credential 看似能跨 control plane 與
stream plane 重複使用；舊 spectator-chat topic 則與賽中僅允許圖示訊息的現行裁決衝突。

## 考慮過的選項

- fallback wire 攜帶簽章暱稱快照：畫面自足，但重複公開及保存非必要人物資料，否決。
- stream 再次驗證 invitation：看似多一層閘，但擴大 secret 暴露面並建立第二套 admission，否決。
- PeerId-only fallback、room snapshot 本地解析、credential 僅留在 OPAQUE control plane（採納）。

## 決定

- `peerId` 始終是人物唯一權威。room member 與 join-request wire 的非唯一呈現欄位命名為
  `nicknameSnapshot`；pre-launch decoder 不接受舊 `displayName` 欄位。
- fallback `SpectatorPublicHudState.standings` 只傳 `peerId` 與 `rank`。viewer 從已驗 room snapshot
  取得 `nicknameSnapshot`，呼叫共用 `resolveDisplayIdentity`；缺快照時顯示 `#` 加
  SHA-256(PeerId) 前 4 bytes 的 8 位小寫十六進位指紋。
- OPAQUE invitation 只用於 room-control admission。`joinAsSpectator`、`requestSource`、來源重連與
  spectator-stream server 都不接受、保存或重送 password／invitation；stream 只接受 room snapshot
  已 admission 且被 host assignment 指向目前 source 的 PeerId。
- credential 驗證失敗對 joiner 一律為 `join-rejected`。`spectators-disabled`、`room-closed` 與
  `spectator-full` 仍可作非 credential 政策拒因；`wrong-password` 從 current union 移除。
- GossipSub spectator-chat topic、payload、adapter 與 public ChatData capability 移除。waiting
  RoomPage 繼續共用已簽文字聊天；RacePage 只收 participant 原簽章圖示訊息。
- 10Hz 只屬有界 presentation fallback；deterministic replay 是主模式。fallback 每車
  `brokenPartIds` 最多 64 筆，每項 1–128 字元並依 canonical ASCII 順序去重。

## 後果與影響

公開觀戰資料面不再重複攜帶暱稱，改名或缺快照不會影響 PeerId 權威；stream reconnect 也不再
延長 invitation 的記憶體生命週期或混淆 admission 邊界。代價是 viewer 必須保有已驗 room
snapshot 的暱稱投影，缺資料時只顯示指紋。pre-launch 不保留舊 wire、舊 topic 或 positional
password 相容分支。
