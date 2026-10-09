import { TARGET } from './config'
import { getStage, getUnit } from './curriculum'
import { AppError, callGemini, parseJsonLoose } from './gemini'
import { pickReview } from './prompt'
import { read, write } from './storage'
import { localDate } from './text'
import type { LearnedItem, Pair, Progress, Settings } from './types'

// 듣고 따라 말하기(쉐도잉): AI가 내 단계에 맞는 30초짜리 짧은 이야기를 만든다

export interface Story {
  title: string
  title_ko: string
  sentences: Pair[]
}

export const MIN_SENTENCES = 4
export const MAX_SENTENCES = 6

const PAIR_SCHEMA = {
  type: 'OBJECT',
  properties: { en: { type: 'STRING' }, ko: { type: 'STRING' } },
  required: ['en', 'ko'],
  propertyOrdering: ['en', 'ko'],
}
const STORY_FIELDS = ['title', 'title_ko', 'sentences']

export const STORY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    title_ko: { type: 'STRING' },
    sentences: { type: 'ARRAY', items: PAIR_SCHEMA, minItems: MIN_SENTENCES, maxItems: MAX_SENTENCES },
  },
  required: STORY_FIELDS,
  propertyOrdering: STORY_FIELDS,
}

// 단계별 문장 길이. 1단계는 아주 쉬운 4~7단어
const SENTENCE_RULE: Record<number, string> = {
  1: '한 문장에 4~7단어. 아주 쉬운 단어만(초등학생이 아는 정도). 현재 시제 위주, 쉼표나 이어 붙인 긴 문장 금지.',
  2: '한 문장에 6~10단어. 일상 단어 위주. 지난 일은 쉬운 과거형만.',
  3: '한 문장에 15단어 이하. 자주 쓰는 구동사를 한두 개 섞어도 좋아.',
  4: '한 문장에 20단어 이하. 원어민이 친구에게 말하듯 자연스럽게.',
}
const sentenceRule = (n: number) => SENTENCE_RULE[n] ?? '원어민이 말하는 자연스러운 길이와 속도. 관용 표현도 섞어.'

export function buildStorySystem(settings: Pick<Settings, 'likes'>, progress: Progress, learned: LearnedItem[] = [], today = localDate()): string {
  const L = TARGET.label
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const review = pickReview(learned, today, 3)
    .map((x) => `- ${x.en}`)
    .join('\n')
  const reviewBlock = review ? `\n\n[복습] 지난번에 연습한 문장이야. 이야기에 자연스럽게 맞으면 하나쯤 그대로 써 줘(억지로 넣지는 마).\n${review}` : ''
  return `너는 ${L}를 배우는 한국 성인에게 들려줄 아주 짧은 ${L} 이야기를 쓰는 작가야. 소리 내어 읽으면 30초쯤 되는 이야기 하나를 JSON으로만 답해.

[듣는 사람]
- 성인, 모국어는 한국어. 좋아하는 것: ${settings.likes || '(모름. 누구나 겪는 일상 이야기로)'}
- 교육과정 ${stage.n}단계 「${stage.name}」(${stage.cefr}): ${stage.speaker}
- 이 단계에서 친구가 말하는 방식: ${stage.sayRule}

[오늘 단원] ${unit.title}
- 연습할 표현: ${unit.focus}
- 이야기 주제는 이 단원과 이어지게 하고, 연습할 표현을 이야기 속에 두세 번 넣어.

[쓰는 법]
- 문장 ${MIN_SENTENCES}~${MAX_SENTENCES}개. ${sentenceRule(stage.n)}
- 한 사람(나 또는 친구)의 하루 일처럼 처음-중간-끝이 있는 이야기. 문장마다 따라 말하기 좋게 끊어.
- 좋아하는 것을 알면 이야기에 자연스럽게 섞어.
- 어른이 듣기에 유치하지 않게. 슬프거나 무서운 이야기, 개인정보는 쓰지 마.

[답 형식]
- title: ${L} 제목 (짧게)
- title_ko: 제목의 한국어 뜻
- sentences: [{ en: ${L} 문장 하나, ko: 그 문장의 자연스러운 한국어 뜻 }]${reviewBlock}`
}

// 요청 글: '다른 이야기'를 누르면 방금 들은 제목과 다른 이야기를 달라고 한다
export function storyRequest(avoidTitles: string[] = []): string {
  const avoid = avoidTitles.filter(Boolean).slice(-5)
  return avoid.length
    ? `새 이야기를 하나 써 줘. 이 이야기들과는 다른 장면으로: ${avoid.map((t) => `"${t}"`).join(', ')}`
    : '새 이야기를 하나 써 줘.'
}

const str = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

// 모양이 이상해도 화면이 깨지지 않게 다듬는다. 쓸 문장이 하나도 없으면 null
export function sanitizeStory(value: unknown): Story | null {
  if (!value || typeof value !== 'object') return null
  const o = value as Record<string, unknown>
  const raw = Array.isArray(o.sentences) ? o.sentences : []
  const seen = new Set<string>()
  const sentences: Pair[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const en = str((x as Record<string, unknown>).en)
    const key = en.toLowerCase()
    if (!en || seen.has(key)) continue
    seen.add(key)
    sentences.push({ en, ko: str((x as Record<string, unknown>).ko) })
    if (sentences.length >= MAX_SENTENCES) break
  }
  if (sentences.length === 0) return null
  return { title: str(o.title) || 'A Short Story', title_ko: str(o.title_ko), sentences }
}

export function parseStory(text: string): Story {
  const story = sanitizeStory(parseJsonLoose(text))
  if (!story) throw new AppError('이야기를 제대로 받지 못했어요. "다시 시도"를 눌러 주세요.', null, true)
  return story
}

export async function makeStory(
  settings: Pick<Settings, 'apiKey' | 'model' | 'likes'>,
  progress: Progress,
  learned: LearnedItem[],
  avoidTitles: string[] = [],
  signal?: AbortSignal,
): Promise<Story> {
  const raw = await callGemini(
    settings,
    buildStorySystem(settings, progress, learned),
    [{ role: 'user', parts: [{ text: storyRequest(avoidTitles) }] }],
    STORY_SCHEMA,
    signal,
  )
  return parseStory(raw)
}

// ── 마지막 이야기 (시트를 닫거나 설정에 다녀와도 같은 이야기를 다시 들을 수 있게) ──
export const KEY_LISTEN_LAST = 'englishFriend.listen.last'

export interface SavedStory {
  date: string
  story: Story
}

export function loadLastStory(): SavedStory | null {
  const v = read(KEY_LISTEN_LAST)
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const story = sanitizeStory(o.story)
  return story ? { date: typeof o.date === 'string' ? o.date : '', story } : null
}

export const saveLastStory = (story: Story, date = localDate()): boolean => write(KEY_LISTEN_LAST, { date, story })
