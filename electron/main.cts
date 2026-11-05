/* Inkdown 데스크톱(Electron) 메인 프로세스 */
import { app, BrowserWindow, Menu, dialog, ipcMain, shell, type MenuItemConstructorOptions } from 'electron'
import { promises as fs, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const isMac = process.platform === 'darwin'
const devUrl = process.env.VITE_DEV_SERVER_URL
let win: BrowserWindow | null = null
let quitting = false
let pageReady = false

/** 사용자가 직접 연(더블클릭·드래그·열기) 파일만 다시 쓸 수 있도록 허용 목록 관리 */
/* 사용자가 직접 열거나 저장한 파일만 덮어쓸 수 있도록 허용 목록을 둔다.
   앱을 다시 켜도 유지되도록 파일에 저장 (예전에는 앱을 켜 둔 동안만 기억해, 재실행 뒤 ⌘S가 오류였음) */
const allowedFile = () => path.join(app.getPath('userData'), 'allowed-files.json')
let allowedCache: Set<string> | null = null
function allowedPaths(): Set<string> {
  if (!allowedCache) {
    try {
      allowedCache = new Set(JSON.parse(readFileSync(allowedFile(), 'utf8')) as string[])
    } catch {
      allowedCache = new Set()
    }
  }
  return allowedCache
}
function allowPath(p: string) {
  const set = allowedPaths()
  const r = path.resolve(p)
  if (set.has(r)) return
  set.add(r)
  try {
    writeFileSync(allowedFile(), JSON.stringify([...set].slice(-2000)))
  } catch {
    /* 무시 */
  }
}
const pendingOpen: string[] = []

// ---------- 창 위치/크기 기억 ----------
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json')
function loadBounds(): Electron.Rectangle | undefined {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'))
  } catch {
    return undefined
  }
}

function createWindow() {
  const bounds = loadBounds()
  win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 840,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: 'Inkdown',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  if (!isMac) win.setMenu(null)

  win.once('ready-to-show', () => win?.show())

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/.test(url)) shell.openExternal(url)
    }
  })

  // 닫기 전에 렌더러가 저장·동기화를 마칠 시간을 준다 (최대 4초)
  // 닫기: 렌더러가 저장·동기화를 마칠 시간(최대 3초)을 준 뒤 창을 강제로 없앤다(destroy).
  // close()가 아니라 destroy()라서 웹 페이지 쪽 beforeunload 등이 종료를 막을 수 없다.
  let closing = false
  win.on('close', (e) => {
    const w = win
    if (!w || w.isDestroyed()) return
    try {
      writeFileSync(stateFile(), JSON.stringify(w.getNormalBounds()))
    } catch {
      /* 무시 */
    }
    e.preventDefault()
    if (closing) return
    closing = true
    const finish = () => {
      clearTimeout(timer)
      ipcMain.removeListener('app:close-ready', finish)
      if (!w.isDestroyed()) w.destroy()
    }
    const timer = setTimeout(finish, 3000)
    ipcMain.on('app:close-ready', finish)
    w.webContents.send('app:before-close')
  })
  win.on('closed', () => {
    win = null
    // Windows·Linux: 창이 닫히면 앱도 끝냄. macOS는 Cmd+Q(종료)일 때만.
    if (!isMac || quitting) app.quit()
  })

  if (devUrl) win.loadURL(devUrl)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  win.webContents.on('did-finish-load', () => {
    pageReady = true
    for (const p of pendingOpen.splice(0)) sendOpenFile(p)
  })
  win.webContents.on('did-start-loading', () => {
    pageReady = false
  })
}

async function sendOpenFile(filePath: string) {
  if (!/\.(md|markdown|mdown|txt)$/i.test(filePath) || !existsSync(filePath)) return
  if (!win || !pageReady) {
    pendingOpen.push(filePath)
    return
  }
  const content = await fs.readFile(filePath, 'utf8')
  allowPath(filePath)
  win.webContents.send('app:open-file', { path: filePath, name: path.basename(filePath), content })
  if (win.isMinimized()) win.restore()
  win.focus()
}

// ---------- 네이티브 메뉴 (macOS는 복사/붙여넣기 단축키에 필요) ----------
function buildMenu() {
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: '파일',
      submenu: [
        { label: '열기…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openDialog() },
        { type: 'separator' },
        { role: 'close', label: '창 닫기' },
      ],
    },
    { role: 'editMenu', label: '편집' },
    {
      label: '보기',
      submenu: [{ role: 'togglefullscreen', label: '전체 화면' }, { type: 'separator' }, { role: 'reload', label: '새로 고침' }, { role: 'toggleDevTools', label: '개발자 도구' }],
    },
    { role: 'windowMenu', label: '윈도우' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function openDialog() {
  if (!win) return
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] }],
  })
  for (const p of r.filePaths) await sendOpenFile(p)
}

// ---------- IPC ----------
ipcMain.handle('file:open-dialog', () => openDialog())
ipcMain.handle('app:quit', () => app.quit())

