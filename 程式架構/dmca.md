---
type: impl
domain: ["信譽仲裁", "UGC版權"]
summary: Notice／Counter 表單／黑名單檢查／下架・恢復・repeat-infringer
authority: null
slug: null
---

# dmca（DMCA 流程實作）

> **本檔角色**：DMCA 的**實作層** —— 每個 pinning provider 自己的 Notice / Counter-Notice schema、私有案卷、下架 / 恢復 / Repeat Infringer 與簽章 uploader inbox。
> 設計與流程見 [版權.md §6（DMCA）/ §7（文字黑名單）/ §9（下架）](../版權.md) 與 [DMCA.md](../流程/DMCA.md)。對應 `src/dmca/`。
> **後端 API 自架在各 `open-4wd-pinning` 部署**（非 P2P 共識路徑）。案件與動作只約束該 provider 自己控制的供應出口；**無 multisig、無官方或全域 DMCA authority**，此層可用伺服器時鐘。

## 1. 表單 schema

```typescript
interface DMCANotice {
  // 著作權人（必填）
  claimantName;
  claimantEmail;
  claimantPhone;
  claimantAddress;
  claimantOrganization?;
  isAuthorizedAgent: boolean;
  agentName?;
  agentRelationship?;
  copyrightedWork: {
    title;
    type: "character" | "design" | "name" | "logo" | "music" | "other";
    registrationNumber?;
    descriptionOfWork;
    dateOfFirstPublication?;
  };
  infringingContent: {
    type: "part" | "track" | "audio" | "creator-profile";
    cid;
    url;
    creatorPeerId?;
    description;
  }[]; // 'part' 涵蓋全部零件 type
  goodFaithStatement: boolean;
  perjuryStatement: boolean;
  signature;
  signatureDate; // 法律聲明（必勾）
  submittedAt;
  ipAddress?;
  userAgent?; // ip/ua 僅伺服器側保存、不公開
}

interface DMCACounterNoticeV1 {
  schemaVersion: 1;
  uploaderName;
  uploaderEmail;
  uploaderPhone;
  uploaderAddress;
  originalNoticeId; // 系統自動帶
  takenDownContent: { cid; url; description }[];
  goodFaithMistakeOrMisidentification: true;
  perjuryStatement: true;
  federalDistrict;
  acceptsServiceFromClaimant: true;
  signature;
  signatureDate;
  submittedAt;
}

type CounterNoticeSubmissionV1 =
  | { mode: "signed-uploader"; signed: SignedWire<DMCACounterNoticeV1> }
  | { mode: "manual-review"; payload: DMCACounterNoticeV1 };
```

反通知不接受表單自報 PeerId。`signed-uploader` 的 signer 必須是該 provider 下架前保存的
全部 affected CID 原上傳者；驗簽成功即受理。沒有該私鑰或 metadata 無法一致對應時，使用
`manual-review`，案件停在 `pending-identity-review`，維運者明確 accept 後才設定
`acceptedAt` 並起算等待期。兩種模式的法律 payload 完全相同，差別只在身分證明路徑。

## 2. 後端 API

