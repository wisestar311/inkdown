/* 로컬 파일 열기/저장. Chromium 계열은 File System Access API로 원본 파일에 직접 저장하고,
   지원하지 않는 브라우저는 업로드/다운로드 방식으로 대체한다. */

type PickerType = { description: string; accept: Record<string, string[]> }
interface FSWindow {
  showOpenFilePicker?: (o?: { types?: PickerType[]; multiple?: boolean }) => Promise<FileSystemFileHandle[]>
  showSaveFilePicker?: (o?: { suggestedName?: string; types?: PickerType[] }) => Promise<FileSystemFileHandle>
  showDirectoryPicker?: (o?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}
const w = window as unknown as FSWindow

const MD_TYPES: PickerType[] = [
  { description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.txt'] } },
]

export const supportsFS = typeof w.showOpenFilePicker === 'function'
export const supportsFolder = typeof w.showDirectoryPicker === 'function'

export interface OpenedFile {
  name: string
  content: string
  handle?: FileSystemFileHandle
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

export async function openFile(): Promise<OpenedFile | null> {
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({ types: MD_TYPES })
      if (!handle) return null
      const file = await handle.getFile()
      return { name: file.name, content: await file.text(), handle }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.markdown,.mdown,.txt,text/markdown,text/plain'
    input.onchange = async () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, content: await file.text() } : null)
    }
    input.click()
  })
}

export async function writeHandle(handle: FileSystemFileHandle, content: string) {
  const writable = await (handle as unknown as {
    createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>
  }).createWritable()
  await writable.write(content)
  await writable.close()
}

/** 다른 이름으로 저장. 저장된 핸들(지원 시)을 반환 */
export async function saveFileAs(
  suggestedName: string,
  content: string,
): Promise<{ name: string; handle?: FileSystemFileHandle } | null> {
  if (w.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName, types: MD_TYPES })
      await writeHandle(handle, content)
      return { name: handle.name, handle }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  download(suggestedName, content, 'text/markdown;charset=utf-8')
  return { name: suggestedName }
}

export function download(name: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface TreeNode {
  name: string
  path: string
  kind: 'file' | 'directory'
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  children?: TreeNode[]
}

const MD_EXT = /\.(md|markdown|mdown|txt)$/i

async function readDir(dir: FileSystemDirectoryHandle, base: string, depth: number): Promise<TreeNode[]> {
  const nodes: TreeNode[] = []
  const entries = (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()
  for await (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const path = `${base}/${entry.name}`
    if (entry.kind === 'directory') {
      if (depth >= 4) continue
      const children = await readDir(entry as FileSystemDirectoryHandle, path, depth + 1)
      if (children.length) nodes.push({ name: entry.name, path, kind: 'directory', handle: entry as FileSystemDirectoryHandle, children })
    } else if (MD_EXT.test(entry.name)) {
      nodes.push({ name: entry.name, path, kind: 'file', handle: entry as FileSystemFileHandle })
    }
  }
  return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'ko') : a.kind === 'directory' ? -1 : 1))
}

export async function openFolder(): Promise<{ name: string; tree: TreeNode[] } | null> {
  if (!w.showDirectoryPicker) return null
  try {
    const dir = await w.showDirectoryPicker({ mode: 'readwrite' })
    return { name: dir.name, tree: await readDir(dir, dir.name, 0) }
  } catch (e) {
    if (isAbort(e)) return null
    throw e
  }
}

export const fileToDataURL = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })

/** 붙여넣은 이미지를 문서에 넣기 전에 줄여서(최대 1600px) 동기화 용량을 아낀다 */
export async function compressImage(file: File, maxSide = 1600): Promise<string> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return fileToDataURL(file)
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    if (scale === 1 && file.size < 300_000) return fileToDataURL(file)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const type = file.type === 'image/png' && file.size < 800_000 ? 'image/png' : 'image/webp'
    return canvas.toDataURL(type, 0.85)
  } catch {
    return fileToDataURL(file)
  }
}
