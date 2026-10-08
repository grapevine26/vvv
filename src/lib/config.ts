import type { Settings } from './types'

// 배울 언어: 영어 기준. 다른 언어로 바꾸려면 text.ts의 splitByScript·normWords(로마자 전제)도 같이 고쳐야 한다
export const TARGET = { label: '영어', stt: 'en-US', tts: 'en' } as const
export const NATIVE = { label: '한국어', stt: 'ko-KR', tts: 'ko' } as const

export const LEVELS = ['완전 처음', '단어 몇 개 앎', '짧은 대화 됨', '일상 대화 됨']
export const REPEAT_AMOUNTS = ['적게', '보통', '많이']

export const GEMINI_KEY_URL = 'https://aistudio.google.com/apikey'

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  model: 'gemini-3.5-flash-lite',
  level: '단어 몇 개 앎',
  likes: '',
  minutes: 15,
  repeatAmount: '보통',
  friendName: 'Emma',
  friendStyle: '차분하고 다정함',
  rate: 0.85,
  voiceName: '',
  showKo: true,
  soundFirst: false,
}

export function clamp(value: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback
}

export function sanitizeSettings(s: Settings): Settings {
  return {
    ...s,
    apiKey: s.apiKey.trim(),
    model: s.model.trim().replace(/^models\//, '') || DEFAULT_SETTINGS.model,
    likes: s.likes.trim(),
    minutes: Math.round(clamp(Number(s.minutes), 3, 120, DEFAULT_SETTINGS.minutes)),
    friendName: s.friendName.trim() || DEFAULT_SETTINGS.friendName,
    friendStyle: s.friendStyle.trim() || DEFAULT_SETTINGS.friendStyle,
    rate: clamp(Number(s.rate), 0.5, 1.2, DEFAULT_SETTINGS.rate),
  }
}
