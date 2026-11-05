import { Marked } from 'marked'
import katex from 'katex'
import { headingColorCss } from './headingColors'
import { isLabelColumn } from './tableStyle'
import katexCss from 'katex/dist/katex.min.css?inline'

const marked = new Marked({ gfm: true, breaks: false })

const tex = (src: string, displayMode: boolean) => {
  try {
    return katex.renderToString(src, { displayMode, throwOnError: false })
  } catch {
    return src
  }
}

marked.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      start: (src) => src.indexOf('$$'),
      tokenizer(src) {
        const m = src.match(/^\$\$\s*\n?([\s\S]+?)\n?\$\$(?:\n|$)/)
        if (m) return { type: 'mathBlock', raw: m[0], text: m[1]!.trim() }
        return undefined
      },
      renderer: (t) => `<div class="math-block">${tex(t.text as string, true)}</div>\n`,
    },
    {
      name: 'mathInline',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const m = src.match(/^\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/)
        if (m) return { type: 'mathInline', raw: m[0], text: m[1]! }
        return undefined
      },
      renderer: (t) => tex(t.text as string, false),
    },
  ],
})

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string
}

const DOC_CSS = `
:root{color-scheme:light}
body{margin:0;background:#fff;color:#333;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR","Malgun Gothic",sans-serif}
main{max-width:860px;margin:0 auto;padding:48px 32px}
h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.6em 0 .6em;font-weight:700}
h1{font-size:2.1em;border-bottom:1px solid #eee;padding-bottom:.3em}
h2{font-size:1.6em;border-bottom:1px solid #eee;padding-bottom:.25em}
h3{font-size:1.3em}
a{color:#4183c4}
img{max-width:100%}
blockquote{margin:1em 0;padding:0 1em;color:#777;border-left:4px solid #dfe2e5}
code{font-family:"JetBrains Mono",Menlo,Consolas,monospace;font-size:.9em;background:#f3f4f4;padding:.15em .35em;border-radius:3px}
pre{background:#f8f8f8;border:1px solid #e7eaed;border-radius:4px;padding:12px 16px;overflow:auto}
pre code{background:none;padding:0}
table{border-collapse:collapse;margin:1em 0}
th,td{border:1px solid #b9bec5;padding:6px 13px}
th{background:#e3ebf5;font-weight:700}thead tr th{border-bottom:2px solid #b9bec5}
@media print{th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
hr{border:0;border-top:2px solid #eee;margin:2em 0}
.math-block{text-align:center;margin:1em 0;overflow-x:auto}\n.mermaid{text-align:center;margin:1em 0}.mermaid svg{max-width:100%;height:auto}
input[type=checkbox]{margin-right:.4em}
mark{background:rgba(255,214,10,.45);color:inherit;border-radius:3px;padding:0 .1em}
mark.green{background:rgba(126,231,135,.45)}mark.pink{background:rgba(255,143,177,.45)}mark.blue{background:rgba(121,192,255,.45)}mark.orange{background:rgba(255,166,77,.45)}
u{text-decoration-color:#e5484d;text-decoration-thickness:2px;text-underline-offset:3px}
@media print{main{padding:0}}
`

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function buildHtmlDocument(title: string, md: string, headingColors?: string[]): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${katexCss}</style><style>${DOC_CSS}${headingColorCss(headingColors)}</style></head>
<body><main>${markdownToHtml(md)}</main></body></html>`
}

/** 숨은 iframe에 HTML을 띄워 인쇄 대화상자(→ PDF로 저장)를 연다 */
export function printDocument(title: string, md: string) {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument!
  doc.open()
  doc.write(buildHtmlDocument(title, md))
  doc.close()
  const done = () => setTimeout(() => iframe.remove(), 1000)
  iframe.contentWindow!.onafterprint = done
  setTimeout(() => {
    iframe.contentWindow!.focus()
    iframe.contentWindow!.print()
    done()
  }, 300)
}

/** HTML 내보내기: 화면에서 조절한 표 열 폭·그림 크기를 반영하고, 머메이드 코드는 도표(SVG)로 바꾼다 */
export async function buildHtmlDocumentRich(title: string, md: string, headingColors?: string[], layout: { kind: string; i: number; w?: number; cols?: number[] }[] = []): Promise<string> {
  const html = buildHtmlDocument(title, md, headingColors)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const sizeOf = (kind: string, i: number) => layout.find((l) => l.kind === kind && l.i === i)
  doc.querySelectorAll('main table').forEach((t, i) => {
    // 첫 열이 '구분' 열이면 배경색
    const rows = [...t.querySelectorAll('tr')]
    const head = rows[0] ? [...rows[0].children].map((c) => c.textContent ?? '') : []
    const body = rows.slice(1).map((r) => [...r.children].map((c) => c.textContent ?? ''))
    const override = (sizeOf('table', i) as { firstCol?: boolean } | undefined)?.firstCol
    if (override ?? isLabelColumn(head, body)) rows.slice(1).forEach((r) => r.firstElementChild?.setAttribute('style', 'background:#f1f5fa;font-weight:600'))
    const cols = sizeOf('table', i)?.cols
    if (!cols?.length) return
    const cg = doc.createElement('colgroup')
    cols.forEach((w) => {
      const c = doc.createElement('col')
      c.setAttribute('style', `width:${w}px`)
      cg.appendChild(c)
    })
    t.prepend(cg)
    t.setAttribute('style', `table-layout:fixed;width:${cols.reduce((a, b) => a + b, 0)}px;max-width:100%`)
  })
  // 문단에 그림 하나만 있는 경우가 편집 화면의 그림 블록
  ;[...doc.querySelectorAll('main p')].filter((p) => p.children.length === 1 && p.firstElementChild?.tagName === 'IMG' && !p.textContent?.trim()).forEach((p, i) => {
    const w = sizeOf('image', i)?.w
    if (w) p.firstElementChild!.setAttribute('style', `width:${w}px;max-width:100%;height:auto`)
  })
  const blocks = [...doc.querySelectorAll('main pre > code.language-mermaid')]
  if (blocks.length) {
    const { renderMermaid } = await import('./mermaid')
    for (const [i, code] of blocks.entries()) {
      try {
        const svg = await renderMermaid(code.textContent ?? '', false)
        const div = doc.createElement('div')
        div.className = 'mermaid'
        div.innerHTML = svg
        const w = sizeOf('mermaid', i)?.w
        const el = div.querySelector('svg')
        if (el && w) el.setAttribute('style', `width:${w}px;max-width:100%;height:auto`)
        code.parentElement!.replaceWith(div)
      } catch {
        /* 그리지 못하면 코드 그대로 */
      }
    }
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}
