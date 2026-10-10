import { describe, expect, it } from 'vitest'
import { DEFAULT_PROGRESS, doneToday, mergeProgress, minutesOn, recordSession, sanitizeProgress, streakDays } from './curriculum'
import { pickReview } from './prompt'
import { commitSession, EMPTY_STATS } from './session'
import { addDays, dayDiff } from './text'
import type { Progress, SessionLog } from './types'

const log = (date: string, minutes = 10, turns = 6): SessionLog => ({
  id: `${date}-${minutes}-${turns}`,
  date,
  stage: 1,
  unit: 's1-1',
  minutes,
  turns,
  koTurns: 1,
  enOwnTurns: 3,
  enOwnWords: 9,
  repeatTurns: 2,
})

describe('날짜 계산', () => {
  it('dayDiff와 addDays (달·해 넘김 포함)', () => {
    expect(dayDiff('2026-10-01', '2026-10-08')).toBe(7)
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1)
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(Number.isNaN(dayDiff('', '2026-10-08'))).toBe(true)
  })
})

describe('연속 학습일·오늘 공부 시간', () => {
  const p = (dates: string[]): Progress => ({ ...DEFAULT_PROGRESS, sessions: dates.map((d) => log(d)) })
  it('오늘·어제·그제면 3일', () => {
    expect(streakDays(p(['2026-10-06', '2026-10-07', '2026-10-08']), '2026-10-08')).toBe(3)
  })
  it('어제가 비면 1일', () => {
    expect(streakDays(p(['2026-10-06', '2026-10-08']), '2026-10-08')).toBe(1)
  })
  it('오늘 아직 안 했으면 어제부터 센다', () => {
    expect(streakDays(p(['2026-10-06', '2026-10-07']), '2026-10-08')).toBe(2)
  })
  it('기록이 없으면 0', () => {
    expect(streakDays(DEFAULT_PROGRESS, '2026-10-08')).toBe(0)
  })
  it('그날 공부한 분을 더하고, 오늘 마친 단원을 찾는다', () => {
    const prog = { ...DEFAULT_PROGRESS, sessions: [log('2026-10-08', 7, 3), log('2026-10-08', 5, 6), log('2026-10-07', 9)] }
    expect(minutesOn(prog, '2026-10-08')).toBe(12)
    expect(doneToday(prog, '2026-10-08')?.minutes).toBe(5)
    expect(doneToday({ ...prog, sessions: [log('2026-10-08', 7, 3)] }, '2026-10-08')).toBeNull()
  })
  it('대화 기록이 300개로 잘려도 연속 일수와 그날 분은 이어진다', () => {
    let prog: Progress = { ...DEFAULT_PROGRESS }
    for (let i = 399; i >= 0; i--) prog = recordSession(prog, { ...log(addDays('2026-10-08', -i), 10, 2), id: `x${1000 - i}` }).progress
    expect(prog.sessions).toHaveLength(300)
    expect(streakDays(prog, '2026-10-08')).toBe(400)
    expect(minutesOn(prog, addDays('2026-10-08', -399))).toBe(10)
    // 저장했다가 다시 읽어도(옛 버전처럼 days가 없어도) 같은 값
    expect(streakDays(sanitizeProgress(JSON.parse(JSON.stringify(prog))), '2026-10-08')).toBe(400)
    expect(minutesOn(sanitizeProgress({ ...prog, days: undefined }), '2026-10-08')).toBe(10)
  })
  it('두 기기 진도를 합치면 날짜별 분은 겹치지 않게 합친다', () => {
    const a: Progress = { ...DEFAULT_PROGRESS, sessions: [log('2026-10-08', 7)], days: { '2026-10-08': 7, '2026-10-01': 30 } }
    const b: Progress = { ...DEFAULT_PROGRESS, sessions: [log('2026-10-08', 7), { ...log('2026-10-08', 5), id: 'other' }] }
    const m = mergeProgress(a, b)
    expect(minutesOn(m, '2026-10-08')).toBe(12)
    expect(minutesOn(m, '2026-10-01')).toBe(30)
  })
})

