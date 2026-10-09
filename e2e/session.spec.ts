import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  aiBubbles,
  clearSpoken,
  collectErrors,
  installMocks,
  lastRec,
  lastUserText,
  reply,
  say,
  spoken,
  startWithGreeting,
  storageGet,
  systemText,
  turn,
  type MockReply,
  expectToday,
} from './helpers'

// 세션 수명 주기: 마무리 → 저장, 시간 배너·제한 시간, 뒤로 가기, 임시 저장·이어서 하기, 두 탭, 나가기 경고,
// 오늘 할 일 체크리스트, 연속 일수·오늘 분.
// 날짜가 걸린 계산이 많아서 모든 테스트는 한국 시간 2026-10-08 오전 10시에서 시작하는 가짜 시계로 돈다 (시계는 저절로 흐른다).

test.use({ timezoneId: 'Asia/Seoul' })

const NOW = new Date('2026-10-08T10:00:00+09:00')
const TODAY = '2026-10-08'
// 오늘에서 며칠 앞뒤의 날짜 ('YYYY-MM-DD')
const day = (offset: number) => new Date(Date.UTC(2026, 9, 8 + offset)).toISOString().slice(0, 10)

const K = {
  settings: 'englishFriend.settings',
  learned: 'englishFriend.learned',
  progress: 'englishFriend.progress',
  daily: 'englishFriend.daily',
  draft: 'englishFriend.draft.',
}
const START_MSG_UNIT1 = '[대화 시작] 먼저 짧게 인사하고, 오늘 단원 「인사와 자기소개」 주제로 첫 질문 하나만 해.'

interface SessionLogLike {
  id: string
  date: string
  stage: number
  unit: string
  minutes: number
  turns: number
  koTurns: number
  enOwnTurns: number
  enOwnWords: number
  repeatTurns: number
}
interface ProgressLike {
  stage: number
  unit: string
  doneUnits: string[]
  sessions: SessionLogLike[]
}
interface DraftLike {
  tabId: string
  savedAt: number
  date: string
  activeMs: number
  limitSec: number
  stage: number
  unit: string
  stats: Record<string, number>
  repeats: { en: string; ko: string }[]
  messages: { kind: string; id: number; text?: string; lang?: string; turn?: { say: string } }[]
  history: { role: string; parts: { text: string }[] }[]
  pendingRepeat: string
}

// 저장해 둘 지난 대화 기록 하나 (단원을 마치지 않은 짧은 대화)
let seq = 0
const log = (date: string, minutes: number, extra: Partial<SessionLogLike> = {}): SessionLogLike => ({
  id: `0seed${String(++seq).padStart(4, '0')}`,
  date,
  stage: 1,
  unit: 's1-1',
  minutes,
  turns: 2,
  koTurns: 2,
  enOwnTurns: 0,
  enOwnWords: 0,
  repeatTurns: 0,
  ...extra,
})
const progressOf = (...sessions: SessionLogLike[]): ProgressLike => ({ stage: 1, unit: 's1-1', doneUnits: [], sessions })

interface OpenOptions {
  settings?: Record<string, unknown>
  storage?: Record<string, unknown>
  // 가짜 시계의 시작 시각 (기본 NOW)
  time?: Date
}

// 가짜 시계·AI·마이크를 깔고, 키가 있는 상태로 시작 화면을 연다
async function open(page: Page, context: BrowserContext, opts: OpenOptions = {}) {
  await context.clock.install({ time: opts.time ?? NOW })
  const mocks = await installMocks(context, {
    storage: { [K.settings]: { apiKey: 'K', ...opts.settings }, ...opts.storage },
  })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  return { ...mocks, errors }
}

// 같은 context에서 두 번째 탭을 연다 (저장값은 이미 들어 있다)
async function openSecondTab(context: BrowserContext) {
  const page = await context.newPage()
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  return { page, errors }
}

type How = 'type' | 'en' | 'ko'
// 내 말 하나 보내고 AI 답 하나 받기. how: 입력칸(type) / EN 마이크 / 한 마이크
async function exchange(page: Page, queue: MockReply[], said: string, ai: Record<string, unknown>, how: How = 'type') {
  const before = await aiBubbles(page).count()
  queue.push(reply(turn(ai)))
  if (how === 'type') {
    await page.fill('#typeInput', said)
    await page.click('#typeSend')
  } else {
    await page.click(how === 'en' ? '#micEn' : '#micKo')
    await say(page, said)
  }
  await expect(aiBubbles(page)).toHaveCount(before + 1)
}

const historyLength = (page: Page) => page.evaluate(() => history.length)
const tabIdOf = (page: Page) => page.evaluate(() => sessionStorage.getItem('englishFriend.tabId'))
const draftOf = async (page: Page) => (await storageGet(page, K.draft + (await tabIdOf(page)))) as DraftLike | null
const draftKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('englishFriend.draft.')))
const progressIn = async (page: Page) => (await storageGet(page, K.progress)) as ProgressLike | null
const learnedEn = async (page: Page) =>
  (((await storageGet(page, K.learned)) as { en: string }[] | null) ?? []).map((x) => x.en)

// 오늘 할 일 항목과 그 체크 칸
const items = (page: Page) => page.locator('#todayRoutine li')
const box = (page: Page, i: number) => items(page).nth(i).getByRole('checkbox')

// 가짜 beforeunload 이벤트를 보내 앱이 나가기를 막는지 본다
const leaveBlocked = (page: Page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    return e.defaultPrevented
  })

// 첫 인사: 따라 말하기 문장 "I'm fine."
const GREET_REPEAT = {
  say: 'Hi! How are you?',
  say_ko: '안녕! 잘 지내?',
  cue: '따라 해 볼까요?',
  repeat: "I'm fine.",
  repeat_ko: '난 괜찮아.',
}

// ─────────────────────────────────────────────
// 1) 마무리
// ─────────────────────────────────────────────

