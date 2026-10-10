import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError, callGemini, checkKey, checkWriting, dropInventedIntro, explainApiError, parseJsonLoose, parseTurn, REQUEST_TIMEOUT_MS, TURN_SCHEMA } from './gemini'

const settings = { apiKey: 'TEST-KEY', model: 'gemini-3.5-flash-lite' }
const contents = [{ role: 'user' as const, parts: [{ text: 'hi' }] }]

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('callGemini', () => {
  it('키는 헤더로 보내고 생각(thought) 조각은 버린다', async () => {
    const fetchMock = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: '(생각)', thought: true }, { text: '{"say":"Hi"}' }] } }],
    })
    await expect(callGemini(settings, 'sys', contents, TURN_SCHEMA)).resolves.toBe('{"say":"Hi"}')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(url).not.toContain('TEST-KEY')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('TEST-KEY')
    const body = JSON.parse(String(init.body))
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.systemInstruction.parts[0].text).toBe('sys')
  })

  it('"models/" 를 붙여 적어도 받아 준다', async () => {
    const fetchMock = mockFetch(200, { candidates: [{ content: { parts: [{ text: '{}' }] } }] })
    await callGemini({ apiKey: 'K', model: ' models/gemini-3.8-flash ' }, 's', contents, TURN_SCHEMA)
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain('/models/gemini-3.8-flash:generateContent')
  })

  it('키가 없으면 요청하지 않는다', async () => {
    const fetchMock = mockFetch(200, {})
    await expect(callGemini({ apiKey: ' ', model: 'm' }, 's', contents, TURN_SCHEMA)).rejects.toThrow('API 키')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404면 모델 이름을 바꾸라고 안내한다', async () => {
    mockFetch(404, { error: { message: 'models/x is not found' } })
    await expect(callGemini(settings, 's', contents, TURN_SCHEMA)).rejects.toThrow('모델을 찾을 수 없어요')
  })

  it('빈 답이면 이유를 붙여 알린다', async () => {
    mockFetch(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] })
    await expect(callGemini(settings, 's', contents, TURN_SCHEMA)).rejects.toThrow('SAFETY')
  })

  it('네트워크가 끊기면 연결 오류', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(callGemini(settings, 's', contents, TURN_SCHEMA)).rejects.toBeInstanceOf(AppError)
  })
})

describe('explainApiError', () => {
  it('상태 코드별로 한국어 안내', () => {
    expect(explainApiError(400, { error: { message: 'API key not valid' } }, 'm')).toContain('API 키가 맞지 않아요')
    expect(explainApiError(429, {}, 'm')).toContain('무료 사용량')
    expect(explainApiError(503, {}, 'm')).toContain('바빠요')
  })
})

describe('parseTurn', () => {
  it('정상 JSON', () => {
    const t = parseTurn(
      JSON.stringify({ say: 'Hi', say_ko: '안녕', cue: '', repeat: "I'm fine.", repeat_ko: '좋아', hints: [], words: [] }),
    )
    expect(t.repeat).toBe("I'm fine.")
    expect(t.cue).toBe('따라 해 볼까요?') // 신호가 비어 있으면 기본 신호를 채운다
  })

  it('따라 할 문장이 없으면 신호와 뜻을 지운다', () => {
    const t = parseTurn(JSON.stringify({ say: 'Hi', cue: '따라 해요', repeat: '', repeat_ko: '뜻' }))
    expect(t.cue).toBe('')
    expect(t.repeat_ko).toBe('')
  })

  it('JSON이 아니면 글 그대로 say에', () => {
    expect(parseTurn('Sounds fun!').say).toBe('Sounds fun!')
  })

  it('앞뒤에 말이 붙어 와도 JSON 부분을 읽는다', () => {
    expect(parseTurn('여기요: {"say":"Hello"} 끝').say).toBe('Hello')
  })

  it('예시·단어 개수를 제한하고 형식이 틀린 항목은 버린다', () => {
    const t = parseTurn(
      JSON.stringify({
        say: 'Q?',
        hints: [{ en: 'a', ko: '1' }, { en: 'b', ko: '2' }, { en: 'c', ko: '3' }],
        words: [{ ko: '영어 없음' }, null, 'x', { en: 'day', ko: '하루' }],
      }),
    )
    expect(t.hints).toHaveLength(2)
    expect(t.words).toEqual([{ en: 'day', ko: '하루' }])
  })
})

