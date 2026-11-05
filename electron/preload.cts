/* 렌더러(React)에 안전하게 노출하는 데스크톱 기능 */
import { contextBridge, ipcRenderer } from 'electron'

export interface OpenedDesktopFile {
  path: string
  name: string
  content: string
}

// 렌더러가 준비되기 전에 도착한 파일(더블클릭으로 실행한 경우)을 보관했다가 전달
const queued: OpenedDesktopFile[] = []
let openFileCb: ((f: OpenedDesktopFile) => void) | null = null
ipcRenderer.on('app:open-file', (_e, f: OpenedDesktopFile) => {
  if (openFileCb) openFileCb(f)
  else queued.push(f)
})

const api = {
  platform: process.platform,
  openDialog: (): Promise<void> => ipcRenderer.invoke('file:open-dialog'),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  writeFile: (path: string, content: string, interactive?: boolean): Promise<{ ok: boolean; reason?: string; message?: string }> => ipcRenderer.invoke('file:write', path, content, !!interactive),
  saveAs: (name: string, content: string): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('file:save-as', name, content),
  exportFile: (name: string, content: string | Uint8Array, ext: string): Promise<boolean> => ipcRenderer.invoke('file:export', name, content, ext),
  chooseExportFolder: (): Promise<string | null> => ipcRenderer.invoke('obsidian:choose-folder'),
  writeExportFiles: (root: string, files: { path: string; data: string }[]): Promise<number> => ipcRenderer.invoke('obsidian:write', root, files),
  openExternal: (url: string): Promise<unknown> => ipcRenderer.invoke('app:open-external', url),
  choosePdfPath: (name: string): Promise<string | null> => ipcRenderer.invoke('file:choose-pdf', name),
  printToPdf: (): Promise<boolean> => ipcRenderer.invoke('file:print-pdf'),
  onOpenFile(cb: (f: OpenedDesktopFile) => void) {
    openFileCb = cb
    for (const f of queued.splice(0)) cb(f)
    return () => {
      if (openFileCb === cb) openFileCb = null
    }
  },
  /** 창을 닫기 직전 호출. 콜백이 끝나면 창이 닫힘 */
  onBeforeClose(cb: () => Promise<void>) {
    const listener = async () => {
      try {
        await cb()
      } finally {
        ipcRenderer.send('app:close-ready')
      }
    }
    ipcRenderer.on('app:before-close', listener)
    return () => {
      ipcRenderer.removeListener('app:before-close', listener)
    }
  },
}

export type DesktopAPI = typeof api

contextBridge.exposeInMainWorld('inkdownDesktop', api)
