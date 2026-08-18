---
type: impl
domain: ["UGC版權"]
summary: mesh 指紋／相似度搜尋／上傳期 pending／爭議路由
authority: null
slug: null
---

# anti-piracy（mesh 指紋 / 相似度 / 仲裁實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/anti-piracy.md](程式流程/anti-piracy.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：反複製的**實作層** —— mesh 指紋（geometric，**≠ ugc-fork 的物理指紋**）、標準化演算法、相似度搜尋、上傳 UX 整合、爭議路由（仲裁投票歸 [moderation.md](moderation.md) 純仲裁，本模組只提供相似度證據——[§5](#5-爭議仲裁走標準純仲裁無獨立投票系統)）。
> 設計與五層防護見 [版權.md §5](../版權.md)（[§5.2.1](../版權.md#521-標準化與鏡像偵測演算法) 標準化、[§5.3](../版權.md#53-第三層similarity-threshold) 相似度門檻、[§5.4](../版權.md#54-第四層檢舉仲裁) 檢舉 ＋ 仲裁）。對應 `src/anti-piracy/`。**相似度判定門檻以 [版權.md §5.3](../版權.md) 為準**（≥90% 拒收 / 70–90% `similarity-pending` 經濟隔離待仲裁 / <70% 通過）。

## 1. MeshFingerprint

```typescript
interface MeshFingerprint {
  primary: string; // 標準化後完整 SHA-256
  features: {
    // 特徵向量（相似度快篩用）
    vertexCount: number;
    volume: bigint;
    surfaceArea: bigint; // 量化整數
    aabbDims: [number, number, number];
    barycenter: [number, number, number];
    pcaAxes: [Vec3, Vec3, Vec3];
    isMirror: boolean;
  };
  lshSignature?: Uint8Array; // 擴充候選
}
```

## 2. 標準化演算法（決定性 TypeScript `src/anti-piracy/canonicalize.ts`；實作即權威、綁 `fingerprintVersion`）

`canonicalize(mesh)` 八步驟，消除「平移 / 旋轉 / 縮放 / 鏡像 / 索引順序」差異。共識值（收件端逐對重算比對）＝ 全程僅 IEEE 基本運算 ＋sqrt（正確捨入）＋ 固定迭代次序——WASM 化屬效能選項、輸出必須與 TS 逐位一致：

1. 平移到原點（頂點重心 → (0,0,0)）
2. PCA 主軸對齊：共變異 → **tan 公式化 cyclic Jacobi**（零反三角、固定 sweep 次序與輪數）→ 特徵值降冪。特徵向量正負號無法穩定定向（依輸入座標 ＝ 非旋轉不變、依形狀統計 ＝ 對稱形恆平手）→ **窮舉四種正負號組合**（第三軸 ＝cross ⇒ 恆正旋轉）各跑完 3–7 步、取序列化字典序最小者 ＝canonical 形（旋轉不變且全定）
3. **鏡像偵測**：`signed_volume < 0` → **翻 X 軸即完成翻正**（反射使體積轉正、winding 隨之恢復外向；翻軸後不得再反轉 winding，否則體積會回負）。偵測錨 ＝winding：positions 鏡射且未修 winding 的鏡像品在此撞回原 hash；有修 winding 的鏡像品體積為正、不入此路（由特徵相似度 ＋ 事後檢舉承接，[版權.md §5.2.1](../版權.md)）
4. 縮放到單位立方體（最長軸 → 1）
5. 整數量化（座標 → u16，避免浮點微差）
6. 頂點按 (x,y,z) 字典排序 ＋ 去重（u16 相等 ＝ 幾何同點）
7. 三角形拓樸用排序後索引重新編碼（逐面循環旋正 ＝ 最小索引在前保 winding、面列表字典排序）
8. 節點名稱排序

`compute_fingerprint(canonical)` = `SHA-256(vertices ‖ triangles ‖ nodeNames)`（顯式 little-endian 序列化——TypedArray.buffer 依平台端序 ＝ 共識雜湊禁忌）。退化情況（完美球體無 PCA 主軸、相對差 < 1e-9）→ fallback 固定座標軸 + 旗標提示。ESLint 共識決定性防線涵蓋 `src/anti-piracy/`。

## 3. 相似度搜尋（`src/anti-piracy/similarity-index.ts`）

```typescript
async function findSimilar(fp: MeshFingerprint, ledger): Promise<SimilaritySearchResult> {
  const exact = await ledger.findByPrimaryHash(fp.primary);           // 完全相同
  if (exact) return { type: 'exact-match', existing: exact };
  const candidates = await ledger.queryByFeatureBucket({              // 特徵分桶快篩（vertexCount ±10% / volume ±10%）
    vertexCountRange: [...], volumeRange: [...] });
  const sims = candidates.map(c => ({ candidate: c, similarity: computeFeatureSimilarity(fp.features, c.features) }));   // 公式權威＝算式表.md §21（五維 max、ppm 整數、綁 fingerprintVersion）
  // 門檻依 版權 §5.3：≥0.90 拒收 / 0.70–0.90 仲裁 / <0.70 通過
  const reject = sims.filter(s => s.similarity >= 0.90);
  const arbitrate = sims.filter(s => s.similarity >= 0.70 && s.similarity < 0.90);
  if (reject.length) return { type: 'reject', matches: reject };
  if (arbitrate.length) return { type: 'arbitrate', matches: arbitrate };
  return { type: 'pass' };
}
```

**索引實體**：`MeshFingerprintIndex` 是本機雙層記憶體索引。鏈上 `UGCMetadata.meshFingerprint`（出口 B 上傳時寫入，[ugc-fork.md §1](ugc-fork.md)）是**不可信 discovery hint**，只可用來挑選少量待驗 CID；`findByPrimaryHash`、`queryByFeatureBucket`、exact／高相似硬擋與 fork parent 建議只讀「已取得完整 CID GLB、通過大小／解析資源上限並重算」的 verified entries。惡意自報值最多觸發有界候選取得，不能直接評分或污染硬性索引；缺塊、壞檔或資源預算不足維持 unverified。

採混合按需驗證，不要求 client 下載全 catalog：UGC 成功下載使用、上傳查詢命中 hint、背景閒置驗證或遭檢舉時可升級 verified；現行接線至少涵蓋下載使用、候選命中與檢舉。舊事件無 hint 仍可在下載／檢舉時直接由 CID GLB 建立 verified entry。分類收斂單一實作 `classifySimilarity`（[§5.1](#51-similarity-pending灰區立即上鏈經濟隔離) 防鹽化分層 ＋ 活躍作品優先）；provider-scoped DMCA 案件只約束該 provider 的供應出口，不注入 client-wide similarity classifier。宣告收件驗證同樣只信 GLB 重算值（[§5.1](#51-similarity-pending灰區立即上鏈經濟隔離)）。此策略不保證上傳當下發現尚未被任何節點驗證的作品；遺漏仍由事後檢舉承接，避免以全目錄暖取換取不可接受的頻寬／儲存成本。

## 4. 上傳 UX 整合

```typescript
async function handleUpload(file, user, copyright, asFork, parentCid): Promise<UploadResult> {
  const fp = await physics.computeMeshFingerprint(...);
  const r = await findSimilar(fp.value, ledger);
  switch (r.type) {
    case 'exact-match': return error('與既存作品完全相同，請走 fork');
    case 'reject':      // ≥90%：任一 match 為活躍作品 → 拒收（無獨立申訴案型）
                        // 正主救濟＝report-match 引導檢舉命中對象（仲裁下架後再上傳降級 pending，moderation.md §5.7）
                        // 全部 ≥90 match 皆為「仲裁判抄下架」→ 降級走 pending（防鹽化占位，§5.1 分層規則）
      if (allRejectMatchesArbitrationBlacklisted) return warn({ message: '相似對象皆已判抄下架——可立即上鏈（經濟隔離待審）', options: ['upload-pending', 'cancel'] });
      return asFork ? uploadAsFork(...) : warn({ message: `與 …高度相似`,
                          options: matchTakenDown ? ['report-match'] : ['fork', 'report-match'] });            // 已下架對象不給 fork 選項（版權.md §4）
    case 'arbitrate':   return warn({ message: '中等相似度——可立即上鏈（經濟隔離待審）或改走 fork',            // 70–90%：similarity-pending（§5.1）；無「先上鏈拿全權益」的路
                          options: matchTakenDown ? ['upload-pending', 'cancel'] : ['upload-pending', 'fork', 'cancel'] });
    case 'pass':        return uploadFinal(...);
  }
}
```

> mesh 指紋（防複製）與 ugc-fork 的**物理指紋**（fork 判定）是兩套獨立機制：前者比幾何外觀、後者比物理行為（質量 / 重心 / 慣量）。

## 5. 爭議仲裁（走標準純仲裁，無獨立投票系統）

上傳期與事後爭議**皆走標準檢舉仲裁**（隨機 7 位合格仲裁者、quorum 4 有效票、加權 > 60%，[moderation.md §5](moderation.md)）——**無「全社群投票」平行系統**（開放投票易被串謀，正是 [信譽系統.md §2.4](../信譽系統.md) 純仲裁裁定要排除的形狀）。本模組只提供**相似度證據**（指紋比對報告附入 evidence），檢舉 / 投票 / 結果套用全用 moderation 模組。

| 情境                                     | 案件形式                                                                                                                                                                                                             | 結果                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上傳期灰區（70–90%，選「立即上鏈待審」） | **上鏈並標 `similarity-pending`**（案錨 = 上傳事件的相似宣告、自動開案；無檢舉者、無 reporter delta）；雙方可附 statement                                                                                            | 判非抄 / **流局** → 解除隔離、經濟開始（審查期不補發）；判抄 → **下架**（`BlacklistEvent`、**不扣信譽**——灰區可能是撞衫；與事後檢舉 −100 分開）           |
| ≥ 90% 命中盜版（正主救濟）               | **組合既有機器**：①標準檢舉命中對象（違反版權）→ 仲裁下架；②再上傳——對判抄下架品的 ≥90 命中依 [§5.1](#51-similarity-pending灰區立即上鏈經濟隔離) 分層降級 pending、走上傳期案（[moderation.md §5.7](moderation.md)） | ①成立 → 對方 `BlacklistEvent` + 作者 −100；②判非抄 / 流局 → 經濟開始（逐位元相同 mesh 不可復刻上鏈——exact 硬擋＋原 CID 已黑名單，需有實質差異的重新輸出） |
| 事後盜版爭議（換皮躲過指紋、被人發現）   | 標準檢舉（違反版權（含剽竊）、target = 對方 CID）；被檢舉方可附應訴 statement                                                                                                                                        | 成立 → 該 CID `BlacklistEvent` + 作者 −100（`copyright-violation`）；不成立 → 雙方保留（共存）、進檢舉者準確率統計                                        |

事後案仲裁期間作品標「審議中」、仍可用（無預審下架）。濫訴只由標準 `malicious-reporter` 三條件處理（[信譽系統.md §4.3](../信譽系統.md)）；發起案件與案件落敗本身都不扣信譽。

### 5.1 similarity-pending（灰區立即上鏈＋經濟隔離）

「可以玩」與「可以賺」拆開——玩即時、錢等裁決：

- **可玩不可賺**：pending CID 可組裝 / 比賽 / 展示（詳情頁標「相似度審查中」），但 settlement 端過濾——**royalty 不鑄、usage 統計不記**（與黑名單 / 退役同一過濾點，[economy.md §2 / §4](economy.md)）；**不可被評分**（[ugc-rating.md §4](ugc-rating.md)）、**不可被 fork**（待審結）、**對其之版權檢舉拒收**（已有審理中案，[moderation.md §4](moderation.md)）。
- **pending = 純 derive**：`UgcUploadEvent` 含非空 `similarityMatches` 宣告 → 自動開上傳期仲裁案（無獨立事件，[moderation.md §5.7](moderation.md)）；解除 = 該案 `ArbitrationResultEvent`（判非抄 `reject` 或流局 `no-quorum`，[moderation.md §5.3](moderation.md)）。
**〔UGC-R-005〕** similarity-pending 必須限制同一上傳者的同時待審量與判抄安全港使用次數，並依作品狀態分層相似度處置。

- **同時待審上限**：`UPLOAD_PENDING_MAX_PER_UPLOADER`（3，[protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽)）——超限只能 fork / 取消 / 等待（防灰區量產燒仲裁注意力，與檢舉端 `REPORT_OPEN_MAX_PER_REPORTER` 同構）。
- **已下架分層（防鹽化占位）**：對**仲裁判抄下架**（on-chain `BlacklistEvent`）作品的相似命中——**任何 % 皆至多 pending、永不硬擋**。理由：判抄作品指紋若保留硬擋力，鏈式 70% 變體（A1→A2→A3 各判抄）可把 ≥90% 封鎖區延伸到離原作任意遠、且灰區不罰 ＝ 零成本製鹽，最終誤殺真原創。任一 ≥90 match 為活躍作品才拒收。Provider-scoped DMCA 案件不形成 client-wide classifier input、use-gate 或公開詳情狀態（[dmca.md §3.1](dmca.md#31-provider-scoped-簽章收件匣)）。
- **安全港次數閘（斷鹽鏈）**：同一上傳者 rolling `UPLOAD_PENDING_SUSPEND_DAYS`（30）內上傳期**判抄達 `UPLOAD_PENDING_SUSPEND_STRIKES`（3）** → pending 通道暫停 30 天（灰區上傳僅剩 fork / 取消；**< 70% 原創上傳不受影響**）。純 derive（數其上傳期案 `pass` 結果）、不動信譽——安全港留給誠實撞衫者、但非無限次。
- **收件驗證 = 驗宣告真實性、不驗完備性**：宣告的每筆 match 逐對重算相似度（整數特徵、決定性）；重算前置的 GLB 解析走 **Sanitize Worker 隔離**（[../資安規範.md §2.4](../資安規範.md)）、GLB 未同步或解析失敗 → **暫緩排隊、有界重試**（比照 [ledger-admission.md §1](ledger-admission.md) settlement base 模式）非拒收；宣告含 ≥ 90% match（對活躍作品）→ 拒收；上傳者處於 pending 暫停期 → 灰區宣告上傳拒收。完備性**不驗**——收件端索引瞬時不同、驗完備會 split；隱匿宣告的抄襲由**事後檢舉**承接（**安全港誘因**：誠實宣告最壞判抄只下架不罰 vs 隱匿被抓 −100＋ 三振——守規矩的路比作弊便宜、機制自我執行）。
- 判抄下架 = 寫 `BlacklistEvent`（`triggeredBy` = 本案結果事件）；經濟零外洩（審查期本就未鑄）。**fold 守門**：`blacklist-cid` reducer 套用前須確認 state 內存在一筆 `result === 'pass'` 且 `target === cid` 的仲裁結果、否則整筆 no-op——收件驗證擋不住歷史 append（任一 peer 可用舊時戳條目直達 fold），無此守門則任何人一筆事件即可全網下架任意 UGC（見 [ledger.md §6.1](ledger.md) foldGuard 目錄）。此守門的信任根是仲裁結果本身的 fold 驗證（面板簽章集硬化，[moderation.md §5.6](moderation.md)）。抄襲者無誘因走此道：**fork 嚴格優於 pending 賭局**（fork 立即領 70%、pending 審查期零收入且判抄歸零）。

## 6. 信譽加權（[版權.md §5.4](../版權.md)）

加權直接用 `reputation.md [§6.1](reputation.md#61-仲裁投票權重)` 的 `arbitrationVoteWeightX100`（整數預算表；公式權威 [算式表.md §17](../算式表.md)，**共識計算禁浮點 log10**）——本模組不另實作 weight 函數。

合格仲裁者信譽 ≥ 200 → 面板內 weight ∈ [2.32, 3.00]（差距 ≤ 1.29×，近似人頭）、無大戶獨裁。

## 7. fingerprintVersion

算法升級時舊作品不重算、只同版本間比對、跨版本 `pass`（不誤殺）。詳見 [版權.md §5.2.2](../版權.md) 與 [程式架構/ugc-fork.md §7](ugc-fork.md)。
