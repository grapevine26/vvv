import { DEFAULT_SETTINGS } from './config'
import { WRITE_SYSTEM } from './prompt'
import type { Content, FixTarget, Pair, Settings, Turn, WriteCheck } from './types'

// fix: 이 오류를 고치려면 설정의 어느 칸으로 가야 하는지
export class AppError extends Error {
  fix: FixTarget
  // 다시 시도하면 나아질 수 있는 오류(인터넷, 서버, 시간 초과)
  retryable: boolean
  constructor(message: string, fix: FixTarget = null, retryable = false) {
    super(message)
    this.fix = fix
    this.retryable = retryable
  }
}

const PAIR_SCHEMA = {
  type: 'OBJECT',
  properties: { en: { type: 'STRING' }, ko: { type: 'STRING' } },
  required: ['en', 'ko'],
  propertyOrdering: ['en', 'ko'],
}
const TURN_FIELDS = ['say', 'say_ko', 'cue', 'repeat', 'repeat_ko', 'hints', 'words', 'tip']

export const TURN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    say: { type: 'STRING' },
    say_ko: { type: 'STRING' },
    cue: { type: 'STRING' },
    repeat: { type: 'STRING' },
    repeat_ko: { type: 'STRING' },
    hints: { type: 'ARRAY', items: PAIR_SCHEMA },
    words: { type: 'ARRAY', items: PAIR_SCHEMA },
    tip: { type: 'STRING' },
  },
  required: TURN_FIELDS,
  propertyOrdering: TURN_FIELDS,
}

export const WRITE_SCHEMA = {
  type: 'OBJECT',
  properties: { ok: { type: 'BOOLEAN' }, fixed: { type: 'STRING' }, comment: { type: 'STRING' } },
  required: ['ok', 'fixed', 'comment'],
  propertyOrdering: ['ok', 'fixed', 'comment'],
}

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// 이 시간 안에 답이 없으면 멈춘 것으로 보고 다시 시도하게 한다
export const REQUEST_TIMEOUT_MS = 20_000

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

