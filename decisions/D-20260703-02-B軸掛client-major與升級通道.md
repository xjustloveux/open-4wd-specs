---
id: D-20260703-02
date: 2026-07-03
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["版本部署"]
sources: ["2026-07-03 版本規範.md 三輪複審", "2026-07-03 版本規範.md 二輪複審"]
files: ["版本規範.md", "程式架構/ledger.md", "經濟系統.md", "UGC機制.md", "建模參數.md", "資料系統.md"]
vectors: []
deprecates: []
---

# D-20260703-02｜B 軸掛 client major 發版軸＋升級通道收斂

## 背景與驅動力

[D-20260528-02](D-20260528-02-B軸schema版本系統.md) 的 B 軸機器（破壞牆表 ／ 保留映射函式 ／ 新 schema 版 ／yank 清單）全隨 client 出貨，卻沒定隨哪種 bump：A 軸配對閘只比 major，若牆或映射隨 minor 出貨，同 major 不同 minor 的 peer 會算出不同降版目標（desync）。另有兩個洞：升級免費條件自相矛盾（「棄用即免費」對上「低於 min 才免費」），且 `AssetVersionUpgradeEvent` 零收件驗證 ＝ 繼承劫持洞（偽造後繼邊指向熱門資產舊 CID 即可白拿評分、使用次數與 fork 樹位置）。

## 考慮過的選項

- 牆 ／ 映射 ／yank 隨 minor 出貨：直接產生跨 minor 的版本語意分歧，否決。
- 付費升級通道（非破壞舊版升級照常收費）：上鏈費只掛在 upload／fork 事件、升級事件無費可掛，且非破壞舊版本就活躍、mesh 又被驗證鎖死，產品面無意義——懸空通道砍除。
- 免費條件三輪演進：低於 min 才免費 → 二輪「棄用 ／unusable 即免費」→ 三輪收斂「升級通道僅限跨破壞牆、恆免費」（採納）。

## 決定

- 任何 schema bump（破壞或非破壞）＝ 新映射 ／ 新牆隨 client major 發版；yank 清單為 client 隨附資料、隨 major 出貨、不上鏈。核心保證閉合：major 相同即映射集相同。
- loader 三分支擴為四分支：`open4wd_version` 高於本 client 該 type 支援上限 → 拒絕載入 ＋ 提示升級。
- 升級通道僅限跨破壞牆（舊 CID 棄用 ／unusable）、恆免費；非破壞舊版無升級通道，改內容走一般付費上傳或 fork；`AssetVersionUpgradeEvent` 明文不帶費用。
- 收件驗證五條擴為六條：舊 CID 低於該 type 最新破壞牆 ／`event.peerId` 為血緣節點創作者 ／ 同 type／ 版本單調後繼 ／ 舊 CID 非仲裁黑名單資產 ／ 新舊 mesh 幾何指紋一致（僅 extras 差異）——最後一條封死繼承劫持，副效益是升級免 similarity 重宣告。
- yank × 動態 min 死角規則：可用性與降版目標一律在非 yanked 版本集合上計算；min 落在 yanked 版時，過渡期有效地板為 min 之下最近非 yanked 版；CI 強制 yank 清單變更必須同版存在非 yanked 替代版。
- `versionStatusByCid` 的 `'yanked'` 自 ledger fold 移出、由讀取層 overlay（client 隨附清單不得混入純 fold）。

## 後果與影響

B 軸完全 major-gated，minor 之間不再有降版目標分歧面；「免費改版白吃繼承」與下架品換皮復活的路徑封死。房間側的檢查點政策同輪定案於 [D-20260703-03](D-20260703-03-房間pin檢查點政策.md)。細節權威見 [版本規範.md](../版本規範.md)。
