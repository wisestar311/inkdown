/* 다른 형식으로 변환: Obsidian용 마크다운, 텍스트, Word(.docx), ZIP 묶음 */
import { Lexer, type Token, type Tokens } from 'marked'
import type { InkBox, InkData } from './ink'
import { splitInk } from './ink'
import { markdownToHtml } from './export'
import { validColor } from './headingColors'
import { isLabelColumn } from './tableStyle'

// ---------- 글상자 → 문서 끝 메모 ----------
const boxesInOrder = (ink: InkData | null | undefined): InkBox[] =>
  [...(ink?.boxes ?? [])].filter((b) => b.text.trim()).sort((a, b) => a.a.b - b.a.b || a.y - b.y)

// ---------- Obsidian ----------
/** Obsidian용: 노랑 형광펜은 ==글자==, 글상자는 문서 끝에 콜아웃으로, 손글씨 데이터는 뺀다 */
export function toObsidian(content: string): string {
  const { body, ink } = splitInk(content)
  let md = body.replace(/<mark>([\s\S]*?)<\/mark>/g, (_m, t: string) => (t.includes('\n') ? `<mark>${t}</mark>` : `==${t}==`))
  // 보관함 안 노트 링크 [별칭](노트.md) → [[노트|별칭]] (Obsidian에서 가져온 링크를 되돌림)
  md = md.replace(/(?<!!)\[([^\]]+)\]\((?!https?:|data:|mailto:)([^)\s]+?)\.md\)/g, (_m, text: string, target: string) => {
    const name = decodeURI(target)
    return text === name || text === name.split('/').pop() ? `[[${name}]]` : `[[${name}|${text}]]`
  })
  const boxes = boxesInOrder(ink)
  if (boxes.length) {
    md = md.replace(/\s+$/, '')
    md += `\n\n---\n\n${boxes.map((b) => `> [!note] 글상자\n${b.text.split('\n').map((l) => `> ${l}`).join('\n')}`).join('\n\n')}\n`
  }
  return md
}

// ---------- 텍스트 ----------
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'HR'])
const STRUCT = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TR'])

/** 서식을 모두 뺀 읽기용 텍스트 (목록은 "• ", 표는 칸을 탭으로 구분) */
export function toPlainText(content: string): string {
  const { body, ink } = splitInk(content)
  const root = document.createElement('div')
  root.innerHTML = markdownToHtml(body)
  const out: string[] = []
  const walk = (n: Node, parent?: HTMLElement) => {
    if (n.nodeType === Node.TEXT_NODE) {
      // 목록·표 태그 사이의 줄바꿈 공백은 무시
      if (parent && STRUCT.has(parent.tagName) && !n.textContent?.trim()) return
      return void out.push(n.textContent ?? '')
    }
    if (!(n instanceof HTMLElement)) return
    if (n.classList.contains('katex-mathml')) return
    const kids = () => n.childNodes.forEach((c) => walk(c, n))
    switch (n.tagName) {
      case 'BR':
        return void out.push('\n')
      case 'INPUT':
        return void out.push((n as HTMLInputElement).checked ? '☑' : '☐')
      case 'LI': {
        const ol = n.parentElement?.tagName === 'OL'
        const isTask = !!n.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]')
        out.push(ol ? `${[...n.parentElement!.children].indexOf(n) + 1}. ` : isTask ? '' : '• ')
        kids()
        return void out.push('\n')
      }
      case 'TD':
      case 'TH':
        kids()
        return void out.push('\t')
      case 'TR':
        kids()
        return void out.push('\n')
    }
    kids()
    if (BLOCK.has(n.tagName)) out.push('\n\n')
  }
  root.childNodes.forEach((c) => walk(c))
  let text = out
    .join('')
    .replace(/\t\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const boxes = boxesInOrder(ink)
  if (boxes.length) text += `\n\n────────\n[글상자 메모]\n${boxes.map((b) => `• ${b.text}`).join('\n')}`
  return `${text}\n`
}

// ---------- ZIP (압축 없이 묶기, 한글 파일 이름 지원) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export function makeZip(files: { path: string; data: string | Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.path)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 파일 이름
    lv.setUint16(8, 0, true) // 압축 안 함
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    locals.push(local, data)
    centrals.push(central)
    offset += local.length + data.length
  }
  const centralSize = centrals.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  const all = [...locals, ...centrals, end]
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0))
  let p = 0
  for (const a of all) {
    out.set(a, p)
    p += a.length
  }
  return out
}

