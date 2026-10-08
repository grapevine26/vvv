import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  aiBubbles,
  collectErrors,
  errorReply,
  installMocks,
  lastRec,
  lastUserText,
  reply,
  say,
  silence,
  startWithGreeting,
  storageGet,
  systemText,
  turn,
  type MockOptions,
  type MockReply,
  type MockWindow,
} from './helpers'

// 검토에서 나온 문제들을 고친 뒤, 다시 생기지 않게 지키는 테스트.
// 날짜가 걸린 것이 있어서 한국 시간 2026-10-08 오전 10시에서 시작하는 가짜 시계로 돈다 (시계는 저절로 흐른다).
test.use({ timezoneId: 'Asia/Seoul' })
const NOW = new Date('2026-10-08T10:00:00+09:00')
const TODAY = '2026-10-08'
const K = {
  settings: 'englishFriend.settings',
  learned: 'englishFriend.learned',
  progress: 'englishFriend.progress',
  draft: 'englishFriend.draft.',
}
const KAKAO_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 KAKAOTALK 10.4.5'

interface OpenOptions extends MockOptions {
  settings?: Record<string, unknown> | null
  // 이 탭의 번호를 정해 둔다 (임시 저장 키를 맞추려고)
  tabId?: string
}

async function open(page: Page, context: BrowserContext, opts: OpenOptions = {}) {
  await context.clock.install({ time: NOW })
  if (opts.tabId)
    await context.addInitScript((id) => {
      try {
        if (!sessionStorage.getItem('englishFriend.tabId')) sessionStorage.setItem('englishFriend.tabId', id)
      } catch {
        // about:blank 등
      }
    }, opts.tabId)
  const storage = { ...(opts.settings === null ? {} : { [K.settings]: { apiKey: 'K', ...opts.settings } }), ...opts.storage }
  const mocks = await installMocks(context, { mic: opts.mic, storage })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  return { ...mocks, errors }
}

const guide = (page: Page) => page.locator('#guide')
const progressIn = (page: Page) => storageGet(page, K.progress)

async function typeSend(page: Page, text: string) {
  await page.fill('#typeInput', text)
  await page.click('#typeSend')
}

// 내 말 하나(입력칸) 보내고 AI 답 하나 받기
async function exchange(page: Page, queue: MockReply[], said: string, ai: Record<string, unknown> = { say: 'OK!', say_ko: '응!' }) {
  const before = await aiBubbles(page).count()
  queue.push(reply(turn(ai)))
  await typeSend(page, said)
  await expect(aiBubbles(page)).toHaveCount(before + 1)
}

// 마이크로 한 말 (버튼을 누르고 인식기가 켜지면 말한다)
async function speak(page: Page, lang: 'ko' | 'en', text: string) {
  const before = (await lastRec(page))?.count ?? 0
  await page.click(lang === 'en' ? '#micEn' : '#micKo')
  await expect.poll(async () => (await lastRec(page))?.count ?? 0).toBe(before + 1)
  await say(page, text)
}

const greetTurn = (o: Record<string, unknown> = {}) => turn({ say: 'Hi! How are you?', say_ko: '안녕! 잘 지내?', ...o })
const history = (...texts: [string, string][]) => texts.map(([role, text]) => ({ role, parts: [{ text }] }))
const aiMsg = (id: number, o: Record<string, unknown> = {}) => ({ kind: 'ai', id, turn: greetTurn(o), veiled: false })

