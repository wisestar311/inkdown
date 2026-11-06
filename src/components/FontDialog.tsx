import { useState } from 'react'
import { Modal } from './Dialog'
import { BODY_FONTS, CODE_FONTS, CUSTOM_PREFIX, FONT_FALLBACK, resolveFont } from '../lib/fonts'
import type { Settings } from '../lib/storage'
import { HEADING_PRESETS, SWATCHES, validColor } from '../lib/headingColors'

type FontSettings = Pick<Settings, 'bodyFont' | 'headingFont' | 'codeFont' | 'fontSize' | 'lineHeight' | 'headingColors'>

interface Props {
  value: FontSettings
  onChange: (v: FontSettings) => void
  onClose: () => void
  syncAppearance: boolean
  onSyncAppearance: (on: boolean) => void
  caret: { width: number; color: string }
  onCaret: (c: { width: number; color: string }) => void
}

const CARET_WIDTHS = [
  { w: 1, label: '기본' },
  { w: 2, label: '조금 굵게' },
  { w: 3, label: '굵게' },
  { w: 4, label: '아주 굵게' },
]
const CARET_COLORS = ['#e5484d', '#f76b15', '#2f6fdf', '#12a150', '#8e4ec6', '#111111']

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

export function FontDialog({ value, onChange, onClose, syncAppearance, onSyncAppearance, caret, onCaret }: Props) {
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

      <label className="field-label">제목 색</label>
      <div className="hc-presets">
        {HEADING_PRESETS.map((p) => (
          <button key={p.name} className="btn small" onClick={() => set('headingColors', [...p.colors])}>
            {p.name}
          </button>
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const cur = validColor(value.headingColors[i])
        const setColor = (c: string) => set('headingColors', value.headingColors.map((x, j) => (j === i ? c : x)))
        return (
          <div key={i} className="hc-row">
            <span className="hc-label">제목 {i + 1}</span>
            <button className={`hc-swatch none ${!cur ? 'on' : ''}`} title="테마 기본색" onClick={() => setColor('')} />
            {SWATCHES.map((c) => (
              <button key={c} className={`hc-swatch ${cur.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => setColor(c)} />
            ))}
            <input className="hc-custom" type="color" title="직접 고르기" value={cur || '#1f2328'} onChange={(e) => setColor(e.target.value)} />
          </div>
        )
      })}

      <label className="field-label">커서 (이 기기만)</label>
      <div className="hc-row caret-row">
        {CARET_WIDTHS.map((c) => (
          <button key={c.w} className={`btn small ${caret.width === c.w ? 'primary' : ''}`} onClick={() => onCaret({ ...caret, width: c.w })}>
            <span className="caret-sample" style={{ width: c.w, background: validColor(caret.color) || 'var(--accent)' }} /> {c.label}
          </button>
        ))}
      </div>
      <div className="hc-row">
        <span className="hc-label">커서 색</span>
        <button className={`hc-swatch ${!validColor(caret.color) ? 'on' : ''}`} style={{ background: 'var(--accent)' }} title="강조색 (테마)" onClick={() => onCaret({ ...caret, color: '' })} />
        {CARET_COLORS.map((c) => (
          <button key={c} className={`hc-swatch ${caret.color.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} title={c} onClick={() => onCaret({ ...caret, color: c })} />
        ))}
        <input className="hc-custom" type="color" title="직접 고르기" value={validColor(caret.color) || '#2f6fdf'} onChange={(e) => onCaret({ ...caret, color: e.target.value })} />
      </div>

      <div className="font-preview" style={{ fontFamily: body, fontSize: value.fontSize, lineHeight: value.lineHeight }}>
        <div className="hc-preview" style={{ fontFamily: heading, fontWeight: 700, marginBottom: 6 }}>
          {[1, 2, 3, 4, 5, 6].map((n) => {
            const H = `h${n}` as 'h1'
            return (
              <H key={n} style={{ color: validColor(value.headingColors[n - 1]) || undefined }}>
                제목 {n} · 은퇴 후 현금 흐름 만들기
              </H>
            )
          })}
        </div>
        금리가 내려가면 예금 이자도 줄어듭니다. 지금부터 준비하면 늦지 않습니다. 0123456789 ABC abc
      </div>
      <p className="hint">글꼴·제목 색은 PDF·Word·HTML로 내보낼 때도 반영됩니다. 문서 파일 자체에는 들어가지 않습니다. 문서 파일에는 저장되지 않아, 다른 기기에서는 그 기기의 글꼴 설정으로 보입니다.</p>

      <label className="check-row" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={syncAppearance} onChange={(e) => onSyncAppearance(e.target.checked)} />
        글꼴·줄 간격·제목 색을 동기화된 모든 기기에 똑같이 적용 (글자 크기는 기기별, 끄면 모두 이 기기에서만)
      </label>
      <div className="modal-actions">
        <button
          className="btn"
          onClick={() => onChange({ bodyFont: 'system', headingFont: 'same', codeFont: 'system-mono', fontSize: 16, lineHeight: 1.75, headingColors: ['', '', '', '', '', ''] })}
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
