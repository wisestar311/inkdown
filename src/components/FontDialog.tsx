import { useState } from 'react'
import { Modal } from './Dialog'
import { BODY_FONTS, CODE_FONTS, CUSTOM_PREFIX, FONT_FALLBACK, resolveFont } from '../lib/fonts'
import type { Settings } from '../lib/storage'

type FontSettings = Pick<Settings, 'bodyFont' | 'headingFont' | 'codeFont' | 'fontSize' | 'lineHeight'>

interface Props {
  value: FontSettings
  onChange: (v: FontSettings) => void
  onClose: () => void
}

function FontSelect({ label, value, options, allowSame, onChange }: { label: string; value: string; options: typeof BODY_FONTS; allowSame?: boolean; onChange: (v: string) => void }) {
  const isCustom = value.startsWith(CUSTOM_PREFIX)
  const [custom, setCustom] = useState(isCustom ? value.slice(CUSTOM_PREFIX.length) : '')
  return (
    <>
      <label className="field-label">{label}</label>
      <div className="font-row">
        <select className="field" value={isCustom ? '__custom' : value} onChange={(e) => (e.target.value === '__custom' ? onChange(`${CUSTOM_PREFIX}${custom}`) : onChange(e.target.value))}>
          {allowSame && <option value="same">본문과 같게</option>}
          {options.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
              {f.note ? ` — ${f.note}` : ''}
            </option>
          ))}
          <option value="__custom">직접 입력 (내 컴퓨터에 설치된 글꼴)</option>
        </select>
        {isCustom && (
          <input
            className="field"
            placeholder="예: 나눔스퀘어, KoPub바탕체"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value)
              onChange(`${CUSTOM_PREFIX}${e.target.value}`)
            }}
          />
        )}
      </div>
    </>
  )
}

export function FontDialog({ value, onChange, onClose }: Props) {
  const set = <K extends keyof FontSettings>(k: K, v: FontSettings[K]) => onChange({ ...value, [k]: v })
  const body = resolveFont(value.bodyFont, BODY_FONTS, FONT_FALLBACK.body)
  const heading = value.headingFont === 'same' ? body : resolveFont(value.headingFont, BODY_FONTS, FONT_FALLBACK.body)
  return (
    <Modal title="글꼴 및 문단" onClose={onClose} width={520}>
      <FontSelect label="본문 글꼴" value={value.bodyFont} options={BODY_FONTS} onChange={(v) => set('bodyFont', v)} />
      <FontSelect label="제목 글꼴" value={value.headingFont} options={BODY_FONTS} allowSame onChange={(v) => set('headingFont', v)} />
      <FontSelect label="코드 글꼴" value={value.codeFont} options={CODE_FONTS} onChange={(v) => set('codeFont', v)} />

      <div className="field-row two">
        <div>
          <label className="field-label">글자 크기 · {value.fontSize}px</label>
          <input type="range" min={12} max={28} step={1} value={value.fontSize} onChange={(e) => set('fontSize', Number(e.target.value))} />
        </div>
        <div>
          <label className="field-label">줄 간격 · {value.lineHeight.toFixed(2)}</label>
          <input type="range" min={1.3} max={2.4} step={0.05} value={value.lineHeight} onChange={(e) => set('lineHeight', Number(e.target.value))} />
        </div>
      </div>

      <div className="font-preview" style={{ fontFamily: body, fontSize: value.fontSize, lineHeight: value.lineHeight }}>
        <div style={{ fontFamily: heading, fontWeight: 700, fontSize: '1.4em', marginBottom: 6 }}>은퇴 후 현금 흐름 만들기</div>
        금리가 내려가면 예금 이자도 줄어듭니다. 지금부터 준비하면 늦지 않습니다. 0123456789 ABC abc
      </div>
      <p className="hint">글꼴 설정은 이 기기에만 적용됩니다. 문서 파일에는 저장되지 않아, 다른 기기에서는 그 기기의 글꼴 설정으로 보입니다.</p>

      <div className="modal-actions">
        <button
          className="btn"
          onClick={() => onChange({ bodyFont: 'system', headingFont: 'same', codeFont: 'system-mono', fontSize: 16, lineHeight: 1.75 })}
        >
          기본값
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={onClose}>
          완료
        </button>
      </div>
    </Modal>
  )
}
