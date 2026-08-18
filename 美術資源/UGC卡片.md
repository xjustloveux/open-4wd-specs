---
type: art
domain: ["前端主題"]
summary: UGC 卡片結構／必顯欄位／評分顯示規則與入口
authority: null
slug: null
---
# UGC 卡片（UGC Card Spec）

> **本檔角色**：UGC 卡片與評分顯示的**細化** —— 卡片結構、各類資源必顯欄位、評分顯示規則、評分入口。
> 評分系統實作見 [ugc-rating.md](../程式架構/ugc-rating.md)；評分算式（Bayesian / 隱式查表）見 [算式表.md §19](../算式表.md)。對應前端卡片元件（[ui-frontend.md `o4-card`](../程式架構/ui-frontend.md)）。

## 1. 共通卡片結構

| 區域 | 內容 |
|---|---|
| Preview | 自動截圖 / 3D thumbnail，固定 aspect ratio |
| Header | 名稱、作者 `name #1a2b3c4d`、狀態 badge |
| Stats | 2–4 個核心 stat（依資源類型）|
| Meta | 使用次數、評分、CID 短碼、授權 |
| Actions | 詳細 / 裝配 / 測試 / Fork |

狀態 badge：`Local`（本機測試資產 `local:<uuid>`、不上鏈）/ `On-chain` / `Fork`（衍生）/ `similarity-pending`（灰區宣告上鏈、經濟隔離待仲裁，[版權.md §5.3](../版權.md)）/ `Blocked`（黑名單、不可線上用）。

## 2. 各類資源必顯欄位

| 類型 | 必顯 |
|---|---|
| **場地** | 場地名 / 作者 / 縮圖、max·recommended players、標籤（terrain_type／difficulty／style，enum 權威 [UGC機制.md §9.4.1](../UGC機制.md)）、平均完賽時間、檔案大小、評分·使用次數 |
| **零件** | 類別·材質·質量、mount 相容性（`Mount_*` 前綴規則，[零件與共用介面.md §5](../建模參數/零件與共用介面.md#5-empty-node-命名約定)）、物理重點（摩擦·散熱·恢復係數）、是否通過 sanitize |
| **創作者** | 非唯一暱稱快照＋空格＋`#`＋8 位 PeerId 指紋、信譽分、作品數、累計使用次數、累計創作回饋金；DMCA / 黑名單只顯示必要警示、不公開敏感個資 |

列表頁只顯示判斷用核心 stat，詳細頁才載完整 3D 與衍生樹。

> 組裝車輛是本機 loadout，不是 UGC 卡片類型；比賽結果中的 loadout 快照只供賽史
> 驗證，不進公開作品列表、評分或 Fork。

## 3. 評分顯示規則

| 條件 | 顯示 |
|---|---|
| 有顯式評分（voteCount ≥ 1）| `★4.6 (24)` — 星等 + 票數 |
| 完全無顯式評分（voteCount = 0）| `★4.2 (隱式)` — 隱式 fallback + `(隱式)` 標籤 |
| 公版資產 `builtin:*` | **不顯示 ★**（公版不可評分）|
| `similarity-pending` 資產 | 已累積星等照常顯示；**評分入口禁用**＋tooltip（經濟隔離五擋之一，[版權.md §5.3](../版權.md)）|
| 黑名單資產 | 不可線上使用；僅 `Blocked` 警示 badge、不顯示評分入口 |

**票數**讓玩家判斷可信度（`★4.6 (2)` 樣本太少 vs `(24)` 可信 vs `(1.2k)` 公認）；voteCount < 5 時 UI 標「樣本不足」或淺色弱化星等。**隱式 fallback** 由使用次數查表推估（整數查表 `implicitRatingX100`，見 [算式表.md §19](../算式表.md)），UI 加 `(隱式)` 淺色標籤標明分數來自使用熱度而非評分。

## 4. 評分入口（三處）

### 4.1 比賽結算頁（賽後評分）

列出該場用過的所有 UGC（排除 `builtin:*`），一鍵 1–5 星、無理由欄位（最小化評分疲勞）：

- 未評項目視為「跳過」、不送事件；整頁「跳過」→ 不寫任何評分事件。
- 「送出評分」→ 每個有星數項目寫一筆 `UgcRateEvent`（附 `useMatchId`）。

### 4.2 UGC 詳情頁（隨時評分）

顯示 `★4.6 (24 票)` + 評分分布（5★/4★/…票數）。按鈕可見性：**未使用過** → 禁用 + tooltip「在比賽中用過後才能評分」；**已用未評** → 「→ 評分」；**已評** → 「修改評分」+ 小字顯示舊星；**公版** → 不顯示。

### 4.3 個人頁「我的評分」

列出給過的評分，[修改] → 覆蓋（寫新 `UgcRateEvent`）、[撤回] → 確認後寫 `UgcRateRevokeEvent`（該票從計算移除）。

> 評分需「在比賽中實際使用過」才能評（防刷分）；事件 schema 見 [資料系統.md §3](../資料系統.md)、計算見 [ugc-rating.md](../程式架構/ugc-rating.md)。

## 5. Mobile 規則

卡片單欄或 2 欄（最小寬 156px）；Stats 最多 3 個（其餘進詳細頁）；操作按鈕改 icon + bottom sheet。
