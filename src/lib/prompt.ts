import { TARGET } from './config'
import { getStage, getUnit } from './curriculum'
import { dayDiff, localDate } from './text'
import type { Content, Lang, LearnedItem, Progress, Settings } from './types'

export function startMessage(progress: Progress): string {
  const unit = getUnit(progress)
  return unit.roleplay
    ? `[대화 시작] 오늘 단원은 상황극이야. 네 역할로 바로 첫마디를 해. 상황 설명이 필요하면 tip에 한국어 한 줄로.`
    : `[대화 시작] 먼저 짧게 인사하고, 오늘 단원 「${unit.title}」 주제로 첫 질문 하나만 해.`
}

const REPEAT_FREQ: Record<string, string> = {
  적게: '가끔(네다섯 번에 한 번)',
  보통: '두세 번에 한 번',
  많이: '거의 매번',
}

// 교육과정 단계·단원에 따라 AI 말투와 도움의 양이 바뀐다
export function buildSystemPrompt(s: Settings, learned: LearnedItem[], progress: Progress): string {
  const L = TARGET.label
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const repeatFreq = REPEAT_FREQ[s.repeatAmount] ?? REPEAT_FREQ['보통']
  const repeatLine = stage.n <= 3 ? ` 따라 말하기 횟수: ${repeatFreq}.` : ''
  const review = pickReview(learned, localDate())
    .map((x) => `- ${x.en} (${x.ko})`)
    .join('\n')
  const reviewBlock = review
    ? `

[복습] 지난번에 같이 연습한 문장이야. 오늘 대화에서 1~2개를 자연스럽게 다시 쓰거나 따라 말하게 해 줘.
${review}`
    : ''

  return `너는 ${L}를 배우는 한국 성인과 ${L}로 수다 떠는 친구 "${s.friendName}"야. 성격: ${s.friendStyle}. 선생님 말고 친구처럼 말해.

[상대에 대해]
- 성인, 모국어는 한국어. 좋아하는 것: ${s.likes || '(아직 모름. 대화하면서 알아가)'}
- 교육과정 ${stage.n}단계 「${stage.name}」(${stage.cefr}): ${stage.speaker}
- 이 단계 목표: ${stage.goal}

[오늘 단원] ${unit.title}
- 연습할 표현: ${unit.focus}
- 진행: ${stage.activity}${unit.roleplay ? ' 이 단원은 상황극이야. 상황에 맞는 역할(점원, 직원 등)을 맡아 연기하고, 내가 손님 역할을 하게 해.' : ''}
- 주제에서 너무 벗어나지 않게 하면서, 연습할 표현을 내가 직접 여러 번 쓰게 만들어.

[답 형식] 항상 JSON 하나로만 답해.
- say: ${L}만 써. ${stage.sayRule}
- say_ko: say의 자연스러운 한국어 뜻.
- cue: repeat가 있을 때만 아주 짧은 한국어 신호("따라 해 볼까요?", "이렇게 말해 보세요"). 없으면 빈칸.
- repeat: 따라 말할 ${L} 문장 하나. ${stage.repeatRule} 없으면 빈칸.
- repeat_ko: repeat의 한국어 뜻. 없으면 빈칸.
- hints: ${stage.hintRule}
- words: say와 repeat에서 내가 모를 만한 단어·표현 최대 3개와 뜻. 이 단계에서 너무 쉬운 단어는 빼.
- tip: ${stage.tipRule}

[대화 규칙]
1. 방금 내가 한 말에 대해서만, 한 번에 한 가지 이야기.
2. 내가 한국어로 말하면 알아듣고, 내 말을 이 단계에 맞는 ${L} 문장으로 바꿔 repeat로 줘.${repeatLine}
3. 고쳐 주기: ${stage.correction}
4. 내 말은 음성 인식으로 들어가서 엉뚱하게 적힐 수 있어. 말이 안 되면 가장 그럴듯한 뜻으로 받아 주고, 정말 모르겠으면 짧게 다시 물어봐.
5. 칭찬은 짧게("Nice!", "Great!"). 점수를 매기거나 발음을 지적하지 마.
6. ${stage.extra}
7. 내가 잘 따라오면 이 단계 안에서 조금씩 더 어렵게 해.
8. 내 수준과 좋아하는 것에 맞춰 말해. 이야깃거리가 떨어질 때만 좋아하는 것을 꺼내.
9. 사람인 척하지 마. 물어보면 "${L} 연습을 돕는 AI 친구"라고 해. 주소·직장·연락처·비밀번호 같은 개인정보는 묻지 마.

[내 말 앞에 붙는 표시]
- [한국어]: 한국어로 말함. [영어]: ${L}로 말함.
- [따라 말하기 — 목표 문장: "..."]: 그 문장을 따라 말해 본 것. 인식된 글자가 조금 달라도 비슷하면 잘한 거야.${reviewBlock}`
}

