export interface Heading {
  level: number
  text: string
  /** 소스 기준 줄 번호(0부터) */
  line: number
  /** 문서 안에서 몇 번째 제목인지 */
  index: number
}

/** 코드 블록 안의 # 은 제외하고 ATX 제목을 추출 */
export function extractHeadings(md: string): Heading[] {
  const result: Heading[] = []
  let fence: string | null = null
  md.split('\n').forEach((raw, line) => {
    const fenceMatch = raw.match(/^\s*(```+|~~~+)/)
    if (fenceMatch) {
      const marker = fenceMatch[1]!
      if (fence === null) fence = marker[0]!
      else if (marker[0] === fence) fence = null
      return
    }
    if (fence) return
    const m = raw.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (m) {
      const text = m[2]!.replace(/[*_`~]|\[([^\]]*)\]\([^)]*\)/g, (_s, label) => label ?? '').trim()
      result.push({ level: m[1]!.length, text: text || '(빈 제목)', line, index: result.length })
    }
  })
  return result
}

export interface Stats {
  chars: number
  charsNoSpace: number
  words: number
  lines: number
  minutes: number
}

export function countStats(md: string): Stats {
  const plain = md
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/^```.*$/gm, ''))
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~`|]/g, '')
  const chars = plain.replace(/\n/g, '').length
  const charsNoSpace = plain.replace(/\s/g, '').length
  const words = (plain.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const lines = md ? md.split('\n').length : 0
  // 한국어 약 500자/분 기준
  const minutes = Math.max(1, Math.round(charsNoSpace / 500))
  return { chars, charsNoSpace, words, lines, minutes }
}
