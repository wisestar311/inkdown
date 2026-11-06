/* 동기화 엔진 테스트: GitHub API를 흉내 내는 가짜 서버 위에서 두 기기(A, B)가 동기화하는 시나리오 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mergeFolders, runSync, type SyncStore } from '../src/lib/sync/engine'
import { decodeBase64Utf8, encodeBase64Utf8 } from '../src/lib/sync/github'
import { type Doc, type SyncConfig, type Tombstone, hashText, newId } from '../src/lib/storage'

// ---------- 가짜 GitHub ----------
class FakeGitHub {
  files = new Map<string, { sha: string; content: string }>()
  blobs = new Map<string, string>()
  commits = 0
  notModified = 0
  empty = false
  private n = 0

  private sha(content: string) {
    const sha = `sha${++this.n}-${hashText(content)}`
    this.blobs.set(sha, content)
    return sha
  }

  handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const parts = url.pathname.split('/').slice(4) // /repos/o/r/...
    if (method === 'GET' && parts[0] === 'git' && parts[1] === 'trees') {
      if (this.empty) return json(409, { message: 'Git Repository is empty.' })
      const tree = [...this.files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha }))
      const etag = `"${hashText(JSON.stringify(tree))}"`
      const inm = (init?.headers as Record<string, string> | undefined)?.['If-None-Match']
      if (inm === etag) {
        this.notModified++
        return new Response(null, { status: 304 })
      }
      return new Response(JSON.stringify({ truncated: false, tree }), { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag } })
    }
    if (method === 'GET' && parts[0] === 'git' && parts[1] === 'blobs') {
      const c = this.blobs.get(parts[2]!)
      return c === undefined ? json(404, { message: 'Not Found' }) : json(200, { encoding: 'base64', content: encodeBase64Utf8(c) })
    }
    if (parts[0] === 'contents') {
      const path = parts.slice(1).map(decodeURIComponent).join('/')
      const body = JSON.parse(String(init?.body)) as { content?: string; sha?: string }
      const cur = this.files.get(path)
      if (method === 'PUT') {
        if (cur && body.sha !== cur.sha) return json(409, { message: `${path} does not match ${body.sha}` })
        if (!cur && body.sha) return json(422, { message: 'sha wasn\'t supplied' })
        const content = decodeBase64Utf8(body.content!)
        const sha = this.sha(content)
        this.files.set(path, { sha, content })
        this.empty = false
        this.commits++
        return json(cur ? 200 : 201, { content: { sha, path } })
      }
      if (method === 'DELETE') {
        if (!cur || cur.sha !== body.sha) return json(409, { message: 'conflict' })
        this.files.delete(path)
        this.commits++
        return json(200, {})
      }
    }
    return json(404, { message: `unhandled ${method} ${url.pathname}` })
  }

  /** 다른 사람이 GitHub 웹에서 직접 수정한 것처럼 */
  edit(path: string, content: string) {
    this.files.set(path, { sha: this.sha(content), content })
  }
}

// ---------- 기기 ----------
class Device implements SyncStore {
  docs: Doc[] = []
  tombs: Tombstone[] = []
  cfg: SyncConfig
  constructor(name: string) {
    this.cfg = { enabled: true, owner: 'me', repo: 'notes', branch: 'main', folder: 'notes', token: 't', device: name }
  }
  getDocs = () => this.docs
  patchDoc = (id: string, patch: Partial<Doc>, expectHash?: string) => {
    const d = this.docs.find((x) => x.id === id)
    if (!d || (expectHash !== undefined && hashText(d.content) !== expectHash)) return false
    Object.assign(d, patch)
    return true
  }
  addDoc = (doc: Doc) => void this.docs.push(doc)
  removeDoc = (id: string) => void (this.docs = this.docs.filter((d) => d.id !== id))
  getTombstones = () => this.tombs
  setTombstones = (t: Tombstone[]) => void (this.tombs = t)
  folders: string[] = []
  synced: string[] | undefined
  getFolders = () => this.folders
  getSyncedFolders = () => this.synced
  setFolders = (f: string[]) => {
    this.folders = f
    this.synced = f
  }
  appearance: { updatedAt: number; values: Record<string, unknown> } | null = null
  getAppearance = () => this.appearance
  setAppearance = (x: { updatedAt: number; values: Record<string, unknown> }) => void (this.appearance = x)

