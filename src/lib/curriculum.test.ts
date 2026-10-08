import { describe, expect, it } from 'vitest'
import {
  changeStage,
  chooseUnit,
  DEFAULT_PROGRESS,
  getUnit,
  mergeProgress,
  newSessionId,
  promotionStatus,
  recordSession,
  sanitizeProgress,
  STAGES,
  totalMinutes,
} from './curriculum'
import type { Progress, SessionLog } from './types'

function log(over: Partial<SessionLog> = {}): SessionLog {
  return { id: newSessionId(), date: '2026-10-08', stage: 1, unit: 's1-1', minutes: 15, turns: 8, koTurns: 2, enOwnTurns: 5, enOwnWords: 20, repeatTurns: 1, ...over }
}

describe('교육과정 데이터', () => {
  it('6단계, 단계마다 단원 10개, 단원 번호는 겹치지 않는다', () => {
    expect(STAGES.map((s) => s.cefr)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])
    for (const s of STAGES) expect(s.units).toHaveLength(10)
    const ids = STAGES.flatMap((s) => s.units.map((u) => u.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('단계가 오를수록 승급 기준이 높아지고, 마지막 단계는 승급이 없다', () => {
    const promotes = STAGES.map((s) => s.promote)
    expect(promotes[5]).toBeNull()
    for (let i = 1; i < 5; i++) {
      expect(promotes[i]!.words).toBeGreaterThan(promotes[i - 1]!.words)
      expect(promotes[i]!.ratio).toBeGreaterThanOrEqual(promotes[i - 1]!.ratio)
    }
  })
})

describe('recordSession', () => {
  it('5번 이상 주고받으면 단원을 마치고 다음 단원으로', () => {
    const { progress, unitDone } = recordSession(DEFAULT_PROGRESS, log())
    expect(unitDone).toBe(true)
    expect(progress.doneUnits).toEqual(['s1-1'])
    expect(progress.unit).toBe('s1-2')
    expect(progress.sessions).toHaveLength(1)
  })

  it('너무 짧으면 기록만 하고 단원은 그대로', () => {
    const { progress, unitDone } = recordSession(DEFAULT_PROGRESS, log({ turns: 2 }))
    expect(unitDone).toBe(false)
    expect(progress.doneUnits).toEqual([])
    expect(progress.unit).toBe('s1-1')
    expect(progress.sessions).toHaveLength(1)
  })

  it('다음 단원은 아직 안 한 것 중에서 고른다', () => {
    const p: Progress = { ...DEFAULT_PROGRESS, doneUnits: ['s1-2', 's1-3'], unit: 's1-1' }
    expect(recordSession(p, log()).progress.unit).toBe('s1-4')
  })
})

describe('promotionStatus', () => {
  it('단원을 다 하고 최근 대화가 기준을 넘으면 준비 완료', () => {
    const allDone: Progress = { ...DEFAULT_PROGRESS, doneUnits: STAGES[0].units.map((u) => u.id) }
    const good = { ...allDone, sessions: [log({ koTurns: 2, enOwnTurns: 6, enOwnWords: 24 })] }
    const status = promotionStatus(good)!
    expect(status.criteria.map((c) => c.ok)).toEqual([true, true, true])
    expect(status.ready).toBe(true)
  })

  it('영어로 스스로 대답한 비율이 낮으면 아직', () => {
    const allDone: Progress = { ...DEFAULT_PROGRESS, doneUnits: STAGES[0].units.map((u) => u.id) }
    const status = promotionStatus({ ...allDone, sessions: [log({ koTurns: 8, enOwnTurns: 2, enOwnWords: 10 })] })!
    expect(status.criteria[1]).toMatchObject({ ok: false, current: '20%', target: '50%' })
    expect(status.ready).toBe(false)
  })

  it('대화 기록이 없으면 준비 안 됨', () => {
    expect(promotionStatus(DEFAULT_PROGRESS)!.ready).toBe(false)
  })

  it('다른 단계 기록은 세지 않는다', () => {
    const p: Progress = { ...changeStage(DEFAULT_PROGRESS, 2), sessions: [log({ stage: 1, enOwnTurns: 10, enOwnWords: 100, koTurns: 0 })] }
    expect(promotionStatus(p)!.criteria[1].ok).toBe(false)
  })

  it('마지막 단계는 null', () => {
    expect(promotionStatus(changeStage(DEFAULT_PROGRESS, 6))).toBeNull()
  })
})

describe('단계·단원 바꾸기', () => {
  it('단계를 바꾸면 그 단계의 첫 미완료 단원으로', () => {
    const p = changeStage({ ...DEFAULT_PROGRESS, doneUnits: ['s3-1'] }, 3)
    expect(p.stage).toBe(3)
    expect(getUnit(p).id).toBe('s3-2')
  })

  it('다른 단계의 단원은 고를 수 없다', () => {
    expect(chooseUnit(DEFAULT_PROGRESS, 's4-1').unit).toBe('s1-1')
    expect(chooseUnit(DEFAULT_PROGRESS, 's1-5').unit).toBe('s1-5')
  })
})

describe('mergeProgress (두 기기 합치기)', () => {
  it('높은 단계, 마친 단원 합집합, 대화 기록은 겹치지 않게', () => {
    const shared = log({ id: '000000001-aaaaa' })
    const pc: Progress = { stage: 1, unit: 's1-3', doneUnits: ['s1-1', 's1-2'], sessions: [shared] }
    const phone: Progress = {
      stage: 2,
      unit: 's2-2',
      doneUnits: ['s1-1', 's2-1'],
      sessions: [shared, log({ id: '000000002-bbbbb', stage: 2, unit: 's2-1' })],
    }
    const merged = mergeProgress(pc, phone)
    expect(merged.stage).toBe(2)
    expect(merged.unit).toBe('s2-2')
    expect(merged.doneUnits.sort()).toEqual(['s1-1', 's1-2', 's2-1'])
    expect(merged.sessions.map((s) => s.id)).toEqual(['000000001-aaaaa', '000000002-bbbbb'])
    expect(totalMinutes(merged)).toBe(30)
  })
})

describe('sanitizeProgress', () => {
  it('깨진 값이면 처음부터', () => {
    expect(sanitizeProgress(null)).toEqual(DEFAULT_PROGRESS)
    expect(sanitizeProgress('x')).toEqual(DEFAULT_PROGRESS)
  })

  it('없는 단원·단계는 버리고 쓸 수 있는 값만 남긴다', () => {
    const p = sanitizeProgress({ stage: 9, unit: 'zz', doneUnits: ['s1-1', 'nope', 3], sessions: [{ id: 'a', minutes: 'x' }, null] })
    expect(p.stage).toBe(1)
    expect(p.unit).toBe('s1-2')
    expect(p.doneUnits).toEqual(['s1-1'])
    expect(p.sessions).toHaveLength(1)
    expect(p.sessions[0].minutes).toBe(0)
  })
})

describe('newSessionId', () => {
  it('시간순으로 정렬된다', () => {
    expect(newSessionId(1000) < newSessionId(2000)).toBe(true)
  })
})
