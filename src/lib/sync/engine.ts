/* 동기화 엔진: 이 기기의 문서 목록과 GitHub 저장소의 .md 파일을 양방향으로 맞춘다.

   규칙
   - 각 문서는 마지막으로 맞춘 원격 버전(remoteSha)과 그때의 내용 해시(syncedHash)를 기억한다.
   - 이 기기에서만 바뀜  → 업로드 (원격 SHA를 함께 보내 그 사이 다른 기기의 수정이 없었는지 GitHub가 검증)
   - 원격에서만 바뀜    → 다운로드
   - 양쪽 모두 바뀜     → 이 기기 내용을 유지하고, 원격 내용은 "충돌 사본" 파일로 따로 보존 (어느 쪽도 잃지 않음)
   - 이 기기에서 삭제   → 원격이 그 사이 바뀌지 않았을 때만 원격 파일 삭제
   - 원격에서 삭제      → 이 기기에서 수정하지 않았다면 함께 삭제, 수정했다면 다시 업로드 */
import { type Doc, type SyncConfig, type Tombstone, deriveTitle, hashText, newId } from '../storage'
import { GitHubClient, GitHubError, META_FILE } from './github'

export interface SyncStore {
  getDocs(): Doc[]
  /** expectHash가 주어지면 현재 내용 해시가 같을 때만 적용(그 사이 사용자가 입력했으면 건너뜀) */
  patchDoc(id: string, patch: Partial<Doc>, expectHash?: string): boolean
  addDoc(doc: Doc): void
  removeDoc(id: string): void
  getTombstones(): Tombstone[]
  setTombstones(t: Tombstone[]): void
  /** 사이드바 폴더 목록(빈 폴더 포함)과, 마지막으로 맞춘 목록 — 빈 폴더도 기기 간에 맞추기 위해 */
  getFolders?(): string[]
  getSyncedFolders?(): string[] | undefined
  setFolders?(folders: string[]): void
  /** 보기 설정 (없으면 맞추지 않음) */
  getAppearance?(): Appearance | null
  setAppearance?(a: Appearance): void
}

export interface SyncReport {
  uploaded: number
  downloaded: number
  deleted: number
  conflicts: string[]
  /** 동기화가 끝난 뒤 저장소에 있는 문서 수 */
  remoteTotal: number
}

/** 동기화 대상: 이 기기에만 보관(🔒)이 아니고, 내 컴퓨터 파일(💾)이면 '동기화에 포함'을 켠 경우만 */
export const isSyncable = (d: Doc) => !d.localOnly && (!(d.fileName || d.localPath) || !!d.syncLocal)

/** 폴더 목록 3자 병합: 원격 + 이 기기에서 새로 만든 것 − 이 기기에서 지운 것 */
export function mergeFolders(remote: string[], local: string[], last: string[] | undefined): string[] {
  const base = last ?? local
  const added = local.filter((f) => !base.includes(f))
  const deleted = base.filter((f) => !local.includes(f))
  return [...new Set([...remote, ...added, ...(last ? [] : local)])].filter((f) => f && !deleted.includes(f)).sort((a, b) => a.localeCompare(b, 'ko'))
}

const sanitize = (title: string) =>
  title
    .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80) || '제목 없음'

function folderOf(cfg: SyncConfig) {
  const f = cfg.folder.replace(/^\/+|\/+$/g, '')
  return f ? `${f}/` : ''
}

