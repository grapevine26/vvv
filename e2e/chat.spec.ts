import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  aiBubbles,
  clearSpoken,
  collectErrors,
  errorReply,
  horizontalOverflow,
  installMocks,
  lastRec,
  lastUserText,
  reply,
  say,
  setMic,
  silence,
  spoken,
  startWithGreeting,
  turn,
  type MockReply,
} from './helpers'

// 대화 화면 흐름: 단계 안내, 따라 말하기·힌트 칩 세기, 마이크 조작, 자동 듣기, 글로 쓰기, 오류 말풍선, 느린 응답, 폰 화면

// ── 이 파일 전용 도구 ──

// 소리를 낸 순간 마이크가 아직 듣고 있었는지, 말이 언제 끝났는지, 인식이 언제 시작됐는지 기록한다
const INSTRUMENT = () => {
  const w = window as unknown as {
    speechSynthesis: { speak: (u: { text: string; onend?: ((e: unknown) => void) | null }) => void }
    SpeechRecognition: { prototype: { start: () => void } }
    __recs: { started: boolean; stopped: boolean }[]
    __speakLog: { text: string; at: number; endAt: number; recListening: boolean }[]
  }
  w.__speakLog = []
  const synth = w.speechSynthesis
  const speak = synth.speak.bind(synth)
  synth.speak = (u) => {
    const r = w.__recs[w.__recs.length - 1]
    const entry = { text: u.text, at: Date.now(), endAt: 0, recListening: !!r && r.started && !r.stopped }
    w.__speakLog.push(entry)
    const onend = u.onend
    u.onend = (e) => {
      entry.endAt = Date.now()
      if (onend) onend(e)
    }
    speak(u)
  }
  const proto = w.SpeechRecognition.prototype as { start: () => void; startedAt?: number }
  const start = proto.start
  proto.start = function (this: { startedAt?: number }) {
    this.startedAt = Date.now()
    return start.call(this)
  }
}

interface SpeakEntry {
  text: string
  at: number
  endAt: number
  recListening: boolean
}

// 키가 있는 상태로 앱을 연다 (설정 몇 가지를 덧붙일 수 있다)
async function open(page: Page, context: BrowserContext, extra: Record<string, unknown> = {}) {
  const mocks = await installMocks(context, { storage: { 'englishFriend.settings': { apiKey: 'K', ...extra } } })
  await context.addInitScript(INSTRUMENT)
  const errors = collectErrors(page)
  await page.goto('/')
  return { ...mocks, errors }
}

const setSpeakDelay = (page: Page, ms: number) =>
  page.evaluate((m) => {
    ;(window as unknown as { __speakDelay: number }).__speakDelay = m
  }, ms)
const cancelCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __spoken: { cancel?: boolean }[] }).__spoken.filter((s) => s.cancel).length)
const recCount = (page: Page) => page.evaluate(() => (window as unknown as { __recs: unknown[] }).__recs.length)
const speakLog = (page: Page) => page.evaluate(() => (window as unknown as { __speakLog: SpeakEntry[] }).__speakLog)
const recStartedAt = (page: Page) =>
  page.evaluate(() => {
    const recs = (window as unknown as { __recs: { startedAt?: number }[] }).__recs
    return recs[recs.length - 1]?.startedAt ?? 0
  })

// 이 탭의 임시 저장(englishFriend.draft.<tabId>)에 적힌 이번 대화 셈
const draftStats = (page: Page) =>
  page.evaluate(() => {
    const tab = sessionStorage.getItem('englishFriend.tabId')
    const raw = tab && localStorage.getItem('englishFriend.draft.' + tab)
    return raw ? (JSON.parse(raw) as { stats: Record<string, number> }).stats : null
  })

// 키보드로 한 줄 보내기
async function typeSend(page: Page, text: string) {
  await page.fill('#typeInput', text)
  await page.press('#typeInput', 'Enter')
}

const slow = (r: MockReply, delayMs: number): MockReply => ({ ...r, delayMs })

const guide = (page: Page) => page.locator('#guide')
const lastMe = (page: Page) => page.locator('.msg.me').last()
const errorBubble = (page: Page) => page.locator('.msg.ai.error')
const FIRST_TIME_GUIDE = '버튼을 한 번 톡 누르고 말하세요 (누르고 있지 않아도 돼요). 한국어로 대답해도 돼요.'

// ── 1) 단계 안내 ──

test('단계 안내: 생각 중(타이핑 말풍선) → 말하는 중(■ 그만으로 멈춤, 남은 문장 안 읽음) → 내 차례', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  await setSpeakDelay(page, 2000)
  queue.push(
    slow(
      reply(turn({ say: 'Hi! How are you?', say_ko: '안녕! 잘 지내?', cue: '따라 해 볼까요?', repeat: "I'm fine.", repeat_ko: '난 잘 지내.' })),
      1500,
    ),
  )
  await page.click('#btnStart')

  // 생각 중: 안내·타이핑 말풍선·머리줄 상태, 마이크·보내기는 잠김
  await expect(guide(page)).toHaveText('Emma가 생각 중이에요…')
  await expect(page.locator('.bubble.typing')).toBeVisible()
  await expect(page.locator('#status')).toHaveText('생각 중…')
  await expect(page.locator('#micKo')).toBeDisabled()
  await expect(page.locator('#micEn')).toBeDisabled()
  await expect(page.locator('#micEn .mic-label')).toHaveText('Emma 생각 중…')
  await expect(page.locator('#typeSend')).toBeDisabled()

  // 말하는 중
  await expect(aiBubbles(page)).toHaveCount(1)
  await expect(page.locator('.bubble.typing')).toHaveCount(0)
  await expect(guide(page)).toContainText('Emma가 말하는 중… 끝나면 내 차례예요')
  await expect(page.locator('#status')).toHaveText('말하는 중…')
  await expect(page.locator('#micKo')).toBeEnabled()

  // ■ 그만: speechSynthesis.cancel이 불리고 바로 내 차례로
  const cancelsBefore = await cancelCount(page)
  await page.click('#btnStopSpeak')
  expect(await cancelCount(page)).toBe(cancelsBefore + 1)
  await expect(page.locator('#btnStopSpeak')).toHaveCount(0)
  await expect(guide(page)).toHaveText(`이제 내 차례! EN을 누르고 "I'm fine." 따라 말해요`)
  await expect(page.locator('#status')).toHaveText('인사와 자기소개')
  await expect(page.locator('#micEn')).toHaveClass(/recommend/)

  // 첫 문장의 재생이 끝난 뒤에도 남은 문장(신호·따라 할 문장)은 읽지 않는다
  await expect.poll(async () => (await speakLog(page)).find((e) => e.text === 'Hi! How are you?')?.endAt ?? 0).toBeGreaterThan(0)
  expect((await spoken(page)).map((s) => s.text)).toEqual(['Hi! How are you?'])

  // 다음 턴은 끝까지 다 듣고 나면 '내 차례' 안내가 나온다
  await setSpeakDelay(page, 400)
  await clearSpoken(page)
  queue.push(reply(turn({ say: 'Good!', say_ko: '좋아!', cue: '따라 해 볼까요?', repeat: 'Me too.', repeat_ko: '나도.' })))
  await typeSend(page, '좋아')
  await expect(guide(page)).toContainText('말하는 중')
  await expect(guide(page)).toHaveText(`이제 내 차례! EN을 누르고 "Me too." 따라 말해요`, { timeout: 8000 })
  expect(await spoken(page)).toEqual([
    expect.objectContaining({ text: 'Good!', lang: 'en-US' }),
    expect.objectContaining({ text: '따라 해 볼까요?', lang: 'ko-KR' }),
    expect.objectContaining({ text: 'Me too.', lang: 'en-US' }),
  ])
  expect(errors).toEqual([])
})