| 端點                                                        | 用途                                                                                                                                                                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/dmca/notice`                                     | 提交 Notice → `{ noticeId(ULID), status:'pending-email-confirm' }`；claimantEmail 確認後保存可信 uploader metadata、自動 unpin／停止本 provider 供應並轉 `taken_down`，另通知私有維運信箱；暫時失敗保留 `received` 供 sweep 重試 |
| `GET /api/dmca/notice/:id`                                  | 查狀態 `DMCANoticeStatus`（`pending-email-confirm` / `received` / `taken_down` / `rejected_by_admin` / `restored_after_counter`）                                                                                                |
| `POST /api/dmca/counter-notice`                             | 嚴格接收 `CounterNoticeSubmissionV1`。可信原 uploader 簽章即回 `received` 與等待期；`manual-review` 回 `pending-identity-review`，尚不起算                                                                                       |
| `POST /api/dmca/inbox`                                      | 原上傳 PeerId 簽章查詢此 provider；回傳 provider 簽章的最小案件清單，不含通知雙方個資                                                                                                                                            |
| `GET /api/dmca/transparency`                                | 透明度報告（年度 notices / removed / counter / restored / repeatInfringersTerminated / topClaimants 去識別化）                                                                                                                   |
| `GET /api/dmca/admin/notices?status=&cursor=&limit=`        | **維運者**有界列案；只回 `DmcaAdminCaseSummary` 與下一頁 cursor，不回原始 payload、confirm token 或 decision reason                                                                                                              |
| `GET /api/dmca/admin/notices/:id`                           | **維運者**單案詳情 `DmcaAdminCaseView`；可回審查所需 PII 與 decision log，但永不回 confirm token                                                                                                                                 |
| `POST /api/dmca/admin/notice/:id/decision`                  | **維運者**裁決 `{ action: 'take_down' \| 'reject' \| 'restore' \| 'hold' \| 'release_hold', reason, evidence? }`；`hold` 必須附可驗證法院／CCB 程序證據；`restore` 只 re-pin 本地仍有 exact bytes 的 CID                         |
| `POST /api/dmca/admin/counter-notice/:id/identity-decision` | **維運者**只處理 `pending-identity-review`：`accept` 設定一次性的 `acceptedAt` 並啟動轉寄／等待期；`reject` 結案且不起算                                                                                                         |

**收件防濫用（兩支公開 POST 皆適用）**：per-IP rate limit（掛 pinning 管理 API 既有 token bucket 骨架、**於寄信之前**，[pinning-service.md §6](pinning-service.md)）＋payload 尺寸上限（逾限 413）。Notice 另有 email 確認關、同信箱冷卻與全域寄信速率上限；未確認 Notice 72h 自動清除。Counter-Notice 不寄確認信：簽章模式使用五分鐘 freshness 與 nonce 防重放，人工模式由私有 Admin 身分審查關卡承擔。CAPTCHA 不採用（第三方 script 違 CSP 自 host 鐵則，[../資安規範.md §4](../資安規範.md)）。

**Admin 安全契約**：`DMCA_ENABLE=true` 時 `DMCA_ADMIN_TOKEN` 必填，缺席即中止啟動，不得
生成無法交付維運者的隨機 token。所有 Admin API 先驗
`Authorization: Bearer <DMCA_ADMIN_TOKEN>`。營運者可再以 Tunnel／VPN／Access 身分與 MFA
隱藏管理面；外層保護不取代應用層 Bearer，人工裁決不開未經人員驗證的 bypass。

公版提供 self-host OpenAPI 與**預設關閉**的 Swagger UI。營運者可在同 origin 的 `/admin/docs`
啟用，靜態資產全部 self-host，`persistAuthorization: false`、`validatorUrl: null`，不得使用
`preauthorizeApiKey`，也不得把 token 放進 spec、URL、bundle、localStorage 或匯出的 Postman
collection。Swagger 是互動 API 文件，不是案件管理儀表板；完整操作步驟見
[DMCA 流程 §5.3](../流程/DMCA.md)。

**裁決狀態機**：`take_down`／`reject` 只接受 `type=notice,status=received`；`restore` 只接受
`type=notice,status=taken_down`；`hold` 只接受已下架且已有受理反通知等待期的 notice，並要求
`proceeding` 為美國聯邦法院或 Copyright Claims Board、非空有界 `reference` 與不晚於現在的
`receivedAt`。`release_hold` 只接受已有 hold 的 notice。`reason` 去空白後必須非空且有長度上限；非法組合
回 409，不執行部分副作用。每筆 decision log 寫可信 `operatorId`；自動恢復固定為
`system:auto-restore`。

## 3. notice 記錄 schema（pinning 節點本地儲存）

儲存引擎 ＝ **節點本地 level KV**（app-pvc）：notice 含申訴人個資，**絕不進 content-addressed 對外供應面**（blockstore／gateway／bitswap）；且需真刪除（未確認 72h 清除）與已結舊案**歸檔抹除**（保 publicView 統計欄、抹聯絡個資）——append-only 儲存無法滿足。備份 ＝app-pvc 快照 ＋ 加密匯出指令（存放由維運者自決）。

```typescript
// dmca-notices：_id(ULID); type:'notice'|'counter-notice'; status;
//   payload: DMCANotice|DMCACounterNoticeV1; affectedCIDs; uploaderByCid（可信 signer）；
//   pinMetadataByCid（category/source/signer/logicalSizeBytes/physicalSizeBytes，恢復 ownership 與
//   ingress 歸因用；global quota 於恢復時重算完整 DAG blocks）；
//   resourceAvailability:'available'|'partial'|'missing'; missingCIDs; createdAt; processedAt?;
//   publicView: { noticeIdShort(前8); claimantOrgRedacted(組織公開/個人遮蔽); cidsAffected; status; timestamps }

