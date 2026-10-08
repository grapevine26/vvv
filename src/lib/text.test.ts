import { describe, expect, it } from 'vitest'
import { fmt, localDate, normWords, overlap, same, splitByScript, turnSegments } from './text'

describe('splitByScript', () => {
  it('한국어와 영어가 섞인 문장을 언어별로 나눈다', () => {
    expect(splitByScript('Nice! 따라 해 볼까? "I\'m so-so today."')).toEqual([
      { text: 'Nice!', lang: 'en' },
      { text: '따라 해 볼까? "', lang: 'ko' },
      { text: 'I\'m so-so today."', lang: 'en' },
    ])
  })

  it('한 언어만 있으면 한 조각', () => {
    expect(splitByScript('How was your day?')).toEqual([{ text: 'How was your day?', lang: 'en' }])
    expect(splitByScript('따라 해 볼까요?')).toEqual([{ text: '따라 해 볼까요?', lang: 'ko' }])
  })

  it('문장부호만 있는 조각과 빈 글은 버린다', () => {
    expect(splitByScript('')).toEqual([])
    expect(splitByScript('  ...  ')).toEqual([])
  })
})

describe('turnSegments', () => {
  const base = { say: "Oh, you're tired.", say_ko: '', cue: '따라 해 볼까요?', repeat: "I'm so tired.", repeat_ko: '', hints: [], words: [] }

  it('반응 → 한국어 신호 → 따라 할 문장 순서', () => {
    expect(turnSegments(base).map((s) => `${s.lang}:${s.text}`)).toEqual([
      "en:Oh, you're tired.",
      'ko:따라 해 볼까요?',
      "en:I'm so tired.",
    ])
  })

  it('따라 말하기가 없으면 신호도 읽지 않는다', () => {
    expect(turnSegments({ ...base, repeat: '' }).map((s) => s.text)).toEqual(["Oh, you're tired."])
  })
})

describe('문장 비교', () => {
  it('축약형과 대소문자, 문장부호를 같게 본다', () => {
    expect(same("I'm so tired.", 'i am so tired')).toBe(true)
    expect(same("I don't know", 'I do not know!')).toBe(true)
    expect(same("can't", 'can not')).toBe(true)
    expect(same('I so tired', "I'm so tired")).toBe(false)
  })

  it('normWords는 단어 목록을 돌려준다', () => {
    expect(normWords("It's a NICE day!")).toEqual(['it', 'is', 'a', 'nice', 'day'])
  })

  it('overlap은 목표 문장 단어 중 들린 비율', () => {
    expect(overlap("I'm so tired.", 'I am so tired')).toBe(1)
    expect(overlap("I'm so tired.", 'so tired')).toBe(0.5)
    expect(overlap('', 'anything')).toBe(0)
  })
})

describe('시간·날짜 표시', () => {
  it('fmt는 분:초', () => {
    expect(fmt(0)).toBe('00:00')
    expect(fmt(200)).toBe('03:20')
  })

  it('localDate는 기기 시간 기준 YYYY-MM-DD', () => {
    expect(localDate(new Date(2026, 9, 8, 7, 30))).toBe('2026-10-08')
  })
})