test('단계 안내: 처음 쓰는 사람에게는 따라 할 문장이 없을 때 버튼 쓰는 법을 알려 준다', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  await expect(page.locator('#micEn')).not.toHaveClass(/recommend/)
  await expect(page.locator('#micKo .mic-label')).toHaveText('한국어로 말하기')
  await expect(page.locator('#micEn .mic-label')).toHaveText('영어로 대답하기 (추천)')
  expect(errors).toEqual([])
})

// ── 2) 한국어 대답 → 따라 말하기 ──

test('한국어로 대답 → 따라 말하기 제안(EN 추천) → 거의 같게 말하면 "잘 들렸어요"와 따라 말하기로 셈', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue, { say: 'How are you today?', say_ko: '오늘 어때?' })
  await expect(page.locator('#turnCount')).toHaveText('0/5 턴 완료')

  queue.push(
    reply(
      turn({ say: 'Oh, you are tired.', say_ko: '아, 피곤하구나.', cue: '이렇게 말해 보세요', repeat: "I'm tired today.", repeat_ko: '나 오늘 피곤해.' }),
    ),
  )
  await page.click('#micKo')
  expect(await lastRec(page)).toMatchObject({ lang: 'ko-KR', started: true })
  await say(page, '오늘 피곤해')
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect(lastMe(page).locator('.tag')).toHaveText('한국어')
  expect(lastUserText(requests[1])).toBe('[한국어] 오늘 피곤해')
  await expect(page.locator('#turnCount')).toHaveText('1/5 턴 완료')

  // AI가 따라 할 문장을 주면: 말풍선에 문장, EN 버튼 추천, 안내에 그 문장
  await expect(aiBubbles(page).last().locator('.repeat-text')).toHaveText("I'm tired today.")
  await expect(aiBubbles(page).last().locator('.cue')).toHaveText('이렇게 말해 보세요')
  await expect(guide(page)).toHaveText(`이제 내 차례! EN을 누르고 "I'm tired today." 따라 말해요`)
  await expect(page.locator('#micEn')).toHaveClass(/recommend/)
  await expect(page.locator('#micKo')).not.toHaveClass(/recommend/)

  // EN으로 거의 같은 문장(I'm → I am, 마침표 없음)을 말하면 잘 들렸다고 칭찬하고 따라 말하기로 센다
  queue.push(reply(turn({ say: 'Great! Why are you tired?', say_ko: '좋아! 왜 피곤해?', cue: '따라 해 볼까요?', repeat: 'I worked late.', repeat_ko: '늦게까지 일했어.' })))
  await page.click('#micEn')
  expect(await lastRec(page)).toMatchObject({ lang: 'en-US', started: true })
  await say(page, 'I am tired today')
  await expect(aiBubbles(page)).toHaveCount(3)
  await expect(lastMe(page).locator('.tag')).toHaveText('따라 말하기')
  await expect(lastMe(page).locator('.heard')).toHaveText('잘 들렸어요')
  expect(lastUserText(requests[2])).toBe(`[따라 말하기 — 목표 문장: "I'm tired today."] I am tired today`)
  // 머리줄 횟수는 한국어·따라 말하기·내 영어를 가리지 않고 '내 대답' 하나마다 1씩 오른다 (App.tsx sendUser: stats.turns++)
  await expect(page.locator('#turnCount')).toHaveText('2/5 턴 완료')
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 2, koTurns: 1, repeatTurns: 1, enOwnTurns: 0, enOwnWords: 0 })

  // 따라 할 문장과 전혀 다르게 말하면 '잘 들렸어요'는 나오지 않고, 질문에 직접 한 '내 대답'으로 센다
  await expect(page.locator('#micEn')).toHaveClass(/recommend/)
  queue.push(reply(turn({ say: 'I see.', say_ko: '그렇구나.' })))
  await page.click('#micEn')
  await say(page, 'banana split')
  await expect(aiBubbles(page)).toHaveCount(4)
  await expect(lastMe(page).locator('.heard')).toHaveCount(0)
  await expect(page.locator('#turnCount')).toHaveText('3/5 턴 완료')
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 3, koTurns: 1, repeatTurns: 1, enOwnTurns: 1, enOwnWords: 2 })
  expect(lastUserText(requests[3])).toBe('[영어] banana split')

  // 따라 할 문장이 없는 답이 오면 추천 표시가 사라진다
  await expect(page.locator('#micEn')).not.toHaveClass(/recommend/)
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  expect(errors).toEqual([])
})

// ── 3) 힌트 칩 ──

