import { describe, expect, it } from 'vitest'
import { isLabelColumn } from '../src/lib/tableStyle'

describe('표 첫 열 "구분" 판단', () => {
  it('머리글이 구분·항목 등이면 구분 열', () => {
    expect(isLabelColumn(['구분', '내용'], [['예금', '은행에 맡기는 돈입니다']])).toBe(true)
    expect(isLabelColumn(['항목', '금액'], [['식비', '50만 원']])).toBe(true)
  })
  it('첫 열이 짧은 이름표이고 다른 칸이 길면 구분 열', () => {
    expect(isLabelColumn(['', '설명'], [['장점', '이자를 꾸준히 받을 수 있습니다'], ['단점', '금리가 내리면 수입도 줄어듭니다']])).toBe(true)
  })
  it('첫 열도 내용(긴 문장·숫자 위주)이면 구분 열 아님', () => {
    expect(isLabelColumn(['날짜', '내용'], [['2026년 11월 5일 오전 회의', '자료 검토']])).toBe(false)
    expect(isLabelColumn(['이자', '원금'], [['3%', '1,000만 원'], ['3%', '2,000만 원']])).toBe(false)
  })
})