describe('parseJsonLoose', () => {
  it('못 읽으면 null', () => {
    expect(parseJsonLoose('no json here')).toBeNull()
  })
})

describe('checkWriting', () => {
  it('고친 문장이 비면 목표 문장으로 채운다', async () => {
    mockFetch(200, { candidates: [{ content: { parts: [{ text: '{"ok":false,"fixed":"","comment":"거의 맞았어요"}' }] } }] })
    await expect(checkWriting(settings, { en: "I'm so tired.", ko: '피곤해' }, 'I so tired')).resolves.toEqual({
      ok: false,
      fixed: "I'm so tired.",
      comment: '거의 맞았어요',
    })
  })
})

describe('시간 제한과 취소', () => {
  // 신호가 끊길 때까지 답하지 않는 서버
  function hangingFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      ),
    )
  }

  it('20초 안에 답이 없으면 다시 시도할 수 있는 오류', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const p = callGemini(settings, 's', contents, TURN_SCHEMA)
    const check = expect(p).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('너무 늦어요') })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10)
    await check
    vi.useRealTimers()
  })

  it('바깥에서 취소하면 그만뒀다고 알려 준다', async () => {
    hangingFetch()
    const controller = new AbortController()
    const p = callGemini(settings, 's', contents, TURN_SCHEMA, controller.signal)
    controller.abort()
    await expect(p).rejects.toThrow('그만뒀어요')
  })
})

describe('오류에 고칠 곳 표시', () => {
  it('키 오류는 apiKey, 모델 오류는 model', async () => {
    mockFetch(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })
    await expect(callGemini(settings, 's', contents, TURN_SCHEMA)).rejects.toMatchObject({ fix: 'apiKey', retryable: false })
    mockFetch(404, { error: { message: 'not found' } })
    await expect(callGemini(settings, 's', contents, TURN_SCHEMA)).rejects.toMatchObject({ fix: 'model' })
    mockFetch(503, {})
    await expect(callGemini(settings, 's', contents, TURN_SCHEMA)).rejects.toMatchObject({ fix: null, retryable: true })
  })
})

describe('checkKey', () => {
  it('모델 정보만 GET으로 읽는다 (사용량을 쓰지 않음)', async () => {
    const fetchMock = mockFetch(200, { name: 'models/gemini-3.5-flash-lite' })
    await expect(checkKey(settings)).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('TEST-KEY')
  })

  it('틀린 키면 키 칸으로 안내', async () => {
    mockFetch(400, { error: { message: 'API key not valid.' } })
    await expect(checkKey(settings)).rejects.toMatchObject({ fix: 'apiKey' })
  })
})

describe('dropInventedIntro', () => {
  const t = (repeat: string) => ({ ...parseTurn(JSON.stringify({ say: "What's your name?", repeat, repeat_ko: '뜻' })) })
  it('친구 이름이나 내가 말한 적 없는 이름으로 자기소개하면 따라 하기를 뺀다', () => {
    for (const r of ["Hi, I'm Emma.", "Hi, I'm Minsu.", 'My name is Jisu.', "Hi, I'm", "Hi, I'm ~.", 'My name is ___.']) {
      const out = dropInventedIntro(t(r), 'Emma', '[대화 시작] 먼저 짧게 인사하고')
      expect(out).toMatchObject({ repeat: '', cue: '', repeat_ko: '', say: "What's your name?" })
    }
  })
  it('내가 말한 이름이면 그대로 둔다 (내 말을 바르게 바꿔 준 것)', () => {
    expect(dropInventedIntro(t("Hi, I'm Jisu."), 'Emma', '[한국어] 저는 지수예요, Jisu').repeat).toBe("Hi, I'm Jisu.")
  })
  it('이름이 아닌 자기소개(국적·기분)와 다른 문장은 건드리지 않는다', () => {
    for (const r of ["I'm Korean.", "I'm from Korea.", "I'm happy.", 'I like coffee.']) {
      expect(dropInventedIntro(t(r), 'Emma', '').repeat).toBe(r)
    }
  })
})