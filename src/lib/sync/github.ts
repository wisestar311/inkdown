/* GitHub REST API를 문서 저장소로 사용하는 최소 클라이언트.
   각 문서는 저장소 안의 .md 파일 하나이며, 저장할 때마다 커밋이 생겨 버전 기록이 남는다. */
import type { SyncConfig } from '../storage'

const API = 'https://api.github.com'
/** 동기화 폴더 안에 두는 Inkdown 정보 파일 (빈 폴더 목록 등) */
export const META_FILE = '.inkdown.json'

export class GitHubError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/')

type TreeItem = { path: string; type: string; sha: string }
/** 저장소 파일 목록 캐시: 바뀐 게 없으면 GitHub이 304(변경 없음)만 돌려줘 요청 한도를 거의 쓰지 않는다 */
const treeCache = new Map<string, { etag: string; tree: TreeItem[] }>()

export class GitHubClient {
  private emptyRepo = false

  constructor(private cfg: SyncConfig) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${API}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new GitHubError(0, '인터넷에 연결할 수 없습니다')
    }
    if (!res.ok) {
      let msg = res.statusText
      try {
        msg = ((await res.json()) as { message?: string }).message ?? msg
      } catch {
        /* 본문 없음 */
      }
      throw new GitHubError(res.status, humanize(res.status, msg))
    }
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  private get repoPath() {
    return `/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}`
  }

  /** 연결 확인: 저장소 접근 권한과 쓰기 권한 */
  async check(): Promise<{ fullName: string; private: boolean; canWrite: boolean; defaultBranch: string }> {
    const r = await this.req<{ full_name: string; private: boolean; default_branch: string; permissions?: { push?: boolean } }>('GET', this.repoPath)
    return { fullName: r.full_name, private: r.private, canWrite: !!r.permissions?.push, defaultBranch: r.default_branch }
  }

  /** 동기화 폴더 안의 모든 .md 파일: 경로 → blob SHA */
  /** 동기화 폴더 정보 파일(빈 폴더 목록)의 blob SHA — listFiles 뒤에 채워짐 */
  metaSha: string | undefined

  async listFiles(): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    this.metaSha = undefined
    try {
      const tree = { tree: await this.fetchTree() }
      this.emptyRepo = false
      const prefix = this.cfg.folder ? `${this.cfg.folder.replace(/^\/+|\/+$/g, '')}/` : ''
      for (const item of tree.tree) {
        if (item.type === 'blob' && item.path === `${prefix}${META_FILE}`) this.metaSha = item.sha
        else if (item.type === 'blob' && item.path.startsWith(prefix) && /\.md$/i.test(item.path)) map.set(item.path, item.sha)
      }
    } catch (e) {
      // 409: 비어 있는 저장소(커밋 없음) — 첫 업로드 때 브랜치가 생성됨
      if (e instanceof GitHubError && e.status === 409) {
        this.emptyRepo = true
        return map
      }
      throw e
    }
    return map
  }

  /** 파일 목록 가져오기 (ETag로 변경 여부 확인) */
  private async fetchTree(): Promise<TreeItem[]> {
    const key = `${this.cfg.owner}/${this.cfg.repo}@${this.cfg.branch}`
    const cached = treeCache.get(key)
    let res: Response
    try {
      res = await fetch(`${API}${this.repoPath}/git/trees/${encodeURIComponent(this.cfg.branch)}?recursive=1`, {
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.cfg.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(cached ? { 'If-None-Match': cached.etag } : {}),
        },
      })
    } catch {
      throw new GitHubError(0, '인터넷에 연결할 수 없습니다')
    }
    if (res.status === 304 && cached) return cached.tree
    if (!res.ok) {
      let msg = res.statusText
      try {
        msg = ((await res.json()) as { message?: string }).message ?? msg
      } catch {
        /* 본문 없음 */
      }
      throw new GitHubError(res.status, humanize(res.status, msg))
    }
    const tree = ((await res.json()) as { tree: TreeItem[] }).tree
    const etag = res.headers.get('ETag')
    if (etag) treeCache.set(key, { etag, tree })
    return tree
  }

  async getBlob(sha: string): Promise<string> {
    const blob = await this.req<{ content: string; encoding: string }>('GET', `${this.repoPath}/git/blobs/${sha}`)
    return blob.encoding === 'base64' ? decodeBase64Utf8(blob.content) : blob.content
  }

  /** 파일 생성/수정. sha가 있으면 그 버전 위에서만 수정(동시 수정 감지). 새 blob SHA 반환 */
  async putFile(path: string, content: string, sha: string | undefined, message: string): Promise<string> {
    const r = await this.req<{ content: { sha: string } }>('PUT', `${this.repoPath}/contents/${encodePath(path)}`, {
      message,
      content: encodeBase64Utf8(content),
      ...(sha ? { sha } : {}),
      ...(this.emptyRepo ? {} : { branch: this.cfg.branch }),
    })
    this.emptyRepo = false
    return r.content.sha
  }

  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    await this.req('DELETE', `${this.repoPath}/contents/${encodePath(path)}`, { message, sha, branch: this.cfg.branch })
  }
}

function humanize(status: number, msg: string): string {
  if (status === 401) return '토큰이 올바르지 않거나 만료되었습니다'
  if (status === 403 && /rate limit/i.test(msg)) return 'GitHub 요청 한도를 초과했습니다. 잠시 후 다시 시도합니다'
  if (status === 403) return '이 저장소에 쓸 권한이 없습니다 (토큰의 Contents 권한을 Read and write로 설정하세요)'
  if (status === 404) return '저장소 또는 브랜치를 찾을 수 없습니다 (이름과 토큰의 저장소 접근 범위를 확인하세요)'
  if (status === 409 || status === 422) return `다른 기기와 동시에 수정되어 다시 시도합니다 (${msg})`
  return `GitHub 오류 ${status}: ${msg}`
}
