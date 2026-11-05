/* 필기 레이어: 문서 위에 펜 손글씨·형광펜·직선(줄긋기)·글상자를 얹는다.
   마우스·터치·스타일러스(필압 지원) 모두 Pointer Events로 처리한다. */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { getStroke } from 'perfect-freehand'
import { type Anchor, type InkBox, type InkData, type InkStroke, blockAt, fingerprint, newInkId, resolveAnchor } from '../lib/ink'

export type InkTool = 'pen' | 'marker' | 'line' | 'text' | 'eraser'

export interface InkToolState {
  tool: InkTool
  color: string
  size: number
}

export const PEN_COLORS = ['auto', '#e5484d', '#2f6fde', '#1f9d63', '#e8890c', '#8e4ec6']
export const MARKER_COLORS = ['#ffd60a', '#7ee787', '#ff8fb1', '#79c0ff']
export const PEN_SIZES = [2, 3.5, 6]
export const MARKER_SIZES = [12, 18, 26]

export interface InkHandle {
  undo: () => boolean
  clear: () => void
}

interface Layout {
  prints: string[]
  tops: number[]
  left: number
  width: number
  height: number
}

interface Props {
  page: () => HTMLElement | null
  ink: InkData
  onChange: (ink: InkData) => void
  active: boolean
  tool: InkToolState
}

const colorOf = (c: string) => (c === 'auto' ? 'var(--ink-auto)' : c)

function outlinePath(pts: number[][]): string {
  if (!pts.length) return ''
  const d: (string | number)[] = ['M', pts[0]![0]!, pts[0]![1]!, 'Q']
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[(i + 1) % pts.length]!
    d.push(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2)
  }
  d.push('Z')
  return d.map((v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)).join(' ')
}

function triples(flat: number[]): number[][] {
  const out: number[][] = []
  for (let i = 0; i + 2 < flat.length; i += 3) out.push([flat[i]!, flat[i + 1]!, flat[i + 2]!])
  return out
}

/** 획 모양(획 시작 블록 기준 좌표) — 획마다 한 번만 계산 */
const pathCache = new Map<string, string>()
function strokePath(s: Pick<InkStroke, 'id' | 'kind' | 'size' | 'pts'>, live = false): string {
  const key = `${s.id}:${s.pts.length}`
  if (!live && pathCache.has(key)) return pathCache.get(key)!
  const pts = triples(s.pts)
  let d = ''
  if (s.kind === 'pen') {
    const pressured = pts.some((p) => p[2] !== 0.5)
    d = outlinePath(getStroke(pts, { size: s.size * 2, thinning: 0.55, smoothing: 0.5, streamline: 0.45, simulatePressure: !pressured, last: !live }))
  } else {
    d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')
  }
  if (!live) pathCache.set(key, d)
  return d
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** 획이 차지하는 영역(획 기준 좌표, 굵기 여유 포함) */
function bbox(s: InkStroke) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i + 2 < s.pts.length; i += 3) {
    x0 = Math.min(x0, s.pts[i]!)
    x1 = Math.max(x1, s.pts[i]!)
    y0 = Math.min(y0, s.pts[i + 1]!)
    y1 = Math.max(y1, s.pts[i + 1]!)
  }
  const pad = s.size * 1.5 + 2
  return { x: Math.floor(x0 - pad), y: Math.floor(y0 - pad), w: Math.ceil(x1 - x0 + pad * 2) + 1, h: Math.ceil(y1 - y0 + pad * 2) + 1 }
}

