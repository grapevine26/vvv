import { DEFAULT_SETTINGS, MAX_LEARNED } from './config'
import { sanitizeProgress } from './curriculum'
import { same } from './text'
import type { Draft, LearnedItem, Message, Pair, Progress, SessionStats, Settings } from './types'

const KEY_SETTINGS = 'englishFriend.settings'
const KEY_LEARNED = 'englishFriend.learned'
const KEY_PROGRESS = 'englishFriend.progress'
const KEY_DRAFT_PREFIX = 'englishFriend.draft.'
const KEY_DAILY = 'englishFriend.daily'
const KEY_TAB = 'englishFriend.tabId'

// 이 앱이 쓰는 저장 키인지 (다른 탭에서 바뀐 것을 알아챌 때 쓴다)
export const isAppKey = (key: string | null): boolean => !!key && key.startsWith('englishFriend.')

// 사생활 보호 모드 등에서 저장소가 막혀도 앱은 돌아가게 한다
export function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// 저장소를 실제로 쓸 수 있는지 (막혀 있으면 화면은 메모리 값으로 이어 간다)
export function storageWorks(): boolean {
  try {
    localStorage.setItem('__ef_test', '1')
    localStorage.removeItem('__ef_test')
    return true
  } catch {
    return false
  }
}

export function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function loadSettings(): Settings {
  const saved = read(KEY_SETTINGS)
  const result: Settings = { ...DEFAULT_SETTINGS }
  if (saved && typeof saved === 'object') {
    const src = saved as Record<string, unknown>
    const dst = result as unknown as Record<string, unknown>
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      // 저장된 값의 모양이 기본값과 다르면(옛 버전 등) 기본값을 쓴다
      if (typeof src[key] === typeof dst[key]) dst[key] = src[key]
    }
  }
  return result
}

export const saveSettings = (s: Settings): boolean => write(KEY_SETTINGS, s)

export function loadLearned(): LearnedItem[] {
  const saved = read(KEY_LEARNED)
  if (!Array.isArray(saved)) return []
  return saved
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).en === 'string')
    .map((x) => ({ en: String(x.en), ko: String(x.ko ?? ''), date: String(x.date ?? '') }))
}

export const saveLearned = (list: LearnedItem[]): boolean => write(KEY_LEARNED, list)

export const loadProgress = (): Progress => sanitizeProgress(read(KEY_PROGRESS))

export const saveProgress = (p: Progress): boolean => write(KEY_PROGRESS, p)

// 오늘 따라 한 문장 중 처음 보는 것만 내 문장 노트에 더한다
export function mergeLearned(learned: LearnedItem[], repeats: Pair[], today: string): { list: LearnedItem[]; added: number } {
  const list = learned.slice()
  let added = 0
  for (const r of repeats) {
    if (!list.some((l) => same(l.en, r.en))) {
      list.push({ en: r.en, ko: r.ko, date: today })
      added++
    }
  }
  return { list: list.slice(-MAX_LEARNED), added }
}

// ── 탭 구분 ──
// 탭마다 고유 번호. sessionStorage라서 새로고침해도 같은 탭이면 같은 번호다
export function getTabId(): string {
  try {
    const saved = sessionStorage.getItem(KEY_TAB)
    if (saved) return saved
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2)
    sessionStorage.setItem(KEY_TAB, id)
    return id
  } catch {
    return 'tab-' + String(Math.random()).slice(2)
  }
}

// ── 대화 임시 저장 (탭마다 따로) ──
// 다른 탭이 이 시간 안에 갱신했으면 아직 그 탭에서 대화 중이라고 본다
export const DRAFT_ACTIVE_MS = 30_000

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'

function sanitizeStats(v: unknown): SessionStats {
  const o = isObj(v) ? v : {}
  return { turns: num(o.turns), koTurns: num(o.koTurns), enOwnTurns: num(o.enOwnTurns), enOwnWords: num(o.enOwnWords), repeatTurns: num(o.repeatTurns) }
}

