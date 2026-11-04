/* PIN 잠금 금고.
   잠금을 켜면 이 기기에 저장되는 문서·필기·동기화 토큰을 PIN에서 만든 키(PBKDF2-SHA256 → AES-256-GCM)로 암호화한다.
   PIN 자체는 저장하지 않고, 같은 키로 암호화한 확인용 값만 저장해 맞는 PIN인지 판단한다. */

const LOCK_KEY = 'inkdown:lock'
const ATTEMPT_KEY = 'inkdown:lockAttempts'
const ITERATIONS = 600_000
const CHECK_TEXT = 'inkdown-vault-ok'

export interface LockConfig {
  salt: string
  check: Sealed
  iterations: number
  /** 조작이 없을 때 자동 잠금까지 분 (0 = 사용 안 함) */
  autoLockMin: number
}

export interface Sealed {
  iv: string
  ct: string
}

let key: CryptoKey | null = null

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function deriveKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function sealWith(k: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(value)))
  return { iv: b64(iv), ct: b64(ct) }
}

async function openWith<T>(k: CryptoKey, sealed: Sealed): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource }, k, unb64(sealed.ct) as BufferSource)
  return JSON.parse(new TextDecoder().decode(pt)) as T
}

export const isSealed = (v: unknown): v is Sealed => !!v && typeof v === 'object' && 'iv' in v && 'ct' in v && typeof (v as Sealed).ct === 'string'

export function getLockConfig(): LockConfig | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    return raw ? (JSON.parse(raw) as LockConfig) : null
  } catch {
    return null
  }
}

export const isLockEnabled = () => !!getLockConfig()
export const isUnlocked = () => !!key

/** 잠금이 켜져 있고 키가 있으면 암호화, 잠금이 꺼져 있으면 그대로 */
export async function seal<T>(value: T): Promise<T | Sealed> {
  if (!isLockEnabled()) return value
  if (!key) throw new Error('잠겨 있어 저장할 수 없습니다')
  return sealWith(key, value)
}

export async function unseal<T>(stored: T | Sealed | undefined): Promise<T | undefined> {
  if (!isSealed(stored)) return stored as T | undefined
  if (!key) throw new Error('잠겨 있습니다')
  return openWith<T>(key, stored)
}

// ---------- 틀린 횟수 제한 ----------
interface Attempts {
  fails: number
  until: number
}
const readAttempts = (): Attempts => {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPT_KEY) ?? '') as Attempts
  } catch {
    return { fails: 0, until: 0 }
  }
}
/** 다시 시도할 수 있을 때까지 남은 초 */
export const lockoutSeconds = () => Math.max(0, Math.ceil((readAttempts().until - Date.now()) / 1000))
export const failCount = () => readAttempts().fails

function recordFail() {
  const a = readAttempts()
  const fails = a.fails + 1
  // 5회부터 30초, 그 뒤 한 번 틀릴 때마다 두 배 (최대 1시간)
  const wait = fails >= 5 ? Math.min(3600, 30 * 2 ** (fails - 5)) : 0
  localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ fails, until: Date.now() + wait * 1000 }))
}

/** PIN 확인 후 금고 열기 */
export async function unlock(pin: string): Promise<boolean> {
  const cfg = getLockConfig()
  if (!cfg) return true
  if (lockoutSeconds() > 0) return false
  const k = await deriveKey(pin, unb64(cfg.salt), cfg.iterations)
  try {
    if ((await openWith<string>(k, cfg.check)) !== CHECK_TEXT) throw new Error()
  } catch {
    recordFail()
    return false
  }
  key = k
  localStorage.removeItem(ATTEMPT_KEY)
  return true
}

/** 잠금 켜기 / PIN 바꾸기 (데이터 다시 저장은 호출한 쪽에서) */
export async function setPin(pin: string, autoLockMin: number) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const k = await deriveKey(pin, salt, ITERATIONS)
  const cfg: LockConfig = { salt: b64(salt), check: await sealWith(k, CHECK_TEXT), iterations: ITERATIONS, autoLockMin }
  localStorage.setItem(LOCK_KEY, JSON.stringify(cfg))
  key = k
}

export function setAutoLock(autoLockMin: number) {
  const cfg = getLockConfig()
  if (cfg) localStorage.setItem(LOCK_KEY, JSON.stringify({ ...cfg, autoLockMin }))
}

/** 잠금 끄기 (데이터를 평문으로 다시 저장하는 것은 호출한 쪽에서) */
export function removeLock() {
  localStorage.removeItem(LOCK_KEY)
  localStorage.removeItem(ATTEMPT_KEY)
  key = null
}

export const validPin = (pin: string) => /^\d{4,8}$/.test(pin)
