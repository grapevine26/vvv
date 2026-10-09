import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PROGRESS } from './curriculum'
import { AppError } from './gemini'
import {
  buildStorySystem,
  KEY_LISTEN_LAST,
  loadLastStory,
  makeStory,
  MAX_SENTENCES,
  parseStory,
  sanitizeStory,
  saveLastStory,
  STORY_SCHEMA,
  storyRequest,
} from './listen'

const progress1 = { ...DEFAULT_PROGRESS, stage: 1, unit: 's1-3' }
const progress3 = { ...DEFAULT_PROGRESS, stage: 3, unit: 's3-4' }

// 테스트용 브라우저 저장소
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildStorySystem', () => {
  it('단계·단원·좋아하는 것을 넣고, 1단계는 4~7단어 문장', () => {
    const s = buildStorySystem({ likes: '고양이' }, progress1, [])
    expect(s).toContain('1단계')
    expect(s).toContain('좋아하는 음식')
    expect(s).toContain('"I like ~."')
    expect(s).toContain('고양이')
    expect(s).toContain('4~7단어')
  })

  it('3단계는 다른 길이 규칙, 좋아하는 것이 없으면 일상 이야기', () => {
    const s = buildStorySystem({ likes: '' }, progress3, [])
    expect(s).toContain('3단계')
    expect(s).toContain('기억에 남는 경험')
    expect(s).not.toContain('4~7단어')
    expect(s).toContain('15단어 이하')
    expect(s).toContain('일상 이야기')
  })

  it('문장장 문장이 있으면 복습으로 넣는다', () => {
    const learned = [{ en: 'I like pizza.', ko: '피자 좋아.', date: '2026-10-01' }]
    expect(buildStorySystem({ likes: '' }, progress1, learned, '2026-10-09')).toContain('- I like pizza.')
    expect(buildStorySystem({ likes: '' }, progress1, [], '2026-10-09')).not.toContain('[복습]')
  })
})

describe('storyRequest', () => {
  it('방금 들은 제목은 피하라고 한다', () => {
    expect(storyRequest()).toBe('새 이야기를 하나 써 줘.')
    expect(storyRequest(['At the Cafe', ''])).toContain('"At the Cafe"')
  })
})

describe('STORY_SCHEMA', () => {
  it('제목·뜻·문장 목록을 요구한다', () => {
    expect(STORY_SCHEMA.required).toEqual(['title', 'title_ko', 'sentences'])
    expect(STORY_SCHEMA.properties.sentences.items.required).toEqual(['en', 'ko'])
  })
})

describe('sanitizeStory / parseStory', () => {
  it('빈 문장·겹친 문장을 빼고 공백을 다듬고 최대 6개', () => {
    const sentences = [
      { en: '  I   wake up. ', ko: ' 일어나. ' },
      { en: '', ko: '빈 문장' },
      { en: 'i wake up.', ko: '겹침' },
      { ko: 'en 없음' },
      'x',
      ...Array.from({ length: 8 }, (_, i) => ({ en: `Line ${i}.`, ko: `줄 ${i}` })),
    ]
    const s = sanitizeStory({ title: ' Morning ', title_ko: '아침', sentences })
    expect(s?.title).toBe('Morning')
    expect(s?.sentences[0]).toEqual({ en: 'I wake up.', ko: '일어나.' })
    expect(s?.sentences).toHaveLength(MAX_SENTENCES)
    expect(s?.sentences.map((x) => x.en)).not.toContain('i wake up.')
  })

  it('뜻이 없어도 문장은 남기고, 제목이 없으면 기본 제목', () => {
    const s = sanitizeStory({ sentences: [{ en: 'Hi.' }] })
    expect(s).toEqual({ title: 'A Short Story', title_ko: '', sentences: [{ en: 'Hi.', ko: '' }] })
  })

  it('문장이 하나도 없으면 다시 시도할 수 있는 오류', () => {
    expect(sanitizeStory(null)).toBeNull()
    expect(sanitizeStory({ title: 'x', sentences: [] })).toBeNull()
    try {
      parseStory('그냥 글')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect((e as AppError).retryable).toBe(true)
    }
  })

  it('앞뒤에 말이 붙은 JSON도 읽는다', () => {
    const s = parseStory('여기요: {"title":"T","title_ko":"티","sentences":[{"en":"A b.","ko":"가"}]} 끝')
    expect(s.sentences).toEqual([{ en: 'A b.', ko: '가' }])
  })
})

describe('makeStory', () => {
  it('지시문·스키마를 담아 보내고 결과를 다듬는다', async () => {
    const body = { title: 'Lunch', title_ko: '점심', sentences: [{ en: 'I like rice.', ko: '나는 밥이 좋아.' }] }
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const story = await makeStory({ apiKey: 'K', model: 'm', likes: '' }, progress1, [], ['Old'])
    expect(story).toEqual(body)
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    const sent = JSON.parse(String(init.body))
    expect(sent.generationConfig.responseSchema).toEqual(STORY_SCHEMA)
    expect(sent.systemInstruction.parts[0].text).toContain('좋아하는 음식')
    expect(sent.contents[0].parts[0].text).toContain('"Old"')
  })

  it('키가 없으면 설정으로 안내하는 오류', async () => {
    await expect(makeStory({ apiKey: ' ', model: 'm', likes: '' }, progress1, [])).rejects.toMatchObject({ fix: 'apiKey' })
  })
})

describe('마지막 이야기 저장', () => {
  it('저장하고 다시 읽는다. 망가진 값은 무시', () => {
    expect(loadLastStory()).toBeNull()
    saveLastStory({ title: 'T', title_ko: '티', sentences: [{ en: 'Hi.', ko: '안녕.' }] }, '2026-10-09')
    expect(loadLastStory()).toEqual({ date: '2026-10-09', story: { title: 'T', title_ko: '티', sentences: [{ en: 'Hi.', ko: '안녕.' }] } })
    localStorage.setItem(KEY_LISTEN_LAST, '{"story":{"sentences":[]}}')
    expect(loadLastStory()).toBeNull()
    localStorage.setItem(KEY_LISTEN_LAST, '망가짐')
    expect(loadLastStory()).toBeNull()
  })
})
