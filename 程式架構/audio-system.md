---
type: impl
domain: ["前端主題"]
summary: 播放槽名錄／主題音訊 fallback／BGM 轉場／三路混音
authority: null
slug: null
---
# audio-system（音訊系統實作）

> **本檔角色**：音訊系統的**實作層** —— 播放槽（slot）名錄、主題音訊 fallback／ 靜音語意、BGM 轉場規則、保留 SFX、`AudioService`（Web Audio 混音）、CI 檢核。對應 `src/audio-system/`。
> 音訊檔案一律由**主題**提供（[../主題系統.md](../主題系統.md)：`bgm-*`／`sfx-*` 資產 key＝ 本檔槽位名錄）；`AudioService` 與槽位機制在程式碼、檔案是資料。
> **兩項定案**：① 場地**不**內嵌 ／ 綁定音樂（版權審核面 ＋ 下載體積 ＋ 管線成本）② **不提供玩家自訂 BGM**（複雜度不值——各平台皆有玩家慣用的背景音樂軟體）。

## 1. 模型：槽位名錄＋有檔才播

- **播放槽清單（[§2](#2-播放槽名錄完整名錄新增調整改本表default-manifest-同一-pr)）＝ 機制、一次完整**；音訊**檔案 ＝ 資料、隨經費 ／ 主題累積**。
- **有檔才播**：槽位無檔 ＝ 靜音，不是錯誤——**default 主題初期可以全部無檔**（值 `null`），後續逐槽補上即全網生效。
- 主題按槽位名錄供檔；語意三態（[§3](#3-檔案與-fallback-語意)）：提供路徑 ／ 省略（fallback default）／`null`（明確靜音）。

## 2. 播放槽名錄（完整名錄；新增／調整＝改本表＋default manifest 同一 PR）

### 2.1 BGM 槽（依 [程式架構.md §13](../程式架構.md) 路由分域）

| 槽 | 使用點 |
|---|---|
| `bgm-home` | `/`・`/home`・`/login`・`/about`・`/help` |
| `bgm-garage` | `/garage`・`/garage/edit/:id` |
| `bgm-editor` | `/editor` |
| `bgm-browse` | `/ugc`・`/ugc/:cid`・`/creator/:peerId` |
| `bgm-room` | `/room/:roomId`（含賽制設定 `/race-config`）|
| `bgm-race` | `/race/:sessionId` |
| `bgm-result` | `/result/:resultId` |

### 2.2 SE 槽（UI ＋ 賽事事件）

| 槽 | 使用點 | 保留 |
|---|---|---|
| `sfx-click` | 通用按鈕 | |
| `sfx-confirm` / `sfx-cancel` | 確認／取消 | |
| `sfx-error` | 錯誤提示 | |
| `sfx-toast` | 通知彈出 | |
| `sfx-countdown` | 開賽倒數 | ✅ |
| `sfx-race-start` | 起跑（GO）| ✅ |
| `sfx-checkpoint` | 過檢查點／過圈 | |
| `sfx-race-finish` | 完賽 | |
| `sfx-part-broken` | 自車部件破壞（事實通知、非預警——熱系統無預警為既定設計）| ✅ |
| `sfx-elimination` | 淘汰（含轉觀戰）| ✅ |

### 2.3 世界空間音效槽

| 類別 | 槽 | 觸發語意 |
|---|---|---|
| 馬達 | `sfx-motor-loop` | 每車 loop，依世界位置與速度調 pitch |
| 表面 | `sfx-surface-hard` / `sfx-surface-loose` / `sfx-surface-slippery` | 只接受場地／物理層明確分類，不依模型形狀猜測 |
| 碰撞 | `sfx-collision-light` / `sfx-collision-heavy` | 依相對速率分級，接觸點為聲源位置 |
| 近戰武器 | `sfx-weapon-melee-launch` / `sfx-weapon-melee-impact` | 依 mechanism 與 launch／impact 事件 |
| 發射武器 | `sfx-weapon-projectile-launch` / `sfx-weapon-projectile-impact` | 依 mechanism 與 launch／impact 事件 |
| 技能 | `sfx-skill-boost` / `sfx-skill-brake` / `sfx-skill-swerve` / `sfx-skill-jump` / `sfx-skill-slam` / `sfx-skill-stabilize` | swerve 左右共槽，其餘依 skill id |

`src/audio-system/slots.ts` 是槽位名錄唯一權威；`themes:validate` 直接解析該檔，default manifest 必須逐槽列出（可為 `null`），不得另抄第三份清單。

> **未映射路由**（`/settings`、`/inbox`、`/dmca`、`/dmca/transparency`、`/announcements` 等）＝ **維持當前 BGM、不轉場**（閱讀／覆蓋層性質頁面，自然沿用進入前的音樂）。

## 3. 檔案與 fallback 語意

- 主題 manifest 的音訊 key 三態：**路徑**（供檔）／ **省略**（fallback default——與視覺資產一致）／**`null`**（明確靜音、蓋掉 default）。
- **保留槽**（[§2](#2-播放槽名錄完整名錄新增調整改本表default-manifest-同一-pr) 標 ✅ = `RESERVED_SFX_SLOTS`）：主題供檔**一律忽略、恆取 default**——gameplay 資訊音效不可被主題弱化或置換（與 `THEME_RESERVED_TOKENS` 同哲學）；default 該槽無檔時 ＝ 全網靜音、待補檔自動全網生效。
- 格式：OGG Vorbis／Opus；混音基準建議 **−16 LUFS**（供檔規範，`themes:validate` 可抽驗）；計入主題 `THEME_SIZE_MAX_MB` 預算（BGM 為大頭）。

## 4. BGM 轉場規則

| 情境 | 行為 |
|---|---|
| 場景切換、目標槽解析出**同一檔** | **不中斷**續播 |
| 目標槽為**不同檔** | 淡出淡入（crossfade `BGM_CROSSFADE_MS`，[ui.md §13](../程式參數/ui.md#13-uiaudiobgm-轉場)）|
| 目標槽**無檔**（null／default 也空）| 僅淡出 |

BGM 預設 loop；SE 即發即停、不受轉場影響。「同一檔」判定以解析後的實際資產路徑為準（不同主題槽名相同但檔不同 ＝ 異曲）。

## 5. AudioService（Web Audio 混音）

三路 gain：`master ← (sfx / bgm)`：

```typescript
class AudioService {
  private audioContext = new AudioContext();
  private masterGain = this.audioContext.createGain();
  private sfxGain = this.audioContext.createGain();
  private bgmGain = this.audioContext.createGain();
  private soundCache = new Map<string, AudioBuffer>();   // SE 解碼快取（啟動預載第一批）

  constructor(private settings: AudioSettings) {
    for (const g of [this.sfxGain, this.bgmGain]) g.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);
    this.applyVolumes();
  }
  applyVolumes(): void {
    this.masterGain.gain.value = this.settings.masterVolume / 100;   // 0~100 → 0~1
    this.sfxGain.gain.value = this.settings.sfxVolume / 100;
    this.bgmGain.gain.value = this.settings.bgmVolume / 100;
  }
}

interface AudioApi {
  playSfx(slot: string): Promise<void>;                 // 保留槽恆走 default（§3）
  preloadSfx(slots: string[]): Promise<void>;
  playWorldSfx(slot: string, position: [number, number, number]): Promise<void>;
  updateWorldLoop(sourceId: string, slot: string, position: [number, number, number], rate: number): void;
  updateWorldListener(pose: { position: Vec3; forward: Vec3; up: Vec3 }): void;
  onSceneChange(route: string): void;                   // route → BGM 槽（§2.1 映射）→ §4 轉場
  setMasterVolume(v: number): void; setSfxVolume(v: number): void; setBgmVolume(v: number): void;
}
```

- 槽 → 檔案解析走 [themes.md §3 `resolveAsset`](themes.md)（含 default fallback／`null` 靜音分支）。
- iOS Safari：`AudioContext` 需首次使用者互動後啟動。`unlocked` 只表示本 session 曾取得
  使用者手勢，不代表 context 永遠 `running`；全域 pointerdown 保持可重入，頁面回 visible 時
  僅對已解鎖服務重試。SFX 與 world context 的 `resume()` 先檢查 state，`running`／`closed`
  直接略過，`suspended`（含平台等價中斷態）以 single-flight 恢復；失敗靜音收斂，下一個手勢
  可再試。lifecycle retry 不得重建或重播 BGM。
- 音量三軸（主 ／ 音效 ／ 背景音樂）persist 於設定頁「音訊」分類（[遊戲機制.md §9](../遊戲機制.md)・[settings.md](settings.md)）。
- 世界音鏈為 `source → PannerNode(HRTF, inverse distance) → worldGain → masterGain`，沿用 sfx 音量軸；UI／賽事提示維持 flat。listener 由 viewport 在 camera rig／controls 完成後以**實際相機** world pose 更新，故 360° 場地、自由視角與任意 UGC 模型軸向皆不靠重力或外形推測。
- motor／表面 loop 隨車輛與回合生命週期停止；位置與速率取呈現幀。空間音訊純輸出，不參與 physics、rollback、wire 共識或帳本。

## 6. CI 檢核（併入 `themes:validate`，[../主題系統.md §7](../主題系統.md)）

- default manifest **必須列出本檔 [§2](#2-播放槽名錄完整名錄新增調整改本表default-manifest-同一-pr) 全部槽位 key**、值可為 `null`（名錄完備、檔案可缺）。
- 其他主題音訊 keys ⊆ default keys（未知槽 ＝ 錯字紅）。
- 保留槽（`RESERVED_SFX_SLOTS`）出現在非 default 主題 ＝ 警告（供檔會被忽略）。
- 音訊檔解碼煙測 ＋ 格式（ogg/opus）；大小計入 `THEME_SIZE_MAX_MB`。

## 7. 跨模組對接

| 模組 | 對接 |
|---|---|
| [../主題系統.md](../主題系統.md) · [themes.md](themes.md) | 音訊檔案供給（`bgm-*`／`sfx-*`）；`resolveAsset` 解析；升版後自癒同機制 |
| [settings.md](settings.md) | `AudioSettings`（master／sfx／bgm 三音量）|
| [遊戲機制.md §9](../遊戲機制.md) | 設定頁「音訊」分類 |
| [ui.md §13](../程式參數/ui.md#13-uiaudiobgm-轉場) | `BGM_CROSSFADE_MS`；音量預設權威在 settings |
| [../程式架構.md §13](../程式架構.md) | 路由 → BGM 槽映射 |
