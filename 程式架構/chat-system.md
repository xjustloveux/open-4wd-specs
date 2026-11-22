---
type: impl
domain: ["比賽房間"]
summary: 等待房共用文字聊天／房主中繼／速率限制／本機過濾
authority: null
slug: null
---
# chat-system（房間聊天實作）

<!-- generated:impl-flow-backlink:start -->
> 對應 implementation flow：[程式流程/chat-system.md](程式流程/chat-system.md)。
<!-- generated:impl-flow-backlink:end -->
> **本檔角色**：等待房文字聊天的**實作層** —— 訊息結構（**簽章**）、房主 star 中繼、驗證／雙端速率限制、文字過濾（`TEXT_BLACKLIST`）、最近隊友清單。賽內不提供自由文字，改用 [race-messages.md](race-messages.md) 的圖示訊息。
> 賽內定位見 [賽內機制.md §2.5](../賽內機制.md)；starter 格式版本見 [程式參數.md](../程式參數.md)（`TEXT_BLACKLIST_VERSION`）。對應 `src/chat-system/`。

## 1. 訊息結構（簽章）

文字訊息以 `SignedPayload<ChatMessage>` 傳輸（[資安規範.md §3.2](../資安規範.md)「所有 P2P 訊息簽章」；封裝見 [key-manager.md §9](key-manager.md)）。**簽章聊天訊息 = 騷擾檢舉的可驗證據**——PeerId 即 Ed25519 公鑰衍生，任何仲裁者可離線驗真（[信譽系統.md §5.1](../信譽系統.md)）。

```typescript
interface ChatMessage {
  type: 'text' | 'system';
  sender: PeerId; senderNickname: string;       // 自報呈現快照，不是身分權威
  roomId: string;                              // 綁定發話情境（在簽章涵蓋內，防拼接挪用）
  content: string; timestamp: Timestamp; messageId: string;
}
interface SystemMessage extends ChatMessage {
  type: 'system';                              // 各 client 本地生成（peer-joined 等），不經網路、不需簽章
  systemEvent: 'peer-joined' | 'peer-left' | 'host-changed' | 'match-started' | 'match-ended';
  payload?: any;
}
```

`peer-joined`／`peer-left` 的唯一語意來源是各 client 已接受的權威 participant roster 差分：
第一次 RoomState snapshot 只建立基準、不回灌既有成員；之後新增／移除 participant 才以該
roster 的 nicknameSnapshot 生成本機 system message。signaling presence 只負責撥號與離線佐證，
不得直接生成進出訊息；因此被拒者、尚未完成 admission 的半開連線與 spectator 都不會被誤報
為 participant。host、member 與 spectator client 都套用相同差分語意。

`sender`／SignedPayload `signer` 經驗章後才是身分權威；`senderNickname` 只保存發送當下的
本機 profile 暱稱快照，不宣稱鏈上註冊、唯一或受 PeerId 所有者以外的人背書。所有遠端人物
由單一 display-identity resolver 顯示為「合法暱稱快照 `#` 穩定短指紋」；沒有合法快照時只顯示
`#短指紋`。短指紋取完整 PeerId 的 SHA-256 前 4 bytes（8 位小寫十六進位），不得直接截取
具有共同 multibase 前綴的 8／10／12 碼。暱稱清理與可見長度遵守
[ui-frontend.md §5](ui-frontend.md)，renderer 一律以已驗 signer 的 PeerId
計算指紋，不能接受訊息自行提供指紋。

暱稱快照先做 NFC，移除 Unicode `Cc`／`Cf`（含控制與 zero-width）、trim，清理後不得為空；
可見長度上限為 24 個半形單位或 12 個全形單位。profile 建立／恢復／更新與送端都只保存
此 canonical 值；room wire 與聊天收件要求收到的值與 canonical 值完全相同，不能由收端靜默
改寫簽章內容。renderer 對第三方或舊資料另做防禦性截斷並保留 ellipsis，但仍以 signer PeerId
指紋消歧。登入原生輸入另設 64 code point 結構上限，實際接受與否仍由上述顯示單位 validator
決定。

## 2. 等待房 host-star 中繼

participant 與 spectator 在 `room.state === 'waiting'` 共用同一個 RoomPage 聊天室。每位 client
先簽署 `SignedPayload<ChatMessage>`，再經既有 room-control link 送給 host；host 只接受已完成
admission 的真實 link source，驗 `source === signer === payload.sender`、RoomId、canonical shape、
內容與簽章後，再中繼原始 signed envelope 給房內所有 admitted client。host 自己發話也走同一套
policy，不得使用本機捷徑繞過驗證與限速。

host ingress 同時施加 per-sender 5 則／秒與 room-wide 20 則／秒、32,000 UTF-8 bytes／秒；送端
5 則／秒只提供 UX 自律。房間離開 waiting、link 離開 admission 名冊或封鎖政策拒絕後即不再接受。
角色顯示由當前權威 room snapshot 推導：host／participant 名稱以粗體並加文字 badge，spectator
使用一般字重與 spectator badge；不得相信訊息自報角色，也不得只用顏色區分。

