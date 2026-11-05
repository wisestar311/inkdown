/* 표 열 폭·그림·머메이드 도표 크기 조절
   - 표: 열 경계를 끌면 폭이 바뀜, 더블클릭하면 자동 폭으로
   - 그림·도표: 오른쪽 아래 손잡이를 끌면 폭이 바뀜(비율 유지), 더블클릭하면 원래 크기로
   크기는 마크다운에 담을 수 없어 문서 끝 숨은 메모(필기와 같은 곳)에 저장되고, 동기화도 함께 된다.
   편집기 DOM은 건드리지 않고 nth-child 스타일 규칙으로만 적용해 ProseMirror와 충돌하지 않는다. */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { type LayoutItem, resolveLayout } from '../lib/ink'
import { hashText } from '../lib/storage'
import { isLabelColumn } from '../lib/tableStyle'

type Kind = LayoutItem['kind']

interface Found {
  kind: Kind
  /** .ProseMirror 안의 몇 번째 자식인지 (nth-child용, 1부터) */
  nth: number
  print: string
  /** 페이지 기준 좌표 */
  box: { x: number; y: number; w: number; h: number }
  /** 표: 머리글 칸의 오른쪽 경계(페이지 기준 x)와 현재 폭 */
  cols?: { right: number; width: number }[]
  /** 표: 첫 열이 '구분' 열로 보이는지 (자동 판단) */
  autoFirstCol?: boolean
}

interface Props {
  page: () => HTMLElement | null
  layout: LayoutItem[]
  onChange: (layout: LayoutItem[]) => void
  /** 필기 모드 중에는 손잡이를 숨김 */
  hidden: boolean
}

const fp = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)

function scan(root: HTMLElement): { found: Found[]; pmWidth: number } {
  const pm = root.querySelector('.ProseMirror')
  if (!pm) return { found: [], pmWidth: 0 }
  const base = root.getBoundingClientRect()
  const rel = (r: DOMRect) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height })
  const found: Found[] = []
  ;[...pm.children].forEach((el, idx) => {
    const nth = idx + 1
    // 실제 내용(편집 가능한 tbody)을 가진 표만 — 끌기 미리보기용 숨은 표는 제외
    const table = el.querySelector('tbody.content-dom')?.closest('table') ?? null
    if (el.classList.contains('milkdown-table-block') && table) {
      const head = table.querySelector('tr')
      const cells = head ? [...head.children] : []
      const rows = [...table.querySelectorAll('tr')].slice(1).map((tr) => [...tr.children].map((c) => c.textContent ?? ''))
      found.push({
        autoFirstCol: isLabelColumn(cells.map((c) => c.textContent ?? ''), rows),
        kind: 'table',
        nth,
        print: fp(head?.textContent),
        box: rel(table.getBoundingClientRect()),
        cols: cells.map((c) => {
          const r = c.getBoundingClientRect()
          return { right: r.right - base.left, width: r.width }
        }),
      })
      return
    }
    const img = el.classList.contains('milkdown-image-block') ? el.querySelector<HTMLImageElement>('.image-wrapper img') : null
    if (img && img.getAttribute('src')) {
      found.push({ kind: 'image', nth, print: hashText(img.getAttribute('src')!), box: rel(img.getBoundingClientRect()) })
      return
    }
    const preview = el.querySelector<HTMLElement>('.mermaid-preview')
    const svg = preview?.querySelector('svg')
    if (preview && svg) found.push({ kind: 'mermaid', nth, print: preview.dataset.code ?? '', box: rel(svg.getBoundingClientRect()) })
  })
  return { found, pmWidth: pm.getBoundingClientRect().width }
}

/** 저장된 크기를 지금 화면의 블록에 연결 */
function match(layout: LayoutItem[], found: Found[]) {
  const map = new Map<Found, LayoutItem>()
  for (const kind of ['table', 'image', 'mermaid'] as Kind[]) {
    const list = found.filter((f) => f.kind === kind)
    const prints = list.map((f) => f.print)
    for (const item of layout.filter((l) => l.kind === kind)) {
      const i = resolveLayout(item, prints)
      if (i >= 0 && !map.has(list[i]!)) map.set(list[i]!, item)
    }
  }
  return map
}

function firstColCss(f: Found, item: LayoutItem | undefined): string {
  const on = item?.firstCol ?? f.autoFirstCol
  if (f.kind !== 'table' || !on) return ''
  return `.ProseMirror > :nth-child(${f.nth}) table tr:not([data-is-header]) > :first-child { background: var(--table-col-head) !important; font-weight: 600; }`
}

