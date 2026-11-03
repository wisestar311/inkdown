/* Electron preload가 노출한 API (웹 브라우저에서는 undefined) */
export interface OpenedDesktopFile {
  path: string
  name: string
  content: string
}

export interface DesktopAPI {
  platform: string
  openDialog(): Promise<void>
  writeFile(path: string, content: string): Promise<boolean>
  saveAs(name: string, content: string): Promise<{ path: string; name: string } | null>
  exportFile(name: string, content: string, ext: string): Promise<boolean>
  /** 저장할 PDF 경로 선택 (취소하면 null) */
  choosePdfPath(name: string): Promise<string | null>
  /** 현재 창을 A4 PDF로 인쇄해 선택한 경로에 저장 */
  printToPdf(): Promise<boolean>
  onOpenFile(cb: (f: OpenedDesktopFile) => void): () => void
  onBeforeClose(cb: () => Promise<void>): () => void
}

export const desktop: DesktopAPI | undefined = (window as unknown as { inkdownDesktop?: DesktopAPI }).inkdownDesktop
export const isDesktop = !!desktop