interface BlacklistEntry {
  id: string; // ULID
  version: typeof Protocol.security.TEXT_BLACKLIST_VERSION;
  pattern: string;
  matchMode: "exact" | "substring" | "regex";
  caseSensitive: boolean;
  appliesTo: (
    "partName" | "partDescription" | "partTags" | "creatorBio" | "trackName"
  )[];
  reason: string; // 如「Tamiya 商標」「ShoGakukan 角色」
  language: "zh-TW" | "zh-CN" | "en" | "ja" | "all"; // 四語系
}
```

Admin 列表與詳情使用不同 DTO，避免搜尋頁一次拉出全部 PII：

```typescript
interface DmcaAdminCaseSummary {
  id;
  type;
  status;
  createdAt;
  processedAt?;
  affectedCidCount;
  claimantLabelRedacted;
  hasPendingCounter;
  litigationHold: boolean;
}
interface DmcaAdminCaseView {
  id;
  type;
  status;
  payload;
  affectedCIDs;
  createdAt;
  processedAt?;
  waitingPeriodEndDate?;
  restorationEligibleAt?;
  acceptedAt?;
  counterIdentityStatus?;
  counterDeliveryStatus?;
  counterDeliveryAttemptCount?;
  counterDeliveryNextAttemptAt?;
  counterDeliveredAt?;
  litigationNoticedAt?;
  litigationHoldEvidence?;
  decisionLog;
  // 永遠沒有 confirmToken / confirmMailSentAt
}
interface DecisionLogEntry {
  action: "take_down" | "reject" | "restore" | "hold" | "release_hold";
  reason;
  at;
  operatorId;
}
```

完整黑名單存 `src/dmca/blacklist.data.ts`（格式版本 ＝`TEXT_BLACKLIST_VERSION`）、社群 PR 維護；regex 範例如 Mini 4WD 動畫車型名（Magnum/Sonic Saber 等）。

### 3.1 Provider-scoped 簽章收件匣

Client 不隨版攜帶全域 DMCA 下架清單，也不把一個 provider 的案件送入全域
`canUseUgc`。上傳者通知採逐 provider 的 authenticated inbox；第一層頁面、本機快照、
已讀與更新生命週期見 [inbox.md](inbox.md)：

```typescript
interface ProviderDmcaInboxRequest {
  type: "open4wd-provider-dmca-inbox-request";
  providerId: PeerId;
  subjectPeerId: PeerId;
}
interface ProviderDmcaInbox {
  type: "open4wd-provider-dmca-inbox";
  providerId: PeerId;
  subjectPeerId: PeerId;
  generatedAt: number;
  entries: {
    noticeId;
    affectedCIDs;
    legalStatus;
    resourceAvailability;
    waitingPeriodEndDate?;
    litigationHold;
    updatedAt;
  }[];
}
```

Request signer 必須等於 subject，且 provider 必須符合目前端點；request／response 都採專案既有
`SignedPayload` wire、64 KiB 上限、五分鐘 freshness 與 nonce 防重放。Response signer 必須是
descriptor 的 provider PeerId。Entries 由下架前保存的可信 pin metadata 建立，不採信 claimant
表單的 `creatorPeerId`，也不包含任一方姓名、email、電話、地址、人類簽名或敘述。

Live response 通過 exact schema、provider／subject、簽章、freshness 與共用 replay guard 後，才可
寫入 `InboxCoordinator`。本機保留 provider signed envelope＋`receivedAt` 供離線重驗；cache 驗證
不套 live freshness、不寫 replay guard，只能產生 stale 顯示。Snapshot 不含 provider URL；URL
只存在玩家設定或獨立 watch target 的本機傳輸設定。所有通知與反通知 deep link 仍固定回原
provider，不因本機保存而形成全域 authority。

## 4. 上傳時黑名單 pre-check

```typescript
async function checkBlacklist(input: {
  partName;
  partDescription;
  partTags;
  creatorBio;
  trackName;
  language;
}): Promise<BlacklistCheckResult> {
  // 鍵名＝appliesTo 枚舉（input[field] 索引才自洽）
  const blacklist = await loadBlacklist(
    Protocol.security.TEXT_BLACKLIST_VERSION,
  );
  const matches = [];
  for (const e of blacklist) {
    if (e.language !== "all" && e.language !== input.language) continue;
    for (const field of e.appliesTo) {
      const value = input[field];
      if (typeof value !== "string") continue;
      const matched =
        e.matchMode === "regex"
          ? new RegExp(e.pattern, e.caseSensitive ? "" : "i").test(value)
          : e.matchMode === "exact"
            ? value === e.pattern
            : value.toLowerCase().includes(e.pattern.toLowerCase());
      if (matched)
        matches.push({ field, pattern: e.pattern, reason: e.reason });
    }
  }
  return {
    allowed: matches.length === 0,
    matches,
    suggestion: matches.length ? "請使用未涉及既有 IP 的原創名稱" : undefined,
  };
}
```

阻擋訊息 4 語系（zh-TW / zh-CN / en / ja），由 i18n 提供。

## 5. 下架 / 恢復 / Repeat Infringer

```typescript
// notice email 確認後：
//   先從 provider 自己的 pin metadata 保存 uploaderByCid 與最小雙計量 metadata；
//   再逐 CID cluster unpin；每筆成功後同步 QuotaLedger.recordUnpin，全部完成才轉 taken_down；
//   失敗時保持 received，由每日 sweep 重試，不把單一 provider 決定寫帳本或全域 client gate。

