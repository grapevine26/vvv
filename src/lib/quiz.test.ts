import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildQuestions,
  countDueBy,
  DEFAULT_WRONG,
  grade,
  loadQuizStats,
  nextDue,
  orderCorrect,
  pickAhead,
  pickQuiz,
  QUIZ_KEY,
  sanitizeQuizStats,
  saveQuizStats,
  splitPieces,
  type QuizStats,
} from './quiz'

const TODAY = '2026-10-08'
const item = (en: string, ko = en + ' 뜻') => ({ en, ko, date: '2026-10-01' })
// 늘 같은 결과를 내는 가짜 난수
function seeded(seed = 1) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

describe('grade: 라이트너 상자', () => {
  it('처음 보는 문장을 맞히면 2칸(2일 뒤), 계속 맞히면 4·7·15일, 5칸에서 멈춘다', () => {
    let s: QuizStats = {}
    s = grade(s, 'Hi', true, TODAY)
    expect(s.Hi).toEqual({ box: 2, due: '2026-10-10', seen: 1 })
    s = grade(s, 'Hi', true, TODAY)
    expect(s.Hi).toEqual({ box: 3, due: '2026-10-12', seen: 2 })
    s = grade(s, 'Hi', true, TODAY)
    expect(s.Hi.box).toBe(4)
    expect(s.Hi.due).toBe('2026-10-15')
    s = grade(s, 'Hi', true, TODAY)
    expect(s.Hi.box).toBe(5)
    expect(s.Hi.due).toBe('2026-10-23')
    s = grade(s, 'Hi', true, TODAY)
    expect(s.Hi.box).toBe(5)
    expect(s.Hi.due).toBe('2026-10-23')
  })
  it('틀리면 1칸으로 가서 내일 다시 본다', () => {
    const s = grade({ Hi: { box: 4, due: TODAY, seen: 3 } }, 'Hi', false, TODAY)
    expect(s.Hi).toEqual({ box: 1, due: '2026-10-09', seen: 4 })
    expect(grade({}, 'Yo', false, TODAY).Yo).toEqual({ box: 1, due: '2026-10-09', seen: 1 })
  })
  it('원래 값을 바꾸지 않는다', () => {
    const s: QuizStats = { Hi: { box: 2, due: TODAY, seen: 1 } }
    grade(s, 'Hi', true, TODAY)
    expect(s.Hi.box).toBe(2)
  })
  it('달·해가 바뀌어도 날짜를 맞게 센다', () => {
    expect(grade({ A: { box: 4, due: '2026-12-20', seen: 1 } }, 'A', true, '2026-12-20').A.due).toBe('2027-01-04')
  })
})

describe('pickQuiz', () => {
  const learned = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((x) => item(x))
  it('빈 내 문장 노트가면 빈 목록', () => {
    expect(pickQuiz([], {}, TODAY)).toEqual([])
  })
  it('처음 보는 것만 있으면 최근 것부터 최대 n개', () => {
    const p = pickQuiz(learned, {}, TODAY, 8, seeded())
    expect(p).toHaveLength(8)
    expect(p.map((x) => x.en).sort()).toEqual(['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'])
  })
  it('오늘 할 것(지난 것 포함)을 먼저, 아직 날이 안 된 것은 빼고, 새 문장은 2개는 끼운다', () => {
    const stats: QuizStats = {}
    for (const x of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) stats[x] = { box: 1, due: x === 'h' ? '2026-10-09' : '2026-10-0' + (x.charCodeAt(0) - 96), seen: 1 }
    const p = pickQuiz(learned, stats, TODAY, 8, seeded()).map((x) => x.en)
    expect(p).toHaveLength(8)
    expect(p).not.toContain('h')
    expect(p).toEqual(expect.arrayContaining(['i', 'j', 'a', 'b', 'c', 'd', 'e', 'f']))
  })
  it('오늘 할 것이 n보다 많으면 오래된 것부터', () => {
    const stats: QuizStats = {}
    learned.forEach((x, i) => (stats[x.en] = { box: 1, due: `2026-09-${String(10 + i).padStart(2, '0')}`, seen: 1 }))
    const p = pickQuiz(learned, stats, TODAY, 3, seeded()).map((x) => x.en)
    expect(p.sort()).toEqual(['a', 'b', 'c'])
  })
  it('다 했으면 빈 목록, 미리 풀기는 가까운 날부터', () => {
    const stats: QuizStats = { a: { box: 3, due: '2026-10-20', seen: 2 }, b: { box: 2, due: '2026-10-10', seen: 1 } }
    expect(pickQuiz(learned.slice(0, 2), stats, TODAY)).toEqual([])
    expect(pickAhead(learned.slice(0, 2), stats, 1).map((x) => x.en)).toEqual(['b'])
    expect(nextDue(learned.slice(0, 2), stats)).toBe('2026-10-10')
    expect(nextDue(learned.slice(0, 2), {})).toBeNull()
  })
  it('같은 문장이 두 번 있어도 한 번만', () => {
    expect(pickQuiz([item('a'), item('a'), item(' ')], {}, TODAY)).toHaveLength(1)
  })
  it('countDueBy: 이 날까지 볼 문장 수', () => {
    const stats: QuizStats = { a: { box: 1, due: '2026-10-09', seen: 1 }, b: { box: 2, due: '2026-10-10', seen: 1 } }
    expect(countDueBy(learned, stats, '2026-10-09')).toBe(1)
    expect(countDueBy(learned, stats, '2026-10-10')).toBe(2)
  })
})