  write(title: string, body = '본문') {
    const doc: Doc = { id: newId(), title, content: `# ${title}\n\n${body}\n`, updatedAt: Date.now() }
    this.docs.push(doc)
    return doc
  }
  edit(doc: Doc, content: string) {
    doc.content = content
  }
  delete(doc: Doc) {
    if (doc.remotePath && doc.remoteSha) this.tombs.push({ path: doc.remotePath, sha: doc.remoteSha })
    this.removeDoc(doc.id)
  }
  byTitle(t: string) {
    return this.docs.find((d) => d.title === t)
  }
  sync() {
    return runSync(this.cfg, this)
  }
}

let gh: FakeGitHub
let A: Device
let B: Device

beforeEach(() => {
  gh = new FakeGitHub()
  globalThis.fetch = gh.handle as typeof fetch
  A = new Device('Mac 앱')
  B = new Device('Windows 앱')
})

describe('동기화', () => {
  it('A에서 쓴 문서가 B로 전달된다 (한글 포함)', async () => {
    A.write('회의록', '안녕하세요 😀')
    expect((await A.sync()).uploaded).toBe(1)
    expect([...gh.files.keys()]).toEqual(['notes/회의록.md'])
    expect((await B.sync()).downloaded).toBe(1)
    expect(B.docs[0]!.content).toBe('# 회의록\n\n안녕하세요 😀\n')
  })

  it('B의 수정이 A에 반영되고, 변경이 없으면 아무것도 보내지 않는다', async () => {
    A.write('메모')
    await A.sync()
    await B.sync()
    B.edit(B.docs[0]!, '# 메모\n\nB에서 고침\n')
    expect((await B.sync()).uploaded).toBe(1)
    expect((await A.sync()).downloaded).toBe(1)
    expect(A.docs[0]!.content).toContain('B에서 고침')
    const commits = gh.commits
    await A.sync()
    await B.sync()
    expect(gh.commits).toBe(commits)
  })

  it('양쪽에서 동시에 고치면 두 내용 모두 보존된다 (충돌 사본)', async () => {
    A.write('대본')
    await A.sync()
    await B.sync()
    A.edit(A.docs[0]!, '# 대본\n\nA 버전\n')
    B.edit(B.docs[0]!, '# 대본\n\nB 버전\n')
    await A.sync()
    const r = await B.sync()
    expect(r.conflicts).toEqual(['대본'])
    const contents = [...gh.files.values()].map((f) => f.content)
    expect(contents.some((c) => c.includes('A 버전'))).toBe(true)
    expect(contents.some((c) => c.includes('B 버전'))).toBe(true)
    await A.sync()
    expect(A.docs.map((d) => d.content).sort()).toEqual(B.docs.map((d) => d.content).sort())
    expect(A.docs).toHaveLength(2)
  })

  it('A에서 삭제하면 원격과 B에서도 삭제된다', async () => {
    const doc = A.write('지울 문서')
    await A.sync()
    await B.sync()
    A.delete(doc)
    expect((await A.sync()).deleted).toBe(1)
    expect(gh.files.size).toBe(0)
    await B.sync()
    expect(B.docs).toHaveLength(0)
  })

  it('올리는 도중에 지운 문서는 되살아나지 않는다 (가져오기 직후 대량 업로드 중 삭제)', async () => {
    const docs = Array.from({ length: 5 }, (_, i) => A.write(`노트${i}`))
    // 세 번째 파일을 올리는 순간 사용자가 그 문서(아직 올라가는 중)와 첫 문서를 지움
    const orig = gh.handle
    let puts = 0
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT' && ++puts === 3) A.delete(docs[0]!), A.delete(docs[2]!)
      return orig(input, init)
    }) as typeof fetch
    await A.sync()
    globalThis.fetch = gh.handle as typeof fetch
    await A.sync()
    await A.sync()
    expect(A.docs.map((d) => d.title).sort()).toEqual(['노트1', '노트3', '노트4'])
    expect([...gh.files.keys()].sort()).toEqual(['notes/노트1.md', 'notes/노트3.md', 'notes/노트4.md'])
    await B.sync()
    expect(B.docs).toHaveLength(3)
  })

  it('삭제 직전에 다른 기기가 고쳤다면 삭제하지 않고 살린다', async () => {
    const doc = A.write('살릴 문서')
    await A.sync()
    await B.sync()
    B.edit(B.docs[0]!, '# 살릴 문서\n\n중요한 추가 내용\n')
    await B.sync()
    A.delete(doc)
    await A.sync()
    expect(gh.files.size).toBe(1)
    expect(A.docs[0]!.content).toContain('중요한 추가 내용')
  })

  it('원격에서 지워졌어도 이 기기에서 고친 문서는 다시 올린다', async () => {
    A.write('복원')
    await A.sync()
    await B.sync()
    gh.files.clear()
    B.edit(B.docs[0]!, '# 복원\n\n수정함\n')
    await B.sync()
    expect([...gh.files.values()][0]!.content).toContain('수정함')
    await A.sync() // A는 수정하지 않았으므로 원격 상태를 따름
    expect(A.docs[0]!.content).toContain('수정함')
  })

  it('제목을 바꾸면 파일 이름도 바뀌고 다른 기기에도 한 개만 남는다', async () => {
    const doc = A.write('초안')
    await A.sync()
    await B.sync()
    A.edit(doc, '# 최종본\n\n내용\n')
    doc.title = '최종본'
    await A.sync()
    expect([...gh.files.keys()]).toEqual(['notes/최종본.md'])
    await B.sync()
    expect(B.docs.map((d) => d.title)).toEqual(['최종본'])
  })

  it('같은 제목의 새 문서는 (2) 를 붙여 덮어쓰지 않는다', async () => {
    A.write('일기', 'A')
    B.write('일기', 'B')
    await A.sync()
    await B.sync()
    expect([...gh.files.keys()].sort()).toEqual(['notes/일기 (2).md', 'notes/일기.md'])
    await A.sync()
    expect(A.docs).toHaveLength(2)
  })

  it('빈 저장소(커밋 없음)에서도 첫 업로드가 된다', async () => {
    gh.empty = true
    A.write('첫 문서')
    await A.sync()
    expect(gh.files.size).toBe(1)
  })

  it('이 기기에만 보관하는 문서와 빈 새 문서는 올리지 않는다', async () => {
    A.docs.push({ id: newId(), title: '환영', content: '# 환영', updatedAt: 0, localOnly: true })
    A.docs.push({ id: newId(), title: '제목 없음', content: '  \n', updatedAt: 0 })
    A.docs.push({ id: newId(), title: 'x', content: '# x', updatedAt: 0, fileName: 'x.md' })
    await A.sync()
    expect(gh.files.size).toBe(0)
  })

  it('동기화 도중 사용자가 입력한 내용을 원격 내용으로 덮어쓰지 않는다', async () => {
    A.write('입력 중')
    await A.sync()
    await B.sync()
    gh.edit('notes/입력 중.md', '# 입력 중\n\n원격 수정\n')
    const doc = B.docs[0]!
    const original = B.patchDoc
    B.patchDoc = (id, patch, expectHash) => {
      doc.content = '# 입력 중\n\n방금 입력한 글\n' // 다운로드가 끝나기 직전 입력
      return original(id, patch, expectHash)
    }
    await B.sync()
    expect(doc.content).toContain('방금 입력한 글')
  })

  it('폴더 안 문서는 같은 폴더 경로로 저장되고 다른 기기에도 같은 폴더로 나타난다', async () => {
    const doc = A.write('금리 대본')
    doc.folder = '유튜브/대본'
    await A.sync()
    expect([...gh.files.keys()]).toEqual(['notes/유튜브/대본/금리 대본.md'])
    await B.sync()
    expect(B.docs[0]!.folder).toBe('유튜브/대본')
  })

  it('폴더를 옮기면 원격 파일도 옮겨지고 내용은 그대로다 (커밋 2개: 새 위치 + 옛 위치 삭제)', async () => {
    const doc = A.write('메모')
    await A.sync()
    await B.sync()
    doc.folder = '보관'
    doc.moved = true
    const before = gh.commits
    await A.sync()
    expect([...gh.files.keys()]).toEqual(['notes/보관/메모.md'])
    expect(gh.commits - before).toBe(2)
    expect(doc.moved).toBe(false)
    await B.sync()
    expect(B.docs).toHaveLength(1)
    expect(B.docs[0]!.folder).toBe('보관')
    expect(B.docs[0]!.content).toBe(doc.content)
    // 다시 동기화해도 변화 없음
    const c = gh.commits
    await A.sync()
    await B.sync()
    expect(gh.commits).toBe(c)
  })

  it('다른 기기가 받은 문서는 경로가 제목과 달라도 마음대로 옮기지 않는다', async () => {
    gh.edit('notes/직접 만든 파일.md', '# 전혀 다른 제목\n')
    await A.sync()
    const c = gh.commits
    await A.sync()
    expect(gh.commits).toBe(c)
    expect([...gh.files.keys()]).toEqual(['notes/직접 만든 파일.md'])
  })

  it('빈 폴더도 다른 기기에 나타나고, 지우면 다른 기기에서도 사라진다', async () => {
    A.folders = ['유튜브', '유튜브/대본', '보관']
    await A.sync()
    await B.sync()
    expect(B.folders).toEqual(['보관', '유튜브', '유튜브/대본'])
    // B에서 '보관' 삭제, A에서 '아이디어' 추가 → 양쪽 반영
    B.folders = ['유튜브', '유튜브/대본']
    A.folders = [...A.folders, '아이디어']
    await B.sync()
    await A.sync()
    await B.sync()
    expect(A.folders).toEqual(['아이디어', '유튜브', '유튜브/대본'])
    expect(B.folders).toEqual(A.folders)
    // 변화 없으면 커밋 없음
    const c = gh.commits
    await A.sync()
    await B.sync()
    expect(gh.commits).toBe(c)
  })

  it('처음 연결한 기기의 폴더는 기존 폴더와 합쳐진다', () => {
    expect(mergeFolders(['a'], ['b'], undefined)).toEqual(['a', 'b'])
    expect(mergeFolders(['a', 'b'], ['b'], ['a', 'b'])).toEqual(['b'])
  })

  it('내 컴퓨터 파일 문서는 "동기화에 포함"을 켜야 올라간다', async () => {
    const d = A.write('파일 문서')
    d.fileName = '파일 문서.md'
    await A.sync()
    expect([...gh.files.keys()].filter((k) => k.endsWith('.md'))).toEqual([])
    d.syncLocal = true
    await A.sync()
    expect([...gh.files.keys()].filter((k) => k.endsWith('.md'))).toEqual(['notes/파일 문서.md'])
  })

  it('바뀐 게 없으면 304(변경 없음)로 확인만 하고, 다른 기기 변경은 놓치지 않는다', async () => {
    A.write('주기 확인')
    await A.sync()
    await B.sync()
    const before = gh.notModified
    await B.sync()
    await B.sync()
    expect(gh.notModified - before).toBe(2)
    A.edit(A.docs[0]!, '# 주기 확인\n\nA에서 고침\n')
    await A.sync()
    await B.sync()
    expect(B.docs[0]!.content).toContain('A에서 고침')
  })

  it('글꼴·제목 색 설정은 나중에 바꾼 기기 쪽으로 모든 기기가 맞춰진다', async () => {
    A.appearance = { updatedAt: 1000, values: { headingColors: ['#c0392b', '', '', '', '', ''], bodyFont: 'pretendard' } }
    await A.sync()
    await B.sync()
    expect(B.appearance?.values.headingColors).toEqual(['#c0392b', '', '', '', '', ''])
    B.appearance = { updatedAt: 2000, values: { headingColors: ['#2471a3', '', '', '', '', ''], bodyFont: 'pretendard' } }
    await B.sync()
    await A.sync()
    expect(A.appearance?.values.headingColors?.[0]).toBe('#2471a3')
    const c = gh.commits
    await A.sync()
    await B.sync()
    expect(gh.commits).toBe(c)
  })

  it('예전 버전에서 정한 설정(시각 기록 없음)도 올라가고, 다른 기기는 먼저 올라간 쪽을 따른다', async () => {
    A.appearance = { updatedAt: 1, values: { headingColors: ['#c0392b', '', '', '', '', ''] } }
    B.appearance = { updatedAt: 1, values: { headingColors: ['#1e8449', '', '', '', '', ''] } }
    await A.sync()
    await B.sync()
    expect(B.appearance?.values.headingColors?.[0]).toBe('#c0392b')
    const c = gh.commits
    await A.sync()
    await B.sync()
    expect(gh.commits).toBe(c)
  })
})
