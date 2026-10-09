import { loadQuizStats, sanitizeQuizStats, type QuizStats } from './quiz'
import { DEFAULT_SETTINGS, MAX_LEARNED, sanitizeSettings } from './config'
import { sanitizeProgress } from './curriculum'
import { same } from './text'
import type { LearnedItem, Progress, Settings } from './types'

// 다른 기기로 옮기기: 문장장·설정·교육과정 진도를 글자 코드 하나로 만든다 (서버 없음)
// EF1. = gzip 압축, EF0. = 압축 없음(압축을 못 하는 브라우저용)
const PREFIX_GZIP = 'EF1.'
const PREFIX_PLAIN = 'EF0.'

// 기기마다 달라야 하는 값(Gemini 키, 목소리 이름)은 옮기지 않는다
const SYNC_KEYS = [
  'model',
  'likes',
  'minutes',
  'repeatAmount',
  'friendName',
  'friendStyle',
  'rate',
  'showKo',
  'soundFirst',
] as const

export class TransferError extends Error {}

export interface TransferData {
  learned: LearnedItem[]
  settings: Partial<Settings>
  // 진도가 없는 옛 코드면 null
  progress: Progress | null
  // 5분 복습 퀴즈의 복습 일정 (없는 옛 코드면 null)
  quiz: QuizStats | null
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'

async function pipeThrough(
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function encodeTransfer(
  learned: LearnedItem[],
  settings: Settings,
  progress: Progress,
  quiz: QuizStats = loadQuizStats(),
): Promise<string> {
  const s: Record<string, unknown> = {}
  for (const key of SYNC_KEYS) s[key] = settings[key]
  // 키 이름을 반복하지 않게 문장은 [영어, 뜻, 날짜] 배열로 적는다. 퀴즈 기록은 있을 때만
  const q = Object.keys(quiz).length ? quiz : undefined
  const json = JSON.stringify({ v: 1, l: learned.map((x) => [x.en, x.ko, x.date]), s, p: progress, q })
  const bytes = new TextEncoder().encode(json)
  if (canCompress()) return PREFIX_GZIP + toBase64Url(await pipeThrough(bytes, new CompressionStream('gzip')))
  return PREFIX_PLAIN + toBase64Url(bytes)
}

export async function decodeTransfer(code: string): Promise<TransferData> {
  // 메신저가 중간에 줄바꿈이나 공백을 넣어도 읽을 수 있게 지운다
  const clean = code.replace(/\s+/g, '')
  const gzipped = clean.startsWith(PREFIX_GZIP)
  if (!gzipped && !clean.startsWith(PREFIX_PLAIN)) {
    throw new TransferError('영어 친구 코드가 아니에요. "내보내기"로 만든 코드를 통째로 붙여 넣어 주세요.')
  }
  if (gzipped && !canCompress()) {
    throw new TransferError('이 브라우저는 이 코드를 못 읽어요. 크롬이나 엣지 최신 버전에서 열어 주세요.')
  }
  let parsed: unknown
  try {
    let bytes = fromBase64Url(clean.slice(PREFIX_GZIP.length))
    if (gzipped) bytes = await pipeThrough(bytes, new DecompressionStream('gzip'))
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new TransferError('코드가 잘렸거나 바뀌었어요. 처음부터 끝까지 다시 복사해서 붙여 넣어 주세요.')
  }
  const o = (parsed ?? {}) as { v?: unknown; l?: unknown; s?: unknown; p?: unknown; q?: unknown }
  if (o.v !== 1 || !Array.isArray(o.l)) {
    throw new TransferError('코드 형식이 맞지 않아요. 보내는 기기에서 앱을 새로고침한 뒤 다시 내보내 주세요.')
  }
  const learned = o.l
    .filter((x): x is unknown[] => Array.isArray(x) && typeof x[0] === 'string' && x[0].trim() !== '')
    .map((x) => ({ en: String(x[0]), ko: String(x[1] ?? ''), date: String(x[2] ?? '') }))
  const settings: Partial<Settings> = {}
  if (o.s && typeof o.s === 'object') {
    const src = o.s as Record<string, unknown>
    const dst = settings as Record<string, unknown>
    for (const key of SYNC_KEYS) {
      if (typeof src[key] === typeof DEFAULT_SETTINGS[key]) dst[key] = src[key]
    }
  }
  return { learned, settings, progress: o.p ? sanitizeProgress(o.p) : null, quiz: o.q ? sanitizeQuizStats(o.q) : null }
}

// 겹치는 문장은 하나만 남기고(더 이른 날짜 유지), 날짜순으로 정리한다
export function mergeImported(local: LearnedItem[], incoming: LearnedItem[]): { list: LearnedItem[]; added: number } {
  const list = local.map((x) => ({ ...x }))
  let added = 0
  for (const item of incoming) {
    const found = list.find((l) => same(l.en, item.en))
    if (!found) {
      list.push({ ...item })
      added++
    } else if (item.date && (!found.date || item.date < found.date)) {
      found.date = item.date
    }
  }
  list.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
  return { list: list.slice(-MAX_LEARNED), added }
}

export function applyImportedSettings(current: Settings, incoming: Partial<Settings>): Settings {
  return sanitizeSettings({ ...current, ...incoming })
}