test('힌트 칩: 누르면 들려주고 고른 칩 표시 → 그 문장을 말하면 내 힘으로 한 대답이 아니라 따라 말하기로 셈', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue, {
    say: 'Do you like coffee?',
    say_ko: '커피 좋아해?',
    hints: [
      { en: 'Yes, I like coffee.', ko: '응, 커피 좋아해.' },
      { en: 'No, I like tea.', ko: '아니, 차가 좋아.' },
    ],
  })
  const chips = page.locator('.chip.hint')
  await expect(chips).toHaveCount(2)
  await clearSpoken(page)

  await chips.first().click()
  await expect.poll(() => spoken(page)).toEqual([expect.objectContaining({ text: 'Yes, I like coffee.', lang: 'en-US' })])
  await expect(chips.first()).toHaveClass(/picked/)
  await expect(chips.nth(1)).not.toHaveClass(/picked/)
  await expect(guide(page)).toHaveText('EN을 누르고 "Yes, I like coffee." 말해 보세요')
  await expect(page.locator('#micEn')).toHaveClass(/recommend/)
  // 칩을 눌러도 대화 칸이 늘거나 요청이 가지 않는다
  expect(requests).toHaveLength(1)
  await expect(page.locator('.msg.me')).toHaveCount(0)

  queue.push(
    reply(turn({ say: 'Me too! Do you have a pet?', say_ko: '나도! 반려동물 있어?', hints: [{ en: 'I have a dog.', ko: '강아지 있어.' }] })),
  )
  await page.click('#micEn')
  await say(page, 'yes I like coffee')
  await expect(aiBubbles(page)).toHaveCount(2)
  // AI에게도 '대답 예시를 보고 말함'으로 알려서, 따라 말하기 실패가 아니라 내 대답으로 받게 한다
  expect(lastUserText(requests[1])).toBe('[영어 — 대답 예시를 보고 말함] yes I like coffee')
  // 칩 문장을 읽은 것: 머리줄 '내 대답'은 1 오르지만, 승급에 쓰는 '내 힘으로 한 영어'(enOwnTurns)는 오르지 않는다
  await expect(page.locator('#turnCount')).toHaveText('1/5 턴 완료')
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 1, repeatTurns: 1, enOwnTurns: 0, enOwnWords: 0 })
  // 보낸 뒤에는 고른 칩 표시가 지워진다
  await expect(page.locator('.chip.hint.picked')).toHaveCount(0)

  // 칩을 안 누르고 칩 문장을 그대로 말해도 따라 말하기로 센다
  queue.push(reply(turn({ say: 'Cute! What else?', say_ko: '귀엽다! 또?', hints: [{ en: 'I like dogs.', ko: '강아지 좋아해.' }] })))
  await page.click('#micEn')
  await say(page, 'I have a dog')
  await expect(aiBubbles(page)).toHaveCount(3)
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 2, repeatTurns: 2, enOwnTurns: 0 })

  // 칩과 다른 내 문장은 '내 힘으로 한 대답'으로 센다
  queue.push(reply(turn({ say: 'Nice!', say_ko: '좋다!' })))
  await page.click('#micEn')
  await say(page, 'I have a cat too')
  await expect(aiBubbles(page)).toHaveCount(4)
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 3, repeatTurns: 2, enOwnTurns: 1, enOwnWords: 5 })
  await expect(page.locator('#turnCount')).toHaveText('3/5 턴 완료')
  expect(errors).toEqual([])
})

test('힌트 칩: 따라 할 문장도 같이 있을 때(1단계에서 흔함) 칩을 골라 말하면 칩 문장으로 받아야 한다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  // 1단계: 따라 말하기는 '거의 매번', 질문이 있으면 힌트도 '항상' → 한 턴에 둘 다 온다
  queue.push(
    reply(
      turn({
        say: 'Oh, you are tired. What did you eat?',
        say_ko: '피곤하구나. 뭐 먹었어?',
        cue: '따라 해 볼까요?',
        repeat: "I'm tired today.",
        repeat_ko: '오늘 피곤해.',
        hints: [
          { en: 'I ate pizza.', ko: '피자 먹었어.' },
          { en: 'I ate rice.', ko: '밥 먹었어.' },
        ],
      }),
    ),
  )
  await page.click('#micKo')
  await say(page, '오늘 피곤해')
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect(guide(page)).toHaveText(`이제 내 차례! EN을 누르고 "I'm tired today." 따라 말해요`)

  // 칩을 고르면 안내가 칩 문장으로 바뀐다
  await page.locator('.chip.hint').first().click()
  await expect(guide(page)).toHaveText('EN을 누르고 "I ate pizza." 말해 보세요')

  // 안내대로 칩 문장을 말한다
  queue.push(reply(turn({ say: 'Yummy!', say_ko: '맛있겠다!' })))
  await page.click('#micEn')
  await say(page, 'I ate pizza')
  await expect(aiBubbles(page)).toHaveCount(3)
  // 칩을 읽은 것이니 내 힘으로 한 영어로는 세지 않는다
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 2, koTurns: 1, repeatTurns: 1, enOwnTurns: 0 })
  // 기대: AI에게 "I'm tired today."를 따라 하려다 틀린 것으로 전하면 안 된다 (안내는 칩 문장을 말하라고 했다)
  expect(lastUserText(requests[2])).not.toContain(`목표 문장: "I'm tired today."`)
  expect(errors).toEqual([])
})

test('힌트 칩: 지난 말풍선의 칩도 눌러서 들을 수 있고, 안내가 그 문장을 말하라고 한다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue, { say: 'Do you like music?', say_ko: '음악 좋아해?', hints: [{ en: 'I like K-pop.', ko: '케이팝 좋아해.' }] })
  queue.push(reply(turn({ say: 'Cool! Anything else?', say_ko: '멋지다! 또?' })))
  await typeSend(page, '응 좋아해')
  await expect(aiBubbles(page)).toHaveCount(2)
  await clearSpoken(page)

  await aiBubbles(page).first().locator('.chip.hint').click()
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(['I like K-pop.'])
  await expect(guide(page)).toHaveText('EN을 누르고 "I like K-pop." 말해 보세요')
  await expect(page.locator('#micEn')).toHaveClass(/recommend/)
  expect(requests).toHaveLength(2)
  // 그 칩 문장을 말하면 '대답 예시'로 보내고, 스스로 한 영어 대답으로는 세지 않는다
  queue.push(reply(turn({ say: 'Me too!', say_ko: '나도!' })))
  await page.click('#micEn')
  await say(page, 'I like K-pop')
  await expect(aiBubbles(page)).toHaveCount(3)
  expect(lastUserText(requests[2])).toBe('[영어 — 대답 예시를 보고 말함] I like K-pop')
  await expect(lastMe(page).locator('.tag')).toHaveText('대답 예시')
  await expect.poll(() => draftStats(page)).toMatchObject({ turns: 2, repeatTurns: 1, enOwnTurns: 0, enOwnWords: 0 })
  expect(errors).toEqual([])
})

test('내 대답 다섯 번이면 머리줄이 "단원 ✓"로 바뀌고 단원 조건을 채웠다고 알려 준다', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  for (let i = 1; i <= 5; i++) {
    queue.push(reply(turn({ say: `Reply ${i}.`, say_ko: `대답 ${i}.` })))
    if (i % 2) await typeSend(page, `answer ${i}`)
    else {
      await page.click('#micKo')
      await say(page, `대답 ${i}`)
    }
    await expect(aiBubbles(page)).toHaveCount(i + 1)
    if (i < 5) await expect(page.locator('#turnCount')).toHaveText(`${i}/5 턴 완료`)
  }
  await expect(page.locator('#turnCount')).toHaveText('단원 ✓')
  await expect(page.locator('#toast')).toHaveText('「인사와 자기소개」 단원 조건을 채웠어요! 더 이야기해도 좋아요.')
  expect(errors).toEqual([])
})

// ── 4) 마이크 듣는 중 ──

