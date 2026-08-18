---
type: impl
domain: ["資安"]
summary: 助記詞／Ed25519／PIN 加密／profile／SignedPayload
authority: null
slug: null
---
# key-manager（金鑰 / 身分 / 簽章實作）

> **本檔角色**：身分與簽章的**實作層** —— 助記詞 / Ed25519 金鑰、PIN（Argon2id + AES-GCM）加密儲存、IndexedDB profile、暴力破解防護、助記詞恢復、硬體錢包、`SignedPayload` 封裝。
> 設計與不變式見 [資安規範.md §3（簽章/驗章）/ §12（PeerId 與身分）](../資安規範.md)；ledger 專用 `ledgerSigningDigest(ledgerAddress, event)` 與 canonical 序列化見 [ledger-admission.md §1](ledger-admission.md)。對應 `src/key-manager/`。

## 1. 型別

```typescript
type PeerId = string;        // multibase base58btc(0xed01 ‖ Ed25519 pubkey)，'z' 前綴
type Mnemonic = string;      // BIP39 詞，空白分隔（12 或 24 詞）
type Signature = Uint8Array; // 64 bytes Ed25519

interface KeyPair { publicKey: Uint8Array; privateKey: Uint8Array; }   // 32 / 32 bytes

interface EncryptedSeed {
  ciphertext: Uint8Array; iv: Uint8Array; salt: Uint8Array;
  kdfParams: Argon2Params; version: 1;
}
interface Argon2Params {
  algorithm: 'argon2id'; iterations: number; memoryKiB: number; parallelism: number;
}
interface ProfileMetadata {
  profileId: string; nickname: string; peerId: PeerId;
  createdAt: number; lastUsedAt: number; pinAttempts: number; lockedUntil: number;
}

type KeyManagerError =            // PIN 家族領域錯誤；模組不產文案、UI 以 code 映射 i18n（errors.keyManager.*）
  | { code: 'profile-not-found' }
  | { code: 'pin-invalid'; attemptsLeft: number | null }    // null＝不計次路徑（changePin / deleteProfile）
  | { code: 'pin-locked'; remainingMinutes: number }
  | { code: 'pin-locked-now'; lockMinutes: number }
  | { code: 'storage-error' };                              // IndexedDB 讀寫失敗（store reject 收斂於此；不計暴力鎖次數）
```

## 2. KeyManager 介面

```typescript
interface KeyManager {
  hasProfile(): Promise<boolean>;
  listProfiles(): Promise<ProfileMetadata[]>;
  generateMnemonic(): Mnemonic;                                        // 預設 24 詞（256-bit）
  createProfile(opts: { mnemonic: Mnemonic; pin: string; nickname: string }): Promise<ProfileMetadata>;
  unlockProfile(profileId: string, pin: string): Promise<Result<KeyPair, KeyManagerError>>;
  lock(): void;
  sign(message: Uint8Array): Promise<Signature>;
  verify(message: Uint8Array, signature: Signature, peerId: PeerId): Promise<boolean>;
  getPeerId(): PeerId;
  getNicknameSnapshot(): string;                                  // 本機 profile 自報快照，非身分權威
  recoverFromMnemonic(mnemonic: Mnemonic, newPin: string, nickname?: string): Promise<KeyPair>;  // 接受 12/24 詞；未給 nickname 時用 PeerId 穩定短指紋
  verifyProfilePin(profileId: string, pin: string): Promise<Result<void, KeyManagerError>>;
  verifyMnemonicForProfile(profileId: string, mnemonic: Mnemonic): Promise<Result<boolean, KeyManagerError>>;
  changePin(oldPin: string, newPin: string): Promise<Result<void, KeyManagerError>>;
  setHardwareProvider(provider: HardwareKeyProvider | null): void;
  deleteProfile(profileId: string, pin: string): Promise<Result<void, KeyManagerError>>;
  exportLibp2pSeed(): Uint8Array;                                      // libp2p 節點鑰 seed（見 §2.1）
  signPayload<T>(payload: T): Promise<SignedPayload<T>>;               // P2P 簽章封裝（§9）
}
```

