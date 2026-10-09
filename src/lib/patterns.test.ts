import { describe, expect, it } from 'vitest'
import { STAGES, unitById } from './curriculum'
import { BLANK, exampleOf, fillKo, PATTERNS, patternsFor, quotedPhrases, sentence, speakable, swapFills } from './patterns'
import { normWords } from './text'

const unit = (id: string) => {
  const u = unitById(id)
  if (!u) throw new Error('no unit ' + id)
  return u
}

describe('문장 틀 데이터 (1·2단계)', () => {
  const ids = STAGES.filter((s) => s.n <= 2).flatMap((s) => s.units.map((u) => u.id))

  it('1·2단계 단원 20개 모두 틀이 2~3개 있다', () => {
    expect(ids).toHaveLength(20)
    for (const id of ids) {
      const list = PATTERNS[id]
      expect(list, id).toBeDefined()
      expect(list.length, id).toBeGreaterThanOrEqual(2)
      expect(list.length, id).toBeLessThanOrEqual(3)
    }
  })

  it('빈칸이 있는 틀은 단어 3~4개, 고정 표현은 빈칸도 단어도 없다', () => {
    for (const id of ids)
      for (const p of PATTERNS[id]) {
        const blanks = p.frame.split(BLANK).length - 1
        if (p.fills.length === 0) {
          expect(blanks, p.frame).toBe(0)
          expect(p.ko.includes(BLANK), p.ko).toBe(false)
        } else {
          expect(blanks, p.frame).toBe(1)
          expect(p.ko.split(BLANK).length - 1, p.ko).toBe(1)
          expect(p.fills.length, p.frame).toBeGreaterThanOrEqual(3)
          expect(p.fills.length, p.frame).toBeLessThanOrEqual(4)
        }
        expect(p.ko.trim(), p.frame).not.toBe('')
      }
  })

  it('틀의 단어가 단원 focus의 표현에서 왔다', () => {
    for (const id of ids) {
      const focus = new Set(normWords(unit(id).focus))
      for (const p of PATTERNS[id]) {
        const words = normWords(p.frame.replace(BLANK, ' '))
        const hit = words.filter((w) => focus.has(w)).length
        expect(hit, `${id}: ${p.frame}`).toBeGreaterThanOrEqual(Math.min(2, words.length))
      }
    }
  })

  it('쉬운 단어만: 넣는 말은 네 낱말 이하', () => {
    for (const id of ids) for (const p of PATTERNS[id]) for (const fl of p.fills) expect(fl.en.split(' ').length, fl.en).toBeLessThanOrEqual(4)
  })
})

describe('문장 만들기', () => {
  it('빈칸에 단어를 넣고 한국어 조사를 맞춘다', () => {
    const like = PATTERNS['s1-3'][0]
    expect(sentence(like, { en: 'coffee', ko: '커피' })).toEqual({ en: 'I like coffee.', ko: '나는 커피를 좋아해.' })
    expect(sentence(like, { en: 'rice', ko: '밥' }).ko).toBe('나는 밥을 좋아해.')
  })

  it('조사: 은/는·이/가·이야/야·으로/로(ㄹ 받침은 로)', () => {
    expect(fillKo('___는 커.', '개')).toBe('개는 커.')
    expect(fillKo('___는 커.', '말')).toBe('말은 커.')
    expect(fillKo('___가 어디예요?', '역')).toBe('역이 어디예요?')
    expect(fillKo('나는 ___야.', '민수')).toBe('나는 민수야.')
    expect(fillKo('나는 ___야.', '지영')).toBe('나는 지영이야.')
    expect(fillKo('___로 도세요.', '왼쪽')).toBe('왼쪽으로 도세요.')
    expect(fillKo('___로 가요.', '서울')).toBe('서울로 가요.')
    expect(fillKo('나는 ___를 봐.', 'TV')).toBe('나는 TV를 봐.')
    // 조사가 아닌 글자는 그대로
    expect(fillKo('___시야.', '3')).toBe('3시야.')
  })

  it('예문은 첫 단어, 바꿔 말하기는 나머지 단어', () => {
    const p = PATTERNS['s1-1'][0]
    expect(exampleOf(p).en).toBe("Hi, I'm Minsu.")
    expect(swapFills(p).map((x) => x.en)).toEqual(['Jiyoung', 'Tom'])
    const fixedOne = PATTERNS['s1-1'][1]
    expect(exampleOf(fixedOne)).toEqual({ en: 'Nice to meet you.', ko: '만나서 반가워.' })
    expect(swapFills(fixedOne)).toEqual([])
  })

  it('소리 내기용 문장에서는 빈칸을 뺀다', () => {
    expect(speakable(`I'd like to book ${BLANK}.`)).toBe("I'd like to book.")
    expect(speakable(`First, ${BLANK}. Then, ${BLANK}.`)).toBe('First. Then.')
    expect(speakable('Nice to meet you.')).toBe('Nice to meet you.')
  })
})

describe('patternsFor', () => {
  it('1단계 첫 단원은 직접 써 둔 틀', () => {
    expect(patternsFor(unit('s1-1')).map((p) => p.frame)).toEqual(["Hi, I'm ___.", 'Nice to meet you.', "I'm from ___."])
  })

  it('3단계 이상은 focus의 따옴표 표현을 고정 표현으로 (~는 빈칸)', () => {
    expect(patternsFor(unit('s3-1'))).toEqual([
      { frame: 'I have a reservation.', ko: '', fills: [] },
      { frame: 'Could I get a window seat?', ko: '', fills: [] },
      { frame: 'What time is check-out?', ko: '', fills: [] },
    ])
    expect(patternsFor(unit('s3-3'))[0].frame).toBe(`I'd like to book ${BLANK}.`)
  })

  it('표현이 넷 이상이면 셋까지만, 따옴표가 없으면 빈 목록', () => {
    expect(patternsFor(unit('s4-8')).map((p) => p.frame)).toEqual(['figure out', 'come up with', 'run into'])
    expect(patternsFor(unit('s6-10'))).toEqual([])
  })

  it('quotedPhrases: 같은 표현은 한 번만', () => {
    expect(quotedPhrases('"Hi." / "Hi." / "I think ~ because ~."')).toEqual(['Hi.', `I think ${BLANK} because ${BLANK}.`])
  })

  it('3단계 이상 모든 단원에서 오류 없이 0~3개', () => {
    for (const s of STAGES.filter((x) => x.n >= 3))
      for (const u of s.units) {
        const list = patternsFor(u)
        expect(list.length).toBeLessThanOrEqual(3)
        for (const p of list) expect(speakable(p.frame).length).toBeGreaterThan(0)
      }
  })
})

describe('검토에서 고친 것', () => {
  it("'~ing'처럼 ~에 붙은 글자는 빈칸에 함께 들어간다", () => {
    expect(quotedPhrases('"Would you mind ~ing?" / "I like ~."')).toEqual([`Would you mind ${BLANK}?`, `I like ${BLANK}.`])
    const p = patternsFor(unitById('s3-9')!)
    expect(p.map((x) => speakable(x.frame)).join(' | ')).not.toMatch(/\bing\b/)
  })
})
