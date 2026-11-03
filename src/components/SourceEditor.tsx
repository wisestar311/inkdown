import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'

export interface SourceHandle {
  scrollToLine: (line: number) => void
  focus: () => void
}

interface Props {
  initialValue: string
  onChange: (md: string) => void
  dark: boolean
}

const baseTheme = EditorView.theme({
  '&': { fontSize: 'var(--editor-font-size)', background: 'transparent', height: '100%' },
  '.cm-content': { fontFamily: 'var(--font-mono)', padding: '0 0 40vh', caretColor: 'var(--accent)' },
  '.cm-gutters': { background: 'transparent', border: 'none', color: 'var(--muted)' },
  '.cm-activeLine, .cm-activeLineGutter': { background: 'var(--hover)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'visible', lineHeight: '1.7' },
})

export const SourceEditor = forwardRef<SourceHandle, Props>(function SourceEditor({ initialValue, onChange, dark }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeComp = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          baseTheme,
          themeComp.current.of(dark ? oneDark : []),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    view.focus()
    return () => view.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: themeComp.current.reconfigure(dark ? oneDark : []) })
  }, [dark])

  useImperativeHandle(ref, () => ({
    scrollToLine(line) {
      const view = viewRef.current
      if (!view) return
      const pos = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }) })
      view.focus()
    },
    focus() {
      viewRef.current?.focus()
    },
  }))

  return <div ref={hostRef} className="source-editor" />
})