**非空 PIN 是建立與匯入身分的硬前置**：登入頁必須輸入兩次且一致，`IdentityData.createIdentity(displayName, pin)`／`importMnemonic(mnemonic, pin)` 也在資料邊界拒絕空字串，不能只靠 UI。PIN 只保護此裝置的 seed，server 不保存、也不能代為復原；忘記 PIN 時只能用助記詞重新匯入並設定新 PIN。

profile 暱稱在 create／recover／update 共用 [chat-system.md §1](chat-system.md) 的 canonical
validator；清理後空值回 `nickname-invalid`，超過 24 個半形或 12 個全形顯示單位回
`nickname-too-long`。不可只依登入頁 `maxlength`，直接呼叫資料與 key-manager 邊界也必須拒絕。

### 2.1 exportLibp2pSeed（libp2p 節點身分）

「私鑰永不離開模組」的**唯一例外**：`exportLibp2pSeed()` 回傳**目前已解鎖 profile** 的 master 私鑰複本、僅供本機 libp2p 節點建構（`libp2pPrivateKeyFromSeed`）——同一 profile 的節點 PeerId 與玩家身分 PeerId 為單一 derive 鏈（同一把鑰、同一 canonical identity）。裝置可保存多個彼此隔離的 profile，但執行中一次只允許一個 active identity；切換 profile 必須先關閉前一身份的 runtime。回傳複本不落盤不出程序、呼叫端用畢即歸零（複本歸零不影響本尊）。需先解鎖（未解鎖 ＝throw）。

## 3. 助記詞與 Ed25519

```typescript
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { ed25519 } from '@noble/curves/ed25519';

function generateMnemonic(): Mnemonic { return bip39.generateMnemonic(wordlist, 256); }   // 24 詞
function validateMnemonic(m: Mnemonic): boolean { return bip39.validateMnemonic(m, wordlist); }  // 12/24 皆可
function mnemonicToSeed(m: Mnemonic): Uint8Array { return bip39.mnemonicToSeedSync(m).slice(0, 32); }  // 取前 32B 為 Ed25519 私鑰

function deriveKeyPair(seed: Uint8Array): KeyPair { return { privateKey: seed, publicKey: ed25519.getPublicKey(seed) }; }
function signMessage(priv: Uint8Array, msg: Uint8Array): Signature { return ed25519.sign(msg, priv); }
function verifyMessage(pub: Uint8Array, msg: Uint8Array, sig: Signature): boolean { return ed25519.verify(sig, msg, pub); }

function publicKeyToPeerId(pub: Uint8Array): PeerId {     // multicodec ed25519-pub (0xed01) + base58btc
  const combined = new Uint8Array([0xed, 0x01, ...pub]);
  return 'z' + base58btc.encode(combined);
}
```

> 助記詞長度：`generateMnemonic` 預設 24 詞（最強）；`validateMnemonic` / `recoverFromMnemonic` 接受 12 或 24 詞（對齊 [資安規範.md §3.1/§12](../資安規範.md)「BIP39 12/24 詞」）。
> 建檔頁只在當次流程顯示助記詞並完成隨機字位抄寫驗證；profile 僅保存衍生出的
> `encryptedSeed`，不保存助記詞字串，因此 Account 沒有事後查看或找回能力。

### 3.1 紙本備份純驗證

`verifyProfilePin` 只解密後立即歸零 seed，不解鎖 profile、不改 `lastUsedAt`、`pinAttempts` 或
`lockedUntil`。PIN 成功且 AppShell 已取得秘密輸入守衛後，`verifyMnemonicForProfile` 才接受玩家
自行輸入的 12／24 詞；正規化空白與大小寫、驗 checksum、衍生 keypair／PeerId 並與指定 profile
比較，只回 `true`／`false`。不得呼叫 `recoverFromMnemonic`，不得建立、切換或修改 profile，也不得
回傳衍生 PeerId、錯誤字位或部分匹配。seed 等 mutable buffer 在 `finally` 歸零；JavaScript 字串不
保證物理抹除。

