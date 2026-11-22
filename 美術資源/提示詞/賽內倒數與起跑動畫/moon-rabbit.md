---
type: art
domain: ["前端主題"]
summary: 月兔主題賽內倒數與起跑動畫提示詞
authority: null
slug: null
---

# moon-rabbit 賽內倒數與起跑動畫提示詞

3／2／1 各呼叫一次 ImageGen；`start.png` 保留為裝置造型與最終爆發風格錨點。起跑動畫
再依本檔「start 連續發射來源幀」逐幀呼叫 ImageGen edit，輸出保存在
`release-input/ui/race-countdown/moon-rabbit/source/start/`。

## 3

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's MOON RABBIT WORKSHOP theme: a single large numeral 3, centered, no other text. Whimsical moon-rabbit craft workshop style with a rounded hand-built numeral made of warm ivory glazed ceramic and pale jade enamel, coral-red accents, subtle gold seams, tiny rabbit-ear-shaped mechanical tabs and soft paper-lantern glow, charming but highly readable at small size, polished game UI art, front-facing and isolated with a few restrained moon-dust stars and craft fragments. Genuine alpha transparency outside the artwork; no backdrop, panel, border, logo, watermark, letters, or words. Generous transparent padding; cohesive celebratory style without excessive flash.

## 2

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's MOON RABBIT WORKSHOP theme: a single large numeral 2, centered, no other text. Match a cohesive whimsical moon-rabbit craft workshop set: rounded hand-built numeral made of warm ivory glazed ceramic and pale jade enamel, coral-red accents, subtle gold seams, tiny rabbit-ear-shaped mechanical tabs, soft paper-lantern glow, charming yet crisp and readable at small size, polished game UI art, front-facing and isolated with restrained moon-dust stars, cloud curls, and craft fragments. Genuine alpha transparency outside the artwork; no backdrop, panel, border, logo, watermark, letters, or words. Generous transparent padding; no excessive flashing motif.

## 1

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's MOON RABBIT WORKSHOP theme: a single large numeral 1, centered, no other text. Match a cohesive whimsical moon-rabbit craft workshop set: rounded hand-built numeral made of warm ivory glazed ceramic and pale jade enamel, coral-red accents, subtle gold seams, tiny rabbit-ear-shaped mechanical tabs, soft paper-lantern glow, charming yet crisp and readable at small size, polished game UI art, front-facing and isolated with restrained moon-dust stars, cloud curls, and craft fragments. Genuine alpha transparency outside the artwork; no backdrop, panel, border, logo, watermark, letters, or words. Generous transparent padding; no excessive flashing motif.

## start 造型錨點

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's MOON RABBIT WORKSHOP theme representing the instant a race starts, with absolutely no text or numerals. A whimsical hand-built moon festival confetti launcher and small jade-and-ivory signal horn, decorated with coral ribbons, gold fittings and subtle rabbit-ear shapes, releasing one controlled burst of paper petals, moon-dust stars and a single soft firework bloom. Warm ivory, pale jade, coral red and lantern-gold palette; polished charming game UI art, crisp isolated silhouette, designed for a short one-shot animation. Genuine alpha transparency outside all artwork; no backdrop, panel, border, logo, watermark, letters, words, or GO symbol. Generous transparent padding; no repeated flashes and no more than one bright burst.

## start 連續發射來源幀

每張都使用 built-in ImageGen edit。`start.png` 是原始風格／爆發參考，`start/00.png` 是嚴格的
裝置幾何、相機、裁切與對位錨點；03 之後另以 `start/03.png` 作峰值與發射方向參考。每次都帶入
以下共通限制：

> Preserve exactly the same hand-built ivory-and-jade main confetti cannon, gold fittings, coral
> ribbons, rabbit-ear motifs, wheel/base, hanging lanterns, smaller separate signal horn, camera,
> proportions, scale, pose, canvas placement and warm polished chibi moon-festival game UI style.
> Genuine transparent alpha background; no backdrop, panel, border, text, numerals, GO symbol,
> logo, trademark, or watermark. Do not add, remove, bend, or redesign device parts; only the
> existing firing effects and ribbon response may evolve. Never create a second firework.

逐幀動作：

- `00`：待發；主炮只保留微弱燈籠金內光，緞帶自然垂落，無花瓣、星塵、彩紙或煙火。
- `01`：早期蓄能；炮口與燈籠微亮，緞帶稍微抬起，仍無空中粒子。
- `02`：點火；炮口出現集中金白光，兩三片珊瑚花瓣與一顆小星剛越過邊緣。
- `03`：唯一峰值；短錐形花瓣、玉珠、星塵、金紙與緞帶飛出，前端只有一朵柔和煙火。
- `04`：外移；既有粒子沿相同方向前進，單一煙火稍微展開並轉暗，炮口亮度下降。
- `05`：擴散；彩紙與花瓣離開炮口並散開，煙火變寬、變柔、開始消退，不重新點火。
- `06`：復位；緞帶放鬆，只剩較遠的數片花瓣、兩顆小星、一顆玉珠與淡煙火殘影。
- `07`：餘光；回到待發姿態，只剩兩片將落的花瓣與一顆極淡星塵，煙火完全消失。
