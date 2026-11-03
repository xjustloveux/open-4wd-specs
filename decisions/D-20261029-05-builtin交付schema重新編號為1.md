---
id: D-20261029-05
date: 2026-10-29
status: accepted
supersedes: []
superseded_by: null
amends: ["D-20261022-01"]
domains: ["版本部署"]
sources: ["2026-10-29 ─ builtin 交付 schema 重新編號為 1（issue 001062）"]
files: ["程式架構/builtin-assets.md", "scripts/prelaunch-current-version-authorities.json"]
vectors: []
deprecates: [{"item":"builtin-delivery.json schema 2 候選名稱","kind":"replaced","replacement":"按 tracks／parts 分類型交付的唯一 schema 1 current shape"}]
---

# D-20261029-05｜builtin 交付 schema 重新編號為 1

## 背景與驅動力

[D-20261022-01](D-20261022-01-公版場地程序化交付與零件維持延後.md) 為了表達「場地已交付、零件延後」，把 `public/assets/builtin-delivery.json` 從全域單一狀態改成按 `tracks`／`parts` 分類型，並把它命名為 schema 2。專案仍在 `pre_launch`，[專案生命週期.md](../專案生命週期.md) 規定 Open4WD 自有的 schema、manifest 與 asset current baseline 一律維持 `1`，內部候選改用 `candidate_epoch`、digest 或 revision，不為未公開的中間版本建立 migration、dual-read 或相容 shim；[D-20260814-24](D-20260814-24-Pre-launch自有版本統一v1.md) 也要求 CI 依機器可讀的 authority 清單守住這條規則。

舊的全域單一狀態形狀從未隨公開 client 或公開 Release 發布，沒有任何相容對象。2026-10-28 複驗退回 issue 001062，指出 D-20261022-01 在 `pre_launch` 期間把 manifest 升到 2，違反上述規則。這個 manifest 的版本值當時也不在 authority 清單內，所以 CI 沒有擋下來。

## 考慮過的選項

- 維持 schema 2，在 canon 與守門上承認它：把一個從未公開的中間形狀誤寫成公開歷史，與生命週期規則直接衝突（否決）。
- 保留 schema 1 讀取層，同時接受 schema 2：沒有相容對象，只增加無效分支與驗證面（否決）。
- **把現行按類型交付的完整形狀定為 schemaVersion 1，並把此值納入 authority 清單（採納）。**

## 決定

- 依 `pre_launch` 規則，`public/assets/builtin-delivery.json` 按 `tracks`／`parts` 分類型的現行形狀就是 `schemaVersion: 1`。D-20261022-01 所稱「schema 2」只是從未公開的候選名稱，現由這個唯一的 schema 1 current shape 取代。
- D-20261022-01 的功能內容全部保留：分類型交付、各自的 `PROVENANCE.md`、strict／release 要求兩類都 `delivered`、需要整車與只需場地的測試分別要求、E2E required coverage 以任一類延後判定授權 skip，以及 256 KiB root extras 上限、程序化來源與 `authoring-text.zip` 等其餘決定。
- 不保留任何相容層。舊的全域單一狀態形狀沿用 exact-key 結構檢查拒收，訊息描述形狀而不稱它是某個版本；未知版本（例如 `schemaVersion: 2`）同樣拒收，這類 fixture 不屬於 current baseline。
- 守門：`builtin-delivery.json` 的 `schemaVersion` 納入 main 的 `prelaunch-version-authorities`（以單一 JSON pointer 純量值模式檢查），受檢 authority 由 24 項增為 26 項；specs 的 current authority 清單同步宣告 canon 的 schema 1 交付權威，並禁止 current canon 再出現該 manifest 的 schema 2 以上寫法。決策檔與歷史記錄依既有規則排除。
- 現況規格見 [程式架構/builtin-assets.md](../程式架構/builtin-assets.md)。

## 後果與影響

- main 的 manifest、讀取與驗證腳本、型別宣告與測試 fixture 重新編號為 1，canon 只寫現況；依賴 parser 取值的消費者不寫死版本數字，不需改動。
- 本機沒有舊 schema 2 檔案以外的資料需要遷移；`pre_launch` 階段直接改，不需 reset 流程以外的處置。
- 與既有決策的關係：
  - amends [D-20261022-01](D-20261022-01-公版場地程序化交付與零件維持延後.md)：其「決定」第 1 項的 schema 2 改以 schema 1 current shape 理解，其餘功能內容不變；該檔 frontmatter 的 `deprecates` 仍保留原文供稽核，不回寫。
  - D-20261022-01 的 H1 之後加註一段說明指回本決策，說明 schema 2 僅是候選名稱、現行為 schema 1；格式比照 D-20261029-03 對 D-20261029-04 的加註，原四節不改寫。
  - 與 D-20260814-24 一致：本決策是把該決策的 authority 清單原則套用到 builtin 交付 manifest，不另立例外。
- 當日歷史記錄已補條目並回引本決策。

## 定案紀錄

2026-10-29 使用者審閱草稿後同意採納：按類型交付的現行形狀定為 schemaVersion 1，D-20261022-01 的功能內容全部保留，不設相容層，並把 `builtin-delivery.json` 的版本值納入 authority 清單。