## 4. PIN 加密儲存（Argon2id + AES-GCM）

```typescript
import { argon2id } from '@noble/hashes/argon2';

const DEFAULT_ARGON2: Argon2Params = { algorithm: 'argon2id', iterations: 3, memoryKiB: 65536, parallelism: 4 };  // 64 MiB

async function encryptSeed(seed: Uint8Array, pin: string): Promise<EncryptedSeed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const derivedKey = await argon2id(new TextEncoder().encode(pin), salt,
    { t: DEFAULT_ARGON2.iterations, m: DEFAULT_ARGON2.memoryKiB, p: DEFAULT_ARGON2.parallelism, dkLen: 32 });
  const cryptoKey = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, seed));
  return { ciphertext, iv, salt, kdfParams: DEFAULT_ARGON2, version: 1 };
}

async function decryptSeed(enc: EncryptedSeed, pin: string): Promise<Result<Uint8Array>> {
  try {
    const derivedKey = await argon2id(new TextEncoder().encode(pin), enc.salt,
      { t: enc.kdfParams.iterations, m: enc.kdfParams.memoryKiB, p: enc.kdfParams.parallelism, dkLen: 32 });
    const cryptoKey = await crypto.subtle.importKey('raw', derivedKey, { name: 'AES-GCM' }, false, ['decrypt']);
    return ok(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.iv }, cryptoKey, enc.ciphertext)));
  } catch { return err('invalid-pin'); }
}
```

## 5. IndexedDB Schema

```typescript
const DB_NAME = 'open4wd-keys', DB_VERSION = 1;
// store 'profiles'：keyPath 'profileId'，index ['nickname','peerId']
// fields: profileId, nickname, peerId, encryptedSeed(EncryptedSeed), createdAt, lastUsedAt, pinAttempts, lockedUntil
// store 'identity-containers'：keyPath 'peerId'
```

私鑰 seed **只以 `EncryptedSeed` 形態落 IndexedDB**；解鎖後 KeyPair 僅存記憶體、`lock()` 清除。

同一 origin 可保存多個 profile，但全 origin 同時只允許一個 active identity。切換 profile 必須先撤銷
前一個 durable activation token、停止舊 app generation 並清除明文工作集；不同分頁不得同時活動
不同 PeerId。`deleteProfile` 以同一 transaction 同時刪除 profile 與對應 identity container。

### 5.1 Sealed identity container

`identity-containers` 每個 PeerId 一列：`{ schemaVersion: 1, peerId, revision, domains }`。blocklist、
favorites、recent teammates、garage loadouts、Inbox read markers 等小型身分資料各自 DAG-CBOR 編碼後，以
`HKDF-SHA256(master seed, peerId + domain)` 派生 256-bit AES-GCM key 封存。PIN 只保護本機
`encryptedSeed`，**不得**用來派生 domain key；因此換 PIN 不需重封，且只拿到 sealed blob 而沒有
備份碼的人不能離線暴破 PIN 取得身分資料。workspace 以 revision CAS 避免分頁間遺失更新，解鎖中
才保有明文 cache。

`network-authority` domain 保存 TURN manual credential、pinning API token 與長期 signaling
credential 的具名 logical slots；它與 session token／socket／challenge／upload grant 分離，且列為
不可攜 domain，不進本機備份。profile 切換、登出、跨分頁撤銷或刪除會先清 session 明文與 workspace
cache；同名 slot 只在目前 PeerId container 內解析。

`asset-library` 也是 portable sealed domain。刪除 profile 時，KeyManager 只在 PIN 驗證後提供
callback-scoped `openDomain()`；callback 可讀取並準備裝置 GC 投影差異，但不能保留解密 key。
context 在 callback 結束即失效，profile 與 container 成功刪除後才執行 prepared finalizer，避免
刪除失敗時先減少仍存在身份的資產保護引用。

## 6. 暴力破解防護

