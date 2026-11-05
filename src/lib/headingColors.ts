/* 제목 1~6 색 */

export const HEADING_PRESETS: { name: string; colors: string[] }[] = [
  { name: '기본', colors: ['', '', '', '', '', ''] },
  { name: '차분한 파랑', colors: ['#1f3a68', '#2f5d9a', '#3f7cc0', '#4b8fd1', '#5c6f87', '#7a8796'] },
  { name: '따뜻한 갈색', colors: ['#7a3e12', '#a0522d', '#c06a2b', '#b07d3a', '#8a6e4b', '#9a8a74'] },
  { name: '초록 숲', colors: ['#1d5c3a', '#2e7d4f', '#3f9a62', '#5aa26f', '#5f7d68', '#7d8f82'] },
  { name: '다채롭게', colors: ['#c0392b', '#d35400', '#2471a3', '#1e8449', '#7d3c98', '#5d6d7e'] },
]

export const SWATCHES = ['#1f2328', '#1f3a68', '#2471a3', '#1e8449', '#c0392b', '#d35400', '#b7950b', '#7d3c98', '#a0522d', '#5d6d7e']

export const validColor = (c: string | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : '')

/** HTML 내보내기용 CSS */
export const headingColorCss = (colors: string[] | undefined) =>
  (colors ?? [])
    .map((c, i) => (validColor(c) ? `h${i + 1}{color:${c}}` : ''))
    .join('')
