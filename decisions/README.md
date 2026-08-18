# 決策記錄（ADR）

> 本目錄收錄專案的架構決策記錄（MADR 中文化）。分工鐵則：**canon 各檔寫「現況是什麼」、決策檔寫「當初為什麼」、[歷史記錄.md](../歷史記錄.md) 維持全量流水帳**——三者互不重複。流水帳條目升格為決策檔時，原條目僅補 ID 引用、內容不動。

## 鐵則

1. **不可變**：`status: accepted` 的決策檔**本文**（背景／選項／決定／後果）不再修改。改變決策 ＝ 建新檔 `supersedes` 舊檔。frontmatter 的關聯性 metadata（`superseded_by`／`amends`／`sources`／`files`／`vectors`／`deprecates`）允許回填與更正——它們描述「這份決策與什麼相關」，不是決策本身；錯字修正同樣允許。若後續 ADR 只部分修訂舊檔，可在舊檔 H1 後加入一段**關聯追補**，但不得改寫原四節。
2. **不與 canon 重複**：決策檔寫背景、選項、取捨、後果；現況規格細節一律連結 canon，不重述。
3. **引用紀律**：決策檔全檔禁用 `§`；跨檔引用一律使用檔級連結，需要章節資訊時在連結文字寫「第 N 節」。

關聯追補固定緊接 H1，首行格式為 `> **YYYY-MM-DD 關聯追補**：…`，續行仍使用 blockquote。日期必須等於所連結後續 ADR 的日期；後續 ADR 的 `amends` 或 `supersedes` 也必須回指本檔。追補只能說明原決策哪些部分後來被修訂或取代，不得新增決策、改寫當時理由或充當現況 canon；`check:decisions` 會驗格式、時間順序與反向關係。

## 檔名與 frontmatter

檔名 ＝`D-YYYYMMDD-nn-<中文短題>.md`（決策日期 ＋ 當日序號；一個獨立決策一檔）。

| 欄位 | 說明 |
|---|---|
| `id` | 與檔名前綴一致的 `D-YYYYMMDD-nn` |
| `date` | 決策日期 |
| `status` | `accepted`｜`superseded` |
| `supersedes` | **完整取代**的舊決策 id 陣列（目標檔必為 `superseded`） |
| `superseded_by` | 被完整取代時填新決策 id，否則 `null` |
| `amends` | **部分修訂／細化**的目標 id 陣列（目標維持 `accepted`） |
| `domains` | 所屬域（合法值與順序的機器權威見 `scripts/domains.mjs`） |
| `sources` | 歷史記錄來源條目（「日期＋標題前段」純文字、不含 § 字符）——**字面前綴**，不是縮寫或工作階段名 |
| `files` | 決策發生時的主要影響檔；安全、正規化的 repo-relative 歷史路徑，不要求目標現況仍存在 |
| `vectors` | 相關 conformance family ID（例如 `ledger/signing-digest`）；每個 ID 必須恰好解析到一份向量檔 |
| `deprecates` | 本決策明確移除、改名或取代的具名契約；每份 ADR 必填，無項目時為 `[]` |

陣列一律 JSON 形（雙引號）。被取代的早期模型若早於決策檔制度（2026-07-24 首批升格前），於本文註明「取代 spec 舊模型（無前 ADR）」、不補建舊檔。

`files` 是歷史影響識別，不是現況存活性宣稱：路徑必須非空、不重複，使用 `/`，不得含絕對
路徑、磁碟機前綴、反斜線、`.`／`..` segment 或未正規化片段；檔案後來移除仍保留原值。
`vectors` 只寫向量 JSON 內的穩定 `family`，不得填 `conformance/*.vectors.json` 實體路徑；
`check:decisions` 會確認 family 格式、唯一性，以及整個 conformance corpus 中恰有一份相符向量檔。

`deprecates` 每項固定為 `{"item":"…","kind":"removed|renamed|replaced","replacement":…}`。
`removed` 的 `replacement` 必須為 `null`；`renamed`／`replaced` 必須寫非空取代方式。同一 ADR
不得重複 `item`。只登錄「決定」明確裁撤的具名 schema、欄位、型別、route、常數、協議或架構模型；
不從本文關鍵字猜測，也不登錄被否決選項、一般實作動作或單純後果。完整生成表見
[INDEX.md](INDEX.md) 的「廢止與改名索引」。

`sources` 與歷史記錄的關係是**雙向**的，兩側都由 `check:decisions` 看守：每筆 `sources` 必須是某條歷史條目標題的字面前綴、且在該日條目中唯一（撞名時補長到可區分為止）；反過來，被 `sources` 指到的條目也必須以「決策檔」行回引該 id。一次裁決若吸收了多條流水帳條目——例如次級候選依裁決併入既有決策——**每一條都要列進 `sources`**，不得只留條目端的單向引用。

`sources` 值與 ADR 本文裡的 `issue 000xxx` 是維護者內部 issue registry（`open-4wd-workflow` repo）的六位數編號，隨歷史條目標題字面帶入；公開讀者目前無法對照，該 repo 依專案生命週期發布鏈末段公開後即可解析。編號只作追溯線索，不是 ADR 的權威來源（圖例同 [歷史記錄.md](../歷史記錄.md) 檔頭）。

首頁專案沿革的 `importance` 不是 ADR metadata；它只以 `<!-- homepage-milestone importance=N -->`
存在於入選的每日歷史條目。未入選 ADR 維持原狀，不補 `importance: null`、`0` 或空欄位。ADR
日後被取代也不會自動刪除歷史里程碑，因為 marker 描述事件在當時的重要性，不代表現行效力。

## 驗證與索引

`pnpm check:decisions`（[scripts/check-decisions.mjs](../scripts/check-decisions.mjs)）驗證：frontmatter 可解析、id 唯一且同檔名、status 鏈雙向一致（`supersedes`↔`superseded_by`）、`amends` 目標存在、domains 合法、`deprecates` 結構、`sources` 唯一解析且與歷史記錄回引雙向一致；歷史記錄側另驗決策檔連結可解析（歷史檔全面豁免於 `check:refs`，只能在此補檢）。月份／每日結構與生成索引由 `pnpm check:history` 驗證；[INDEX.md](INDEX.md) 由決策檢查腳本的 `--write-index` 生成（廢止與改名索引＋依域分組）。

首批 106 筆源自 2026-07-24 歷史記錄 [§1](../歷史記錄.md#1-重大重構里程碑) 全量升格裁決（候選 120、🔹14 依裁決併入或維持流水帳）。
