import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from './config'
import { buildSystemPrompt, pushHistory, recentHistory, userTag } from './prompt'
import { mergeLearned } from './storage'
import type { Content } from './types'

describe('buildSystemPrompt', () => {
  it('수준·좋아하는 것·친구 이름을 넣는다', () => {
    const p = buildSystemPrompt({ ...DEFAULT_SETTINGS, likes: '커피, 여행', friendName: 'Mia' }, [])
    expect(p).toContain('단어 몇 개 앎')
    expect(p).toContain('커피, 여행')
    expect(p).toContain('"Mia"')
    expect(p).not.toContain('[복습]')
  })

  it('저장한 문장이 있으면 최근 8개를 복습으로 넣는다', () => {
    const learned = Array.from({ length: 10 }, (_, i) => ({ en: `Sentence ${i}.`, ko: `문장 ${i}`, date: '2026-10-08' }))
    const p = buildSystemPrompt(DEFAULT_SETTINGS, learned)
    expect(p).toContain('[복습]')
    expect(p).toContain('Sentence 9.')
    expect(p).toContain('Sentence 2.')
    expect(p).not.toContain('Sentence 1.')
  })
})

describe('userTag', () => {
  it('상황별 표시', () => {
    expect(userTag('ko', '')).toBe('[한국어]')
    expect(userTag('en', '')).toBe('[영어]')
    expect(userTag('en', "I'm so tired.")).toBe('[따라 말하기 — 목표 문장: "I\'m so tired."]')
  })
})

describe('대화 기록', () => {
  it('user가 연달아 오면 한 메시지로 합친다', () => {
    const h: Content[] = []
    pushHistory(h, 'user', 'a')
    pushHistory(h, 'user', 'b')
    pushHistory(h, 'model', '{}')
    expect(h).toEqual([
      { role: 'user', parts: [{ text: 'a\nb' }] },
      { role: 'model', parts: [{ text: '{}' }] },
    ])
  })

  it('최근 40개만, 그리고 user로 시작하게 자른다', () => {
    const h: Content[] = []
    for (let i = 0; i < 30; i++) {
      pushHistory(h, 'user', `u${i}`)
      pushHistory(h, 'model', `m${i}`)
    }
    const r = recentHistory(h)
    expect(r.length).toBeLessThanOrEqual(40)
    expect(r[0].role).toBe('user')
    expect(r[r.length - 1].parts[0].text).toBe('m29')
  })
})

describe('설정 정리', () => {
  it('범위를 벗어난 값과 빈 칸을 바로잡는다', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, minutes: 999, rate: 0.1, friendName: '  ', model: 'models/gemini-3.8-flash', apiKey: ' k ' })
    expect(s.minutes).toBe(120)
    expect(s.rate).toBe(0.5)
    expect(s.friendName).toBe('Emma')
    expect(s.model).toBe('gemini-3.8-flash')
    expect(s.apiKey).toBe('k')
  })
})

describe('mergeLearned', () => {
  it('처음 보는 문장만 더하고 개수를 센다', () => {
    const learned = [{ en: "I'm so tired.", ko: '피곤해', date: '2026-10-07' }]
    const { list, added } = mergeLearned(learned, [{ en: 'i am so tired', ko: '' }, { en: 'I like coffee.', ko: '커피 좋아' }], '2026-10-08')
    expect(added).toBe(1)
    expect(list.map((x) => x.en)).toEqual(["I'm so tired.", 'I like coffee.'])
    expect(list[1].date).toBe('2026-10-08')
  })
})
