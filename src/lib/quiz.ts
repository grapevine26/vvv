import { read, write } from './storage'
import { addDays, normWords } from './text'
import type { Pair } from './types'

// 5분 복습 퀴즈: 라이트너 상자(1~5칸) 간격 복습.
// 맞히면 다음 칸으로(최대 5칸), 틀리면 1칸으로 돌아간다. 칸마다 다시 볼 때까지의 날 수가 다르다.
export const QUIZ_KEY = 'englishFriend.quiz'
export const BOX_DAYS = [1, 2, 4, 7, 15] as const
export const MAX_BOX = BOX_DAYS.length

export interface QuizStat {
  box: number
  // 다음에 다시 볼 날 'YYYY-MM-DD'
  due: string
  // 지금까지 푼 횟수
  seen: number
}
export type QuizStats = Record<string, QuizStat>

export type QuizKind = 'meaning' | 'speak' | 'order'

export interface Question {
  kind: QuizKind
  item: Pair
  // 뜻 고르기 보기 3개 (정답 포함, 섞음)
  choices: string[]
  // 순서 맞추기 조각 (섞음). 같은 단어가 여러 번 나올 수 있다
  pieces: string[]
}

type Rng = () => number

const DATE = /^\d{4}-\d{2}-\d{2}$/
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

// 저장된 값이 깨졌거나 옛 모양이어도 쓸 수 있는 것만 남긴다
export function sanitizeQuizStats(v: unknown): QuizStats {
  const out: QuizStats = {}
  if (!isObj(v)) return out
  for (const [en, s] of Object.entries(v)) {
    if (!isObj(s) || typeof s.due !== 'string' || !DATE.test(s.due)) continue
    const box = typeof s.box === 'number' && Number.isFinite(s.box) ? Math.min(MAX_BOX, Math.max(1, Math.round(s.box))) : 1
    const seen = typeof s.seen === 'number' && Number.isFinite(s.seen) ? Math.max(0, Math.round(s.seen)) : 0
    out[en] = { box, due: s.due, seen }
  }
  return out
}

export const loadQuizStats = (): QuizStats => sanitizeQuizStats(read(QUIZ_KEY))
export const saveQuizStats = (s: QuizStats): boolean => write(QUIZ_KEY, s)

// 한 문장을 채점한 뒤의 상자. 처음 보는 문장은 1칸에 있던 것으로 본다
export function grade(stats: QuizStats, en: string, correct: boolean, today: string): QuizStats {
  const prev = stats[en]
  const box = correct ? Math.min(MAX_BOX, (prev?.box ?? 1) + 1) : 1
  return { ...stats, [en]: { box, due: addDays(today, BOX_DAYS[box - 1]), seen: (prev?.seen ?? 0) + 1 } }
}

