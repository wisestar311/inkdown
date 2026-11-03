import { useState } from 'react'
import { Modal } from './Dialog'
import type { SyncConfig } from '../lib/storage'
import { GitHubClient } from '../lib/sync/github'

interface Props {
  config: SyncConfig
  onSave: (c: SyncConfig) => void
  onClose: () => void
}

export function SyncDialog({ config, onSave, onClose }: Props) {
  const [repo, setRepo] = useState(config.owner && config.repo ? `${config.owner}/${config.repo}` : '')
  const [token, setToken] = useState(config.token)
  const [branch, setBranch] = useState(config.branch || 'main')
  const [folder, setFolder] = useState(config.folder)
  const [device, setDevice] = useState(config.device)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const build = (enabled: boolean): SyncConfig | null => {
    const m = repo
      .trim()
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .match(/^([\w.-]+)\/([\w.-]+)\/?$/)
    if (!m) {
      setStatus({ ok: false, text: '저장소는 "사용자이름/저장소이름" 형식으로 입력하세요' })
      return null
    }
    return { enabled, owner: m[1]!, repo: m[2]!, branch: branch.trim() || 'main', folder: folder.trim().replace(/^\/+|\/+$/g, ''), token: token.trim(), device: device.trim() || config.device }
  }

  const connect = async () => {
    const cfg = build(true)
    if (!cfg) return
    if (!cfg.token) return setStatus({ ok: false, text: '토큰을 입력하세요' })
    setBusy(true)
    setStatus({ ok: true, text: '연결 확인 중…' })
    try {
      const info = await new GitHubClient(cfg).check()
      if (!info.canWrite) {
        setStatus({ ok: false, text: '읽기만 가능한 토큰입니다. Contents 권한을 "Read and write"로 바꿔 주세요' })
        return
      }
      if (!info.private && !confirm(`${info.fullName} 저장소는 공개(public) 저장소입니다.\n문서가 누구에게나 보일 수 있습니다. 계속할까요?`)) return
      onSave(cfg)
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="기기 간 동기화 (GitHub)" onClose={onClose} width={520}>
      <ol className="sync-guide">
        <li>
          <a href="https://github.com/new" target="_blank" rel="noreferrer">github.com/new</a> 에서 <b>Private</b> 저장소를 만듭니다. (예: <code>inkdown-notes</code>)
        </li>
        <li>
          <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Fine-grained 토큰 만들기</a> →
          Repository access: <b>Only select repositories</b>에서 위 저장소 선택 → Permissions: <b>Contents → Read and write</b> → 생성된 토큰 복사
        </li>
        <li>아래에 입력하고 <b>연결</b>을 누릅니다. 다른 기기(웹·윈도우·맥)에서도 같은 값으로 연결하면 됩니다.</li>
      </ol>

      <label className="field-label">저장소</label>
      <input className="field" placeholder="사용자이름/inkdown-notes" value={repo} onChange={(e) => setRepo(e.target.value)} />
      <label className="field-label">토큰</label>
      <input className="field" type="password" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      <div className="field-row">
        <div>
          <label className="field-label">브랜치</label>
          <input className="field" value={branch} onChange={(e) => setBranch(e.target.value)} />
        </div>
        <div>
          <label className="field-label">폴더</label>
          <input className="field" placeholder="(저장소 최상위)" value={folder} onChange={(e) => setFolder(e.target.value)} />
        </div>
        <div>
          <label className="field-label">이 기기 이름</label>
          <input className="field" value={device} onChange={(e) => setDevice(e.target.value)} />
        </div>
      </div>
      <p className="hint">토큰은 이 기기에만 저장되며 GitHub 외에는 전송되지 않습니다. 공용 PC에서는 사용 후 동기화를 끄세요.</p>

      {status && <p className={`status ${status.ok ? 'ok' : 'err'}`}>{status.text}</p>}

      <div className="modal-actions">
        {config.enabled && (
          <button
            className="btn danger"
            onClick={() => {
              const c = build(false)
              onSave(c ? { ...c, token: '' } : { ...config, enabled: false, token: '' })
            }}
          >
            동기화 끄기
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>닫기</button>
        <button className="btn primary" disabled={busy} onClick={connect}>연결</button>
      </div>
    </Modal>
  )
}
