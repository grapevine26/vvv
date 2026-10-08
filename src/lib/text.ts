import type { Segment, Turn } from './types'

export const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/
const SCRIPT_RUNS = /[ᄀ-ᇿ㄰-㆏가-힣][^A-Za-z]*|[^ᄀ-ᇿ㄰-㆏가-힣]+/g

// 한 문장에 한국어와 영어가 섞여 있으면 나눠서 각각 맞는 목소리로 읽는다
export function splitByScript(text: string): Segment[] {
  const out: Segment[] = []
  for (const run of String(text || '').match(SCRIPT_RUNS) ?? []) {
    const part = run.trim()
    if (!/[A-Za-z0-9가-힣]/.test(part)) continue
    const lang = HANGUL.test(part) ? 'ko' : 'en'
    const last = out[out.length - 1]
    if (last && last.lang === lang) last.text += ' ' + part
    else out.push({ text: part, lang })
  }
  return out
}

// 반응 → (따라 말하기가 있으면) 한국어 신호 → 따라 할 문장 순서로 읽는다
export function turnSegments(t: Turn): Segment[] {
  const segs = splitByScript(t.say)
  if (t.repeat) segs.push(...splitByScript(t.cue), ...splitByScript(t.repeat))
  return segs
}

// 따라 말하기·쓰기 확인용 비교. 점수는 화면에 보여 주지 않는다
export function normWords(s: string): string[] {
  return String(s || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\bcan't\b/g, 'can not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\b(\w+)n't\b/g, '$1 not')
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\b(\w+)'re\b/g, '$1 are')
    .replace(/\b(\w+)'ll\b/g, '$1 will')
    .replace(/\b(\w+)'ve\b/g, '$1 have')
    .replace(/\b(it|that|what|there|he|she)'s\b/g, '$1 is')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function same(a: string, b: string): boolean {
  return normWords(a).join(' ') === normWords(b).join(' ')
}

export function overlap(target: string, said: string): number {
  const t = normWords(target)
  const s = new Set(normWords(said))
  return t.length ? t.filter((w) => s.has(w)).length / t.length : 0
}

export function fmt(sec: number): string {
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
}

// 문장장 날짜는 기기 시간 기준으로 적는다 (UTC로 적으면 한국에선 아침에 어제 날짜가 된다)
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
