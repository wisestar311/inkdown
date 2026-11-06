import { idbGet, idbSet } from './db'
import { isLockEnabled, seal, unseal, type Sealed } from './vault'

export interface Doc {
  id: string
  title: string
  content: string
  updatedAt: number
  /** 내 컴퓨터의 파일과 연결된 경우 파일 이름 */
  fileName?: string
  /** 데스크톱 앱에서 연 파일의 실제 경로 */
  localPath?: string
  /** 마지막으로 로컬 파일에 저장한 이후 변경되었는지 */
  dirty?: boolean
  /** 사이드바 폴더 경로 ('' 또는 없음 = 최상위, 하위 폴더는 '유튜브/대본') */
  folder?: string
  /** 이 기기에서 폴더를 옮겨 원격 파일도 옮겨야 함 */
  moved?: boolean
  /** 내 컴퓨터 파일(💾) 문서지만 동기화에도 포함 */
  syncLocal?: boolean
  /** 동기화하지 않고 이 기기에만 두는 문서 */
  localOnly?: boolean
  /** Obsidian에서 가져온 문서의 원래 경로 (다시 가져올 때 같은 문서를 갱신) */
  importedFrom?: string
  /** 동기화 저장소 안의 경로 (예: notes/회의록.md) */
  remotePath?: string
  /** 마지막으로 동기화한 원격 파일의 blob SHA */
  remoteSha?: string
  /** 마지막으로 동기화한 내용의 해시. 현재 내용과 다르면 업로드 대상 */
  syncedHash?: string
}

/** 이 기기에서 삭제했지만 아직 원격에서 지우지 못한 파일 */
export interface Tombstone {
  path: string
  sha: string
}

export type ThemeId = 'light' | 'sepia' | 'dark' | 'nord'

export interface Settings {
  theme: ThemeId
  sidebarOpen: boolean
  sidebarTab: 'files' | 'outline'
  focusMode: boolean
  typewriterMode: boolean
  fontSize: number
  contentWidth: number
  /** 글꼴: 내장 글꼴 id 또는 'custom:글꼴이름' */
  bodyFont: string
  /** 'same'이면 본문 글꼴을 따름 */
  headingFont: string
  codeFont: string
  lineHeight: number
  /** 제목 1~6 색 ('' = 테마 기본색, 그 외 #rrggbb) */
  headingColors: string[]
  /** 글꼴·제목 색을 마지막으로 바꾼 시각 (기기 간 맞출 때 나중 것이 이김) */
  appearanceAt?: number
  /** 글꼴·제목 색을 모든 기기에 맞출지 */
  syncAppearance?: boolean
  /** 사용자가 만든 폴더 목록(빈 폴더 포함) */
  folders: string[]
  /** 접어 둔 폴더 */
  collapsedFolders: string[]
  /** 마지막 동기화 때 맞춘 폴더 목록 (폴더 삭제를 다른 기기에 전하기 위해) */
  syncedFolders?: string[]
  /** PDF에 손글씨(펜·형광펜·직선) 포함 — 글상자는 항상 포함 */
  pdfStrokes: boolean
  /** Obsidian 보관함(vault) 이름 — 비우면 Obsidian에서 마지막으로 연 보관함 */
  obsidianVault: string
  /** 보관함 안에서 Inkdown 문서를 넣을 폴더 */
  obsidianSub: string
  /** 데스크톱: 모든 문서를 내보낼 보관함 폴더 경로 / 웹: 고른 폴더 이름(표시용) */
  obsidianDir: string
}

export interface SyncConfig {
  enabled: boolean
  owner: string
  repo: string
  branch: string
  folder: string
  token: string
  device: string
}

const LEGACY_DOCS_KEY = 'inkdown:docs'
const DOCS_KEY = 'docs'
const TOMB_KEY = 'tombstones'
const ACTIVE_KEY = 'inkdown:active'
const SETTINGS_KEY = 'inkdown:settings'
const SYNC_KEY = 'inkdown:sync'
const LAST_SYNC_KEY = 'inkdown:lastSync'

export const defaultSettings: Settings = {
  theme: 'light',
  sidebarOpen: true,
  sidebarTab: 'files',
  focusMode: false,
  typewriterMode: false,
  fontSize: 16,
  contentWidth: 860,
  bodyFont: 'system',
  headingFont: 'same',
  codeFont: 'system-mono',
  lineHeight: 1.75,
  headingColors: ['', '', '', '', '', ''],
  folders: [],
  collapsedFolders: [],
  pdfStrokes: true,
  obsidianVault: '',
  obsidianSub: 'Inkdown',
  obsidianDir: '',
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn('설정을 저장하지 못했습니다', err)
  }
}

