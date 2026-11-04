import { useState } from 'react'
import { Modal } from './Dialog'
import { canWriteFolder, chooseVaultFolder } from '../lib/obsidian'

export type ExportFormat = 'md' | 'obsidian-md' | 'docx' | 'pdf' | 'html' | 'txt' | 'zip' | 'obsidian'

const FORMATS: { id: ExportFormat; icon: string; name: string; ext: string; desc: string }[] = [
  { id: 'md', icon: '📝', name: '마크다운', ext: '.md', desc: '기본 형식. 다른 마크다운 앱(Typora 등)에서 그대로 열림' },
  { id: 'obsidian', icon: '🟣', name: 'Obsidian으로 보내기', ext: '앱·보관함', desc: '지금 문서를 Obsidian에서 바로 열거나, 모든 문서를 보관함 폴더로' },
  { id: 'obsidian-md', icon: '💜', name: 'Obsidian용 마크다운', ext: '.md', desc: '형광펜은 ==글자==, 글상자는 문서 끝 메모(콜아웃)로' },
  { id: 'docx', icon: '📘', name: 'Word 문서', ext: '.docx', desc: 'MS Word·한글·구글 문서에서 열기. 형광펜·밑줄·표·이미지 포함' },
  { id: 'pdf', icon: '📕', name: 'PDF', ext: '.pdf', desc: '보이는 화면 그대로 A4로. 글상자 포함, 손글씨는 선택' },
  { id: 'html', icon: '🌐', name: '웹 페이지', ext: '.html', desc: '브라우저로 열어 보거나 블로그에 붙여 넣기' },
  { id: 'txt', icon: '📄', name: '텍스트', ext: '.txt', desc: '서식 없이 글만. 자막·메모장·문자 메시지용' },
  { id: 'zip', icon: '🗂', name: '전체 문서 백업', ext: '.zip', desc: '모든 문서를 폴더 구조 그대로 마크다운 파일로 묶음' },
]

export function ExportDialog({ onPick, onClose }: { onPick: (f: ExportFormat) => void; onClose: () => void }) {
  return (
    <Modal title="다른 형식으로 저장" onClose={onClose} width={600}>
      <div className="tpl-grid export-grid">
        {FORMATS.map((f) => (
          <button key={f.id} className="tpl-card" onClick={() => onPick(f.id)}>
            <span className="tpl-icon">{f.icon}</span>
            <span className="tpl-name">
              {f.name} <span className="fmt-ext">{f.ext}</span>
            </span>
            <span className="tpl-desc">{f.desc}</span>
          </button>
        ))}
      </div>
      <p className="hint">손글씨(펜·형광펜·줄긋기)는 PDF에만 들어갑니다. 다른 형식에서는 글상자 내용이 문서 끝에 메모로 붙습니다.</p>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>닫기</button>
      </div>
    </Modal>
  )
}

interface ObsidianProps {
  vault: string
  sub: string
  dir: string
  docCount: number
  onChange: (v: { obsidianVault?: string; obsidianSub?: string; obsidianDir?: string }) => void
  onOpenCurrent: () => void
  onExportAll: () => void
  onClose: () => void
}

export function ObsidianDialog(p: ObsidianProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Obsidian으로 보내기" onClose={p.onClose} width={520}>
      <label className="field-label">보관함(vault) 이름</label>
      <input className="field" placeholder="Obsidian 왼쪽 아래에 보이는 이름 (비우면 마지막으로 연 보관함)" value={p.vault} onChange={(e) => p.onChange({ obsidianVault: e.target.value })} />
      <label className="field-label">보관함 안에 넣을 폴더</label>
      <input className="field" placeholder="(보관함 최상위)" value={p.sub} onChange={(e) => p.onChange({ obsidianSub: e.target.value })} />

      <div className="obs-section">
        <div className="obs-title">① 지금 문서 → Obsidian에서 바로 열기</div>
        <p className="hint">Obsidian이 설치된 기기에서 새 노트로 만들어 열립니다. 같은 이름의 노트가 있으면 새 내용으로 바뀝니다. 긴 문서는 클립보드를 거쳐 넘어갑니다.</p>
        <button className="btn primary" onClick={p.onOpenCurrent}>
          Obsidian에서 열기
        </button>
      </div>

      <div className="obs-section">
        <div className="obs-title">② 모든 문서({p.docCount}개) → 보관함 폴더에 저장</div>
        {canWriteFolder ? (
          <>
            <p className="hint">
              폴더 구조를 그대로 살려 <b>{p.sub || '보관함 최상위'}</b> 아래에 .md 파일로 저장합니다. 같은 이름의 파일은 덮어쓰므로, Obsidian에서 고친 노트가 있다면 먼저 확인하세요.
            </p>
            <div className="obs-row">
              <span className="obs-dir" title={p.dir}>
                {p.dir ? `📁 ${p.dir}` : '보관함 폴더를 아직 고르지 않았습니다'}
              </span>
              <button
                className="btn"
                onClick={async () => {
                  const d = await chooseVaultFolder()
                  if (d) p.onChange({ obsidianDir: d })
                }}
              >
                {p.dir ? '바꾸기' : '폴더 고르기'}
              </button>
            </div>
          </>
        ) : (
          <p className="hint">이 브라우저는 폴더에 직접 쓸 수 없어 ZIP 파일로 내려받습니다. 압축을 보관함 폴더에 풀면 됩니다. (Chrome·Edge 또는 데스크톱 앱에서는 바로 저장)</p>
        )}
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await p.onExportAll()
            } finally {
              setBusy(false)
            }
          }}
        >
          {canWriteFolder ? '모든 문서 보내기' : 'ZIP으로 내려받기'}
        </button>
      </div>
      <p className="hint">형광펜은 Obsidian 형식(==글자==)으로 바뀌고, 글상자는 문서 끝 메모로 붙습니다. 손글씨는 Obsidian에서 보이지 않습니다.</p>
      <div className="modal-actions">
        <button className="btn" onClick={p.onClose}>닫기</button>
      </div>
    </Modal>
  )
}
