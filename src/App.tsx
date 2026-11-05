import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { WysiwygEditor, type EditorHandle, type FormatCommand } from './components/WysiwygEditor'
import { SourceEditor, type SourceHandle } from './components/SourceEditor'
import { MenuBar, type Menu, type MenuItem } from './components/MenuBar'
import { Sidebar } from './components/Sidebar'
import { Modal, PromptDialog, type PromptRequest } from './components/Dialog'
import { SyncDialog } from './components/SyncDialog'
import { FontDialog } from './components/FontDialog'
import { TemplateDialog } from './components/TemplateDialog'
import { LockDialog } from './components/LockDialog'
import { AboutDialog } from './components/AboutDialog'
import { ExportDialog, ObsidianDialog, type ExportFormat } from './components/ExportDialogs'
import { docsToFiles, makeZip, toDocx, toObsidian, toPlainText } from './lib/convert'
import { exportAllToVault, openInObsidian } from './lib/obsidian'
import { getLockConfig, isLockEnabled } from './lib/vault'
import { TEMPLATE_FOLDER } from './templates'
import { InkLayer, InkToolbar, PEN_COLORS, PEN_SIZES, type InkHandle, type InkToolState } from './components/InkLayer'
import { type InkData, emptyInk, joinInk, splitInk } from './lib/ink'
import { BODY_FONTS, CODE_FONTS, FONT_FALLBACK, resolveFont } from './lib/fonts'
import { validColor } from './lib/headingColors'
import {
  type Doc,
  type Settings,
  type SyncConfig,
  type ThemeId,
  type Tombstone,
  deriveTitle,
  hashText,
  loadActiveId,
  loadLastSync,
  loadSettings,
  loadSyncConfig,
  newId,
  saveActiveId,
  saveDocs,
  saveLastSync,
  saveSettings,
  saveSyncConfig,
  saveTombstones,
} from './lib/storage'
import { countStats, extractHeadings, type Heading } from './lib/markdown'
import {
  type TreeNode,
  compressImage,
  download,
  openFile,
  openFolder,
  saveFileAs,
  supportsFolder as webSupportsFolder,
  writeHandle,
} from './lib/fileio'
import { buildHtmlDocument } from './lib/export'
import { desktop, isDesktop } from './lib/desktop'
import { cleanFolder, isSyncable, runSync, type SyncStore } from './lib/sync/engine'
import { WELCOME } from './welcome'

type Mode = 'wysiwyg' | 'source'
type SyncState = { phase: 'off' | 'idle' | 'syncing' | 'error' | 'offline'; message?: string; last: number | null; remoteTotal?: number }

const THEMES: { id: ThemeId; label: string; dark: boolean }[] = [
  { id: 'light', label: '라이트', dark: false },
  { id: 'sepia', label: '세피아', dark: false },
  { id: 'dark', label: '다크', dark: true },
  { id: 'nord', label: '노르딕', dark: true },
]

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl'
const sc = (s: string) => s.replace(/Mod/g, MOD).replace(/Alt/g, isMac ? '⌥' : 'Alt').replace(/Shift/g, isMac ? '⇧' : 'Shift')
const supportsFolder = webSupportsFolder && !isDesktop

const EMPTY_INK = emptyInk()
/** 다른 기기 변경 확인 주기 (바뀐 게 없으면 GitHub이 304만 돌려줘 부담이 거의 없음) */
const SYNC_INTERVAL = 15_000
/** 입력을 멈추고 올리기까지 */
const SYNC_IDLE = 3_000
/** 💾 문서를 내 컴퓨터 파일에 자동 저장하기까지 */
const FILE_AUTOSAVE = 1_500

const safeFileName = (title: string) => `${title.replace(/[\\/:*?"<>|]/g, '').trim() || '제목 없음'}.md`

function relTime(t: number | null) {
  if (!t) return ''
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return new Date(t).toLocaleDateString('ko-KR')
}

interface AppProps {
  initialDocs: Doc[]
  initialTombstones: Tombstone[]
}