test('마이크: 듣는 중 표시와 중간 글자, 같은 버튼 다시 누르면 보내기, 아무 말 없으면 멈춤', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  await page.click('#micKo')
  expect(await lastRec(page)).toMatchObject({ lang: 'ko-KR', started: true, stopped: false })
  await expect(page.locator('#micKo')).toHaveClass(/listening/)
  await expect(page.locator('#micKo')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#micEn')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('#micKo .mic-label')).toHaveText('듣는 중… 누르면 보내기')
  await expect(guide(page)).toContainText('듣는 중… 말을 멈추면 자동으로 보내져요')
  await expect(page.locator('#btnMicCancel')).toBeVisible()

  // 중간 글자
  await say(page, '오늘은 바빴어', false)
  await expect(page.locator('#interim')).toHaveText('오늘은 바빴어')

  // 같은 버튼을 다시 누르면 지금까지 들은 말을 보낸다
  queue.push(reply(turn({ say: 'Busy day!', say_ko: '바쁜 날이었구나!' })))
  await page.click('#micKo')
  await expect(aiBubbles(page)).toHaveCount(2)
  expect(requests).toHaveLength(2)
  expect(lastUserText(requests[1])).toBe('[한국어] 오늘은 바빴어')
  await expect(lastMe(page)).toContainText('오늘은 바빴어')
  await expect(page.locator('#interim')).toHaveCount(0)
  await expect(page.locator('#micKo')).not.toHaveClass(/listening/)

  // 아무 말 없이 같은 버튼을 다시 누르면 멈추기만 하고 보내지 않는다
  await page.click('#micEn')
  await page.click('#micEn')
  expect(await lastRec(page)).toMatchObject({ lang: 'en-US', stopped: true })
  await expect(page.locator('#micEn')).not.toHaveClass(/listening/)
  await expect(guide(page)).toHaveText('소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.')
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})

test('마이크: ✕ 취소는 들은 말을 보내지 않고, 듣는 중 다른 언어 버튼을 누르면 그 언어로 다시 듣는다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  // 취소
  await page.click('#micEn')
  await say(page, 'hello there', false)
  await expect(page.locator('#interim')).toHaveText('hello there')
  await expect(page.locator('#interim')).toHaveAttribute('lang', 'en')
  await page.click('#btnMicCancel')
  expect(await lastRec(page)).toMatchObject({ lang: 'en-US', stopped: true })
  await expect(page.locator('#micEn')).not.toHaveClass(/listening/)
  await expect(page.locator('#interim')).toHaveCount(0)
  await expect(page.locator('#btnMicCancel')).toHaveCount(0)
  // 취소는 경고 없이 원래 안내로
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  await expect(guide(page)).not.toHaveClass(/warn/)
  expect(requests).toHaveLength(1)
  await expect(page.locator('.msg.me')).toHaveCount(0)

  // 한국어로 듣다가 EN을 누르면: 듣던 말은 버리고 영어로 새로 듣는다
  await page.click('#micKo')
  await say(page, '안녕', false)
  const before = await lastRec(page)
  expect(before).toMatchObject({ lang: 'ko-KR', stopped: false })
  await page.click('#micEn')
  const after = await lastRec(page)
  expect(after).toMatchObject({ lang: 'en-US', started: true, stopped: false, count: before!.count + 1 })
  await expect(page.locator('#micEn')).toHaveClass(/listening/)
  await expect(page.locator('#micKo')).not.toHaveClass(/listening/)
  await expect(page.locator('#interim')).toHaveCount(0)
  await expect(guide(page)).toContainText('듣는 중')
  expect(requests).toHaveLength(1)

  // 바뀐 언어로 말하면 영어로 보낸다
  queue.push(reply(turn({ say: 'Hello to you too!', say_ko: '너도 안녕!' })))
  await say(page, 'Hello')
  await expect(aiBubbles(page)).toHaveCount(2)
  expect(lastUserText(requests[1])).toBe('[영어] Hello')
  await expect(lastMe(page).locator('.tag')).toHaveText('영어')
  expect(errors).toEqual([])
})

// ── 5) 말하기와 듣기가 겹치지 않게, 아무 말 없을 때·막혔을 때 ──

test('소리를 내기 전에 듣기를 멈춘다: 듣는 중 "🔊 다시"를 누르거나 AI 답이 와서 말하기 시작할 때', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue, { say: 'What did you eat?', say_ko: '뭐 먹었어?' })

  // 듣는 중에 말풍선의 '🔊 다시'를 누르면: 듣기를 버리고(보내지 않음) 다시 들려준다
  await page.click('#micKo')
  await say(page, '음', false)
  await page.locator('.msg.ai').first().getByRole('button', { name: '다시 듣기', exact: true }).click()
  await expect.poll(() => lastRec(page)).toMatchObject({ lang: 'ko-KR', stopped: true })
  await expect(page.locator('#micKo')).not.toHaveClass(/listening/)
  const replay = (await speakLog(page)).filter((e) => e.text === 'What did you eat?')
  expect(replay).toHaveLength(2)
  expect(replay[1].recListening).toBe(false)
  expect(requests).toHaveLength(1)
  await expect(page.locator('.msg.me')).toHaveCount(0)

  // 듣는 중에 말하기를 시작해도(■ 그만이 보이는 동안 마이크를 누르면) 말을 끊고 듣는다
  await setSpeakDelay(page, 2000)
  await page.locator('.msg.ai').first().getByRole('button', { name: '다시 듣기', exact: true }).click()
  await expect(guide(page)).toContainText('말하는 중')
  const cancels = await cancelCount(page)
  await page.click('#micEn')
  expect(await cancelCount(page)).toBeGreaterThan(cancels)
  await expect(guide(page)).toContainText('듣는 중')
  await expect(page.locator('#btnStopSpeak')).toHaveCount(0)
  expect(await lastRec(page)).toMatchObject({ lang: 'en-US', started: true, stopped: false })
  await page.click('#btnMicCancel')
  await setSpeakDelay(page, 5)

  // AI 답이 와서 말하기 시작할 때: 그 전에 켜져 있던 마이크는 먼저 꺼진다
  await page.click('#micKo')
  queue.push(slow(reply(turn({ say: 'Sounds yummy!', say_ko: '맛있겠다!' })), 300))
  await typeSend(page, 'I ate pizza')
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect.poll(async () => (await speakLog(page)).some((e) => e.text === 'Sounds yummy!')).toBe(true)
  const answer = (await speakLog(page)).find((e) => e.text === 'Sounds yummy!')!
  expect(answer.recListening).toBe(false)
  expect(await lastRec(page)).toMatchObject({ lang: 'ko-KR', stopped: true })
  await expect(page.locator('#micKo')).not.toHaveClass(/listening/)
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})