function cssFor(f: Found, item: LayoutItem): string {
  const sel = `.ProseMirror > :nth-child(${f.nth})`
  if (f.kind === 'table' && item.cols?.length) {
    const total = item.cols.reduce((s, w) => s + w, 0)
    return (
      `${sel} table { width: ${total}px !important; min-width: 0 !important; }` +
      item.cols.map((w, j) => `${sel} table tr > :nth-child(${j + 1}) { width: ${w}px !important; min-width: ${w}px !important; max-width: ${w}px !important; }`).join('')
    )
  }
  if (f.kind === 'image' && item.w) return `${sel} .image-wrapper { width: ${item.w}px !important; max-width: 100% !important; } ${sel} .image-wrapper img { width: 100% !important; height: auto !important; }`
  if (f.kind === 'mermaid' && item.w) return `${sel} .mermaid-preview svg { width: ${item.w}px !important; max-width: 100% !important; height: auto !important; }`
  return ''
}

export function LayoutLayer({ page, layout, onChange, hidden }: Props) {
  const [found, setFound] = useState<Found[]>([])
  const [pmWidth, setPmWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)
  const [draft, setDraft] = useState<{ found: Found; item: LayoutItem } | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const foundRef = useRef(found)
  foundRef.current = found

  const measure = useCallback(() => {
    const root = page()
    if (!root) return
    const r = scan(root)
    setFound((prev) => (JSON.stringify(prev) === JSON.stringify(r.found) ? prev : r.found))
    setPmWidth(r.pmWidth)
  }, [page])

  // 부모(.page)의 ref가 붙은 뒤에 실행되도록 useEffect 사용
  useEffect(() => {
    const root = page()
    if (!root) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const ro = new ResizeObserver(schedule)
    const mo = new MutationObserver(schedule)
    const start = setInterval(() => {
      const pm = root.querySelector('.ProseMirror')
      if (!pm) return
      clearInterval(start)
      ro.observe(pm)
      mo.observe(pm, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'class'] })
      schedule()
    }, 50)
    ro.observe(root)
    // 마우스가 올라간 표·그림·도표에만 손잡이 표시
    const onMove = (e: MouseEvent) => {
      const base = root.getBoundingClientRect()
      const x = e.clientX - base.left
      const y = e.clientY - base.top
      const list = foundRef.current
      const i = list.findIndex((f) => x >= f.box.x - 12 && x <= f.box.x + f.box.w + 16 && y >= f.box.y - (f.kind === 'table' ? 34 : 8) && y <= f.box.y + f.box.h + 16)
      setHover(i >= 0 ? list[i]!.nth : null)
    }
    // 표 안의 다른 기능이 이벤트를 막아도 받을 수 있게 창 단위·캡처 단계에서 듣는다
    window.addEventListener('pointermove', onMove, { passive: true, capture: true })
    return () => {
      clearInterval(start)
      cancelAnimationFrame(frame)
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener('pointermove', onMove, { capture: true })
    }
  }, [measure, page])

  const matched = useMemo(() => match(layout, found), [layout, found])
  const kindIndex = (f: Found) => found.filter((x) => x.kind === f.kind).indexOf(f)

  const css = useMemo(() => {
    const rules: string[] = []
    for (const f of found) {
      const item = draft && draft.found.nth === f.nth ? draft.item : matched.get(f)
      if (item) rules.push(cssFor(f, item))
      rules.push(firstColCss(f, item))
    }
    return rules.join('\n')
  }, [draft, found, matched])

  const save = (f: Found, item: LayoutItem | null) => {
    const old = matched.get(f)
    const rest = layoutRef.current.filter((l) => l !== old)
    onChange(item ? [...rest, item] : rest)
  }

  const startDrag = (e: RPointerEvent, f: Found, col?: number) => {
    e.preventDefault()
    e.stopPropagation()
    const sx = e.clientX
    const base: LayoutItem = { kind: f.kind, i: kindIndex(f), f: f.print }
    const startCols = matched.get(f)?.cols ?? f.cols?.map((c) => Math.round(c.width)) ?? []
    const startW = Math.round(f.box.w)
    let current: LayoutItem = base
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      if (f.kind === 'table' && col !== undefined) {
        const cols = [...startCols]
        if (col < cols.length - 1) {
          // 열 사이 경계: 왼쪽 열이 넓어진 만큼 오른쪽 열이 줄어듦 (표 전체 폭은 그대로)
          const pair = startCols[col]! + startCols[col + 1]!
          const left = Math.max(40, Math.min(pair - 40, Math.round(startCols[col]! + dx)))
          cols[col] = left
          cols[col + 1] = pair - left
        } else {
          // 맨 오른쪽 경계: 표 전체 폭 조절 (본문 폭까지)
          const others = startCols.reduce((sum, w, k) => (k === col ? sum : sum + w), 0)
          cols[col] = Math.max(40, Math.min(Math.round(pmWidth - others), Math.round(startCols[col]! + dx)))
        }
        current = { ...base, cols }
      } else current = { ...base, w: Math.max(60, Math.min(Math.round(pmWidth), Math.round(startW + dx))) }
      setDraft({ found: f, item: current })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDraft(null)
      if (current !== base) save(f, current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const reset = (f: Found) => save(f, null)

  // 한글(한컴)처럼 키보드로 열 폭 조절: 커서가 표 칸 안에 있을 때
  //   Alt+←/→        : 표 전체 폭은 그대로, 지금 열만 (옆 열이 반대로)
  //   Ctrl+Alt+←/→   : 지금 열과 표 전체 폭을 함께
  //   Shift를 더하면 1px씩, 아니면 10px씩
  const keyState = useRef({ found, matched, pmWidth, save, kindIndex })
  keyState.current = { found, matched, pmWidth, save, kindIndex }
  const badgeTimer = useRef(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (hidden || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.metaKey) return
      const node = document.getSelection()?.anchorNode
      const el = node instanceof Element ? node : node?.parentElement
      const cell = el?.closest('td, th')
      const block = cell?.closest('.milkdown-table-block')
      const pm = block?.parentElement
      if (!cell || !block || !pm?.classList.contains('ProseMirror')) return
      const { found: list, matched: m, pmWidth: maxW, save: doSave, kindIndex: kIndex } = keyState.current
      const nth = [...pm.children].indexOf(block) + 1
      const f = list.find((x) => x.nth === nth && x.kind === 'table')
      if (!f?.cols?.length) return
      e.preventDefault()
      e.stopPropagation()
      const col = [...cell.parentElement!.children].indexOf(cell)
      const step = (e.shiftKey ? 1 : 10) * (e.key === 'ArrowRight' ? 1 : -1)
      const item = m.get(f)
      const cols = [...(item?.cols ?? f.cols.map((c) => Math.round(c.width)))]
      if (e.ctrlKey) {
        const total = cols.reduce((a, b) => a + b, 0)
        cols[col] = Math.max(40, cols[col]! + Math.min(step, maxW - total))
      } else {
        const other = col < cols.length - 1 ? col + 1 : col - 1
        if (other < 0) return
        const pair = cols[col]! + cols[other]!
        cols[col] = Math.max(40, Math.min(pair - 40, cols[col]! + step))
        cols[other] = pair - cols[col]!
      }
      const next: LayoutItem = { ...(item ?? { kind: 'table', i: kIndex(f), f: f.print }), cols }
      doSave(f, next)
      setDraft({ found: f, item: next })
      window.clearTimeout(badgeTimer.current)
      badgeTimer.current = window.setTimeout(() => setDraft(null), 900)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hidden])

  return (
    <div className="layout-layer">
      <style>{css}</style>
      {!hidden &&
        found.map((f) => {
          const show = hover === f.nth || draft?.found.nth === f.nth
          if (!show) return null
          if (f.kind === 'table') {
            const item = matched.get(f)
            const on = item?.firstCol ?? f.autoFirstCol
            return [
              <button
                key={`${f.nth}-fc`}
                className="table-tool"
                style={{ left: f.box.x, top: Math.max(0, f.box.y - 26) }}
                title="첫 열을 '구분' 열로 강조할지 정합니다 (처음에는 자동 판단)"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => save(f, { ...(item ?? { kind: 'table', i: kindIndex(f), f: f.print }), firstCol: !on })}
              >
                {on ? '첫 열 강조 끄기' : '첫 열 강조 켜기'}
              </button>,
              ...(f.cols ?? []).map((c, j) => (
              <div
                key={`${f.nth}-${j}`}
                className="col-handle"
                style={{ left: c.right - 4, top: f.box.y, height: f.box.h }}
                title="끌어서 열 폭 조절 · 더블클릭하면 자동 폭"
                onPointerDown={(e) => startDrag(e, f, j)}
                onDoubleClick={() => save(f, matched.get(f)?.firstCol !== undefined ? { ...matched.get(f)!, cols: undefined } : null)}
              />
            )),
            ]
          }
          return (
            <div
              key={f.nth}
              className="size-handle"
              style={{ left: f.box.x + f.box.w - 9, top: f.box.y + f.box.h - 9 }}
              title="끌어서 크기 조절 · 더블클릭하면 원래 크기"
              onPointerDown={(e) => startDrag(e, f)}
              onDoubleClick={() => reset(f)}
            />
          )
        })}
      {draft && (draft.item.w || draft.item.cols) && (
        <div className="size-badge" style={{ left: draft.found.box.x, top: Math.max(0, draft.found.box.y - 26) }}>
          {draft.item.w ? `${draft.item.w}px` : draft.item.cols!.map((w) => `${w}`).join(' · ')}
        </div>
      )}
    </div>
  )
}