test.describe('마무리', () => {
  test('끝내기 → 남은 횟수 안내, 듣고 읽기 카드(소리·마이크), 써 보기(확인 요청·정답 보기), 대화로 돌아가기, 저장하고 끝내기', async ({
    page,
    context,
  }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue, GREET_REPEAT)
    // 1턴: EN 마이크로 따라 말하기
    await exchange(
      page,
      queue,
      "I'm fine",
      { say: 'Great!', say_ko: '좋아!', cue: '따라 해 볼까요?', repeat: 'Nice to meet you.', repeat_ko: '만나서 반가워.' },
      'en',
    )
    await expect(page.locator('#turnCount')).toHaveText('1/5 턴 완료')

    await page.click('#btnEnd')
    const wrap = page.locator('#wrapSheet')
    await expect(wrap).toBeVisible()
    await expect(wrap).toHaveAttribute('role', 'dialog')
    await expect(page.locator('#wrapSheet-title')).toHaveText('오늘 마무리')
    const status = page.locator('#wrapUnitStatus')
    await expect(status).toHaveText('4번만 더 주고받으면 「인사와 자기소개」 단원을 마쳐요. 대화로 돌아가서 조금만 더 해 볼까요?')
    await expect(status).toHaveClass(/warn/)
    // 단원이 남았으면 '대화로 돌아가기'를 앞세운다
    await expect(page.locator('#btnBackToChat')).toHaveClass(/primary/)
    await expect(page.locator('#btnFinish')).toHaveClass(/secondary/)
    // 마무리 창이 열리면 뒤의 대화 화면은 누를 수 없다
    await expect(page.locator('.app')).toHaveAttribute('inert', '')

    // ① 듣고 소리 내어 읽기: 따라 한 문장 카드 2개
    const cards = wrap.locator('.read-card')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0).locator('.say')).toHaveText("I'm fine.")
    await expect(cards.nth(0).locator('.meaning')).toHaveText('난 괜찮아.')
    await expect(cards.nth(1).locator('.say')).toHaveText('Nice to meet you.')

    // 🔊 듣기 → 영어 목소리로, 🐢 천천히 → 느리게
    await clearSpoken(page)
    await cards.nth(0).getByRole('button', { name: "I'm fine. 듣기" }).click()
    await expect.poll(() => spoken(page)).toEqual([expect.objectContaining({ text: "I'm fine.", lang: 'en-US', rate: 0.8 })])
    await clearSpoken(page)
    await cards.nth(0).getByRole('button', { name: "I'm fine. 천천히 듣기" }).click()
    await expect
      .poll(() => spoken(page))
      .toEqual([expect.objectContaining({ text: "I'm fine.", lang: 'en-US', rate: expect.closeTo(0.6, 5) })])

    // 🎤 읽어 보기 → 영어 마이크가 켜지고, 잘 읽으면 칭찬, 다르게 들리면 다시 해 보자고
    const readBtn = cards.nth(0).locator('.btn-read')
    await expect(readBtn).toHaveText('읽어 보기')
    await readBtn.click()
    await expect(readBtn).toHaveText('듣는 중… 누르면 끝')
    expect(await lastRec(page)).toMatchObject({ lang: 'en-US', started: true, stopped: false })
    await say(page, 'I am fine')
    await expect(cards.nth(0).locator('.result')).toHaveText('잘 들렸어요! ("I am fine")')
    await expect(cards.nth(0).locator('.result')).toHaveClass(/good/)
    await expect(readBtn).toHaveText('읽어 보기')
    await cards.nth(1).locator('.btn-read').click()
    await say(page, 'nice to see')
    await expect(cards.nth(1).locator('.result')).toContainText('이렇게 들렸어요: "nice to see" — 한 번 더 해 볼까요?')
    // 발음 피드백: 목표 문장에서 안 들린 단어를 표시한다
    const missed = await cards.nth(1).locator('.wm.miss').allTextContents()
    expect(missed.length).toBeGreaterThan(0)
    expect(missed.join(' ')).not.toMatch(/\bnice\b/i)
    // 마무리 창에서 읽은 말은 대화로 보내지 않는다
    expect(requests).toHaveLength(2)
    await expect(page.locator('.msg.me')).toHaveCount(1)

    // ② 뜻 보고 써 보기
    const writeBox = wrap.locator('.write-box')
    await expect(writeBox.locator('.write-prompt')).toHaveText('"난 괜찮아." → 영어로?')
    // 비워 두고 확인 → 안내만
    await writeBox.locator('.btn-check').click()
    await expect(page.locator('#toast')).toHaveText('먼저 써 보세요. 모르겠으면 "정답 보기"를 눌러도 돼요.')
    // 정확히 맞으면 AI에 묻지 않고 바로 칭찬
    await writeBox.locator('textarea').fill("i'm fine")
    await writeBox.locator('.btn-check').click()
    await expect(writeBox.locator('.result')).toHaveText('완벽해요!')
    expect(requests).toHaveLength(2)

    // 다음 문장: 틀리게 쓰면 checkWriting 요청 → 결과(한마디 + 고친 문장)
    await writeBox.getByRole('button', { name: '다음 문장 →' }).click()
    await expect(writeBox.locator('.write-prompt')).toHaveText('"만나서 반가워." → 영어로?')
    await expect(writeBox.locator('textarea')).toHaveValue('')
    queue.push({
      ...reply({ ok: false, fixed: 'Nice to meet you.', comment: '거의 다 왔어요! to만 넣어 봐요.' }),
      delayMs: 600,
    })
    await writeBox.locator('textarea').fill('nice meet you')
    await writeBox.locator('.btn-check').click()
    await expect(writeBox.locator('.result')).toHaveText('보는 중…')
    await expect(writeBox.locator('.btn-check')).toBeDisabled()
    await expect(writeBox.locator('.result')).toContainText('거의 다 왔어요! to만 넣어 봐요.')
    await expect(writeBox.locator('.result b')).toHaveText('Nice to meet you.')
    await expect(writeBox.locator('.btn-check')).toBeEnabled()
    expect(requests).toHaveLength(3)
    const check = requests[2]
    expect(check.headers['x-goog-api-key']).toBe('K')
    expect(systemText(check)).toContain('짧은 문장을 부드럽게 봐 주는 친구')
    expect(check.body.contents).toHaveLength(1)
    expect(lastUserText(check)).toBe('목표 문장: "Nice to meet you." (뜻: 만나서 반가워.)\n내가 쓴 것: "nice meet you"')
    expect(check.body.generationConfig.responseSchema.required).toEqual(['ok', 'fixed', 'comment'])
    // 고친 문장 옆 🔊
    await clearSpoken(page)
    await writeBox.getByRole('button', { name: 'Nice to meet you. 듣기' }).click()
    await expect.poll(() => spoken(page)).toEqual([expect.objectContaining({ text: 'Nice to meet you.', lang: 'en-US' })])

    // 정답 보기 (처음 문장으로 돌아가서)
    await writeBox.getByRole('button', { name: '다음 문장 →' }).click()
    await expect(writeBox.locator('.write-prompt')).toHaveText('"난 괜찮아." → 영어로?')
    await expect(writeBox.locator('.result')).toHaveCount(0)
    await writeBox.getByRole('button', { name: '정답 보기' }).click()
    await expect(writeBox.locator('.result b')).toHaveText("I'm fine.")
    expect(requests).toHaveLength(3)

    // 대화로 돌아가기 → 대화가 그대로 이어진다
    await page.click('#btnBackToChat')
    await expect(wrap).toHaveCount(0)
    await expect(page.locator('#composer')).toBeVisible()
    await expect(page.locator('.app')).not.toHaveAttribute('inert')
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(page.locator('.msg.me')).toHaveCount(1)
    await expect(page.locator('#turnCount')).toHaveText('1/5 턴 완료')
    // 2턴: 한국어로
    await exchange(
      page,
      queue,
      '나는 회사원이야',
      { say: 'Oh, you work at a company!', say_ko: '오, 회사에 다니는구나!', cue: '이렇게 말해 보세요', repeat: 'I work at a company.', repeat_ko: '나는 회사에 다녀.' },
      'ko',
    )
    expect(requests).toHaveLength(4)
    // 대화가 이어졌으니 앞의 대화도 같이 보낸다
    expect(requests[3].body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user'])
    expect(lastUserText(requests[3])).toBe('[한국어] 나는 회사원이야')
    await expect(page.locator('#turnCount')).toHaveText('2/5 턴 완료')

    // 다시 끝내기 → 남은 횟수가 줄고, 카드는 최근 3문장
    await page.click('#btnEnd')
    await expect(status).toHaveText('3번만 더 주고받으면 「인사와 자기소개」 단원을 마쳐요. 대화로 돌아가서 조금만 더 해 볼까요?')
    await expect(wrap.locator('.read-card .say')).toHaveText(["I'm fine.", 'Nice to meet you.', 'I work at a company.'])

    // 저장하고 끝내기 → 시작 화면에 결과
    await page.click('#btnFinish')
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#composer')).toHaveCount(0)
    const msg = page.locator('#startMsg')
    await expect(msg).toHaveText('3문장을 문장장에 저장했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 2번). 오늘 1분.')
    await expect(msg).toHaveClass(/good/)
    await expect(page.locator('#todayLine')).toContainText('1분 / 15분')
    // 문장장·진도 저장
    const learned = (await storageGet(page, K.learned)) as { en: string; ko: string; date: string }[]
    expect(learned).toEqual([
      { en: "I'm fine.", ko: '난 괜찮아.', date: TODAY },
      { en: 'Nice to meet you.', ko: '만나서 반가워.', date: TODAY },
      { en: 'I work at a company.', ko: '나는 회사에 다녀.', date: TODAY },
    ])
    const progress = await progressIn(page)
    expect(progress?.sessions).toHaveLength(1)
    expect(progress?.sessions[0]).toMatchObject({
      date: TODAY,
      stage: 1,
      unit: 's1-1',
      minutes: 1,
      turns: 2,
      koTurns: 1,
      repeatTurns: 1,
      enOwnTurns: 0,
      enOwnWords: 0,
    })
    expect(progress?.doneUnits).toEqual([])
    expect(progress?.unit).toBe('s1-1')
    // 임시 저장은 지운다
    expect(await draftKeys(page)).toEqual([])
    expect(errors).toEqual([])
  })

  test('5번 주고받으면 단원 완료: 마무리 문구·버튼 강조가 바뀌고, 저장하면 다음 단원으로', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    for (let i = 1; i <= 5; i++) {
      await exchange(page, queue, `대답 ${i}번`, { say: `Okay ${i}. And?`, say_ko: `알겠어 ${i}. 그리고?` })
    }
    await expect(page.locator('#turnCount')).toHaveText('단원 ✓')
    await expect(page.locator('#toast')).toHaveText('「인사와 자기소개」 단원 조건을 채웠어요! 더 이야기해도 좋아요.')

    await page.click('#btnEnd')
    const status = page.locator('#wrapUnitStatus')
    await expect(status).toHaveText('「인사와 자기소개」 단원 조건을 채웠어요 ✓ 저장하면 다음 단원으로 넘어가요.')
    await expect(status).toHaveClass(/good/)
    await expect(page.locator('#btnFinish')).toHaveClass(/primary/)
    await expect(page.locator('#btnBackToChat')).toHaveClass(/secondary/)
    // 따라 한 문장이 없으면 카드 대신 안내
    await expect(page.locator('#wrapBody')).toHaveText('오늘은 아직 따라 말한 문장이 없어요. 그래도 저장하면 대화 기록은 남아요.')

    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toHaveText('수고했어요. 「인사와 자기소개」 단원을 마쳤어요. 오늘 1분.')
    const progress = await progressIn(page)
    expect(progress?.doneUnits).toEqual(['s1-1'])
    expect(progress?.unit).toBe('s1-2')
    expect(progress?.sessions[0]).toMatchObject({ turns: 5, koTurns: 5, unit: 's1-1' })
    expect(await storageGet(page, K.learned)).toEqual([])
    // 시작 화면 진도 카드
    const course = page.locator('#courseCard')
    await expect(course).toContainText('완료 1/10')
    await expect(course.locator('.hero-title')).toHaveText('오늘 기분')
    await expect(course).toContainText('오늘 단원 완료 ✓')
    expect(errors).toEqual([])
  })
})

