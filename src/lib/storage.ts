import { DEFAULT_SETTINGS } from './config'
import { same } from './text'
import type { LearnedItem, Pair, Settings } from './types'

const KEY_SETTINGS = 'englishFriend.settings'
const KEY_LEARNED = 'englishFriend.learned'
const MAX_LEARNED = 300

// 사생활 보호 모드 등에서 저장소가 막혀도 앱은 돌아가게 한다
function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
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

// 오늘 따라 한 문장 중 처음 보는 것만 문장장에 더한다
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