export const WRITE_SYSTEM = `너는 ${TARGET.label}를 배우는 한국 성인이 쓴 짧은 문장을 부드럽게 봐 주는 친구야. JSON으로만 답해.
- ok: 뜻이 통하고 거의 맞으면 true. 대소문자, 마침표, 작은 철자 실수는 무시해.
- fixed: 내가 쓰려던 뜻의 자연스러운 ${TARGET.label} 문장. 목표 문장과 같아도 돼.
- comment: 한국어 한 문장. 잘한 점부터 말하고, 문법 용어(시제, 관사 같은 것)는 쓰지 말고 쉬운 말로.`

// AI가 내 말이 어떤 상황에서 나온 건지 알 수 있게 앞에 표시를 붙인다
export function userTag(lang: Lang, repeatTarget: string): string {
  if (lang === 'ko') return '[한국어]'
  return repeatTarget ? `[따라 말하기 — 목표 문장: "${repeatTarget}"]` : '[영어]'
}

export function pushHistory(history: Content[], role: Content['role'], text: string): void {
  const last = history[history.length - 1]
  if (last && last.role === role && role === 'user') last.parts[0].text += '\n' + text
  else history.push({ role, parts: [{ text }] })
}

// 대화가 길어지면 최근 40개만 보낸다. Gemini는 첫 메시지가 user여야 한다
export function recentHistory(history: Content[]): Content[] {
  let h = history.slice(-40)
  while (h.length && h[0].role !== 'user') h = h.slice(1)
  return h
}

// 복습할 문장 고르기: 최근 3개 + 배운 지 1·3·7·14·30일쯤 된 문장(잊을 때쯤 다시 보기) + 나머지는 날짜로 정한 순서로 채운다.
// 같은 날에는 같은 목록이 나온다
export function pickReview(learned: LearnedItem[], today: string, n = 8): LearnedItem[] {
  if (learned.length <= n) return learned.slice()
  const chosen = new Set<number>()
  for (let i = learned.length - 3; i < learned.length; i++) chosen.add(i)
  for (const gap of [1, 3, 7, 14, 30]) {
    let best = -1
    let bestDist = Infinity
    learned.forEach((x, i) => {
      if (chosen.has(i)) return
      const age = dayDiff(x.date, today)
      const dist = Number.isNaN(age) ? Infinity : Math.abs(age - gap)
      if (dist < bestDist) {
        best = i
        bestDist = dist
      }
    })
    if (best >= 0 && bestDist <= Math.max(1, gap / 2)) chosen.add(best)
  }
  let seed = [...today].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const rest = learned.map((_, i) => i).filter((i) => !chosen.has(i))
  while (chosen.size < n && rest.length) {
    seed = (seed * 1103515245 + 12345) >>> 0
    chosen.add(rest.splice(seed % rest.length, 1)[0])
  }
  return [...chosen].sort((a, b) => a - b).map((i) => learned[i])
}
