---
type: registry
domain: ["經濟","治理營運"]
summary: OrbitDB 動態治理 economy config
authority: null
slug: null
---

# Economy config

> 本頁是所列 namespace 的內容權威；[程式參數](../程式參數.md) 只提供導覽。

## 17. `economy-config/`（OrbitDB 動態治理）

注意：本節轉錄 **genesis 初始值**（程式 authority ＝`src/economy/config.ts` 的 `EconomyConfig` 與 `GENESIS_ECONOMY_CONFIG`）；runtime 讀點 ＝`DerivedState.economyConfig`（`config-update` 事件 fold、epoch 化，[程式架構/ledger-checkpoint.md §2](../程式架構/ledger-checkpoint.md) 與 [程式架構/ledger.md §8](../程式架構/ledger.md)）。`system-constants` 不保存第二份 config shape 或預設物件。

### 17.1 介面

```typescript
interface EconomyConfig {
  epoch: EconomyConfigEpoch;
  signedAt: number;
  signers: PeerId[];
  revShare: RevShareConfig;
  forkDetection: ForkDetectionConfig;
  month_soft_cap_minor: number;
  month_hard_cap_minor: number;
  match_prize: {
    base_amount_minor;
    rank_multipliers_pct: number[];
    min_player_count;
    combo_window_hours;
    combo_max_matches_per_day;
    player_prized_matches_per_day;
  };
  creator_royalty: { base_per_use_minor; dedup_window_hours };
  upload_costs: {
    part_upload_minor;
    track_upload_minor;
    metadata_update_minor;
  };
  expansion_costs: { vehicle_slot_minor };
  sponsorship: { min_amount_minor };
  governanceSigners: PeerId[]; // 治理 multisig signer set 本體（genesis 初始化；變更=同一 ConfigUpdateEvent 族、quorum 以 prevEpoch set 計——流程/治理事件.md §4）
  hot_match_quarters: number;
  ugc_lifecycle: {
    // P5 退役門檻（程式架構/ledger.md §7）
    candidate_no_use_ms;
    candidate_low_rating_threshold_x100;
    candidate_low_rating_no_use_ms;
    candidate_creator_gone_ms;
    maintenance_grace_ms;
    maintenance_burn_minor;
  };
}
```

