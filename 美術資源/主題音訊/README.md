---
type: art
domain: ["前端主題"]
summary: 四個主題的 BGM 與音效交付清單、程式合成產生器與來源紀錄
authority: null
slug: null
---

# 主題音訊

四個主題（`default`、`christmas-workshop-2026-75fe9c`、`halloween-workshop-2026-a9028c`、
`moon-rabbit-workshop-2026-97c954`）的 BGM 與音效全部由本目錄的產生器以程式合成，沒有取樣，也沒有引用任何既有
錄音、樂曲或遊戲音效。採用依據見
[D-20261112-01](../../decisions/D-20261112-01-主題音訊採程式合成與預載分層.md)。

## 檔案權責

- 本目錄：`generate.py`（編曲、音效與編碼後驗證）、`synth.py`（合成引擎與 Ogg Opus 封裝）、`run.ps1`（執行入口）、
  `manifest.json`（每個檔案的參數、種子、段落結構、量測值與 SHA-256）、[風格設定.md](風格設定.md)。
- 主 repo `public/assets/themes/<主題 id>/assets/audio/`：實際出貨的 `.ogg`，由各主題 `theme.json` 的 `assets` 引用。
- 槽位名錄與保留槽的權威是 [程式架構/audio-system.md](../../程式架構/audio-system.md)。

## 交付清單

| 主題      | BGM 檔 | 音效 | 合計 | 未提供的音效槽                               |
| --------- | ------ | ---- | ---- | -------------------------------------------- |
| default   | 2      | 27   | 29   | 無                                           |
| christmas | 2      | 20   | 22   | 四個保留槽、三個路面循環音（都沿用 default） |
| halloween | 2      | 20   | 22   | 同上                                         |
| moon      | 2      | 20   | 22   | 同上                                         |

- 出貨的 BGM 是首頁曲（`bgm-home`）與比賽曲（`bgm-race`）。主題 `theme.json` 的 `bgm-garage`、`bgm-editor`、`bgm-browse`、`bgm-room`、`bgm-result`
  都指向首頁曲的檔案（[D-20261112-04](../../decisions/D-20261112-04-比賽以外的場景共用首頁曲.md)）。產生器仍會產出這五首，`manifest.json` 也保留它們的紀錄，但不出貨。

- 保留槽是 `sfx-countdown`、`sfx-race-start`、`sfx-part-broken`、`sfx-elimination`；路面循環音是
  `sfx-surface-hard`、`sfx-surface-loose`、`sfx-surface-slippery`。
- 產生器會為節慶主題產出四個保留槽的檔案作為風格對照，`manifest.json` 以 `reserved` 標註；這些檔不出貨。
- 格式：Ogg Opus、48 kHz。BGM 為立體聲、目標位元率 96 kbps、響度 −16 LUFS；音效為單聲道、64 kbps。
- 七首 BGM 與四個循環音效（`sfx-motor-loop`、三個路面循環音）以無縫循環製作：長度為整數小節，餘音與殘響回捲到開頭，
  並改寫 Ogg 的 pre-skip 與結尾 granule position，讓解碼結果恰好是一個循環。

## 重新產生

```powershell
.\run.ps1
```

需要本機安裝 Blender 4.5（使用它內含的 Python、numpy 與 `aud` 編碼器），不安裝套件、不連網。四個主題依序執行，
結果由固定種子決定。輸出（各主題的 `.ogg`、`loop-check/`、`_fragments/`、`_trial/`）寫在腳本所在目錄；
本 repo 的 `.gitignore` 忽略本目錄下的所有子資料夾與頂層的 `.ogg`、`.wav`，不進版控。重新產生後，把要出貨的
`.ogg` 複製到主 repo 的主題資料夾，合併步驟會直接覆寫本目錄的 `manifest.json`。只有內容改變的檔案需要換；沒改到的檔案 SHA-256 不變。

目前的 `manifest.json` 產生於 2026-11-12。之後 `generate.py` 只改過一行 docstring、兩行註解與寫入 manifest 的
風格文件檔名，`synth.py` 沒有改動（與最後一次產生及合併當時保存的腳本逐行比對；較早產生的三個主題是否出自同一版腳本無法查證）；沒有以現行腳本重新產生來核對輸出是否逐位元相同。`manifest.json` 的 `styleGuide` 欄位事後同步改為新檔名，
其餘內容與產生當時相同。

## 已知限制

- 撥弦類音色與小鼓、hi-hat、雪橇鈴仍聽得出合成感。
- 循環接點依賴解碼器遵守 pre-skip 與結尾裁切。
- 多台車同時播放 `sfx-motor-loop` 時，程式端已錯開各聲源的起始位置；速率彼此很接近時仍聽得到拍頻。