test('듣는 중에 글로 보내면 마이크를 끈다: 생각 중에 "듣는 중" 표시가 남거나, 답 뒤에 "소리가 안 들렸어요"가 뜨면 안 된다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  await page.click('#micKo')
  await expect(page.locator('#micKo')).toHaveClass(/listening/)

  // 마이크를 켰다가 마음을 바꿔 키보드로 써서 보낸다
  queue.push(slow(reply(turn({ say: 'Cool!', say_ko: '좋아!' })), 3000))
  await typeSend(page, 'I will type instead')
  await expect(guide(page)).toHaveText('Emma가 생각 중이에요…')
  // 기대: 생각 중(버튼이 잠긴 동안)에 마이크가 '듣는 중… 누르면 보내기'로 남지 않는다 (답이 오기 전에 한 번만 읽는다)
  const during = await page.evaluate(() => ({
    cls: document.querySelector('#micKo')!.className,
    label: document.querySelector('#micKo .mic-label')!.textContent,
    busy: document.querySelector('#guide')!.textContent!.includes('생각 중'),
  }))
  expect(during.busy).toBe(true)
  expect.soft(during.cls).not.toMatch(/listening/)
  expect.soft(during.label).toBe('Emma 생각 중…')

  // 생각하는 동안 브라우저 인식이 '말 없음'으로 끝나도
  if (!(await lastRec(page))!.stopped) await silence(page)
  await expect(aiBubbles(page)).toHaveCount(2)
  // 답을 다 읽어 준 뒤의 화면을 본다
  await expect.poll(async () => (await speakLog(page)).find((e) => e.text === 'Cool!')?.endAt ?? 0).toBeGreaterThan(0)
  await expect(guide(page)).not.toContainText('말하는 중')
  // 기대: 글로 잘 주고받았는데 빨간 '소리가 안 들렸어요' 안내가 뜨지 않는다
  await expect(guide(page)).not.toHaveClass(/warn/)
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})

test('아무 말 없이 끝나면 안내가 남고(토스트처럼 사라지지 않음), 다시 누르면 지워진다', async ({ page, context }) => {
  await page.clock.install()
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  await page.click('#micKo')
  await silence(page)
  await expect(guide(page)).toHaveText('소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.')
  await expect(guide(page)).toHaveClass(/warn/)
  await page.clock.fastForward(10_000)
  await expect(guide(page)).toHaveText('소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.')
  expect(requests).toHaveLength(1)

  // 'no-speech' 오류도 같은 안내
  await page.click('#micEn')
  await expect(guide(page)).not.toHaveClass(/warn/)
  await silence(page, 'no-speech')
  await expect(guide(page)).toHaveText('소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.')

  // 마이크를 못 찾음
  await page.click('#micEn')
  await silence(page, 'audio-capture')
  await expect(guide(page)).toHaveText('마이크를 찾지 못했어요. 마이크(이어폰)가 연결돼 있는지 확인해 주세요.')

  // 다시 누르면 안내가 지워지고 듣기 안내로
  await page.click('#micKo')
  await expect(guide(page)).toContainText('듣는 중')
  await page.click('#btnMicCancel')
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  expect(requests).toHaveLength(1)
  expect(errors).toEqual([])
})

test("마이크 'not-allowed' 오류는 한국어로 고치는 법을 알려 주고, 권한이 풀리면 안내를 지운다", async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  await page.click('#micKo')
  await silence(page, 'not-allowed')
  await expect(guide(page)).toHaveClass(/warn/)
  await expect(guide(page)).toHaveText(
    '마이크가 막혀 있어요. 주소창 왼쪽 아이콘을 누르고 마이크를 "허용"으로 바꿔 주세요. 그동안은 아래 입력칸에 써도 돼요.',
  )
  await expect(page.locator('#micKo')).not.toHaveClass(/listening/)
  expect(requests).toHaveLength(1)

  // 그동안 입력칸으로는 대화를 이어 갈 수 있다
  queue.push(reply(turn({ say: 'Got it.', say_ko: '알겠어.' })))
  await typeSend(page, '마이크가 안 돼')
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect(guide(page)).not.toHaveClass(/warn/)

  // 다시 막힌 뒤(권한이 실제로 '차단'), 브라우저에서 권한을 허용하면 안내가 지워지고 알림이 뜬다
  await setMic(page, 'denied')
  await page.click('#micKo')
  await silence(page, 'not-allowed')
  await expect(guide(page)).toContainText('마이크가 막혀 있어요')
  await setMic(page, 'granted')
  await expect(page.locator('#toast')).toHaveText('이제 마이크가 돼요. 마이크 버튼을 눌러 말해 보세요.')
  await expect(guide(page)).not.toHaveClass(/warn/)
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  expect(errors).toEqual([])
})

// ── 6) 자동 듣기 ──

test('자동 듣기: AI 말이 끝나고 약 400ms 뒤 자동으로 듣기 시작 (따라 할 문장이 있으면 영어로)', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context, { autoListen: true })
  await startWithGreeting(page, queue)

  // 첫 인사 뒤: 한국어로 듣기 시작
  await expect.poll(() => lastRec(page)).toMatchObject({ lang: 'ko-KR', started: true, stopped: false })
  const log = await speakLog(page)
  const greetEnd = log.find((e) => e.text === "Hi! I'm Emma. How are you?")!.endAt
  const gap = (await recStartedAt(page)) - greetEnd
  expect(gap).toBeGreaterThanOrEqual(380)
  expect(gap).toBeLessThan(1500)
  await expect(guide(page)).toContainText('듣는 중')
  await expect(page.locator('#micKo')).toHaveClass(/listening/)

  // 자동으로 켠 마이크에 아무 말 없으면 짧게 '버튼을 눌러 말해요.'
  await silence(page)
  await expect(guide(page)).toHaveText('버튼을 눌러 말해요.')
  const count = await recCount(page)

  // 따라 할 문장이 오면 영어로 자동 듣기 → 말하면 그대로 따라 말하기로 보내진다
  queue.push(reply(turn({ say: 'Nice!', say_ko: '좋아!', cue: '따라 해 볼까요?', repeat: 'I like it.', repeat_ko: '좋아.' })))
  await page.click('#micKo')
  await say(page, '좋아')
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect.poll(() => recCount(page)).toBe(count + 2)
  expect(await lastRec(page)).toMatchObject({ lang: 'en-US', started: true, stopped: false })
  queue.push(reply(turn({ say: 'Great!', say_ko: '좋아!' })))
  await say(page, 'I like it')
  await expect(aiBubbles(page)).toHaveCount(3)
  expect(lastUserText(requests[2])).toBe('[따라 말하기 — 목표 문장: "I like it."] I like it')

  // 따라 할 문장이 없으면 마지막에 쓴 언어(영어)로 듣는다
  await expect.poll(() => recCount(page)).toBe(count + 3)
  expect(await lastRec(page)).toMatchObject({ lang: 'en-US', started: true, stopped: false })
  expect(errors).toEqual([])
})

