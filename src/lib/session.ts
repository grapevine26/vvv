import { MIN_TURNS_FOR_UNIT, minutesOn, newSessionId, promotionStatus, recordSession, streakDays, unitById } from './curriculum'
import { mergeLearned } from './storage'
import type { LearnedItem, Pair, Progress, SessionStats } from './types'

export const EMPTY_STATS: SessionStats = { turns: 0, koTurns: 0, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 }

export interface SessionData {
  repeats: Pair[]
  stats: SessionStats
  minutes: number
  date: string
  stage: number
  unit: string
}

export interface CommitResult {
  learned: LearnedItem[]
  progress: Progress
  added: number
  recorded: boolean
  unitDone: boolean
  message: string
}

// 대화 한 번을 문장장과 진도에 반영한다.
// learned·progress는 저장 직전에 저장소에서 다시 읽은 최신 값을 넘긴다 (다른 탭에서 저장한 것을 덮어쓰지 않게)
export function commitSession(data: SessionData, learned: LearnedItem[], progress: Progress): CommitResult {
  const { list, added } = mergeLearned(learned, data.repeats, data.date)
  const parts = [added ? `${added}문장을 문장장에 저장했어요.` : '수고했어요.']
  if (data.stats.turns === 0) return { learned: list, progress, added, recorded: false, unitDone: false, message: parts.join(' ') }

  const log = { id: newSessionId(), date: data.date, stage: data.stage, unit: data.unit, minutes: Math.max(1, Math.round(data.minutes)), ...data.stats }
  const { progress: next, unitDone } = recordSession(progress, log)
  const title = unitById(data.unit)?.title ?? '이번'
  parts.push(
    unitDone
      ? `「${title}」 단원을 마쳤어요.`
      : `「${title}」 단원은 ${MIN_TURNS_FOR_UNIT - data.stats.turns}번 더 주고받으면 마쳐요.`,
  )
  const streak = streakDays(next, data.date)
  parts.push(`오늘 ${minutesOn(next, data.date)}분${streak > 1 ? ` · ${streak}일 연속` : ''}.`)
  if (promotionStatus(next)?.ready) parts.push('다음 단계로 올라갈 준비가 됐어요!')
  return { learned: list, progress: next, added, recorded: true, unitDone, message: parts.join(' ') }
}
