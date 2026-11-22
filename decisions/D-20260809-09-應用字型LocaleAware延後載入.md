---
id: D-20260809-09
date: 2026-08-09
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260704-02"]
domains: ["前端主題"]
sources: ["2026-08-09 ─ 應用字型改採 Locale-Aware 延後載入（issue 000271）"]
files: ["程式架構/i18n.md", "程式架構/themes.md", "語系清單.md"]
vectors: []
deprecates: []
---

# D-20260809-09｜應用字型 Locale-Aware 延後載入

## 背景與驅動力

若繁中、簡中與日文字型 CSS 全進 initial bundle，每位玩家都會取得三組 CJK 字型名錄與資源接縫，
即使目前語系只需要其中一組。SSG 逐語系注入能避免多載，但會把 runtime 語系切換與靜態輸出分成
兩套載入模型。

## 考慮過的選項

- 三組 CJK 字型全部 initial：切換最直接，但 critical path 與預載名錄無界膨脹。
- 由每份 SSG HTML 注入目前語系：首載精確，runtime 切換與 fallback 生命週期較複雜。
- Inter／共用樣式留 initial，CJK CSS 由目前語系在 runtime 延後啟用：採納。

## 決定

Inter 與共用應用樣式保留 initial；繁中、簡中、日文各自的 400／700 自站 WOFF2 與 stylesheet
只由目前語系啟用。字典請求完成後更新唯一 active locale font link，切換語系時替換而不累積舊
stylesheet；英文不下載 CJK。固定使用 `font-display: swap`，接受短暫 FOUT，載入失敗回退既有
locale stack，不阻擋語系切換或 app 啟動。

## 後果與影響

初始資源成本與目前語系成正比，代價是首次顯示可能短暫使用 fallback。後續主題自帶字型只能接在
這套應用 locale stack 之前或之上，不得讓主題字型重新迫使所有 CJK family 進 initial bundle。
