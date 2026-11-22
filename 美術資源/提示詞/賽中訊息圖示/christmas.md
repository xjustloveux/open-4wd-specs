---
type: art
domain: ["比賽房間", "前端主題"]
summary: 彩鉛聖誕賽中訊息圖示 96 詞製作規格
authority: null
slug: null
---

# 彩鉛聖誕賽中訊息圖示

圖庫獨立於 ThemeService；不隨網站主題切換。與原有圖庫相同覆蓋中央 96 個語意，所有玩家皆可選用。

## 共用提示詞

Hand-drawn colored-pencil Christmas illustration with visible dry pencil grain and layered crosshatching, forest green and cranberry red, warm ivory highlights. Recurring character: friendly little reindeer racing mechanic wearing goggles, green overalls and a red scarf, expressive mitten hands and small antlers. Vehicles are original Christmas miniature four-wheel racing cars. No rabbits, moons, carrots or Chinese architecture; no watercolor, no glossy 3D or smooth vector.

Single original game HUD sticker, square RGBA with actual transparent background. Centered subject, generous 12% transparent margins; clean silhouette readable at 64 pixels. No text, letters, numerals, punctuation, logos, watermark, UI panel, background scene, gore or realistic violence. One composition only; do not include the message label as text.

每次生成另附 Semantic message 與下表 Specific composition。圖像原稿放在 `release-input/ui/race-messages/christmas/<messageKey>.png`，輸出由 main repo 的既有 generate-race-message-packs 腳本處理為 256×256 透明 WebP，最大 64 KiB。製作中不代表已可出貨，必須完成完整性檢核及目視審查。