/** 문서 목록 불러오기. 이전 버전(localStorage)에 저장된 문서는 IndexedDB로 옮김 */
export async function loadDocs(): Promise<Doc[]> {
  try {
    const stored = await idbGet<Doc[] | Sealed>(DOCS_KEY)
    if (stored) return (await unseal<Doc[]>(stored)) ?? []
    const legacy = read<Doc[]>(LEGACY_DOCS_KEY, [])
    if (legacy.length) {
      await idbSet(DOCS_KEY, legacy)
      localStorage.removeItem(LEGACY_DOCS_KEY)
    }
    return legacy
  } catch (e) {
    if (isLockEnabled()) throw e // 잠금 데이터는 열지 못하면 빈 목록으로 덮어쓰지 않도록 중단
    return read<Doc[]>(LEGACY_DOCS_KEY, [])
  }
}

/** 잠금이 켜져 있으면 PIN 키로 암호화해서 저장 */
export const saveDocs = async (docs: Doc[]) => {
  try {
    await idbSet(DOCS_KEY, await seal(docs))
  } catch (err) {
    console.warn('문서를 저장하지 못했습니다', err)
  }
}

export const loadTombstones = async () => (await unseal<Tombstone[]>(await idbGet<Tombstone[] | Sealed>(TOMB_KEY).catch(() => undefined)).catch(() => undefined)) ?? []
export const saveTombstones = async (t: Tombstone[]) => idbSet(TOMB_KEY, await seal(t)).catch(() => undefined)

export const loadActiveId = () => read<string | null>(ACTIVE_KEY, null)
export const saveActiveId = (id: string) => write(ACTIVE_KEY, id)
export const loadSettings = (): Settings => {
  const raw = read<Partial<Settings>>(SETTINGS_KEY, {})
  // 폴더 기능이 생기기 전 설정: 한 번은 문서(폴더) 탭을 보여 줌
  if (raw.folders === undefined) raw.sidebarTab = 'files'
  return { ...defaultSettings, ...raw }
}
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s)

function defaultDevice() {
  const p = navigator.userAgent
  const os = /Windows/.test(p) ? 'Windows' : /Mac/.test(p) ? 'Mac' : /Android/.test(p) ? 'Android' : /iPhone|iPad/.test(p) ? 'iOS' : 'Linux'
  const kind = 'inkdownDesktop' in window ? '앱' : '웹'
  return `${os} ${kind}`
}

export const loadSyncConfig = (): SyncConfig => ({
  enabled: false,
  owner: '',
  repo: '',
  branch: 'main',
  folder: 'notes',
  token: '',
  device: defaultDevice(),
  ...read<Partial<SyncConfig>>(SYNC_KEY, {}),
  ...(isLockEnabled() ? { token: tokenCache } : {}),
})
/* 잠금이 켜져 있으면 토큰은 localStorage가 아니라 암호화해서 IndexedDB에 보관 */
const TOKEN_KEY = 'syncToken'
let tokenCache = ''

/** 앱 시작(잠금 해제) 후 한 번 호출: 암호화된 토큰을 메모리로 불러옴 */
export async function loadSecrets() {
  if (!isLockEnabled()) return
  tokenCache = (await unseal<string>(await idbGet<string | Sealed>(TOKEN_KEY).catch(() => undefined)).catch(() => '')) ?? ''
}

export function saveSyncConfig(c: SyncConfig) {
  if (isLockEnabled()) {
    tokenCache = c.token
    write(SYNC_KEY, { ...c, token: '' })
    seal(c.token).then((v) => idbSet(TOKEN_KEY, v)).catch(() => undefined)
  } else {
    write(SYNC_KEY, c)
    idbSet(TOKEN_KEY, '').catch(() => undefined)
  }
}
export const loadLastSync = () => read<number | null>(LAST_SYNC_KEY, null)
export const saveLastSync = (t: number) => write(LAST_SYNC_KEY, t)

export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** 문서의 첫 번째 제목(또는 첫 줄)으로 제목을 추정 */
export function deriveTitle(md: string, fallback = '제목 없음'): string {
  const heading = md.match(/^#{1,6}\s+(.+)$/m)
  const line = heading?.[1] ?? md.split('\n').find((l) => l.trim() && !l.startsWith('![') && !l.startsWith('<!--'))
  const title = (line ?? '').replace(/[#*_`>[\]()!~]/g, '').trim()
  return title.slice(0, 60) || fallback
}

/** 빠른 문자열 해시(FNV-1a). 변경 여부 판단용 */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}-${s.length}`
}
