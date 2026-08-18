---
id: D-20260812-02
date: 2026-08-12
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260802-12"]
domains: ["比賽房間"]
sources: ["2026-08-12 觀戰 deterministic replay 與精簡 fallback"]
files: ["程式架構/spectator.md", "流程/觀戰.md", "賽內機制.md", "流程/比賽進行.md"]
vectors: []
deprecates: []
---

# D-20260812-02｜觀戰 Deterministic Replay 與精簡 Fallback

## 背景與驅動力

10Hz presentation snapshot 無法提供真實車體、完整場地動態與一致 HUD，資料量又會隨武器、
碎片及觀戰人數成長。繼續逐欄擴充快照會形成第二套賽事呈現模型，且無法兌現「觀戰與參賽者
看到同一世界」的產品語意。

## 考慮過的選項

- 擴充 presentation snapshot：短期改動小，但重複世界狀態、流量隨場景複雜度增加，棄。
- 固定延遲後再播放完整狀態：增加等待與 buffer 複雜度，卻無法保護慢變的耐久、溫度與電量；
  參賽者改機客端本來也持有全車狀態，棄。
- 以相同引擎重播已簽 input，快照只供 late join／修復，另保留有界 presentation fallback（採納）。

## 決定

- 主模式為唯讀、非權威 deterministic replay：來源提供正面表列的 world descriptor、參賽者已簽
  input、週期 checksum 與按需 SavedState；觀戰端使用相同 world builder、物理、render mapper 與
  HUD 派生，不送 input、不簽章、不參與任何 race checksum 或多數決。
- 中途加入先載入 bounded SavedState，再追上有界 input backlog；每 120 幀對帳，失配便丟棄本地
  世界並重載快照。client／protocol 不相容或裝置無法負擔 replay 時，自動降級為精簡 fallback 並提示。
- fallback 的 presentation snapshot 採正面表列；`weaponNodes.fired` 只是公開呈現邊緣，協議 HUD
  只含 elapsed／lap／standings，不含來源端 NET、耐久、溫度、電量、技能配置、原始 input 或共識票。
  viewer 的 NET 由本地推導：replay 看 input jitter buffer 餘裕，fallback 看最後快照新鮮度。
- 不加政策性固定播放延遲；2–6 幀自適應抖動緩衝只處理網路抖動，觀戰天然落後一個中繼 RTT。
  `displayName` 一律由觀戰端依 PeerId 解析，不由來源寫入資料面。
- 加入拒因的 canonical union 包含 `wrong-password`。協定細節與 fallback byte budget 以
  [spectator.md](../程式架構/spectator.md) 為權威。
- replay 的速度、馬達音高、碰撞／武器音效、小地圖與回合摘要由觀戰端沿用參賽端 mapper／
  回合規則本地導出；無生產者的 `race-event` 不補第二套事件來源，直接自協議移除。
- 起跑倒數是例外：world descriptor 到達時點受 readiness 與 world build 影響，無法從 replay
  首幀可靠回推剩餘秒數，因此由 source 傳送低頻 `countdown` 控制訊息。它只驅動 overlay／音效，
  不具物理、共識或賽果權威。
- UI 依真實處理階段顯示建立世界、等待 checkpoint、追趕、live 或 reduced，不以「等待第一份
  snapshot」籠統取代 replay 階段。

## 後果與影響

觀戰主模式可呈現真車、武器、場地實體、天候與共用 HUD，且穩態資料量不再隨場景物件數成長。
代價是觀戰端需載入資產並執行物理；低階裝置與版本不符者仍有明確、受限且可提示的 fallback。
低頻倒數新增一個非權威控制訊息，但避免把可變 readiness 延遲誤算成固定倒數；其餘呈現不新增
重複 wire event，仍由 deterministic replay 單一路徑導出。
本決策部分修訂 [D-20260802-12](D-20260802-12-觀戰公開報廢presentation快照.md)：該決策的
`brokenPartIds`／`eliminated` presentation 規則只保留為 fallback，不再是觀戰主資料面。