介面只定義 shape；逐欄值與語意在 [§17.2](#172-預設值)，治理可調邊界在
[治理事件.md §2](../流程/治理事件.md)，套用規則在 [程式架構/economy.md](../程式架構/economy.md)。

### 17.2 預設值

| 欄位 | 預設值 | 說明 |
| --- | ---: | --- |
| `revShare.currentTierPct` | 70 | 創作者層（pct 整數） |
| `revShare.parentTierPct` | 20 | parent fork 層 |
| `revShare.grandparentTierPct` | 10 | grandparent fork 層 |
| `revShare.maxDepth` | 3 | 封頂三層 |
| `forkDetection.stage1_geometry.passthrough_threshold` | 0.10 | 幾何快篩 pass-through 門檻 |
| `forkDetection.stage2_physics.rigid.strict` | 0.08 | rigid 強制 fork 上界 |
| `forkDetection.stage2_physics.rigid.loose` | 0.15 | rigid pass-through 下界 |
| `forkDetection.stage2_physics.rolling.strict` | 0.05 | rolling 強制 fork 上界 |
| `forkDetection.stage2_physics.rolling.loose` | 0.10 | rolling pass-through 下界 |
| `forkDetection.stage2_physics.functional_mesh.strict` | 0.08 | functional mesh 強制 fork 上界 |
| `forkDetection.stage2_physics.functional_mesh.loose` | 0.15 | functional mesh pass-through 下界 |
| `forkDetection.stage2_physics.functional_sidecar.strict` | 0.10 | functional sidecar 強制 fork 上界 |
| `forkDetection.stage2_physics.functional_sidecar.loose` | 0.20 | functional sidecar pass-through 下界 |
| `forkDetection.stage2_physics.chip_mesh.strict` | 0.05 | chip mesh 強制 fork 上界 |
| `forkDetection.stage2_physics.chip_mesh.loose` | 0.15 | chip mesh pass-through 下界 |
| `forkDetection.stage2_physics.chip_skill.strict` | 0.05 | chip skill 強制 fork 上界 |
| `forkDetection.stage2_physics.chip_skill.loose` | 0.25 | chip skill pass-through 下界 |
| `forkDetection.stage2_physics.track.strict` | 0.10 | track 強制 fork 上界 |
| `forkDetection.stage2_physics.track.loose` | 0.20 | track pass-through 下界 |
| `governanceSigners` | （空集；部署時注入真值） | 變更走 `ConfigUpdateEvent`，quorum 以前一 epoch signer set 計 |

**經濟值群組 genesis 值**（抄自 `src/economy/config.ts` `GENESIS_ECONOMY_CONFIG`；標註者 ＝**genesis 初估、playtest 校準**。鑄幣公式見 [算式表.md](../算式表.md)、套用邏輯見 [程式架構/economy.md](../程式架構/economy.md)）:

| 欄位 | genesis 值 | 說明 |
| --- | ---: | --- |
| `month_soft_cap_minor` | 1_000_000 | 月軟曲線軟上限；初估 |
| `month_hard_cap_minor` | 100_000_000 | 100×soft 的 fold 聚合硬頂；初估 |
| `match_prize.base_amount_minor` | 50 | 初估 |
| `match_prize.rank_multipliers_pct` | [100, 50, 30, 14] | 名次乘數 pct；初估 |
| `match_prize.min_player_count` | 3 | finisherCount 低於此則整場經濟 void |
| `match_prize.combo_window_hours` | 24 | combo 窗 |
| `match_prize.combo_max_matches_per_day` | 5 | 同組合窗內合格場上限 |
| `match_prize.player_prized_matches_per_day` | 20 | per-player 24h 有獎場數上限 |
| `creator_royalty.base_per_use_minor` | 50 | 初估 |
| `creator_royalty.dedup_window_hours` | 24 | 同 (UGC, 玩家) 去重窗 |
| `upload_costs.part_upload_minor` | 50 | part upload burn |
| `upload_costs.track_upload_minor` | 500 | track upload burn |
| `upload_costs.metadata_update_minor` | 0 | presentation metadata update current 免費 |
| `expansion_costs.vehicle_slot_minor` | 1000 | 車位擴充 burn |
| `sponsorship.min_amount_minor` | 1 | 贊助 burn 下限 |
| `hot_match_quarters` | 2 | recentMatches 保留窗 |
| `ugc_lifecycle.candidate_no_use_ms` | 7_776_000_000 | 90 天；初估 |
| `ugc_lifecycle.candidate_low_rating_threshold_x100` | 300 | 初估 |
| `ugc_lifecycle.candidate_low_rating_no_use_ms` | 5_184_000_000 | 60 天；初估 |
| `ugc_lifecycle.candidate_creator_gone_ms` | 15_552_000_000 | 180 天；初估 |
| `ugc_lifecycle.maintenance_grace_ms` | 2_592_000_000 | 30 天；初估 |
| `ugc_lifecycle.maintenance_burn_minor` | 100 | 初估 |

### 17.3 注意事項

- `revShare` 三層必須總和 = **100**（pct 整數、不變式檢查）
- **治理可調鐵則**：config 值只能在**可重放的 epoch 讀點**消費。match settlement 由 canonical fold 讀事件位置的 `state.economyConfig` 並純函數產生，不進事件；固定費率事件攜帶金額但 fold 對同一讀點精確驗證；fork 判定結果則在 event creation 定稿並簽章。**會讓既有事件隨最新 config 重新解讀的累積型 derive 值一律改為 protocol 常數、不進 config**（新手保護 7 天/400 烘進評分權重、惡意檢舉門檻烘進信譽 delta、初始值/clamp 改值 ＝ 全史重算）。信譽相關常數在 [§5](protocol.md#5-protocolledger鏈與多簽)；信譽純事件鏈推導、**無時間衰減**（derive 不可用 `Date.now()`，[ledger.md `consensusNow`](../程式架構/ledger.md) 規範）。
- 治理變更走 multisig：提案定稿 → 各 signer 對 `ledgerSigningDigest(ledgerAddress, event)` 簽章 → 達 quorum `appendPreSigned` 原樣上鏈；每次 epoch +1（digest 定義見 [程式架構/ledger-admission.md §1](../程式架構/ledger-admission.md)，治理流程見 [程式架構/ledger.md §8](../程式架構/ledger.md)）
- `forkDetection` 為治理「門檻值」（原創 / fork 經濟邊界）；fork **判定演算法 / 指紋**（`fingerprintVersion`）屬 `derive_logic`（client 發版），不在此 config
- **本 [§17](#17-economy-configorbitdb-動態治理) 為 `EconomyConfig` 介面 + 預設的單一 authority**（政策參數群組 + 經濟值群組全含）；[程式架構/economy.md](../程式架構/economy.md) 引用本表、不另定義介面。`EconomyConfig` 是治理 config 的 umbrella，涵蓋經濟與非經濟政策群組
- `epoch`（`EconomyConfigEpoch`）對外即 **`economy_config_version`**（[版本規範.md §1](../版本規範.md) 6 版本欄位之一）；每次治理更新 epoch +1、`economy_config_version` 同步