/** 문서 여러 개 → 폴더 구조를 살린 파일 목록 (같은 이름은 (2), (3) …) */
export function docsToFiles<T extends { title: string; folder?: string; content: string }>(docs: T[], convert: (d: T) => string, base = ''): { path: string; data: string }[] {
  const used = new Set<string>()
  const clean = (s: string) => s.replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '제목 없음'
  return docs.map((d) => {
    const dir = [base, ...(d.folder ?? '').split('/')].map((s) => s.trim()).filter(Boolean).map(clean).join('/')
    const stem = `${dir ? `${dir}/` : ''}${clean(d.title)}`
    let path = `${stem}.md`
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${stem} (${n}).md`
    used.add(path.toLowerCase())
    return { path, data: convert(d) }
  })
}

// ---------- Word (.docx) ----------
const HL_FILL: Record<string, string> = { yellow: 'FFE45C', green: 'B4F0B9', pink: 'FFC2D4', blue: 'B9DCFF', orange: 'FFC98F' }

interface ImageInfo {
  data: Uint8Array
  width: number
  height: number
}

/** 이미지(data URL 포함)를 PNG로 바꾸고 크기를 잰다. 실패하면 null */
async function loadImage(src: string): Promise<ImageInfo | null> {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()
    const scale = Math.min(1, 600 / img.naturalWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
    if (!blob) return null
    return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height }
  } catch {
    return null
  }
}

export async function toDocx(title: string, content: string, headingColors: string[] = []): Promise<Uint8Array> {
  const d = await import('docx')
  const { body, ink } = splitInk(content)
  const tokens = new Lexer({ gfm: true }).lex(body)

  // 이미지를 미리 불러옴
  const images = new Map<string, ImageInfo | null>()
  const findImages = (ts: Token[]) => {
    for (const t of ts) {
      if (t.type === 'image') images.set((t as Tokens.Image).href, null)
      const nested = (t as { tokens?: Token[] }).tokens
      if (nested) findImages(nested)
      if (t.type === 'list') (t as Tokens.List).items.forEach((i) => findImages(i.tokens))
      if (t.type === 'table') {
        const tb = t as Tokens.Table
        ;[tb.header, ...tb.rows].forEach((row) => row.forEach((c) => findImages(c.tokens)))
      }
    }
  }
  findImages(tokens)
  await Promise.all([...images.keys()].map(async (src) => images.set(src, await loadImage(src))))

  // 화면에서 조절한 표 열 폭·그림·도표 크기
  const layout = ink?.layout ?? []
  const sizeOf = (kind: 'table' | 'image' | 'mermaid', i: number) => layout.find((l) => l.kind === kind && l.i === i)
  let tableNo = 0
  let imageNo = 0
  let mermaidNo = 0
  // 머메이드 도표는 미리 그림(PNG)으로
  const mermaidCodes: string[] = []
  const findMermaid = (ts: Token[]) => ts.forEach((t) => (t.type === 'code' && /^mermaid$/i.test((t as Tokens.Code).lang ?? '') ? mermaidCodes.push((t as Tokens.Code).text) : (t as { tokens?: Token[] }).tokens && findMermaid((t as { tokens: Token[] }).tokens)))
  findMermaid(tokens)
  const mermaidPngs = await Promise.all(
    mermaidCodes.map(async (code, i) => {
      try {
        const { renderMermaid, svgToPng } = await import('./mermaid')
        return await svgToPng(await renderMermaid(code, false), Math.min(600, sizeOf('mermaid', i)?.w ?? 600))
      } catch {
        return null
      }
    }),
  )

  interface Style {
    bold?: boolean
    italics?: boolean
    strike?: boolean
    underline?: boolean
    code?: boolean
    hl?: string
    color?: string
  }
  type Run = InstanceType<typeof d.TextRun> | InstanceType<typeof d.ExternalHyperlink> | InstanceType<typeof d.ImageRun>
  const textRun = (text: string, s: Style) =>
    new d.TextRun({
      text,
      bold: s.bold,
      italics: s.italics,
      ...(s.color ? { color: s.color } : {}),
      strike: s.strike,
      ...(s.underline ? { underline: { color: 'E5484D' } } : {}),
      ...(s.code ? { font: 'Consolas', shading: { type: d.ShadingType.CLEAR, fill: 'F1F3F4', color: 'auto' } } : {}),
      ...(s.hl ? { shading: { type: d.ShadingType.CLEAR, fill: HL_FILL[s.hl] ?? HL_FILL.yellow!, color: 'auto' } } : {}),
    })

  const inline = (ts: Token[] | undefined, base: Style = {}, state = { hl: undefined as string | undefined, u: false }): Run[] => {
    const runs: Run[] = []
    for (const t of ts ?? []) {
      const s: Style = { ...base, ...(state.hl ? { hl: state.hl } : {}), ...(state.u ? { underline: true } : {}) }
      switch (t.type) {
        case 'strong':
          runs.push(...inline((t as Tokens.Strong).tokens, { ...base, bold: true }, state))
          break
        case 'em':
          runs.push(...inline((t as Tokens.Em).tokens, { ...base, italics: true }, state))
          break
        case 'del':
          runs.push(...inline((t as Tokens.Del).tokens, { ...base, strike: true }, state))
          break
        case 'codespan':
          runs.push(textRun((t as Tokens.Codespan).text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), { ...s, code: true }))
          break
        case 'br':
          runs.push(new d.TextRun({ break: 1 }))
          break
        case 'link': {
          const l = t as Tokens.Link
          runs.push(new d.ExternalHyperlink({ link: l.href, children: [new d.TextRun({ text: l.text, style: 'Hyperlink' })] }))
          break
        }
        case 'image': {
          const im = images.get((t as Tokens.Image).href)
          const want = sizeOf('image', imageNo++)?.w
          const scale = want && im ? Math.min(600, want) / im.width : 1
          if (im) runs.push(new d.ImageRun({ type: 'png', data: im.data, transformation: { width: Math.round(im.width * scale), height: Math.round(im.height * scale) } }))
          else runs.push(textRun(`[이미지: ${(t as Tokens.Image).text || (t as Tokens.Image).href.slice(0, 40)}]`, s))
          break
        }
        case 'html': {
          const raw = (t as Tokens.HTML).text.trim()
          const m = raw.match(/^<mark(?:\s+class=["']?([a-z]+)["']?)?\s*>$/i)
          if (m) state.hl = m[1] ?? 'yellow'
          else if (/^<\/mark>$/i.test(raw)) state.hl = undefined
          else if (/^<u>$/i.test(raw)) state.u = true
          else if (/^<\/u>$/i.test(raw)) state.u = false
          else if (/^<br\s*\/?>$/i.test(raw)) runs.push(new d.TextRun({ break: 1 }))
          break
        }
        case 'text': {
          const tx = t as Tokens.Text
          if (tx.tokens?.length) runs.push(...inline(tx.tokens, base, state))
          else runs.push(textRun(unescape(tx.text), s))
          break
        }
        case 'escape':
          runs.push(textRun((t as Tokens.Escape).text, s))
          break
        default:
          if ('text' in t && typeof t.text === 'string') runs.push(textRun(unescape(t.text), s))
      }
    }
    return runs
  }
  const unescape = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

  type Block = InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>
  const HEADINGS = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6]
  let listInstance = 0

  const blocks = (ts: Token[], ctx: { quote?: boolean; level?: number } = {}): Block[] => {
    const out: Block[] = []
    const para = (children: Run[], extra: Record<string, unknown> = {}) =>
      new d.Paragraph({
        children,
        spacing: { after: 120 },
        ...(ctx.quote ? { indent: { left: 360 }, border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: 'D0D7DE', space: 10 } } } : {}),
        ...extra,
      })
    for (const t of ts) {
      switch (t.type) {
        case 'heading': {
          const h = t as Tokens.Heading
          const color = validColor(headingColors[h.depth - 1])?.slice(1)
          out.push(new d.Paragraph({ heading: HEADINGS[h.depth - 1], children: inline(h.tokens, color ? { color } : {}), spacing: { before: 240, after: 120 } }))
          break
        }
        case 'paragraph': {
          const p = t as Tokens.Paragraph
          // 블록 수식($$ … $$)은 그대로 글자로
          out.push(para(inline(p.tokens)))
          break
        }
        case 'blockquote':
          out.push(...blocks((t as Tokens.Blockquote).tokens, { ...ctx, quote: true }))
          break
        case 'list': {
          const l = t as Tokens.List
          const level = ctx.level ?? 0
          const instance = ++listInstance
          for (const item of l.items) {
            const first = item.tokens.find((x) => x.type === 'text' || x.type === 'paragraph') as Tokens.Text | Tokens.Paragraph | undefined
            const rest = item.tokens.filter((x) => x !== first)
            const prefix = item.task ? [new d.TextRun({ text: item.checked ? '☑ ' : '☐ ' })] : []
            out.push(
              new d.Paragraph({
                children: [...prefix, ...inline(first?.tokens ?? (first ? [first] : []))],
                spacing: { after: 60 },
                ...(l.ordered ? { numbering: { reference: 'ol', level, instance } } : item.task ? { indent: { left: 360 * (level + 1) } } : { bullet: { level } }),
              }),
            )
            out.push(...blocks(rest, { ...ctx, level: level + 1 }))
          }
          break
        }
        case 'code': {
          const c = t as Tokens.Code
          if (/^mermaid$/i.test(c.lang ?? '')) {
            const png = mermaidPngs[mermaidNo++]
            if (png) {
              out.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.ImageRun({ type: 'png', data: png.data, transformation: { width: png.width, height: png.height } })] }))
              break
            }
          }
          for (const line of c.text.split('\n'))
            out.push(
              new d.Paragraph({
                children: [new d.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })],
                shading: { type: d.ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' },
                spacing: { after: 0 },
              }),
            )
          out.push(new d.Paragraph({ children: [] }))
          break
        }
        case 'table': {
          const tb = t as Tokens.Table
          const tIndex = tableNo
          const override = sizeOf('table', tIndex)?.firstCol
          const labelCol = override ?? isLabelColumn(tb.header.map((h) => h.text), tb.rows.map((r) => r.map((c) => c.text)))
          const cell = (c: Tokens.TableCell, header: boolean, col = -1) =>
            new d.TableCell({
              children: [new d.Paragraph({ children: inline(c.tokens, header || (labelCol && col === 0) ? { bold: true } : {}) })],
              ...(header ? { shading: { type: d.ShadingType.CLEAR, fill: 'E3EBF5', color: 'auto' } } : labelCol && col === 0 ? { shading: { type: d.ShadingType.CLEAR, fill: 'F1F5FA', color: 'auto' } } : {}),
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
            })
          const line = { style: d.BorderStyle.SINGLE, size: 6, color: 'B9BEC5' }
          const cols = sizeOf('table', tableNo++)?.cols
          out.push(
            new d.Table({
              borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
              ...(cols?.length === tb.header.length
                ? { width: { size: cols.reduce((a, b) => a + b, 0) * 15, type: d.WidthType.DXA }, columnWidths: cols.map((w) => w * 15), layout: d.TableLayoutType.FIXED }
                : { width: { size: 100, type: d.WidthType.PERCENTAGE } }),
              rows: [new d.TableRow({ tableHeader: true, children: tb.header.map((c) => cell(c, true)) }), ...tb.rows.map((r) => new d.TableRow({ children: r.map((c, j) => cell(c, false, j)) }))],
            }),
          )
          out.push(new d.Paragraph({ children: [] }))
          break
        }
        case 'hr':
          out.push(new d.Paragraph({ children: [], border: { bottom: { style: d.BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 1 } }, spacing: { after: 200 } }))
          break
        case 'html': {
          const text = (t as Tokens.HTML).text.replace(/<[^>]+>/g, '').trim()
          if (text) out.push(para([new d.TextRun(text)]))
          break
        }
        case 'space':
          break
        default:
          if ('text' in t && typeof t.text === 'string' && t.text.trim()) out.push(para([new d.TextRun(t.text)]))
      }
    }
    return out
  }

  const children = blocks(tokens)
  const boxes = boxesInOrder(ink)
  if (boxes.length) {
    children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_3, children: [new d.TextRun('글상자 메모')], spacing: { before: 360 } }))
    for (const b of boxes)
      children.push(
        new d.Paragraph({
          children: b.text.split('\n').flatMap((line, i) => [...(i ? [new d.TextRun({ break: 1 })] : []), new d.TextRun(line)]),
          border: { left: { style: d.BorderStyle.SINGLE, size: 18, color: '8E4EC6', space: 10 } },
          indent: { left: 360 },
          spacing: { after: 120 },
        }),
      )
  }

  const KO = { ascii: 'Malgun Gothic', eastAsia: 'Malgun Gothic', hAnsi: 'Malgun Gothic', cs: 'Malgun Gothic' }
  const doc = new d.Document({
    creator: 'Inkdown',
    title,
    styles: { default: { document: { run: { font: KO, size: 22 }, paragraph: { spacing: { line: 320 } } } } },
    numbering: {
      config: [
        {
          reference: 'ol',
          levels: [0, 1, 2, 3, 4].map((level) => ({
            level,
            format: d.LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: d.AlignmentType.START,
            style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
          })),
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
  })
  const blob = await d.Packer.toBlob(doc)
  return new Uint8Array(await blob.arrayBuffer())
}