/** 연결된 파일에 쓰기. interactive(⌘S)일 때 허용 목록에 없는 파일이면 한 번 물어본다. 자동 저장은 묻지 않고 건너뜀 */
ipcMain.handle('file:write', async (_e, filePath: string, content: string, interactive = false) => {
  const resolved = path.resolve(filePath)
  if (!/\.(md|markdown|mdown|txt)$/i.test(resolved)) return { ok: false, reason: 'type', message: '마크다운·텍스트 파일만 저장할 수 있습니다' }
  if (!allowedPaths().has(resolved)) {
    if (!interactive || !win) return { ok: false, reason: 'permission' }
    const r = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['저장', '취소'],
      defaultId: 0,
      cancelId: 1,
      message: `"${path.basename(resolved)}" 파일에 저장할까요?`,
      detail: `${resolved}\n\n이 파일에 처음 저장할 때 한 번만 확인합니다.`,
    })
    if (r.response !== 0) return { ok: false, reason: 'cancel' }
    allowPath(resolved)
  }
  try {
    await fs.mkdir(path.dirname(resolved), { recursive: true })
    await fs.writeFile(resolved, content, 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'io', message: (e as Error).message }
  }
})

ipcMain.handle('file:save-as', async (_e, suggestedName: string, content: string) => {
  if (!win) return null
  const r = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (r.canceled || !r.filePath) return null
  await fs.writeFile(r.filePath, content, 'utf8')
  allowPath(r.filePath)
  return { path: r.filePath, name: path.basename(r.filePath) }
})

const FORMAT_NAMES: Record<string, string> = { md: '마크다운', txt: '텍스트', html: '웹 페이지', docx: 'Word 문서', zip: 'ZIP 압축 파일', pdf: 'PDF' }

ipcMain.handle('file:export', async (_e, suggestedName: string, content: string | Uint8Array, ext: string) => {
  if (!win) return false
  const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters: [{ name: FORMAT_NAMES[ext] ?? ext.toUpperCase(), extensions: [ext] }] })
  if (r.canceled || !r.filePath) return false
  await fs.writeFile(r.filePath, typeof content === 'string' ? content : Buffer.from(content))
  return true
})

// ---------- Obsidian 보관함(vault) 폴더로 내보내기 ----------
// 사용자가 대화상자로 직접 고른 폴더만 쓸 수 있도록, 고른 폴더 목록을 기억해 둔다
const rootsFile = () => path.join(app.getPath('userData'), 'export-folders.json')
const loadRoots = (): string[] => {
  try {
    return JSON.parse(readFileSync(rootsFile(), 'utf8')) as string[]
  } catch {
    return []
  }
}

ipcMain.handle('obsidian:choose-folder', async () => {
  if (!win) return null
  const r = await dialog.showOpenDialog(win, { title: 'Obsidian 보관함(vault) 폴더 선택', properties: ['openDirectory', 'createDirectory'] })
  const dir = r.canceled ? null : r.filePaths[0] ?? null
  if (dir) writeFileSync(rootsFile(), JSON.stringify([...new Set([...loadRoots(), path.resolve(dir)])]))
  return dir
})

ipcMain.handle('obsidian:write', async (_e, root: string, files: { path: string; data: string }[]) => {
  const base = path.resolve(root)
  if (!loadRoots().includes(base)) throw new Error('폴더를 다시 선택해 주세요')
  if (!existsSync(base)) throw new Error('폴더를 찾을 수 없습니다. 다시 선택해 주세요')
  for (const f of files) {
    const target = path.resolve(base, f.path)
    if (!target.startsWith(base + path.sep) || !target.endsWith('.md')) throw new Error(`허용되지 않은 경로: ${f.path}`)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, f.data, 'utf8')
  }
  return files.length
})

ipcMain.handle('app:open-external', (_e, url: string) => {
  // Obsidian 앱 주소와 웹 주소만 허용
  if (/^(obsidian|https?):/.test(url)) return shell.openExternal(url)
  return false
})

// PDF: 화면의 편집 화면(손글씨·글상자 포함)을 그대로 A4로 인쇄해 저장
let pdfTarget: string | null = null
ipcMain.handle('file:choose-pdf', async (_e, suggestedName: string) => {
  if (!win) return null
  const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
  pdfTarget = r.canceled || !r.filePath ? null : r.filePath
  return pdfTarget
})

ipcMain.handle('file:print-pdf', async () => {
  if (!win || !pdfTarget) return false
  const target = pdfTarget
  pdfTarget = null
  const pdf = await win.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    pageSize: 'A4',
    margins: { top: 0.59, bottom: 0.59, left: 0.59, right: 0.59 }, // 15mm
  })
  await fs.writeFile(target, pdf)
  shell.showItemInFolder(target)
  return true
})

// ---------- 앱 수명주기 ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const file = argv.slice(1).find((a) => /\.(md|markdown|mdown|txt)$/i.test(a))
    if (file) sendOpenFile(file)
    else if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // macOS: Finder에서 .md 더블클릭
  app.on('open-file', (e, filePath) => {
    e.preventDefault()
    if (app.isReady() && win) sendOpenFile(filePath)
    else pendingOpen.push(filePath)
  })

  app.whenReady().then(() => {
    // Windows: 연결 프로그램으로 실행된 경우 인수에 파일 경로가 들어옴
    const file = process.argv.slice(1).find((a) => /\.(md|markdown|mdown|txt)$/i.test(a))
    if (file) pendingOpen.push(file)
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (!win) createWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
    // 안전장치: 무엇이 종료를 붙잡더라도 6초 뒤에는 프로세스를 확실히 끝낸다
    setTimeout(() => app.exit(0), 6000).unref()
  })
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
