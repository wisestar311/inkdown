/* 필기(펜·형광펜·직선·글상자) 데이터.
   - 문서 맨 끝의 HTML 주석 한 줄에 저장 → 마크다운 본문은 그대로이고, 다른 편집기에서는 보이지 않으며, 동기화도 함께 된다.
   - 각 필기는 가장 가까운 문단(블록)에 고정된다. 위쪽 문단을 고쳐도 필기가 해당 문단을 따라 움직인다. */
import { decodeBase64Utf8, encodeBase64Utf8 } from './sync/github'

/** b: 블록 순번, f: 블록 앞부분 글자(블록이 추가·삭제돼도 다시 찾기 위한 지문) */
export interface Anchor {
  b: number
  f: string
}

export type StrokeKind = 'pen' | 'marker' | 'line'

export interface InkStroke {
  id: string
  kind: StrokeKind
  color: string
  size: number
  a: Anchor
  /** [x, y, 압력, x, y, 압력, …] — x는 본문 왼쪽, y는 고정된 블록의 위쪽 기준 */
  pts: number[]
}

export interface InkBox {
  id: string
  a: Anchor
  x: number
  y: number
  w: number
  text: string
  color: string
}

/** 표 열 폭·그림·머메이드 도표 크기 (마크다운에 담을 수 없어 필기와 함께 저장) */
export interface LayoutItem {
  kind: 'table' | 'image' | 'mermaid'
  /** 같은 종류 중 몇 번째인지 */
  i: number
  /** 다시 찾기 위한 지문 (표 머리글, 그림 주소, 도표 코드 앞부분) */
  f: string
  /** 그림·도표 폭(px) */
  w?: number
  /** 표 열 폭(px) */
  cols?: number[]
  /** 표 첫 열 강조를 직접 켜거나 끔 (없으면 자동 판단) */
  firstCol?: boolean
}

export interface InkData {
  strokes: InkStroke[]
  boxes: InkBox[]
  layout?: LayoutItem[]
}

export const emptyInk = (): InkData => ({ strokes: [], boxes: [] })
export const isEmptyInk = (ink: InkData | null | undefined) => !ink || (!ink.strokes.length && !ink.boxes.length && !ink.layout?.length)

const INK_RE = /\n*<!-- inkdown:ink ([A-Za-z0-9+/=]+) -->\s*$/

export function splitInk(content: string): { body: string; ink: InkData | null } {
  const m = content.match(INK_RE)
  if (!m) return { body: content, ink: null }
  try {
    const raw = JSON.parse(decodeBase64Utf8(m[1]!)) as Partial<InkData>
    return { body: content.slice(0, m.index), ink: { strokes: raw.strokes ?? [], boxes: raw.boxes ?? [], ...(raw.layout?.length ? { layout: raw.layout } : {}) } }
  } catch {
    return { body: content.slice(0, m.index), ink: null }
  }
}

export function joinInk(body: string, ink: InkData | null | undefined): string {
  if (isEmptyInk(ink)) return body
  const trimmed = body.replace(/\s+$/, '')
  return `${trimmed}\n\n<!-- inkdown:ink ${encodeBase64Utf8(JSON.stringify(ink))} -->\n`
}

export const fingerprint = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)

/** 저장된 고정점이 지금 어느 블록을 가리키는지 찾는다 */
export function resolveAnchor(a: Anchor, prints: string[]): number {
  if (!prints.length) return -1
  if (prints[a.b] === a.f) return a.b
  if (a.f) {
    for (let d = 1; d < prints.length; d++) {
      if (prints[a.b - d] === a.f) return a.b - d
      if (prints[a.b + d] === a.f) return a.b + d
    }
  }
  return Math.max(0, Math.min(a.b, prints.length - 1))
}

/** 세로 위치 y에 해당하는 블록(그 위치를 포함하거나 바로 위의 블록) */
export function blockAt(y: number, tops: number[]): number {
  let idx = 0
  for (let i = 0; i < tops.length; i++) {
    if (tops[i]! <= y) idx = i
    else break
  }
  return idx
}

export const newInkId = () => Math.random().toString(36).slice(2, 9)

/** 같은 종류 목록에서 저장된 항목이 가리키는 위치 찾기 (순번과 지문이 맞으면 그대로, 아니면 지문으로) */
export function resolveLayout(item: LayoutItem, prints: string[]): number {
  if (prints[item.i] === item.f) return item.i
  const j = prints.indexOf(item.f)
  if (j >= 0) return j
  return item.i < prints.length ? item.i : -1
}
