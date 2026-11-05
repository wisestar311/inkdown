import { useMemo, useState } from 'react'
import { Modal } from './Dialog'
import { markdownToHtml } from '../lib/export'
import help from '../../HELP.md?raw'

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

/** 사용 설명서: 왼쪽 목차 + 검색 */
export function HelpDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const sections = useMemo(() => {
    // Mac: 표 열 폭(Ctrl+Alt+←/→)만 ⌃⌥, 나머지는 ⌘·⌥
    const text = isMac ? help.replace(/Ctrl\+Alt\+←/g, '⌃⌥←').replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥') : help
    const parts = text.split(/\n(?=## )/)
    return parts.slice(1).map((p) => ({ title: p.match(/^## (.+)/)?.[1] ?? '', body: p }))
  }, [])
  const [current, setCurrent] = useState(0)
  const query = q.trim().toLowerCase()
  const hits = query ? sections.filter((s) => s.body.toLowerCase().includes(query)) : null
  const shown = hits ?? [sections[current]!]
  return (
    <Modal title="사용 설명서" onClose={onClose} width={760}>
      <input className="field" placeholder="찾기 (예: 표, 동기화, PDF, 단축키)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="help-wrap">
        <nav className="help-toc">
          {sections.map((s, i) => (
            <button
              key={s.title}
              className={!hits && i === current ? 'on' : hits?.includes(s) ? 'hit' : ''}
              onClick={() => {
                setQ('')
                setCurrent(i)
              }}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <div className="help-body about-log">
          {shown.length ? (
            shown.map((s) => <div key={s.title} dangerouslySetInnerHTML={{ __html: markdownToHtml(s.body) }} />)
          ) : (
            <p className="hint">"{q}"에 해당하는 내용이 없습니다.</p>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <span className="app-version">F1로 언제든 열 수 있습니다</span>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
