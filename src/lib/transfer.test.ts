import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './config'
import { DEFAULT_PROGRESS } from './curriculum'
import { applyImportedSettings, decodeTransfer, encodeTransfer, mergeImported } from './transfer'
import type { LearnedItem } from './types'

const learned: LearnedItem[] = [
  { en: "I'm so tired.", ko: '나 너무 피곤해.', date: '2026-10-05' },
  { en: 'I like coffee.', ko: '커피 좋아해.', date: '2026-10-06' },
]
const settings = { ...DEFAULT_SETTINGS, apiKey: 'SECRET-KEY', voiceName: 'Google US English', friendName: 'Mia', rate: 0.7 }
const progress = {
  ...DEFAULT_PROGRESS,
  stage: 2,
  unit: 's2-3',
  doneUnits: ['s1-1', 's2-1'],
  sessions: [
    { id: '0abc-1', date: '2026-10-05', stage: 2, unit: 's2-1', minutes: 12, turns: 8, koTurns: 2, enOwnTurns: 5, enOwnWords: 20, repeatTurns: 1 },
  ],
}

describe('encode/decodeTransfer', () => {
  it('문장장과 설정이 그대로 돌아온다 (압축 코드)', async () => {
    const code = await encodeTransfer(learned, settings, progress)
    expect(code.startsWith('EF1.')).toBe(true)
    const data = await decodeTransfer(code)
    expect(data.learned).toEqual(learned)
    expect(data.settings).toMatchObject({ friendName: 'Mia', rate: 0.7, repeatAmount: DEFAULT_SETTINGS.repeatAmount })
    expect(data.progress).toEqual({ ...progress, days: { '2026-10-05': 12 } })
  })

  it('Gemini 키와 목소리 이름은 코드에 넣지 않는다', async () => {
    const data = await decodeTransfer(await encodeTransfer(learned, settings, progress))
    expect(data.settings).not.toHaveProperty('apiKey')
    expect(data.settings).not.toHaveProperty('voiceName')
  })

  it('압축을 못 하는 브라우저면 압축 없는 코드로 만들고, 그것도 읽는다', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const code = await encodeTransfer(learned, settings, progress)
    vi.unstubAllGlobals()
    expect(code.startsWith('EF0.')).toBe(true)
    expect((await decodeTransfer(code)).learned).toEqual(learned)
  })

  it('메신저가 넣은 줄바꿈·공백은 무시한다', async () => {
    const code = await encodeTransfer(learned, settings, progress)
    const messy = `  ${code.slice(0, 15)}\n${code.slice(15, 40)} \r\n${code.slice(40)}  `
    expect((await decodeTransfer(messy)).learned).toEqual(learned)
  })

  it('다른 글이면 알아듣기 쉬운 오류', async () => {
    await expect(decodeTransfer('안녕하세요')).rejects.toThrow('영어 친구 코드가 아니에요')
  })

  it('잘린 코드면 다시 복사하라고 한다', async () => {
    const code = await encodeTransfer(learned, settings, progress)
    await expect(decodeTransfer(code.slice(0, code.length - 12))).rejects.toThrow('잘렸거나')
  })

  it('문장 300개도 카톡으로 보낼 만한 길이', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      en: `I want to practice sentence number ${i}.`,
      ko: `${i}번 문장을 연습하고 싶어.`,
      date: '2026-10-08',
    }))
    const code = await encodeTransfer(many, settings, progress)
    const plain = JSON.stringify(many).length
    expect(code.length).toBeLessThan(plain / 3)
    expect((await decodeTransfer(code)).learned).toHaveLength(300)
  })
})

describe('mergeImported', () => {
  it('겹치는 문장은 하나만, 더 이른 날짜를 남기고 날짜순 정렬', () => {
    const local: LearnedItem[] = [
      { en: 'I am so tired', ko: '피곤해', date: '2026-10-07' },
      { en: 'Good morning.', ko: '좋은 아침', date: '2026-10-02' },
    ]
    const { list, added } = mergeImported(local, learned)
    expect(added).toBe(1)
    expect(list.map((x) => `${x.date} ${x.en}`)).toEqual([
      '2026-10-02 Good morning.',
      '2026-10-05 I am so tired',
      '2026-10-06 I like coffee.',
    ])
  })

  it('원래 목록은 건드리지 않는다', () => {
    const local: LearnedItem[] = [{ en: "I'm so tired.", ko: '', date: '2026-10-09' }]
    mergeImported(local, learned)
    expect(local[0].date).toBe('2026-10-09')
  })
})

describe('applyImportedSettings', () => {
  it('이 기기의 키와 목소리는 유지하고 나머지만 맞춘다', () => {
    const here = { ...DEFAULT_SETTINGS, apiKey: 'MY-KEY', voiceName: 'Phone Voice' }
    const next = applyImportedSettings(here, { friendName: 'Mia', minutes: 999 })
    expect(next.apiKey).toBe('MY-KEY')
    expect(next.voiceName).toBe('Phone Voice')
    expect(next.friendName).toBe('Mia')
    expect(next.minutes).toBe(120) // 범위 밖 값은 바로잡는다
  })
})

describe('퀴즈 복습 일정도 옮기기·백업에 들어간다', () => {
  it('넣으면 그대로 돌아오고, 없으면 null (옛 코드도 읽힘)', async () => {
    const quiz = { 'I like tea.': { box: 3, due: '2026-10-12', seen: 4 } }
    const withQuiz = await decodeTransfer(await encodeTransfer([], DEFAULT_SETTINGS, DEFAULT_PROGRESS, quiz))
    expect(withQuiz.quiz).toEqual(quiz)
    const without = await decodeTransfer(await encodeTransfer([], DEFAULT_SETTINGS, DEFAULT_PROGRESS, {}))
    expect(without.quiz).toBeNull()
  })
})
