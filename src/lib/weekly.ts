import { minutesOn, streakDays } from './curriculum'
import { addDays } from './text'
import type { Progress } from './types'

// 이번 주 기록 화면에 쓰는 계산. 날짜는 모두 기기 시간 기준 'YYYY-MM-DD', 주는 월요일에 시작한다

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function weekday(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return 1
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
}

// 요일 한 글자 (월화수목금토일)
export const weekdayLabel = (date: string): string => WEEKDAYS[weekday(date)]

// 그 날짜가 들어 있는 주의 월요일
export function weekStart(date: string): string {
  const d = weekday(date)
  return addDays(date, d === 0 ? -6 : 1 - d)
}

// '10/5'처럼 짧게 (앞의 0은 뺀다)
export function shortDate(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${Number(m[1])}/${Number(m[2])}` : date
}

export interface DayBar {
  date: string
  label: string
  minutes: number
  isToday: boolean
  metGoal: boolean
}

// 최근 7일 (오늘이 맨 오른쪽)
export function lastSevenDays(progress: Progress, today: string, goal: number): DayBar[] {
  const out: DayBar[] = []
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i)
    const minutes = minutesOn(progress, date)
    out.push({ date, label: weekdayLabel(date), minutes, isToday: i === 0, metGoal: goal > 0 && minutes >= goal })
  }
  return out
}

export interface WeekStat {
  start: string
  end: string
  // 표·막대 아래에 쓰는 이름 ('이번 주', '지난주', '9/21~')
  label: string
  studyDays: number
  minutes: number
  sessions: number
  enOwnTurns: number
  koTurns: number
  enOwnWords: number
  repeats: number
  // 영어로 스스로 대답한 비율 (0~1). 대답이 하나도 없으면 null
  ratio: number | null
  // 영어로 스스로 한 대답의 평균 단어 수. 영어 대답이 없으면 null
  avgWords: number | null
}

// 최근 몇 주의 주별 기록 (오래된 주가 앞, 이번 주가 맨 뒤). 이번 주는 오늘까지만 센다
export function weeklyStats(progress: Progress, today: string, weeks = 6): WeekStat[] {
  const thisMonday = weekStart(today)
  const out: WeekStat[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const start = addDays(thisMonday, -7 * w)
    const end = addDays(start, 6)
    let minutes = 0
    let studyDays = 0
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, i)
      if (date > today) break
      const m = minutesOn(progress, date)
      minutes += m
      if (m > 0) studyDays++
    }
    const inWeek = progress.sessions.filter((s) => s.date >= start && s.date <= end && s.date <= today)
    // 시간이 기록되지 않은(0분) 대화를 한 날도 공부한 날로 친다
    const sessionDates = new Set(inWeek.map((s) => s.date))
    for (const d of sessionDates) if (minutesOn(progress, d) === 0) studyDays++
    const sum = (k: 'enOwnTurns' | 'koTurns' | 'enOwnWords' | 'repeatTurns') => inWeek.reduce((a, s) => a + s[k], 0)
    const enOwnTurns = sum('enOwnTurns')
    const koTurns = sum('koTurns')
    const enOwnWords = sum('enOwnWords')
    out.push({
      start,
      end,
      label: w === 0 ? '이번 주' : w === 1 ? '지난주' : `${shortDate(start)}~`,
      studyDays,
      minutes,
      sessions: inWeek.length,
      enOwnTurns,
      koTurns,
      enOwnWords,
      repeats: sum('repeatTurns'),
      ratio: enOwnTurns + koTurns > 0 ? enOwnTurns / (enOwnTurns + koTurns) : null,
      avgWords: enOwnTurns > 0 ? enOwnWords / enOwnTurns : null,
    })
  }
  return out
}

export const percent = (ratio: number | null): string => (ratio === null ? '-' : `${Math.round(ratio * 100)}%`)
export const words = (avg: number | null): string => (avg === null ? '-' : `${avg.toFixed(1)}단어`)

// 이번 주와 지난주를 비교한 한 줄. 좋아진 게 있으면 칭찬하고, 없으면 부담 없이 격려한다
export function compareWeeks(thisWeek: WeekStat, lastWeek: WeekStat): string {
  const nowPct = thisWeek.ratio === null ? null : Math.round(thisWeek.ratio * 100)
  const lastPct = lastWeek.ratio === null ? null : Math.round(lastWeek.ratio * 100)
  if (nowPct !== null && lastPct !== null && nowPct > lastPct)
    return `지난주보다 영어로 스스로 대답한 비율이 ${nowPct - lastPct}%p 올랐어요. 정말 잘하고 있어요!`
  if (thisWeek.minutes > lastWeek.minutes && lastWeek.minutes > 0)
    return `지난주보다 ${thisWeek.minutes - lastWeek.minutes}분 더 공부했어요. 멋져요!`
  if (thisWeek.avgWords !== null && lastWeek.avgWords !== null && thisWeek.avgWords >= lastWeek.avgWords + 0.5)
    return `지난주보다 영어 대답이 길어졌어요 (${words(lastWeek.avgWords)} → ${words(thisWeek.avgWords)}). 좋아요!`
  if (thisWeek.minutes === 0 && thisWeek.sessions === 0) return '이번 주는 아직 쉬는 중이에요. 오늘 5분만 해 볼까요?'
  if (lastWeek.minutes === 0 && lastWeek.sessions === 0)
    return `이번 주 ${thisWeek.studyDays}일, ${thisWeek.minutes}분 했어요. 좋은 시작이에요!`
  return `이번 주도 ${thisWeek.studyDays}일 했어요. 조금씩 꾸준히 하면 충분해요.`
}

export interface WeeklyReport {
  hasData: boolean
  thisWeekMinutes: number
  thisWeekDays: number
  streak: number
  todayMinutes: number
  days: DayBar[]
  weeks: WeekStat[]
  compare: string
}

export function weeklyReport(progress: Progress, today: string, goal: number): WeeklyReport {
  const weeks = weeklyStats(progress, today, 6)
  const thisWeek = weeks[weeks.length - 1]
  const lastWeek = weeks[weeks.length - 2]
  const anyDay = Object.values(progress.days ?? {}).some((m) => m > 0)
  return {
    hasData: anyDay || progress.sessions.length > 0,
    thisWeekMinutes: thisWeek.minutes,
    thisWeekDays: thisWeek.studyDays,
    streak: streakDays(progress, today),
    todayMinutes: minutesOn(progress, today),
    days: lastSevenDays(progress, today, goal),
    weeks,
    compare: compareWeeks(thisWeek, lastWeek),
  }
}
