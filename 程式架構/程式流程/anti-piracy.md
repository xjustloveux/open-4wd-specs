---
type: impl-flow
domain: ["UGC版權"]
summary: 程式級流程圖：mesh fingerprint／灰區 similarity-pending
authority: 程式架構/anti-piracy.md
slug: null
---
# Anti-Piracy

<!-- generated:impl-flow-header:start -->
> **文件角色**：implementation flow 投影；圖與步驟不得另建產品規則或參數 authority。

| Implementation authority | 產品 canon／流程 | 全域索引 |
| --- | --- | --- |
| [anti-piracy.md](../anti-piracy.md) | [版權](../../版權.md) · [檢舉與仲裁](../../流程/檢舉與仲裁.md) | [流程.md §2](../../流程.md#2-各模組流程圖索引) |
<!-- generated:impl-flow-header:end -->
## 五層防禦堆疊

```mermaid
graph TB
    Upload[UGC 上傳] --> L1[Layer 1<br/>CID exact identity]
    L1 --> L2[Layer 2<br/>已驗 Mesh Fingerprint]
    L2 --> L3[Layer 3<br/>Similarity classifier]
    L3 --> Admission{收件結果}
    Admission --> Reject[拒收或引導 fork]
    Admission --> Pending[similarity-pending<br/>經濟隔離]
    Admission --> Accept[接納]
    Accept --> L4[Layer 4<br/>事後檢舉與標準仲裁]
    Pending --> L4
    L4 --> Ledger[仲裁結果由 ledger derive]
    Upload --> L5[Layer 5<br/>Provider-scoped DMCA]
    L5 --> Provider[只影響被通知 provider 的供應面]
```

五層各自處理內容同一性、幾何相似、上傳分類、鏈上社群裁決與 provider 法遵；上傳時間不形成
自動勝負。相似度門檻數值以 [版權.md §5.3](../../版權.md) 為唯一權威，圖中不重列。

## 上傳檢查流程

```mermaid
flowchart TD
    Upload([Mesh 上傳]) --> Compute[計算 Fingerprint]
    Compute --> Verify[取得候選完整 GLB 並重算]
    Verify --> Exact{Exact primary hash?}
    Exact -->|是| RejectExact[拒收<br/>原 CID 不重發]
    Exact -->|否| Classify[classifySimilarity]
    Classify --> Result{分類}
    Result -->|活躍對象硬擋| Reject[拒收<br/>可 fork 或檢舉命中對象]
    Result -->|灰區或已判抄對象| Pending[選擇 upload-pending]
    Result -->|通過| Copyright[接受版權聲明]
    Reject --> Fork[走 fork]
    Reject --> Report[標準版權檢舉]
    Pending --> Declare[上鏈 similarityMatches 宣告]
    Declare --> Arbitration[自動開上傳期仲裁案]
    Arbitration -->|判抄| Blacklist[BlacklistEvent<br/>不扣信譽]
    Arbitration -->|判非抄或流局| Release[解除經濟隔離]
    Copyright --> Final[上鏈]
```

`similarity-pending` 直接使用標準仲裁機器；其案錨就是含 `similarityMatches` 的
`UgcUploadEvent`。硬擋、灰區與通過的門檻，以及仲裁黑名單對象的降級規則，以
[anti-piracy.md §5.1](../anti-piracy.md) 為準。

## 標準化演算法

```mermaid
flowchart TD
    In[原始 Mesh] --> S1[Step 1<br/>平移到原點<br/>Barycenter→0,0,0]
    S1 --> S2[Step 2<br/>PCA 主軸對齊<br/>旋轉至座標軸]
    S2 --> S3{Step 3<br/>signed_volume 合法?}
    S3 -->|是| Mirror[X 軸翻轉<br/>保留 winding]
    S3 -->|否| S4
    Mirror --> S4[Step 4<br/>縮放到 0,1 立方體]
    S4 --> S5[Step 5<br/>固定精度整數量化]
    S5 --> S6[Step 6<br/>頂點字典序排序]
    S6 --> S7[Step 7<br/>三角形拓樸重編碼]
    S7 --> S8[Step 8<br/>節點名稱排序]
    S8 --> Hash[計算內容雜湊]
    Hash --> Out[Fingerprint primary]

    Features[同步提取特徵<br/>vertex/volume/SA/AABB/PCA] --> Out2[Fingerprint features]
```

## 仲裁流程（走標準純仲裁）

```mermaid
sequenceDiagram
    participant C as 檢舉者
    participant M as moderation（標準仲裁）
    participant P as 隨機仲裁面板
    participant D as 被檢舉方

    C->>M: 違反版權（含剽竊）檢舉<br/>target = 對方 CID + 指紋比對證據
    M->>D: 通知，可附應訴 statement
    Note over M: 到達抽籤點後由已驗 state 建候選池
    M->>P: 抽出合格且非兩造的仲裁者
    P->>M: 提交已簽 pass / reject / abstain 票

    alt 仲裁成立
        M->>M: 該 CID BlacklistEvent<br/>作者信譽 −100（copyright-violation）
    else 不成立
        M->>M: 雙方保留（共存）<br/>檢舉者準確率統計
    else 流局
        M->>M: 不進統計、同對象可再檢舉
    end
```

候選人必須同時通過信譽、完賽、註冊時間、**非全域玩家黑名單**與非兩造條件。面板大小、
quorum、票權與成立門檻只引用 [moderation.md §5](../moderation.md)，不在圖中複製數值。
上傳期灰區同走標準仲裁但**無檢舉者**：判抄 → 下架（`BlacklistEvent`、不扣信譽）／
判非抄或流局 → 解除隔離、經濟開始（[anti-piracy.md §5](../anti-piracy.md)）。

## 信譽加權投票

```mermaid
graph LR
    Vote[已驗仲裁票] --> Lookup[整數權重查表]
    Lookup --> Sum[分別累計 pass / reject]
    Sum --> Result[依 moderation 權威判定]
```

合格門檻、整數權重表與成立條件分別由 [moderation.md §5](../moderation.md)、
[reputation.md §6.1](../reputation.md) 與 [算式表.md §17](../../算式表.md) 定義。

## 攻擊成本評估

```mermaid
graph LR
    A1[逐位元或 canonical 複製] --> Exact[CID / primary exact 擋下]
    A2[改 metadata 或索引順序] --> Canonical[標準化指紋擋下]
    A3[小幅幾何修改] --> Similarity[相似度分類]
    A4[重拓樸或換皮] --> Report[事後檢舉與仲裁承接]
    A5[獨立重做] --> Original[依證據判斷原創或正當二創]
```