describe('pickReview (복습 문장 고르기)', () => {
  const learned = Array.from({ length: 12 }, (_, i) => ({ en: `S${i}`, ko: `${i}`, date: addDays('2026-10-08', -(40 - i * 3)) }))

  it('8개, 최근 3개 포함, 오래된 문장도 섞임, 같은 날엔 같은 결과', () => {
    const a = pickReview(learned, '2026-10-08')
    expect(a).toHaveLength(8)
    for (const x of learned.slice(-3)) expect(a).toContainEqual(x)
    expect(a.some((x) => learned.slice(0, 4).includes(x))).toBe(true)
    expect(pickReview(learned, '2026-10-08')).toEqual(a)
  })

  it('n을 넘기지 않는다 (간격 복습 대상이 많아도)', () => {
    const today = '2026-10-08'
    const ago = [60, 45, 30, 20, 14, 10, 7, 5, 3, 2, 1, 0, 0, 0]
    const many = ago.map((d, i) => ({ en: `S${i}.`, ko: '', date: addDays(today, -d) }))
    expect(pickReview(many, today, 5)).toHaveLength(5)
    expect(pickReview(many, today)).toHaveLength(8)
  })

  it('문장이 적으면 전부', () => {
    expect(pickReview(learned.slice(0, 5), '2026-10-08')).toHaveLength(5)
  })
})

describe('commitSession', () => {
  const data = { repeats: [{ en: "I'm tired.", ko: '피곤해.' }], stats: { ...EMPTY_STATS, turns: 6, enOwnTurns: 4, enOwnWords: 12 }, minutes: 9.6, date: '2026-10-08', stage: 1, unit: 's1-1' }

  it('최신 내 문장 노트에 합치고, 단원을 마치고, 결과 문구를 만든다', () => {
    const latest = [{ en: 'Hello.', ko: '안녕', date: '2026-10-07' }]
    const r = commitSession(data, latest, DEFAULT_PROGRESS, '2026-10-08')
    expect(r.learned.map((x) => x.en)).toEqual(['Hello.', "I'm tired."])
    expect(r.unitDone).toBe(true)
    expect(r.progress.unit).toBe('s1-2')
    expect(r.progress.sessions[0].minutes).toBe(10)
    expect(r.message).toContain('1문장을 내 문장 노트에 저장했어요')
    expect(r.message).toContain('「인사와 자기소개」 단원을 마쳤어요')
    expect(r.message).toContain('오늘 10분')
    expect(r.progress.days).toEqual({ '2026-10-08': 10 })
  })

  it('덜 주고받았으면 대화 한 번 기준이라고 알려 준다 (다음 대화에서 다시 5번)', () => {
    const r = commitSession({ ...data, stats: { ...data.stats, turns: 3 } }, [], DEFAULT_PROGRESS, '2026-10-08')
    expect(r.unitDone).toBe(false)
    expect(r.message).toContain('대화 한 번에 5번 주고받으면 마쳐요 (이번엔 3번)')
  })

  it('어제 남은 대화를 오늘 저장하면 "오늘 N분"이라고 하지 않는다', () => {
    const r = commitSession({ ...data, date: '2026-10-07' }, [], DEFAULT_PROGRESS, '2026-10-08')
    expect(r.message).not.toContain('오늘')
    expect(r.message).toContain('10월 7일 기록으로 남겼어요')
    expect(r.progress.sessions[0].date).toBe('2026-10-07')
  })

  it('그사이 다른 단원을 골라 두었으면 단원을 마쳐도 그 선택을 지킨다', () => {
    const picked = { ...DEFAULT_PROGRESS, unit: 's1-7' }
    const r = commitSession(data, [], picked, '2026-10-08')
    expect(r.unitDone).toBe(true)
    expect(r.progress.doneUnits).toEqual(['s1-1'])
    expect(r.progress.unit).toBe('s1-7')
  })

  it('한 번도 주고받지 않았으면 기록하지 않고, 그렇다고 알려 준다', () => {
    const r = commitSession({ ...data, repeats: [], stats: { ...EMPTY_STATS } }, [], DEFAULT_PROGRESS)
    expect(r.recorded).toBe(false)
    expect(r.progress.sessions).toHaveLength(0)
    expect(r.message).toContain('기록할 게 없어요')
  })
})
