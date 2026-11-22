---
type: art
domain: ["前端主題"]
summary: default 主題賽內倒數與起跑動畫提示詞
authority: null
slug: null
---

# default 賽內倒數與起跑動畫提示詞

3／2／1 各呼叫一次 ImageGen；`start.png` 保留為裝置造型與最終爆發風格錨點。起跑動畫
再依本檔「start 連續發射來源幀」逐幀呼叫 ImageGen edit，輸出保存在
`release-input/ui/race-countdown/default/source/start/`。

## 3

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's DEFAULT website theme: a single large numeral 3, centered, no other text. Visual style: dark mechanical racing workshop instrument, chunky machined metal numeral, graphite steel body, warm orange edge lighting and small cyan energy accents, crisp readable silhouette at small size, premium arcade-racing UI art, front-facing, isolated object with a few restrained sparks and mechanical ring fragments around it. Genuine alpha transparency everywhere outside the artwork; no backdrop, no panel, no border, no logo, no watermark, no letters, no words. Keep generous transparent padding and avoid excessive flashes.

## 2

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's DEFAULT website theme: a single large numeral 2, centered, no other text. Match a cohesive dark mechanical racing workshop instrument set: chunky machined graphite-steel numeral, worn metal surfaces, warm orange edge lighting, small cyan energy accents, crisp readable silhouette at small size, premium arcade-racing UI art, front-facing, isolated with restrained sparks and circular mechanical fragments. Genuine alpha transparency outside the artwork; no backdrop, panel, border, logo, watermark, letters, or words. Generous transparent padding, no excessive flashing motif.

## 1

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's DEFAULT website theme: a single large numeral 1, centered, no other text. Match a cohesive dark mechanical racing workshop instrument set: chunky machined graphite-steel numeral, worn metal surfaces, warm orange edge lighting, small cyan energy accents, crisp readable silhouette at small size, premium arcade-racing UI art, front-facing, isolated with restrained sparks and circular mechanical fragments. Genuine alpha transparency outside the artwork; no backdrop, panel, border, logo, watermark, letters, or words. Generous transparent padding, no excessive flashing motif.

## start 造型錨點

Create a square 1024x1024 transparent-background game HUD source illustration for Open4WD's DEFAULT website theme representing the instant a race starts, with absolutely no text or numerals. A compact futuristic mechanical starting horn / signal launcher angled dynamically, graphite steel with warm orange ignition glow and small cyan energy accents, releasing one controlled burst of orange sparks and cyan speed streak fragments. Dark mechanical racing workshop instrument style, premium arcade-racing UI art, crisp silhouette, isolated front three-quarter view, designed to animate in a short one-shot burst. Genuine alpha transparency outside all artwork; no backdrop, panel, border, logo, watermark, letters, words, or GO symbol. Generous transparent padding; avoid muzzle-gun realism and avoid repeated flash patterns.

## start 連續發射來源幀

每張都使用 built-in ImageGen edit。`start.png` 是原始風格／爆發參考，`start/00.png` 是嚴格的
裝置幾何、相機、裁切與對位錨點；03 之後另以 `start/03.png` 作峰值與發射方向參考。每次都帶入
以下共通限制：

> Preserve exactly the same graphite-steel starting horn, three-lamp signal tower with green light
> on, base, cables, bolts, proportions, front three-quarter camera, orange and cyan accents, canvas
> placement and premium arcade-racing mechanical game UI style. Genuine transparent alpha
> background; no backdrop, panel, border, text, numerals, GO symbol, logo, trademark, or watermark.
> Do not add, remove, bend, or redesign mechanical parts; only the firing effects may change.

逐幀動作：

- `00`：待發；號角只保留微弱內部暖光，無火花、光束、碎片或外部放電。
- `01`：早期蓄能；中心出現小範圍橘光，三條 cyan 能量條微亮，仍無外部放電。
- `02`：點火；中心出現集中橘白光點，號角邊緣只有兩三顆細小火花與極短 cyan glint。
- `03`：唯一峰值；短錐形橘色火花與 cyan 速度線剛離開號角，不產生第二個亮點。
- `04`：外移；火花與速度線沿相同方向移得更遠，中心亮度開始下降。
- `05`：擴散；碎片離開號角並稍微散開，中心只剩暖橘光，不重新點火。
- `06`：復位；裝置平穩，只剩少量較遠的暗火花、兩段短 cyan 尾跡與淡霧。
- `07`：餘光；回到待發姿態，只剩兩三顆將滅的橘色餘燼與一段極淡 cyan 殘影。