export const InkLayer = forwardRef<InkHandle, Props>(function InkLayer({ page, ink, onChange, active, tool }, ref) {
  const [layout, setLayout] = useState<Layout>({ prints: [], tops: [], left: 0, width: 0, height: 0 })
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const inkRef = useRef(ink)
  inkRef.current = ink
  const history = useRef<InkData[]>([])
  const [live, setLive] = useState<{ kind: InkStroke['kind']; pts: number[] } | null>(null)
  const drawing = useRef<{ kind: InkStroke['kind']; pts: number[]; pointerId: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  // ---------- 블록 위치 측정 ----------
  const measure = useCallback(() => {
    const root = page()
    const pm = root?.querySelector('.ProseMirror')
    if (!root || !pm) return
    const base = root.getBoundingClientRect()
    const blocks = [...pm.children].filter((el) => !el.classList.contains('prosemirror-virtual-cursor'))
    const pmRect = pm.getBoundingClientRect()
    const next: Layout = {
      prints: blocks.map(fingerprint),
      tops: blocks.map((b) => b.getBoundingClientRect().top - base.top),
      left: pmRect.left - base.left,
      width: pmRect.width,
      height: root.scrollHeight,
    }
    const prev = layoutRef.current
    if (prev.height !== next.height || prev.left !== next.left || prev.width !== next.width || prev.tops.join() !== next.tops.join() || prev.prints.join('\u0001') !== next.prints.join('\u0001')) setLayout(next)
  }, [page])

  useLayoutEffect(() => {
    const root = page()
    if (!root) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // 편집기가 처음 그려질 때까지 잠시 기다림
    const start = setInterval(() => {
      const pm = root.querySelector('.ProseMirror')
      if (!pm) return
      clearInterval(start)
      ro.observe(pm)
      mo.observe(pm, { childList: true, subtree: true, characterData: true })
      schedule()
    }, 50)
    const ro = new ResizeObserver(schedule)
    const mo = new MutationObserver(schedule)
    ro.observe(root)
    window.addEventListener('resize', schedule)
    return () => {
      clearInterval(start)
      cancelAnimationFrame(frame)
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [measure, page])

  const origin = useCallback((a: Anchor) => {
    const l = layoutRef.current
    const i = resolveAnchor(a, l.prints)
    return { x: l.left, y: i >= 0 ? l.tops[i]! : 0 }
  }, [])

  const anchorFor = useCallback((y: number): Anchor => {
    const l = layoutRef.current
    const b = blockAt(y, l.tops)
    return { b, f: l.prints[b] ?? '' }
  }, [])

  // ---------- 변경 + 실행 취소 ----------
  const commit = useCallback(
    (next: InkData) => {
      history.current.push(inkRef.current)
      if (history.current.length > 100) history.current.shift()
      inkRef.current = next
      onChange(next)
    },
    [onChange],
  )

  useImperativeHandle(ref, () => ({
    undo() {
      const prev = history.current.pop()
      if (!prev) return false
      inkRef.current = prev
      onChange(prev)
      return true
    },
    clear() {
      commit({ ...inkRef.current, strokes: [], boxes: [] })
    },
  }))

  // ---------- 포인터 ----------
  const local = (e: RPointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5 }
  }

  const eraseAt = (x: number, y: number) => {
    const cur = inkRef.current
    const hit = (s: InkStroke) => {
      const o = origin(s.a)
      const r = Math.max(8, s.size / 1.5)
      const pts = triples(s.pts)
      for (let i = 0; i < pts.length; i++) {
        const ax = pts[i]![0]! + o.x
        const ay = pts[i]![1]! + o.y
        const b = pts[i + 1] ?? pts[i]!
        const bx = b[0]! + o.x
        const by = b[1]! + o.y
        const dx = bx - ax
        const dy = by - ay
        const t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0
        if (Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) < r) return true
      }
      return false
    }
    const keep = cur.strokes.filter((s) => !hit(s))
    if (keep.length !== cur.strokes.length) commit({ ...cur, strokes: keep })
  }

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!active || e.button > 0) return
    const { x, y, p } = local(e)
    if (tool.tool === 'text') {
      if (editing) {
        setEditing(null)
        return
      }
      const a = anchorFor(y)
      const o = origin(a)
      const box: InkBox = { id: newInkId(), a, x: r1(x - o.x), y: r1(y - o.y), w: 220, text: '', color: tool.color === 'auto' ? 'auto' : tool.color }
      commit({ ...inkRef.current, boxes: [...inkRef.current.boxes, box] })
      setEditing(box.id)
      e.preventDefault()
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool.tool === 'eraser') {
      drawing.current = { kind: 'pen', pts: [], pointerId: e.pointerId }
      eraseAt(x, y)
      return
    }
    drawing.current = { kind: tool.tool, pts: [x, y, p], pointerId: e.pointerId }
    setLive({ kind: tool.tool, pts: [x, y, p] })
  }

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    const { x, y, p } = local(e)
    if (tool.tool === 'eraser') return eraseAt(x, y)
    if (d.kind === 'line') d.pts = [d.pts[0]!, d.pts[1]!, d.pts[2]!, x, y, p]
    else {
      // 너무 촘촘한 점은 건너뜀
      const lx = d.pts[d.pts.length - 3]!
      const ly = d.pts[d.pts.length - 2]!
      if (Math.hypot(x - lx, y - ly) < 1.2) return
      d.pts.push(x, y, p)
    }
    setLive({ kind: d.kind, pts: [...d.pts] })
  }

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drawing.current
    if (!d || d.pointerId !== e.pointerId) return
    drawing.current = null
    setLive(null)
    if (tool.tool === 'eraser') return
    if (d.pts.length < 6) {
      if (d.kind === 'line') return
      d.pts.push(d.pts[0]! + 0.5, d.pts[1]! + 0.5, d.pts[2]!) // 콕 찍은 점
    }
    let pts = d.pts
    if (d.kind === 'line') {
      // 거의 수평·수직이면 반듯하게
      const [x0, y0, p0, x1, y1, p1] = pts as [number, number, number, number, number, number]
      const ang = Math.abs((Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI)
      if (ang < 7 || ang > 173) pts = [x0, y0, p0, x1, y0, p1]
      else if (Math.abs(ang - 90) < 7) pts = [x0, y0, p0, x0, y1, p1]
    }
    const ys = pts.filter((_, i) => i % 3 === 1)
    const a = anchorFor(Math.min(...ys))
    const o = origin(a)
    const rel = pts.map((v, i) => (i % 3 === 0 ? r1(v - o.x) : i % 3 === 1 ? r1(v - o.y) : Math.round(v * 100) / 100))
    const stroke: InkStroke = { id: newInkId(), kind: d.kind, color: tool.color, size: tool.size, a, pts: rel }
    commit({ ...inkRef.current, strokes: [...inkRef.current.strokes, stroke] })
  }

  // ---------- 글상자 ----------
  const updateBox = (id: string, patch: Partial<InkBox>, record = true) => {
    const cur = inkRef.current
    const next = { ...cur, boxes: cur.boxes.map((b) => (b.id === id ? { ...b, ...patch } : b)) }
    if (record) commit(next)
    else {
      inkRef.current = next
      onChange(next)
    }
  }

  const startDrag = (e: RPointerEvent, box: InkBox, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    const o = origin(box.a)
    const sx = e.clientX
    const sy = e.clientY
    const start = { x: box.x + o.x, y: box.y + o.y, w: box.w }
    history.current.push(inkRef.current)
    const move = (ev: PointerEvent) => {
      if (mode === 'resize') return updateBox(box.id, { w: Math.max(80, r1(start.w + ev.clientX - sx)) }, false)
      const px = start.x + ev.clientX - sx
      const py = start.y + ev.clientY - sy
      const a = anchorFor(py)
      const no = origin(a)
      updateBox(box.id, { a, x: r1(px - no.x), y: r1(py - no.y) }, false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    if (!active) setEditing(null)
  }, [active])

  const cursor = tool.tool === 'text' ? 'text' : tool.tool === 'eraser' ? 'cell' : 'crosshair'

  return (
    <div className={`ink-layer ${active ? 'active' : ''}`} style={{ height: layout.height || undefined }}>
      {/* 획마다 작은 SVG로 그림 → 인쇄(PDF) 때 페이지 경계에서 통째로 잘리지 않음 */}
      {ink.strokes.map((s) => {
        const o = origin(s.a)
        const b = bbox(s)
        return (
          <svg
            key={s.id}
            className="ink-stroke"
            style={{ left: o.x + b.x, top: o.y + b.y }}
            width={b.w}
            height={b.h}
            viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
            aria-hidden
          >
            {s.kind === 'pen' ? (
              <path d={strokePath(s)} fill={colorOf(s.color)} />
            ) : (
              <path
                d={strokePath(s)}
                fill="none"
                stroke={colorOf(s.color)}
                strokeWidth={s.size}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={s.kind === 'marker' ? 'ink-marker' : undefined}
              />
            )}
          </svg>
        )
      })}
      {live && (
        <svg className="ink-svg" width="100%" height={layout.height || '100%'} aria-hidden>
          {live.kind === 'pen' ? (
            <path d={strokePath({ id: 'live', kind: 'pen', size: tool.size, pts: live.pts }, true)} fill={colorOf(tool.color)} />
          ) : (
            <path
              d={strokePath({ id: 'live', kind: live.kind, size: tool.size, pts: live.pts }, true)}
              fill="none"
              stroke={colorOf(tool.color)}
              strokeWidth={tool.size}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={live.kind === 'marker' ? 'ink-marker' : undefined}
            />
          )}
        </svg>
      )}

      {active && (
        <div
          className="ink-capture"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}

      {ink.boxes.map((b) => {
        const o = origin(b.a)
        const isEditing = active && editing === b.id
        return (
          <div
            key={b.id}
            className={`ink-box ${active ? 'editable' : ''} ${isEditing ? 'editing' : ''}`}
            style={{ left: o.x + b.x, top: o.y + b.y, width: b.w, borderColor: colorOf(b.color), color: colorOf(b.color) }}
            onPointerDown={(e) => {
              if (!active) return
              e.stopPropagation()
              setEditing(b.id)
            }}
          >
            {active && (
              <div className="ink-box-bar" onPointerDown={(e) => startDrag(e, b, 'move')} title="끌어서 이동">
                <span>⠿</span>
                <button
                  title="글상자 삭제"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => commit({ ...inkRef.current, boxes: inkRef.current.boxes.filter((x) => x.id !== b.id) })}
                >
                  ×
                </button>
              </div>
            )}
            {isEditing ? (
              <BoxEditor
                text={b.text}
                onStart={() => history.current.push(inkRef.current)}
                onInput={(text) => updateBox(b.id, { text }, false)}
                onDone={() => setEditing(null)}
              />
            ) : (
              <div className="ink-box-text">{b.text || (active ? '글을 입력하세요' : '')}</div>
            )}
            {active && <div className="ink-box-resize" onPointerDown={(e) => startDrag(e, b, 'resize')} title="너비 조절" />}
          </div>
        )
      })}
    </div>
  )
})

