# 決策索引（INDEX）

> 本檔由 `pnpm check:decisions --write-index` 生成，勿手改。依首要域分組、id 升冪；制度說明見 [README.md](README.md)。

## 廢止與改名索引

> 共 147 筆；本表只來自 ADR `deprecates` metadata，不從本文猜測；日期與處置關係由 `check:decisions` 驗證。

| 日期 | 項目 | 處置 | 取代方式 | 決策 |
|---|---|---|---|---|
| 2026-04-29 | socketType | 取代 | Mount_* 節點前綴匹配 | [D-20260429-01](D-20260429-01-socketType廢除前綴匹配.md) |
| 2026-05-16 | throttle／battery_discharge_amps／motor_max_current／motor_resistivity／battery_internal_resistance | 取代 | motor torque_ratio 與 battery 輸出功率模型 | [D-20260516-01](D-20260516-01-Motor-Battery能量模型.md) |
| 2026-05-16 | Combat stat | 取代 | weapon 動能模型 | [D-20260516-02](D-20260516-02-Skill八種Stats八項.md) |
| 2026-05-16 | lock_steer skill | 移除 | — | [D-20260516-02](D-20260516-02-Skill八種Stats八項.md) |
| 2026-05-16 | slipstream skill | 取代 | aero 物理自然湧現 | [D-20260516-02](D-20260516-02-Skill八種Stats八項.md) |
| 2026-05-17 | auto_heat_per_use | 取代 | chip kinetic_ratio 動態計算 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | BASE_HEAT_COST／BASE_BATTERY_DRAIN／K_HOLD | 取代 | 動能比例公式 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | fire_order | 取代 | array 順序 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | gear_ratio | 取代 | motor torque_ratio | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | GP_CHIP_PASSIVE_SLOTS／GP_CHIP_AUX_SLOTS／GP_CHIP_ATTACK_SLOTS | 取代 | 體積決定 1–4 slot 與 skill enum | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | motion_type | 取代 | mesh 軸向自動推導 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | polarity | 取代 | 同極相斥、異極相吸的磁性物理 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | strength_threshold | 取代 | fatigue 與 ultimate 一擊閾值 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | Tier 1／Tier 2 Mount 命名 | 取代 | 單層固定清單 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | Tip empty | 取代 | mesh 碰撞接觸點 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-17 | tread_type | 取代 | mesh 與 material 推導 | [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md) |
| 2026-05-18 | LaunchPoint empty | 取代 | main_mesh_node 子節點 mesh | [D-20260518-01](D-20260518-01-武器欄位簡化.md) |
| 2026-05-18 | magnet_strength_n | 取代 | applied_energy × K_MAGNET_FORCE | [D-20260518-01](D-20260518-01-武器欄位簡化.md) |
| 2026-05-18 | n_pole_direction | 取代 | mesh-local +Z 自動推導 | [D-20260518-01](D-20260518-01-武器欄位簡化.md) |
| 2026-05-18 | on_impact | 取代 | bullet 材質決定落地行為 | [D-20260518-01](D-20260518-01-武器欄位簡化.md) |
| 2026-05-18 | slaveMesh／scope | 取代 | main_mesh_node | [D-20260518-01](D-20260518-01-武器欄位簡化.md) |
| 2026-05-20 | heavy_pull／ferromagnetic_field／vision_blur deploy_behavior | 移除 | — | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-20 | is_mag_src | 改名 | is_magnet_source | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-20 | liquid_nitrogen | 改名 | freezing_fluid | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-20 | magnet_field entity | 取代 | 具 is_magnet_source 材質與 magnet_source_strength_n 的一般 entity | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-20 | mercury／iron_sand／smoke | 移除 | — | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-20 | 材質層 magnetic_strength 磁源用途 | 取代 | Root Extras magnet_source_strength_n | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-20 | 算式表重力與下壓章節 | 移除 | — | [D-20260520-01](D-20260520-01-材質系統重構31種.md) |
| 2026-05-22 | impact／impact_toughness | 移除 | — | [D-20260522-01](D-20260522-01-impact廢除磁性合併.md) |
| 2026-05-22 | is_magnet_source | 取代 | magnetism_role | [D-20260522-01](D-20260522-01-impact廢除磁性合併.md) |
| 2026-05-22 | magnetic | 取代 | magnetism_role 與 magnetic_susceptibility | [D-20260522-01](D-20260522-01-impact廢除磁性合併.md) |
| 2026-05-24 | battery.output_w | 改名 | battery.declared_output_w | [D-20260524-05](D-20260524-05-weapon_branch廢除扁平化.md) |
| 2026-05-24 | chip_kinetic_ratios loadout 欄位 | 取代 | 上鏈後 immutable 的 chip kinetic_ratio | [D-20260524-05](D-20260524-05-weapon_branch廢除扁平化.md) |
| 2026-05-24 | weapon_branch | 取代 | weapon_mechanism／weapon_main_mesh_node／weapon_max_angle_deg | [D-20260524-05](D-20260524-05-weapon_branch廢除扁平化.md) |
| 2026-06-02 | config.onboarding.amount_minor | 取代 | 首次上鏈一次性負資產 | [D-20260602-01](D-20260602-01-首次上鏈負資產.md) |
| 2026-06-02 | OnboardingMintEvent | 取代 | 首次上鏈一次性負資產 | [D-20260602-01](D-20260602-01-首次上鏈負資產.md) |
| 2026-06-04 | reportWeight | 取代 | 仲裁者信譽權重 | [D-20260604-03](D-20260604-03-黑名單純仲裁.md) |
| 2026-06-04 | 加權檢舉數達 5 直接黑名單 | 取代 | 隨機合格仲裁面板加權裁決 | [D-20260604-03](D-20260604-03-黑名單純仲裁.md) |
| 2026-06-04 | FORK_DEPTH_MAX | 取代 | 兩筆 ancestors 與 parent 邊逐跳上溯 | [D-20260604-06](D-20260604-06-Fork-ancestors兩筆.md) |
| 2026-06-12 | K_THERMAL | 取代 | 牛頓冷卻溫差項 | [D-20260612-01](D-20260612-01-軸向慣例定錨.md) |
| 2026-06-12 | 環境溫度散熱率公式 | 取代 | 牛頓冷卻溫差項 | [D-20260612-01](D-20260612-01-軸向慣例定錨.md) |
| 2026-06-12 | 依節點編號排序／連號／跳號重編規則 | 取代 | track.route 與 track.checkpoints 陣列順序 | [D-20260612-04](D-20260612-04-節點名唯一順序extras.md) |
| 2026-06-27 | BuiltinAssetsUpdateEvent | 取代 | client major 發版與 CI 檢核 | [D-20260627-01](D-20260627-01-治理兩軌收斂.md) |
| 2026-06-27 | 混合型治理模型 | 取代 | economy_config 鏈上治理與其餘 client 發版兩軌 | [D-20260627-01](D-20260627-01-治理兩軌收斂.md) |
| 2026-06-27 | 材質廢止後轉 unusable 的流程 | 取代 | 純 client minor 與永久可玩的絕版品模型 | [D-20260627-02](D-20260627-02-材質廢止絕版品模型.md) |
| 2026-06-30 | reputation appendEvent／evidenceEventIds 防偽鏈 | 取代 | 來源事件本身的驗證 | [D-20260630-01](D-20260630-01-信譽純derive.md) |
| 2026-06-30 | ReputationEvent | 取代 | 來源事件的純 derive 信譽 | [D-20260630-01](D-20260630-01-信譽純derive.md) |
| 2026-06-30 | 信譽 reason 底線短名 | 取代 | 來源事件語意 | [D-20260630-01](D-20260630-01-信譽純derive.md) |
| 2026-07-02 | plagiarism／physics-cheat／low-quality report type | 取代 | copyright-violation／griefing／inappropriate-content／other | [D-20260702-01](D-20260702-01-檢舉仲裁體系大改.md) |
| 2026-07-02 | 新手仲裁豁免 | 移除 | — | [D-20260702-01](D-20260702-01-檢舉仲裁體系大改.md) |
| 2026-07-02 | ModerationActionEvent | 取代 | ArbitrationResultEvent 與離鏈 DMCA 維運 | [D-20260702-02](D-20260702-02-DMCA維運層化.md) |
| 2026-07-02 | 鏈上 DMCA 專屬事件 | 取代 | pinning 維運記錄與 client 下架清單 | [D-20260702-02](D-20260702-02-DMCA維運層化.md) |
| 2026-07-03 | SANITIZE_LIMITS | 取代 | 結構安全絕對天花板與 Stage 1–3 per-type 檢核 | [D-20260703-04](D-20260703-04-sanitize天花板與Worker邊界.md) |
| 2026-07-03 | antiAbuse.selfRewardCooldownHours | 取代 | 既有 cid 與 player 24 小時去重 | [D-20260703-07](D-20260703-07-治理可調鐵則.md) |
| 2026-07-03 | forkRewardChainDepthMax | 取代 | revShare.maxDepth | [D-20260703-07](D-20260703-07-治理可調鐵則.md) |
| 2026-07-03 | 公共池 | 取代 | 缺層份額與整除殘留歸當前創作者 | [D-20260703-09](D-20260703-09-公共池廢除.md) |
| 2026-07-05 | EmergencyRollbackEvent | 取代 | ConfigUpdateEvent | [D-20260705-01](D-20260705-01-治理事件單一族.md) |
| 2026-07-05 | SignerSetUpdateEvent | 取代 | ConfigUpdateEvent | [D-20260705-01](D-20260705-01-治理事件單一族.md) |
| 2026-07-06 | TrueSkill 浮點常數與普適 SIGMA_MIN | 取代 | 整數定點常數與僅限頻繁斷線的 sigma 托底 | [D-20260706-12](D-20260706-12-TrueSkill整數定點化.md) |
| 2026-07-06 | TRUESKILL_VW_TABLE_X1000 | 取代 | TRUESKILL_V_TABLE_X1000 與 TRUESKILL_W_TABLE_X1000 | [D-20260706-12](D-20260706-12-TrueSkill整數定點化.md) |
| 2026-07-06 | ts-trueskill | 取代 | 自製整數定點 TrueSkill | [D-20260706-12](D-20260706-12-TrueSkill整數定點化.md) |
| 2026-07-08 | 上傳期申訴案型 | 取代 | 檢舉下架後由正主重新上傳 | [D-20260708-06](D-20260708-06-流局寫no-quorum.md) |
| 2026-07-12 | cluster-paint 工具 | 取代 | 水密 sub-mesh 材質指派 | [D-20260712-01](D-20260712-01-材質統一水密sub-mesh.md) |
| 2026-07-12 | K-means 色域分群 | 取代 | 水密 sub-mesh 材質單位 | [D-20260712-01](D-20260712-01-材質統一水密sub-mesh.md) |
| 2026-07-20 | DMCA notice OrbitDB collection | 取代 | 節點本地 level 儲存 | [D-20260720-01](D-20260720-01-pinning架構A-prime.md) |
| 2026-07-20 | pinning Go app 架構 | 取代 | TypeScript ledger-peer app | [D-20260720-01](D-20260720-01-pinning架構A-prime.md) |
| 2026-07-22 | signaling /match 中央配對 | 取代 | GossipSub matchmaking | [D-20260722-01](D-20260722-01-signaling對齊match除名.md) |
| 2026-07-22 | signaling Cloudflare Workers 機制細節 | 取代 | Node adapter 現況與規劃中 adapter 邊界 | [D-20260722-01](D-20260722-01-signaling對齊match除名.md) |
| 2026-07-23 | landing presentation 型別／manifest landing 欄／festival 共用樣式 | 取代 | 主題自有視覺 | [D-20260723-01](D-20260723-01-主題StyleAPI-v1.md) |
| 2026-07-23 | 共享 skin profile 架構 | 取代 | 各主題自有 theme.css 與 Style API v1 | [D-20260723-01](D-20260723-01-主題StyleAPI-v1.md) |
| 2026-07-27 | /tracks／/track/:cid／/parts／/part/:cid | 取代 | /ugc 與 /ugc/:cid | [D-20260727-03](D-20260727-03-路由導覽與UGC公開入口收斂.md) |
| 2026-07-28 | GET /list | 取代 | 節點內部 ClusterClient.list | [D-20260728-01](D-20260728-01-Pinning公開列舉API移除.md) |
| 2026-07-28 | pinning 公開 cursor／page-size schema | 移除 | — | [D-20260728-01](D-20260728-01-Pinning公開列舉API移除.md) |
| 2026-07-28 | PinningProvider.listPinned | 取代 | 節點內部 ClusterClient.list | [D-20260728-01](D-20260728-01-Pinning公開列舉API移除.md) |
| 2026-08-02 | MatchmakerPoller | 取代 | 公開房查詢與加入 | [D-20260802-08](D-20260802-08-Quick-Match加入既有公開房.md) |
| 2026-08-02 | matchmaking/v1 match-request／match-offer | 取代 | rooms topic 的 RoomId 廣告 | [D-20260802-08](D-20260802-08-Quick-Match加入既有公開房.md) |
| 2026-08-02 | /race/:id/result | 取代 | 獨立 result route | [D-20260802-09](D-20260802-09-Race與Result路由識別分層.md) |
| 2026-08-02 | local-test matchId sentinel | 取代 | local session id | [D-20260802-09](D-20260802-09-Race與Result路由識別分層.md) |
| 2026-08-02 | 舊 Race／Result 路由參數 alias 與 migration parser | 取代 | 分層識別的 current routes | [D-20260802-09](D-20260802-09-Race與Result路由識別分層.md) |
| 2026-08-02 | /watch route | 取代 | /room/:roomId 與 /race/:sessionId | [D-20260802-10](D-20260802-10-持續RoomSession與共用Race生命週期.md) |
| 2026-08-08 | AllowForkChangeEvent／allow-fork-change | 取代 | 所有上鏈 UGC 一律可 fork | [D-20260808-04](D-20260808-04-上鏈UGC一律接受Fork.md) |
| 2026-08-08 | UGCMetadata.allowFork | 取代 | 所有上鏈 UGC 一律可 fork | [D-20260808-04](D-20260808-04-上鏈UGC一律接受Fork.md) |
| 2026-08-09 | bootstrap/list.txt | 取代 | 機器可讀 bootstrap manifest 權威 | [D-20260809-03](D-20260809-03-bootstrap清單權威收斂.md) |
| 2026-08-10 | RaceSnapshotEvent／race-snapshot | 取代 | 每回合唯一 RaceConsensusAnchorEvent | [D-20260810-03](D-20260810-03-回合唯一ConsensusAnchor與衝突失效.md) |
| 2026-08-10 | resolveFork／BranchInfo／FORK_RESOLUTION_* | 取代 | 同回合衝突即失效 | [D-20260810-03](D-20260810-03-回合唯一ConsensusAnchor與衝突失效.md) |
| 2026-08-10 | 賽內 longest-chain winner | 取代 | 唯一 anchor 與衝突失效 | [D-20260810-03](D-20260810-03-回合唯一ConsensusAnchor與衝突失效.md) |
| 2026-08-11 | battery auto_capacity_mah／capacity_mah | 取代 | auto_energy_capacity_mj／energyCapacityMj | [D-20260811-09](D-20260811-09-定點能量帳與全SOC線性供電.md) |
| 2026-08-11 | battery.output_w／battery.declared_output_w | 改名 | battery.configured_output_w | [D-20260811-09](D-20260811-09-定點能量帳與全SOC線性供電.md) |
| 2026-08-11 | chip kinetic_ratio | 改名 | allocation_pct | [D-20260811-09](D-20260811-09-定點能量帳與全SOC線性供電.md) |
| 2026-08-11 | K_DRAIN／K_DRAIN_FROM_J | 取代 | 整數 mW／mJ 能量帳 | [D-20260811-09](D-20260811-09-定點能量帳與全SOC線性供電.md) |
| 2026-08-11 | EconomyDerivedState.sponsorshipBoard／SponsorshipStat／updateSponsorshipBoard | 取代 | 作品永久贊助聚合投影 | [D-20260811-12](D-20260811-12-作品贊助永久聚合.md) |
| 2026-08-11 | garage-atmosphere | 改名 | garage-decoration | [D-20260811-15](D-20260811-15-StyleAPI-v1-Emitter雙向完整性.md) |
| 2026-08-11 | hero-art-frame | 改名 | hero-art-surface | [D-20260811-15](D-20260811-15-StyleAPI-v1-Emitter雙向完整性.md) |
| 2026-08-11 | shell-accent／panel-corner | 移除 | — | [D-20260811-15](D-20260811-15-StyleAPI-v1-Emitter雙向完整性.md) |
| 2026-08-14 | COLLISION_DAMAGE_SCALE | 取代 | contact-point normal energy + K_SHEAR_DAMAGE_TRANSFER | [D-20260814-04](D-20260814-04-接觸點撞擊與持續剪切傷害.md) |
| 2026-08-14 | K_BROKEN_ROLLER_BRAKE_RAD_S_PER_FRAME | 取代 | broken part physics deactivation + remaining assembly recomputation | [D-20260814-05](D-20260814-05-車輛零件損毀交易與純視覺碎片.md) |
| 2026-08-14 | K_BROKEN_TIRE_ROLLING_MULTIPLIER | 取代 | broken part physics deactivation + remaining assembly recomputation | [D-20260814-05](D-20260814-05-車輛零件損毀交易與純視覺碎片.md) |
| 2026-08-14 | SavedState v12／v16／builtin v10／receipt v2 候選名稱 | 取代 | 唯一 v1 current shape | [D-20260814-24](D-20260814-24-Pre-launch自有版本統一v1.md) |
| 2026-08-14 | 未公開自有 v2+ current baseline | 取代 | 完整 current shape 的 v1 baseline | [D-20260814-24](D-20260814-24-Pre-launch自有版本統一v1.md) |
| 2026-08-15 | MatchResultEvent.baseLogHeadCids／roundAnchorCids | 取代 | 每回合內嵌 RaceConsensusAnchorEvent | [D-20260815-03](D-20260815-03-CanonicalFold自包含比賽結算.md) |
| 2026-08-15 | MatchResultEvent.economySettlement | 取代 | canonical fold 位置的 DerivedState 結算 | [D-20260815-03](D-20260815-03-CanonicalFold自包含比賽結算.md) |
| 2026-08-15 | verifySettlement | 取代 | canonical fold 純函數重算 | [D-20260815-03](D-20260815-03-CanonicalFold自包含比賽結算.md) |
| 2026-08-15 | 結算 frontier／payout wire | 取代 | 由 fold 位置唯一推導 | [D-20260815-03](D-20260815-03-CanonicalFold自包含比賽結算.md) |
| 2026-08-16 | GossipSub spectator-chat topic／payload／adapter／public ChatData capability | 取代 | waiting RoomPage 文字聊天與 RacePage participant 圖示訊息 | [D-20260816-09](D-20260816-09-觀戰公開Payload與StreamCredential分離.md) |
| 2026-08-16 | join-request displayName | 改名 | nicknameSnapshot | [D-20260816-09](D-20260816-09-觀戰公開Payload與StreamCredential分離.md) |
| 2026-08-16 | spectator wrong-password 拒因 | 取代 | credential 失敗統一 join-rejected | [D-20260816-09](D-20260816-09-觀戰公開Payload與StreamCredential分離.md) |
| 2026-08-16 | stream plane password／invitation | 取代 | room snapshot admission 與 source assignment | [D-20260816-09](D-20260816-09-觀戰公開Payload與StreamCredential分離.md) |
| 2026-08-16 | /assets/i18n/*.json | 取代 | 隨 application bundle 產生的 lazy locale chunks | [D-20260816-11](D-20260816-11-前端靜態內容路徑收斂.md) |
| 2026-08-16 | public/announcements/&lt;id&gt;/ | 改名 | public/assets/announcements/&lt;id&gt;/ | [D-20260816-11](D-20260816-11-前端靜態內容路徑收斂.md) |
| 2026-08-16 | 公版 part 單檔 104 KiB 預算 | 取代 | 公版 part 單檔 112 KiB 預算 | [D-20260816-12](D-20260816-12-完整PhysicsManifest零件預算.md) |
| 2026-08-17 | BOOTSTRAP_NODES_RECOMMENDED | 改名 | LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | DHT_REFRESH_INTERVAL_MS | 改名 | DHT_QUERY_SELF_INTERVAL_MS | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | GOSSIPSUB_FANOUT | 改名 | GOSSIPSUB_MESH_DEGREE | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | ORBITDB_REPLICATION_FACTOR | 取代 | LEDGER_PROVIDER_FAULT_DOMAINS_RECOMMENDED | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | PEER_SCORE_DECAY_PER_SEC | 移除 | — | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | PEER_SCORE_THRESHOLD_GRAYLIST | 取代 | GOSSIPSUB_SCORE_GOSSIP_THRESHOLD | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | PEER_SCORE_THRESHOLD_REJECT | 取代 | GOSSIPSUB_SCORE_PUBLISH_THRESHOLD | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | PROTOCOL_COMPATIBILITY_MODE | 移除 | — | [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md) |
| 2026-08-17 | INPUT_DELAY_FRAMES | 移除 | — | [D-20260817-03](D-20260817-03-比賽執行常數與賽前窄路警告收斂.md) |
| 2026-08-17 | MAX_COLLISION_PAIRS_PER_FRAME | 移除 | — | [D-20260817-03](D-20260817-03-比賽執行常數與賽前窄路警告收斂.md) |
| 2026-08-17 | RACE_COUNTDOWN_DIGIT_MS | 改名 | STARTUP_COUNTDOWN_TICK_MS | [D-20260817-03](D-20260817-03-比賽執行常數與賽前窄路警告收斂.md) |
| 2026-08-17 | TIME_STEP_X1000 | 移除 | — | [D-20260817-03](D-20260817-03-比賽執行常數與賽前窄路警告收斂.md) |
| 2026-08-17 | app.tagline_long | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | BREAKPOINT_DESKTOP_PX | 取代 | CSS/SCSS 90em breakpoint 與 ui-breakpoints gate | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | BREAKPOINT_MOBILE_PX | 取代 | CSS/SCSS 40em breakpoint 與 ui-breakpoints gate | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | BREAKPOINT_TABLET_PX | 取代 | CSS/SCSS 64em breakpoint 與用途導向 editor query | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | EDITOR_DEFAULT_LAPS | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | EDITOR_DESIGN_SPEED_M_S | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | GARAGE_GRID_COLS | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | HEADER_HEIGHT_PX | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | HERO_TAGLINE_KEY | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | LOOP_ROUTE_COMFORT_M | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | LOOP_ROUTE_TARGET_M | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | REDUCED_MOTION_FACTOR | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | ROBOTS_PATH | 取代 | generate-seo.mjs output path | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | SIDEBAR_WIDTH_PX | 移除 | — | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | SITEMAP_PATH | 取代 | generate-seo.mjs output path | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | TAGLINE_KEY | 取代 | 直接使用 app.tagline | [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md) |
| 2026-08-17 | ECONOMY_CONFIG_DEFAULTS | 取代 | src/economy/config.ts GENESIS_ECONOMY_CONFIG | [D-20260817-05](D-20260817-05-EconomyConfig單一Runtime權威.md) |
| 2026-08-17 | system-constants EconomyConfig interface | 取代 | src/economy/config.ts EconomyConfig | [D-20260817-05](D-20260817-05-EconomyConfig單一Runtime權威.md) |
| 2026-08-17 | system-constants ForkDetectionConfig | 取代 | EconomyConfig.forkDetection | [D-20260817-05](D-20260817-05-EconomyConfig單一Runtime權威.md) |
| 2026-08-17 | system-constants RevShareConfig | 取代 | EconomyConfig.revShare | [D-20260817-05](D-20260817-05-EconomyConfig單一Runtime權威.md) |
| 2026-08-17 | SANITIZE_MAX_MEMORY_MB | 移除 | — | [D-20260817-06](D-20260817-06-Sanitize與文字過濾只保留可執行權威.md) |
| 2026-08-17 | TEXT_BLACKLIST_MATCH_MODE | 移除 | — | [D-20260817-06](D-20260817-06-Sanitize與文字過濾只保留可執行權威.md) |
| 2026-08-17 | MatchRules.disallowChip | 取代 | RoundConfig.disallowChip | [D-20260817-07](D-20260817-07-Quick-Match摘要與逐回合晶片規則收斂.md) |
| 2026-08-17 | Quick Match discovery summary mode | 移除 | — | [D-20260817-07](D-20260817-07-Quick-Match摘要與逐回合晶片規則收斂.md) |
| 2026-08-17 | Quick Match discovery summary rulesKey | 移除 | — | [D-20260817-07](D-20260817-07-Quick-Match摘要與逐回合晶片規則收斂.md) |

## 共識帳本（25）

- [D-20260524-01](D-20260524-01-SignerSet治理quorum.md)｜Signer Set 治理 quorum＝floor(2N/3)+1
- [D-20260524-02](D-20260524-02-賽後結算多訊息協議.md)｜賽後結算多訊息協議（30 秒結算窗＋5 秒接手窗）
- [D-20260531-03](D-20260531-03-結算快照簽章門檻.md)｜結算／賽中快照簽章門檻統一過半數
- [D-20260604-02](D-20260604-02-Checkpoint三同名拆開.md)｜Checkpoint 三同名拆開
- [D-20260604-04](D-20260604-04-SignedPayload簽章四欄.md)｜SignedPayload 簽章涵蓋四欄
- [D-20260706-12](D-20260706-12-TrueSkill整數定點化.md)｜TrueSkill 全整數定點化
- [D-20260706-14](D-20260706-14-簽章位元組結構釘死.md)｜簽章位元組結構釘死＋Race Sign Key 派生式（amends D-20260604-04）
- [D-20260708-01](D-20260708-01-wire編碼dag-cbor.md)｜gossip wire 編碼定案 dag-cbor
- [D-20260708-03](D-20260708-03-fold層統一決定性守門.md)｜fold 層統一決定性守門
- [D-20260708-04](D-20260708-04-收件嚴格化整包拒收.md)｜match-result 收件嚴格化＝整包拒收
- [D-20260708-05](D-20260708-05-foldGuard-timeless形.md)｜foldGuard timeless 形＝多簽簽章集 fold 恆驗
- [D-20260709-02](D-20260709-02-fold守門原則.md)｜fold 守門原則
- [D-20260710-02](D-20260710-02-deriveMatchId定式.md)｜deriveMatchId 定式＝matchId 由名單推導
- [D-20260710-03](D-20260710-03-settledMatchIds持久去重集.md)｜settledMatchIds 持久去重集
- [D-20260710-06](D-20260710-06-定稿鏈上確認與roster共識輪.md)｜定稿＝鏈上確認唯一出口＋roster 共識輪（amends D-20260524-02）
- [D-20260719-01](D-20260719-01-LedgerAdmission-v1.md)｜Ledger Admission v1（固定參數 PoW 寫入門檻）
- [D-20260728-05](D-20260728-05-Ledger-Genesis-Bring-up.md)｜Ledger genesis 與 replica bring-up（amends D-20260524-01、D-20260713-01）
- [D-20260731-04](D-20260731-04-ledger-chain-identity貫穿邊界.md)｜ledger chain identity 貫穿簽章、mutable storage 與 topic（amends D-20260731-02）
- [D-20260810-02](D-20260810-02-MatchResult固定名單門檻與離場存證.md)｜MatchResult 固定名單門檻與離場存證（amends D-20260531-03、D-20260710-06、D-20260802-03）
- [D-20260810-03](D-20260810-03-回合唯一ConsensusAnchor與衝突失效.md)｜回合唯一 Consensus Anchor 與衝突失效（amends D-20260531-03、D-20260604-02、D-20260703-08、D-20260708-04）
- [D-20260812-06](D-20260812-06-治理信任根與比賽傳輸契約單一化.md)｜治理信任根與比賽傳輸契約單一化（amends D-20260706-05、D-20260721-01）
- [D-20260814-16](D-20260814-16-Onboarding正式鏈Mutation集中授權.md)｜Onboarding 正式鏈 Mutation 集中授權（amends D-20260811-17）
- [D-20260814-18](D-20260814-18-玩家賽事歷史有界冷分頁.md)｜玩家賽事歷史採有界 cold lazy pagination
- [D-20260814-19](D-20260814-19-鏈重生完整來源檢查點證明.md)｜鏈重生完整來源檢查點證明（amends D-20260706-05、D-20260728-05）
- [D-20260815-03](D-20260815-03-CanonicalFold自包含比賽結算.md)｜Canonical fold 自包含比賽結算（amends D-20260703-07、D-20260703-08、D-20260708-05、D-20260709-01、D-20260710-06、D-20260802-11、D-20260810-03）

## 經濟（12）

- [D-20260531-02](D-20260531-02-三層分潤702010.md)｜三層分潤＝current 70／parent 20／grandparent 10
- [D-20260601-01](D-20260601-01-niche線性化與倉庫收斂.md)｜niche 加成線性化＋車位／場地位收斂上鏈倉庫
- [D-20260602-01](D-20260602-01-首次上鏈負資產.md)｜移除冷啟動禮＝首次上鏈負資產
- [D-20260602-02](D-20260602-02-斷線結算finisherCount.md)｜斷線結算＝forfeit＋finisherCount＋不足 3 人經濟 void
- [D-20260703-07](D-20260703-07-治理可調鐵則.md)｜治理可調鐵則＝config 僅 event-creation 消費
- [D-20260703-08](D-20260703-08-settlement收件全網重算.md)｜settlement 收件全網重算＋`mintEligible`＋base 新鮮度錨
- [D-20260703-09](D-20260703-09-公共池廢除.md)｜「公共池」概念廢除＝缺層份額歸當前創作者（amends D-20260531-02）
- [D-20260708-08](D-20260708-08-upload收費fork免費.md)｜上鏈收費限 `UgcUploadEvent`、`UgcForkEvent`＝免費血緣宣告
- [D-20260709-01](D-20260709-01-鑄幣月硬頂.md)｜鑄幣月硬頂 `month_hard_cap_minor`＝fold 端全域守門
- [D-20260811-12](D-20260811-12-作品贊助永久聚合.md)｜作品贊助改為永久 UGC 聚合
- [D-20260811-16](D-20260811-16-經濟月流水與創作者收益衍生讀模型.md)｜經濟月流水與創作者收益衍生讀模型
- [D-20260817-01](D-20260817-01-鑄幣來源限比賽與創作.md)｜鑄幣來源限比賽與創作

## UGC版權（26）

- [D-20260525-02](D-20260525-02-GLB上鏈後不可修改.md)｜「GLB 上鏈後皆不可修改」共通鐵則與房間設定劃界
- [D-20260531-01](D-20260531-01-三階段創作流程.md)｜創作流程四階段改三階段、組裝獨立 `/garage`
- [D-20260604-06](D-20260604-06-Fork-ancestors兩筆.md)｜Fork `ancestors` 收斂為至多兩筆、`FORK_DEPTH_MAX` 移除
- [D-20260703-05](D-20260703-05-灰區similarity-pending.md)｜灰區上傳改制 similarity-pending：立即上鏈＋經濟隔離待審
- [D-20260703-06](D-20260703-06-授權不可撤銷與AI條款.md)｜上傳授權永久不可撤銷＋AI 內容條款
- [D-20260705-05](D-20260705-05-送出分岔兩出口.md)｜送出分岔兩出口：本機測試與上鏈共用同一管線
- [D-20260708-07](D-20260708-07-antipiracy收件僅on-chain.md)｜anti-piracy 宣告收件驗證只看 on-chain active 集合
- [D-20260708-09](D-20260708-09-similarity公式v1.md)｜`computeFeatureSimilarity` v1 定案：五維相對差 ppm 取 max
- [D-20260717-01](D-20260717-01-車位權威化與公開UGC收斂.md)｜車位用途權威化與公開 UGC 收斂（part 與 track）
- [D-20260728-02](D-20260728-02-DMCA-Admin雙重閘與自架Swagger.md)｜DMCA Admin 雙重閘與自架 Swagger（amends D-20260706-04、D-20260720-01、D-20260724-01）
- [D-20260728-03](D-20260728-03-UGC混合下載與流量邊界.md)｜UGC 混合下載與伺服器流量邊界（amends D-20260720-01）
- [D-20260730-01](D-20260730-01-GLB公尺端到端.md)｜GLB 與 runtime 統一採公尺 canonical world（amends D-20260516-01、D-20260612-01、D-20260612-02、D-20260703-04）
- [D-20260730-02](D-20260730-02-Part匯入自動縮放減面與掛點.md)｜Part 首次匯入自動縮放、減面與掛點（amends D-20260730-01）
- [D-20260803-02](D-20260803-02-UGC-GLB使用raw-CID.md)｜UGC GLB 使用 raw CID（superseded → D-20260804-02；amends D-20260525-02）
- [D-20260803-03](D-20260803-03-Pinning無官方節點與開發期baseline-v1.md)｜Pinning 無官方節點，開發期 baseline 重設為 v1（amends D-20260706-02、D-20260724-01、D-20260728-01）
- [D-20260803-04](D-20260803-04-Provider-scoped-DMCA與私有簽章收件匣.md)｜Provider-scoped DMCA 與私有簽章收件匣（amends D-20260702-02、D-20260706-04、D-20260708-07、D-20260720-01、D-20260727-03、D-20260728-02、D-20260803-03）
- [D-20260803-05](D-20260803-05-UGC-CAR保存與exact-root本機補回.md)｜UGC CAR 保存與 exact-root 本機補回（superseded → D-20260804-02；amends D-20260803-02、D-20260802-14）
- [D-20260804-01](D-20260804-01-Provider-root-scoped-UGC讀取.md)｜Provider root-scoped UGC 讀取與通用供應面隔離（amends D-20260728-03、D-20260803-04、D-20260803-06）
- [D-20260804-02](D-20260804-02-canonical-multiblock-UGC.md)｜Canonical multi-block UnixFS UGC 與多來源取得（supersedes D-20260803-02、D-20260803-05；amends D-20260804-01）
- [D-20260804-03](D-20260804-03-Pinning邏輯實體配額與共同Admission.md)｜Pinning 邏輯／實體配額與共同 Admission（amends D-20260720-01、D-20260728-04、D-20260803-03）
- [D-20260805-01](D-20260805-01-第一層Provider-scoped-Inbox與本機最小快照.md)｜第一層 Provider-scoped Inbox 與本機最小快照（amends D-20260803-04）
- [D-20260808-04](D-20260808-04-上鏈UGC一律接受Fork.md)｜上鏈 UGC 一律接受 Fork
- [D-20260808-05](D-20260808-05-GLB匯出為可編輯衍生檔.md)｜GLB 匯出為可編輯衍生檔（amends D-20260730-01、D-20260730-02）
- [D-20260809-01](D-20260809-01-身分資產庫與UGC選擇器.md)｜身分資產庫與 UGC 選擇器（amends D-20260717-01、D-20260802-14、D-20260808-06）
- [D-20260816-08](D-20260816-08-UGCPresentationMetadata可變修訂.md)｜UGC Presentation Metadata 可變修訂（amends D-20260810-02、D-20260810-03、D-20260815-03）
- [D-20260818-04](D-20260818-04-UGCPresentationCanonicalClock投影.md)｜UGC Presentation canonical clock 投影（amends D-20260816-08）

## 材質（6）

- [D-20260520-01](D-20260520-01-材質系統重構31種.md)｜材質系統重構：34→31 種、磁源移建模層、thermal_limit 閾值化
- [D-20260522-01](D-20260522-01-impact廢除磁性合併.md)｜材質欄位簡化：impact 廢除、磁性合併 magnetism_role
- [D-20260523-01](D-20260523-01-材質id不可變與PR流程.md)｜材質 id 發布即不可變＋生命週期 PR 流程
- [D-20260612-03](D-20260612-03-材質廢止append-only.md)｜材質廢止＝append-only、永不物理刪除（superseded → D-20260627-02）
- [D-20260627-02](D-20260627-02-材質廢止絕版品模型.md)｜材質廢止＝純 client minor＋「絕版品」模型（supersedes D-20260612-03）
- [D-20260712-01](D-20260712-01-材質統一水密sub-mesh.md)｜材質指派模型統一為水密 sub-mesh

## 建模物理（43）

- [D-20260429-01](D-20260429-01-socketType廢除前綴匹配.md)｜`socketType` 廢除＝Mount 前綴匹配＋canonical 尺寸 lenient 檢核
- [D-20260516-01](D-20260516-01-Motor-Battery能量模型.md)｜Motor / Battery 能量模型＝宣告功率＋查表耗電（I²R 廢除）
- [D-20260516-02](D-20260516-02-Skill八種Stats八項.md)｜Skill enum 8 種＋Stats 8 項
- [D-20260517-01](D-20260517-01-武器分支樹Mount單層.md)｜武器分支樹（master/slave）＋Mount 單層（superseded → D-20260628-01）
- [D-20260518-01](D-20260518-01-武器欄位簡化.md)｜武器欄位簡化＝`main_mesh_node` 單一欄＋動態磁力
- [D-20260524-03](D-20260524-03-DeterministicWorld與Rapier鎖版.md)｜`DeterministicWorld` 介面＋Rapier 版本鎖定
- [D-20260524-04](D-20260524-04-武器方向Mount配對.md)｜武器方向＝Mount transform 配對、組裝不調向
- [D-20260524-05](D-20260524-05-weapon_branch廢除扁平化.md)｜`weapon_branch` 容器廢除＝三獨立 extras 扁平化
- [D-20260525-01](D-20260525-01-Checkpoint有序關卡.md)｜Checkpoint＝有序防抄近路關卡
- [D-20260528-01](D-20260528-01-route-Hermite-spline模型.md)｜route＝貼表面 Hermite spline 模型
- [D-20260609-01](D-20260609-01-接觸係數合成不變式.md)｜接觸係數合成＝`Average` 全域不變式
- [D-20260611-01](D-20260611-01-公版三變體軸.md)｜公版三變體軸統一 speed / heavy / control
- [D-20260612-01](D-20260612-01-軸向慣例定錨.md)｜全域軸向慣例定錨（高＝+Y、車頭＝−Z）
- [D-20260612-02](D-20260612-02-chip-slot體積階梯.md)｜chip slot 體積階梯門檻定錨
- [D-20260612-04](D-20260612-04-節點名唯一順序extras.md)｜節點名唯一＋順序語義改 extras 承載
- [D-20260628-01](D-20260628-01-武器multi-actuator統一.md)｜武器 multi-actuator 統一模型（`weapon_actuators[]`）（supersedes D-20260517-01）
- [D-20260628-02](D-20260628-02-磁源兩套劃界.md)｜磁源兩套系統劃界（武器僅 active／材質型僅場地）
- [D-20260706-06](D-20260706-06-被動加持三因子.md)｜被動武器加持＝三因子模型
- [D-20260807-02](D-20260807-02-公版起跑扭矩與極速衝量鉗制.md)｜公版起跑扭矩與極速衝量鉗制（amends D-20260516-01、D-20260524-03）
- [D-20260807-03](D-20260807-03-輪組Revolute接觸驅動.md)｜輪組 Revolute 接觸驅動（amends D-20260524-03、D-20260524-04、D-20260612-01、D-20260807-02）
- [D-20260808-01](D-20260808-01-route與respawn完整surface-frame.md)｜route 與 respawn 完整 surface frame（amends D-20260528-01、D-20260612-01）
- [D-20260808-03](D-20260808-03-武器執行期物理拓撲.md)｜武器執行期物理拓撲（amends D-20260628-01）
- [D-20260811-02](D-20260811-02-Canonical-PhysicsManifest與一次性Admission.md)｜Canonical PhysicsManifest 與一次性 Admission receipt（amends D-20260528-02、D-20260804-02、D-20260811-01）
- [D-20260811-03](D-20260811-03-TrackEntity決定性Runtime與預配置碎片池.md)｜Track Entity 決定性 Runtime 與預配置碎片池（amends D-20260707-01、D-20260811-02）
- [D-20260811-04](D-20260811-04-逐Collider材質接觸與滾動阻力.md)｜逐 Collider 材質接觸與滾動阻力（amends D-20260609-01、D-20260807-03）
- [D-20260811-05](D-20260811-05-能量域熱模型與固定熱庫接觸.md)｜能量域熱模型與固定熱庫接觸（amends D-20260516-01、D-20260712-01、D-20260811-02、D-20260811-04）
- [D-20260811-06](D-20260811-06-輪組二元損壞與固定驅動份額.md)｜輪組二元損壞與固定驅動份額（amends D-20260516-01、D-20260807-03、D-20260811-04、D-20260811-05）
- [D-20260811-07](D-20260811-07-相對氣流六軸Aero與決定性Weather-Patch.md)｜相對氣流六軸 Aero 與決定性 Weather Patch（amends D-20260612-01、D-20260811-02、D-20260811-04、D-20260811-06）
- [D-20260811-09](D-20260811-09-定點能量帳與全SOC線性供電.md)｜定點能量帳與全 SOC 線性供電（amends D-20260516-01、D-20260524-05、D-20260706-06、D-20260811-02、D-20260811-05）
- [D-20260811-10](D-20260811-10-逐Region接觸耗散輪胎磨耗.md)｜逐 Region 接觸耗散輪胎磨耗（amends D-20260712-01、D-20260811-04、D-20260811-05、D-20260811-06）
- [D-20260811-11](D-20260811-11-場地硬規則與Receipt-Gated-Runtime.md)｜場地硬規則與 Receipt-Gated Runtime（amends D-20260811-01、D-20260811-02）
- [D-20260811-14](D-20260811-14-材質Capability與介面嚴外形寬.md)｜材質 Capability 與「介面嚴、外形寬」（amends D-20260429-01、D-20260811-04、D-20260811-05）
- [D-20260814-01](D-20260814-01-終點與KillZone改採COM掃掠判定.md)｜終點與 KillZone 改採 chassis COM 掃掠判定（amends D-20260525-01、D-20260528-01）
- [D-20260814-02](D-20260814-02-fluid-projectile部署區生命週期.md)｜fluid projectile 部署區生命週期（amends D-20260808-03、D-20260706-06）
- [D-20260814-03](D-20260814-03-逐Collider六向衝撞接觸面積.md)｜逐 Collider 六向衝撞接觸面積（amends D-20260811-04、D-20260811-14）
- [D-20260814-04](D-20260814-04-接觸點撞擊與持續剪切傷害.md)｜接觸點撞擊與持續剪切傷害（amends D-20260808-03、D-20260814-03）
- [D-20260814-05](D-20260814-05-車輛零件損毀交易與純視覺碎片.md)｜車輛零件損毀交易與純視覺碎片（amends D-20260802-12、D-20260811-06、D-20260811-14、D-20260812-02）
- [D-20260814-06](D-20260814-06-場地碎片統一純視覺.md)｜場地碎片統一純視覺（amends D-20260811-03、D-20260814-02、D-20260814-03、D-20260814-05）
- [D-20260814-07](D-20260814-07-Gameplay動態剛體HardCCD.md)｜Gameplay 動態剛體 hard CCD（amends D-20260808-03、D-20260814-01、D-20260814-05、D-20260814-06）
- [D-20260814-08](D-20260814-08-Projectile-LaunchExit幾何離膛.md)｜Projectile LaunchExit 幾何離膛（amends D-20260807-03、D-20260808-03、D-20260814-07）
- [D-20260814-21](D-20260814-21-整車零件質量比依正式資產校準.md)｜整車零件質量比依正式資產校準（amends D-20260629-01、D-20260706-06）
- [D-20260816-12](D-20260816-12-完整PhysicsManifest零件預算.md)｜完整 PhysicsManifest 公版零件預算（amends D-20260808-03）
- [D-20260817-03](D-20260817-03-比賽執行常數與賽前窄路警告收斂.md)｜比賽執行常數與賽前窄路警告收斂（amends D-20260707-01）

## 比賽房間（37）

- [D-20260604-05](D-20260604-05-配對窗口.md)｜配對窗口定案：±5／每 10 秒放寬 +5／上限 ±30
- [D-20260629-01](D-20260629-01-組裝房間劃界.md)｜組裝與房間劃界：車庫造車、房間設比賽、Tamiya 軟性化
- [D-20260630-02](D-20260630-02-多回合積分制三層正名.md)｜多回合積分制與 Match／Round／Race 三層正名
- [D-20260705-03](D-20260705-03-比賽頁橫向翻案與鍵位.md)｜比賽頁方向政策翻案與 gameplay 鍵位收斂
- [D-20260710-01](D-20260710-01-loadout參與證明.md)｜loadout 簽章綁 matchId＝參與證明
- [D-20260710-04](D-20260710-04-等待房star拓撲.md)｜等待房 star 拓撲：兩層網路劃界
- [D-20260710-05](D-20260710-05-入房密碼挑戰應答.md)｜入房密碼挑戰-應答與成員端 match-start 校驗
- [D-20260716-01](D-20260716-01-連線狀態機離線能力.md)｜App Shell 唯一連線狀態機與離線能力模型
- [D-20260726-02](D-20260726-02-禁用晶片改為逐回合規則.md)｜禁用晶片改為逐回合規則（amends D-20260630-02）
- [D-20260802-01](D-20260802-01-RoomId房間實例識別.md)｜RoomId＝不可重用的房間實例識別（amends D-20260710-02、D-20260710-04、D-20260710-05）
- [D-20260802-02](D-20260802-02-GO前race-ready屏障.md)｜GO 前全員 race-ready 屏障（amends D-20260710-02、D-20260710-06）
- [D-20260802-03](D-20260802-03-三平面連線與分割安全定稿.md)｜三平面連線與分割安全定稿（amends D-20260710-06、D-20260802-02）
- [D-20260802-04](D-20260802-04-participantPassword建房後不可變.md)｜participantPassword 建房後不可變（amends D-20260710-05）
- [D-20260802-05](D-20260802-05-spectator-policy建房與waiting更新.md)｜spectator policy 建房與 waiting 更新（amends D-20260710-05、D-20260802-04）
- [D-20260802-06](D-20260802-06-active加reserved原子容量.md)｜active + reserved 原子容量（amends D-20260802-05）
- [D-20260802-07](D-20260802-07-RoomSession角色化admission.md)｜RoomSession 角色化 admission（amends D-20260710-04、D-20260710-05、D-20260802-05、D-20260802-06）
- [D-20260802-08](D-20260802-08-Quick-Match加入既有公開房.md)｜Quick Match 加入既有公開房（amends D-20260726-02、D-20260731-02、D-20260802-06）
- [D-20260802-09](D-20260802-09-Race與Result路由識別分層.md)｜Race 與 Result 路由識別分層（amends D-20260727-03、D-20260802-01、D-20260802-07）
- [D-20260802-10](D-20260802-10-持續RoomSession與共用Race生命週期.md)｜持續 RoomSession 與共用 Race 生命週期（amends D-20260710-04、D-20260727-03、D-20260802-07、D-20260802-09）
- [D-20260802-11](D-20260802-11-觀戰可驗結果與共用Result生命週期.md)｜觀戰可驗結果與共用 Result 生命週期（amends D-20260524-02、D-20260710-06、D-20260802-10）
- [D-20260802-12](D-20260802-12-觀戰公開報廢presentation快照.md)｜觀戰公開報廢 presentation 快照（amends D-20260710-06、D-20260802-03）
- [D-20260803-06](D-20260803-06-runtime-provider全面社群化.md)｜Runtime provider 全面社群化（amends D-20260706-02、D-20260706-03、D-20260713-01、D-20260724-01、D-20260728-04、D-20260731-03、D-20260803-03、D-20260803-04）
- [D-20260806-01](D-20260806-01-OPAQUE角色邀請驗證.md)｜OPAQUE 角色邀請驗證（amends D-20260710-05、D-20260802-04、D-20260802-05、D-20260802-07）
- [D-20260809-04](D-20260809-04-玩家收藏與等待房授權快照.md)｜玩家收藏與等待房授權快照（amends D-20260710-05、D-20260802-04、D-20260802-05、D-20260802-07、D-20260806-01、D-20260808-06）
- [D-20260809-06](D-20260809-06-SignalingWorker採SocketPresenceLiveness.md)｜Signaling Worker 採 Socket Presence Liveness（amends D-20260722-01、D-20260729-02）
- [D-20260810-01](D-20260810-01-跟車距離與世界水平穩定視角.md)｜跟車距離與世界水平穩定視角（amends D-20260802-10）
- [D-20260812-02](D-20260812-02-觀戰Deterministic-Replay與精簡Fallback.md)｜觀戰 Deterministic Replay 與精簡 Fallback（amends D-20260802-12）
- [D-20260812-05](D-20260812-05-首發前Wire與Ledger欄位必填化.md)｜首發前 Wire 與 Ledger 欄位必填化（amends D-20260802-03、D-20260802-11）
- [D-20260814-09](D-20260814-09-回合名次與失能終局.md)｜回合名次與失能終局（amends D-20260802-11、D-20260802-12、D-20260814-05）
- [D-20260814-10](D-20260814-10-直接致毀破壞歸因.md)｜直接致毀破壞歸因（amends D-20260802-11、D-20260812-05、D-20260814-05）
- [D-20260814-11](D-20260814-11-技能停用權威投影.md)｜技能停用權威投影（amends D-20260726-02、D-20260814-09）
- [D-20260814-20](D-20260814-20-多人可驗算起跑格.md)｜多人可驗算起跑格（amends D-20260808-01、D-20260802-02）
- [D-20260814-23](D-20260814-23-Ready提交驗證與倒數.md)｜Ready 提交驗證與自動倒數（amends D-20260710-01、D-20260710-02、D-20260710-04、D-20260802-02、D-20260814-20）
- [D-20260816-01](D-20260816-01-等待房文字與賽中圖示訊息分層.md)｜等待房文字與賽中圖示訊息分層（amends D-20260710-04、D-20260731-02、D-20260802-10、D-20260812-02）
- [D-20260816-02](D-20260816-02-封鎖衝突改採房內本機警示.md)｜封鎖衝突改採房內本機警示（amends D-20260702-01）
- [D-20260816-09](D-20260816-09-觀戰公開Payload與StreamCredential分離.md)｜觀戰公開 Payload 與 Stream Credential 分離（amends D-20260802-07、D-20260806-01、D-20260812-02、D-20260816-01、D-20260816-03）
- [D-20260817-07](D-20260817-07-Quick-Match摘要與逐回合晶片規則收斂.md)｜Quick Match 摘要與逐回合晶片規則收斂（amends D-20260726-02、D-20260802-08）

## 信譽仲裁（10）

- [D-20260604-03](D-20260604-03-黑名單純仲裁.md)｜玩家黑名單改純仲裁：廢加權檢舉快速路徑（superseded → D-20260702-01）
- [D-20260606-01](D-20260606-01-新手保護統一.md)｜新手保護統一：砍時間衰減與配對 boost、窗口定 7 天
- [D-20260630-01](D-20260630-01-信譽純derive.md)｜信譽＝純 derive、無獨立 ledger 事件
- [D-20260702-01](D-20260702-01-檢舉仲裁體系大改.md)｜檢舉／仲裁體系大改：類型 4 種、面板 7 quorum 4、三振黑名單（supersedes D-20260604-03）
- [D-20260702-02](D-20260702-02-DMCA維運層化.md)｜DMCA 全維運層化：兩層下架與 Repeat Infringer 拒服務
- [D-20260703-11](D-20260703-11-仲裁票集合與刷分堵洞.md)｜仲裁票集合定案與 void 場信譽刷分堵洞
- [D-20260708-06](D-20260708-06-流局寫no-quorum.md)｜流局翻案：寫 no-quorum 事件、申訴案型移除（amends D-20260702-01、D-20260703-05）
- [D-20260816-04](D-20260816-04-本機文字顯示過濾與starter匯入.md)｜本機文字顯示過濾與 starter 匯入（amends D-20260703-06）
- [D-20260816-07](D-20260816-07-仲裁收件與結果自證責任分層.md)｜仲裁收件與結果自證責任分層（amends D-20260703-11）
- [D-20260817-06](D-20260817-06-Sanitize與文字過濾只保留可執行權威.md)｜Sanitize 與文字過濾只保留可執行權威（amends D-20260703-04、D-20260816-04）

## 版本部署（45）

- [D-20260528-02](D-20260528-02-B軸schema版本系統.md)｜B 軸：UGC 資產 schema 版本系統
- [D-20260703-02](D-20260703-02-B軸掛client-major與升級通道.md)｜B 軸掛 client major 發版軸＋升級通道收斂
- [D-20260703-03](D-20260703-03-房間pin檢查點政策.md)｜房間 pin 檢查點政策：正式檢查點＋72 小時上限＋idle guard
- [D-20260704-03](D-20260704-03-域名遷移機制.md)｜域名遷移機制：無資料搬運＋CI 不變式＋301 herding
- [D-20260705-06](D-20260705-06-D1部署模型.md)｜D1 部署模型：一 repo＝一部署單元＝一條 CI（superseded → D-20260706-02）
- [D-20260706-02](D-20260706-02-週邊repo-Template化.md)｜週邊 repo 全面 Template 化：公版零 secrets＋部署 repo 同路（supersedes D-20260705-06）
- [D-20260706-03](D-20260706-03-TURN公版先建不部署.md)｜TURN 公版先建不部署：需要時與社群同路
- [D-20260706-04](D-20260706-04-DMCA維運補強包.md)｜DMCA 維運補強包：admin 端點＋防濫用三件組＋反通知入口
- [D-20260706-05](D-20260706-05-信任根與復原階梯.md)｜鏈身分信任根＋經濟壞損復原階梯
- [D-20260713-01](D-20260713-01-三階部署狀態.md)｜三階部署狀態：development／private-playtest／public（amends D-20260524-01）
- [D-20260720-01](D-20260720-01-pinning架構A-prime.md)｜pinning 架構 A′：Go 退場、app 收斂為 TypeScript ledger-peer
- [D-20260721-01](D-20260721-01-pinning-quorum-follow.md)｜pinning 檢查點採納模式：quorum-follow 輕跟隨（amends D-20260720-01）
- [D-20260722-01](D-20260722-01-signaling對齊match除名.md)｜signaling canon 對齊：/match 配對藍圖除名、CF Workers 降規劃中
- [D-20260724-01](D-20260724-01-signaling-v2部署拓撲.md)｜signaling scoped signed v2＋官方部署拓撲定案（amends D-20260722-01）
- [D-20260725-01](D-20260725-01-版本後繼邏輯核與首道破壞牆.md)｜版本後繼邏輯核先落地、第一道破壞牆原子啟用（amends D-20260528-02、D-20260703-02）
- [D-20260725-02](D-20260725-02-首次公開直接使用正式域名.md)｜首次公開直接使用正式域名（amends D-20260704-03）
- [D-20260725-03](D-20260725-03-checkpoint前代authority與pinning切換完成.md)｜checkpoint 前代 authority 與 pinning 切換完成（amends D-20260721-01、D-20260724-01）
- [D-20260725-04](D-20260725-04-正式build可選runtime測試策略.md)｜正式 build 可選 runtime 測試策略（amends D-20260716-01）
- [D-20260727-02](D-20260727-02-文檔站origin.md)｜文檔站 origin 定為 docs.open4wd.org（amends D-20260724-01）
- [D-20260728-01](D-20260728-01-Pinning公開列舉API移除.md)｜Pinning 公開列舉 API 移除（amends D-20260720-01、D-20260724-01）
- [D-20260728-04](D-20260728-04-Pinning可觀測性與私有Metrics.md)｜Pinning 可觀測性與官方私有 Metrics（amends D-20260720-01、D-20260724-01）
- [D-20260731-01](D-20260731-01-signaling開發期baseline重設v1.md)｜signaling 開發期 baseline 重設為 v1（amends D-20260724-01）
- [D-20260731-02](D-20260731-02-GossipSub-topic-namespace契約.md)｜GossipSub topic namespace 契約（amends D-20260731-01）
- [D-20260731-03](D-20260731-03-部署profile選擇與測試鏈隔離.md)｜部署 profile 選擇與測試鏈隔離（amends D-20260713-01）
- [D-20260802-13](D-20260802-13-瀏覽器Helia-UGC貢獻保留.md)｜瀏覽器 Helia UGC 貢獻保留
- [D-20260802-14](D-20260802-14-本機Helia-Storage-Authority.md)｜本機 Helia Storage Authority（amends D-20260802-13）
- [D-20260803-01](D-20260803-01-持久儲存拒絕保留既有UGC偏好.md)｜持久儲存拒絕保留既有 UGC 偏好（amends D-20260802-13）
- [D-20260804-04](D-20260804-04-PinningTemplate資源政策.md)｜Pinning Template 資源政策（amends D-20260706-02、D-20260803-03、D-20260803-06）
- [D-20260808-02](D-20260808-02-首次公開builtin資產v1基線.md)｜首次公開 builtin 資產 v1 基線
- [D-20260809-02](D-20260809-02-社群Fork手動一鍵部署.md)｜社群 Fork 手動一鍵部署（amends D-20260706-02、D-20260706-03、D-20260803-06）
- [D-20260809-03](D-20260809-03-bootstrap清單權威收斂.md)｜Bootstrap 清單權威收斂（amends D-20260803-06）
- [D-20260811-17](D-20260811-17-專案生命週期與首次公開發布鏈.md)｜專案生命週期與首次公開發布鏈（amends D-20260712-02、D-20260725-02、D-20260727-02、D-20260728-05）
- [D-20260814-22](D-20260814-22-真實資產CI分層證據.md)｜真實資產 CI 分層證據
- [D-20260814-24](D-20260814-24-Pre-launch自有版本統一v1.md)｜Pre-launch 自有版本統一為 v1（amends D-20260725-01、D-20260731-01、D-20260803-03、D-20260805-01、D-20260808-02、D-20260808-06、D-20260811-02、D-20260811-03、D-20260811-04、D-20260811-05、D-20260811-06、D-20260811-07、D-20260811-09、D-20260811-10、D-20260814-02、D-20260814-03、D-20260814-05、D-20260814-06、D-20260814-08、D-20260814-09、D-20260814-10、D-20260814-19）
- [D-20260815-01](D-20260815-01-Authoring原始GLB不可變Release.md)｜Authoring 原始 GLB 不可變 Release（superseded → D-20260818-01；amends D-20260712-02、D-20260811-17、D-20260814-22）
- [D-20260817-02](D-20260817-02-網路常數改採原生語意與故障域觀測.md)｜網路常數改採原生語意與故障域觀測（amends D-20260725-08、D-20260803-06、D-20260809-03）
- [D-20260817-04](D-20260817-04-UI常數權威收斂至實際消費端.md)｜UI 常數權威收斂至實際消費端（amends D-20260705-02、D-20260706-10）
- [D-20260818-01](D-20260818-01-Authoring大型原始資產Release-first.md)｜Authoring 大型原始資產 Release-first（supersedes D-20260815-01；amends D-20260811-17）
- [D-20260818-02](D-20260818-02-Graphify跨RepoRelease聚合.md)｜Graphify 跨 repo Release 聚合（amends D-20260725-05、D-20260727-05、D-20260811-17）
- [D-20260818-03](D-20260818-03-文檔站首頁狀態與精簡導覽.md)｜文檔站首頁狀態與精簡導覽（amends D-20260727-05、D-20260811-17）
- [D-20260820-01](D-20260820-01-預發布內建資產延後交付與兩段發布鏈.md)｜預發布內建資產延後交付與兩段發布鏈（amends D-20260811-17、D-20260818-01）
- [D-20260821-01](D-20260821-01-私有公開CI與Runner分層.md)｜私有／公開 CI 與 Runner 分層（superseded → D-20260822-02；amends D-20260814-22）
- [D-20260821-02](D-20260821-02-私有E2E單線與Linux參數契約.md)｜私有 E2E 單線與 Linux 參數契約（amends D-20260821-01）
- [D-20260822-01](D-20260822-01-人工視覺證據與自動E2E分層.md)｜人工視覺證據與自動 E2E 分層（superseded → D-20260822-02；amends D-20260814-22、D-20260821-02）
- [D-20260822-02](D-20260822-02-CI測試目錄與Profile執行架構.md)｜CI 測試目錄與 Profile 執行架構（supersedes D-20260821-01、D-20260822-01；amends D-20260821-02）

## 資安（12）

- [D-20260703-01](D-20260703-01-CSP-meta注入.md)｜CSP 交付＝build 時 meta 注入＋`connect-src` scheme 級白名單
- [D-20260703-04](D-20260703-04-sanitize天花板與Worker邊界.md)｜sanitize＝絕對天花板＋不可信 GLB 解析 Worker 邊界
- [D-20260727-04](D-20260727-04-週邊repo容器安全基線.md)｜週邊 repo 容器安全基線
- [D-20260731-05](D-20260731-05-Bug-Bounty與私密漏洞重現.md)｜Bug Bounty 與私密漏洞重現（amends D-20260703-09）
- [D-20260808-06](D-20260808-06-多身分封存與加密本機備份.md)｜多身分封存與加密本機備份（amends D-20260704-03、D-20260803-05）
- [D-20260812-03](D-20260812-03-本機安全事件記錄與去識別匯出.md)｜本機安全事件記錄與去識別匯出（amends D-20260703-01、D-20260703-04）
- [D-20260812-04](D-20260812-04-CSP逐頁雜湊與不安全請求升級.md)｜CSP 逐頁雜湊與不安全請求升級（amends D-20260703-01）
- [D-20260813-03](D-20260813-03-Specs-CI外部Action不可變鎖定.md)｜Specs CI 外部 Action 不可變鎖定（amends D-20260809-02）
- [D-20260814-13](D-20260814-13-帳號PIN修改與一次性助記詞.md)｜帳號 PIN 修改與一次性助記詞（amends D-20260814-12）
- [D-20260814-15](D-20260814-15-紙本備份純驗證與秘密輸入守衛.md)｜紙本備份純驗證與秘密輸入守衛（amends D-20260814-13）
- [D-20260814-25](D-20260814-25-Profile密封網路授權.md)｜Profile 密封網路授權（amends D-20260713-01、D-20260720-01、D-20260724-01、D-20260808-06、D-20260814-13）
- [D-20260816-03](D-20260816-03-PeerId顯示身分與暱稱快照消歧.md)｜PeerId 顯示身分與暱稱快照消歧（amends D-20260812-02）

## 前端主題（24）

- [D-20260704-01](D-20260704-01-主題系統三件套.md)｜主題系統三件套（token＋manifest＋fallback）
- [D-20260704-02](D-20260704-02-i18n自寫SW與前綴接縫.md)｜i18n 統一自寫 SW 與語系前綴路由接縫
- [D-20260706-07](D-20260706-07-圖檔禁字鐵則.md)｜圖檔禁字鐵則
- [D-20260706-10](D-20260706-10-斷點模型三級.md)｜斷點模型三級唯一尺度
- [D-20260708-10](D-20260708-10-兩層token架構.md)｜兩層 token 架構（語意層＋元件層 `--o4-*`）
- [D-20260713-02](D-20260713-02-美術方向工坊翻案.md)｜美術方向翻案：專業迷你四驅車調校工坊
- [D-20260714-01](D-20260714-01-Mount組裝車輛呈現.md)｜Mount 組裝車輛呈現與共用組裝服務
- [D-20260716-02](D-20260716-02-公開根入口與靜態公告.md)｜公開根入口與靜態多語公告
- [D-20260723-01](D-20260723-01-主題StyleAPI-v1.md)｜主題架構重構為受控 CSS Style API v1（amends D-20260704-01）
- [D-20260724-02](D-20260724-02-主題payload歸位public.md)｜主題部署 payload 歸位 public、src 僅留程式與治理 metadata（amends D-20260704-01）
- [D-20260727-03](D-20260727-03-路由導覽與UGC公開入口收斂.md)｜路由導覽與 UGC 公開入口收斂（amends D-20260706-04、D-20260716-02、D-20260717-01）
- [D-20260806-02](D-20260806-02-Editor中性工作區與重力對齊Grid.md)｜Editor 中性工作區與重力對齊 Grid（amends D-20260713-02）
- [D-20260809-05](D-20260809-05-音訊槽位UICue與賽事空間音訊.md)｜音訊槽位、UI Cue 與賽事空間音訊（amends D-20260704-01、D-20260713-02）
- [D-20260809-09](D-20260809-09-應用字型LocaleAware延後載入.md)｜應用字型 Locale-Aware 延後載入（amends D-20260704-02）
- [D-20260811-08](D-20260811-08-玩家動態偏好與單一有效狀態.md)｜玩家動態偏好與單一有效狀態（amends D-20260723-01）
- [D-20260811-13](D-20260811-13-結構化主題字型與Runtime-Namespace.md)｜結構化主題字型與 Runtime Namespace（amends D-20260723-01、D-20260809-09）
- [D-20260811-15](D-20260811-15-StyleAPI-v1-Emitter雙向完整性.md)｜Style API v1 Emitter 雙向完整性（amends D-20260723-01）
- [D-20260811-18](D-20260811-18-i18n使用面掃描與分階段StrictGate.md)｜i18n 使用面掃描與分階段 Strict Gate（amends D-20260704-02）
- [D-20260814-12](D-20260814-12-設定頁八大分類與旗標式開發者項.md)｜設定頁八大分類與旗標式開發者項
- [D-20260814-14](D-20260814-14-顯示算圖與瀏覽器維護能力.md)｜顯示算圖與瀏覽器維護能力（amends D-20260814-12）
- [D-20260814-17](D-20260814-17-Onboarding單人本機結果里程碑.md)｜Onboarding 採單人本機結果里程碑
- [D-20260816-05](D-20260816-05-賽事空間音訊正式採HRTF.md)｜賽事空間音訊正式採 HRTF（amends D-20260809-05）
- [D-20260816-06](D-20260816-06-賽內倒數採主題WebP動畫.md)｜賽內倒數採主題 WebP 動畫（amends D-20260704-01、D-20260706-07、D-20260802-02、D-20260811-08）
- [D-20260816-11](D-20260816-11-前端靜態內容路徑收斂.md)｜前端靜態內容路徑收斂（amends D-20260704-02、D-20260716-02）

## 治理營運（38）

- [D-20260428-01](D-20260428-01-初始企劃骨架與模組化規格基線.md)｜建立初始企劃骨架與模組化規格基線
- [D-20260604-01](D-20260604-01-脫鉤與廢棄資訊鐵則.md)｜project-resources 全面脫鉤與廢棄資訊鐵則
- [D-20260627-01](D-20260627-01-治理兩軌收斂.md)｜治理兩軌收斂：economy_config 鏈上、其餘 client 發版（amends D-20260524-02）
- [D-20260705-01](D-20260705-01-治理事件單一族.md)｜治理事件收斂單一事件族
- [D-20260705-02](D-20260705-02-License-MIT.md)｜開源 License 定案 MIT
- [D-20260706-01](D-20260706-01-營運模式捐助制.md)｜營運模式＝捐助制、不掛第三方廣告；域名 open4wd.org
- [D-20260706-08](D-20260706-08-註解鐵則翻案.md)｜註解鐵則翻案：自足、零文檔引用
- [D-20260707-01](D-20260707-01-決定性紀律.md)｜決定性紀律：正確捨入白名單與 ESLint 防線
- [D-20260712-02](D-20260712-02-公版GLB交接與測試門檻.md)｜公版 GLB 交接契約與可重現測試門檻
- [D-20260722-02](D-20260722-02-檔名維持中文與slug預留.md)｜檔名維持中文與 URL slug 預留
- [D-20260724-03](D-20260724-03-ADR制度與conformance權威模型.md)｜ADR 制度與 conformance 權威模型
- [D-20260724-04](D-20260724-04-corpus-frontmatter與生成式索引.md)｜全 corpus frontmatter 與生成式索引
- [D-20260724-05](D-20260724-05-三域規則ID制度.md)｜三域規則 ID 制度
- [D-20260725-05](D-20260725-05-graphify輸出追蹤與格式化邊界.md)｜Graphify 輸出追蹤與格式化邊界
- [D-20260725-06](D-20260725-06-規則到測試追溯制度.md)｜規則到測試的追溯制度（amends D-20260724-05）
- [D-20260725-07](D-20260725-07-歷史記錄按年分檔.md)｜歷史記錄按年分檔（superseded → D-20260728-06）
- [D-20260725-08](D-20260725-08-常數表硬比對閘.md)｜常數表與程式常數的硬比對閘
- [D-20260727-01](D-20260727-01-sources雙向硬閘.md)｜sources 雙向硬閘（amends D-20260724-03）
- [D-20260727-05](D-20260727-05-文檔Corpus與MkDocs導覽生成邊界.md)｜文檔 Corpus 與 MkDocs 導覽生成邊界（amends D-20260724-04）
- [D-20260728-06](D-20260728-06-歷史記錄月份索引與每日分檔.md)｜歷史記錄月份索引與每日分檔（supersedes D-20260725-07）
- [D-20260729-01](D-20260729-01-跨repo規則追溯ownership.md)｜跨 repo 規則追溯改採 ownership 模型（amends D-20260725-06）
- [D-20260729-02](D-20260729-02-signaling常數owner硬閘.md)｜signaling 常數改採 owner hard gate（amends D-20260725-08）
- [D-20260807-01](D-20260807-01-Ko-fi單軌捐助管道.md)｜Ko-fi 單軌捐助管道（amends D-20260706-01）
- [D-20260809-07](D-20260809-07-效能回歸與BootstrapCoverage可執行門檻.md)｜效能回歸與 Bootstrap Coverage 可執行門檻（amends D-20260712-02）
- [D-20260809-08](D-20260809-08-跨RepoCanonicalLeafContract與VendorParity.md)｜跨 Repo Canonical Leaf Contract 與 Vendor Parity（amends D-20260729-01）
- [D-20260809-10](D-20260809-10-Editor禁止Barrel並採責任LeafImport.md)｜Editor 禁止 Barrel 並採責任 Leaf Import
- [D-20260811-01](D-20260811-01-規則執法契約與逐層Conformance.md)｜規則執法契約與逐層 Conformance（amends D-20260724-05、D-20260725-06、D-20260729-01）
- [D-20260812-01](D-20260812-01-首頁專案時間線與自適應壓縮.md)｜首頁專案時間線與自適應歷史壓縮（amends D-20260728-06）
- [D-20260812-07](D-20260812-07-重複碼量測與分階段零容忍.md)｜重複碼量測與分階段零容忍
- [D-20260813-01](D-20260813-01-註解語言與公開Template-CI劃界.md)｜註解語言與公開 Template CI 劃界（amends D-20260706-02）
- [D-20260813-02](D-20260813-02-規則Owner單一責任契約.md)｜規則 Owner 單一責任契約（amends D-20260729-01、D-20260811-01）
- [D-20260813-04](D-20260813-04-ADR路徑與向量家族識別.md)｜ADR 路徑與向量家族識別（amends D-20260724-03）
- [D-20260813-05](D-20260813-05-Mermaid自然尺寸決定性拆圖與無障礙檢視.md)｜Mermaid 自然尺寸、決定性拆圖與無障礙檢視（amends D-20260724-04）
- [D-20260813-06](D-20260813-06-工具鏈Inventory與三向一致性閘.md)｜工具鏈 Inventory 與三向一致性閘（amends D-20260725-08、D-20260811-01）
- [D-20260815-02](D-20260815-02-註解品質本機前移與多語PR流程.md)｜註解品質本機前移與多語 PR 流程（amends D-20260813-01）
- [D-20260816-10](D-20260816-10-ADR廢止關係生成索引.md)｜ADR 廢止關係改採必填 metadata 與生成索引（amends D-20260724-03、D-20260728-06）
- [D-20260817-05](D-20260817-05-EconomyConfig單一Runtime權威.md)｜EconomyConfig 收斂為單一 runtime authority（amends D-20260627-01）
- [D-20260820-02](D-20260820-02-Graphify-manifest內容決定化.md)｜Graphify manifest 內容決定化（amends D-20260725-05、D-20260818-02）
