---
type: impl
domain: ["經濟"]
summary: 鑄幣／燒幣／比賽結算／分潤拆分／EconomyConfig
authority: null
slug: null
---

# economy（鑄幣 / 燒幣 / 結算實作）

> **本檔角色**：economy 的**實作層** orchestration —— 事件 applyEvent、canonical fold 內的 `computeMatchSettlement`、分潤拆分、消耗入口 builder、derived state 輔助、查詢面、EconomyConfig。
> 設計與規則見 [經濟系統.md](../經濟系統.md)；**公式**見 [算式表.md §12–§15](../算式表.md)（月軟曲線 / match-prize / niche 線性 / 分潤）；事件 union 與 `EconomyDerivedState` 結構見 [資料系統.md §3/§4](../資料系統.md) + [程式架構/ledger-checkpoint.md §2](ledger-checkpoint.md)。對應 `src/economy/`。
> 金額一律 **bigint minor units**（1 幣 = 100；UI 除以 100，見 §UI）。

## 1. 經濟事件

**〔ECON-R-037〕** economy 無獨立鑄幣事件；`MatchResultEvent` 也不攜帶 match-prize / royalty。完賽者多簽只背書比賽事實，fold 依事件位置的 canonical `DerivedState` 推導獎金與分潤。消耗 / 上鏈費事件：

