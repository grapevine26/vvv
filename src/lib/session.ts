import { MIN_TURNS_FOR_UNIT, minutesOn, newSessionId, promotionStatus, recordSession, streakDays, unitById } from './curriculum'
import { mergeLearned } from './storage'
import { localDate } from './text'
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
// today는 결과 문구의 '오늘'을 정한다 (어제 남은 대화를 오늘 저장할 수도 있다)
export function commitSession(data: SessionData, learned: LearnedItem[], progress: Progress, today = localDate()): CommitResult {
  const { list, added } = mergeLearned(learned, data.repeats, data.date)
  const parts = [added ? `${added}문장을 문장장에 저장했어요.` : '수고했어요.']
  if (data.stats.turns === 0) {
    if (!added) parts.push('한 번도 대답하지 않아서 기록할 게 없어요.')
    return { learned: list, progress, added, recorded: false, unitDone: false, message: parts.join(' ') }
  }

  const log = { id: newSessionId(), date: data.date, stage: data.stage, unit: data.unit, minutes: Math.max(1, Math.round(data.minutes)), ...data.stats }
  const { progress: next, unitDone } = recordSession(progress, log)
  const title = unitById(data.unit)?.title ?? '이번'
  parts.push(
    unitDone
      ? `「${title}」 단원을 마쳤어요.`
      : `「${title}」 단원은 대화 한 번에 ${MIN_TURNS_FOR_UNIT}번 주고받으면 마쳐요 (이번엔 ${data.stats.turns}번).`,
  )
  if (data.date === today) {
    const streak = streakDays(next, today)
    parts.push(`오늘 ${minutesOn(next, today)}분${streak > 1 ? ` · ${streak}일 연속` : ''}.`)
  } else {
    const [, m, d] = data.date.split('-').map(Number)
    parts.push(`${m}월 ${d}일 기록으로 남겼어요.`)
  }
  if (promotionStatus(next)?.ready) parts.push('다음 단계로 올라갈 준비가 됐어요!')
  return { learned: list, progress: next, added, recorded: true, unitDone, message: parts.join(' ') }
}
