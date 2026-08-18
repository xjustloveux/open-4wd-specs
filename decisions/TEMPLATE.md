# 決策檔模板

新增決策檔時複製以下骨架（檔名 `D-YYYYMMDD-nn-<中文短題>.md`；欄位語意見 [README.md](README.md)）：

```text
---
id: D-YYYYMMDD-nn
date: YYYY-MM-DD
status: accepted
supersedes: []
superseded_by: null
amends: []
domains: ["<域>"]
sources: ["YYYY-MM-DD <條目標題前段>"]
files: ["path/to/affected-file.md"]
vectors: ["domain/vector-family"]
deprecates: []
---

# D-YYYYMMDD-nn｜<標題>

## 背景與驅動力

<當時的問題、觸發點、約束。>

## 考慮過的選項

<逐選項一行＋主要取捨；流水帳未記錄替代方案時如實註明「（流水帳未記錄替代方案；本決策以修正／收斂／翻案形式成立）」，不得虛構。>

## 決定

<定了什麼，講清楚即止；現況細節連結 canon。>

## 後果與影響

<正負影響、連動變更、supersede／amends 關係說明、後續接續點。>
```

寫作守則：中英之間留半形空格；程式識別符與檔名提及包 `` ` `` 反引號；決策檔全檔禁用 `§`，跨檔引用使用檔級連結，需要章節時在連結文字寫「第 N 節」；不用禁用語（黑名單 ＝ 全域、封鎖清單 ＝ 個人；不用 MVP／v1.x 措辭——此句為禁令宣告）。
