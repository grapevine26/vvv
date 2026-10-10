import { describe, expect, it } from 'vitest'
import { buildQuestions } from './quiz'
import { quizPool, STARTER } from './starter'

describe('STARTER (노트가 빌 때 퀴즈에 쓰는 기본 표현)', () => {
  it('10개, 영어·뜻이 다 있고 영어가 겹치지 않는다', () => {
    expect(STARTER).toHaveLength(10)
    for (const p of STARTER) {
      expect(p.en.trim()).not.toBe('')
      expect(p.ko.trim()).not.toBe('')
    }
    expect(new Set(STARTER.map((p) => p.en)).size).toBe(10)
    expect(STARTER[0]).toEqual({ en: 'Sorry? Can you say that again?', ko: '네? 다시 말해 줄래요?' })
  })

  it('quizPool: 노트가 비면 기본 표현, 아니면 노트 문장만', () => {
    expect(quizPool([])).toBe(STARTER)
    expect(quizPool([{ en: 'Hi.', ko: '안녕', date: '2026-10-10' }])).toHaveLength(1)
  })

  it('기본 표현으로 문제를 만들 수 있다', () => {
    for (const q of buildQuestions(STARTER.slice(0, 3), STARTER)) expect(STARTER).toContainEqual(q.item)
  })
})