RoomPage chat 採 `idle → connecting → ready` 生命週期；runtime 不提供 capability 時為
`unavailable`，同步 throw、Promise rejection 或 join 回傳錯誤時為 `error`。connecting／
unavailable／error 顯示安全的在地化狀態，只有 error 提供 single-flight retry。route、角色、
runtime revision 或 capability 改變時，舊請求結果不得覆寫新狀態；過期成功必須立即 `leave()`。
RacePage 不建立、重試或保留自由文字 chat handle。

## 3. 驗證與速率限制（雙端）

送訊端 5 則/秒自律（UX 先擋）；**收訊端逐則驗章 + per-sender 速率強制**（惡意 client 可跳過送端自律，收端才是防線）：

```typescript
function validateChatMessage(content: string): ValidationResult {
  if (content.length === 0) return error('訊息為空');
  if (content.length > 500) return error('訊息過長 (>500 字)');
  return ok();
}

class ChatRateLimiter {            // 送訊端 5 則/秒（收訊端用同一 window 邏輯、per-sender 各一份）
  private timestamps: Timestamp[] = [];
  private readonly MAX_PER_SECOND = 5;
  canSend(): boolean {
    const now = performance.now();
    this.timestamps = this.timestamps.filter(t => now - t < 1000);
    return this.timestamps.length < this.MAX_PER_SECOND;
  }
  recordSend(): void { this.timestamps.push(performance.now()); }
}

// 收訊端（每則）
async function acceptChatMessage(signed: SignedPayload<ChatMessage>, room: RoomState,
  rxLimiters: Map<PeerId, ChatRateLimiter>, blocklist: ReadonlySet<PeerId>): Promise<boolean> {
  if (!await verifyPayload(signed)) return false;              // 簽章 / timestamp ±30s / nonce（資安規範 §3.4）
  if (signed.payload.sender !== signed.signer) return false;   // sender 必須 = 簽章者
  if (signed.payload.roomId !== room.id) return false;         // 情境綁定
  if (!rxLimiters.get(signed.signer)?.canSend()) return false; // per-sender 5 則/秒，超過丟棄（防刷頻）
  if (blocklist.has(signed.signer)) return false;              // 個人封鎖清單靜音（本地，賽內機制.md §1）
  return validateChatMessage(signed.payload.content).ok;
}
```

共用 composer 顯示 trim 後字數與 `CHAT_MAX_LENGTH` 上限；空白維持禁用／no-op，超限在本機
inline 拒絕。送出採 single-flight 並等待 `ChatRoomHandle.send()` 的 `Result`：成功且玩家未在
等待期間修改草稿才清空；限速失敗顯示專用安全文案，其他 provider／transport 失敗只顯示
通用失敗並保留草稿，不得把內部 Error message 直接呈現。上述只處理本機送端 UX；收端的
驗章、封鎖與畸形訊息拒絕仍靜默，避免成為攻擊者 oracle。

每則已驗文字訊息提供以 `sender` PeerId 操作個人本機封鎖／解除封鎖的捷徑；設定頁隱私區
另列出目前 identity 的完整封鎖清單，可辨識 PeerId 穩定短指紋並解除封鎖。兩個入口共用
`BlocklistService`；封鎖仍只影響本機聊天靜音、房主拒入與本機社交投影，不同步、不上鏈，
也不代表全域處分。封鎖持久化失敗不得先行改成已封鎖的 UI 狀態。

## 4. 本機文字顯示過濾

每位玩家維護自己的裝置本機 literal 詞表與開關。**SignedPayload、傳輸、歷史與檢舉證據恆保留完整原文；只有該裝置的 render copy 遮蔽**。詞表與開關不傳給房主／其他玩家、不上鏈。契約只接受 literal，不接受任意 regex；詞表最多 512 筆、每筆最多 48 Unicode code points，拒絕控制字元並以 NFKC／case-fold 鍵去重。

Git／client 可隨版提供按四語系整理、盡可能涵蓋辱罵、歧視、性騷擾、威脅、作弊與洗頻等情境的 starter list。它不是顯示權威：玩家必須在設定頁按「複製 Git 基本詞表」才建立自己的本機副本，後續 starter 更新不得自動加入、刪除或覆蓋玩家副本。`TEXT_BLACKLIST_VERSION` 只標示 starter list 格式；normalized literal substring 是現行程式固定行為，不另設未被讀取的全域 mode 常數。

```typescript
interface TextBlacklist {
  language: 'zh-TW' | 'zh-CN' | 'en' | 'ja';
  words: readonly string[]; // optional starter literals
  version: string;
}

class ProfanityFilter {
  loadLists(lists: TextBlacklist[]): void { /* 建 normalized literal index */ }
  filter(content: string, language: string): string {
    // NFKC + Unicode letter/number + case-fold；同時保留每個 normalized code unit
    // 對應的原文字位。substring 命中後以該映射遮蔽原文範圍，因此 f.u.c.k、
    // ば・か、諺文插符等都會命中且實際遮蔽。
    return maskMatchedSourceRanges(content, language, '***');
  }
}

function renderMessage(m: ChatMessage, filter: ProfanityFilter, language: string, enabled: boolean): string {
  return enabled ? filter.filter(m.content, language) : m.content;
}
```