describe('문제 만들기', () => {
  it('세 종류를 돌아가며 낸다', () => {
    const items = ['I like coffee.', 'See you later.', 'How are you?', 'Good morning.'].map((x) => item(x))
    const q = buildQuestions(items, items, seeded())
    expect(q.map((x) => x.kind)).toEqual(['meaning', 'speak', 'order', 'meaning'])
  })
  it('뜻 고르기: 보기 3개, 정답 하나, 오답은 다른 문장의 뜻', () => {
    const items = ['I like coffee.', 'See you later.', 'How are you?'].map((x) => item(x))
    const [q] = buildQuestions([items[0]], items, seeded())
    expect(q.choices).toHaveLength(3)
    expect(q.choices).toContain('I like coffee. 뜻')
    expect(new Set(q.choices).size).toBe(3)
    expect(q.choices.filter((c) => c.endsWith('뜻'))).toHaveLength(3)
  })
  it('문장이 1개뿐이면 오답은 기본 목록에서', () => {
    const only = [item('I like coffee.', '커피 좋아해요.')]
    const [q] = buildQuestions(only, only, seeded())
    expect(q.choices).toHaveLength(3)
    expect(q.choices).toContain('커피 좋아해요.')
    expect(q.choices.filter((c) => DEFAULT_WRONG.includes(c))).toHaveLength(2)
  })
  it('뜻이 같은 다른 문장은 오답으로 쓰지 않는다', () => {
    const items = [item('Hi.', '안녕.'), item('Hello.', '안녕.')]
    const [q] = buildQuestions([items[0]], items, seeded())
    expect(q.choices.filter((c) => c === '안녕.')).toHaveLength(1)
  })
  it('뜻이 없으면 뜻 고르기 대신 다른 문제, 한 단어면 순서 맞추기를 내지 않는다', () => {
    const q = buildQuestions([item('Thanks!', ''), item('Yes.', '네.'), item('Okay', '좋아')], [], seeded())
    expect(q[0].kind).toBe('speak')
    expect(q[1].kind).toBe('speak')
    expect(q[2].kind).toBe('meaning')
    const q2 = buildQuestions([item('Wow', ''), item('Hi', '')], [], seeded())
    expect(q2.map((x) => x.kind)).toEqual(['speak', 'speak'])
  })
  it('순서 맞추기 조각은 섞여 있고, 정답 순서와 다르다', () => {
    const items = [item('a'), item('b'), item('I am very happy today.')]
    const q = buildQuestions(items, items, seeded())[2]
    expect(q.kind).toBe('order')
    expect(q.pieces.slice().sort()).toEqual(['I', 'am', 'happy', 'today', 'very'])
    expect(q.pieces.join(' ')).not.toBe('I am very happy today')
  })
  it('splitPieces·orderCorrect: 문장부호와 대소문자는 따지지 않는다', () => {
    expect(splitPieces("I'm fine, thanks!")).toEqual(["I'm", 'fine', 'thanks'])
    expect(orderCorrect("I'm fine, thanks!", ["I'm", 'fine', 'thanks'])).toBe(true)
    expect(orderCorrect("I'm fine, thanks!", ['fine', "I'm", 'thanks'])).toBe(false)
    expect(splitPieces(' — ')).toEqual([])
  })
})

describe('저장', () => {
  beforeEach(() => {
    const m = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
      removeItem: (k: string) => void m.delete(k),
    })
  })
  it('저장하고 다시 읽는다', () => {
    const s = grade({}, 'Hi', true, TODAY)
    expect(saveQuizStats(s)).toBe(true)
    expect(JSON.parse(localStorage.getItem(QUIZ_KEY) ?? '')).toEqual(s)
    expect(loadQuizStats()).toEqual(s)
  })
  it('깨진 값은 걸러 낸다', () => {
    expect(sanitizeQuizStats(null)).toEqual({})
    expect(sanitizeQuizStats([1])).toEqual({})
    expect(
      sanitizeQuizStats({ a: { box: 9, due: '2026-10-01', seen: 'x' }, b: { box: 1, due: 'tomorrow' }, c: 3, d: { due: '2026-10-02' } }),
    ).toEqual({ a: { box: 5, due: '2026-10-01', seen: 0 }, d: { box: 1, due: '2026-10-02', seen: 0 } })
  })
  it('저장소가 막혀도 터지지 않는다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadQuizStats()).toEqual({})
    expect(saveQuizStats({})).toBe(false)
  })
})

describe('검토에서 고친 것', () => {
  it('정답과 같은 뜻(주어·문장부호만 다름)은 오답 보기로 내지 않는다', async () => {
    const { buildQuestions, sameMeaning } = await import('./quiz')
    expect(sameMeaning('저는 커피를 좋아해요.', '커피를 좋아해요.')).toBe(true)
    expect(sameMeaning('내일 봐요.', '오늘 날씨가 좋아요.')).toBe(false)
    const item = { en: 'I like coffee.', ko: '커피를 좋아해요.' }
    for (let seed = 0; seed < 30; seed++) {
      let n = seed
      const rng = () => ((n = (n * 9301 + 49297) % 233280) / 233280)
      const [q] = buildQuestions([item], [item], rng)
      if (q.kind !== 'meaning') continue
      expect(q.choices.filter((c) => sameMeaning(c, item.ko))).toHaveLength(1)
    }
  })

  it('두 기기의 복습 기록은 문장마다 더 많이 본 쪽으로 합친다', async () => {
    const { mergeQuizStats } = await import('./quiz')
    const local = { a: { box: 2, due: '2026-10-10', seen: 3 }, b: { box: 1, due: '2026-10-09', seen: 1 } }
    const incoming = { a: { box: 4, due: '2026-10-20', seen: 5 }, c: { box: 2, due: '2026-10-11', seen: 1 } }
    expect(mergeQuizStats(local, incoming)).toEqual({ a: incoming.a, b: local.b, c: incoming.c })
  })
})
