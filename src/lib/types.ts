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
  // 친구 말이 끝나면 마이크를 자동으로 켠다 (기기마다 사정이 달라 옮기지 않는다)
  autoListen: boolean
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

// 오류를 고치려면 어디로 가야 하는지 (설정의 키 칸, 모델 칸)
export type FixTarget = 'apiKey' | 'model' | null

export type Message =
  | { kind: 'ai'; id: number; turn: Turn; veiled: boolean }
  | { kind: 'me'; id: number; text: string; lang: Lang; isRepeat: boolean; heardWell?: boolean }
  | { kind: 'error'; id: number; text: string; fix: FixTarget }

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

// 대화 한 번 동안 센 내 말 (교육과정 승급 기준에 쓴다)
export interface SessionStats {
  turns: number
  koTurns: number
  enOwnTurns: number
  enOwnWords: number
  repeatTurns: number
}

export interface SessionLog extends SessionStats {
  id: string
  date: string
  stage: number
  unit: string
  minutes: number
}

// 저장하고 끝내기 전에 탭이 닫히거나 새로고침돼도 되살릴 수 있게 하는 임시 저장
export interface Draft {
  tabId: string
  savedAt: number
  date: string
  activeMs: number
  limitSec: number
  stage: number
  unit: string
  stats: SessionStats
  repeats: Pair[]
  messages: Message[]
  history: Content[]
  pendingRepeat: string
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
