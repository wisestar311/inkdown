/* 형광펜(<mark>)과 밑줄(<u>) 서식.
   마크다운 파일에는 표준 HTML 태그로 저장되어 GitHub·다른 편집기에서도 같은 모양으로 보인다.
     노랑:  <mark>글자</mark>
     그 외: <mark class="green">글자</mark>   (green | pink | blue | orange)
     밑줄:  <u>글자</u> */
import { $command, $markSchema, $remark } from '@milkdown/kit/utils'
import type { MarkType } from '@milkdown/kit/prose/model'
import type { Command } from '@milkdown/kit/prose/state'

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink', 'blue', 'orange'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

interface MdNode {
  type: string
  value?: string
  color?: string
  children?: MdNode[]
}

const OPEN_MARK = /^<mark(?:\s+class=["']?([a-z]+)["']?)?\s*>$/i
const CLOSE_MARK = /^<\/mark\s*>$/i
const OPEN_U = /^<u\s*>$/i
const CLOSE_U = /^<\/u\s*>$/i

/** remark가 따로 떼어 놓은 여는 태그·내용·닫는 태그를 하나의 노드로 묶는다 */
function wrapInlineHtml(node: MdNode) {
  const kids = node.children
  if (!kids) return
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i]!
    if (k.type !== 'html' || !k.value) continue
    const m = k.value.match(OPEN_MARK)
    const isU = OPEN_U.test(k.value)
    if (!m && !isU) continue
    const close = isU ? CLOSE_U : CLOSE_MARK
    let depth = 0
    let j = i + 1
    for (; j < kids.length; j++) {
      const v = kids[j]!.type === 'html' ? kids[j]!.value ?? '' : ''
      if ((isU ? OPEN_U : OPEN_MARK).test(v)) depth++
      else if (close.test(v)) {
        if (depth === 0) break
        depth--
      }
    }
    if (j >= kids.length) continue
    const color = m?.[1]?.toLowerCase()
    const wrapped: MdNode = isU
      ? { type: 'underline', children: kids.slice(i + 1, j) }
      : { type: 'highlight', color: HIGHLIGHT_COLORS.includes(color as HighlightColor) ? color! : 'yellow', children: kids.slice(i + 1, j) }
    kids.splice(i, j - i + 1, wrapped)
  }
  kids.forEach(wrapInlineHtml)
}

type Handler = (node: MdNode, parent: unknown, state: { containerPhrasing: (n: MdNode, info: unknown) => string }, info: unknown) => string

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inkdownMarksRemark = $remark('inkdownMarks', () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function (this: any) {
    const data = this.data() as Record<string, unknown[] | undefined>
    const handlers: Record<string, Handler> = {
      highlight: (node, _p, state, info) => {
        const cls = node.color && node.color !== 'yellow' ? ` class="${node.color}"` : ''
        return `<mark${cls}>${state.containerPhrasing(node, info)}</mark>`
      },
      underline: (node, _p, state, info) => `<u>${state.containerPhrasing(node, info)}</u>`,
    }
    ;(data.toMarkdownExtensions ??= []).push({ handlers })
    return (tree: unknown) => wrapInlineHtml(tree as MdNode)
  } as never,
)

export const highlightSchema = $markSchema('highlight', () => ({
  attrs: { color: { default: 'yellow', validate: 'string' } },
  inclusive: false,
  parseDOM: [{ tag: 'mark', getAttrs: (dom) => ({ color: (dom as HTMLElement).dataset.color || 'yellow' }) }],
  toDOM: (mark) => ['mark', { 'data-color': mark.attrs.color, class: `hl hl-${mark.attrs.color}` }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType, { color: (node as unknown as MdNode).color ?? 'yellow' })
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight', undefined, { color: mark.attrs.color })
    },
  },
}))

export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [{ tag: 'u' }],
  toDOM: () => ['u', { class: 'ul' }, 0],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline')
    },
  },
}))

/** 선택 영역에 같은 색 형광펜이 이미 있으면 지우고, 없으면(또는 다른 색이면) 그 색으로 칠한다 */
function toggleColored(type: MarkType, attrs?: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection
    if (empty) return false
    let same = true
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return
      const m = type.isInSet(node.marks)
      if (!m || (attrs && m.attrs.color !== attrs.color)) same = false
    })
    if (dispatch) {
      let tr = state.tr.removeMark(from, to, type)
      if (!same) tr = tr.addMark(from, to, type.create(attrs))
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const toggleHighlightCommand = $command('ToggleHighlight', (ctx) => (color?: string) => toggleColored(highlightSchema.type(ctx), { color: color ?? 'yellow' }))
export const clearHighlightCommand = $command('ClearHighlight', (ctx) => () => (state, dispatch) => {
  const { from, to, empty } = state.selection
  if (empty) return false
  dispatch?.(state.tr.removeMark(from, to, highlightSchema.type(ctx)).removeMark(from, to, underlineSchema.type(ctx)))
  return true
})
export const toggleUnderlineCommand = $command('ToggleUnderline', (ctx) => () => toggleColored(underlineSchema.type(ctx)))

export const inkdownMarks = [inkdownMarksRemark, highlightSchema, underlineSchema, toggleHighlightCommand, clearHighlightCommand, toggleUnderlineCommand].flat()
