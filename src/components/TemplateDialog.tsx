import { Modal } from './Dialog'
import { BUILTIN_TEMPLATES, TEMPLATE_FOLDER } from '../templates'
import type { Doc } from '../lib/storage'
import { splitInk } from '../lib/ink'

interface Props {
  docs: Doc[]
  onPick: (content: string) => void
  onSaveCurrent: () => void
  onClose: () => void
}

const preview = (md: string) =>
  splitInk(md)
    .body.replace(/^#+\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`|]/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1, 3)
    .join(' · ')
    .slice(0, 90)

export function TemplateDialog({ docs, onPick, onSaveCurrent, onClose }: Props) {
  const mine = docs.filter((d) => d.folder === TEMPLATE_FOLDER || d.folder?.startsWith(`${TEMPLATE_FOLDER}/`)).sort((a, b) => a.title.localeCompare(b.title, 'ko'))
  return (
    <Modal title="템플릿으로 새 문서" onClose={onClose} width={560}>
      <div className="tpl-grid">
        {BUILTIN_TEMPLATES.map((t) => (
          <button key={t.id} className="tpl-card" onClick={() => onPick(t.content())}>
            <span className="tpl-icon">{t.icon}</span>
            <span className="tpl-name">{t.name}</span>
            <span className="tpl-desc">{t.description}</span>
          </button>
        ))}
        {mine.map((d) => (
          <button key={d.id} className="tpl-card mine" onClick={() => onPick(d.content)}>
            <span className="tpl-icon">⭐</span>
            <span className="tpl-name">{d.title}</span>
            <span className="tpl-desc">{preview(d.content) || '내 템플릿'}</span>
          </button>
        ))}
      </div>
      <p className="hint">
        내가 만든 템플릿은 메뉴판의 <b>📁 {TEMPLATE_FOLDER}</b> 폴더에 있는 문서입니다. 그 문서를 고치면 템플릿도 바뀌고, 다른 기기에도 동기화됩니다.
      </p>
      <div className="modal-actions">
        <button className="btn" onClick={onSaveCurrent}>
          지금 문서를 템플릿으로 저장
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>
          닫기
        </button>
      </div>
    </Modal>
  )
}
