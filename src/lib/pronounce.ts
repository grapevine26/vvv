import { normWords } from './text'

export interface WordMark {
  // 화면에 보여 줄 원래 단어 (문장부호 포함)
  word: string
  // 인식된 말에 이 단어가 들어 있었는지
  ok: boolean
}

// 목표 문장의 단어마다 들렸는지 표시한다. 순서는 따지지 않고, 같은 단어는 들린 개수만큼만 맞은 것으로 센다.
// "I'm"처럼 줄인 말은 normWords가 "i am"으로 풀어 주므로, 풀린 단어가 모두 들려야 맞은 것으로 본다.
export function diffWords(target: string, said: string): WordMark[] {
  const pool = new Map<string, number>()
  for (const w of normWords(said)) pool.set(w, (pool.get(w) ?? 0) + 1)
  return target
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const parts = normWords(word)
      if (parts.length === 0) return { word, ok: true }
      const ok = parts.every((p) => (pool.get(p) ?? 0) > 0)
      if (ok) for (const p of parts) pool.set(p, (pool.get(p) ?? 0) - 1)
      return { word, ok }
    })
}

// 안 들린 단어만 (안내 문구용)
export const missedWords = (marks: WordMark[]): string[] => marks.filter((m) => !m.ok).map((m) => m.word.replace(/[.,!?;:"]/g, ''))
