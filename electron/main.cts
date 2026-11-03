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
const allowedPaths = new Set<string>()
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
  win.on('close', (e) => {
    if (!win) return
    try {
      writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds()))
    } catch {
      /* 무시 */
    }
    if ((win as unknown as { __ready?: boolean }).__ready) return
    e.preventDefault()
    const w = win
    const done = () => {
      ;(w as unknown as { __ready?: boolean }).__ready = true
      w.close()
    }
    const timer = setTimeout(done, 4000)
    ipcMain.once('app:close-ready', () => {
      clearTimeout(timer)
      done()
    })
    w.webContents.send('app:before-close')
  })
  win.on('closed', () => {
    win = null
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
  allowedPaths.add(path.resolve(filePath))
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

ipcMain.handle('file:write', async (_e, filePath: string, content: string) => {
  const resolved = path.resolve(filePath)
  if (!allowedPaths.has(resolved)) throw new Error('허용되지 않은 경로입니다')
  await fs.writeFile(resolved, content, 'utf8')
  return true
})

ipcMain.handle('file:save-as', async (_e, suggestedName: string, content: string) => {
  if (!win) return null
  const r = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName,
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  })
  if (r.canceled || !r.filePath) return null
  await fs.writeFile(r.filePath, content, 'utf8')
  allowedPaths.add(path.resolve(r.filePath))
  return { path: r.filePath, name: path.basename(r.filePath) }
})

ipcMain.handle('file:export', async (_e, suggestedName: string, content: string, ext: string) => {
  if (!win) return false
  const r = await dialog.showSaveDialog(win, { defaultPath: suggestedName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
  if (r.canceled || !r.filePath) return false
  await fs.writeFile(r.filePath, content, 'utf8')
  return true
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
  })
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
