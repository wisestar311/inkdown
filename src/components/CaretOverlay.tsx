/* 굵고 눈에 잘 띄는 커서.
   편집기 DOM은 건드리지 않고(한글 입력 조합 보호) 화면 위에 막대를 따로 그린다.
   원래 커서도 같은 색으로 남겨 두어, 위치를 못 구하는 경우에도 커서가 사라지지 않는다. */
import { useEffect, useState } from 'react'

interface Box {
  x: number
  y: number
  h: number
  n: number
}

function caretBox(): Omit<Box, 'n'> | null {
  const b = rawBox()
  if (!b) return null
  // 스크롤해서 편집 영역 밖(메뉴·상태 표시줄 위치)으로 나가면 그리지 않음
  const area = document.querySelector('.editor-scroll')?.getBoundingClientRect()
  if (area && (b.y + b.h <= area.top || b.y >= area.bottom)) return null
  return b
}

function rawBox(): Omit<Box, 'n'> | null {
  const sel = document.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null
  const node = sel.focusNode
  const el = node instanceof Element ? node : node?.parentElement
  const pm = el?.closest('.ProseMirror')
  // 코드 블록(자체 커서가 있음)·다른 입력란은 제외
  if (!pm || document.activeElement !== pm) return null
  const range = sel.getRangeAt(0)
  const r = [...range.getClientRects()].find((x) => x.height > 0) ?? range.getBoundingClientRect()
  if (r && r.height > 0) return { x: r.left, y: r.top, h: r.height }
  // 빈 줄: 그 줄(블록)의 왼쪽 위에 글자 높이만큼
  const block = (el?.closest('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote') ?? el) as HTMLElement | null
  if (!block) return null
  const b = block.getBoundingClientRect()
  const cs = getComputedStyle(block)
  const fs = Number.parseFloat(cs.fontSize) || 16
  const lh = Number.parseFloat(cs.lineHeight) || fs * 1.6
  const h = Math.min(lh, fs * 1.35)
  const left = cs.textAlign === 'center' ? b.left + b.width / 2 : cs.textAlign === 'right' ? b.right - Number.parseFloat(cs.paddingRight) : b.left + Number.parseFloat(cs.paddingLeft)
  return { x: left, y: b.top + Number.parseFloat(cs.paddingTop) + (lh - h) / 2, h }
}

export function CaretOverlay({ width }: { width: number }) {
  const [box, setBox] = useState<Box | null>(null)
  useEffect(() => {
    let raf = 0
    const update = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const b = caretBox()
        setBox((cur) => {
          if (!b) return null
          if (cur && cur.x === b.x && cur.y === b.y && cur.h === b.h) return cur
          return { ...b, n: (cur?.n ?? 0) + 1 } // 움직이면 깜빡임을 처음부터 (움직이는 동안은 계속 보임)
        })
      })
    }
    const evs: [EventTarget, string, boolean][] = [
      [document, 'selectionchange', false],
      [document, 'focusin', false],
      [document, 'focusout', false],
      [document, 'input', true],
      [window, 'scroll', true],
      [window, 'resize', false],
    ]
    for (const [t, e, c] of evs) t.addEventListener(e, update, c)
    const ro = new ResizeObserver(update)
    const pm = document.querySelector('.ProseMirror')
    if (pm) ro.observe(pm)
    update()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      for (const [t, e, c] of evs) t.removeEventListener(e, update, c)
    }
  }, [])
  if (!box) return null
  return <div key={box.n} className="caret-overlay" aria-hidden style={{ left: Math.round(box.x - width / 2), top: Math.round(box.y), height: Math.round(box.h), width }} />
}
