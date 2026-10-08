export type Lang = 'ko' | 'en'

export interface Pair {
  en: string
  ko: string
}

// AI 한 턴의 답. Gemini에 JSON 스키마로 이 모양을 요구한다
export interface Turn {
  say: string
  say_ko: string
  cue: string
  repeat: string
  repeat_ko: string
  hints: Pair[]
  words: Pair[]
}

export interface Settings {
  apiKey: string
  model: string
  level: string
  likes: string
  minutes: number
  repeatAmount: string
  friendName: string
  friendStyle: string
  rate: number
  voiceName: string
  showKo: boolean
  soundFirst: boolean
}

export interface LearnedItem extends Pair {
  date: string
}

export interface Segment {
  text: string
  lang: Lang
  voiceName?: string
}

export interface Content {
  role: 'user' | 'model'
  parts: { text: string }[]
}

export type Message =
  | { kind: 'ai'; id: number; turn: Turn; veiled: boolean }
  | { kind: 'me'; id: number; text: string; lang: Lang; isRepeat: boolean }
  | { kind: 'error'; id: number; text: string }

export interface WriteCheck {
  ok: boolean
  fixed: string
  comment: string
}