test('자동 듣기: 힌트 칩을 들려준 뒤에도 영어로 자동 듣기', async ({ page, context }) => {
  const { queue, errors } = await open(page, context, { autoListen: true })
  await startWithGreeting(page, queue, { say: 'Coffee or tea?', say_ko: '커피 아니면 차?', hints: [{ en: 'Coffee, please.', ko: '커피요.' }] })
  await expect.poll(() => lastRec(page)).toMatchObject({ lang: 'ko-KR', started: true, stopped: false })
  // 칩을 누르면 듣던 것은 멈추고 들려준 뒤 영어로 다시 듣는다
  await page.locator('.chip.hint').first().click()
  await expect.poll(() => lastRec(page)).toMatchObject({ lang: 'en-US', started: true, stopped: false })
  const chipSpeak = (await speakLog(page)).find((e) => e.text === 'Coffee, please.')!
  expect(chipSpeak.recListening).toBe(false)
  await expect(guide(page)).toContainText('듣는 중')
  expect(errors).toEqual([])
})

test('자동 듣기: 말하는 동안 내 서재에서 설정 창을 열면 말이 끝나도 마이크를 켜지 않는다', async ({ page, context }) => {
  const { queue, errors } = await open(page, context, { autoListen: true })
  await setSpeakDelay(page, 1500)
  queue.push(reply(turn({ say: 'Hello! Long time no see.', say_ko: '안녕! 오랜만이야.' })))
  await page.click('#btnStart')
  await expect(guide(page)).toContainText('말하는 중')
  await page.click('#tab-library')
  await page.click('#btnStartSettings')
  await expect(page.locator('#settingsSheet')).toBeVisible()

  // 말이 끝나고 400ms를 넉넉히 넘길 때까지 기다린다
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const l = (window as unknown as { __speakLog: { text: string; endAt: number }[] }).__speakLog
          const e = l.find((x) => x.text === 'Hello! Long time no see.')
          return !!e && e.endAt > 0 && Date.now() - e.endAt > 1000
        }),
      { timeout: 6000 },
    )
    .toBe(true)
  expect(await recCount(page)).toBe(0)
  await expect(page.locator('#settingsSheet')).toBeVisible()
  expect(errors).toEqual([])
})

// ── 7) 글로 쓰기 ──

test('글로 쓰기: 영어/한국어를 구분해 표시를 붙이고, 빈 입력은 보내지 않으며, 생각 중에는 잠긴다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  // 영어 + 보내기 버튼 (앞뒤 공백은 지운다)
  queue.push(reply(turn({ say: 'Pizza is great!', say_ko: '피자 최고지!' })))
  await page.fill('#typeInput', '  I like pizza  ')
  await page.click('#typeSend')
  await expect(aiBubbles(page)).toHaveCount(2)
  expect(lastUserText(requests[1])).toBe('[영어] I like pizza')
  await expect(lastMe(page).locator('.tag')).toHaveText('영어')
  await expect(page.locator('#typeInput')).toHaveValue('')
  // 키보드로 보냈으면 답이 온 뒤 입력칸에 다시 포커스
  await expect(page.locator('#typeInput')).toBeFocused()

  // 한국어(영어가 섞여도 한글이 있으면 한국어) + Enter
  queue.push(reply(turn({ say: 'Yummy!', say_ko: '맛있겠다!', cue: '따라 해 볼까요?', repeat: 'I ate pizza.', repeat_ko: '피자 먹었어.' })))
  await typeSend(page, '나 pizza 먹었어')
  await expect(aiBubbles(page)).toHaveCount(3)
  expect(lastUserText(requests[2])).toBe('[한국어] 나 pizza 먹었어')
  await expect(lastMe(page).locator('.tag')).toHaveText('한국어')

  // 따라 할 문장이 있을 때 영어로 쓰면 따라 말하기 표시
  queue.push(reply(turn({ say: 'Good!', say_ko: '좋아!' })))
  await typeSend(page, 'I ate pizza.')
  await expect(aiBubbles(page)).toHaveCount(4)
  expect(lastUserText(requests[3])).toBe('[따라 말하기 — 목표 문장: "I ate pizza."] I ate pizza.')
  await expect(lastMe(page).locator('.tag')).toHaveText('따라 말하기')

  // 빈 입력·공백만은 보내지 않는다 (버튼, Enter 둘 다)
  await page.fill('#typeInput', '   ')
  await page.click('#typeSend')
  await page.press('#typeInput', 'Enter')
  await page.fill('#typeInput', '')
  await page.press('#typeInput', 'Enter')
  await expect(page.locator('.msg.me')).toHaveCount(3)
  expect(requests).toHaveLength(4)

  // 생각 중에는 입력칸이 읽기 전용, 보내기 버튼은 잠김
  queue.push(slow(reply(turn({ say: 'OK!', say_ko: '알았어!' })), 1000))
  await typeSend(page, 'one more')
  await expect(page.locator('#typeSend')).toBeDisabled()
  await expect(page.locator('#typeInput')).toHaveAttribute('readonly', '')
  await expect(aiBubbles(page)).toHaveCount(5)
  await expect(page.locator('#typeSend')).toBeEnabled()
  expect(requests).toHaveLength(5)
  expect(errors).toEqual([])
})

// ── 8) 오류 말풍선 ──

