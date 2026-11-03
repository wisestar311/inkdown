import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import { commandsCtx, editorViewCtx, remarkStringifyOptionsCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import type { MarkType } from '@milkdown/kit/prose/model'
import { callCommand } from '@milkdown/kit/utils'
import {
  createCodeBlockCommand,
  insertHrCommand,
  insertImageCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { oneDark } from '@codemirror/theme-one-dark'
import { compressImage } from '../lib/fileio'
import { clearHighlightCommand, highlightSchema, inkdownMarks, toggleHighlightCommand, toggleUnderlineCommand, underlineSchema } from '../editor/marks'

const HL_ICON = `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M15.2 3.6 20.4 8.8 11 18.2H5.8V13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><rect x="3" y="19.5" width="18" height="2.5" rx="1" fill="#f5c400"/></svg>`
const UL_ICON = `<svg viewBox="0 0 24 24" width="24" height="24"><path d="M7 4v7a5 5 0 0 0 10 0V4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5 20h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`

/** 빈 문단이 '<br />' 로 직렬화되는 것을 정리 */
function cleanMarkdown(md: string) {
  return md
    .replace(/^<br \/>\s*$/gm, '')
    .replace(/^&#x20;/gm, ' ')
    .replace(/\s+$/, '\n')
}

export type FormatCommand =
  | { type: 'heading'; level: number }
  | { type: 'paragraph' }
  | { type: 'bold' | 'italic' | 'strike' | 'code' | 'quote' | 'ul' | 'ol' | 'codeblock' | 'hr' | 'table' }
  | { type: 'link'; href: string }
  | { type: 'image'; src: string; alt?: string }
  | { type: 'highlight'; color: string }
  | { type: 'underline' | 'clearmark' }

export interface EditorHandle {
  run: (cmd: FormatCommand) => void
  scrollToHeading: (index: number) => void
  focus: () => void
}

interface Props {
  initialValue: string
  onChange: (md: string) => void
  focusMode: boolean
  typewriterMode: boolean
  scrollContainer: () => HTMLElement | null
  /** 코드 블록 색상용. 바뀌면 상위에서 key로 다시 마운트 */
  dark: boolean
}

export const WysiwygEditor = forwardRef<EditorHandle, Props>(function WysiwygEditor(
  { initialValue, onChange, focusMode, typewriterMode, scrollContainer, dark },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const modesRef = useRef({ focusMode, typewriterMode })
  modesRef.current = { focusMode, typewriterMode }

  // 에디터 생성 (문서가 바뀌면 key로 다시 마운트됨)
  useEffect(() => {
    const root = rootRef.current!
    const upload = (file: File) => compressImage(file)
    const crepe = new Crepe({
      root,
      defaultValue: initialValue,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: '글을 쓰거나 / 를 입력해 블록을 삽입하세요', mode: 'doc' },
        [Crepe.Feature.ImageBlock]: {
          onUpload: upload,
          inlineOnUpload: upload,
          blockOnUpload: upload,
          blockUploadPlaceholderText: '또는 이미지 주소 붙여넣기',
          inlineUploadPlaceholderText: '또는 이미지 주소 붙여넣기',
          blockCaptionPlaceholderText: '이미지 설명',
          blockConfirmButton: '확인',
          inlineConfirmButton: '확인',
          blockUploadButton: '업로드',
          inlineUploadButton: '업로드',
        },
        [Crepe.Feature.BlockEdit]: {
          textGroup: {
            label: '텍스트',
            text: { label: '본문' },
            h1: { label: '제목 1' },
            h2: { label: '제목 2' },
            h3: { label: '제목 3' },
            h4: { label: '제목 4' },
            h5: { label: '제목 5' },
            h6: { label: '제목 6' },
            quote: { label: '인용' },
            divider: { label: '구분선' },
          },
          listGroup: {
            label: '목록',
            bulletList: { label: '글머리 기호 목록' },
            orderedList: { label: '번호 목록' },
            taskList: { label: '할 일 목록' },
          },
          advancedGroup: {
            label: '고급',
            image: { label: '이미지' },
            codeBlock: { label: '코드 블록' },
            table: { label: '표' },
            math: { label: '수식' },
          },
        },
        [Crepe.Feature.Toolbar]: {
          boldLabel: '굵게',
          italicLabel: '기울임',
          strikethroughLabel: '취소선',
          codeLabel: '인라인 코드',
          linkLabel: '링크',
          latexLabel: '수식',
          buildToolbar: (builder) => {
            const rangeHas = (ctx: Ctx, type: MarkType) => {
              const { state } = ctx.get(editorViewCtx)
              return state.doc.rangeHasMark(state.selection.from, state.selection.to, type)
            }
            builder
              .addGroup('marking', '마킹')
              .addItem('highlight', {
                icon: HL_ICON,
                label: '형광펜',
                active: (ctx: Ctx) => rangeHas(ctx, highlightSchema.type(ctx)),
                onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(toggleHighlightCommand.key, 'yellow'),
              })
              .addItem('underline', {
                icon: UL_ICON,
                label: '밑줄',
                active: (ctx: Ctx) => rangeHas(ctx, underlineSchema.type(ctx)),
                onRun: (ctx: Ctx) => ctx.get(commandsCtx).call(toggleUnderlineCommand.key),
              })
          },
        },
        [Crepe.Feature.CodeMirror]: {
          theme: dark ? oneDark : [],
          searchPlaceholder: '언어 검색',
          noResultText: '결과 없음',
          previewToggleText: (previewOnly: boolean) => (previewOnly ? '편집' : '숨기기'),
          previewLabel: '미리보기',
        },
      },
    })
    crepe.editor.use(inkdownMarks)
    // 저장되는 마크다운 형식: '-' 글머리 기호, '*' 기울임, '**' 굵게
    crepe.editor.config((ctx) => {
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: '-' as const, emphasis: '*' as const, strong: '*' as const, rule: '-' as const }))
    })
    crepe.on((api) => {
      api.markdownUpdated((_ctx, md, prev) => {
        if (md !== prev) onChangeRef.current(cleanMarkdown(md))
      })
    })
    crepeRef.current = crepe
    let destroyed = false
    crepe.create().then(() => {
      if (destroyed) return
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    })
    return () => {
      destroyed = true
      crepeRef.current = null
      crepe.destroy()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 집중 모드 / 타자기 모드: 커서가 있는 최상위 블록 강조 + 커서를 화면 중앙에 유지
  useEffect(() => {
    const root = rootRef.current!
    // ProseMirror가 DOM 클래스를 덮어쓰지 않도록, 노드에 클래스를 붙이지 않고 nth-child 스타일 규칙을 주입
    const style = document.createElement('style')
    document.head.appendChild(style)
    let current = -1
    const update = () => {
      const sel = document.getSelection()
      const pm = root.querySelector('.ProseMirror')
      if (!sel || !sel.anchorNode || !pm || !pm.contains(sel.anchorNode)) return
      let node: Node | null = sel.anchorNode
      while (node && node.parentNode !== pm) node = node.parentNode
      const index = node instanceof Element ? Array.prototype.indexOf.call(pm.children, node) + 1 : -1
      if (index !== current) {
        current = index
        style.textContent = index > 0 ? `.focus-mode .ProseMirror > :nth-child(${index}) { opacity: 1 !important; }` : ''
      }
      if (modesRef.current.typewriterMode && sel.rangeCount) {
        const scroller = scrollContainer()
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        if (scroller && rect.height) {
          const box = scroller.getBoundingClientRect()
          const delta = rect.top - (box.top + box.height / 2)
          if (Math.abs(delta) > 4) scroller.scrollBy({ top: delta, behavior: 'smooth' })
        }
      }
    }
    document.addEventListener('selectionchange', update)
    return () => {
      document.removeEventListener('selectionchange', update)
      style.remove()
    }
  }, [scrollContainer])

  useImperativeHandle(ref, () => ({
    run(cmd) {
      const crepe = crepeRef.current
      if (!crepe) return
      const editor = crepe.editor
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const call = (key: any, payload?: unknown) => editor.action(callCommand(key, payload))
      switch (cmd.type) {
        case 'heading': call(wrapInHeadingCommand.key, cmd.level); break
        case 'paragraph': call(turnIntoTextCommand.key); break
        case 'bold': call(toggleStrongCommand.key); break
        case 'italic': call(toggleEmphasisCommand.key); break
        case 'strike': call(toggleStrikethroughCommand.key); break
        case 'code': call(toggleInlineCodeCommand.key); break
        case 'quote': call(wrapInBlockquoteCommand.key); break
        case 'ul': call(wrapInBulletListCommand.key); break
        case 'ol': call(wrapInOrderedListCommand.key); break
        case 'codeblock': call(createCodeBlockCommand.key); break
        case 'hr': call(insertHrCommand.key); break
        case 'table': call(insertTableCommand.key, { row: 3, col: 3 }); break
        case 'link': call(toggleLinkCommand.key, { href: cmd.href }); break
        case 'image': call(insertImageCommand.key, { src: cmd.src, alt: cmd.alt ?? '' }); break
        case 'highlight': call(toggleHighlightCommand.key, cmd.color); break
        case 'underline': call(toggleUnderlineCommand.key); break
        case 'clearmark': call(clearHighlightCommand.key); break
      }
      editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },
    scrollToHeading(index) {
      const headings = rootRef.current?.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6')
      const el = headings?.[index] as HTMLElement | undefined
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.classList.add('flash')
      setTimeout(() => el.classList.remove('flash'), 900)
    },
    focus() {
      crepeRef.current?.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },
  }))

  return <div ref={rootRef} className={`wysiwyg ${focusMode ? 'focus-mode' : ''}`} />
})
