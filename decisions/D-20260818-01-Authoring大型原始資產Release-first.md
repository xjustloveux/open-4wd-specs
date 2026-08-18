---
id: D-20260818-01
date: 2026-08-18
status: accepted
supersedes: ["D-20260815-01"]
superseded_by: null
amends: ["D-20260811-17"]
domains: ["版本部署", "治理營運"]
sources: ["2026-08-18 ─ Authoring 大型原始資產 Release-first（issue 000658）"]
files: ["美術資源.md", "美術資源/Immutable Release/README.md", "程式架構/builtin-assets.md", "程式架構/testing.md", "專案生命週期.md"]
vectors: []
deprecates: []
---

# D-20260818-01｜Authoring 大型原始資產 Release-first

## 背景與驅動力

原設計讓 specs Git LFS 保存大型 authoring bytes，再由 Release 分發。LFS 儲存與流量額度會影響同一帳務範圍的其他專案；開源歷史又不適合在額度不足時任意刪除。專案仍在 pre-launch，且 specs 預計重建，因此不保留未公開的 LFS owner 模型。

## 考慮過的選項

- 維持 Git LFS＋Release 雙層保存：成本風險仍跨專案傳播，否決。
- 只保留本機工作站原檔：無不可變公開證據、CI 無法重現，否決。
- immutable GitHub Release 作大型 master 唯一權威，Git 只保存規格、manifest 與小檔（採納）。

## 決定

- GLB、高解析／無損 PNG、WAV／FLAC 等大型 authoring master 不進 Git LFS 或一般 Git blob；immutable GitHub Release 是唯一長期 bytes 權威。`release-input/` 只是不受版控的本機投遞區。
- Git 可保存提示詞、審查預覽、資產清單與小型 WebP／SVG／favicon。main 擁有最佳化 runtime assets；不得把 runtime 成品反向當成 specs source master。
- Release 採扁平 asset namespace：basename 唯一的 GLB 逐檔上傳，PNG 與音訊分別進保留邏輯路徑的 deterministic ZIP；manifest 綁 source commit、exact tag、logical path、asset mapping、size 與 SHA-256。
- 受版控的 `prepare-authoring-release.bat` 只離線驗證與封裝，然後停下供審查。`publish-authoring-release.bat` 驗 auth／origin／HEAD，先建立 Draft、上傳並下載回讀；只有 exact tag 明確確認後才發布 immutable Release。
- 兩支工具不得安裝依賴、保存 token，或執行 `git add`／`commit`／`push`／`tag`。任何失敗都保留 Draft、輸入與原始備份，不自動清除或覆寫。
- 大型備份只有在 immutable Release 發布、完整下載回讀、receipt 留存且 main adoption 成功後才可移除。repo 重建前的既有 LFS bytes 只作過渡備份，不再構成權威。

## 後果與影響

日常 clone 不依賴 LFS 額度，大型 authoring bytes 的權威與公開分發合一；prepare／publish 的人工邊界可審查且可復原。代價是維護者必須管理本機輸入備份、GitHub CLI 身分、Draft 複核與 immutable 發布確認，main adoption 也必須從 Release manifest 驗證來源。
