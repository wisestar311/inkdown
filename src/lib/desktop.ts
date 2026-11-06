/* Electron preload가 노출한 API (웹 브라우저에서는 undefined) */
export interface OpenedDesktopFile {
  path: string
  name: string
  content: string
}

export interface DesktopAPI {
  platform: string
  openDialog(): Promise<void>
  /** 앱 완전히 끝내기 */
  quit(): Promise<void>
  /** 가져올 폴더 고르기: 하위 폴더까지 .md·그림 파일 (경로는 고른 폴더 이름부터) */
  pickImportFolder(): Promise<{ files: { rel: string; data: Uint8Array }[]; cloudOnly: number; root: string } | null>
  /** 연결된 파일에 쓰기. interactive=true면 처음 쓰는 파일은 저장할지 물어봄 */
  writeFile(path: string, content: string, interactive?: boolean): Promise<{ ok: boolean; reason?: string; message?: string }>
  saveAs(name: string, content: string): Promise<{ path: string; name: string } | null>
  exportFile(name: string, content: string | Uint8Array, ext: string): Promise<boolean>
  /** Obsidian 보관함 폴더 고르기 (고른 폴더만 쓰기 허용) */
  chooseExportFolder(): Promise<string | null>
  /** 고른 폴더 안에 .md 파일들 쓰기 (하위 폴더 자동 생성) */
  writeExportFiles(root: string, files: { path: string; data: string }[]): Promise<number>
  /** obsidian:// 또는 웹 주소 열기 */
  openExternal(url: string): Promise<unknown>
  /** 저장할 PDF 경로 선택 (취소하면 null) */
  choosePdfPath(name: string): Promise<string | null>
  /** 현재 창을 A4 PDF로 인쇄해 선택한 경로에 저장 */
  printToPdf(): Promise<boolean>
  onOpenFile(cb: (f: OpenedDesktopFile) => void): () => void
  onBeforeClose(cb: () => Promise<void>): () => void
}

export const desktop: DesktopAPI | undefined = (window as unknown as { inkdownDesktop?: DesktopAPI }).inkdownDesktop
export const isDesktop = !!desktop