## 5. 最近隊友清單

比賽結束後在本機追蹤近 50 個玩家（FIFO 淘汰，供查公開頁與操作個人封鎖），存 IndexedDB
`open-4wd` store `recent-teammates`。這只是裝置本地的歷史快照，不同步、不建立好友關係，也
沒有好友 API；另有單向玩家收藏 API，但不改變此資料的 FIFO 與無關係語意，見
[player-favorites.md](player-favorites.md)。房間 route hint／邀請若被玩家接受，只服務當次 session 的 provider 尋路，與
最近隊友資料無關且不得因此持久化：

唯一正式生產點是 participant race session 產出已驗證正式結果後，以 match-start 固定 roster
呼叫 `addFromMatch`；開賽失敗、pre-race cancel、一般 teardown 與 spectator 不寫入。room
activeMatch 在第一次 `noteMatchOver(true)` 後即清除，因此重複 teardown 不得再次增加
`matchCount`。設定頁隱私區消費 `recentTeammates()`，顯示保存的 display snapshot 與完整
PeerId，並提供加入個人封鎖清單的操作；無暱稱資料時使用 display-identity resolver 的穩定
`#短指紋`，不得截取 PeerId 共同前綴。

```typescript
interface RecentTeammate { peerId: PeerId; nicknameSnapshot: string; lastPlayedAt: Timestamp; matchCount: number; reputationSnapshot?: number; }

class RecentTeammatesService {
  private readonly MAX_LIST = 50;
  async addFromMatch(participantPeerIds: PeerId[]): Promise<void> {
    const db = await openDB('open-4wd'); const me = keyManager.getPeerId();
    for (const p of participantPeerIds) {
      if (p === me) continue;
      const existing = await db.get('recent-teammates', p);
      await db.put('recent-teammates', existing
        ? { ...existing, lastPlayedAt: Date.now(), matchCount: existing.matchCount + 1 }
        : { peerId: p, nicknameSnapshot: displaySnapshotFromFixedRoster(p) ?? peerFingerprintLabel(p), lastPlayedAt: Date.now(), matchCount: 1 });
    }
    await this.trimToMaxList(db);   // 超過 50 → 依 lastPlayedAt 升冪刪最舊
  }
  async list(): Promise<RecentTeammate[]> {
    return (await (await openDB('open-4wd')).getAll('recent-teammates')).sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  }
}
```

`lastPlayedAt` 等為本地 ephemeral 時間（純客戶端社交清單，不入帳本 / derive）。

## 6. API

```typescript
interface ChatApi {
  sendMessage(content: string): Promise<Result<void>>;
  onMessage(handler: (message: ChatMessage) => void): Unsubscribe;
  setFilterEnabled(enabled: boolean): void;
  isFilterEnabled(): boolean;
  getRecentTeammates(): Promise<RecentTeammate[]>;
  removeFromRecent(peerId: PeerId): Promise<void>;
  exportEvidence(messageIds: readonly string[]): Promise<string[]>;  // 每則 SignedPayload 各自 canonical DAG-CBOR + multibase base64url，最多 16 筆
}
```

本地訊息歷史保留原始 `SignedPayload`（非僅顯示文字），供玩家在聊天面板選取同一 sender 的至多 16 則訊息後交給 `exportEvidence`；每則證據獨立編碼、每個 evidence 字串不得超過 4096 UTF-8 bytes，形狀直接對齊 `ReportEvent.evidence: string[]`。房間結束即清（不上鏈，見 [程式流程/chat-system.md](程式流程/chat-system.md) 生命週期）。仲裁端逐筆 canonical 解碼，驗 `sender === signer`、訊息 shape 與 Ed25519 簽章；解析或驗章失敗只標為無效證據，不得使收件匣崩潰。

## 7. 跨模組對接

| 模組 | 對接 |
|---|---|
| [賽內機制.md §2.5](../賽內機制.md) · [race-messages.md](race-messages.md) | 等待房自由文字與賽中圖示訊息的角色邊界 |
| [room-runtime.md](room-runtime.md) | 等待房 admitted host-star 中繼與 room-wide ingress 預算 |
| [key-manager.md §9](key-manager.md) | `SignedPayload` 簽章 / 驗章 |
| [moderation.md](moderation.md) | 騷擾檢舉證據（`exportEvidence`）|
| [賽內機制.md §1](../賽內機制.md) | 個人封鎖清單靜音（本地）|
| [程式參數.md](../程式參數.md) · [dmca.md](dmca.md) | `TEXT_BLACKLIST` 版本 / match mode |
| [spectator.md](spectator.md) | spectator 在等待房共用文字聊天、賽內唯讀圖示 relay |
| display-identity resolver | PeerId 穩定短指紋與非權威暱稱快照呈現 |
