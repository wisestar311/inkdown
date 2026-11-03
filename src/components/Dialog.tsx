import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Modal({ title, children, onClose, width = 440 }: { title: string; children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title} style={{ width }}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export interface PromptRequest {
  title: string
  label?: string
  defaultValue?: string
  resolve: (v: string | null) => void
}

/** window.prompt 대체 (Electron은 prompt를 지원하지 않음) */
export function PromptDialog({ req, onDone }: { req: PromptRequest; onDone: () => void }) {
  const [value, setValue] = useState(req.defaultValue ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.select()
  }, [])
  const finish = (v: string | null) => {
    req.resolve(v)
    onDone()
  }
  return (
    <Modal title={req.title} onClose={() => finish(null)}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          finish(value)
        }}
      >
        {req.label && <label className="field-label">{req.label}</label>}
        <input ref={inputRef} className="field" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => finish(null)}>취소</button>
          <button type="submit" className="btn primary">확인</button>
        </div>
      </form>
    </Modal>
  )
}