const modelName = (settings: Pick<Settings, 'model'>) => (settings.model.trim() || DEFAULT_SETTINGS.model).replace(/^models\//, '')

// 시간 제한과 바깥 취소를 함께 걸어 요청하고, 오류는 한국어 안내로 바꾼다
async function request(
  url: string,
  init: RequestInit,
  model: string,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort)
  try {
    let res: Response
    let data: GeminiResponse
    try {
      res = await fetch(url, { ...init, signal: controller.signal })
      data = await res.json().catch(() => ({}))
    } catch {
      if (timedOut) throw new AppError('응답이 너무 늦어요. 인터넷을 확인하고 "다시 시도"를 눌러 주세요.', null, true)
      if (signal?.aborted) throw new AppError('기다리기를 그만뒀어요. 다시 말하거나 "다시 시도"를 눌러 주세요.', null, true)
      throw new AppError('AI 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', null, true)
    }
    if (!res.ok) throw apiError(res.status, data, model)
    return data
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function callGemini(
  settings: Pick<Settings, 'apiKey' | 'model'>,
  system: string,
  contents: Content[],
  schema: object,
  signal?: AbortSignal,
): Promise<string> {
  const key = settings.apiKey.trim()
  if (!key) throw new AppError('설정에서 Gemini API 키를 먼저 넣어 주세요.', 'apiKey')
  const model = modelName(settings)
  const data = await request(
    `${API_BASE}/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      // 키는 주소가 아니라 헤더로 보낸다 (주소는 기록에 남기 쉽다)
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.8 },
      }),
    },
    model,
    signal,
  )
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim()
  if (!text) {
    const why = cand?.finishReason || data.promptFeedback?.blockReason || ''
    throw new AppError(`AI가 빈 답을 보냈어요${why ? ` (${why})` : ''}. 다시 시도해 주세요.`, null, true)
  }
  return text
}

// 키와 모델 이름이 맞는지 확인한다. 모델 정보만 읽어서 사용량(토큰)을 쓰지 않는다
export async function checkKey(settings: Pick<Settings, 'apiKey' | 'model'>, signal?: AbortSignal): Promise<void> {
  const key = settings.apiKey.trim()
  if (!key) throw new AppError('키를 먼저 붙여 넣어 주세요.', 'apiKey')
  const model = modelName(settings)
  await request(`${API_BASE}/${encodeURIComponent(model)}`, { method: 'GET', headers: { 'x-goog-api-key': key } }, model, signal)
}

function apiError(status: number, data: GeminiResponse, model: string): AppError {
  const raw = data.error?.message ?? ''
  const tail = raw ? `\n(원문: ${raw.slice(0, 160)})` : ''
  if (status === 400 && /api key/i.test(raw)) return new AppError('API 키가 맞지 않아요. 설정에서 키를 다시 붙여 넣어 주세요.' + tail, 'apiKey')
  if (status === 400) return new AppError('AI가 요청을 받아 주지 않았어요. 설정의 모델 이름을 확인해 주세요.' + tail, 'model')
  if (status === 401 || status === 403)
    return new AppError('API 키 권한 문제예요. 키가 막혔거나 지워졌을 수 있어요. 새 키를 받아 넣어 보세요.' + tail, 'apiKey')
  if (status === 404) {
    // 예시에는 방금 안 된 모델 이름을 넣지 않는다
    const examples = ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'].filter((m) => m !== model).slice(0, 2)
    return new AppError(`"${model}" 모델을 찾을 수 없어요. 설정 → 고급에서 모델 이름을 바꿔 주세요. (예: ${examples.join(', ')})` + tail, 'model')
  }
  if (status === 429) return new AppError('무료 사용량을 다 썼거나 너무 빨리 보냈어요. 1분쯤 뒤에 다시 해 보세요.' + tail, null, true)
  if (status >= 500) return new AppError('AI 서버가 잠시 바빠요. 잠깐 뒤에 "다시 시도"를 눌러 주세요.' + tail, null, true)
  return new AppError(`알 수 없는 오류예요(${status}).` + tail, null, true)
}

// 예전 이름 유지 (테스트·다른 곳에서 문구만 필요할 때)
export function explainApiError(status: number, data: GeminiResponse, model: string): string {
  return apiError(status, data, model).message
}

export function errorText(err: unknown): string {
  if (err instanceof AppError) return err.message
  return '예상 못 한 오류: ' + (err instanceof Error ? err.message : String(err))
}

export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // 앞뒤에 말이 붙어 오면 중괄호 부분만 다시 읽어 본다
  }
  const m = String(text).match(/\{[\s\S]*\}/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {
      // 포기하고 아래에서 글 그대로 쓴다
    }
  }
  return null
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function pairs(v: unknown, max: number): Pair[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !!str((x as Record<string, unknown>).en))
    .map((x) => ({ en: str(x.en), ko: str(x.ko) }))
    .slice(0, max)
}

// 모델이 형식을 어겨도 화면이 깨지지 않게 다듬는다
export function parseTurn(text: string): Turn {
  const obj = parseJsonLoose(text)
  if (!obj || typeof obj !== 'object') {
    return { say: str(text), say_ko: '', cue: '', repeat: '', repeat_ko: '', hints: [], words: [], tip: '' }
  }
  const o = obj as Record<string, unknown>
  const t: Turn = {
    say: str(o.say),
    say_ko: str(o.say_ko),
    cue: str(o.cue),
    repeat: str(o.repeat),
    repeat_ko: str(o.repeat_ko),
    hints: pairs(o.hints, 2),
    words: pairs(o.words, 3),
    tip: str(o.tip),
  }
  if (!t.repeat) {
    t.cue = ''
    t.repeat_ko = ''
  } else if (!t.cue) {
    t.cue = '따라 해 볼까요?'
  }
  return t
}

export async function checkWriting(
  settings: Pick<Settings, 'apiKey' | 'model'>,
  target: Pair,
  written: string,
  signal?: AbortSignal,
): Promise<WriteCheck> {
  const user = `목표 문장: "${target.en}" (뜻: ${target.ko})\n내가 쓴 것: "${written}"`
  const raw = await callGemini(settings, WRITE_SYSTEM, [{ role: 'user', parts: [{ text: user }] }], WRITE_SCHEMA, signal)
  const obj = parseJsonLoose(raw)
  const o = obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {}
  return { ok: o.ok === true, fixed: str(o.fixed) || target.en, comment: str(o.comment) }
}
