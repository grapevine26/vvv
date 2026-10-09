import { describe, expect, it } from 'vitest'
import { DEFAULT_PROGRESS } from './curriculum'
import type { Progress, SessionLog } from './types'
import { compareWeeks, lastSevenDays, shortDate, weekdayLabel, weeklyReport, weeklyStats, weekStart, type WeekStat } from './weekly'

// 2026-10-08은 목요일
const TODAY = '2026-10-08'

let n = 0
function log(date: string, o: Partial<SessionLog> = {}): SessionLog {
  n++
  return {
    id: `00-${String(n).padStart(4, '0')}`,
    date,
    stage: 1,
    unit: 's1-1',
    minutes: 10,
    turns: 6,
    koTurns: 0,
    enOwnTurns: 0,
    enOwnWords: 0,
    repeatTurns: 0,
    ...o,
  }
}

const prog = (sessions: SessionLog[], days: Record<string, number> = {}): Progress => ({ ...DEFAULT_PROGRESS, sessions, days })

describe('날짜 도우미', () => {
  it('요일과 주의 월요일', () => {
    expect(weekdayLabel(TODAY)).toBe('목')
    expect(weekdayLabel('2026-10-05')).toBe('월')
    expect(weekdayLabel('2026-10-11')).toBe('일')
    expect(weekStart(TODAY)).toBe('2026-10-05')
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
    // 일요일은 그 전 월요일의 주
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
    // 달·해가 바뀌어도
    expect(weekStart('2026-01-01')).toBe('2025-12-29')
    expect(shortDate('2026-09-07')).toBe('9/7')
  })
})

describe('최근 7일', () => {
  it('오늘이 맨 오른쪽, 요일 라벨, 목표 달성', () => {
    const p = prog([log(TODAY, { minutes: 12 }), log('2026-10-06', { minutes: 5 })], { '2026-10-02': 20 })
    const days = lastSevenDays(p, TODAY, 10)
    expect(days.map((d) => d.label).join('')).toBe('금토일월화수목')
    expect(days.map((d) => d.minutes)).toEqual([20, 0, 0, 0, 5, 0, 12])
    expect(days[6]).toMatchObject({ date: TODAY, isToday: true, metGoal: true })
    expect(days[4].metGoal).toBe(false)
    expect(days.filter((d) => d.isToday)).toHaveLength(1)
  })
})

describe('주별 기록', () => {
  it('6주, 이번 주가 맨 뒤, 비율·평균 길이·따라 말하기', () => {
    const p = prog([
      // 이번 주 (10/5~)
      log('2026-10-05', { minutes: 10, enOwnTurns: 6, koTurns: 2, enOwnWords: 18, repeatTurns: 3 }),
      log('2026-10-07', { minutes: 15, enOwnTurns: 2, koTurns: 0, enOwnWords: 10, repeatTurns: 1 }),
      // 지난주 (9/28~)
      log('2026-09-28', { minutes: 8, enOwnTurns: 1, koTurns: 3, enOwnWords: 2 }),
      // 미래 날짜는 세지 않는다
      log('2026-10-10', { minutes: 99, enOwnTurns: 9 }),
      // 6주보다 오래된 것
      log('2026-08-01', { minutes: 30, enOwnTurns: 5 }),
    ])
    const ws = weeklyStats(p, TODAY)
    expect(ws).toHaveLength(6)
    expect(ws.map((w) => w.start)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'])
    expect(ws.map((w) => w.label)).toEqual(['8/31~', '9/7~', '9/14~', '9/21~', '지난주', '이번 주'])
    const now = ws[5]
    expect(now).toMatchObject({ studyDays: 2, minutes: 25, sessions: 2, enOwnTurns: 8, koTurns: 2, repeats: 4 })
    expect(now.ratio).toBeCloseTo(0.8)
    expect(now.avgWords).toBeCloseTo(3.5)
    expect(ws[4].ratio).toBeCloseTo(0.25)
    expect(ws[0]).toMatchObject({ minutes: 0, studyDays: 0, ratio: null, avgWords: null })
  })

  it('대화 기록이 잘려도 날짜별 분(days)으로 시간과 공부한 날을 센다', () => {
    const ws = weeklyStats(prog([], { '2026-10-06': 7, '2026-10-08': 3 }), TODAY)
    expect(ws[5]).toMatchObject({ minutes: 10, studyDays: 2, sessions: 0, ratio: null })
  })
})

const week = (o: Partial<WeekStat>): WeekStat => ({
  start: '',
  end: '',
  label: '',
  studyDays: 0,
  minutes: 0,
  sessions: 0,
  enOwnTurns: 0,
  koTurns: 0,
  enOwnWords: 0,
  repeats: 0,
  ratio: null,
  avgWords: null,
  ...o,
})

describe('이번 주 vs 지난주 한 줄', () => {
  it('비율이 오르면 칭찬', () => {
    expect(compareWeeks(week({ ratio: 0.8, minutes: 5, sessions: 1 }), week({ ratio: 0.5, minutes: 30, sessions: 3 }))).toBe(
      '지난주보다 영어로 스스로 대답한 비율이 30%p 올랐어요. 정말 잘하고 있어요!',
    )
  })
  it('시간이 늘면 칭찬', () => {
    expect(compareWeeks(week({ minutes: 40, sessions: 2 }), week({ minutes: 25, sessions: 2 }))).toBe('지난주보다 15분 더 공부했어요. 멋져요!')
  })
  it('대답이 길어지면 칭찬', () => {
    expect(compareWeeks(week({ minutes: 10, sessions: 1, avgWords: 4 }), week({ minutes: 20, sessions: 2, avgWords: 3 }))).toContain('길어졌어요')
  })
  it('아직 안 했으면 부담 없는 격려', () => {
    expect(compareWeeks(week({}), week({ minutes: 20, sessions: 2 }))).toBe('이번 주는 아직 쉬는 중이에요. 오늘 5분만 해 볼까요?')
  })
  it('지난주가 없으면 좋은 시작', () => {
    expect(compareWeeks(week({ minutes: 12, studyDays: 2, sessions: 2 }), week({}))).toBe('이번 주 2일, 12분 했어요. 좋은 시작이에요!')
  })
  it('나아진 게 없으면 꾸준함을 격려', () => {
    expect(compareWeeks(week({ minutes: 10, studyDays: 1, sessions: 1, ratio: 0.5 }), week({ minutes: 30, sessions: 3, ratio: 0.6 }))).toBe(
      '이번 주도 1일 했어요. 조금씩 꾸준히 하면 충분해요.',
    )
  })
})

describe('전체 요약', () => {
  it('기록이 없으면 hasData가 false', () => {
    const r = weeklyReport(prog([]), TODAY, 15)
    expect(r.hasData).toBe(false)
    expect(r.thisWeekMinutes).toBe(0)
    expect(r.days).toHaveLength(7)
  })
  it('이번 주 분·일·연속 일수', () => {
    const r = weeklyReport(prog([log(TODAY, { minutes: 5 }), log('2026-10-07', { minutes: 6 }), log('2026-10-04', { minutes: 9 })]), TODAY, 15)
    expect(r).toMatchObject({ hasData: true, thisWeekMinutes: 11, thisWeekDays: 2, streak: 2, todayMinutes: 5 })
  })
})