```typescript
class PinAttemptGuard {
  static readonly MAX_ATTEMPTS = 5;
  static readonly LOCK_DURATION_MS = 30 * 60 * 1000;   // 30 分鐘

  async tryUnlock(profileId: string, pin: string): Promise<Result<KeyPair, KeyManagerError>> {
    const profile = await db.profiles.get(profileId);
    if (!profile) return err({ code: 'profile-not-found' });
    if (Date.now() < profile.lockedUntil)
      return err({ code: 'pin-locked', remainingMinutes: Math.ceil((profile.lockedUntil - Date.now()) / 60000) });

    const result = await decryptSeed(profile.encryptedSeed, pin);
    if (result.ok) {
      await db.profiles.update(profileId, { pinAttempts: 0, lockedUntil: 0 });
      return ok(deriveKeyPair(result.value));
    }
    const attempts = profile.pinAttempts + 1;
    if (attempts >= PinAttemptGuard.MAX_ATTEMPTS) {
      await db.profiles.update(profileId, { pinAttempts: attempts, lockedUntil: Date.now() + PinAttemptGuard.LOCK_DURATION_MS });
      return err({ code: 'pin-locked-now', lockMinutes: PinAttemptGuard.LOCK_DURATION_MS / 60000 });
    }
    await db.profiles.update(profileId, { pinAttempts: attempts });
    return err({ code: 'pin-invalid', attemptsLeft: PinAttemptGuard.MAX_ATTEMPTS - attempts });
  }
}
```