| messageKey       | Specific composition                           |
| ---------------- | ---------------------------------------------- |
| yes              | 技師角色開心點頭，抱著發亮的勾形小工具葉剪影   |
| no               | 技師角色搖頭，雙手交叉成阻擋姿態               |
| okay             | 技師角色豎起拇指，背後一輪完整小圓形光環       |
| understood       | 技師角色頭頂亮起燈，手臂接成完整光路           |
| not-sure         | 技師角色左右歪頭，兩耳分別指向相反方向         |
| maybe            | 技師角色拿著兩個不同禮盒，左右比較、猶豫選擇         |
| please           | 技師角色雙掌合十，柔和暖色光落下               |
| one-more-time    | 技師角色賽車沿環形賽道再繞一圈                 |
| hello            | 技師角色大力揮手，手臂隨動作飄起               |
| welcome          | 工坊形閘門打開，技師角色側身迎接               |
| nice-to-meet-you | 兩隻不同配色技師角色友善握手                   |
| good-luck        | 技師角色抱著四葉草與小石塊御守，不含文字       |
| have-fun         | 技師角色戴護目鏡開懷跳起，周圍紙花與星屑       |
| lets-go          | 技師角色賽車從拱門起跑，強烈向前暖色光軌跡     |
| wait-a-moment    | 技師角色伸掌示意等待，旁邊小型沙漏             |
| here-we-go       | 技師角色抓緊方向盤衝出雲霧起跑門               |
| on-your-left     | 俯視兩台迷你四驅車，左車以櫻粉暖色光高亮       |
| on-your-right    | 俯視兩台迷你四驅車，右車以金色暖色光高亮       |
| coming-through   | 技師角色車從兩車中央靈巧穿過                   |
| go-ahead         | 技師角色伸手禮讓，前方暖色光道路敞開           |
| after-you        | 前方迷你四驅車先走，後方技師角色保持禮貌距離   |
| slowing-down     | 技師角色車尾燈亮起，星屑軌跡逐漸縮短           |
| stopping         | 技師角色拉下柔軟煞車繩，車輪在雲上停住         |
| make-way         | 兩隻技師角色各向左右跳開，中央道路清楚         |
| watch-out        | 技師角色豎起雙手警戒，身後暖色光尖芒爆開       |
| danger           | 破裂石塊警示牌與紅紫脈衝，不含字形符號         |
| obstacle-ahead   | 賽道中央巨大隕石，技師角色車及時煞停           |
| crash-ahead      | 前方兩台迷你四驅車碰出卡通星星，無受傷畫面     |
| debris-ahead     | 賽道散落小石塊與小工具車殼，繞行軌跡           |
| slippery-road    | 迷你四驅車在結霜賽道左右滑動，留下彎曲星痕     |
| rough-road       | 凹坑路面讓技師角色與車輪上下彈跳               |
| narrow-path      | 兩側岩石收窄，只容一台迷你四驅車通行           |
| jump-ahead       | 技師角色車躍過弧形光環斜坡，形成柔和拋物線     |
| trap-ahead       | 賽道藏著張開的紙雕捕捉網，技師角色繞開         |
| incoming-attack  | 後方流星能量沿軌跡逼近迷你四驅車，尚未命中     |
| behind-you       | 技師角色回頭，身後追車被光環高亮               |
| wrong-way        | 技師角色車與塵主流方向相反，雙手驚訝豎起       |
| blocked-path     | 倒下的工坊門完全擋路，技師角色尋找兩側小徑     |
| wait-for-me      | 後方技師角色揮手追趕，前車回頭減速             |
| catching-up      | 技師角色車乘暖色光尾焰快速拉近距離             |
| im-stuck         | 迷你四驅車輪陷進凹坑，技師角色用力推車         |
| im-lost          | 技師角色站在多岔賽道中央，兩耳各指不同方向     |
| i-crashed        | 迷你四驅車撞進柔軟雲堆，只冒出卡通星星         |
| im-damaged       | 迷你四驅車護板有裂紋，技師角色拿出小修理槌     |
| low-energy       | 小燈幾乎熄滅，技師角色疲倦低頭                 |
| cant-move        | 車輪被繩索纏住，技師角色無奈攤手               |
| recovering       | 技師角色修理車輛，滿暖色光環逐步恢復完整       |
| im-out           | 技師角色與車停在安全雲台，競速燈熄滅           |
| nice             | 技師角色豎拇指，身後一顆大星芒                 |
| great            | 技師角色雙拇指向上，圓形光環與金粉環繞         |
| amazing          | 技師角色驚喜躍起，周圍多層暖色光與星星         |
| awesome          | 技師角色高舉月桂齒輪獎盃，不含文字             |
| impressive       | 迷你四驅車完美落地，兩道對稱暖色光弧線         |
| well-done        | 技師角色開心鼓掌，掌間飛出金色星屑             |
| clean-move       | 迷你四驅車沿無碰撞的平順弧線完成超車           |
| respect          | 兩隻技師角色並肩互相點頭致意                   |
| wow              | 技師角色瞪大眼、雙手張開，圓形光環星芒放射     |
| lol              | 技師角色笑到後仰，手臂與身體出現跳動線         |
| oops             | 技師角色不小心讓一根小工具滾走，尷尬抓頭       |
| no-way           | 技師角色震驚張開雙掌，背後出現不可思議的節慶光環   |
| close-one        | 迷你四驅車以極小距離擦過岩石，窄縫發亮         |
| lucky            | 技師角色車剛好躲過隕石，四葉草飄過             |
| unlucky          | 迷你四驅車剛好陷入小凹坑，技師角色手臂垂下     |
| facepalm         | 技師角色用手掌按住護目鏡與額頭                 |
| thanks           | 技師角色把發光小工具形禮物遞給另一位同款節慶技師         |
| sorry            | 技師角色低頭低頭，雙掌放在身前致歉             |
| my-bad           | 技師角色指向自己並尷尬舉另一手認錯             |
| excuse-me        | 技師角色側身禮貌通過，對方讓出賽道             |
| no-problem       | 技師角色輕鬆擺手，背後圓形光環保持平穩         |
| its-okay         | 兩隻技師角色碰拳和解，柔和光環包住彼此         |
| please-stop      | 技師角色雙掌做停止手勢，迷你四驅車安全停下     |
| no-hard-feelings | 兩隻技師角色友善碰拳，破裂小石塊被光修復       |
| nice-hit         | 小工具形能量精準命中護盾中央，只有星形火花     |
| good-dodge       | 技師角色車沿弧線閃過流星能量                   |
| good-save        | 技師角色車在邊緣被雲朵與繩索安全拉回           |
| good-defense     | 圓形光環形護盾完整擋住流星波                   |
| that-hurt        | 技師角色車受擊震動，技師角色皺眉但沒有傷口     |
| comeback         | 落後技師角色沿大弧形賽道反超前車               |
| great-overtake   | 兩台迷你四驅車交錯，外線車以金色暖色光超越     |
| photo-finish     | 兩台迷你四驅車鼻尖同時穿過黑白幾何終點帶       |
| keep-going       | 技師角色車持續前進，後方三段暖色光逐段增亮     |
| dont-give-up     | 技師角色推車爬上陡坡，握拳鼓勵自己         |
| you-can-do-it    | 技師角色指向遠方明亮拱門，另一手握拳           |
| take-your-time   | 技師角色車平穩行駛，旁邊緩慢旋轉的新光環       |
| almost-there     | 迷你四驅車接近發光拱門，只剩很短距離           |
| nice-try         | 技師角色車稍微偏離但安全落地，技師角色仍豎拇指 |
| all-good         | 技師角色與完整迷你四驅車被柔和滿護盾包覆       |
| next-time        | 技師角色車沿循環賽道回到新的起跑雲台           |
| good-game        | 多台迷你四驅車在終點後並排閃燈致意             |
| well-played      | 兩隻戴護目鏡技師角色在終點握手                 |
| congratulations  | 技師角色高舉無字月桂獎盃，紙花與星屑飄落       |
| nice-race        | 迷你四驅車沿完整優美賽道穿越終點               |
| great-finish     | 技師角色車乘強烈金色暖色光穿過終點門           |
| good-effort      | 有磨損但完整的迷你四驅車抵達終點，技師角色握拳 |
| rematch          | 兩台迷你四驅車繞循環賽道回到並列起跑雲台       |
| goodbye          | 技師角色揮手，迷你四驅車沿雲路駛向遠方小燈光   |
