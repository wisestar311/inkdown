import { idbGet, idbSet } from './db'

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
  /** 동기화하지 않고 이 기기에만 두는 문서 */
  localOnly?: boolean
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
  /** 사용자가 만든 폴더 목록(빈 폴더 포함) */
  folders: string[]
  /** 접어 둔 폴더 */
  collapsedFolders: string[]
  /** PDF에 손글씨(펜·형광펜·직선) 포함 — 글상자는 항상 포함 */
  pdfStrokes: boolean
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
  folders: [],
  collapsedFolders: [],
  pdfStrokes: true,
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
    const docs = await idbGet<Doc[]>(DOCS_KEY)
    if (docs) return docs
    const legacy = read<Doc[]>(LEGACY_DOCS_KEY, [])
    if (legacy.length) {
      await idbSet(DOCS_KEY, legacy)
      localStorage.removeItem(LEGACY_DOCS_KEY)
    }
    return legacy
  } catch {
    return read<Doc[]>(LEGACY_DOCS_KEY, [])
  }
}

export const saveDocs = (docs: Doc[]) =>
  idbSet(DOCS_KEY, docs).catch((err) => console.warn('문서를 저장하지 못했습니다', err))

export const loadTombstones = async () => (await idbGet<Tombstone[]>(TOMB_KEY).catch(() => undefined)) ?? []
export const saveTombstones = (t: Tombstone[]) => idbSet(TOMB_KEY, t).catch(() => undefined)

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
})
export const saveSyncConfig = (c: SyncConfig) => write(SYNC_KEY, c)
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