/** 글상자 입력: 입력하는 즉시 저장 (다른 곳을 눌러도 내용이 사라지지 않음) */
function BoxEditor({ text, onStart, onInput, onDone }: { text: string; onStart: () => void; onInput: (t: string) => void; onDone: () => void }) {
  const [value, setValue] = useState(text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  useEffect(() => {
    onStart()
    const el = ref.current
    el?.focus()
    el?.setSelectionRange(el.value.length, el.value.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <textarea
      ref={ref}
      className="ink-box-input"
      value={value}
      placeholder="글을 입력하세요"
      onChange={(e) => {
        setValue(e.target.value)
        onInput(e.target.value)
      }}
      onBlur={onDone}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
      }}
    />
  )
}

// ---------- 도구 모음 ----------
interface ToolbarProps {
  state: InkToolState
  onChange: (s: InkToolState) => void
  onUndo: () => void
  onClear: () => void
  onClose: () => void
}

const TOOLS: { id: InkTool; label: string; icon: string }[] = [
  { id: 'pen', label: '펜 (손글씨)', icon: '✎' },
  { id: 'marker', label: '형광펜', icon: '▮' },
  { id: 'line', label: '직선 (줄긋기)', icon: '╱' },
  { id: 'text', label: '글상자', icon: 'T' },
  { id: 'eraser', label: '지우개', icon: '⌫' },
]

export function InkToolbar({ state, onChange, onUndo, onClear, onClose }: ToolbarProps) {
  const isMarker = state.tool === 'marker'
  const colors = isMarker ? MARKER_COLORS : PEN_COLORS
  const sizes = isMarker ? MARKER_SIZES : PEN_SIZES
  const pick = (tool: InkTool) => {
    const marker = tool === 'marker'
    const wasMarker = state.tool === 'marker'
    if (marker === wasMarker) return onChange({ ...state, tool })
    onChange({ tool, color: marker ? MARKER_COLORS[0]! : PEN_COLORS[0]!, size: marker ? MARKER_SIZES[1]! : PEN_SIZES[1]! })
  }
  return (
    <div className="ink-toolbar" role="toolbar" aria-label="필기 도구" onPointerDown={(e) => e.preventDefault()}>
      {TOOLS.map((t) => (
        <button key={t.id} className={`ink-btn ${state.tool === t.id ? 'on' : ''}`} title={t.label} onClick={() => pick(t.id)}>
          <span className={`ink-icon ink-icon-${t.id}`}>{t.icon}</span>
        </button>
      ))}
      {state.tool !== 'eraser' && (
        <>
          <span className="ink-sep" />
          {colors.map((c) => (
            <button
              key={c}
              className={`ink-color ${state.color === c ? 'on' : ''}`}
              style={{ background: colorOf(c) }}
              title={c === 'auto' ? '기본색' : c}
              onClick={() => onChange({ ...state, color: c })}
            />
          ))}
        </>
      )}
      {(state.tool === 'pen' || state.tool === 'marker' || state.tool === 'line') && (
        <>
          <span className="ink-sep" />
          {sizes.map((s, i) => (
            <button key={s} className={`ink-btn ${state.size === s ? 'on' : ''}`} title={['가늘게', '보통', '굵게'][i]} onClick={() => onChange({ ...state, size: s })}>
              <span className="ink-dot" style={{ width: Math.min(18, 3 + s * (isMarker ? 0.5 : 1.6)), height: Math.min(18, 3 + s * (isMarker ? 0.5 : 1.6)) }} />
            </button>
          ))}
        </>
      )}
      <span className="ink-sep" />
      <button className="ink-btn" title="실행 취소 (Ctrl+Z)" onClick={onUndo}>↶</button>
      <button className="ink-btn" title="이 문서의 필기 모두 지우기" onClick={onClear}>🗑</button>
      <button className="ink-done" onClick={onClose}>완료</button>
    </div>
  )
}
