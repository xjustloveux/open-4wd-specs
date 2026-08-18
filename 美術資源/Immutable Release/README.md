---
type: art
domain: ["前端主題", "版本部署"]
summary: Authoring 大型原始資產的兩階段 immutable Release 操作手冊
authority: decisions/D-20260818-01-Authoring大型原始資產Release-first.md
slug: null
---

# Immutable Release

大型 authoring master 的唯一長期權威是 `open-4wd-specs` 的 immutable GitHub Release。這個資料夾只保存操作說明；真正投遞目錄是 repo 根的 `release-input/`，產物在 `release-output/`，兩者均被 Git 忽略。

## 資料分類

| 內容                              | 位置／Release 形式                                                                       | 是否進 Git   |
| --------------------------------- | ---------------------------------------------------------------------------------------- | ------------ |
| 提示詞、規格                      | `美術資源/提示詞/`                                                                       | 是           |
| 小型 WebP、SVG、favicon、審查預覽 | 既有分類目錄                                                                             | 是           |
| GLB master                        | `release-input/parts/`、`release-input/tracks/`；Release 逐檔扁平上傳                    | 否           |
| 高解析／無損 PNG                  | GLB 審查圖放 parts／tracks；UI 母圖放 `release-input/ui/`；封裝為 `authoring-images.zip` | 否           |
| WAV／FLAC master                  | `release-input/audio/`；封裝為 `authoring-audio.zip`                                     | 否           |
| runtime 最佳化資產                | `open-4wd` runtime manifest 所在目錄                                                     | 不回存 specs |

GLB 的 basename 在整批輸入內必須唯一；ZIP 保留相對於 `release-input/` 的邏輯路徑。其他副檔名會 fail closed。封裝採固定順序、時間戳與 store-only ZIP，方便同一輸入重現完全相同 bytes。

目前投遞結構如下；同一資產的 GLB、選定參考 PNG 與四視角檢查圖維持相鄰，避免平行的格式樹
拆散審查上下文：

```text
release-input/
├── parts/
│   └── <part-id>/
├── tracks/
│   └── <track-id>/
├── audio/
│   ├── vehicles/
│   ├── tracks/
│   ├── ui/
│   └── music/
└── ui/
    ├── themes/{default,moon-rabbit}/
    ├── race-messages/{default,moon-rabbit}/
    ├── race-countdown/{default,moon-rabbit}/
    └── social/og/
```

## 第一階段：離線準備與審查

1. 確認所有原始備份仍可讀，並確認這次 payload 已依 parts／tracks／audio／ui 分類放入 `release-input/`；WAV／FLAC 音訊 master 一律進 `audio/`，再按 vehicles／tracks／ui／music 語意分類。
2. 確認 `release-output/` 不存在或為空；舊產物要人工移到另一個備份位置，不可覆寫。
3. 執行 `prepare-authoring-release.bat`。它不連網、不安裝工具、不修改 Git，只產生 Release assets、`authoring-release-manifest.json` 與 `SHA256SUMS`。
4. 審查 manifest 的 logical path、Release asset mapping、size、SHA-256、source commit 與 exact tag；每個 GLB input 還必須帶有受版控 source manifest 的相同 `assetId`，且 GLB 集合必須 exact match。必要時由第二人重跑並比較全部 bytes。

準備失敗時保留 `release-input/` 原檔，將不完整的 `release-output/` 移到隔離位置後修正輸入再重跑。不可在失敗產物上手改 manifest 或 checksum。

## 第二階段：Draft、下載回讀與不可變發布

1. 先 commit 準備工具與契約，確認工作樹乾淨、HEAD 就是 manifest 的 source commit，並完成 `gh auth login`。
2. 執行 `publish-authoring-release.bat`。工具驗證 auth／origin／HEAD，建立 exact tag 的 Draft，補傳缺少的 assets，下載回讀每個檔案並逐一比對 SHA-256；它只留下 Draft 與本機 receipt，不會直接發布。
3. 在 GitHub UI 複核 Draft 名稱、資產、manifest 與 checksum。確認 repository 已啟用 immutable releases。
4. 以工具顯示的 tag 作逐字確認，再執行：`publish-authoring-release.bat -Publish -ConfirmImmutablePublish '<exact-tag>'`。只有完全相同的確認值才會把已回讀驗證的 Draft 發布。

Main 採用時不得只相信 tag 名稱：dependency lock 同時鎖 specs exact commit、
`authoring-source-<commit 前 12 碼>` tag、source manifest fingerprint／檔案 SHA-256 與 Release
manifest SHA-256；adoption gate 會重驗 manifest source commit、GLB `assetId` exact join、Release
asset 集合、size／SHA-256 與 `SHA256SUMS`。任一欄不一致都不得執行 production Editor journey。

上傳或下載回讀失敗時，Draft 保持未發布；保留原始備份與 `release-output/`，檢查網路／權限後重跑。工具拒絕未知 asset、不同 target 或非 Draft，避免接手不相容狀態。`.readback` 已存在時先人工保存或移開，避免舊回讀被誤認為本次證據。

## 備份移除門檻

只有 immutable Release 已發布、下載回讀全部通過、`publish-receipt.json` 已另行備份，且 main 已依 manifest 成功採用，才可考慮移除工作站大型原始備份。任一條件未滿都保留備份。舊 Git LFS 工作樹內容在首次 Release 完成前只視為過渡備份；未來重建 specs repo 時不得再放回 Git。