function sanitizeDraft(v: unknown): Draft | null {
  if (!isObj(v) || typeof v.tabId !== 'string' || typeof v.date !== 'string' || typeof v.unit !== 'string') return null
  if (!Array.isArray(v.messages) || !Array.isArray(v.history) || !Array.isArray(v.repeats)) return null
  const messages = v.messages.filter(
    (m): m is Message =>
      isObj(m) &&
      typeof m.id === 'number' &&
      ((m.kind === 'ai' && isObj(m.turn) && typeof (m.turn as Record<string, unknown>).say === 'string') ||
        (m.kind === 'me' && typeof m.text === 'string') ||
        (m.kind === 'error' && typeof m.text === 'string')),
  )
  const history = v.history.filter(
    (h): h is Draft['history'][number] =>
      isObj(h) && (h.role === 'user' || h.role === 'model') && Array.isArray(h.parts) && isObj(h.parts[0]) && typeof h.parts[0].text === 'string',
  )
  const repeats = v.repeats.filter((r): r is Pair => isObj(r) && typeof r.en === 'string').map((r) => ({ en: r.en, ko: String(r.ko ?? '') }))
  return {
    tabId: v.tabId,
    savedAt: num(v.savedAt),
    date: v.date,
    activeMs: num(v.activeMs),
    limitSec: num(v.limitSec),
    stage: num(v.stage) || 1,
    unit: v.unit,
    stats: sanitizeStats(v.stats),
    repeats,
    messages,
    history,
    pendingRepeat: typeof v.pendingRepeat === 'string' ? v.pendingRepeat : '',
  }
}

export const saveDraft = (d: Draft): boolean => write(KEY_DRAFT_PREFIX + d.tabId, d)

export function clearDraft(tab: string): void {
  try {
    localStorage.removeItem(KEY_DRAFT_PREFIX + tab)
  } catch {
    // 저장소가 막혀 있으면 지울 것도 없다
  }
}

// 이 탭의 임시 저장이 아직 있는지. 저장소를 못 읽으면 null (모름)
export function draftExists(tab: string): boolean | null {
  try {
    return localStorage.getItem(KEY_DRAFT_PREFIX + tab) !== null
  } catch {
    return null
  }
}

export const draftKey = (tab: string) => KEY_DRAFT_PREFIX + tab

export function loadDrafts(): Draft[] {
  const drafts: Draft[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(KEY_DRAFT_PREFIX)) continue
      const d = sanitizeDraft(read(key))
      if (d) drafts.push(d)
    }
  } catch {
    return []
  }
  return drafts.sort((a, b) => b.savedAt - a.savedAt)
}

// 되살릴 수 있는 임시 저장: 이 탭의 것(새로고침·다시 열기 전 대화)이거나, 다른 탭에서 한동안 갱신이 없는 것
export function resumableDrafts(drafts: Draft[], myTab: string, now: number): Draft[] {
  return drafts.filter((d) => (d.tabId === myTab || now - d.savedAt > DRAFT_ACTIVE_MS) && (d.stats.turns > 0 || d.repeats.length > 0))
}

// 다른 탭에서 지금 대화 중인 것
export function activeElsewhere(drafts: Draft[], myTab: string, now: number): boolean {
  return drafts.some((d) => d.tabId !== myTab && now - d.savedAt <= DRAFT_ACTIVE_MS)
}

// ── 오늘 할 일 체크 (날짜가 바뀌면 비운다) ──
export function loadDailyChecks(today: string): number[] {
  const v = read(KEY_DAILY)
  if (!isObj(v) || v.date !== today || !Array.isArray(v.checks)) return []
  return v.checks.filter((x): x is number => typeof x === 'number')
}

export const saveDailyChecks = (today: string, checks: number[]): boolean => write(KEY_DAILY, { date: today, checks })