/** 문서 폴더 경로를 파일 이름으로 쓸 수 있게 정리 ('유튜브/대본') */
export const cleanFolder = (folder?: string) =>
  (folder ?? '')
    .split('/')
    .map((seg) => seg.replace(/[\\:*?"<>|#%\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60))
    .filter(Boolean)
    .join('/')

function uniquePath(cfg: SyncConfig, base: string, taken: (p: string) => boolean, folder?: string) {
  const sub = cleanFolder(folder)
  const dir = `${folderOf(cfg)}${sub ? `${sub}/` : ''}`
  let path = `${dir}${base}.md`
  for (let n = 2; taken(path); n++) path = `${dir}${base} (${n}).md`
  return path
}

const baseName = (path: string) => path.split('/').pop()!.replace(/\.md$/i, '')

/** 원격 경로에서 문서 폴더 부분만 ('notes/유튜브/대본/a.md' → '유튜브/대본') */
function folderFromPath(cfg: SyncConfig, path: string) {
  const rest = path.slice(folderOf(cfg).length)
  const i = rest.lastIndexOf('/')
  return i < 0 ? '' : rest.slice(0, i)
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
}

/** 폴더 목록 파일 내용 캐시 (같은 버전이면 다시 받지 않음) */
let metaCache: { sha: string; meta: Meta } | null = null

/** 모든 기기에 맞추는 보기 설정 (글꼴·글자 크기·줄 간격·제목 색) */
export interface Appearance {
  updatedAt: number
  values: Record<string, unknown>
}
interface Meta {
  folders?: string[]
  appearance?: Appearance
}

export async function runSync(cfg: SyncConfig, store: SyncStore): Promise<SyncReport> {
  const gh = new GitHubClient(cfg)
  const report: SyncReport = { uploaded: 0, downloaded: 0, deleted: 0, conflicts: [], remoteTotal: 0 }
  const msg = (verb: string, path: string) => `${verb}: ${baseName(path)} (${cfg.device})`

  const remote = await gh.listFiles()

  // 0) 동기화 정보 파일: 빈 폴더 목록 + 글꼴·제목 색 같은 보기 설정
  if (store.getFolders && store.setFolders) {
    let remoteMeta: Meta = {}
    if (gh.metaSha) {
      try {
        if (metaCache?.sha !== gh.metaSha) metaCache = { sha: gh.metaSha, meta: JSON.parse(await gh.getBlob(gh.metaSha)) as Meta }
        remoteMeta = metaCache.meta
      } catch {
        remoteMeta = {}
      }
    }
    const remoteFolders = remoteMeta.folders ?? []
    const merged = mergeFolders(remoteFolders, store.getFolders(), store.getSyncedFolders?.())

    // 보기 설정: 나중에 바꾼 쪽이 이김
    const localApp = store.getAppearance?.()
    const remoteApp = remoteMeta.appearance
    let appearance = remoteApp
    // 같은 시각(예: 둘 다 예전 버전에서 정한 설정)이면 저장소 쪽(먼저 올라간 기기)을 따른다
    if (localApp && (!remoteApp || localApp.updatedAt > remoteApp.updatedAt)) appearance = localApp
    else if (remoteApp && store.setAppearance && (!localApp || JSON.stringify(localApp.values) !== JSON.stringify(remoteApp.values))) store.setAppearance(remoteApp)

    const next: Meta = { folders: merged, ...(appearance ? { appearance } : {}) }
    const sortedRemote = [...remoteFolders].sort((a, b) => a.localeCompare(b, 'ko'))
    const changed = merged.join('\n') !== sortedRemote.join('\n') || JSON.stringify(appearance ?? null) !== JSON.stringify(remoteApp ?? null)
    if ((changed || !gh.metaSha) && (merged.length || appearance || gh.metaSha)) {
      await gh.putFile(`${folderOf(cfg)}${META_FILE}`, `${JSON.stringify(next, null, 2)}\n`, gh.metaSha, msg(appearance !== remoteApp ? '보기 설정·폴더 목록' : '폴더 목록', META_FILE))
    }
    store.setFolders(merged)
  }
  const claimed = new Set<string>()
  const taken = (p: string) => remote.has(p) || claimed.has(p)
  /** 올리는 사이 사용자가 문서를 지웠으면, 방금 올린 파일도 다음 동기화 때 지우도록 표시 */
  const record = (id: string, path: string, patch: Partial<Doc> & { remoteSha: string }) => {
    if (store.patchDoc(id, patch) || store.getDocs().some((d) => d.id === id)) return
    store.setTombstones([...store.getTombstones(), { path, sha: patch.remoteSha }])
  }

  // 1) 이 기기에서 삭제한 문서
  const remaining: Tombstone[] = []
  for (const t of store.getTombstones()) {
    const rs = remote.get(t.path)
    try {
      if (rs === t.sha) {
        await gh.deleteFile(t.path, t.sha, msg('삭제', t.path))
        remote.delete(t.path)
        report.deleted++
      }
      // rs가 다르면: 다른 기기에서 그 사이 수정함 → 삭제하지 않고 아래에서 다시 내려받음
    } catch (e) {
      if (!(e instanceof GitHubError) || e.status === 0) remaining.push(t)
    }
  }
  store.setTombstones(remaining)

  // 2) 이 기기의 문서
  for (const doc of store.getDocs().filter(isSyncable)) {
    const content = doc.content
    const hash = hashText(content)
    const dirty = hash !== doc.syncedHash

    if (!doc.remotePath) {
      if (!content.trim()) continue // 빈 새 문서는 아직 올리지 않음
      const path = uniquePath(cfg, sanitize(doc.title), taken, doc.folder)
      const sha = await gh.putFile(path, content, undefined, msg('새 문서', path))
      claimed.add(path)
      record(doc.id, path, { remotePath: path, remoteSha: sha, syncedHash: hash, moved: false })
      report.uploaded++
      continue
    }

    const path = doc.remotePath
    const rs = remote.get(path)
    claimed.add(path)

    if (rs === undefined) {
      if (doc.remoteSha && !dirty) {
        // 다른 기기에서 삭제(또는 이름 변경)됨
        store.removeDoc(doc.id)
        report.deleted++
      } else {
        const sha = await gh.putFile(path, content, undefined, msg('복원', path))
        record(doc.id, path, { remoteSha: sha, syncedHash: hash })
        report.uploaded++
      }
      continue
    }

    if (rs === doc.remoteSha) {
      const wantDir = uniquePath(cfg, 'x', () => false, doc.folder).slice(0, -'x.md'.length)
      const folderChanged = !!doc.moved && wantDir !== dirOf(path)
      if (!dirty && !folderChanged) {
        if (doc.moved) store.patchDoc(doc.id, { moved: false })
        continue
      }
      // 제목이 바뀌었거나 폴더를 옮겼으면 파일 경로도 바꿈
      const want = sanitize(doc.title)
      const titleChanged = dirty && want !== '제목 없음' && want !== baseName(path) && !baseName(path).startsWith(`${want} (`)
      if (titleChanged || folderChanged) {
        const next = uniquePath(cfg, titleChanged ? want : baseName(path), taken, doc.folder)
        const sha = await gh.putFile(next, content, undefined, msg(folderChanged ? `이동 ← ${path}` : `이름 변경 ← ${baseName(path)}`, next))
        await gh.deleteFile(path, rs, msg(folderChanged ? '이동' : '이름 변경', path))
        remote.delete(path)
        claimed.add(next)
        record(doc.id, next, { remotePath: next, remoteSha: sha, syncedHash: hash, moved: false })
      } else {
        const sha = await gh.putFile(path, content, rs, msg('수정', path))
        record(doc.id, path, { remoteSha: sha, syncedHash: hash })
      }
      report.uploaded++
      continue
    }

    // 원격이 바뀜
    const remoteContent = await gh.getBlob(rs)
    const remoteHash = hashText(remoteContent)
    if (!dirty || remoteContent === content) {
      const applied = store.patchDoc(
        doc.id,
        { content: remoteContent, title: deriveTitle(remoteContent, baseName(path)), remoteSha: rs, syncedHash: remoteHash, updatedAt: Date.now(), folder: folderFromPath(cfg, path) },
        hash,
      )
      if (applied && remoteContent !== content) report.downloaded++
      continue
    }

    // 충돌: 원격 내용을 사본으로 보존하고, 이 기기 내용으로 덮어씀
    const copyPath = uniquePath(cfg, `${baseName(path)} (충돌 사본 ${stamp()})`, taken, folderFromPath(cfg, path))
    const copySha = await gh.putFile(copyPath, remoteContent, undefined, msg('충돌 사본', copyPath))
    claimed.add(copyPath)
    store.addDoc({
      id: newId(),
      title: `${deriveTitle(remoteContent, baseName(path))} (충돌 사본)`,
      content: remoteContent,
      updatedAt: Date.now(),
      remotePath: copyPath,
      remoteSha: copySha,
      syncedHash: remoteHash,
      folder: folderFromPath(cfg, copyPath),
    })
    const sha = await gh.putFile(path, content, rs, msg('수정(충돌 해결)', path))
    record(doc.id, path, { remoteSha: sha, syncedHash: hash })
    report.conflicts.push(doc.title)
    report.uploaded++
  }

  // 3) 원격에만 있는 새 파일
  for (const [path, sha] of remote) {
    if (claimed.has(path)) continue
    // 동기화하는 사이 이 기기에서 지운 문서는 되살리지 않음 (다음 동기화 때 저장소에서도 지움)
    if (store.getTombstones().some((t) => t.path === path)) continue
    const content = await gh.getBlob(sha)
    store.addDoc({
      id: newId(),
      title: deriveTitle(content, baseName(path)),
      content,
      updatedAt: Date.now(),
      remotePath: path,
      remoteSha: sha,
      syncedHash: hashText(content),
      folder: folderFromPath(cfg, path),
    })
    report.downloaded++
  }

  report.remoteTotal = new Set([...remote.keys(), ...claimed]).size
  return report
}
