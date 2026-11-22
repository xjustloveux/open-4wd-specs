---
type: art
domain: ["前端主題"]
summary: 萬聖節復古賽內倒數與無字起跑插畫的來源及動畫規格
authority: null
slug: null
---

# 萬聖節復古賽內倒數與起跑插畫

## 構圖

南瓜雕刻、梅紫蝙蝠翼、古銅機械與細密雕刻線。3、2、1 分別以單一大數字為主體，維持粗實字形與透明邊界；裝飾不可妨礙縮圖辨識。起跑使用節慶發令號角，不含 GO、文字或數字。不得使用簡易線條數字代替完整插畫。

## 製作與時序

先以 built-in ImageGen 分別產生三張數字與一張起跑造型錨點。再以同一號角錨點進行八次 edit，固定相機、裝置幾何、比例及位置，只改變發射效果：待發、蓄能、點火、單次峰值、外移、擴散、復位、餘光。

PNG 原稿位於 `release-input/ui/race-countdown/halloween/source/`，起跑連續幀為 `source/start/00.png` 至 `07.png`。完整實際提示詞保存在 [節慶工程](../../實際使用圖/節慶主題2026/README.md) 的 `countdown-provenance.json`。

`build-countdown.py` 直接使用既有 `賽內倒數與起跑動畫/build_animation.py` 與 `animation-project.json`；不複製另一份時序規則。數字十格共 900ms，起跑八格共 720ms，512×512 RGBA WebP、loop=1。Encoder 可合併重複數字影格，但總時長不變。靜態圖取共用 timeline 指定幀。

舊 SVG 倒數與扁平 `frames/3-0.png` 等檔案已不再參與建置，保留檔案不表示仍是有效來源。