> `lockedUntil` / `Date.now()` 是**本地 UI 防護**（單機暴力破解），非 P2P 共識路徑，故可用機器時鐘（與共識用 `consensusNow` 不同，見 [ledger.md](ledger.md)）。
>
> 領域錯誤一律結構化 `KeyManagerError`（[§1](#1-型別)）——模組不產使用者文案，UI 層以 code 映射 i18n（`errors.keyManager.*`，[語系清單.md §3](../語系清單.md) `errors` 命名空間）並插值參數。不變式守門（未解鎖呼叫 `sign` / `getPeerId` / `changePin`、`createProfile` 助記詞不合法 ／ 身分已存在）＝ throw、屬開發者面（正常 UI 流程不可達：表單層以 `validateMnemonic` 前置驗證、建檔助記詞為現場生成）。

## 7. 助記詞恢復

```typescript
async function recoverFromMnemonic(mnemonic: Mnemonic, newPin: string, nickname?: string): Promise<KeyPair> {   // 簽名同 §2
  if (!validateMnemonic(mnemonic)) throw new Error('invalid-mnemonic');
  const seed = mnemonicToSeed(mnemonic);
  const keyPair = deriveKeyPair(seed);
  const peerId = publicKeyToPeerId(keyPair.publicKey);
  const encryptedSeed = await encryptSeed(seed, newPin);

  const existing = await db.profiles.findByPeerId(peerId);
  if (existing) {                                              // 既有 → 重設 PIN、清暴力鎖
    await db.profiles.update(existing.profileId, { encryptedSeed, pinAttempts: 0, lockedUntil: 0 });
  } else {                                                     // 新機器 → 建新 profile；暱稱＝nickname 參數、否則完整 PeerId 雜湊短指紋
    await db.profiles.put({ profileId: crypto.randomUUID(), nickname: nickname ?? peerFingerprintLabel(peerId), peerId,
      createdAt: Date.now(), lastUsedAt: Date.now(), pinAttempts: 0, lockedUntil: 0, encryptedSeed });
  }
  return keyPair;                                              // 恢復即解鎖
}
```

恢復僅需助記詞 + 新 PIN，不依賴任何伺服器（no central account）。
profile 暱稱只供本機自報呈現；PeerId 仍是唯一身分權威，遠端顯示必須依
[chat-system.md §1](chat-system.md) 附上由已驗 PeerId 計算的穩定短指紋。

## 8. 硬體錢包介面

```typescript
interface HardwareKeyProvider {
  readonly type: 'webauthn' | 'ledger' | 'trezor' | 'yubikey';
  isAvailable(): Promise<boolean>;
  enroll(): Promise<{ publicKey: Uint8Array; credentialId: Uint8Array }>;
  sign(message: Uint8Array): Promise<Signature>;
  getPublicKey(): Promise<Uint8Array>;
}
// WebAuthnProvider：PublicKeyCredential + alg -8 (Ed25519)、platform authenticator、userVerification 'required'
```

啟用硬體 provider 後，`sign` 委派硬體；私鑰永不離開安全元件。

## 9. SignedPayload（簽章封裝，跨模組共用）

> **權威介面**對齊 [資安規範.md §3.4](../資安規範.md)：**timestamp 與 nonce 必須在簽章涵蓋範圍內**（否則可竄改時戳重放）。

```typescript
interface SignedPayload<T> {
  payload: T;                  // dag-cbor 可編碼值（禁 undefined 欄位）
  timestamp: number;           // ms epoch
  nonce: Uint8Array;           // 16 bytes（P2P_MESSAGE_NONCE_BYTES）
  signer: PeerId;
  signature: Signature;        // ed25519.sign(priv, buildSignedMessage(payload, timestamp, nonce, signer))
}

// 簽章訊息＝sha256(dagCbor.encode({ nonce, payload, signer, timestamp }))
// dag-cbor canonical（map 鍵排序）→ 跨 peer 位元組一致，同 ledger-admission.md §1 序列化原則
function buildSignedMessage(payload: unknown, timestamp: number, nonce: Uint8Array, signer: PeerId): Uint8Array {
  return sha256(dagCbor.encode({ nonce, payload, signer, timestamp }));
}

// signPayload＝KeyManager 類方法（以當前解鎖身分簽發，§2）
async signPayload<T>(payload: T): Promise<SignedPayload<T>> {
  const timestamp = this.now();
  const nonce = crypto.getRandomValues(new Uint8Array(16));   // P2P_MESSAGE_NONCE_BYTES
  const signer = this.getPeerId();
  const signature = await this.sign(buildSignedMessage(payload, timestamp, nonce, signer));
  return { payload, timestamp, nonce, signer, signature };
}

// verifySignedPayload＝**同步 free function**（驗章免本地身分——公鑰內含於 signer PeerId、不經 KeyManager 實例）
function verifySignedPayload<T>(signed: SignedPayload<T>): boolean {
  const publicKey = peerIdToPublicKey(signed.signer);
  if (!publicKey) return false;
  const message = buildSignedMessage(signed.payload, signed.timestamp, signed.nonce, signed.signer);
  return verifyMessage(publicKey, message, signed.signature);
}
```

P2P 訊息的完整驗證流程（timestamp ±30s + nonce set + 簽章）見 [security.md §P2P 訊息驗簽](security.md)。

## 10. Race Sign Key（每場 ephemeral，[資安規範.md §13](../資安規範.md)）

每場比賽派生 **ephemeral 子簽章鑰**，用於賽內高頻訊息簽署（[network-sync.md](network-sync.md) input 等），避免 long-term key 暴露於高頻賽內封包。派生與生命週期屬本模組範圍、確定性派生：

```typescript
raceKeyPair = deriveKeyPair(sha256(masterPrivateKey ‖ utf8('open4wd-race-sign') ‖ utf8(raceId)));
```

同（master key, raceId）恆得同一把鑰（重啟 ／ 重連可重派生）；各 peer 各自持鑰、公鑰於賽前握手交換（[流程/配對.md](../流程/配對.md)）。賽後丟棄；上鏈結算仍用 master key 多簽。

## 11. 與其他模組整合

| 模組 | 用途 |
|---|---|
| `ledger/`（[ledger.md](ledger.md)）| 事件簽章 / 多簽結算 / 帳本檢查點 multisig → `KeyManager.sign(ledgerSigningDigest(ledgerAddress, event))`；KeyManager 不自行定義 digest |
| `security/`（[security.md](security.md)）| `SignedPayload` 驗章 / P2P 訊息驗簽 |
| `network-sync/` | ephemeral checksum 訊息簽署（Race Sign Key）|
| `signaling-service/` | 取 PeerId 做握手 |
| `ugc-fork/` | 作品上傳簽名 |
| `reputation/`（[reputation.md](reputation.md)）| PeerId 綁定信譽 |