test('오류 404(모델 없음): "모델 이름 고치기" → 설정의 고급이 펼쳐지고 모델 칸에 포커스 → 고친 뒤 다시 시도', async ({ page, context }) => {
  const { queue, requests, keyChecks, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  queue.push(errorReply(404, 'models/gemini-3.5-flash-lite is not found for API version v1beta'))
  await typeSend(page, 'hello')

  const err = errorBubble(page)
  await expect(err).toContainText('"gemini-3.5-flash-lite" 모델을 찾을 수 없어요. 설정 → 고급에서 모델 이름을 바꿔 주세요.')
  await expect(err).toContainText('(원문: models/gemini-3.5-flash-lite is not found')
  await expect(err.locator('[role="alert"]')).toBeVisible()
  await expect(err.locator('.btn-retry')).toHaveText('다시 시도')
  await expect(guide(page)).not.toContainText('생각 중')

  await err.getByRole('button', { name: '모델 이름 고치기' }).click()
  await expect(page.locator('#settingsSheet')).toBeVisible()
  await expect(page.locator('details#advanced')).toHaveAttribute('open', '')
  const model = page.locator('#settingsSheet input[name="model"]')
  await expect(model).toBeFocused()
  await expect(model).toHaveValue('gemini-3.5-flash-lite')

  await model.fill('gemini-3.8-flash')
  await page.click('#btnSettingsSave')
  await expect(page.locator('#settingsSheet')).toHaveCount(0)
  expect(keyChecks.at(-1)!.url).toMatch(/\/models\/gemini-3\.8-flash$/)

  queue.push(reply(turn({ say: 'Hello again!', say_ko: '다시 안녕!' })))
  await err.locator('.btn-retry').click()
  await expect(aiBubbles(page)).toHaveCount(2)
  expect(requests).toHaveLength(3)
  expect(requests[2].url).toContain('/models/gemini-3.8-flash:generateContent')
  expect(requests[2].body.contents).toEqual(requests[1].body.contents)
  await expect(errorBubble(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

for (const c of [
  { status: 401, raw: 'Request had invalid authentication credentials.', text: 'API 키 권한 문제예요.' },
  { status: 400, raw: 'API key not valid. Please pass a valid API key.', text: 'API 키가 맞지 않아요.' },
]) {
  test(`오류 ${c.status}(키 문제): "키 다시 넣기" → 키 입력 칸 → 새 키로 다시 시도`, async ({ page, context }) => {
    const { queue, requests, keyChecks, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    queue.push(errorReply(c.status, c.raw))
    await typeSend(page, 'hello')

    const err = errorBubble(page)
    await expect(err).toContainText(c.text)
    await err.getByRole('button', { name: '키 다시 넣기' }).click()
    await expect(page.locator('#settingsSheet')).toBeVisible()
    const key = page.locator('#settingsSheet input[name="apiKey"]')
    await expect(key).toBeVisible()
    await expect(key).toBeFocused()

    await key.fill('AIzaNEWKEY')
    await page.click('#btnSettingsSave')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    expect(keyChecks.at(-1)!.headers['x-goog-api-key']).toBe('AIzaNEWKEY')

    queue.push(reply(turn({ say: 'Hi again!', say_ko: '다시 안녕!' })))
    await err.locator('.btn-retry').click()
    await expect(aiBubbles(page)).toHaveCount(2)
    expect(requests).toHaveLength(3)
    expect(requests[2].headers['x-goog-api-key']).toBe('AIzaNEWKEY')
    await expect(errorBubble(page)).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

for (const c of [
  { status: 429, text: '무료 사용량을 다 썼거나 너무 빨리 보냈어요. 1분쯤 뒤에 다시 해 보세요.' },
  { status: 503, text: 'AI 서버가 잠시 바빠요. 잠깐 뒤에 "다시 시도"를 눌러 주세요.' },
]) {
  test(`오류 ${c.status}: "다시 시도"로 같은 요청을 다시 보내고 정상 답이 오면 오류 말풍선이 사라진다`, async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    queue.push(errorReply(c.status, 'temporary problem'))
    await typeSend(page, 'I am hungry')

    const err = errorBubble(page)
    await expect(err).toContainText(c.text)
    await expect(err.locator('.btn-retry')).toHaveText('다시 시도')
    await expect(err.getByRole('button', { name: '설정 열기' })).toBeVisible()
    await expect(err.getByRole('button', { name: '키 다시 넣기' })).toHaveCount(0)
    await expect(err.getByRole('button', { name: '모델 이름 고치기' })).toHaveCount(0)

    queue.push(reply(turn({ say: "Let's eat!", say_ko: '먹자!' })))
    await err.locator('.btn-retry').click()
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(aiBubbles(page).last()).toContainText("Let's eat!")
    expect(requests).toHaveLength(3)
    expect(requests[2].body.contents).toEqual(requests[1].body.contents)
    expect(lastUserText(requests[2])).toBe('[영어] I am hungry')
    await expect(errorBubble(page)).toHaveCount(0)
    // 같은 말을 두 번 보낸 것으로 치지 않는다
    await expect(page.locator('.msg.me')).toHaveCount(1)
    await expect(page.locator('#turnCount')).toHaveText('1/5 턴 완료')
    expect(errors).toEqual([])
  })
}

test('첫 인사가 서버 오류(503)여도 "다시 시도"로 인사를 받는다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  queue.push(errorReply(503, 'overloaded'))
  await page.click('#btnStart')
  const err = errorBubble(page)
  await expect(err).toContainText('AI 서버가 잠시 바빠요')
  queue.push(reply(turn({ say: 'Hi there!', say_ko: '안녕!' })))
  await err.locator('.btn-retry').click()
  await expect(aiBubbles(page)).toHaveCount(1)
  expect(requests).toHaveLength(2)
  expect(requests[1].body.contents).toEqual(requests[0].body.contents)
  await expect(errorBubble(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('오류 말풍선은 다음 내 말을 보내면 치워지고, 두 말이 함께 AI에게 간다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  queue.push(errorReply(503, 'busy'))
  await typeSend(page, 'first try')
  await expect(errorBubble(page)).toHaveCount(1)

  queue.push(slow(reply(turn({ say: 'Got both!', say_ko: '둘 다 받았어!' })), 500))
  await typeSend(page, 'second try')
  // 보내는 순간 지난 오류 말풍선은 사라진다
  await expect(errorBubble(page)).toHaveCount(0)
  await expect(page.locator('.bubble.typing')).toBeVisible()
  await expect(aiBubbles(page)).toHaveCount(2)
  expect(lastUserText(requests[2])).toBe('[영어] first try\n[영어] second try')
  await expect(page.locator('.msg.me')).toHaveCount(2)
  expect(errors).toEqual([])
})

test('JSON이 아닌 답("Hello there!")도 말풍선으로 보이고 읽어 준다', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  await startWithGreeting(page, queue)
  await clearSpoken(page)
  queue.push(reply('Hello there!'))
  await typeSend(page, 'hi')
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect(aiBubbles(page).last().locator('.say')).toHaveText('Hello there!')
  await expect(errorBubble(page)).toHaveCount(0)
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(['Hello there!'])
  await expect(guide(page)).toHaveText(FIRST_TIME_GUIDE)
  expect(errors).toEqual([])
})

// ── 9) 느린 응답 ──

test('느린 응답: 8초가 지나면 "그만 기다리기" → 누르면 중단 안내, 다시 시도로 이어 간다', async ({ page, context }) => {
  await page.clock.install()
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  queue.push(slow(reply(turn({ say: 'Sorry, I was slow.', say_ko: '늦어서 미안.' })), 9000))
  await typeSend(page, 'hello?')
  await expect(page.locator('.bubble.typing')).toBeVisible()

  // 5초: 아직 안 보임
  await page.clock.fastForward(5000)
  await expect(page.locator('#timer')).toBeVisible()
  await expect(page.locator('#btnCancelWait')).toHaveCount(0)
  // 8초가 넘으면 보인다
  await page.clock.fastForward(3100)
  await expect(page.locator('#btnCancelWait')).toBeVisible()
  await expect(page.locator('.bubble.typing')).toContainText('조금 오래 걸려요…')

  await page.click('#btnCancelWait')
  const err = errorBubble(page)
  await expect(err).toContainText('기다리기를 그만뒀어요. 다시 말하거나 "다시 시도"를 눌러 주세요.')
  await expect(page.locator('.bubble.typing')).toHaveCount(0)
  await expect(page.locator('#btnCancelWait')).toHaveCount(0)
  await expect(page.locator('#micKo')).toBeEnabled()
  await expect(page.locator('#typeSend')).toBeEnabled()
  await expect(guide(page)).not.toContainText('생각 중')

  queue.push(reply(turn({ say: 'Here I am!', say_ko: '나 여기 있어!' })))
  await err.locator('.btn-retry').click()
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect(aiBubbles(page).last()).toContainText('Here I am!')
  expect(requests).toHaveLength(3)
  expect(requests[2].body.contents).toEqual(requests[1].body.contents)
  await expect(errorBubble(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('느린 응답: 20초 안에 답이 없으면 시간 초과 안내, 새로 말해도 이어 간다', async ({ page, context }) => {
  await page.clock.install()
  const { queue, requests, errors } = await open(page, context)
  await startWithGreeting(page, queue)

  queue.push(slow(reply(turn({ say: 'Too late.', say_ko: '너무 늦었어.' })), 4000))
  await typeSend(page, 'are you there')
  await expect(page.locator('.bubble.typing')).toBeVisible()
  await page.clock.fastForward(19_000)
  await expect(page.locator('#btnCancelWait')).toBeVisible()
  await expect(errorBubble(page)).toHaveCount(0)
  await page.clock.fastForward(1500)
  const err = errorBubble(page)
  await expect(err).toContainText('응답이 너무 늦어요. 인터넷을 확인하고 "다시 시도"를 눌러 주세요.')
  await expect(err.locator('.btn-retry')).toBeVisible()
  await expect(page.locator('.bubble.typing')).toHaveCount(0)

  // 다시 시도 대신 새로 말해도 된다
  queue.push(reply(turn({ say: 'Yes, I am here!', say_ko: '응, 여기 있어!' })))
  await typeSend(page, 'hello again')
  await expect(errorBubble(page)).toHaveCount(0)
  await expect(aiBubbles(page)).toHaveCount(2)
  await expect(aiBubbles(page).last()).toContainText('Yes, I am here!')
  expect(requests).toHaveLength(3)
  expect(lastUserText(requests[2])).toBe('[영어] are you there\n[영어] hello again')
  expect(errors).toEqual([])
})

// ── 10) 폰 화면 ──

// 어떤 요소도 화면(390px) 밖으로 나가지 않고, 대화 칸·말하기 칸 안에서도 가로 스크롤이 생기지 않는지
const innerOverflow = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = []
    const vw = document.documentElement.clientWidth
    for (const sel of ['#chat', '#composer', 'header']) {
      const el = document.querySelector(sel) as HTMLElement | null
      if (el && el.scrollWidth > el.clientWidth + 1) out.push(`${sel} scroll ${el.scrollWidth}>${el.clientWidth}`)
    }
    document.querySelectorAll<HTMLElement>('.bubble, .chip, .mic, #guide, #interim, .typebar *').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) out.push(`${el.className || el.id} ${Math.round(r.left)}..${Math.round(r.right)}`)
    })
    return out
  })

test('390px: 긴 말풍선·힌트·오류·중간 글자가 있어도 가로로 넘치지 않는다', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  await startWithGreeting(page, queue, {
    say: 'Wow, that sounds like an absolutely extraordinary weekend adventure with your whole family!',
    say_ko: '와, 가족 모두와 함께한 정말 대단한 주말 모험이었던 것 같아!',
    cue: '이렇게 말해 보세요',
    repeat: 'I went to the countryside with my family and we had a wonderful barbecue.',
    repeat_ko: '가족이랑 시골에 가서 멋진 바비큐를 했어.',
    hints: [
      { en: 'It was unbelievably exhausting but really memorable.', ko: '믿을 수 없을 만큼 피곤했지만 정말 기억에 남아.' },
      { en: 'Internationalization-related-responsibilities.', ko: '아주 긴 단어 하나' },
    ],
    words: [
      { en: 'extraordinary', ko: '대단한' },
      { en: 'countryside', ko: '시골' },
      { en: 'unbelievably', ko: '믿을 수 없을 만큼' },
    ],
    tip: '긴 문장은 🐢 천천히 버튼으로 다시 들어 보세요. Supercalifragilisticexpialidocious-is-a-very-long-word.',
  })
  queue.push(
    errorReply(
      429,
      'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20. https://ai.google.dev/gemini-api/docs/rate-limits',
    ),
  )
  await typeSend(page, 'Pneumonoultramicroscopicsilicovolcanoconiosis-and-more-without-any-spaces-at-all')
  await expect(errorBubble(page)).toBeVisible()
  await page.click('#micEn')
  await say(page, 'antidisestablishmentarianism-floccinaucinihilipilification-supercalifragilistic', false)
  await expect(page.locator('#interim')).toBeVisible()

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  expect(await innerOverflow(page)).toEqual([])
  expect(errors).toEqual([])
})

test.describe('터치 폰', () => {
  test.use({ hasTouch: true })

  test('키보드로 입력하는 동안: 마이크 줄은 숨고 입력칸·보내기는 화면 안에 보인다 (키보드로 화면이 줄어도)', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    for (let i = 0; i < 3; i++) {
      queue.push(reply(turn({ say: `Answer number ${i + 1}. Tell me more!`, say_ko: `${i + 1}번째 대답. 더 말해 줘!` })))
      await typeSend(page, `message ${i + 1}`)
      await expect(aiBubbles(page)).toHaveCount(i + 2)
    }

    await page.locator('#typeInput').tap()
    // 화면 키보드가 올라온 것처럼 화면 높이를 줄인다 (interactive-widget=resizes-content)
    await page.setViewportSize({ width: 390, height: 420 })
    await expect(page.locator('#composer')).toHaveClass(/typing/)
    await expect(page.locator('#composer .mics')).toBeHidden()
    await expect(guide(page)).toBeHidden()
    await expect(page.locator('#typeInput')).toBeInViewport({ ratio: 1 })
    await expect(page.locator('#typeSend')).toBeInViewport({ ratio: 1 })
    await expect(page.locator('header')).toBeInViewport()
    // 맨 아래를 보고 있었으면 마지막 말풍선이 계속 보인다
    await expect(aiBubbles(page).last()).toBeInViewport()
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

    // 입력하고 보내기를 톡 누르면 보내진다
    queue.push(reply(turn({ say: 'Thanks for typing!', say_ko: '써 줘서 고마워!' })))
    await page.fill('#typeInput', 'typed on phone')
    await page.locator('#typeSend').tap()
    await expect(aiBubbles(page)).toHaveCount(5)
    expect(lastUserText(requests[4])).toBe('[영어] typed on phone')

    // 입력칸을 벗어나면 마이크 줄이 돌아온다
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#chat').tap({ position: { x: 10, y: 10 } })
    await expect(page.locator('#composer')).not.toHaveClass(/typing/)
    await expect(page.locator('#composer .mics')).toBeVisible()
    await expect(guide(page)).toBeVisible()
    expect(errors).toEqual([])
  })
})