// 反通知通過身分關卡後：acceptedAt 固定一次；完整法律 payload 私密轉寄 claimant；
//   轉寄暫時失敗只重試 delivery，不改 acceptedAt 或期限。
//   restorationEligibleAt = +13 工作日，waitingPeriodEndDate = +14 工作日；週末與設定的假日不計。
//   sweep 自第 13 工作日起、未被 hold 時解除法律阻擋；最晚不得超過第 14 工作日；
//   exact bytes 尚在本地才重走完整 DAG 驗證／logical 實量，以原 physical attribution
//   做 quota reservation；cluster pin 成功才 commit。缺檔則 resourceAvailability=missing。

// Repeat Infringer（REPEAT_INFRINGER_THRESHOLD，pinning 維運政策常數、非治理 config）：
//   查該 peer notRestored 的 takedown 數；達門檻 → 該 pinning 節點拒 pin 該創作者新上傳
//   （DMCA safe harbor §512(i) 累犯終止政策；不動 client、不動帳本、不動信譽）
```

常數值只由 [protocol.md §5](../程式參數/protocol.md#5-protocolledger鏈與多簽) 定義。

Provider unpin 表示立即停止自己控制的供應與保留；Kubo blocks 若仍被其他 pin／DAG 參照不得
逐 block 強刪，待 repo GC 在無引用時安全清除。玩家本機 cache 仍依容量自然淘汰，其他獨立
provider 各自負責。這是供應責任邊界，不保證網路上所有副本消失。

案件保存的 pin metadata 是 provider-local 操作資料，不新增 uploader 聯絡資訊，也不進公開
inbox／透明度 API。多 CID 下架部分成功後的重試必須 merge 舊 metadata，不得因已 unpin 的 CID
查無 Cluster record 而覆寫遺失。恢復保留原 category、source 與 signer；若資源存在但目前
signer/global quota 不允許，保持尚未恢復並由 sweep 重試，不得繞過配額或寫零計量 metadata。

**權利人訴訟通知（`hold`）＝帶外人工驗核**：反通知受理時系統寄信告知原權利人期限與
攔停方式。權利人若已提起訴訟，將可識別的法院行動資料寄至該 provider 私有維運信箱；
營運者驗核後以 admin `hold` 保存聯邦法院或 CCB 程序種類、案件 reference 與收件時間；程序
失效或結束時以 `release_hold` 明確解除。不開公開 hold API，避免任意提交者
無限期阻擋恢復；無有效 hold 時 sweep 自動恢復，所有人工動作寫 `decisionLog`。

對應 [版權.md §6.5](../版權.md)（每次成立 = 下架 + 通知；≥ 3 = pinning 拒服務；全程不動信譽）。

## 6. 營運者聲明與安全港邊界

公版實作只提供可配置流程，不替任何營運者向 US Copyright Office 登記或判斷其是否符合
17 U.S.C. §512。`GET /provider` 的 `designated_agent_registration` 只允許
`not-declared`／`registered` 自述；`safe_harbor_eligibility` 固定 `not-asserted`。未登記者仍可
盡量依通知、反通知、累犯政策、私有案卷與時限處理自己控制的供應，但不得把公版功能當成
安全港保證。若營運者日後自行主張安全港，應自行確認當時法律、完成必要登記及公開聯絡資訊，
並承擔續期與案件處理義務；主 repo 不設官方代理人或共同信箱。

## 7. DMCA Policy 全文

存 `legal/dmca-policy.md`（8 段：介紹 / 平台性質(去中心化 P2P) / 責任邊界(僅自有索引) / Notice / Counter-Notice / Repeat Infringer / 透明度 / 修訂歷史）；4 語系於 `/legal/dmca-policy.{lang}.md`。
