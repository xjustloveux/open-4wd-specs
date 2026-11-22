---
id: D-20260811-15
date: 2026-08-11
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20260723-01"]
domains: ["前端主題"]
sources: ["2026-08-11 ─ Style API v1 emitter 雙向完整性（issue 000340）"]
files: ["主題系統.md", "程式架構/themes.md"]
vectors: []
deprecates: [{"item":"shell-accent／panel-corner","kind":"removed","replacement":null},{"item":"garage-atmosphere","kind":"renamed","replacement":"garage-decoration"},{"item":"hero-art-frame","kind":"renamed","replacement":"hero-art-surface"}]
---

# D-20260811-15｜Style API v1 Emitter 雙向完整性

## 背景與驅動力

Style API v1 registry 曾保留已無 production emitter 的 `shell-accent`／`panel-corner`。validator 只確認主題 CSS 的 selector 在 allowlist，因而會接受永遠不生效的作者樣式；同時 registry 與 canon 各自手抄局部 part 清單，模板整理後容易漂移。`hero-art-frame` 仍暗示固定外框，也與既有「裝飾層不保證具體幾何」方向不一致。

## 考慮過的選項

- 為 dead part 補回固定角件 emitter：維持名稱但重新引入已移除的構圖假設，棄。
- 只從 registry 下架兩個 dead part：修正當前個案，但無法防止下一次 emitter／registry 漂移，棄。
- 原子整理語意 part 並建立雙向機器 gate（採納）。

## 決定

- Style API v1 直接移除 `shell-accent`／`panel-corner`，不留 alias；`garage-atmosphere` 正式暴露為 `garage-decoration`，`hero-art-frame` 原子更名 `hero-art-surface`。開發期未發布契約整理不升 v2。
- `garage-decoration` 是覆蓋 Garage shell、`aria-hidden`、`pointer-events: none` 的非互動裝飾表面，可用 background、gradient、texture、mask 與 pseudo-elements，但不保證角落、外框、位置或具體幾何。`hero-art-surface` 是 Hero artwork 的 viewport／clip surface，`hero-art` 才是圖像層。
- `THEME_PARTS` 是唯一機器名錄；canon 只記穩定語意與特殊邊界，不再手抄局部完整列表。
- `themes:validate` 雙向要求 registry part 都有 production emitter、production literal emitter 都在 registry。掃描 Angular HTML、component host metadata 與封閉 literal `themePart` input；排除 specs、fixtures、dist、generated。動態 emitter 必須逐來源提供封閉映射，不允許全域忽略。
- builtin theme 不必覆寫每個活 part；「有 emitter」與「主題有選擇消費」是不同契約。

## 後果與影響

本決策修訂 [D-20260723-01](D-20260723-01-主題StyleAPI-v1.md) 的 part lifecycle 守門，但維持 Style API v1 的 selector、cascade 與安全模型。模板刪除或新增 stable part 時會在 CI 立即失敗；主題作者不再能提交指向 dead part 的無效 CSS。現行 gate 亦把既有 `inbox-heading`／`inbox-console` emitter 納入正式 registry，消除反向漂移。
