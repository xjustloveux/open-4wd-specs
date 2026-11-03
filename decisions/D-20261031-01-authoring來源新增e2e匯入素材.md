---
id: D-20261031-01
date: 2026-10-31
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20261022-01"]
domains: ["建模物理"]
sources: ["2026-10-31 ─ authoring 來源新增 e2e 匯入素材（issue 001152、001154）"]
files: ["程式架構/builtin-assets.md", "程式架構/testing.md", "美術資源/美術方向.md"]
vectors: []
deprecates: [{"item":"真實 GLB e2e 讀取 Tripo 時期的高面數原件與 UGC 刀刃樣本","kind":"replaced","replacement":"讀取 release-input/e2e/ 的 e2e 匯入素材（assetId 前綴 e2e:）"},{"item":"source manifest 的 assetId 只允許 builtin: 前綴","kind":"replaced","replacement":"另允許 e2e: 前綴；exact-set join 只對 builtin: 要求 Editor recipe 一一對應"}]
---

# D-20261031-01｜authoring 來源新增 e2e 匯入素材

## 背景與驅動力

main 的 `full-real-local-race` 與 `editor-real-part-import` 兩支 e2e 以高面數外部模型走完「匯入、自動縮放、
減面、組車、比賽」旅程。兩支 e2e 寫成時，公版 authoring 來源就是 Tripo 生成的高面數原件，測試直接拿它們當
輸入。[D-20261022-01](D-20261022-01-公版場地程序化交付與零件維持延後.md) 與
[D-20261030-01](D-20261030-01-公版零件程序化交付.md) 把公版改為程序化交付後，source manifest 只剩 27 個
`*-procedural-*` 檔，Tripo 原檔不再列入 desired state，但兩支 e2e 的素材清單沒有跟進（issue 001152）。這些
檔案目前只留在本機與舊 Release，採用新 Release 後 CI 與乾淨環境會缺檔。外部 AI 生成模型能否以本專案
Release 公開再散布，也沒有 provenance 交代。

程序化公版都低於 8k／12k 面，不會走到減面，不能直接替代。另一個缺口是 e2e 底盤沒有選配掛點，組車時沒有
導輪、晶片與武器類別可裝（issue 001154）。

## 考慮過的選項

- **(1) 由公版程序化原件推導 e2e 專用素材**：權利與公版相同、可重現，能刻意製造需要覆蓋的瑕疵。
- **(2) 把 Tripo 原件與刀刃正式納為 e2e 素材**：工作量最小，但需先確認外部服務條款允許公開再散布，與公版
  改為程序化的理由相反。
- **(3) 直接用程序化公版**：取得容易，但不走減面與細條清理，覆蓋縮水。

底盤選配掛點：(a) e2e 在 Editor 掛點面板補上，與玩家操作相同；(b) 素材自帶掛點。

2026-10-31 維護者裁決採 (1) 與 (a)。

## 決定

### 1. e2e 匯入素材

- `release-input/e2e/` 保存 9 個素材（8 顆零件、1 個場地），由 `release-input/e2e/generator/e2e_inputs.py`
  （只用 Python 標準函式庫）從公版程序化 authoring GLB 推導：去除全部 extras 與非 mesh 節點，使 Editor
  視為未標記的外部模型；以中點細分提高面數到不低於 12 萬面；馬達加入非流形薄片與細條，武器挖洞並在洞緣
  切出細條。同一輸入重跑逐位元相同。
- 生成器、`GENERATOR.md` 與 `PROVENANCE.md` 隨同一 authoring-source Release 發布（`.py`／`.md` 收進
  `authoring-text.zip`）。

### 2. source manifest 新增 `e2e:` 類別

- `assetId` 允許 `builtin:` 與 `e2e:` 兩種前綴。`e2e:` 素材與公版來源受同一組 logical path、size、SHA-256、
  candidate epoch 與 adoption gate 約束。
- main 的 exact-set join 只要求 `builtin:` 來源與 Editor recipe 一一對應；`e2e:` 來源不出貨、沒有 recipe，
  recipe 也不得引用它們。
- 本次加入 9 筆，candidate epoch 由 4 升為 5。

### 3. e2e 旅程

- 兩支 e2e 改讀 `e2e-*.glb`；`authoringSourcePath` 依 `e2e-` 前綴解析到 `release-input/e2e/`。
- 完整旅程匯入底盤後在掛點面板補上晶片、武器與導輪槽；場地路線點依新場地座標放在環形道路直道上。

## 後果與影響

- 採用 epoch 5 Release 後，真實 GLB e2e 在 CI 與乾淨環境也取得同一份素材，且權利證據與公版一致。
- Release 增加約 82 MB 的 e2e 素材。
- e2e 素材的瑕疵是合成的，比真實 AI 或掃描模型規則；若要覆蓋特定真實輸入，需另行評估。
- 本機 `release-input/` 仍留有不在 desired state 的舊 GLB（Tripo 原檔與舊版程序化檔），Release 準備工具會
  拒絕；發布前須由維護者處置，屬 issue 001141 的發布前置。
- 現況規格：[程式架構/builtin-assets.md](../程式架構/builtin-assets.md) 第 7 節、
  [程式架構/testing.md](../程式架構/testing.md) e2e 分組段落、[美術資源/美術方向.md](../美術資源/美術方向.md)
  現有檔案狀態。
- 與既有決策的關係：amends [D-20261022-01](D-20261022-01-公版場地程序化交付與零件維持延後.md) 的
  source manifest 身分規則（原只容公版來源）。D-20261022-01 已有一段指向 D-20261029-05 的加註，本次修訂關係由
  本決策的 amends 欄位記錄，原文不改寫。

## 定案紀錄

2026-10-31 使用者審閱後同意採納：e2e 匯入素材由公版程序化原件以 Python 標準函式庫腳本推導並隨同一 authoring-source Release 發布，source manifest 新增 `e2e:` 類別且不需 Editor recipe，完整旅程在掛點面板補上底盤選配掛點。