function shuffle<T>(list: T[], rng: Rng): T[] {
  const a = list.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 같은 영어 문장은 하나만 (빈 문장은 뺀다)
function unique<T extends Pair>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((x) => {
    const k = x.en.trim()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// 오늘 풀 문장: 오늘(또는 지난) 복습할 것을 먼저, 처음 보는 문장을 섞어서 최대 n개.
// 복습할 것이 많아도 처음 보는 문장이 2개까지는 끼게 해서 새 문장도 조금씩 들어온다
export function pickQuiz<T extends Pair>(learned: T[], stats: QuizStats, today: string, n = 8, rng: Rng = Math.random): T[] {
  const list = unique(learned)
  const due = list
    .filter((x) => stats[x.en] && stats[x.en].due <= today)
    .sort((a, b) => stats[a.en].due.localeCompare(stats[b.en].due) || stats[a.en].box - stats[b.en].box)
  // 처음 보는 문장은 최근에 모은 것부터
  const fresh = list.filter((x) => !stats[x.en]).reverse()
  const freshCount = Math.min(fresh.length, Math.max(Math.min(2, n), n - due.length))
  const picked = [...due.slice(0, n - freshCount), ...fresh.slice(0, freshCount)]
  return shuffle(picked, rng)
}

// 오늘 할 것은 다 했지만 더 풀고 싶을 때: 다음 복습 날이 가까운 것부터
export function pickAhead<T extends Pair>(learned: T[], stats: QuizStats, n = 8, rng: Rng = Math.random): T[] {
  const list = unique(learned).sort((a, b) => (stats[a.en]?.due ?? '').localeCompare(stats[b.en]?.due ?? ''))
  return shuffle(list.slice(0, n), rng)
}

// 다음 복습 날 (가장 이른 날). 문장장에 있는 문장만 본다
export function nextDue(learned: Pair[], stats: QuizStats): string | null {
  const dates = learned.map((x) => stats[x.en]?.due).filter((d): d is string => !!d)
  return dates.length ? dates.sort()[0] : null
}

// 이 날까지 다시 볼 문장 수
export const countDueBy = (items: Pair[], stats: QuizStats, date: string): number =>
  unique(items).filter((x) => stats[x.en] && stats[x.en].due <= date).length

// 문장이 적을 때 쓰는 오답 보기 (짧고 흔한 뜻)
export const DEFAULT_WRONG = ['나는 배가 고파요.', '오늘 날씨가 좋아요.', '내일 다시 만나요.', '이거 얼마예요?', '저는 커피를 좋아해요.']

// 순서 맞추기 조각: 띄어쓰기로 나누고 앞뒤 문장부호는 뗀다 (마침표가 마지막 조각을 알려 주지 않게)
export function splitPieces(en: string): string[] {
  return en
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, ''))
    .filter(Boolean)
}

// 맞춘 순서가 맞는지 (대소문자·문장부호·줄인 말은 따지지 않는다)
export const orderCorrect = (en: string, placed: string[]): boolean => normWords(placed.join(' ')).join(' ') === normWords(en).join(' ')

// 같은 조각이 정답과 같은 순서로 섞이지 않게 (조각이 2개 이상이고 모두 같지는 않을 때)
function scramble(pieces: string[], rng: Rng): string[] {
  if (new Set(pieces).size < 2) return pieces.slice()
  for (let i = 0; i < 6; i++) {
    const s = shuffle(pieces, rng)
    if (s.join(' ') !== pieces.join(' ')) return s
  }
  return pieces.slice().reverse()
}

function choicesFor(item: Pair, pool: Pair[], rng: Rng): string[] {
  const wrong: string[] = []
  const add = (ko: string) => {
    const k = ko.trim()
    if (k && k !== item.ko.trim() && !wrong.includes(k)) wrong.push(k)
  }
  for (const p of shuffle(pool, rng)) if (p.en !== item.en) add(p.ko)
  for (const d of shuffle(DEFAULT_WRONG, rng)) add(d)
  return shuffle([item.ko.trim(), ...wrong.slice(0, 2)], rng)
}

// 문장마다 문제 종류를 정한다: 세 종류를 돌아가며 내되, 그 문장으로 낼 수 없는 종류는 건너뛴다
//  - 뜻 고르기: 한국어 뜻이 있어야 한다
//  - 순서 맞추기: 조각이 2개 이상이고 서로 달라야 한다
//  - 말하기: 언제나 된다 (뜻이 없으면 듣고 따라 말하기)
export function buildQuestions(items: Pair[], pool: Pair[], rng: Rng = Math.random): Question[] {
  const order: QuizKind[] = ['meaning', 'speak', 'order']
  return items.map((item, i) => {
    const pieces = splitPieces(item.en)
    const can = (k: QuizKind) => (k === 'meaning' ? !!item.ko.trim() : k === 'order' ? new Set(pieces).size >= 2 : true)
    let kind: QuizKind = 'speak'
    for (let j = 0; j < order.length; j++) {
      const k = order[(i + j) % order.length]
      if (can(k)) {
        kind = k
        break
      }
    }
    return {
      kind,
      item,
      choices: kind === 'meaning' ? choicesFor(item, pool, rng) : [],
      pieces: kind === 'order' ? scramble(pieces, rng) : [],
    }
  })
}

// 말하기 정답 기준 (따라 말하기와 같다)
export const SPEAK_PASS = 0.7
