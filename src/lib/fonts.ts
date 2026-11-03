/* 글꼴 목록. 내장 글꼴은 앱에 포함되어 오프라인에서도 동작하며, 선택했을 때만 불러온다(웹 첫 로딩 용량 절약). */

export interface FontOption {
  id: string
  label: string
  family: string
  note?: string
  load?: () => Promise<unknown>
}

const SYSTEM_SANS = `-apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', sans-serif`
const SYSTEM_SERIF = `'AppleMyungjo', 'Batang', 'Noto Serif KR', Georgia, serif`
const SYSTEM_MONO = `'SF Mono', Menlo, Consolas, 'D2Coding', monospace`

export const BODY_FONTS: FontOption[] = [
  { id: 'system', label: '시스템 기본', family: SYSTEM_SANS, note: 'Mac: 애플 SD 산돌고딕 · Windows: 맑은 고딕' },
  { id: 'pretendard', label: '프리텐다드', family: `'Pretendard Variable', ${SYSTEM_SANS}`, note: '깔끔한 고딕', load: () => import('pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css') },
  { id: 'gowun-dodum', label: '고운돋움', family: `'Gowun Dodum', ${SYSTEM_SANS}`, note: '부드러운 고딕', load: () => import('@fontsource/gowun-dodum/400.css') },
  {
    id: 'gowun-batang',
    label: '고운바탕',
    family: `'Gowun Batang', ${SYSTEM_SERIF}`,
    note: '읽기 편한 명조',
    load: () => Promise.all([import('@fontsource/gowun-batang/400.css'), import('@fontsource/gowun-batang/700.css')]),
  },
  {
    id: 'nanum-myeongjo',
    label: '나눔명조',
    family: `'Nanum Myeongjo', ${SYSTEM_SERIF}`,
    note: '전통 명조',
    load: () => Promise.all([import('@fontsource/nanum-myeongjo/400.css'), import('@fontsource/nanum-myeongjo/700.css')]),
  },
  { id: 'nanum-pen', label: '나눔손글씨 펜', family: `'Nanum Pen Script', ${SYSTEM_SANS}`, note: '손글씨 느낌', load: () => import('@fontsource/nanum-pen-script/400.css') },
  { id: 'system-serif', label: '시스템 명조', family: SYSTEM_SERIF, note: 'Mac: 애플명조 · Windows: 바탕' },
]

export const CODE_FONTS: FontOption[] = [
  { id: 'system-mono', label: '시스템 고정폭', family: SYSTEM_MONO },
  { id: 'jetbrains', label: 'JetBrains Mono', family: `'JetBrains Mono', ${SYSTEM_MONO}`, load: () => Promise.all([import('@fontsource/jetbrains-mono/400.css'), import('@fontsource/jetbrains-mono/700.css')]) },
]

export const CUSTOM_PREFIX = 'custom:'

/** 설정값(id 또는 'custom:글꼴이름')을 CSS font-family로 변환하고, 필요하면 글꼴 파일을 불러온다 */
export function resolveFont(value: string, list: FontOption[], fallback: string): string {
  if (value.startsWith(CUSTOM_PREFIX)) {
    const name = value.slice(CUSTOM_PREFIX.length).replace(/["\\;{}]/g, '').trim()
    return name ? `"${name}", ${fallback}` : fallback
  }
  const opt = list.find((f) => f.id === value) ?? list[0]!
  opt.load?.().catch(() => undefined)
  return opt.family
}

export const FONT_FALLBACK = { body: SYSTEM_SANS, code: SYSTEM_MONO }
