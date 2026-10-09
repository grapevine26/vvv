import { describe, expect, it } from 'vitest'
import { diffWords, missedWords } from './pronounce'

describe('diffWords (발음 피드백)', () => {
  it('다 들렸으면 모두 ok, 문장부호는 그대로 보여 준다', () => {
    expect(diffWords("I'm so tired.", 'I am so tired')).toEqual([
      { word: "I'm", ok: true },
      { word: 'so', ok: true },
      { word: 'tired.', ok: true },
    ])
  })
  it('안 들린 단어만 표시한다', () => {
    const marks = diffWords('I went to the park yesterday.', 'I want to the park')
    expect(missedWords(marks)).toEqual(['went', 'yesterday'])
  })
  it('같은 단어가 두 번 나오면 들린 개수만큼만 맞다', () => {
    expect(diffWords('very very good', 'very good').map((m) => m.ok)).toEqual([true, false, true])
  })
  it('대소문자·줄인 말을 가리지 않는다', () => {
    expect(missedWords(diffWords("I can't go.", 'i can not go'))).toEqual([])
  })
})