| 事件                              | 用途                                     | 備註                                                                                                                     |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `UgcUploadEvent`                  | 上鏈費 burn（part 50 / track 500 minor） | 原創／fork 都寫本事件、**單次收費**；首次可入負（[§3](#3-首次上鏈負資產) 首次上鏈負資產）                                |
| **〔ECON-R-038〕** `UgcForkEvent` | 血緣宣告（衍生樹索引）                   | **免費**——fork 流程寫 upload＋fork 兩事件（[ugc-fork.md §5](ugc-fork.md)）、費用燒在 upload                              |
| `SlotPurchaseEvent`               | 擴充車位 burn（1000）                    | **車位無上限**；`newSlotIndex = derive(count)+1` 防跳級                                                                  |
| `UgcSponsorBurnEvent`             | 贊助 UGC burn                            | 金額至少為治理 `sponsorship.min_amount_minor` 且 ≥ 1；`targetCid` 必須是已上鏈、非 builtin、非黑名單、非付款人自己的作品 |

## 2. applyEvent（經濟相關 case）

〔LEDGER-R-060〕 事件按 ledger 總序依序套用；rolling window、月 rollover、信譽與結算時序一律使用套用前 `state.derivedAt`，不得用可由發布者倒填的 `event.timestamp`。**〔ECON-R-039〕** config 一律讀 `state.economyConfig`（epoch 化，[ledger-checkpoint.md §2](ledger-checkpoint.md)／[ledger.md §8](ledger.md)）——fold 至任一 log 位置即取該位置生效值、任何 peer 任何時刻重算同判定；下方 `config` 皆指此讀點。

```typescript
function applyEvent(
  state: DerivedState,
  event: LedgerEvent,
  config: EconomyConfig,
): DerivedState {
  // config = state.economyConfig（呼叫端投影；epoch 化單一權威）
  switch (event.type) {
    // 上鏈費 burn（含首次上鏈負資產，見 §3）——收費限 ugc-upload（原創/fork 都寫、單次）；ugc-fork＝免費血緣宣告
    case "ugc-upload": {
      const e = state.economy,
        fee = uploadFee(event, config);
      return applyUploadBurn(state, event.peerId, fee, event); // §3 邏輯（peerId = BaseEvent 簽署者，資料系統 §3）
    }

    case "slot-purchase": {
      // 擴充車位（無上限）
      const e = state.economy;
      // 共識側燒幣守門（builder 檢查是 UX 前置、非共識）：冒名 / 費率不符 / 餘額不足 / 跳級 → 事件無效 no-op（apply 序決定性、雙花由 log 序裁——先到扣款、後到無效）
      if (event.payer !== event.peerId) return state; // 冒名守門：付款人須為簽署者，否則可簽事件扣他人餘額
      if (event.amount !== BigInt(config.expansion_costs.vehicle_slot_minor))
        return state; // 費率收口（正數守門完全體）：低報含負額自鑄、高報誤植皆無效；config 切換競態＝安全向拒、付舊價重試
      if ((e.balances.get(event.payer) ?? 0n) < event.amount) return state;
      if (
        event.newSlotIndex !==
        (state.match.playerSlotCounts.get(event.payer)?.vehicle ?? 1) + 1
      )
        return state; // 防跳級：≠ derive(count)+1 無效
      return {
        ...state,
        economy: {
          ...e,
          balances: subBalance(e.balances, event.payer, event.amount),
          totalBurned: e.totalBurned + event.amount,
        },
        match: {
          ...state.match,
          playerSlotCounts: incrementSlot(
            state.match.playerSlotCounts,
            event.payer,
            "vehicle",
          ),
        },
      };
    }

    case "ugc-sponsor-burn": {
      const e = state.economy;
      const intent = paymentIntentDigest(event); // chain-bound 簽章已在 digest 內；不含 Orbit entry 包裝
      if (e.processedPaymentIntents.has(intent)) return state;
      if (event.payer !== event.peerId) return state; // 冒名守門：付款人須為簽署者，否則可簽事件燒他人餘額
      if (
        sponsorPolicyFailure(state, event.payer, event.targetCid, event.amount)
      )
        return state; // 治理下限／builtin／黑名單／未知 CID／自己作品共用政策
      if ((e.balances.get(event.payer) ?? 0n) < event.amount) return state; // 共識側餘額守門——無限負餘額＝免費刷贊助統計（經濟系統 §10.1）
      const record = state.ugc.ugcRecords.get(event.targetCid)!;
      const ugcRecords = new Map(state.ugc.ugcRecords);
      ugcRecords.set(event.targetCid, {
        ...record,
        sponsoredTotalMinor: record.sponsoredTotalMinor + event.amount,
        sponsorEventCount: record.sponsorEventCount + 1,
        lastSponsoredAt: Math.max(record.lastSponsoredAt, event.timestamp),
      });
      return {
        ...state,
        economy: {
          ...e,
          processedPaymentIntents: new Set([...e.processedPaymentIntents, intent]),
          balances: subBalance(e.balances, event.payer, event.amount),
          totalBurned: e.totalBurned + event.amount,
        },
        ugc: { ...state.ugc, ugcRecords },
      };
    }

    // 比賽結算：事件只含比賽事實；canonical fold 在此計算 settlement。
    case "match-result": {
      if (state.match.settledMatchIds.has(event.matchId)) return state;
      const settlement = computeMatchSettlement(event, state);
      const incoming = settlement.matchPrizes
        .concat(settlement.royalties)
        .reduce((sum, share) => sum + share.amount, 0n);
      const economy = checkMonthRollover(state.economy, state.derivedAt);
      const overHardCap =
        economy.monthMinted + incoming >
        BigInt(config.month_hard_cap_minor);
      const outcome = !settlement.mintEligible
        ? "not-eligible"
        : overHardCap
          ? "monthly-hard-cap"
          : "applied";
      // outcome !== applied 時不入帳，但仍留下可稽核 MatchRecord。
      return applyCanonicalSettlement(state, event, settlement, outcome);
    }

    default:
      return state; // 其他模組事件
  }
}
```

`sponsorPolicyFailure` 是 builder、live receive validator 與 fold 共用的純函式。`paymentIntentDigest` 則由已簽 canonical payload 產生 chain-scoped 64 位 hex，writer、live receive validator 與 fold 共用；它不含 Orbit parents／clock／admission，因此同 payload 換 entry 仍命中。stateless event schema 只驗 exact shape、canonical CID、`payer === peerId` 與簽章；作者、黑名單、record 與治理下限都依 DerivedState 判定。live 遇到已消費 intent 直接 reject、未知 CID 採 defer 等鏡像同步，其餘違規 reject；fold 對任何違規一律 no-op，避免歷史 append 繞過即時面污染榜單。

- **〔ECON-R-040〕** 付費事件冒名、餘額不足、跳級、費率不符或內容重播時，fold 必須 deterministic no-op，不得扣錯付款人或重複入帳。`ugc-sponsor-burn`／`ugc-maintenance` 成功時才把 `paymentIntentDigest` 原子加入永不逐出的 `processedPaymentIntents`；checkpoint 缺欄 fail-closed。
- **〔ECON-R-041〕** slot、sponsor 與 maintenance 的 burn amount 必須符合各自治理現值／最低額；零額、負額與低報不得藉 `subBalance` 反向增發。
- **〔ECON-R-042〕** `match-result` 已存在相同 matchId 時 fold no-op；事件不能攜帶 payout，因此不存在「簽過的任意金額」可被 reducer 套用。
- **〔ECON-R-043〕** 月 rollover 後以 `monthMinted + incomingMint` 檢查 `month_hard_cap_minor`；超過即整場 outcome=`monthly-hard-cap` 且零入帳，exact cap 允許。
- **〔ECON-R-044〕** royalty 產生必須排除黑名單、退役與相似度審查中的 CID，並以 `(cid, triggerPlayer)` 的上次實際發放時間套用去重窗。
- **match-prize / royalty 皆產出型**（計入 `monthMinted`、受月軟曲線）；上鏈費 / slot / sponsor 是 burn。
- **月度跨界**：不寫 month-reset 事件，每筆 mint/burn 前純函數 `checkMonthRollover`（`monthMinted=0`、`monthStartTimestamp=startOfUtcMonth`）。
- **〔ECON-R-045〕** **GC**：讀點自帶窗過濾 ＋ 同 key append 時就地裁剪（`appendRecentMatchCombo` 等）；帳本檢查點時另對 `recentMatchCombos` / `ugcUsageStats[cid].lastRoyaltyAtByPlayer` / `recentPrizedMatches` 裁剪 > 24h entry。不寫事件。

## 3. 首次上鏈負資產

每 PeerId **一生一次**、**限 `ugc-upload` 上鏈費**可餘額入負；原創／fork 都寫 upload 並單次收費，`ugc-fork` 免費。不鑄幣、債務天然封頂於該次上鏈費（≤500）。設計見 [經濟系統.md §10](../經濟系統.md)：

```typescript
function applyUploadBurn(state, peerId, fee, event): DerivedState {
  const e = state.economy,
    bal = e.balances.get(peerId) ?? 0n;
  if (bal >= fee) {
    /* 正常扣 */
  } else if (!e.firstUploadDebtUsed.has(peerId)) {
    /* 扣（入負）+ firstUploadDebtUsed.add(peerId) */
  } else {
    /* reject: insufficient balance */
  }
  // ... 更新 balances / totalBurned / uploadCounts / firstUploadDebtUsed
}
```

其他消費（slot / sponsor）一律要餘額 ≥ 0。

## 4. 比賽結算（canonical fold 純函數 `computeMatchSettlement`）

**〔ECON-R-046〕** 結算必須排除黑名單、退役或仍處於 pending 狀態的 UGC 回饋金。

**〔ECON-R-047〕** settlement 不在 P2P 訊息或 `MatchResultEvent` 內傳輸。每個 peer 在 canonical fold 的相同事件位置，使用相同的前態，以固定排序獨立計算；輸入只有已通過 timeless 自包含驗證的 match facts 與該位置 `DerivedState`。**公式全在 [算式表.md §12–§15](../算式表.md)**；總名次見 [算式表.md §20.1](../算式表.md)。

```typescript
function computeMatchSettlement(
  match: MatchResultEvent,
  derived: DerivedState,
): MatchEconomySettlement {
  const config = derived.economyConfig;
  const now = derived.derivedAt;
  const econ = checkMonthRollover(derived.economy, now);
  const factorX100 = monthFactorX100(econ, config); // 算式表 §12
  // finishers = 完成整場 N 回合者（依總名次序、扣中途 forfeit）；forfeit = disconnects（'voluntary' 棄賽 / 'network' 斷線）
  const forfeited = new Set(match.disconnects.map((d) => d.peerId));
  const finishers = match.ranking.filter((p) => !forfeited.has(p));
  const comboHash = computeComboHash(finishers); // 只算完賽者（per-match 完賽者群組）
  const finisherCount = finishers.length; // 完賽人數（完成整場 N 回合，非開賽，見 經濟 §6.2）

  // 場級鑄幣資格（經濟系統 §6.2）：void（finisherCount < 3）或 combo 達 K=5 → 整場不鑄（prizes / royalties 全空、usage 統計不記）
  const mintEligible =
    finisherCount >= config.match_prize.min_player_count &&
    match.roundAnchors.every((anchor) => anchor !== null) &&
    shouldGrantMatchPrize(comboHash, econ, config, now);
  const matchPrizes: MatchPrizeShare[] = [];
  const royalties: RoyaltyShare[] = [];
  if (mintEligible) {
    finishers.forEach((peerId, idx) => {
      // finishers 依總名次序
      if (
        countPrizedMatches24h(
          peerId,
          econ.recentPrizedMatches,
          now,
        ) >= // per-player 24h 有獎場數上限（經濟系統 §6.1b）
        config.match_prize.player_prized_matches_per_day
      )
        return; // 該玩家本場獎金 0；名次保留、他人不受影響
      const amount = computeMatchPrize(
        idx + 1,
        finisherCount,
        factorX100,
        config,
      ); // 算式表 §13（idx+1 = 完賽者排名、依總名次序、forfeit 不佔位）
      if (amount > 0n)
        matchPrizes.push({ recipient: peerId, amount, rank: idx + 1 });
    });
    // 創作回饋金：過濾黑名單 + 退役；N 回合 track+car UGC 累加去重；niche 線性；70/20/10 拆分
    const ugcsUsed = Array.from(collectAllUgcUsedInMatch(match))
      .filter((cid) => !derived.moderation.blacklist.has(cid))
      .filter((cid) => {
        // 退役過濾（共識 now＝derived.derivedAt、禁牆鐘）
        const rec = derived.ugc.ugcRecords.get(cid);
        return (
          rec === undefined ||
          !deriveRetireStatus(rec, derived, config, now).retired
        );
      })
      .filter((cid) => !derived.ugc.similarityPending.has(cid)) // 相似度審查中：經濟隔離（anti-piracy.md §5.1）
      .sort();
    const authors = extractUgcAuthors(derived.ugc.ugcRecords);
    for (const cid of ugcsUsed)
      for (const peerId of finishers) {
        if (
          !shouldMintRoyalty(
            cid,
            peerId,
            econ,
            derived.ugc.ugcUsageStats,
            config.creator_royalty.dedup_window_hours,
            now,
          )
        )
          continue;
        const amount = computeRoyaltyForUgc(
          derived.ratings.ugcRatings.get(cid)?.ratingX100 ?? 0,
          factorX100,
          config,
        ); // 算式表 §14/§15
        if (amount > 0n)
          royalties.push(
            ...computeRoyaltyShares(
              cid,
              amount,
              derived.ugc.forkLineage,
              authors,
            ).map((share) => ({
              ...share,
              sourceCid: cid,
              triggerPlayer: peerId,
            })),
          );
      }
  }
  return {
    mintEligible,
    monthFactorX100: Number(factorX100),
    comboHash,
    matchPrizes,
    royalties,
  };
}
```

> **finisherCount < 3 → 整場經濟 void**（[經濟系統.md §6.2](../經濟系統.md)）：matchPrizes / royalties 全空（含三層分潤），MatchResultEvent 仍寫完整名次。斷線 / 主動棄賽者 forfeit、不計入 finishers。

**〔ECON-R-048〕** `MatchResultEvent` 只承載可驗證的 match facts，不承載 wire settlement。完賽者在簽章前驗證 match facts；金額由 canonical fold 位置唯一決定，事件不能自行選擇結算基準或 payout。

### `computeRoyaltyShares`（70/20/10 拆分）

```typescript
// revShare = derived.economyConfig.revShare（治理可調、pct 整數，程式參數/economy-config.md §17.2）
function computeRoyaltyShares(
  cid,
  totalAmount,
  forkLineage,
  authors,
  revShare,
): Omit<RoyaltyShare, "triggerPlayer">[] {
  const lineage = forkLineage.get(cid) ?? []; // 至多 revShare.maxDepth − 1 = 2 筆 [parent, grandparent]
  const shares = [
    {
      recipient: authors.get(cid)!,
      amount: (totalAmount * BigInt(revShare.currentTierPct)) / 100n,
      sourceCid: cid,
      forkLineageDepth: 0,
    },
  ];
  if (lineage[0])
    shares.push({
      recipient: authors.get(lineage[0])!,
      amount: (totalAmount * BigInt(revShare.parentTierPct)) / 100n,
      sourceCid: cid,
      forkLineageDepth: 1,
    });
  if (lineage[1])
    shares.push({
      recipient: authors.get(lineage[1])!,
      amount: (totalAmount * BigInt(revShare.grandparentTierPct)) / 100n,
      sourceCid: cid,
      forkLineageDepth: 2,
    });
  const residual = totalAmount - shares.reduce((s, x) => s + x.amount, 0n);
  if (residual > 0n) shares[0].amount += residual; // 缺層份額（無 parent / grandparent）與整除殘留皆歸當前作者——原創作品實拿 100%（無公共池，經濟系統 §8.1）
  return shares.filter((share) => share.amount > 0n); // bigint 整除為 0 的層不進 canonical event
}
```

> **〔ECON-R-049〕** 分潤跟血緣、與祖先可用性狀態正交（退役 / 黑名單 / unusable / yanked 的祖先仍照分；見 [版權.md §3.4](../版權.md)）。

### 整除截斷尾數抹零

`computeMatchPrize` / `computeRoyaltyForUgc` 一律 bigint 整除，截斷的小數**抹零消失**（不發、不累 `monthMinted`、不另存滯留池）；三層拆分後金額為 0 的 share 也不序列化進 canonical event。理由：跨 peer「應發總額」須完全一致才能簽章通過，補回邏輯任一歧異 → 共識炸裂；月初係數 100 無截斷，僅月中跨界後出現、單名次截斷 <1 minor。

## 5. 消耗入口 builder

```typescript
// 擴充正式車位（無上限；固定本機測試車位不入 Ledger；newSlotIndex 強制 = 現有 + 1 防跳級）
async function processSlotPurchase(
  payer,
  state,
  config,
): Promise<SlotPurchaseEvent> {
  const count = state.match.playerSlotCounts.get(payer)?.vehicle ?? 1;
  const cost = BigInt(config.expansion_costs.vehicle_slot_minor);
  if ((state.economy.balances.get(payer) ?? 0n) < cost)
    throw new Error("餘額不足");
  return {
    type: "slot-purchase",
    payer,
    amount: cost,
    newSlotIndex: count + 1,
  } as SlotPurchaseEvent;
}

// 贊助（擋 builtin / 自己作品 / 黑名單 / 低於下限 / 餘額不足）
async function processSponsor(
  payer,
  targetCid,
  amount,
  state,
  config,
): Promise<UgcSponsorBurnEvent> {
  /* ... */
}
```

> **正式車位不可回退**：擴充後不用就 loadout 留空，`formalSlotCount` 不可回退（防「擴充 → 退錢 → 再擴充」薅羊毛 + 簡化共識）。固定一個本機測試車位完全是本機資料，不入此計數。**場地無位數概念**：場地比照零件，靠 500 上鏈費節流。
> **builder 檢查 ≠ 共識**：`processSlotPurchase` / `processSponsor` 的餘額 / 跳級檢查是 UX 前置；共識守門在 `applyEvent`（[§2](#2-applyevent經濟相關-case)）——不足 / 跳級事件一律 no-op。

## 6. Derived state 輔助函數

**〔ECON-R-050〕** `addBalance` / `subBalance`（ReadonlyMap 不可變更新）、`appendRecentMatchCombo`（24h 視窗過濾）、`appendRecentPrizedMatches` / `countPrizedMatches24h`（per-player 有獎場數窗，經濟系統 §6.1b）、`recordUgcUsage`（totalUses/uniqueUsers/lastUsedAt；只在場級 `mintEligible` 成立時記錄，[§2](#2-applyevent經濟相關-case)）、`recordRoyaltyMint`（只在實際鑄出時更新 `lastRoyaltyAtByPlayer` 去重錨）、`accumulateRoyaltyMinted`、`incrementSlot`（未出現 vehicle = 1）、`incrementUploadCount`。有效 `ugc-sponsor-burn` 必須把金額、事件數與單調時間直接累加到 target `UgcRecord`；不可保存逐贊助者集合，也不可在 fold 時以 top-N 裁掉榜外作品。實作見 `src/economy/`（純函數、immutable）。

**〔ECON-R-053〕** 月流水與創作者收益是 fold 時同步維護的衍生讀模型，不得在 provider 掃描 raw log 重建：`monthlyFlowsByMonth: Map<YYYY-MM, Map<PeerId, { mintedMinor, burnedMinor }>>` 以事件 UTC 月份累加**實際被 reducer 接受**的 match prize、royalty、upload、slot purchase、maintenance 與 sponsor 流量，只保留當月含往前 11 個月；`lifetimeRoyaltyMintedByPeer` 只累加實際鑄出的 royalty，永久保留。被拒絕／no-op 的事件兩者都不可改變。月流水在 append 與 checkpoint 以同一 protocol 常數裁剪，lifetime 不 GC；兩欄都納入 canonical bigint codec 與 checkpoint，缺欄 fail-closed，開發期不讀舊 checkpoint fallback。

暱稱解析不屬 economy 責任；查詢面使用 [D-20260816-03](../decisions/D-20260816-03-PeerId顯示身分與暱稱快照消歧.md) 定義的 display identity resolver。

## 7. 查詢面與 UI

- **頁面資料入口 ＝`pages/contracts` 的 `EconomyData` 契約**（餘額 ／ 流水等投影；頁面不直呼本模組）。`monthlyFlows(peer)` 直讀 `monthlyFlowsByMonth`並依月份升序回傳；創作者 `totalEarnedX100` 直讀 `lifetimeRoyaltyMintedByPeer`。兩者都不得取 `getAllEvents()` 或以 log heads memo 重算。作品贊助榜由 economy query 即時掃 `ugc.ugcRecords`，依 `sponsoredTotalMinor` 降序、CID 字典序平手裁決後才套 caller 的 top-N；榜是作品能見度／支持度訊號，不是作者收入。贊助者／人物榜與 `EconomyData.sponsorBoard()` 不存在。
- **貨幣格式化 ＝i18n `formatMoney(minor, lang)`**（minor units → 帶千分位 ＋ 兩位小數；UI 除以 100，[i18n.md](i18n.md)）。
- `ratingX100`（0–500 整數）由 `ugc-rating` 模組經 `RatingApi` **依賴注入**（避免循環依賴）；`high-rated-ugc +20` 信譽由 ugc-rating 自己觸發、非 economy 責任。

## 8. EconomyConfig 結構

治理 `ConfigUpdateEvent` 可調；**完整 `EconomyConfig` 介面 + 預設值以 [economy-config.md §17](../程式參數/economy-config.md#17-economy-configorbitdb-動態治理) 為單一 authority**（政策參數 + 經濟值群組全含；`economy_config_version` = `epoch`）。本檔鑄幣 / 結算邏輯引用的經濟值群組:

- **〔ECON-R-051〕** `month_soft_cap_minor`／`month_hard_cap_minor`、`match_prize`（base_amount、rank_multipliers、min_player_count 3、combo 24/5、player_prized_matches_per_day 20）、`creator_royalty`（base_per_use、dedup；niche 乘子＝固定公式）、`revShare`（70/20/10、maxDepth 3）、`upload_costs`（part 50／track 500／metadata 0）、`expansion_costs`、`sponsorship`、`hot_match_quarters`、`ugc_lifecycle`、`forkDetection` 與 `governanceSigners`。完整 current shape 與預設值只以 [economy-config.md §17](../程式參數/economy-config.md#17-economy-configorbitdb-動態治理) 為 authority；**newcomer／reputation 群組不在 config**（累積型 derive 消費值＝protocol 常數）。