export default function App({ initialDocs, initialTombstones }: AppProps) {
  const firstDocs = useMemo<Doc[]>(
    () =>
      initialDocs.length
        ? initialDocs
        : [{ id: newId(), title: deriveTitle(WELCOME), content: WELCOME, updatedAt: Date.now(), localOnly: true }],
    [initialDocs],
  )
  const [docs, setDocsState] = useState<Doc[]>(firstDocs)
  const docsRef = useRef(docs)
  const [activeId, setActiveIdState] = useState<string>(() => {
    const saved = loadActiveId()
    return saved && firstDocs.some((d) => d.id === saved) ? saved : firstDocs[0]!.id
  })
  const activeIdRef = useRef(activeId)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [mode, setMode] = useState<Mode>('wysiwyg')
  const [nonce, setNonce] = useState(0)
  const [folder, setFolder] = useState<{ name: string; tree: TreeNode[] } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(false)
  const [promptReq, setPromptReq] = useState<PromptRequest | null>(null)
  const [syncCfg, setSyncCfg] = useState<SyncConfig>(loadSyncConfig)
  const [syncOpen, setSyncOpen] = useState(false)
  const [fontOpen, setFontOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [lockOpen, setLockOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [obsidianOpen, setObsidianOpen] = useState(false)
  const [lockOn, setLockOn] = useState(isLockEnabled)
  const skipUnloadWarn = useRef(false)
  const [inkMode, setInkMode] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [printStrokes, setPrintStrokes] = useState(true)
  const [pdfAsk, setPdfAsk] = useState(false)
  const [inkTool, setInkTool] = useState<InkToolState>({ tool: 'pen', color: PEN_COLORS[0]!, size: PEN_SIZES[1]! })
  const inkRef = useRef<InkHandle>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [sync, setSync] = useState<SyncState>(() => ({ phase: loadSyncConfig().enabled ? 'idle' : 'off', last: loadLastSync() }))
  const [, setTick] = useState(0)

  const tombstones = useRef<Tombstone[]>(initialTombstones)
  const handles = useRef(new Map<string, FileSystemFileHandle>())
  const paths = useRef(new Map<string, string>())
  const editorRef = useRef<EditorHandle>(null)
  const sourceRef = useRef<SourceHandle>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const active = docs.find((d) => d.id === activeId) ?? docs[0]!
  const theme = THEMES.find((t) => t.id === settings.theme) ?? THEMES[0]!
  // 본문과 필기 데이터를 분리 (필기는 문서 끝 주석에 저장됨)
  const { body: activeBody, ink: activeInk } = useMemo(() => splitInk(active.content), [active.content])
  const deferred = useDeferredValue(activeBody)
  const headings = useMemo(() => extractHeadings(deferred), [deferred])
  const stats = useMemo(() => countStats(deferred), [deferred])

  // ---------- 문서 상태 (ref와 state를 항상 함께 갱신해 비동기 동기화가 최신 값을 보게 함) ----------
  const updateDocs = useCallback((fn: (list: Doc[]) => Doc[]) => {
    const next = fn(docsRef.current)
    if (next === docsRef.current) return
    docsRef.current = next
    setDocsState(next)
  }, [])

  const setActiveId = useCallback((id: string) => {
    activeIdRef.current = id
    setActiveIdState(id)
  }, [])

  const switchTo = useCallback(
    (id: string) => {
      setActiveId(id)
      setNonce((n) => n + 1)
    },
    [setActiveId],
  )

  const ensureActive = useCallback(() => {
    const list = docsRef.current
    if (list.some((d) => d.id === activeIdRef.current)) return
    if (!list.length) {
      const blank: Doc = { id: newId(), title: '제목 없음', content: '', updatedAt: Date.now() }
      docsRef.current = [blank]
      setDocsState([blank])
    }
    switchTo([...docsRef.current].sort((a, b) => b.updatedAt - a.updatedAt)[0]!.id)
  }, [switchTo])

  // ---------- 영속화 ----------
  useEffect(() => {
    const t = setTimeout(() => saveDocs(docs), 300)
    return () => clearTimeout(t)
  }, [docs])
  useEffect(() => saveActiveId(activeId), [activeId])
  useEffect(() => saveSettings(settings), [settings])

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = printing ? 'light' : settings.theme // 인쇄는 항상 흰 바탕
    root.style.setProperty('--editor-font-size', `${settings.fontSize}px`)
    root.style.setProperty('--content-width', `${settings.contentWidth}px`)
    // '시스템 기본'이면 테마 기본 글꼴(세피아는 명조)을 따름
    const body = resolveFont(settings.bodyFont, BODY_FONTS, FONT_FALLBACK.body)
    if (settings.bodyFont === 'system') root.style.removeProperty('--font-body')
    else root.style.setProperty('--font-body', body)
    root.style.setProperty('--font-heading', settings.headingFont === 'same' ? 'var(--font-body)' : resolveFont(settings.headingFont, BODY_FONTS, FONT_FALLBACK.body))
    root.style.setProperty('--font-mono', resolveFont(settings.codeFont, CODE_FONTS, FONT_FALLBACK.code))
    root.style.setProperty('--line-height', String(settings.lineHeight))
    settings.headingColors.forEach((c, i) => (validColor(c) ? root.style.setProperty(`--h${i + 1}-color`, c) : root.style.removeProperty(`--h${i + 1}-color`)))
  }, [printing, settings.theme, settings.fontSize, settings.contentWidth, settings.bodyFont, settings.headingFont, settings.codeFont, settings.lineHeight, settings.headingColors])

  useEffect(() => {
    document.title = `${active.dirty ? '• ' : ''}${active.title} — Inkdown`
  }, [active.title, active.dirty])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // 상태 표시줄의 "n분 전" 갱신
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  // ---------- 입력 대화상자 ----------
  const ask = useCallback(
    (title: string, defaultValue = '', label?: string) =>
      new Promise<string | null>((resolve) => setPromptReq({ title, defaultValue, ...(label ? { label } : {}), resolve })),
    [],
  )

  // ---------- 동기화 ----------
  const syncRunning = useRef(false)
  const syncAgain = useRef(false)
  const syncCfgRef = useRef(syncCfg)
  syncCfgRef.current = syncCfg

  const store: SyncStore = useMemo(
    () => ({
      getDocs: () => docsRef.current,
      patchDoc(id, patch, expectHash) {
        const cur = docsRef.current.find((d) => d.id === id)
        if (!cur) return false
        if (expectHash !== undefined && hashText(cur.content) !== expectHash) return false
        updateDocs((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)))
        if (patch.content !== undefined && patch.content !== cur.content && id === activeIdRef.current) setNonce((n) => n + 1)
        return true
      },
      addDoc(doc) {
        updateDocs((list) => [...list, doc])
      },
      removeDoc(id) {
        updateDocs((list) => list.filter((d) => d.id !== id))
        if (id === activeIdRef.current) ensureActive()
      },
      getTombstones: () => tombstones.current,
      setTombstones(t) {
        tombstones.current = t
        saveTombstones(t)
      },
      // 사용자가 만든 폴더 + 문서가 들어 있는 폴더(상위 폴더 포함)
      getFolders: () => {
        const set = new Set(settingsRef.current.folders)
        for (const d of docsRef.current) {
          const parts = (d.folder ?? '').split('/').filter(Boolean)
          parts.forEach((_, i) => set.add(parts.slice(0, i + 1).join('/')))
        }
        return [...set]
      },
      getSyncedFolders: () => settingsRef.current.syncedFolders,
      setFolders(folders) {
        settingsRef.current = { ...settingsRef.current, folders, syncedFolders: folders }
        setSettings((s) => ({ ...s, folders, syncedFolders: folders }))
      },
    }),
    [ensureActive, updateDocs],
  )

  const runSyncNow = useCallback(
    async (manual = false) => {
      const cfg = syncCfgRef.current
      if (!cfg.enabled || !cfg.token) return
      if (syncRunning.current) {
        syncAgain.current = true
        return
      }
      if (!navigator.onLine) {
        setSync((s) => ({ ...s, phase: 'offline', message: '오프라인 — 연결되면 자동으로 동기화합니다' }))
        return
      }
      syncRunning.current = true
      setSync((s) => ({ ...s, phase: 'syncing' }))
      try {
        do {
          syncAgain.current = false
          const report = await runSync(cfg, store)
          const now = Date.now()
          saveLastSync(now)
          setSync({ phase: 'idle', last: now, remoteTotal: report.remoteTotal })
          if (report.conflicts.length) setToast(`두 기기에서 동시에 수정된 문서 ${report.conflicts.length}개 — "충돌 사본"으로 함께 보관했습니다`)
          else if (manual) setToast(report.uploaded || report.downloaded || report.deleted ? `동기화 완료 (올림 ${report.uploaded} · 받음 ${report.downloaded} · 삭제 ${report.deleted})` : '이미 최신 상태입니다')
          else if (report.downloaded) setToast(`다른 기기의 변경 ${report.downloaded}건을 받았습니다`)
        } while (syncAgain.current)
      } catch (e) {
        setSync((s) => ({ ...s, phase: 'error', message: (e as Error).message }))
        if (manual) setToast(`동기화 실패: ${(e as Error).message}`)
      } finally {
        syncRunning.current = false
        await saveDocs(docsRef.current)
      }
    },
    [store],
  )

  // 시작 시, 주기적으로, 창으로 돌아왔을 때, 다시 온라인이 됐을 때
  useEffect(() => {
    if (!syncCfg.enabled) return
    runSyncNow()
    const timer = setInterval(() => document.visibilityState === 'visible' && runSyncNow(), SYNC_INTERVAL)
    const onVisible = () => document.visibilityState === 'visible' && runSyncNow()
    const onOnline = () => runSyncNow()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [syncCfg.enabled, syncCfg.token, syncCfg.owner, syncCfg.repo, syncCfg.branch, syncCfg.folder, runSyncNow])

  // 입력을 멈추고 잠시 뒤 업로드
  const contentKey = useMemo(() => docs.map((d) => `${d.updatedAt}${d.moved ? `>${d.folder ?? ''}` : ''}`).join(','), [docs])

  // 폴더를 만들거나 지우면 곧바로 동기화
  const folderKey = settings.folders.join('|')
  const firstFolderKey = useRef(folderKey)
  useEffect(() => {
    if (!syncCfg.enabled || folderKey === firstFolderKey.current) return
    firstFolderKey.current = folderKey
    const t = setTimeout(() => runSyncNow(), 1_000)
    return () => clearTimeout(t)
  }, [folderKey, syncCfg.enabled, runSyncNow])

  // 💾 내 컴퓨터 파일과 연결된 문서: 입력을 멈추면 그 파일에도 자동 저장 (Obsidian처럼)
  useEffect(() => {
    const t = setTimeout(async () => {
      for (const d of docsRef.current.filter((x) => x.dirty)) {
        try {
          if (desktop && d.localPath) await desktop.writeFile(d.localPath, d.content)
          else if (handles.current.get(d.id)) await writeHandle(handles.current.get(d.id)!, d.content)
          else continue
          const written = d.content
          updateDocs((list) => list.map((x) => (x.id === d.id && x.content === written ? { ...x, dirty: false } : x)))
        } catch {
          /* 권한이 없으면 Ctrl+S 때 다시 시도 */
        }
      }
    }, FILE_AUTOSAVE)
    return () => clearTimeout(t)
  }, [contentKey, updateDocs])
  useEffect(() => {
    if (!syncCfg.enabled) return
    const t = setTimeout(() => runSyncNow(), SYNC_IDLE)
    return () => clearTimeout(t)
  }, [contentKey, syncCfg.enabled, runSyncNow])

  const saveSync = useCallback((cfg: SyncConfig) => {
    saveSyncConfig(cfg)
    setSyncCfg(cfg)
    setSync((s) => ({ ...s, phase: cfg.enabled ? 'idle' : 'off', message: '' }))
    setSyncOpen(false)
    setToast(cfg.enabled ? `${cfg.owner}/${cfg.repo} 저장소와 동기화를 시작합니다` : '동기화를 껐습니다')
  }, [])

  // 웹: 창을 닫기 전 저장 / 데스크톱: 저장과 동기화를 마친 뒤 닫힘
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (skipUnloadWarn.current) return
      saveDocs(docsRef.current)
      // 데스크톱 앱은 닫기 전에 따로 저장하므로 종료를 막지 않음 (막으면 백그라운드에 남는 원인이 됨)
      if (!isDesktop && docsRef.current.some((d) => d.dirty)) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    const off = desktop?.onBeforeClose(async () => {
      await saveDocs(docsRef.current)
      if (syncCfgRef.current.enabled) await Promise.race([runSyncNow(), new Promise((r) => setTimeout(r, 3500))])
    })
    return () => {
      window.removeEventListener('beforeunload', warn)
      off?.()
    }
  }, [runSyncNow])

  // ---------- 문서 조작 ----------
  const patchDoc = useCallback((id: string, patch: Partial<Doc>) => updateDocs((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d))), [updateDocs])

  const handleChange = useCallback(
    (md: string) => {
      const id = activeIdRef.current
      updateDocs((list) =>
        list.map((d) =>
          {
            if (d.id !== id) return d
            const content = joinInk(md, splitInk(d.content).ink)
            if (content === d.content) return d
            return { ...d, content, title: deriveTitle(md, d.fileName?.replace(/\.\w+$/, '') ?? '제목 없음'), updatedAt: Date.now(), dirty: d.fileName ? true : d.dirty }
          },
        ),
      )
    },
    [updateDocs],
  )

  const handleInkChange = useCallback(
    (ink: InkData) => {
      const id = activeIdRef.current
      updateDocs((list) =>
        list.map((d) => {
          if (d.id !== id) return d
          const content = joinInk(splitInk(d.content).body, ink)
          return content === d.content ? d : { ...d, content, updatedAt: Date.now(), dirty: d.fileName ? true : d.dirty }
        }),
      )
    },
    [updateDocs],
  )

  const createDoc = useCallback(
    (content = '', opts: { fileName?: string; handle?: FileSystemFileHandle; path?: string; localPath?: string; folder?: string } = {}) => {
      const doc: Doc = {
        id: newId(),
        content,
        title: deriveTitle(content, opts.fileName?.replace(/\.\w+$/, '') ?? '제목 없음'),
        updatedAt: Date.now(),
        ...(opts.folder ? { folder: opts.folder } : {}),
        ...(opts.fileName ? { fileName: opts.fileName } : {}),
        ...(opts.localPath ? { localPath: opts.localPath } : {}),
      }
      if (opts.handle) handles.current.set(doc.id, opts.handle)
      if (opts.path) paths.current.set(doc.id, opts.path)
      updateDocs((list) => [doc, ...list])
      switchTo(doc.id)
      return doc
    },
    [switchTo, updateDocs],
  )

  // ---------- 잠금 ----------
  /** 지금 잠그기: 저장을 마치고 화면을 다시 불러와 메모리의 문서를 비운 뒤 PIN 화면을 띄움 */
  const lockNow = useCallback(async () => {
    if (!isLockEnabled()) return setLockOpen(true)
    await saveDocs(docsRef.current)
    skipUnloadWarn.current = true
    location.reload()
  }, [])

  /** 잠금을 켜고 끄거나 PIN을 바꾼 뒤: 기기 안 데이터를 새 방식(암호화/평문)으로 다시 저장 */
  const resaveSecure = useCallback(async () => {
    await saveDocs(docsRef.current)
    await saveTombstones(tombstones.current)
    saveSyncConfig(syncCfgRef.current)
    setLockOn(isLockEnabled())
  }, [])

  // 자동 잠금: 정해진 시간 동안 조작이 없으면 잠금
  useEffect(() => {
    if (!lockOn) return
    let last = Date.now()
    const touch = () => {
      last = Date.now()
    }
    const events = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }))
    const timer = setInterval(() => {
      const min = getLockConfig()?.autoLockMin ?? 0
      if (min > 0 && Date.now() - last > min * 60_000) lockNow()
    }, 15_000)
    return () => {
      clearInterval(timer)
      events.forEach((ev) => window.removeEventListener(ev, touch))
    }
  }, [lockNow, lockOn])

  // ---------- 동기화 포함/제외 ----------
  const isWelcome = (d: Doc) => d.content.startsWith('# Inkdown에 오신 것을 환영합니다')
  const setDocSync = useCallback(
    (id: string, include: boolean) => {
      patchDoc(id, include ? { localOnly: false, syncLocal: true } : { localOnly: true })
      setToast(include ? '동기화에 포함했습니다. 잠시 뒤 다른 기기에도 나타납니다' : '이 기기에만 보관합니다 (이미 올라간 문서는 다른 기기에 남아 있습니다)')
    },
    [patchDoc],
  )
  const unsyncedDocs = useMemo(() => docs.filter((d) => !isSyncable(d) && d.content.trim() && !isWelcome(d)), [docs])
  /** 동기화 상태 화면에 보여 줄 '올라가지 않은 문서'와 이유 */
  const notSyncedList = useMemo(
    () =>
      docs
        .filter((d) => !isWelcome(d))
        .map((d) => ({
          id: d.id,
          title: d.title || '제목 없음',
          reason: d.localOnly
            ? '🔒 이 기기에만 보관'
            : (d.fileName || d.localPath) && !d.syncLocal
              ? '💾 내 컴퓨터 파일'
              : !d.content.trim()
                ? '빈 문서 (내용을 쓰면 올라감)'
                : !d.remotePath || d.moved || hashText(d.content) !== d.syncedHash
                  ? '↑ 올릴 차례 (곧 올라감)'
                  : '',
        }))
        .filter((x) => x.reason),
    [docs],
  )
  const includeAllInSync = useCallback(() => {
    const ids = new Set(unsyncedDocs.map((d) => d.id))
    updateDocs((list) => list.map((d) => (ids.has(d.id) ? { ...d, localOnly: false, syncLocal: true } : d)))
    setToast(`${ids.size}개 문서를 동기화에 포함했습니다`)
    setTimeout(() => runSyncNow(true), 300)
  }, [runSyncNow, unsyncedDocs, updateDocs])

  // ---------- 템플릿 ----------
  const isTemplateFolder = (f?: string) => !!f && (f === TEMPLATE_FOLDER || f.startsWith(`${TEMPLATE_FOLDER}/`))

  /** 템플릿으로 새 문서: 지금 보고 있는 문서와 같은 폴더에 만든다 (템플릿 폴더 제외) */
  const newFromTemplate = useCallback(
    (content: string) => {
      setTemplateOpen(false)
      const folder = active.folder && !isTemplateFolder(active.folder) ? active.folder : undefined
      createDoc(content, folder ? { folder } : {})
      setMode('wysiwyg')
    },
    [active.folder, createDoc],
  )

  const saveAsTemplate = useCallback(() => {
    setTemplateOpen(false)
    if (!active.content.trim()) return setToast('빈 문서는 템플릿으로 저장할 수 없습니다')
    createDoc(active.content, { folder: TEMPLATE_FOLDER })
    setSettings((s) => ({
      ...s,
      sidebarOpen: true,
      sidebarTab: 'files',
      folders: s.folders.includes(TEMPLATE_FOLDER) ? s.folders : [...s.folders, TEMPLATE_FOLDER],
      collapsedFolders: s.collapsedFolders.filter((f) => f !== TEMPLATE_FOLDER),
    }))
    setToast(`"${TEMPLATE_FOLDER}" 폴더에 템플릿으로 저장했습니다`)
  }, [active.content, createDoc])

  // ---------- 폴더 ----------
  const folderName = (raw: string | null) => cleanFolder((raw ?? '').replace(/\//g, ' '))

  const toggleFolder = useCallback((path: string) => {
    setSettings((s) => ({ ...s, collapsedFolders: s.collapsedFolders.includes(path) ? s.collapsedFolders.filter((f) => f !== path) : [...s.collapsedFolders, path] }))
  }, [])

  const newFolder = useCallback(
    async (parent?: string) => {
      const name = folderName(await ask(parent ? `"${parent.split('/').pop()}" 안에 새 폴더` : '새 폴더', '', '폴더 이름'))
      if (!name) return
      const path = parent ? `${parent}/${name}` : name
      setSettings((s) => ({
        ...s,
        sidebarOpen: true,
        sidebarTab: 'files',
        folders: s.folders.includes(path) ? s.folders : [...s.folders, path],
        collapsedFolders: s.collapsedFolders.filter((f) => f !== parent),
      }))
    },
    [ask],
  )

  /** 폴더 경로 접두사 바꾸기 (from → to), 하위 폴더·문서 포함 */
  const remapFolder = useCallback(
    (from: string, to: string) => {
      const map = (f: string) => (f === from ? to : f.startsWith(`${from}/`) ? `${to ? `${to}/` : ''}${f.slice(from.length + 1)}` : f)
      setSettings((s) => ({ ...s, folders: [...new Set(s.folders.map(map).filter(Boolean))], collapsedFolders: s.collapsedFolders.map(map) }))
      updateDocs((list) =>
        list.map((d) => {
          const f = d.folder ?? ''
          if (f !== from && !f.startsWith(`${from}/`)) return d
          return { ...d, folder: map(f), moved: true }
        }),
      )
    },
    [updateDocs],
  )

  const renameFolder = useCallback(
    async (path: string) => {
      const i = path.lastIndexOf('/')
      const name = folderName(await ask('폴더 이름 바꾸기', path.slice(i + 1), '새 이름'))
      if (!name) return
      remapFolder(path, i < 0 ? name : `${path.slice(0, i)}/${name}`)
    },
    [ask, remapFolder],
  )

  const deleteFolder = useCallback(
    (path: string) => {
      const i = path.lastIndexOf('/')
      const parent = i < 0 ? '' : path.slice(0, i)
      const n = docsRef.current.filter((d) => (d.folder ?? '') === path || (d.folder ?? '').startsWith(`${path}/`)).length
      if (n && !confirm(`"${path.split('/').pop()}" 폴더를 삭제할까요?
안에 있는 문서 ${n}개는 ${parent ? `"${parent.split('/').pop()}"` : '최상위'} 폴더로 옮겨집니다.`)) return
      remapFolder(path, parent)
    },
    [remapFolder],
  )

  const moveDoc = useCallback(
    (id: string, folder: string) => {
      updateDocs((list) => list.map((d) => (d.id === id && (d.folder ?? '') !== folder ? { ...d, folder, moved: true } : d)))
      if (folder) setSettings((s) => ({ ...s, collapsedFolders: s.collapsedFolders.filter((f) => f !== folder) }))
    },
    [updateDocs],
  )

  const deleteDoc = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (doc?.remotePath && doc.remoteSha && isSyncable(doc)) store.setTombstones([...tombstones.current, { path: doc.remotePath, sha: doc.remoteSha }])
      updateDocs((list) => list.filter((d) => d.id !== id))
      handles.current.delete(id)
      paths.current.delete(id)
      ensureActive()
    },
    [ensureActive, store, updateDocs],
  )

  // 데스크톱: 파일 더블클릭/열기 대화상자로 연 파일
  useEffect(() => {
    if (!desktop) return
    return desktop.onOpenFile((f) => {
      const existing = docsRef.current.find((d) => d.localPath === f.path)
      if (existing) {
        patchDoc(existing.id, { content: f.content, dirty: false })
        switchTo(existing.id)
      } else createDoc(f.content, { fileName: f.name, localPath: f.path })
      setToast(`"${f.name}" 열림`)
    })
  }, [createDoc, patchDoc, switchTo])

  const doOpen = useCallback(async () => {
    if (desktop) return desktop.openDialog()
    try {
      const file = await openFile()
      if (!file) return
      createDoc(file.content, { fileName: file.name, ...(file.handle ? { handle: file.handle } : {}) })
      setToast(`"${file.name}" 열림`)
    } catch (e) {
      setToast(`열기 실패: ${(e as Error).message}`)
    }
  }, [createDoc])

  const doOpenFolder = useCallback(async () => {
    try {
      const f = await openFolder()
      if (f) {
        setFolder(f)
        setSettings((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'files' }))
      }
    } catch (e) {
      setToast(`폴더 열기 실패: ${(e as Error).message}`)
    }
  }, [])

  const openTreeFile = useCallback(
    async (node: TreeNode) => {
      const existing = [...paths.current.entries()].find(([, p]) => p === node.path)
      if (existing && docsRef.current.some((d) => d.id === existing[0])) return switchTo(existing[0])
      const file = await (node.handle as FileSystemFileHandle).getFile()
      createDoc(await file.text(), { fileName: node.name, handle: node.handle as FileSystemFileHandle, path: node.path })
    },
    [createDoc, switchTo],
  )

  const doSave = useCallback(
    async (forceAs = false) => {
      const doc = active
      try {
        // 동기화 문서의 "저장" = 지금 동기화
        if (!forceAs && syncCfg.enabled && isSyncable(doc)) {
          // 내 컴퓨터 파일이면서 동기화에도 포함된 문서: 파일에도 저장
          if (desktop && doc.localPath) await desktop.writeFile(doc.localPath, doc.content)
          else if (handles.current.get(doc.id)) await writeHandle(handles.current.get(doc.id)!, doc.content)
          if (doc.fileName) patchDoc(doc.id, { dirty: false })
          await saveDocs(docsRef.current)
          return runSyncNow(true)
        }
        if (!forceAs && desktop && doc.localPath) {
          await desktop.writeFile(doc.localPath, doc.content)
          patchDoc(doc.id, { dirty: false })
          return setToast(`"${doc.fileName}" 저장됨`)
        }
        const handle = handles.current.get(doc.id)
        if (handle && !forceAs) {
          await writeHandle(handle, doc.content)
          patchDoc(doc.id, { dirty: false })
          return setToast(`"${handle.name}" 저장됨`)
        }
        // 동기화 중인 문서는 연결을 끊지 않고 사본만 내보냄
        const linkable = !doc.remotePath
        const name = doc.fileName ?? safeFileName(doc.title)
        if (desktop) {
          const res = await desktop.saveAs(name, doc.content)
          if (!res) return
          if (linkable) patchDoc(doc.id, { fileName: res.name, localPath: res.path, dirty: false })
          return setToast(`"${res.name}" 저장됨`)
        }
        const res = await saveFileAs(name, doc.content)
        if (!res) return
        if (linkable) {
          if (res.handle) handles.current.set(doc.id, res.handle)
          patchDoc(doc.id, { fileName: res.name, dirty: false })
        }
        setToast(res.handle ? `"${res.name}" 저장됨` : `"${res.name}" 다운로드됨`)
      } catch (e) {
        setToast(`저장 실패: ${(e as Error).message}`)
      }
    },
    [active, patchDoc, runSyncNow, syncCfg.enabled],
  )

  const exportHtml = useCallback(() => {
    const name = safeFileName(active.title).replace(/\.md$/, '.html')
    const html = buildHtmlDocument(active.title, activeBody, settings.headingColors)
    if (desktop) desktop.exportFile(name, html, 'html')
    else download(name, html, 'text/html;charset=utf-8')
  }, [active, activeBody, settings.headingColors])

  /** PDF: 편집 화면을 A4 폭(180mm)으로 다시 배치하고 필기 위치를 재계산한 뒤 그대로 인쇄 → 손글씨·글상자 포함 */
  const runPdf = useCallback(async (strokes: boolean) => {
    setPdfAsk(false)
    setPrintStrokes(strokes)
    const name = safeFileName(active.title).replace(/\.md$/, '.pdf')
    if (desktop && !(await desktop.choosePdfPath(name))) return
    const switched = mode !== 'wysiwyg'
    setInkMode(false)
    if (switched) {
      setMode('wysiwyg')
      setNonce((n) => n + 1)
    }
    // 화면의 본문 폭을 그대로 두고 A4 인쇄 폭(180mm ≈ 680px)에 맞게 비율만 줄임 → 줄바꿈이 화면과 같아 필기 위치가 정확함
    const A4_PX = 680.3
    const pmWidth = pageRef.current?.querySelector('.ProseMirror')?.getBoundingClientRect().width || A4_PX
    const zoom = Math.min(1.25, Math.max(0.6, A4_PX / pmWidth))
    document.documentElement.style.setProperty('--print-width', `${A4_PX / zoom}px`)
    document.documentElement.style.setProperty('--print-zoom', String(zoom))
    setPrinting(true)
    const title = document.title
    document.title = active.title
    try {
      await new Promise((r) => setTimeout(r, switched ? 900 : 350))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      if (desktop) {
        await desktop.printToPdf()
        setToast('PDF로 저장했습니다')
      } else window.print() // 인쇄 창에서 "PDF로 저장" 선택
    } catch (e) {
      setToast(`PDF 저장 실패: ${(e as Error).message}`)
    } finally {
      document.title = title
      setPrinting(false)
    }
  }, [active.title, mode])

  // 손글씨가 있으면 포함 여부를 먼저 묻는다 (글상자는 항상 포함)
  const exportPdf = useCallback(() => {
    if (activeInk?.strokes.length) setPdfAsk(true)
    else runPdf(true)
  }, [activeInk, runPdf])


  // ---------- 다른 형식으로 저장 ----------
  const saveFile = useCallback(async (name: string, data: string | Uint8Array, ext: string, mime: string) => {
    if (desktop) {
      if (await desktop.exportFile(name, data, ext)) setToast(`"${name}" 저장했습니다`)
    } else {
      download(name, typeof data === 'string' ? new Blob([data], { type: mime }) : new Blob([data as BlobPart], { type: mime }))
      setToast(`"${name}" 내려받았습니다`)
    }
  }, [])

  const exportAs = useCallback(
    async (f: ExportFormat) => {
      setExportOpen(false)
      const stem = safeFileName(active.title).replace(/\.md$/, '')
      try {
        switch (f) {
          case 'md':
            return doSave(true)
          case 'obsidian':
            return setObsidianOpen(true)
          case 'obsidian-md':
            return saveFile(`${stem}.md`, toObsidian(active.content), 'md', 'text/markdown;charset=utf-8')
          case 'docx':
            setToast('Word 문서를 만드는 중…')
            return saveFile(`${stem}.docx`, await toDocx(active.title, active.content, settings.headingColors), 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          case 'pdf':
            return exportPdf()
          case 'html':
            return exportHtml()
          case 'txt':
            return saveFile(`${stem}.txt`, toPlainText(active.content), 'txt', 'text/plain;charset=utf-8')
          case 'zip': {
            const day = new Date().toISOString().slice(0, 10)
            // 백업은 필기 데이터까지 그대로 (나중에 다시 불러올 수 있게)
            return saveFile(`Inkdown-백업-${day}.zip`, makeZip(docsToFiles(docsRef.current, (d) => d.content)), 'zip', 'application/zip')
          }
        }
      } catch (e) {
        setToast(`저장 실패: ${(e as Error).message}`)
      }
    },
    [active.content, active.title, doSave, exportHtml, exportPdf, saveFile, settings.headingColors],
  )

  const isTemplateDoc = (d: Doc) => !!d.folder && (d.folder === TEMPLATE_FOLDER || d.folder.startsWith(`${TEMPLATE_FOLDER}/`))

  const obsidianOpenCurrent = useCallback(async () => {
    try {
      const r = await openInObsidian(active, settings.obsidianVault, settings.obsidianSub)
      setToast(r.viaClipboard ? 'Obsidian을 여는 중… (문서가 길어 클립보드를 거쳐 보냈습니다)' : 'Obsidian을 여는 중…')
    } catch (e) {
      setToast(`Obsidian으로 보내지 못했습니다: ${(e as Error).message}`)
    }
  }, [active, settings.obsidianSub, settings.obsidianVault])

  const obsidianExportAll = useCallback(async () => {
    try {
      const r = await exportAllToVault(docsRef.current.filter((d) => !isTemplateDoc(d)), settings.obsidianSub, settings.obsidianDir || undefined)
      if (r.folder && r.folder !== settings.obsidianDir) setSettings((s) => ({ ...s, obsidianDir: r.folder! }))
      if (r.count) setToast(r.zip ? `${r.count}개 문서를 ZIP으로 내려받았습니다. 보관함 폴더에 압축을 풀어 주세요` : `${r.count}개 문서를 Obsidian 보관함에 저장했습니다`)
    } catch (e) {
      setToast(`내보내기 실패: ${(e as Error).message}`)
    }
  }, [settings.obsidianDir, settings.obsidianSub])

  // ---------- 서식 ----------
  const fmt = useCallback(
    (cmd: FormatCommand) => {
      if (mode !== 'wysiwyg') {
        setToast('서식 명령은 실시간 미리보기 모드에서 사용할 수 있습니다')
        return
      }
      editorRef.current?.run(cmd)
    },
    [mode],
  )

  const insertLink = useCallback(async () => {
    const href = await ask('링크 삽입', 'https://', '링크 주소(URL)')
    if (href) fmt({ type: 'link', href })
  }, [ask, fmt])

  const insertImage = useCallback(
    async (fromFile: boolean) => {
      if (!fromFile) {
        const src = await ask('이미지 삽입', 'https://', '이미지 주소(URL)')
        if (src) fmt({ type: 'image', src })
        return
      }
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (file) fmt({ type: 'image', src: await compressImage(file), alt: file.name })
      }
      input.click()
    },
    [ask, fmt],
  )

  const toggleInk = useCallback(() => {
    if (mode !== 'wysiwyg') {
      setToast('필기는 실시간 미리보기 모드에서 사용할 수 있습니다')
      return
    }
    setInkMode((v) => !v)
  }, [mode])

  const toggleMode = useCallback(() => {
    setInkMode(false)
    setMode((m) => (m === 'wysiwyg' ? 'source' : 'wysiwyg'))
    setNonce((n) => n + 1)
  }, [])

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value })), [])

  const zoom = useCallback((delta: number) => setSettings((s) => ({ ...s, fontSize: delta === 0 ? 16 : Math.min(28, Math.max(12, s.fontSize + delta)) })), [])

  const goHeading = useCallback(
    (h: Heading) => {
      if (mode === 'wysiwyg') editorRef.current?.scrollToHeading(h.index)
      else sourceRef.current?.scrollToLine(h.line)
    },
    [mode],
  )

  // ---------- 단축키 ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (promptReq || syncOpen || fontOpen || pdfAsk || templateOpen || lockOpen || exportOpen || obsidianOpen || aboutOpen) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      const k = e.code
      const inText = (e.target as HTMLElement | null)?.tagName === 'TEXTAREA'
      let handled = true
      if (inkMode && !inText && e.key === 'Escape') setInkMode(false)
      else if (inkMode && !inText && mod && k === 'KeyZ' && !e.shiftKey) inkRef.current?.undo()
      else if (mod && e.shiftKey && k === 'KeyD') toggleInk()
      else if (mod && e.altKey && k === 'KeyL') lockNow()
      else if (mod && e.shiftKey && k === 'KeyH' && mode === 'wysiwyg') fmt({ type: 'highlight', color: 'yellow' })
      else if (mod && !e.shiftKey && k === 'KeyU' && mode === 'wysiwyg') fmt({ type: 'underline' })
      else if (e.key === 'F8') set('focusMode', !settings.focusMode)
      else if (e.key === 'F9') set('typewriterMode', !settings.typewriterMode)
      else if (e.altKey && e.shiftKey && k === 'Digit5') fmt({ type: 'strike' })
      else if (!mod) handled = false
      else if (k === 'KeyS' && e.shiftKey) setExportOpen(true)
      else if (k === 'KeyS') doSave()
      else if (k === 'KeyQ' && desktop && !isMac) desktop.quit()
      else if (k === 'KeyP' && !e.shiftKey) exportPdf()
      else if (k === 'KeyO') doOpen()
      else if (k === 'KeyN' && (e.altKey || !e.shiftKey)) createDoc('', active.folder && !isTemplateFolder(active.folder) ? { folder: active.folder } : {})
      else if (k === 'Slash') toggleMode()
      else if (e.shiftKey && k === 'KeyL') set('sidebarOpen', !settings.sidebarOpen)
      else if (e.shiftKey && k === 'Digit1') setSettings((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'outline' }))
      else if (e.shiftKey && (k === 'Digit2' || k === 'Digit3')) setSettings((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'files' }))
      else if (k === 'Equal' && !e.shiftKey) zoom(1)
      else if (k === 'Minus' && !e.shiftKey) zoom(-1)
      else if (e.shiftKey && k === 'Digit0') zoom(0)
      else if (mode !== 'wysiwyg') handled = false
      else if (!e.shiftKey && /^Digit[1-6]$/.test(k)) fmt({ type: 'heading', level: Number(k.slice(5)) })
      else if (!e.shiftKey && k === 'Digit0') fmt({ type: 'paragraph' })
      else if (e.shiftKey && k === 'KeyK') fmt({ type: 'codeblock' })
      else if (e.shiftKey && k === 'KeyQ') fmt({ type: 'quote' })
      else if (e.shiftKey && k === 'BracketLeft') fmt({ type: 'ol' })
      else if (e.shiftKey && k === 'BracketRight') fmt({ type: 'ul' })
      else if (e.shiftKey && k === 'Backquote') fmt({ type: 'code' })
      else if (e.altKey && k === 'KeyT') fmt({ type: 'table' })
      else if (!e.shiftKey && k === 'KeyK') insertLink()
      else if (e.shiftKey && k === 'KeyI') insertImage(true)
      else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active.folder, createDoc, doOpen, doSave, exportPdf, aboutOpen, exportOpen, fmt, fontOpen, lockNow, lockOpen, obsidianOpen, pdfAsk, templateOpen, inkMode, insertImage, insertLink, mode, promptReq, set, settings.focusMode, settings.sidebarOpen, settings.typewriterMode, syncOpen, toggleInk, toggleMode, zoom])

  // ---------- .md 파일 끌어다 놓기 ----------
  useEffect(() => {
    const isMd = (f: File) => /\.(md|markdown|mdown|txt)$/i.test(f.name)
    const over = (e: DragEvent) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file' && !i.type.startsWith('image/'))) e.preventDefault()
    }
    const drop = async (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])].filter(isMd)
      if (!files.length) return
      e.preventDefault()
      e.stopPropagation()
      for (const f of files) createDoc(await f.text(), { fileName: f.name })
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop, true)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop, true)
    }
  }, [createDoc])

  // ---------- 메뉴 ----------
  const syncItems: MenuItem[] = syncCfg.enabled
    ? [
        { label: '지금 동기화', action: () => runSyncNow(true) },
        ...(active.fileName || active.localPath
          ? []
          : [{ label: '이 문서는 이 기기에만 보관', checked: !!active.localOnly, action: () => patchDoc(active.id, active.localOnly ? { localOnly: false } : { localOnly: true }) }]),
        { label: '동기화 설정…', action: () => setSyncOpen(true) },
      ]
    : [{ label: '기기 간 동기화 설정…', action: () => setSyncOpen(true) }]

  const menus: Menu[] = [
    {
      label: '파일',
      items: [
        { label: '새 문서', shortcut: sc('Mod+N'), action: () => createDoc() },
        { label: '템플릿으로 새 문서…', action: () => setTemplateOpen(true) },
        { label: '지금 문서를 템플릿으로 저장', action: saveAsTemplate },
        { label: '열기…', shortcut: sc('Mod+O'), action: doOpen },
        ...(supportsFolder ? [{ label: '폴더 열기…', action: doOpenFolder }] : []),
        { divider: true },
        { label: syncCfg.enabled && isSyncable(active) ? '저장 (동기화)' : '저장', shortcut: sc('Mod+S'), action: () => doSave() },
        { label: '다른 형식으로 저장…', shortcut: sc('Mod+Shift+S'), action: () => setExportOpen(true) },
        { label: 'Obsidian으로 보내기…', action: () => setObsidianOpen(true) },
        { divider: true },
        ...syncItems,
        { divider: true },
        ...(lockOn ? [{ label: '지금 잠그기', shortcut: sc('Mod+Alt+L'), action: lockNow }] : []),
        { label: lockOn ? '잠금(PIN) 설정…' : '잠금(PIN) 켜기…', action: () => setLockOpen(true) },
        { divider: true },
        { label: 'PDF로 내보내기…', shortcut: sc('Mod+P'), action: exportPdf },
        ...(desktop ? [{ divider: true } as const, { label: '끝내기', shortcut: isMac ? '⌘Q' : 'Ctrl+Q', action: () => desktop!.quit() }] : []),
      ],
    },
    {
      label: '문단',
      items: [
        ...[1, 2, 3, 4, 5, 6].map((level) => ({ label: `제목 ${level}`, shortcut: sc(`Mod+${level}`), action: () => fmt({ type: 'heading', level }) })),
        { label: '본문', shortcut: sc('Mod+0'), action: () => fmt({ type: 'paragraph' }) },
        { divider: true },
        { label: '표 삽입', shortcut: sc('Mod+Alt+T'), action: () => fmt({ type: 'table' }) },
        { label: '코드 블록', shortcut: sc('Mod+Shift+K'), action: () => fmt({ type: 'codeblock' }) },
        { label: '인용', shortcut: sc('Mod+Shift+Q'), action: () => fmt({ type: 'quote' }) },
        { divider: true },
        { label: '번호 목록', shortcut: sc('Mod+Shift+['), action: () => fmt({ type: 'ol' }) },
        { label: '글머리 기호 목록', shortcut: sc('Mod+Shift+]'), action: () => fmt({ type: 'ul' }) },
        { label: '구분선', action: () => fmt({ type: 'hr' }) },
      ],
    },
    {
      label: '서식',
      items: [
        { label: '굵게', shortcut: sc('Mod+B'), action: () => fmt({ type: 'bold' }) },
        { label: '기울임', shortcut: sc('Mod+I'), action: () => fmt({ type: 'italic' }) },
        { label: '취소선', shortcut: sc('Alt+Shift+5'), action: () => fmt({ type: 'strike' }) },
        { label: '인라인 코드', shortcut: sc('Mod+Shift+`'), action: () => fmt({ type: 'code' }) },
        { divider: true },
        { label: '형광펜 (노랑)', shortcut: sc('Mod+Shift+H'), action: () => fmt({ type: 'highlight', color: 'yellow' }) },
        { label: '형광펜 (초록)', action: () => fmt({ type: 'highlight', color: 'green' }) },
        { label: '형광펜 (분홍)', action: () => fmt({ type: 'highlight', color: 'pink' }) },
        { label: '형광펜 (파랑)', action: () => fmt({ type: 'highlight', color: 'blue' }) },
        { label: '형광펜 (주황)', action: () => fmt({ type: 'highlight', color: 'orange' }) },
        { label: '밑줄', shortcut: sc('Mod+U'), action: () => fmt({ type: 'underline' }) },
        { label: '형광펜·밑줄 지우기', action: () => fmt({ type: 'clearmark' }) },
        { divider: true },
        { label: '링크…', shortcut: sc('Mod+K'), action: insertLink },
        { label: '이미지 (파일)…', shortcut: sc('Mod+Shift+I'), action: () => insertImage(true) },
        { label: '이미지 (URL)…', action: () => insertImage(false) },
      ],
    },
    {
      label: '보기',
      items: [
        { label: '원문(소스 코드) 모드', shortcut: sc('Mod+/'), checked: mode === 'source', action: toggleMode },
        { label: '필기 모드 (펜·형광펜·줄긋기·글상자)', shortcut: sc('Mod+Shift+D'), checked: inkMode, action: toggleInk },
        { divider: true },
        { label: '사이드바', shortcut: sc('Mod+Shift+L'), checked: settings.sidebarOpen, action: () => set('sidebarOpen', !settings.sidebarOpen) },
        { label: '개요', shortcut: sc('Mod+Shift+1'), checked: settings.sidebarOpen && settings.sidebarTab === 'outline', action: () => setSettings((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'outline' })) },
        { label: '파일 목록', shortcut: sc('Mod+Shift+3'), checked: settings.sidebarOpen && settings.sidebarTab === 'files', action: () => setSettings((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'files' })) },
        { divider: true },
        { label: '집중 모드', shortcut: 'F8', checked: settings.focusMode, action: () => set('focusMode', !settings.focusMode) },
        { label: '타자기 모드', shortcut: 'F9', checked: settings.typewriterMode, action: () => set('typewriterMode', !settings.typewriterMode) },
        { divider: true },
        { label: '글꼴 및 문단…', action: () => setFontOpen(true) },
        { label: '글자 크게', shortcut: sc('Mod+='), action: () => zoom(1) },
        { label: '글자 작게', shortcut: sc('Mod+-'), action: () => zoom(-1) },
        { label: '글자 크기 초기화', shortcut: sc('Mod+Shift+0'), action: () => zoom(0) },
        { divider: true },
        ...[700, 860, 1100].map((w) => ({ label: `본문 폭 ${w === 700 ? '좁게' : w === 860 ? '보통' : '넓게'}`, checked: settings.contentWidth === w, action: () => set('contentWidth', w) })),
      ],
    },
    {
      label: '테마',
      items: [
        ...THEMES.map((t) => ({ label: t.label, checked: settings.theme === t.id, action: () => set('theme', t.id) })),
        { divider: true },
        { label: '글꼴 및 문단…', action: () => setFontOpen(true) },
      ],
    },
    {
      label: '도움말',
      items: [{ label: `Inkdown 정보 · 버전 기록 (v${__APP_VERSION__})`, action: () => setAboutOpen(true) }],
    },
  ]

  const getScroller = useCallback(() => scrollRef.current, [])
  const getPage = useCallback(() => pageRef.current, [])
  const editorKey = `${active.id}-${mode}-${theme.dark ? 'd' : 'l'}-${nonce}`

  const syncLabel =
    sync.phase === 'off'
      ? '동기화 꺼짐'
      : sync.phase === 'syncing'
        ? '동기화 중…'
        : sync.phase === 'error'
          ? '동기화 오류'
          : sync.phase === 'offline'
            ? '오프라인'
            : `동기화됨 · ${relTime(sync.last)}`

  return (
    <div className={`app ${printing ? 'printing' : ''} ${printing && !printStrokes ? 'print-no-strokes' : ''} ${settings.sidebarOpen ? 'with-sidebar' : ''} ${isDesktop ? `desktop platform-${desktop!.platform}` : 'web'}`}>
      <MenuBar menus={menus} title={`${active.dirty ? '• ' : ''}${active.fileName ?? active.title}`} />
      <div className="workspace">
        {settings.sidebarOpen && (
          <Sidebar
            tab={settings.sidebarTab}
            onTab={(t) => set('sidebarTab', t)}
            docs={docs}
            activeId={active.id}
            onSelect={switchTo}
            onNew={(f) => createDoc('', f ? { folder: f } : {})}
            onDelete={deleteDoc}
            folders={settings.folders}
            collapsed={settings.collapsedFolders}
            onToggleFolder={toggleFolder}
            onNewFolder={newFolder}
            onRenameFolder={renameFolder}
            onDeleteFolder={deleteFolder}
            onMoveDoc={moveDoc}
            onToggleSync={setDocSync}
            onCollapseSidebar={() => set('sidebarOpen', false)}
            onTemplate={() => setTemplateOpen(true)}
            headings={headings}
            onHeading={goHeading}
            folder={folder}
            activePath={paths.current.get(active.id)}
            onOpenTreeFile={openTreeFile}
            syncEnabled={syncCfg.enabled}
            {...(supportsFolder ? { onOpenFolder: doOpenFolder } : {})}
          />
        )}
        {!settings.sidebarOpen && (
          <button className="sidebar-reveal" title={`메뉴판 보이기 (${sc('Mod+Shift+L')})`} onClick={() => set('sidebarOpen', true)}>
            »
          </button>
        )}
        <main className={`editor-scroll ${settings.typewriterMode ? 'typewriter' : ''} ${inkMode ? 'inking' : ''}`} ref={scrollRef}>
          {inkMode && (
            <InkToolbar
              state={inkTool}
              onChange={setInkTool}
              onUndo={() => inkRef.current?.undo()}
              onClear={() => confirm('이 문서의 필기와 글상자를 모두 지울까요?') && inkRef.current?.clear()}
              onClose={() => setInkMode(false)}
            />
          )}
          <div className="page" ref={pageRef}>
            {mode === 'wysiwyg' ? (
              <WysiwygEditor
                key={editorKey}
                ref={editorRef}
                initialValue={activeBody}
                onChange={handleChange}
                focusMode={settings.focusMode}
                typewriterMode={settings.typewriterMode}
                scrollContainer={getScroller}
                dark={theme.dark}
              />
            ) : (
              <SourceEditor key={editorKey} ref={sourceRef} initialValue={activeBody} onChange={handleChange} dark={theme.dark} />
            )}
            {mode === 'wysiwyg' && (activeInk || inkMode) && (
              <InkLayer key={`ink-${active.id}`} ref={inkRef} page={getPage} ink={activeInk ?? EMPTY_INK} onChange={handleInkChange} active={inkMode} tool={inkTool} />
            )}
          </div>
        </main>
      </div>
      <footer className="statusbar">
        <div className="left">
          <button className="status-btn version" title="버전 정보 · 바뀐 내용" onClick={() => setAboutOpen(true)}>
            v{__APP_VERSION__}
          </button>
          <button className="status-btn" title={`사이드바 (${sc('Mod+Shift+L')})`} onClick={() => set('sidebarOpen', !settings.sidebarOpen)}>☰</button>
          <button className={`status-btn ${mode === 'source' ? 'on' : ''}`} title={`원문 모드 (${sc('Mod+/')})`} onClick={toggleMode}>{'</>'}</button>
          <button className={`status-btn ${inkMode ? 'on' : ''}`} title={`필기 모드 (${sc('Mod+Shift+D')})`} onClick={toggleInk}>✎</button>
          {settings.focusMode && <span className="badge">집중</span>}
          {settings.typewriterMode && <span className="badge">타자기</span>}
        </div>
        <div className="right">
          {lockOn && (
            <button className="status-btn" title={`지금 잠그기 (${sc('Mod+Alt+L')})`} onClick={lockNow}>
              🔒
            </button>
          )}
          <button
            className={`status-btn sync sync-${sync.phase}`}
            title={sync.message || (syncCfg.enabled ? `${syncCfg.owner}/${syncCfg.repo} — 클릭하면 지금 동기화` : '클릭해서 기기 간 동기화 설정')}
            onClick={() => setSyncOpen(true)}
          >
            <span className="dot" /> {syncLabel}
          </button>
          <button className="status-btn words" onClick={() => setShowStats((v) => !v)}>
            {showStats
              ? `${stats.chars.toLocaleString()}자(공백 포함) · ${stats.charsNoSpace.toLocaleString()}자(공백 제외) · ${stats.words.toLocaleString()}단어 · ${stats.lines.toLocaleString()}줄 · 약 ${stats.minutes}분`
              : `${stats.charsNoSpace.toLocaleString()}자`}
          </button>
        </div>
      </footer>
      {toast && <div className="toast">{toast}</div>}
      {promptReq && <PromptDialog req={promptReq} onDone={() => setPromptReq(null)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {exportOpen && <ExportDialog onPick={exportAs} onClose={() => setExportOpen(false)} />}
      {obsidianOpen && (
        <ObsidianDialog
          vault={settings.obsidianVault}
          sub={settings.obsidianSub}
          dir={settings.obsidianDir}
          docCount={docs.filter((d) => !isTemplateDoc(d)).length}
          onChange={(v) => setSettings((s) => ({ ...s, ...v }))}
          onOpenCurrent={obsidianOpenCurrent}
          onExportAll={obsidianExportAll}
          onClose={() => setObsidianOpen(false)}
        />
      )}
      {lockOpen && <LockDialog onResave={resaveSecure} onClose={() => setLockOpen(false)} onToast={setToast} />}
      {templateOpen && <TemplateDialog docs={docs} onPick={newFromTemplate} onSaveCurrent={saveAsTemplate} onClose={() => setTemplateOpen(false)} />}
      {pdfAsk && (
        <Modal title="PDF로 내보내기" onClose={() => setPdfAsk(false)} width={400}>
          <p className="hint" style={{ marginTop: 0 }}>글상자는 항상 포함됩니다. 손글씨를 넣을지 골라 주세요.</p>
          <label className="check-row">
            <input type="checkbox" checked={settings.pdfStrokes} onChange={(e) => set('pdfStrokes', e.target.checked)} />
            손글씨 포함 (펜 · 형광펜 · 줄긋기 {activeInk?.strokes.length ?? 0}개)
          </label>
          <div className="modal-actions">
            <button className="btn" onClick={() => setPdfAsk(false)}>취소</button>
            <button className="btn primary" autoFocus onClick={() => runPdf(settings.pdfStrokes)}>
              PDF 만들기
            </button>
          </div>
        </Modal>
      )}
      {fontOpen && (
        <FontDialog
          value={{ bodyFont: settings.bodyFont, headingFont: settings.headingFont, codeFont: settings.codeFont, fontSize: settings.fontSize, lineHeight: settings.lineHeight, headingColors: settings.headingColors }}
          onChange={(v) => setSettings((s) => ({ ...s, ...v }))}
          onClose={() => setFontOpen(false)}
        />
      )}
      {syncOpen && (
        <SyncDialog
          config={syncCfg}
          onSave={saveSync}
          onClose={() => setSyncOpen(false)}
          syncStatus={{
            ...sync,
            localTotal: docs.filter(isSyncable).filter((d) => d.content.trim()).length,
            pending: docs.filter((d) => isSyncable(d) && d.content.trim() && (!d.remotePath || d.moved || hashText(d.content) !== d.syncedHash)).length,
          }}
          onSyncNow={() => runSyncNow(true)}
          unsyncedCount={unsyncedDocs.length}
          notSynced={notSyncedList}
          onToggleSync={setDocSync}
          onIncludeAll={includeAllInSync}
        />
      )}
    </div>
  )
}
