import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, sanitizeSettings } from './config'
import { changeStage, chooseUnit, DEFAULT_PROGRESS } from './curriculum'
import { buildSystemPrompt, pushHistory, recentHistory, startMessage, userTag } from './prompt'
import { mergeLearned } from './storage'
import type { Content } from './types'

describe('buildSystemPrompt', () => {
  it('1단계: 초보 규칙, 오늘 단원, 좋아하는 것·친구 이름', () => {
    const p = buildSystemPrompt({ ...DEFAULT_SETTINGS, likes: '커피, 여행', friendName: 'Mia' }, [], DEFAULT_PROGRESS)
    expect(p).toContain('교육과정 1단계 「첫걸음」(A1)')
    expect(p).toContain('한 문장에 6단어 이하')
    expect(p).toContain('[오늘 단원] 인사와 자기소개')
    expect(p).toContain('커피, 여행')
    expect(p).toContain('"Mia"')
    expect(p).toContain('따라 말하기 횟수')
    expect(p).not.toContain('[복습]')
  })

  it('4단계는 초보 규칙이 빠지고 대답 예시도 주지 않는다', () => {
    const p = buildSystemPrompt(DEFAULT_SETTINGS, [], changeStage(DEFAULT_PROGRESS, 4))
    expect(p).toContain('교육과정 4단계 「자신감 있는 대화」(B2)')
    expect(p).not.toContain('6단어 이하')
    expect(p).not.toContain('문법은 모르고')
    expect(p).toContain('hints: 항상 빈 배열.')
    expect(p).not.toContain('따라 말하기 횟수')
  })

  it('상황극 단원이면 역할을 맡으라고 한다', () => {
    const roleplay = chooseUnit(changeStage(DEFAULT_PROGRESS, 2), 's2-3')
    expect(buildSystemPrompt(DEFAULT_SETTINGS, [], roleplay)).toContain('상황극이야')
    expect(startMessage(roleplay)).toContain('상황극')
    expect(startMessage(DEFAULT_PROGRESS)).toContain('「인사와 자기소개」')
  })

  it('저장한 문장이 있으면 8개를 골라 복습으로 넣는다 (최근 것 포함)', () => {
    const learned = Array.from({ length: 10 }, (_, i) => ({ en: `Sentence ${i}.`, ko: `문장 ${i}`, date: '2026-10-08' }))
    const p = buildSystemPrompt(DEFAULT_SETTINGS, learned, DEFAULT_PROGRESS)
    expect(p).toContain('[복습]')
    expect(p).toContain('Sentence 9.')
    expect(p.split('\n').filter((l) => l.startsWith('- Sentence'))).toHaveLength(8)
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
