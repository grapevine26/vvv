import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_STATS } from './session'
import {
  activeElsewhere,
  clearDraft,
  DRAFT_ACTIVE_MS,
  getTabId,
  loadDailyChecks,
  loadDrafts,
  resumableDrafts,
  saveDailyChecks,
  saveDraft,
} from './storage'
import type { Draft } from './types'

// 테스트용 브라우저 저장소
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})

function draft(over: Partial<Draft> = {}): Draft {
  return {
    tabId: 'A',
    savedAt: 1_000_000,
    date: '2026-10-08',
    activeMs: 120_000,
    limitSec: 900,
    stage: 1,
    unit: 's1-3',
    stats: { ...EMPTY_STATS, turns: 2, koTurns: 1, enOwnTurns: 1, enOwnWords: 3 },
    repeats: [{ en: "I'm tired.", ko: '피곤해.' }],
    messages: [{ kind: 'me', id: 1, text: '피곤해', lang: 'ko', isRepeat: false }],
    history: [{ role: 'user', parts: [{ text: '[한국어] 피곤해' }] }],
    pendingRepeat: "I'm tired.",
    ...over,
  }
}

describe('탭 번호', () => {
  it('같은 탭(새로고침)에서는 같은 번호', () => {
    const a = getTabId()
    expect(getTabId()).toBe(a)
  })
})

describe('대화 임시 저장', () => {
  it('탭마다 따로 저장하고 최근 것부터 읽는다', () => {
    saveDraft(draft({ tabId: 'A', savedAt: 1 }))
    saveDraft(draft({ tabId: 'B', savedAt: 2 }))
    expect(loadDrafts().map((d) => d.tabId)).toEqual(['B', 'A'])
    clearDraft('B')
    expect(loadDrafts().map((d) => d.tabId)).toEqual(['A'])
  })

  it('깨진 저장값은 버린다', () => {
    localStorage.setItem('englishFriend.draft.X', '{"tabId":"X"}')
    localStorage.setItem('englishFriend.draft.Y', 'not json')
    saveDraft(draft())
    expect(loadDrafts()).toHaveLength(1)
  })

  it('이상한 말풍선은 걸러 낸다', () => {
    saveDraft(draft({ messages: [{ kind: 'me', id: 1, text: 'ok', lang: 'ko', isRepeat: false }, { kind: 'ai', id: 2 } as never] }))
    expect(loadDrafts()[0].messages).toHaveLength(1)
  })

  it('이 탭의 것은 바로, 다른 탭 것은 한동안 갱신이 없을 때만 되살린다', () => {
    const now = 10_000_000
    const mine = draft({ tabId: 'ME', savedAt: now - 1000 })
    const otherActive = draft({ tabId: 'B', savedAt: now - 1000 })
    const otherStale = draft({ tabId: 'C', savedAt: now - DRAFT_ACTIVE_MS - 1 })
    const empty = draft({ tabId: 'D', savedAt: 0, stats: { ...EMPTY_STATS }, repeats: [] })
    const all = [mine, otherActive, otherStale, empty]
    expect(resumableDrafts(all, 'ME', now).map((d) => d.tabId)).toEqual(['ME', 'C'])
    expect(activeElsewhere(all, 'ME', now)).toBe(true)
    expect(activeElsewhere([mine, otherStale], 'ME', now)).toBe(false)
  })
})

describe('오늘 할 일 체크', () => {
  it('같은 날에만 남는다', () => {
    saveDailyChecks('2026-10-08', [1, 2])
    expect(loadDailyChecks('2026-10-08')).toEqual([1, 2])
    expect(loadDailyChecks('2026-10-09')).toEqual([])
  })
})
