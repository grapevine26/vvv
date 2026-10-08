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
  tip: string
}

export interface Settings {
  apiKey: string
  model: string
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

export interface Unit {
  id: string
  title: string
  // 이 단원에서 연습할 표현 (AI 지시문과 화면에 같이 쓴다)
  focus: string
  roleplay?: boolean
}

export interface Stage {
  n: number
  name: string
  cefr: string
  goal: string
  canDo: string[]
  hours: string
  // 아래는 AI 지시문에 들어가는 단계별 규칙
  speaker: string
  sayRule: string
  repeatRule: string
  hintRule: string
  tipRule: string
  correction: string
  extra: string
  activity: string
  // 단계를 바꿀 때 맞춰 주는 기본 설정
  defaults: { rate: number; showKo: boolean; repeatAmount: string }
  routine: string[]
  promote: { ratio: number; words: number } | null
  units: Unit[]
}

export interface SessionLog {
  id: string
  date: string
  stage: number
  unit: string
  minutes: number
  turns: number
  koTurns: number
  enOwnTurns: number
  enOwnWords: number
  repeatTurns: number
}

export interface Progress {
  stage: number
  unit: string
  doneUnits: string[]
  sessions: SessionLog[]
}

export interface WriteCheck {
  ok: boolean
  fixed: string
  comment: string
}
