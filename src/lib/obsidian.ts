/* Obsidian으로 보내기
   1) 지금 문서 → Obsidian 앱에 새 노트로 바로 열기 (obsidian:// 주소, 웹·데스크톱 공통)
   2) 모든 문서 → Obsidian 보관함(vault) 폴더에 .md 파일로 저장 (폴더 구조 유지) */
import { desktop } from './desktop'
import { docsToFiles, makeZip, toObsidian } from './convert'
import { idbGet, idbSet } from './db'
import { download } from './fileio'
import type { Doc } from './storage'

const clean = (s: string) => s.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '제목 없음'

/** 보관함 안의 노트 경로 (확장자 없이): 보관 폴더/문서 폴더/제목 */
export function notePath(doc: Pick<Doc, 'title' | 'folder'>, sub: string) {
  return [sub, ...(doc.folder ?? '').split('/')].map((s) => s.trim()).filter(Boolean).map(clean).concat(clean(doc.title)).join('/')
}

function openUri(uri: string) {
  if (desktop) return desktop.openExternal(uri)
  const a = document.createElement('a')
  a.href = uri
  a.click()
}

/** 지금 문서를 Obsidian 앱에 새 노트로 만든다. 같은 이름의 노트가 있으면 덮어쓴다.
    긴 문서는 주소에 다 담을 수 없어 클립보드를 거쳐 넘긴다. 반환값: 클립보드를 썼는지 */
export async function openInObsidian(doc: Doc, vault: string, sub: string): Promise<{ viaClipboard: boolean }> {
  const md = toObsidian(doc.content)
  const params = [vault.trim() ? `vault=${encodeURIComponent(vault.trim())}` : '', `file=${encodeURIComponent(notePath(doc, sub))}`, 'overwrite']
  const inline = `content=${encodeURIComponent(md)}`
  let viaClipboard = false
  if (inline.length > 6000) {
    await navigator.clipboard.writeText(md)
    params.push('clipboard')
    viaClipboard = true
  } else params.push(inline)
  await openUri(`obsidian://new?${params.filter(Boolean).join('&')}`)
  return { viaClipboard }
}

// ---------- 모든 문서를 보관함 폴더로 ----------
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>
}
const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: 'readwrite' }) => Promise<DirHandle> }).showDirectoryPicker

/** 이 환경에서 폴더에 직접 쓸 수 있는지 (데스크톱 앱, Chrome·Edge) */
export const canWriteFolder = !!desktop || typeof picker === 'function'

const HANDLE_KEY = 'obsidianDir'

/** 보관함 폴더 고르기. 데스크톱은 경로, 웹은 폴더 이름을 돌려준다 */
export async function chooseVaultFolder(): Promise<string | null> {
  if (desktop) return desktop.chooseExportFolder()
  if (!picker) return null
  try {
    const h = await picker({ mode: 'readwrite' })
    await idbSet(HANDLE_KEY, h)
    return h.name
  } catch {
    return null
  }
}

async function webHandle(): Promise<DirHandle | null> {
  const h = (await idbGet<DirHandle>(HANDLE_KEY).catch(() => undefined)) ?? null
  if (!h) return null
  if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'granted') return h
  return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted' ? h : null
}

async function writeWeb(root: DirHandle, files: { path: string; data: string }[]) {
  for (const f of files) {
    const parts = f.path.split('/')
    let dir: FileSystemDirectoryHandle = root
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true })
    const file = await dir.getFileHandle(parts[parts.length - 1]!, { create: true })
    const w = await (file as unknown as { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }).createWritable()
    await w.write(f.data)
    await w.close()
  }
}

/** 모든 문서를 보관함 폴더에 저장. 폴더에 쓸 수 없는 브라우저는 ZIP으로 내려받는다 */
export async function exportAllToVault(docs: Doc[], sub: string, desktopDir: string | undefined): Promise<{ count: number; zip: boolean; folder?: string }> {
  const files = docsToFiles(docs, (d) => toObsidian(d.content), sub)
  if (desktop) {
    const dir = desktopDir || (await desktop.chooseExportFolder())
    if (!dir) return { count: 0, zip: false }
    await desktop.writeExportFiles(dir, files)
    return { count: files.length, zip: false, folder: dir }
  }
  if (picker) {
    const h = (await webHandle()) ?? (await chooseVaultFolder().then(() => webHandle()))
    if (!h) return { count: 0, zip: false }
    await writeWeb(h, files)
    return { count: files.length, zip: false, folder: h.name }
  }
  download('Inkdown-Obsidian.zip', new Blob([makeZip(files) as BlobPart], { type: 'application/zip' }))
  return { count: files.length, zip: true }
}