// ─────────────────────────────────────────────
test.describe('첫 실행', () => {
  test('키 확인이 모델 문제(404)면 키 시트 안에 모델 칸이 나오고, 고쳐서 저장하면 바로 시작한다', async ({ page, context }) => {
    const { keyCheck, queue, requests, errors } = await open(page, context, { settings: null })
    keyCheck.status = 404
    keyCheck.payload = { error: { message: 'models/gemini-3.5-flash-lite is not found' } }
    await page.click('#btnStart')
    await page.fill('input[name=apiKey]', 'AIzaGOOD')
    await page.click('#btnSettingsSave')
    const check = page.locator('#keyCheck')
    await expect(check).toContainText('"gemini-3.5-flash-lite" 모델을 찾을 수 없어요')
    // 예시에 방금 안 된 모델 이름을 다시 넣지 않는다
    await expect(check).not.toContainText('예: gemini-3.5-flash-lite')
    const model = page.locator('#settingsSheet input[name=model]')
    await expect(model).toBeVisible()

    keyCheck.status = 200
    keyCheck.payload = { name: 'models/x' }
    await model.fill('gemini-flash-latest')
    queue.push(reply(greetTurn()))
    await page.click('#btnSettingsSave')
    await expect(aiBubbles(page)).toHaveCount(1)
    expect(requests[0].url).toContain('/models/gemini-flash-latest:generateContent')
    expect(errors).toEqual([])
  })

  test('키 확인을 기다리는 중에 "나중에"로 닫으면, 확인이 끝나도 저장하거나 대화를 시작하지 않는다', async ({ page, context }) => {
    const { keyCheck, requests, errors } = await open(page, context, { settings: null })
    keyCheck.delayMs = 1500
    page.on('dialog', (d) => void d.accept())
    await page.click('#btnStart')
    await page.fill('input[name=apiKey]', 'AIzaSLOW')
    await page.click('#btnSettingsSave')
    await expect(page.locator('#keyCheck')).toHaveText('키 확인 중…')
    await page.click('#btnSettingsCancel')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    // 확인 응답이 올 시간이 지나도 그대로
    await page.waitForTimeout(2200)
    await expect(page.locator('#composer')).toHaveCount(0)
    expect(requests).toHaveLength(0)
    expect((await storageGet(page, K.settings))?.apiKey ?? '').toBe('')
    expect(errors).toEqual([])
  })

  test('설정 시트에서 휴대폰 뒤로: 바꾼 게 있으면 ✕처럼 먼저 묻고, 취소하면 그대로, 확인하면 닫힌다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await page.click('#btnStartSettings')
    await page.fill('input[name=likes]', '커피')
    const asked: string[] = []
    let accept = false
    page.on('dialog', (d) => {
      asked.push(d.message())
      void (accept ? d.accept() : d.dismiss())
    })
    await page.goBack()
    await expect.poll(() => asked.length).toBe(1)
    expect(asked[0]).toBe('바꾼 내용을 저장하지 않고 닫을까요?')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await expect(page.locator('input[name=likes]')).toHaveValue('커피')
    // 취소한 뒤에도 뒤로 가기를 다시 받는다 (앱을 나가지 않음)
    accept = true
    await page.goBack()
    await expect.poll(() => asked.length).toBe(2)
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('#startSheet')).toBeVisible()
    expect((await storageGet(page, K.settings))?.likes ?? '').toBe('')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('뒤로 가기·마무리', () => {
  test('버튼으로 저장하고 끝내면 뒤로 가기용 칸을 거둬서, 시작 화면에서 뒤로 한 번이면 앱을 나간다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    const length = await page.evaluate(() => history.length)
    await startWithGreeting(page, queue)
    await exchange(page, queue, 'hello')
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (history.state as { efGuard?: boolean } | null)?.efGuard ?? false)).toBe(false)
    expect(await page.evaluate(() => history.length)).toBe(length + 1)
    expect(errors).toEqual([])
    await page.goBack()
    await expect(page).toHaveURL('about:blank')
  })

  test('시간 전에 마무리 창을 열었다가 돌아가도, 시간이 되면 배너가 뜬다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, { settings: { minutes: 5 } })
    await startWithGreeting(page, queue)
    await page.click('#btnEnd')
    await page.click('#btnBackToChat')
    await expect(page.locator('#wrapSheet')).toHaveCount(0)
    await page.clock.fastForward('05:05')
    await expect(page.locator('#timeBanner')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('마무리 카드에서 🎤로 듣는 중에 "대화로 돌아가기"를 누르면 마이크를 끈다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue, { say: 'Say it!', say_ko: '말해 봐!', repeat: "I'm fine.", repeat_ko: '난 괜찮아.' })
    await page.click('#btnEnd')
    await page.click('#wrapSheet .btn-read')
    await expect.poll(async () => (await lastRec(page))?.started).toBe(true)
    await page.click('#btnBackToChat')
    await expect.poll(async () => (await lastRec(page))?.stopped).toBe(true)
    await expect(guide(page)).not.toContainText('듣는 중')
    expect(requests).toHaveLength(1)
    expect(errors).toEqual([])
  })

  test('한 마디도 안 하고 끝내면, 마무리와 결과에서 기록할 게 없다고 알려 준다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await page.click('#btnEnd')
    await expect(page.locator('#wrapBody')).toContainText('아직 한 번도 대답하지 않았어요')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toContainText('한 번도 대답하지 않아서 기록할 게 없어요')
    expect(errors).toEqual([])
  })

  test('다른 앱에 10분 가 있던 시간은 공부 시간에서 뺀다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await exchange(page, queue, 'hello')
    const setVisible = (v: 'hidden' | 'visible') =>
      page.evaluate((state) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
        document.dispatchEvent(new Event('visibilitychange'))
      }, v)
    await setVisible('hidden')
    await page.clock.fastForward('10:00')
    // 숨겨진 동안 쓴 임시 저장에도 자리 비운 시간이 들어가지 않는다 (이 탭이 그대로 버려져도 부풀지 않게)
    await expect.poll(async () => (await storageGet(page, K.draft + (await page.evaluate(() => sessionStorage.getItem('englishFriend.tabId'))))).activeMs).toBeLessThan(120_000)
    await setVisible('visible')
    await page.clock.fastForward('01:00')
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    const p = await progressIn(page)
    expect(p.sessions[0].minutes).toBeLessThanOrEqual(2)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('대화에서 한 말 세기', () => {
  test('따라 할 문장이 있어도 거의 안 겹치는 영어 대답은 "내 대답"으로 보낸다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue, {
      say: 'What do you eat for lunch?',
      say_ko: '점심에 뭐 먹어?',
      repeat: 'I like K-pop.',
      repeat_ko: '케이팝 좋아.',
    })
    queue.push(reply(turn({ say: 'Yum!', say_ko: '맛있겠다!' })))
    await speak(page, 'en', 'I usually eat kimchi fried rice for lunch')
    await expect(aiBubbles(page)).toHaveCount(2)
    expect(lastUserText(requests[1])).toBe('[영어] I usually eat kimchi fried rice for lunch')
    await expect(page.locator('.msg.me .tag').last()).toHaveText('영어')
    expect(errors).toEqual([])
  })

  test('대답 예시를 그대로 읽으면 "대답 예시", 예시보다 길게 늘려 말하면 "내 대답"', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    const hints = [{ en: "I'm tired.", ko: '피곤해.' }]
    await startWithGreeting(page, queue, { say: 'How are you?', say_ko: '어때?', hints })
    queue.push(reply(turn({ say: 'Oh no.', say_ko: '저런.', hints })))
    await speak(page, 'en', "I'm tired")
    await expect(aiBubbles(page)).toHaveCount(2)
    expect(lastUserText(requests[1])).toBe("[영어 — 대답 예시를 보고 말함] I'm tired")
    await expect(page.locator('.msg.me .tag').last()).toHaveText('대답 예시')
    queue.push(reply(turn({ say: 'I see.', say_ko: '그렇구나.' })))
    await speak(page, 'en', "I'm tired because I worked a lot today")
    await expect(aiBubbles(page)).toHaveCount(3)
    expect(lastUserText(requests[2])).toBe("[영어] I'm tired because I worked a lot today")
    expect(errors).toEqual([])
  })

  test('오류가 나면 안내 줄이 "다시 시도"를 알려 주고, 그사이 다시 말해도 한 번만 센다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    queue.push(errorReply(503, 'overloaded'))
    await typeSend(page, 'first')
    await expect(page.locator('.msg.error')).toHaveCount(1)
    await expect(guide(page)).toContainText('연결이 안 됐어요')
    await expect(guide(page)).toHaveClass(/warn/)
    await expect(page.locator('#turnCount')).toHaveText('1/5번')
    queue.push(reply(turn({ say: 'Got both!', say_ko: '둘 다 받았어!' })))
    await typeSend(page, 'second')
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(page.locator('#turnCount')).toHaveText('1/5번')
    expect(lastUserText(requests[2])).toBe('[영어] first\n[영어] second')
    expect(errors).toEqual([])
  })

  test('오류 뒤 지난 말풍선의 대답 예시를 골랐다가 다시 시도해서 새 질문이 오면, 지난 예시 안내는 사라진다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue, { say: 'What do you do?', say_ko: '무슨 일 해?', hints: [{ en: 'I am a teacher.', ko: '선생님이야.' }] })
    queue.push(errorReply(503, 'overloaded'))
    await typeSend(page, 'hmm')
    await expect(page.locator('.msg.error')).toHaveCount(1)
    await page.click('.chip.hint')
    await expect(guide(page)).toContainText('I am a teacher.')
    queue.push(reply(turn({ say: 'Where do you live?', say_ko: '어디 살아?' })))
    await page.click('.btn-retry')
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect(guide(page)).not.toContainText('I am a teacher.')
    expect(errors).toEqual([])
  })

  test('첫 인사가 실패한 채 여러 번 말해도 답을 받기 전까지는 한 번만 센다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    queue.push(errorReply(503, 'overloaded'))
    await page.click('#btnStart')
    await expect(page.locator('.msg.error')).toHaveCount(1)
    for (const t of ['hello', 'hello?', 'are you there?']) {
      queue.push(errorReply(503, 'overloaded'))
      await typeSend(page, t)
      await expect(page.locator('#typeSend')).toBeEnabled()
    }
    await expect(page.locator('#turnCount')).toHaveText('1/5번')
    queue.push(reply(greetTurn()))
    await typeSend(page, 'hi')
    await expect(aiBubbles(page)).toHaveCount(1)
    await expect(page.locator('#turnCount')).toHaveText('1/5번')
    expect(lastUserText(requests[requests.length - 1]).split('\n')).toHaveLength(5)
    expect(errors).toEqual([])
  })

  test('대답 예시를 눌러 들은 뒤 길게 늘려 말하면 "내 대답"으로 센다', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue, { say: 'What food do you like?', say_ko: '무슨 음식 좋아해?', hints: [{ en: 'I like pizza.', ko: '피자 좋아.' }] })
    await page.click('.chip.hint')
    queue.push(reply(turn({ say: 'Sounds fun!', say_ko: '재밌겠다!' })))
    await speak(page, 'en', 'I like pizza with my family every weekend at home')
    await expect(aiBubbles(page)).toHaveCount(2)
    expect(lastUserText(requests[1])).toBe('[영어] I like pizza with my family every weekend at home')
    await expect(page.locator('.msg.me .tag').last()).toHaveText('영어')
    expect(errors).toEqual([])
  })

  test('키·모델 오류면 안내 줄이 "다시 시도" 대신 말풍선의 고치기 버튼을 가리킨다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    queue.push(errorReply(404, 'models/x is not found'))
    await typeSend(page, 'hello')
    await expect(guide(page)).toHaveText('모델 이름 문제예요. 위 말풍선의 "모델 이름 고치기"를 눌러 주세요.')
    queue.push(errorReply(403, 'API key was reported as leaked'))
    await page.click('.btn-retry')
    await expect(guide(page)).toHaveText('키 문제예요. 위 말풍선의 "키 다시 넣기"를 눌러 주세요.')
    expect(errors).toEqual([])
  })

  test('자동 듣기로만 대화해도 단원 조건 알림에 지금 단원 이름이 나온다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, {
      settings: { autoListen: true },
      storage: { [K.progress]: { stage: 1, unit: 's1-3', doneUnits: [], sessions: [] } },
    })
    await startWithGreeting(page, queue, { say: 'Do you like pizza?', say_ko: '피자 좋아해?' })
    for (let i = 0; i < 5; i++) {
      await expect.poll(async () => (await lastRec(page))?.count ?? 0).toBe(i + 1)
      await expect.poll(async () => (await lastRec(page))?.stopped).toBe(false)
      queue.push(reply(turn({ say: `Nice ${i}!`, say_ko: '좋아!' })))
      await say(page, '응 좋아해')
      await expect(aiBubbles(page)).toHaveCount(i + 2)
      if (i === 4) await expect(page.locator('#toast')).toHaveText('「좋아하는 음식」 단원 조건을 채웠어요! 더 이야기해도 좋아요.')
    }
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('임시 저장·여러 탭', () => {
  const draft = (tabId: string, ago: number, o: Record<string, unknown> = {}) => ({
    tabId,
    savedAt: NOW.getTime() - ago,
    date: TODAY,
    activeMs: 120_000,
    limitSec: 900,
    stage: 1,
    unit: 's1-1',
    stats: { turns: 2, koTurns: 2, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 },
    repeats: [],
    messages: [aiMsg(1), { kind: 'me', id: 2, text: '안녕', lang: 'ko', isRepeat: false }, aiMsg(3, { say: 'Nice!' })],
    history: history(['user', '[대화 시작]'], ['model', '{"say":"Hi!"}'], ['user', '[한국어] 안녕'], ['model', '{"say":"Nice!"}']),
    pendingRepeat: '',
    ...o,
  })

  test('다른 탭의 대화를 "이어서 하기"로 가져오면, 이 탭에 남아 있던 대화는 덮어쓰기 전에 먼저 저장한다', async ({ page, context }) => {
    const mine = draft('MINE', 120_000, {
      stats: { turns: 3, koTurns: 3, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 },
      repeats: [{ en: 'I like tea.', ko: '차 좋아.' }],
    })
    const other = draft('OTHER', 60_000, { repeats: [{ en: 'I like coffee.', ko: '커피 좋아.' }] })
    const { errors } = await open(page, context, {
      tabId: 'MINE',
      storage: { [K.draft + 'MINE']: mine, [K.draft + 'OTHER']: other },
    })
    await expect(page.locator('#draftCard')).toContainText('2번 주고받음')
    await page.click('#btnDraftResume')
    await expect(aiBubbles(page)).toHaveCount(2)
    const p = await progressIn(page)
    expect(p.sessions.map((s: { turns: number }) => s.turns)).toEqual([3])
    expect((await storageGet(page, K.learned)).map((x: { en: string }) => x.en)).toContain('I like tea.')
    expect(await storageGet(page, K.draft + 'OTHER')).toBeNull()
    expect(errors).toEqual([])
  })

  test('남은 대화가 단원을 마쳐도, 그사이 골라 둔 단원은 바뀌지 않는다', async ({ page, context }) => {
    const other = draft('OTHER', 60_000, {
      unit: 's1-3',
      stats: { turns: 6, koTurns: 6, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 },
    })
    const { queue, requests, errors } = await open(page, context, {
      storage: { [K.draft + 'OTHER']: other, [K.progress]: { stage: 1, unit: 's1-7', doneUnits: [], sessions: [] } },
    })
    await expect(page.locator('#courseCard')).toContainText('날씨와 계절')
    await startWithGreeting(page, queue)
    const p = await progressIn(page)
    expect(p.doneUnits).toEqual(['s1-3'])
    expect(p.unit).toBe('s1-7')
    expect(systemText(requests[0])).toContain('[오늘 단원] 날씨와 계절')
    expect(errors).toEqual([])
  })

  test('다른 탭이 이 대화를 저장한 걸 아직 모르는 채 "저장하고 끝내기"를 눌러도 두 번 기록하지 않는다', async ({ page, context }) => {
    // A 탭이 storage 알림을 못 받은 상황 (얼어 있다 깨어난 탭 등)
    await context.addInitScript(() => {
      window.addEventListener(
        'storage',
        (e) => {
          if ((window as unknown as { __mute?: boolean }).__mute) e.stopImmediatePropagation()
        },
        true,
      )
    })
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await exchange(page, queue, '안녕')
    // A가 뒤로 가서 임시 저장이 갱신되지 않음
    await page.evaluate(() => {
      const w = window as unknown as { __mute: boolean }
      w.__mute = true
      const setItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k.startsWith('englishFriend.draft.')) return
        return setItem.call(this, k, v)
      }
    })
    const b = await context.newPage()
    await b.goto('/')
    await b.clock.fastForward('00:31')
    await expect(b.locator('#draftCard')).toBeVisible()
    // B에서 '저장하고 닫기' → A의 대화(1번)가 기록되고 A의 임시 저장이 지워진다
    await b.click('#btnDraftSave')
    await expect(b.locator('#startMsg')).toContainText('대화 한 번에 5번')
    // A로 돌아와 (알림을 못 받은 채) 바로 저장하고 끝내기
    await page.bringToFront()
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toContainText('다른 탭에서 이어받았거나 저장했어요')
    expect(((await progressIn(page))?.sessions ?? []).map((x: { turns: number }) => x.turns)).toEqual([1])
    expect(errors).toEqual([])
  })

  test('이어서 하기: 끊기기 전 오류 말풍선은 되살리지 않고, 보이는 대답 예시를 읽으면 대답 예시로 센다', async ({ page, context }) => {
    const hints = [{ en: 'I like pizza.', ko: '피자 좋아.' }]
    const mine = draft('MINE', 5_000, {
      messages: [aiMsg(1, { say: 'What food do you like?', hints }), { kind: 'error', id: 2, text: '잠시 바빠요', fix: null }],
      history: history(['user', '[대화 시작]'], ['model', JSON.stringify(greetTurn({ say: 'What food do you like?', hints }))]),
      stats: { turns: 1, koTurns: 1, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 },
    })
    const { queue, errors } = await open(page, context, { tabId: 'MINE', storage: { [K.draft + 'MINE']: mine } })
    await page.click('#btnDraftResume')
    await expect(aiBubbles(page)).toHaveCount(1)
    await expect(page.locator('.msg.error')).toHaveCount(0)
    queue.push(reply(turn({ say: 'Me too!', say_ko: '나도!' })))
    await speak(page, 'en', 'I like pizza')
    await expect(aiBubbles(page)).toHaveCount(2)
    await expect.poll(async () => (await storageGet(page, K.draft + 'MINE'))?.stats).toMatchObject({ turns: 2, repeatTurns: 1, enOwnTurns: 0 })
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('마이크·소리', () => {
  test('마이크 켜기 실패: 마이크가 없으면 그렇게 알려 주고, 다시 누를 수 있게 버튼을 남긴다', async ({ page, context }) => {
    const { errors } = await open(page, context, { mic: { state: 'prompt', allow: 'NotFoundError' } })
    await page.click('#btnMicAllow')
    await expect(page.locator('#toast')).toContainText('마이크를 찾지 못했어요')
    await expect(page.locator('#btnMicAllow')).toBeVisible()
    await expect(page.locator('#micStatus')).not.toContainText('막혀')
    expect(errors).toEqual([])
  })

  test('마이크 켜기 실패: 권한 창을 닫기만 했으면(아직 "묻기") 다시 누르라고 하고 버튼을 남긴다', async ({ page, context }) => {
    const { errors } = await open(page, context, { mic: { state: 'prompt', allow: 'NotAllowedError' } })
    await page.click('#btnMicAllow')
    await expect(page.locator('#toast')).toContainText('권한 창이 닫혔어요')
    await expect(page.locator('#btnMicAllow')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('인식기가 not-allowed를 줘도 실제 권한이 허용이면, 시작 화면에 "막혀 있어요"를 남기지 않는다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await page.click('#micKo')
    await silence(page, 'not-allowed')
    await expect(guide(page)).toHaveClass(/warn/)
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#micStatus')).toContainText('마이크 준비됨')
    expect(errors).toEqual([])
  })

  test('말은 했는데 못 알아들었으면(nomatch) 천천히 말하거나 한국어·입력칸을 쓰라고 안내한다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await page.click('#micEn')
    await page.evaluate(() => (window as unknown as MockWindow).__nomatch())
    await expect(guide(page)).toContainText('잘 못 알아들었어요')
    expect(errors).toEqual([])
  })

  test('친구 목소리가 오류로 안 나오면 자동 듣기를 켜지 않고 알려 준다', async ({ page, context }) => {
    await context.addInitScript(() => {
      ;(window as unknown as MockWindow).__speakError = 'synthesis-failed'
    })
    const { queue, errors } = await open(page, context, { settings: { autoListen: true } })
    await startWithGreeting(page, queue)
    await expect(guide(page)).toContainText('소리가 안 나왔어요')
    await page.waitForTimeout(800)
    expect(await lastRec(page)).toBeNull()
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('화면 배치', () => {
  test('긴 대화에서 답이 늦으면 "그만 기다리기"가 화면 안으로 보인다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    for (let i = 0; i < 4; i++) await exchange(page, queue, `message ${i}`, { say: `Answer ${i}. Tell me more about it!`, say_ko: `${i}번째 대답` })
    queue.push({ ...reply(turn({ say: 'Sorry, slow.', say_ko: '늦었어.' })), delayMs: 4000 })
    await typeSend(page, 'are you there?')
    await page.clock.fastForward('00:09')
    await expect(page.locator('#btnCancelWait')).toBeInViewport({ ratio: 1 })
    expect(errors).toEqual([])
  })

  test('360x640에서 써 보기 결과가 아래 고정 버튼줄에 가리지 않는다', async ({ page, context }) => {
    await page.setViewportSize({ width: 360, height: 640 })
    const { queue, errors } = await open(page, context)
    // 따라 할 문장 셋 → 마무리 창이 길어져 써 보기 칸이 맨 아래에 온다
    await startWithGreeting(page, queue, { say: 'Say it!', say_ko: '말해 봐!', repeat: "I'm tired.", repeat_ko: '피곤해.' })
    await exchange(page, queue, '응', { say: 'Again!', say_ko: '또!', repeat: 'I like coffee.', repeat_ko: '커피 좋아.' })
    await exchange(page, queue, '응', { say: 'More!', say_ko: '더!', repeat: 'I went home.', repeat_ko: '집에 갔어.' })
    await page.click('#btnEnd')
    // 정답과 달라서 AI에게 확인을 받는 경우 (결과가 두세 줄로 길다)
    await page.fill('#wrapSheet textarea', 'I tired')
    queue.push(reply({ ok: false, fixed: "I'm tired.", comment: '거의 맞았어요! 이렇게 말하면 더 자연스러워요.' }))
    await page.click('#wrapSheet .btn-check')
    const result = page.locator('#wrapSheet .write-box .result')
    await expect(result).toBeVisible()
    await expect
      .poll(async () => {
        const r = await result.boundingBox()
        const a = await page.locator('#wrapSheet .actions').boundingBox()
        return r && a ? Math.round(r.y + r.height - a.y) : 999
      })
      .toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
  })

  test('320px 폭에서도 머리줄의 횟수·남은 시간이 ⚙️ 버튼에 가리지 않는다', async ({ page, context }) => {
    await page.setViewportSize({ width: 320, height: 640 })
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    for (const id of ['#turnCount', '#timer']) {
      // 왼쪽 끝·가운데·오른쪽 끝 모두 그 알약이 맨 위에 보여야 한다
      const covered = await page.locator(id).evaluate((el) => {
        const r = el.getBoundingClientRect()
        const y = r.top + r.height / 2
        return [r.left + 2, r.left + r.width / 2, r.right - 2].some((x) => {
          const hit = document.elementFromPoint(x, y)
          return !(hit && (hit === el || el.contains(hit)))
        })
      })
      expect(covered, id).toBe(false)
    }
    expect(errors).toEqual([])
  })

  test('240px 폭(크게 확대)에서도 설정 시트가 가로로 넘치지 않는다', async ({ page, context }) => {
    await page.setViewportSize({ width: 240, height: 600 })
    const { errors } = await open(page, context)
    await page.click('#btnStartSettings')
    const overflow = await page.locator('#settingsSheet .sheet-card').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    expect(errors).toEqual([])
  })

  test('접힌 메뉴(details)에 펼칠 수 있다는 화살표가 보인다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await page.click('#btnStartCourse')
    const summary = page.locator('#stagesDetails > summary')
    expect(await summary.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('▸')
    await summary.click()
    expect(await summary.evaluate((el) => getComputedStyle(el, '::before').content)).toContain('▾')
    expect(errors).toEqual([])
  })

  test('오늘 할 일의 앱 대화 시간은 내가 정한 하루 목표로 보인다', async ({ page, context }) => {
    const { errors } = await open(page, context, {
      settings: { minutes: 30 },
      storage: {
        [K.progress]: {
          stage: 1,
          unit: 's1-1',
          doneUnits: [],
          sessions: [{ id: '0a', date: '2026-10-07', stage: 1, unit: 's1-1', minutes: 10, turns: 2, koTurns: 2, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 }],
        },
      },
    })
    await expect(page.locator('#todayRoutine li').first()).toContainText('앱 대화 30분')
    expect(errors).toEqual([])
  })
})

test.describe('터치 폰', () => {
  test.use({ hasTouch: true })

  test('키보드를 연 채 가로로 돌려도 마이크 줄이 다시 나와 입력칸을 밀어내지 않고, 키보드를 내리면 돌아온다', async ({ page, context }) => {
    // 기기 방향을 정할 수 있게 한다 (헤드리스 브라우저는 늘 세로)
    await context.addInitScript(() => {
      const w = window as unknown as { __orient: string }
      w.__orient = 'portrait-primary'
      Object.defineProperty(screen, 'orientation', { configurable: true, get: () => ({ type: w.__orient, addEventListener() {}, removeEventListener() {} }) })
    })
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await page.locator('#typeInput').tap()
    await page.setViewportSize({ width: 390, height: 420 })
    await expect(page.locator('#composer')).toHaveClass(/typing/)
    // 키보드를 연 채 가로로: 처음 보는 방향이라 기준 높이가 이미 줄어든 높이다
    await page.evaluate(() => {
      ;(window as unknown as { __orient: string }).__orient = 'landscape-primary'
    })
    await page.setViewportSize({ width: 844, height: 200 })
    await expect(page.locator('#composer')).toHaveClass(/typing/)
    await expect(page.locator('#typeInput')).toBeInViewport()
    // 키보드를 내리면 마이크 줄이 돌아온다
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(page.locator('#composer')).not.toHaveClass(/typing/)
    // 세로로 돌아와 다시 키보드를 열면 다시 숨는다
    await page.evaluate(() => {
      ;(window as unknown as { __orient: string }).__orient = 'portrait-primary'
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.setViewportSize({ width: 390, height: 420 })
    await expect(page.locator('#composer')).toHaveClass(/typing/)
    expect(errors).toEqual([])
  })

  test('입력칸에 커서를 둔 채 키보드만 내려도 마이크 버튼이 돌아온다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await page.locator('#typeInput').tap()
    await page.setViewportSize({ width: 390, height: 420 })
    await expect(page.locator('#composer')).toHaveClass(/typing/)
    await expect(page.locator('#composer .mics')).toBeHidden()
    // 키보드 내리기 (입력칸 포커스는 그대로)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.locator('#typeInput')).toBeFocused()
    await expect(page.locator('#composer')).not.toHaveClass(/typing/)
    await expect(page.locator('#composer .mics')).toBeVisible()
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('카카오톡·저장소가 막힌 브라우저', () => {
  test('카카오톡 안에 기록이 있으면, 크롬으로 가기 전에 옮기기 코드를 복사하라고 알려 준다', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: KAKAO_UA, viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const { errors } = await open(page, context, { storage: { [K.learned]: [{ en: 'Hi.', ko: '안녕', date: TODAY }] } })
    await expect(page.locator('#inAppData')).toContainText('크롬에 없어요')
    await page.click('#btnInAppExport')
    await expect(page.locator('#transferSheet')).toBeVisible()
    expect(errors).toEqual([])
    await context.close()
  })

  test('저장소가 막혀도(사생활 보호 등) 바꾼 단계가 이번 대화에 그대로 쓰인다', async ({ page, context }) => {
    await context.addInitScript(() => {
      Storage.prototype.setItem = function () {
        throw new DOMException('blocked', 'SecurityError')
      }
    })
    const { queue, requests, errors } = await open(page, context, { settings: null })
    page.on('dialog', (d) => void d.accept())
    await page.click('#btnStartCourse')
    await page.click('#stagesDetails > summary')
    await page.locator('#stageList .stage').nth(2).getByRole('button', { name: '이 단계로 바꾸기' }).click()
    await page.click('#btnCourseClose')
    await expect(page.locator('#courseCard')).toContainText('3단계')
    await page.click('#btnStart')
    await page.fill('input[name=apiKey]', 'AIzaMEM')
    queue.push(reply(greetTurn()))
    await page.click('#btnSettingsSave')
    await expect(aiBubbles(page)).toHaveCount(1)
    expect(systemText(requests[0])).toContain('교육과정 3단계')
    // 몇 번 주고받아도 대화가 닫히지 않고(임시 저장 실패를 '다른 탭이 가져감'으로 보지 않음), 끝내면 이번 실행 동안 기록이 남는다
    await exchange(page, queue, 'hello', { say: 'Say it!', say_ko: '말해 봐!', repeat: 'I like tea.', repeat_ko: '차 좋아.' })
    await exchange(page, queue, 'I like tea')
    await page.clock.fastForward('00:20')
    await expect(page.locator('#composer')).toBeVisible()
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startMsg')).toContainText('1문장을 문장장에 저장했어요')
    await expect(page.locator('#todayLine')).toContainText('오늘 1분')
    expect(errors).toEqual([])
  })
})
