/* Obsidian 보관함(또는 그 안의 폴더)을 폴더 구조 그대로 가져오기.
   <input webkitdirectory>로 고른 파일 목록을 받아 Inkdown 문서로 바꾼다 (웹·Windows·Mac 공통). */
import { compressImage } from './fileio'
import { hashText } from './storage'
import type { LayoutItem } from './ink'
import { joinInk } from './ink'

export interface ImportedNote {
  /** 고른 폴더 기준 경로 (예: 보관함/공부/산부인과/노트.md) — 다시 가져올 때 같은 문서를 찾는 열쇠 */
  source: string
  folder: string
  content: string
}

export interface ImportResult {
  notes: ImportedNote[]
  folders: string[]
  images: number
  skipped: number
}

const MD = /\.(md|markdown)$/i
const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
const HIDDEN = /(^|\/)(\.[^/]+|node_modules)(\/|$)/

const relPath = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/')

/** 폴더 고르기 창을 열어 그 안의 모든 파일을 돌려줌 (취소하면 빈 배열) */
export function pickFolderFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    ;(input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true
    // 일부 브라우저는 문서에 붙어 있는 입력란에서만 폴더 선택이 안정적이라 잠깐 붙였다 뗀다
    input.style.display = 'none'
    document.body.appendChild(input)
    const done = (files: File[]) => {
      input.remove()
      resolve(files)
    }
    input.onchange = () => done([...(input.files ?? [])])
    input.addEventListener('cancel', () => done([]))
    input.click()
  })
}

/** Obsidian 문법 → Inkdown 마크다운 */
async function convert(text: string, title: string, findImage: (name: string) => File | undefined): Promise<{ content: string; layout: LayoutItem[]; images: number }> {
  let md = text.replace(/\r\n?/g, '\n')
  const layout: LayoutItem[] = []
  let images = 0

  // 맨 위 속성(YAML)은 코드 블록으로 보존
  const fm = md.match(/^---\n([\s\S]*?)\n---\n?/)
  if (fm) md = `\`\`\`yaml\n${fm[1]}\n\`\`\`\n\n${md.slice(fm[0].length)}`

  // 코드 블록 안은 건드리지 않도록 나눠서 처리
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]+`)/)
  const out: string[] = []
  let imageIndex = 0
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i]!
    if (i % 2 === 1) {
      out.push(p)
      continue
    }
    // 그림 넣기 ![[그림.png|300]]
    const embeds = [...p.matchAll(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g)]
    for (const m of embeds) {
      const name = m[1]!.trim()
      const file = IMG.test(name) ? findImage(name) : undefined
      let rep: string
      if (file) {
        const src = await compressImage(file)
        const w = Number.parseInt(m[2] ?? '', 10)
        if (w > 0) layout.push({ kind: 'image', i: imageIndex, f: hashText(src), w })
        imageIndex++
        images++
        rep = `![${name.replace(/[[\]]/g, '')}](${src})`
      } else rep = `[${name}](${encodeURI(name.endsWith('.md') ? name : `${name}.md`)})`
      p = p.replace(m[0], rep)
    }
    // 일반 마크다운 그림 ![](그림.png) — 보관함 안 파일이면 넣기
    for (const m of [...p.matchAll(/!\[([^\]]*)\]\((?!https?:|data:)([^)\s]+)\)/g)]) {
      const file = findImage(decodeURI(m[2]!).split('/').pop()!)
      if (!file) continue
      p = p.replace(m[0], `![${m[1]}](${await compressImage(file)})`)
      imageIndex++
      images++
    }
    // 위키 링크 [[노트|별칭]] → [별칭](노트.md)
    p = p.replace(/\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_s, target: string, _h, alias?: string) => `[${(alias ?? target).trim()}](${encodeURI(`${target.trim()}.md`)})`)
    // 형광펜 ==글자==
    p = p.replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    out.push(p)
  }
  md = out.join('')

  // Obsidian은 파일 이름이 제목 → 맨 위에 제목이 없으면 제목 줄을 붙임
  if (!/^\s*#\s+\S/.test(md.replace(/^```yaml\n[\s\S]*?\n```\n+/, ''))) md = `# ${title}\n\n${md.replace(/^\n+/, '')}`
  return { content: md, layout, images }
}

/** 고른 폴더의 파일들 → 가져올 문서 목록 */
export async function readObsidianFolder(files: File[]): Promise<ImportResult> {
  const visible = files.filter((f) => !HIDDEN.test(relPath(f)))
  const notes = visible.filter((f) => MD.test(f.name))
  const imageFiles = new Map<string, File>()
  for (const f of visible) if (IMG.test(f.name)) imageFiles.set(f.name.toLowerCase(), f)
  const findImage = (name: string) => imageFiles.get(name.toLowerCase())

  const result: ImportResult = { notes: [], folders: [], images: 0, skipped: files.length - visible.length }
  const folders = new Set<string>()
  for (const f of notes) {
    const rel = relPath(f)
    const dir = rel.split('/').slice(0, -1).join('/')
    dir.split('/').forEach((_, i, arr) => arr.slice(0, i + 1).join('/') && folders.add(arr.slice(0, i + 1).join('/')))
    const title = f.name.replace(MD, '')
    const { content, layout, images } = await convert(await f.text(), title, findImage)
    result.images += images
    result.notes.push({ source: rel, folder: dir, content: joinInk(content, layout.length ? { strokes: [], boxes: [], layout } : null) })
  }
  result.folders = [...folders].sort((a, b) => a.localeCompare(b, 'ko'))
  return result
}