test.describe('마무리 (답을 기다리는 중)', () => {
  test('친구가 생각 중일 때 끝내기 → 늦게 온 답은 소리 내지 않고, 대화로 돌아가면 보인다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await clearSpoken(page)
    queue.push({ ...reply(turn({ say: 'Sorry, I was slow!', say_ko: '늦어서 미안!' })), delayMs: 1200 })
    await page.fill('#typeInput', '안녕')
    await page.click('#typeSend')
    await expect(page.locator('#guide')).toHaveText('Emma가 생각 중이에요…')
    await page.click('#btnEnd')
    await expect(page.locator('#wrapSheet')).toBeVisible()
    // 내 대답은 이미 1번으로 센다
    await expect(page.locator('#wrapUnitStatus')).toContainText('4번만 더 주고받으면')
    // 마무리 창이 열린 동안 답이 도착
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(page.locator('#wrapSheet')).toBeVisible()
    expect((await spoken(page)).map((s) => s.text)).not.toContain('Sorry, I was slow!')

    await page.click('#btnBackToChat')
    await expect(aiBubbles(page).nth(1)).toContainText('Sorry, I was slow!')
    // 다시 내 차례 (첫 대화라 처음 안내)
    await expect(page.locator('#guide')).toHaveText('버튼을 한 번 톡 누르고 말하세요 (누르고 있지 않아도 돼요). 한국어로 대답해도 돼요.')
    await expect(page.locator('#micKo')).toBeEnabled()
    expect((await spoken(page)).map((s) => s.text)).not.toContain('Sorry, I was slow!')
    expect(errors).toEqual([])
  })

  test('친구가 생각 중일 때 저장하고 끝내기 → 오류 없이 시작 화면, 늦은 답은 버린다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    queue.push({ ...reply(turn({ say: 'Too late', say_ko: '너무 늦음' })), delayMs: 1500 })
    await page.fill('#typeInput', '안녕')
    await page.click('#typeSend')
    await expect(page.locator('.bubble.typing')).toBeVisible()
    const aborted = page.waitForEvent('requestfailed', (r) => r.url().includes('generativelanguage') && r.method() === 'POST')
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toHaveText('수고했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 1번). 오늘 1분.')
    expect(requests).toHaveLength(2)
    // 기다리던 요청은 끊고, 시작 화면은 그대로, 임시 저장도 다시 생기지 않는다
    await aborted
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#composer')).toHaveCount(0)
    expect(await draftKeys(page)).toEqual([])
    expect((await progressIn(page))?.sessions).toHaveLength(1)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 2) 시간 배너·제한 시간
// ─────────────────────────────────────────────

test.describe('시간 배너', () => {
  test('5분 설정: 헤더 남은 분이 줄고, 5분이 지나면 배너(남은 횟수 문구) → 5분 더 / 마무리하기', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, { settings: { minutes: 5 } })
    await startWithGreeting(page, queue)
    const timer = page.locator('#timer')
    const banner = page.locator('#timeBanner')
    await expect(timer).toHaveText('5분 남음')
    await page.clock.fastForward('02:00')
    await expect(timer).toHaveText('3분 남음')
    await expect(banner).toHaveCount(0)

    await page.clock.fastForward('03:01')
    await expect(banner).toBeVisible()
    await expect(banner.locator('span')).toHaveText('시간이 됐어요. 단원까지 5번 남았어요.')
    await expect(timer).toHaveText('시간 됐어요')
    // 단원이 남았으면 '5분 더'를 앞세운다
    await expect(page.locator('#btnMore')).toHaveClass(/primary/)
    await expect(page.locator('#btnWrapNow')).toHaveClass(/secondary/)

    // 시간이 지나도 대화는 계속할 수 있고, 남은 횟수가 줄어든다
    await exchange(page, queue, '좋아', { say: 'Good!', say_ko: '좋아!' })
    await expect(banner.locator('span')).toHaveText('시간이 됐어요. 단원까지 4번 남았어요.')

    // 5분 더 → 배너가 사라지고 다시 남은 분
    await page.click('#btnMore')
    await expect(banner).toHaveCount(0)
    await expect(timer).toHaveText(/^[45]분 남음$/)
    await page.clock.fastForward('05:00')
    await expect(banner).toBeVisible()

    // 마무리하기 → 마무리 창, 대화로 돌아와도 배너는 다시 안 뜬다
    await page.click('#btnWrapNow')
    await expect(page.locator('#wrapSheet')).toBeVisible()
    await expect(banner).toHaveCount(0)
    await page.click('#btnBackToChat')
    await expect(page.locator('#wrapSheet')).toHaveCount(0)
    await page.clock.fastForward('00:05')
    await expect(banner).toHaveCount(0)
    await expect(timer).toHaveText('시간 됐어요')
    expect(errors).toEqual([])
  })

  test('단원 조건을 채운 뒤 시간이 되면 "오늘 목표 시간을 채웠어요" + 마무리하기를 앞세운다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, { settings: { minutes: 5 } })
    await startWithGreeting(page, queue)
    for (let i = 1; i <= 5; i++) await exchange(page, queue, `대답 ${i}`, { say: `Ok ${i}.`, say_ko: `응 ${i}.` })
    await page.clock.fastForward('05:01')
    const banner = page.locator('#timeBanner')
    await expect(banner).toBeVisible()
    await expect(banner.locator('span')).toHaveText('오늘 목표 시간을 채웠어요.')
    await expect(page.locator('#btnWrapNow')).toHaveClass(/primary/)
    await expect(page.locator('#btnMore')).toHaveClass(/secondary/)
    expect(errors).toEqual([])
  })

  test('배너를 두고 한참 더 대화한 뒤 "5분 더"를 눌러도 지금부터 5분이 생긴다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, { settings: { minutes: 5 } })
    await startWithGreeting(page, queue)
    await page.clock.fastForward('05:01')
    const banner = page.locator('#timeBanner')
    await expect(banner).toBeVisible()
    // 배너는 대화를 막지 않으니 계속 이야기한다 (6분 더)
    await exchange(page, queue, '좋아', { say: 'Good!', say_ko: '좋아!' })
    await page.clock.fastForward('06:00')
    await expect(page.locator('#timer')).toHaveText('시간 됐어요')
    await page.click('#btnMore')
    await expect(banner).toHaveCount(0)
    await expect(page.locator('#timer')).toHaveText('5분 남음')
    expect(errors).toEqual([])
  })

  // 제한 시간 = max(5분, 목표 − 오늘 이미 한 분)
  const cases: { name: string; goal: number; sessions: SessionLogLike[]; timer: string; minutes: number }[] = [
    { name: '오늘 기록 없음 → 목표 그대로 15분', goal: 15, sessions: [log(day(-1), 12)], timer: '15분 남음', minutes: 15 },
    { name: '오늘 7분 했으면 → 8분', goal: 15, sessions: [log(TODAY, 4), log(TODAY, 3)], timer: '8분 남음', minutes: 8 },
    { name: '오늘 12분 했으면 → 3분이 아니라 최소 5분', goal: 15, sessions: [log(TODAY, 12)], timer: '5분 남음', minutes: 5 },
    { name: '오늘 이미 목표를 넘겼어도 → 5분', goal: 15, sessions: [log(TODAY, 20)], timer: '5분 남음', minutes: 5 },
  ]
  for (const c of cases) {
    test(`제한 시간: ${c.name}`, async ({ page, context }) => {
      const { queue, errors } = await open(page, context, {
        settings: { minutes: c.goal },
        storage: { [K.progress]: progressOf(...c.sessions) },
      })
      await startWithGreeting(page, queue)
      await expect(page.locator('#timer')).toHaveText(c.timer)
      // 제한 시간 직전에는 배너가 없고, 지나면 뜬다
      await page.clock.fastForward((c.minutes * 60 - 10) * 1000)
      await expect(page.locator('#timer')).toHaveText('1분 남음')
      await expect(page.locator('#timeBanner')).toHaveCount(0)
      await page.clock.fastForward(11_000)
      await expect(page.locator('#timeBanner')).toBeVisible()
      await expect(page.locator('#timer')).toHaveText('시간 됐어요')
      expect(errors).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────
// 3) 뒤로 가기
// ─────────────────────────────────────────────

test.describe('뒤로 가기', () => {
  test('시작 화면에서 창(문장장)이 열려 있으면 뒤로는 그 창만 닫고 앱에 남는다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    const url = page.url()
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#bookSheet')).toBeVisible()
    await page.goBack()
    await expect(page.locator('#bookSheet')).toHaveCount(0)
    await expect(page.locator('#libraryScreen')).toBeVisible()
    expect(page.url()).toBe(url)
    expect(errors).toEqual([])
  })

  test('대화 중 뒤로 → 마무리 창(화면 그대로), 마무리에서 뒤로 → 저장하고 끝내기, 그 뒤로는 막지 않음', async ({
    page,
    context,
  }) => {
    const { queue, errors } = await open(page, context)
    const url = page.url()
    const lengthAtStart = await historyLength(page)
    await startWithGreeting(page, queue, GREET_REPEAT)
    await exchange(page, queue, "I'm fine", { say: 'Cool!', say_ko: '멋지다!' }, 'en')
    // 대화에 들어가면 뒤로 가기를 받을 칸이 하나 생긴다
    const lengthInChat = await historyLength(page)
    expect(lengthInChat).toBe(lengthAtStart + 1)

    await page.goBack()
    await expect(page.locator('#wrapSheet')).toBeVisible()
    // 앱을 나가지 않고 대화 화면 위에 마무리 창만 뜬다
    expect(page.url()).toBe(url)
    await expect(page.locator('#composer')).toBeAttached()
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(page.locator('#startSheet')).toHaveCount(0)
    expect((await progressIn(page))?.sessions ?? []).toHaveLength(0)
    expect(await historyLength(page)).toBe(lengthInChat)

    // 마무리 창에서 한 번 더 뒤로 → 단원까지 남았으니 한 번 묻는다. 취소하면 마무리 창에 그대로
    const asked: string[] = []
    let accept = false
    page.on('dialog', (d) => {
      asked.push(d.message())
      void (accept ? d.accept() : d.dismiss())
    })
    await page.goBack()
    await expect.poll(() => asked.length).toBe(1)
    expect(asked[0]).toContain('지금 저장하고 끝낼까요?')
    await expect(page.locator('#wrapSheet')).toBeVisible()
    expect((await progressIn(page))?.sessions ?? []).toHaveLength(0)
    // 다시 뒤로 → 이번엔 확인 → 저장하고 끝내기
    accept = true
    await page.goBack()
    await expect.poll(() => asked.length).toBe(2)
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#wrapSheet')).toHaveCount(0)
    await expect(page.locator('#startMsg')).toHaveText('1문장을 문장장에 저장했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 1번). 오늘 1분.')
    expect((await progressIn(page))?.sessions).toHaveLength(1)
    expect(await learnedEn(page)).toEqual(["I'm fine."])
    expect(await draftKeys(page)).toEqual([])

    // 무한 루프 없음: 뒤로 가기를 할 때마다 기록이 쌓이지 않고(대화 시작 때 1칸만), 시작 화면에서는 더는 붙잡지 않는다
    expect(await historyLength(page)).toBe(lengthInChat)
    expect(await page.evaluate(() => !!(history.state as { efGuard?: boolean } | null)?.efGuard)).toBe(false)
    expect((await progressIn(page))?.sessions).toHaveLength(1)
    expect(errors).toEqual([])
    // 한 번 더 뒤로 → 앱을 떠난다 (처음 연 빈 페이지로)
    await page.goBack()
    await expect.poll(() => page.url()).toBe('about:blank')
  })

  test('대화로 돌아간 뒤 다시 뒤로 → 또 마무리 창 (끝내지 않음), 대화 중 설정 창은 뒤로로 닫기만', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕', { say: 'Hello!', say_ko: '안녕!' })

    await page.goBack()
    await expect(page.locator('#wrapSheet')).toBeVisible()
    await page.click('#btnBackToChat')
    await expect(page.locator('#wrapSheet')).toHaveCount(0)
    await page.goBack()
    await expect(page.locator('#wrapSheet')).toBeVisible()
    await expect(page.locator('#startSheet')).toHaveCount(0)
    await page.click('#btnBackToChat')

    // 설정 창이 열려 있으면 뒤로는 그 창만 닫는다 (대화 중 설정은 내 서재에서 연다)
    await page.click('#tab-library')
    await page.click('#btnStartSettings')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await page.goBack()
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('#wrapSheet')).toHaveCount(0)
    await expect(page.locator('#libraryScreen')).toBeVisible()
    // 다른 칸에서 뒤로는 하던 대화로 돌아간다 (끝내지 않음)
    await page.goBack()
    await expect(page.locator('#composer')).toBeVisible()
    await expect(page.locator('#wrapSheet')).toHaveCount(0)
    // 그다음 뒤로는 마무리
    await page.goBack()
    await expect(page.locator('#wrapSheet')).toBeVisible()
    expect((await progressIn(page))?.sessions ?? []).toHaveLength(0)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 4) 임시 저장·이어서 하기
// ─────────────────────────────────────────────

// 첫 인사 + 2턴 (EN 따라 말하기 → 한국어 대답) 해 둔다
async function twoTurns(page: Page, queue: MockReply[]) {
  await startWithGreeting(page, queue, GREET_REPEAT)
  await exchange(
    page,
    queue,
    "I'm fine",
    { say: 'Great! What do you do?', say_ko: '좋아! 무슨 일 해?', hints: [{ en: 'I am a teacher.', ko: '선생님이에요.' }] },
    'en',
  )
  await exchange(
    page,
    queue,
    '나는 회사원이야',
    { say: 'Oh, an office worker!', say_ko: '오, 회사원이구나!', cue: '따라 해 볼까요?', repeat: 'I am an office worker.', repeat_ko: '나는 회사원이야.' },
    'ko',
  )
}

test.describe('임시 저장', () => {
  test('2턴 뒤 englishFriend.draft.<탭> 내용 → 새로고침 → 저장 안 된 대화 카드 → 이어서 하기(말풍선·요청 기록 복원)', async ({
    page,
    context,
  }) => {
    const { queue, requests, errors } = await open(page, context)
    await twoTurns(page, queue)
    const tab = await tabIdOf(page)
    expect(tab).toBeTruthy()
    // 3분쯤 대화한 것으로 (15초마다 임시 저장)
    await page.clock.fastForward('03:00')
    await expect.poll(async () => (await draftOf(page))?.activeMs ?? 0).toBeGreaterThanOrEqual(175_000)

    const d = (await draftOf(page)) as DraftLike
    expect(await draftKeys(page)).toEqual([K.draft + tab])
    expect(d).toMatchObject({
      tabId: tab,
      date: TODAY,
      limitSec: 900,
      stage: 1,
      unit: 's1-1',
      stats: { turns: 2, koTurns: 1, repeatTurns: 1, enOwnTurns: 0, enOwnWords: 0 },
      pendingRepeat: 'I am an office worker.',
      repeats: [
        { en: "I'm fine.", ko: '난 괜찮아.' },
        { en: 'I am an office worker.', ko: '나는 회사원이야.' },
      ],
    })
    expect(d.messages.map((m) => m.kind)).toEqual(['ai', 'me', 'ai', 'me', 'ai'])
    expect(d.messages[1]).toMatchObject({ kind: 'me', text: "I'm fine", lang: 'en' })
    expect(d.history.map((h) => h.role)).toEqual(['user', 'model', 'user', 'model', 'user', 'model'])
    expect(d.history[0].parts[0].text).toBe(START_MSG_UNIT1)
    expect(d.savedAt).toBeGreaterThan(NOW.getTime())

    // 새로고침 → 시작 화면에 카드
    await page.reload()
    await expect(page.locator('#startSheet')).toBeVisible()
    expect(await tabIdOf(page)).toBe(tab)
    const card = page.locator('#draftCard')
    await expect(card).toBeVisible()
    await expect(card).toContainText('저장 안 된 대화가 있어요')
    await expect(card.locator('.muted')).toHaveText('오늘 · 2번 주고받음 · 문장 2개')
    await expect(page.locator('#btnStart')).toHaveText('새로 시작하기')
    // 같은 탭의 임시 저장은 '다른 탭에서 대화 중'이 아니다
    await expect(page.locator('#busyElsewhere')).toHaveCount(0)

    await page.click('#btnDraftResume')
    await expect(page.locator('#composer')).toBeVisible()
    await expect(page.locator('#startSheet')).toHaveCount(0)
    await expect(aiBubbles(page)).toHaveCount(3)
    await expect(aiBubbles(page).nth(0)).toContainText('Hi! How are you?')
    await expect(page.locator('.msg.me')).toHaveCount(2)
    await expect(page.locator('.msg.me').nth(1)).toContainText('나는 회사원이야')
    await expect(page.locator('#turnCount')).toHaveText('2/5 턴 완료')
    // 대화한 시간도 이어진다 (15분 중 3분)
    await expect(page.locator('#timer')).toHaveText('12분 남음')
    // 따라 말할 문장도 그대로
    await expect(page.locator('#guide')).toHaveText('이제 내 차례! EN을 누르고 "I am an office worker." 따라 말해요')
    // 답을 이미 받은 상태였으니 새 요청은 없다
    expect(requests).toHaveLength(3)

    // 이어서 대답 → 요청에 앞의 대화가 그대로 들어간다
    await exchange(page, queue, 'I am an office worker', { say: 'Nice!', say_ko: '좋아!' }, 'en')
    expect(requests).toHaveLength(4)
    const contents = requests[3].body.contents
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user', 'model', 'user', 'model', 'user'])
    expect(contents[0].parts[0].text).toBe(START_MSG_UNIT1)
    expect(contents[2].parts[0].text).toBe('[따라 말하기 — 목표 문장: "I\'m fine."] I\'m fine')
    expect(contents[4].parts[0].text).toBe('[한국어] 나는 회사원이야')
    expect(JSON.parse(contents[5].parts[0].text)).toMatchObject({ repeat: 'I am an office worker.' })
    expect(lastUserText(requests[3])).toBe('[따라 말하기 — 목표 문장: "I am an office worker."] I am an office worker')
    await expect(page.locator('#turnCount')).toHaveText('3/5 턴 완료')
    await expect.poll(async () => (await draftOf(page))?.stats.turns).toBe(3)
    expect(errors).toEqual([])
  })

  test('답을 기다리다 새로고침 → 이어서 하기 하면 그 답을 다시 받아 온다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    // 답이 오기 전에 새로고침
    queue.push({ ...reply(turn({ say: 'Late answer', say_ko: '늦은 답' })), delayMs: 3000 })
    await page.fill('#typeInput', '배고파')
    await page.click('#typeSend')
    await expect(page.locator('.bubble.typing')).toBeVisible()
    await expect.poll(async () => (await draftOf(page))?.history.length).toBe(3)
    await page.reload()
    const card = page.locator('#draftCard')
    await expect(card.locator('.muted')).toHaveText('오늘 · 1번 주고받음 · 문장 0개')

    queue.length = 0
    queue.push(reply(turn({ say: 'Oh, you are hungry!', say_ko: '오, 배고프구나!' })))
    await page.click('#btnDraftResume')
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(aiBubbles(page).nth(1)).toContainText('Oh, you are hungry!')
    const last = requests[requests.length - 1]
    expect(last.body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(lastUserText(last)).toBe('[한국어] 배고파')
    expect(errors).toEqual([])
  })

  test('저장하고 닫기: 기록만 progress에 들어가고 카드가 사라진다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await twoTurns(page, queue)
    await expect.poll(async () => (await draftOf(page))?.stats.turns).toBe(2)
    await page.reload()
    await expect(page.locator('#draftCard')).toBeVisible()

    await page.click('#btnDraftSave')
    await expect(page.locator('#draftCard')).toHaveCount(0)
    await expect(page.locator('#btnStart')).toHaveText('지금 Emma와 수다 떨기')
    await expect(page.locator('#startMsg')).toHaveText('2문장을 문장장에 저장했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 2번). 오늘 1분.')
    const p = await progressIn(page)
    expect(p?.sessions).toHaveLength(1)
    expect(p?.sessions[0]).toMatchObject({ date: TODAY, unit: 's1-1', turns: 2, koTurns: 1, repeatTurns: 1, minutes: 1 })
    expect(await learnedEn(page)).toEqual(["I'm fine.", 'I am an office worker.'])
    expect(await draftKeys(page)).toEqual([])
    // 새로고침해도 다시 나오지 않는다
    await page.reload()
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#draftCard')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('버리기: 확인 창에서 취소하면 그대로, 확인하면 기록 없이 지운다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    const asked: string[] = []
    let accept = false
    page.on('dialog', async (dlg) => {
      if (dlg.type() === 'beforeunload') return dlg.accept()
      asked.push(`${dlg.type()}: ${dlg.message()}`)
      if (accept) await dlg.accept()
      else await dlg.dismiss()
    })
    await twoTurns(page, queue)
    await expect.poll(async () => (await draftOf(page))?.stats.turns).toBe(2)
    await page.reload()
    await expect(page.locator('#draftCard')).toBeVisible()
    const keys = await draftKeys(page)
    expect(keys).toHaveLength(1)

    // 취소 → 유지
    await page.click('#btnDraftDiscard')
    await expect.poll(() => asked.length).toBe(1)
    expect(asked[0]).toBe('confirm: 이 대화를 버릴까요? 따라 한 문장과 기록이 저장되지 않아요.')
    await expect(page.locator('#draftCard')).toBeVisible()
    expect(await draftKeys(page)).toEqual(keys)

    // 확인 → 삭제, 기록도 문장도 남지 않음
    accept = true
    await page.click('#btnDraftDiscard')
    await expect.poll(() => asked.length).toBe(2)
    await expect(page.locator('#draftCard')).toHaveCount(0)
    expect(await draftKeys(page)).toEqual([])
    expect((await progressIn(page))?.sessions ?? []).toHaveLength(0)
    expect(await learnedEn(page)).toEqual([])
    await page.reload()
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#draftCard')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('카드가 있는데 "새로 시작하기"를 누르면 남은 대화를 먼저 기록하고 새 대화를 연다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await twoTurns(page, queue)
    await expect.poll(async () => (await draftOf(page))?.stats.turns).toBe(2)
    await page.reload()
    await expect(page.locator('#draftCard')).toBeVisible()

    queue.push(reply(turn({ say: 'Hello again!', say_ko: '다시 안녕!' })))
    await page.click('#btnStart')
    await expect(aiBubbles(page)).toHaveCount(1)
    await expect(page.locator('#turnCount')).toHaveText('0/5 턴 완료')
    // 새 대화는 처음부터 (앞 대화를 요청에 섞지 않는다)
    expect(requests[requests.length - 1].body.contents).toHaveLength(1)
    const p = await progressIn(page)
    expect(p?.sessions).toHaveLength(1)
    expect(p?.sessions[0]).toMatchObject({ turns: 2 })
    expect(await learnedEn(page)).toEqual(["I'm fine.", 'I am an office worker.'])
    expect(errors).toEqual([])
  })

  test('어제 남은 대화: 이어서 하기 없이 날짜와 함께 보여 주고, 저장하면 어제 날짜로 기록된다', async ({ page, context }) => {
    const greet = turn({ say: 'Hi! How are you?', say_ko: '안녕! 잘 지내?' })
    const tired = turn({ say: 'Oh, you are tired.', say_ko: '피곤하구나.', cue: '따라 해 볼까요?', repeat: "I'm tired.", repeat_ko: '피곤해.' })
    const old = {
      tabId: 'old-tab',
      savedAt: new Date('2026-10-07T22:30:00+09:00').getTime(),
      date: day(-1),
      activeMs: 180_000,
      limitSec: 900,
      stage: 1,
      unit: 's1-1',
      stats: { turns: 2, koTurns: 2, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 },
      repeats: [{ en: "I'm tired.", ko: '피곤해.' }],
      messages: [
        { kind: 'ai', id: 1, turn: greet, veiled: false },
        { kind: 'me', id: 2, text: '피곤해', lang: 'ko', isRepeat: false },
        { kind: 'ai', id: 3, turn: tired, veiled: false },
        { kind: 'me', id: 4, text: '응', lang: 'ko', isRepeat: false },
      ],
      history: [
        { role: 'user', parts: [{ text: START_MSG_UNIT1 }] },
        { role: 'model', parts: [{ text: JSON.stringify(greet) }] },
        { role: 'user', parts: [{ text: '[한국어] 피곤해' }] },
        { role: 'model', parts: [{ text: JSON.stringify(tired) }] },
        { role: 'user', parts: [{ text: '[한국어] 응' }] },
      ],
      pendingRepeat: '',
    }
    const { errors } = await open(page, context, { storage: { [K.draft + 'old-tab']: old } })
    const card = page.locator('#draftCard')
    await expect(card).toBeVisible()
    await expect(card.locator('.muted')).toHaveText(`${day(-1)} · 2번 주고받음 · 문장 1개`)
    // 날짜가 지난 대화는 이어서 하지 않는다
    await expect(page.locator('#btnDraftResume')).toHaveCount(0)
    await expect(page.locator('#busyElsewhere')).toHaveCount(0)

    await page.click('#btnDraftSave')
    await expect(card).toHaveCount(0)
    const p = await progressIn(page)
    expect(p?.sessions).toHaveLength(1)
    expect(p?.sessions[0]).toMatchObject({ date: day(-1), minutes: 3, turns: 2, koTurns: 2 })
    expect(await storageGet(page, K.learned)).toEqual([{ en: "I'm tired.", ko: '피곤해.', date: day(-1) }])
    expect(await draftKeys(page)).toEqual([])
    // 시작 화면: 어제 기록이라 오늘은 0분
    await expectToday(page, '1일 연속 · 오늘 0분 / 목표 15분')
    const msg = page.locator('#startMsg')
    await expect(msg).toContainText('1문장을 문장장에 저장했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 2번).')
    // 결과 문구가 어제 한 3분을 '오늘 3분'이라고 하면 바로 위 '오늘 0분'과 어긋난다
    await expect(msg).not.toContainText('오늘 3분')
    await expect(msg).toContainText('10월 7일 기록으로 남겼어요.')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 5) 두 탭
// ─────────────────────────────────────────────

test.describe('두 탭', () => {
  test('A가 대화 중이면 B 시작 화면에 안내 → A가 저장하고 끝내면 B 화면(오늘 분·문장장)이 바로 바뀌고 안내가 사라진다', async ({
    page,
    context,
  }) => {
    const { queue, errors } = await open(page, context)
    const b = await openSecondTab(context)
    await expect(b.page.locator('#busyElsewhere')).toHaveCount(0)
    await expect(b.page.locator('#todayLine')).toHaveCount(0)

    // A: 대화 시작 + 1턴
    await page.bringToFront()
    await startWithGreeting(page, queue, { ...GREET_REPEAT, repeat: 'I like coffee.', repeat_ko: '나는 커피가 좋아.' })
    await exchange(page, queue, 'I like coffee', { say: 'Me too!', say_ko: '나도!' }, 'en')

    // B: 다른 탭에서 대화 중이라는 안내 (되살리기 카드는 아님)
    await expect(b.page.locator('#busyElsewhere')).toHaveText(
      '다른 탭(창)에서 대화 중이에요. 같은 기기에서는 한 곳에서만 대화하는 게 안전해요.',
    )
    await expect(b.page.locator('#draftCard')).toHaveCount(0)
    // 대화 중인 A의 시간은 저절로 흐르며 계속 임시 저장 → 30초가 지나도 B는 계속 안내
    await page.clock.fastForward('00:40')
    await expect(b.page.locator('#busyElsewhere')).toBeVisible()
    await expect(b.page.locator('#draftCard')).toHaveCount(0)

    // A: 저장하고 끝내기
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toContainText('1문장을 문장장에 저장했어요.')

    // B: 새로고침 없이 갱신 (storage 이벤트)
    await expect(b.page.locator('#busyElsewhere')).toHaveCount(0)
    await expect(b.page.locator('#todayLine')).toContainText('1분 / 15분')
    await expect(b.page.locator('#todayRoutine')).toBeVisible()
    await b.page.click('#tab-library')
    await b.page.click('#btnStartBook')
    await expect(b.page.locator('#bookSheet .repeat-text')).toHaveText(['I like coffee.'])
    expect(errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  test('A·B가 동시에 대화하고 차례로 저장: B가 A의 문장·기록을 덮어쓰지 않는다 (문장장 합집합, 기록 2개)', async ({
    page,
    context,
  }) => {
    const { queue, errors } = await open(page, context)
    const b = await openSecondTab(context)

    await page.bringToFront()
    await startWithGreeting(page, queue, { ...GREET_REPEAT, repeat: 'I like coffee.', repeat_ko: '나는 커피가 좋아.' })
    await exchange(page, queue, 'I like coffee', { say: 'Me too!', say_ko: '나도!' }, 'en')

    await b.page.bringToFront()
    await expect(b.page.locator('#busyElsewhere')).toBeVisible()
    await startWithGreeting(b.page, queue, { ...GREET_REPEAT, repeat: 'I like tea.', repeat_ko: '나는 차가 좋아.' })
    await exchange(b.page, queue, 'I like tea', { say: 'Nice!', say_ko: '좋다!' }, 'en')
    await exchange(b.page, queue, '녹차 좋아해', { say: 'Green tea!', say_ko: '녹차!' }, 'ko')
    // B가 대화를 시작할 때 A의 진행 중인 대화를 남은 대화로 착각해 저장하지 않는다
    expect((await progressIn(b.page))?.sessions ?? []).toHaveLength(0)

    // 두 탭의 임시 저장은 따로
    const tabA = await tabIdOf(page)
    const tabB = await tabIdOf(b.page)
    expect(tabA).not.toBe(tabB)
    expect((await draftKeys(page)).sort()).toEqual([K.draft + tabA, K.draft + tabB].sort())

    // A 먼저 저장
    await page.bringToFront()
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toContainText('1문장을 문장장에 저장했어요.')
    expect(await learnedEn(page)).toEqual(['I like coffee.'])

    // B 나중에 저장 → A의 것과 합쳐진다
    await b.page.bringToFront()
    await b.page.click('#btnEnd')
    await b.page.click('#btnFinish')
    await expect(b.page.locator('#startMsg')).toHaveText(
      '1문장을 문장장에 저장했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 2번). 오늘 2분.',
    )
    expect((await learnedEn(b.page)).sort()).toEqual(['I like coffee.', 'I like tea.'])
    const p = await progressIn(b.page)
    expect(p?.sessions).toHaveLength(2)
    expect(p?.sessions.map((s) => s.turns).sort()).toEqual([1, 2])
    expect(await draftKeys(b.page)).toEqual([])
    // A 화면도 B 저장을 반영
    await expect(page.locator('#todayLine')).toContainText('2분 / 15분')
    expect(errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  test('A 탭이 닫히고 30초가 지나면 B에서 안내 대신 되살리기 카드 → B에서 이어서 하면 A의 임시 저장은 B로 옮겨진다', async ({
    page,
    context,
  }) => {
    const { queue, errors } = await open(page, context)
    const b = await openSecondTab(context)
    await page.bringToFront()
    await startWithGreeting(page, queue, GREET_REPEAT)
    await exchange(page, queue, "I'm fine", { say: 'Good to hear!', say_ko: '다행이다!' }, 'en')
    const tabA = await tabIdOf(page)
    await expect(b.page.locator('#busyElsewhere')).toBeVisible()
    await page.close()

    await b.page.bringToFront()
    // 30초 안에는 아직 A에서 대화 중일 수 있으니 안내만
    await b.page.clock.fastForward('00:15')
    await expect(b.page.locator('#busyElsewhere')).toBeVisible()
    await expect(b.page.locator('#draftCard')).toHaveCount(0)
    // 30초가 넘으면 닫힌 탭의 대화로 보고 되살리기 카드
    await b.page.clock.fastForward('00:20')
    await expect(b.page.locator('#busyElsewhere')).toHaveCount(0)
    const card = b.page.locator('#draftCard')
    await expect(card).toBeVisible()
    await expect(card.locator('.muted')).toHaveText('오늘 · 1번 주고받음 · 문장 1개')

    await b.page.click('#btnDraftResume')
    await expect(aiBubbles(b.page)).toHaveCount(2)
    await expect(b.page.locator('.msg.me')).toHaveCount(1)
    await expect(b.page.locator('#turnCount')).toHaveText('1/5 턴 완료')
    const tabB = await tabIdOf(b.page)
    await expect.poll(() => draftKeys(b.page)).toEqual([K.draft + tabB])
    expect(tabB).not.toBe(tabA)
    expect(errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  // 크롬은 오래 뒤에 있는 탭의 타이머를 1분에 한 번으로 줄이거나(PC) 탭을 얼린다(안드로이드).
  // 그동안 A의 임시 저장이 30초 넘게 갱신되지 않으면 B는 A를 '닫힌 탭'으로 보고 그 대화를 저장해 버린다.
  // 여기서는 A의 임시 저장 쓰기를 잠시 막아 그 상황을 만든다.
  test('뒤에 있던 A 탭의 대화를 B가 대신 저장한 뒤 A가 이어서 끝내도, 같은 대화가 두 번 기록되지 않는다', async ({
    page,
    context,
  }) => {
    const { queue, errors } = await open(page, context)
    const b = await openSecondTab(context)
    await page.bringToFront()
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕', { say: 'Hi!', say_ko: '안녕!' })
    await expect(b.page.locator('#busyElsewhere')).toBeVisible()

    // A가 뒤로 가서 멈춤 (임시 저장이 갱신되지 않음)
    await page.evaluate(() => {
      const w = window as unknown as { __paused: boolean }
      const setItem = Storage.prototype.setItem
      w.__paused = true
      Storage.prototype.setItem = function (k: string, v: string) {
        if (w.__paused && k.startsWith('englishFriend.draft.')) return
        return setItem.call(this, k, v)
      }
    })
    await b.page.bringToFront()
    await b.page.clock.fastForward('00:31')
    await expect(b.page.locator('#draftCard')).toBeVisible()
    // B에서 새로 시작하면 A의 대화(1번)를 남은 대화로 보고 먼저 저장한다
    await startWithGreeting(b.page, queue, { say: 'Hello from B', say_ko: 'B에서 안녕' })
    expect((await progressIn(b.page))?.sessions.map((x) => x.turns)).toEqual([1])

    // A로 돌아오면: B가 이미 저장한 대화라서 A는 기록하지 않고 닫으며 이유를 알려 준다
    await page.bringToFront()
    await page.evaluate(() => {
      ;(window as unknown as { __paused: boolean }).__paused = false
    })
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#startMsg')).toContainText('다른 탭에서 이어받았거나 저장했어요')
    // A가 다시 써서 같은 대화가 두 번 기록되거나 임시 저장이 되살아나지 않는다
    const sessions = (await progressIn(page))?.sessions ?? []
    expect(sessions.map((x) => x.turns)).toEqual([1])
    // 한 번 더 저장 주기가 지나도 A의 임시 저장이 되살아나지 않는다 (되살아나면 다음 시작에서 또 기록된다)
    await page.clock.fastForward('00:16')
    expect(await draftKeys(page)).toEqual([])
    expect(((await progressIn(page))?.sessions ?? []).map((x) => x.turns)).toEqual([1])
    expect(errors).toEqual([])
    expect(b.errors).toEqual([])
  })

  test('오늘 할 일 체크: A에서 누른 것이 B에도 보이고, B가 다른 항목을 눌러도 A의 체크를 지우지 않는다', async ({
    page,
    context,
  }) => {
    const { errors } = await open(page, context, { storage: { [K.progress]: progressOf(log(TODAY, 5)) } })
    const b = await openSecondTab(context)
    await page.bringToFront()
    await box(page, 1).click()
    await expect(box(page, 1)).toBeChecked()
    expect(await storageGet(page, K.daily)).toEqual({ date: TODAY, checks: [1] })

    await b.page.bringToFront()
    // B 화면도 맞춰져야 한다 (storage 이벤트)
    await expect.soft(box(b.page, 1)).toBeChecked()
    await box(b.page, 2).click()
    await expect(box(b.page, 2)).toBeChecked()
    // B가 쓸 때 A의 체크를 지우면 안 된다
    const daily = (await storageGet(b.page, K.daily)) as { date: string; checks: number[] }
    expect(daily.date).toBe(TODAY)
    expect([...daily.checks].sort()).toEqual([1, 2])
    expect(errors).toEqual([])
    expect(b.errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 6) 나가기 경고 (beforeunload)
// ─────────────────────────────────────────────

test.describe('나가기 경고', () => {
  test('시작 화면·첫 인사만 받은 상태에서는 막지 않고, 한 번이라도 대답했으면 막고, 끝낸 뒤에는 다시 막지 않는다', async ({
    page,
    context,
  }) => {
    const { queue, errors } = await open(page, context)
    expect(await leaveBlocked(page)).toBe(false)
    await startWithGreeting(page, queue)
    expect(await leaveBlocked(page)).toBe(false)
    await exchange(page, queue, '안녕', { say: 'Hi!', say_ko: '안녕!' })
    expect(await leaveBlocked(page)).toBe(true)
    // 마무리 창이 열려 있어도 아직 저장 전이라 막는다
    await page.click('#btnEnd')
    expect(await leaveBlocked(page)).toBe(true)
    await page.click('#btnFinish')
    await expect(page.locator('#startSheet')).toBeVisible()
    expect(await leaveBlocked(page)).toBe(false)
    expect(errors).toEqual([])
  })

  test('실제 탭 닫기: 대화 중이면 브라우저가 나가기 확인 창을 띄우고, 취소하면 대화가 그대로 남는다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕', { say: 'Hi!', say_ko: '안녕!' })

    const dialog = page.waitForEvent('dialog')
    await page.close({ runBeforeUnload: true })
    const dlg = await dialog
    expect(dlg.type()).toBe('beforeunload')
    await dlg.dismiss()
    expect(page.isClosed()).toBe(false)
    await expect(page.locator('#composer')).toBeVisible()
    await expect(aiBubbles(page)).toHaveCount(2)
    expect(errors).toEqual([])
  })

  // (한 탭에서 닫기를 한 번 취소하면 크롬이 같은 탭의 다음 닫기 요청을 받지 않아서, 끝낸 뒤 닫기는 새 탭으로 본다)
  test('실제 탭 닫기: 대화를 저장하고 끝낸 뒤에는 확인 창 없이 바로 닫힌다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕', { say: 'Hi!', say_ko: '안녕!' })
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startSheet')).toBeVisible()
    let asked = ''
    page.on('dialog', (d) => {
      asked = d.type()
      void d.dismiss()
    })
    const closed = page.waitForEvent('close')
    await page.close({ runBeforeUnload: true })
    await closed
    expect(asked).toBe('')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 7) 오늘 할 일 체크리스트
// ─────────────────────────────────────────────

const ROUTINE_1 = [
  '앱 대화 15분',
  '문장장 문장을 듣고 소리 내어 따라 하기 10분',
  '유아용 영어 애니메이션을 영어 자막으로 20분 (다 못 알아들어도 괜찮아요. 소리에 익숙해지는 게 목표)',
]

test.describe('오늘 할 일', () => {
  test('목표 전이면 첫 항목은 체크 안 됨, 나머지는 눌러서 체크 → 새로고침 후에도 유지, 어제 체크는 오늘 비어 있음', async ({
    page,
    context,
  }) => {
    const { errors } = await open(page, context, {
      storage: {
        [K.progress]: progressOf(log(TODAY, 5)),
        [K.daily]: { date: day(-1), checks: [1, 2] },
      },
    })
    const routine = page.locator('#todayRoutine')
    await expect(routine.locator('h3')).toHaveText('오늘의 3대 루틴')
    await expect(items(page).locator('.check span')).toHaveText(ROUTINE_1)
    // 어제 체크한 것은 오늘 남지 않는다
    for (const i of [0, 1, 2]) await expect(box(page, i)).not.toBeChecked()
    // 5분 / 목표 15분 → 첫 항목 자동 체크 아님
    await expect(box(page, 0)).toBeEnabled()

    await box(page, 1).click()
    await expect(box(page, 1)).toBeChecked()
    await expect(items(page).nth(1).locator('.check span')).toHaveClass(/done-text/)
    await box(page, 2).click()
    await expect(box(page, 2)).toBeChecked()
    expect(await storageGet(page, K.daily)).toEqual({ date: TODAY, checks: [1, 2] })

    await page.reload()
    await expect(routine).toBeVisible()
    await expect(box(page, 0)).not.toBeChecked()
    await expect(box(page, 1)).toBeChecked()
    await expect(box(page, 2)).toBeChecked()

    // 다시 누르면 풀린다
    await box(page, 1).click()
    await expect(box(page, 1)).not.toBeChecked()
    await expect(items(page).nth(1).locator('.check span')).not.toHaveClass(/done-text/)
    expect(await storageGet(page, K.daily)).toEqual({ date: TODAY, checks: [2] })
    await page.reload()
    await expect(box(page, 1)).not.toBeChecked()
    await expect(box(page, 2)).toBeChecked()
    expect(errors).toEqual([])
  })

  test('시작 화면을 켜 둔 채 자정을 넘기면(새로고침 없이) 어제 체크는 풀리고, 새 체크는 새 날짜로만 저장된다', async ({
    page,
    context,
  }) => {
    const { errors } = await open(page, context, {
      time: new Date('2026-10-08T23:59:00+09:00'),
      storage: { [K.progress]: progressOf(log(TODAY, 5)), [K.daily]: { date: TODAY, checks: [1] } },
    })
    await expectToday(page, '1일 연속 · 오늘 5분 / 목표 15분')
    await expect(box(page, 1)).toBeChecked()

    await page.clock.fastForward('02:00')
    // 한 줄은 새 날(10월 9일)로 바뀐다
    await expectToday(page, '1일 연속 · 오늘 0분 / 목표 15분')
    // 체크도 새 날에 맞춰 비어야 한다
    await expect.soft(box(page, 1)).not.toBeChecked()
    await box(page, 2).click()
    await expect(box(page, 2)).toBeChecked()
    expect(await storageGet(page, K.daily)).toEqual({ date: day(1), checks: [2] })
    expect(errors).toEqual([])
  })

  test('첫 항목은 오늘 목표 분을 채우면 저절로 체크된다 (14분 + 이번 대화 1분 = 15분)', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, { storage: { [K.progress]: progressOf(log(TODAY, 14)) } })
    await expect(box(page, 0)).not.toBeChecked()
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕', { say: 'Hi!', say_ko: '안녕!' })
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#todayLine')).toContainText('15분 / 15분')
    await expect(box(page, 0)).toBeChecked()
    // 저절로 된 체크는 눌러서 풀 수 없다
    await expect(box(page, 0)).toBeDisabled()
    await expect(items(page).nth(0).locator('.check span')).toHaveClass(/done-text/)
    expect(errors).toEqual([])
  })

  test('"하러 가기"는 문장장 복습 화면을 바로 연다', async ({ page, context }) => {
    const learned = [
      { en: 'I like summer.', ko: '나는 여름이 좋아.', date: day(-7) },
      { en: "It's cold.", ko: '추워.', date: day(-3) },
      { en: 'I want water.', ko: '물 주세요.', date: day(-1) },
    ]
    const { errors } = await open(page, context, {
      storage: { [K.progress]: progressOf(log(day(-1), 10)), [K.learned]: learned },
    })
    // 문장장 항목에만 버튼이 있다
    await expect(page.locator('#todayRoutine button')).toHaveCount(1)
    const go = items(page).nth(1).getByRole('button', { name: '하러 가기' })
    await go.click()
    const sheet = page.locator('#bookSheet')
    await expect(sheet).toBeVisible()
    await expect(page.locator('#bookSheet-title')).toHaveText('오늘 복습')
    await expect(page.locator('#reviewBody .read-card .say')).toHaveText(['I like summer.', "It's cold.", 'I want water.'])
    await expect(page.locator('#reviewBody .write-box')).toBeVisible()
    // 목록으로 → 문장장 목록
    await page.click('#btnReviewDone')
    await expect(page.locator('#bookSheet-title')).toHaveText('내 문장장')
    await expect(page.locator('#btnReview')).toHaveText('오늘 복습 3문장')
    expect(errors).toEqual([])
  })

  test('복습 문장 수는 버튼에 적힌 대로 5문장 (문장이 많고 날짜가 고르게 퍼져 있어도)', async ({ page, context }) => {
    // 배운 날이 40·30·14·10·7·3·1·0일 전인 문장 8개
    const ages = [40, 30, 14, 10, 7, 3, 1, 0]
    const learned = ages.map((a, i) => ({ en: `Sentence number ${i + 1}.`, ko: `문장 ${i + 1}`, date: day(-a) }))
    const { errors } = await open(page, context, {
      storage: { [K.progress]: progressOf(log(day(-1), 10)), [K.learned]: learned },
    })
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#btnReview')).toHaveText('오늘 복습 5문장')
    await page.click('#btnReview')
    await expect(page.locator('#bookSheet-title')).toHaveText('오늘 복습')
    const cards = page.locator('#reviewBody .read-card')
    // 최근 3문장은 꼭 들어간다
    await expect(cards.locator('.say').filter({ hasText: 'Sentence number 8.' })).toHaveCount(1)
    await expect(cards.locator('.say').filter({ hasText: 'Sentence number 7.' })).toHaveCount(1)
    await expect(cards.locator('.say').filter({ hasText: 'Sentence number 6.' })).toHaveCount(1)
    await expect(cards).toHaveCount(5)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 8) 연속 일수·오늘 분
// ─────────────────────────────────────────────

test.describe('연속 일수·오늘 분', () => {
  const cases: { name: string; sessions: SessionLogLike[]; goal?: number; line: string; bar: number }[] = [
    {
      name: '어제·오늘(두 번) → 2일 연속, 오늘 분은 합계',
      sessions: [log(day(-1), 10), log(TODAY, 7), log(TODAY, 3)],
      line: '2일 연속 · 오늘 10분 / 목표 15분',
      bar: 10 / 15,
    },
    {
      name: '오늘은 아직, 어제·그제 → 2일 연속 (오늘 0분)',
      sessions: [log(day(-2), 15), log(day(-1), 15)],
      line: '2일 연속 · 오늘 0분 / 목표 15분',
      bar: 0,
    },
    {
      name: '사흘 전과 오늘 (사이가 끊김) → 1일 연속',
      sessions: [log(day(-3), 15), log(TODAY, 5)],
      line: '1일 연속 · 오늘 5분 / 목표 15분',
      bar: 5 / 15,
    },
    { name: '사흘 전에만 → 연속 없음', sessions: [log(day(-3), 15)], line: '오늘 0분 / 목표 15분', bar: 0 },
    {
      name: '목표 20분, 오늘 25분 → 막대는 꽉 참',
      sessions: [log(TODAY, 25)],
      goal: 20,
      line: '1일 연속 · 오늘 25분 / 목표 20분',
      bar: 1,
    },
  ]
  for (const c of cases) {
    test(`시작 화면 한 줄: ${c.name}`, async ({ page, context }) => {
      const { errors } = await open(page, context, {
        settings: c.goal ? { minutes: c.goal } : {},
        storage: { [K.progress]: progressOf(...c.sessions) },
      })
      await expectToday(page, c.line)
      const width = await page.locator('#todayLine .bar span').evaluate((el) => (el as HTMLElement).style.width)
      expect(parseFloat(width)).toBeCloseTo(c.bar * 100, 1)
      expect(errors).toEqual([])
    })
  }

  test('기록이 없으면 한 줄도 할 일도 없다 (처음 안내만)', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await expect(page.locator('#todayLine')).toHaveCount(0)
    await expect(page.locator('#todayRoutine')).toHaveCount(0)
    await expect(page.locator('#firstGuide')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('어제 하고 오늘 대화를 끝내면 결과에 "N일 연속"이 붙고 한 줄이 바뀐다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, { storage: { [K.progress]: progressOf(log(day(-1), 10)) } })
    await expectToday(page, '1일 연속 · 오늘 0분 / 목표 15분')
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕', { say: 'Hi!', say_ko: '안녕!' })
    // 2분 30초 대화 → 3분(반올림)
    await page.clock.fastForward('02:30')
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toHaveText('수고했어요. 「인사와 자기소개」 단원은 대화 한 번에 5번 주고받으면 마쳐요 (이번엔 1번). 오늘 3분 · 2일 연속.')
    await expectToday(page, '2일 연속 · 오늘 3분 / 목표 15분')
    expect((await progressIn(page))?.sessions.at(-1)).toMatchObject({ date: TODAY, minutes: 3 })
    expect(errors).toEqual([])
  })
})
