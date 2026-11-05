/* 표 첫 열이 '구분'(분류·이름표) 열인지 판단 — 그럴 때만 첫 열에 배경색을 넣는다 */

const LABEL_HEADERS = /^(구분|항목|분류|종류|유형|이름|명칭|단계|순서|기간|구간|시기|대상|지표|기준|부문|영역|카테고리|category|item|type|name|stage)$/i

/** header: 머리글 칸 글자들, rows: 본문 행의 칸 글자들 */
export function isLabelColumn(header: string[], rows: string[][]): boolean {
  if (header.length < 2 || !rows.length) return false
  const h = (header[0] ?? '').replace(/\s+/g, '').trim()
  if (LABEL_HEADERS.test(h)) return true
  const first = rows.map((r) => (r[0] ?? '').trim())
  if (first.some((c) => !c)) return false
  const len = (s: string) => [...s].length
  const firstAvg = first.reduce((a, c) => a + len(c), 0) / first.length
  const others = rows.flatMap((r) => r.slice(1).map((c) => len((c ?? '').trim())))
  const otherAvg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0
  // 첫 열이 모두 짧은 이름표이고, 다른 칸보다 확실히 짧으면 '구분' 열로 봄
  return first.every((c) => len(c) <= 12) && firstAvg <= otherAvg * 0.7 && new Set(first).size === first.length
}
