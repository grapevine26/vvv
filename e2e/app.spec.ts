import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// 브라우저 음성 기능을 가짜로 바꾼다: 말한 내용은 window.__spoken에 쌓이고, __say()로 마이크에 말한 척한다
const SPEECH_MOCK = `(() => {
  window.__spoken = [];
  window.__recs = [];
  window.__speakDelay = 5;
  class FakeVoice { constructor(name, lang) { this.name = name; this.lang = lang; this.default = false; this.localService = true; this.voiceURI = name; } }
  const voices = [
    new FakeVoice('Microsoft David - English (United States)', 'en-US'),
    new FakeVoice('Google US English', 'en-US'),
    new FakeVoice('Google 한국의', 'ko-KR'),
  ];
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.volume = 1; } };
  const synth = {
    onvoiceschanged: null,
    getVoices() { return voices; },
    speak(u) {
      window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, rate: u.rate, volume: u.volume });
      setTimeout(() => { u.onend && u.onend({}); }, window.__speakDelay);
    },
    cancel() { window.__spoken.push({ cancel: true }); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  class FakeRecognition {
    constructor() { this.lang = ''; window.__recs.push(this); }
    start() {}
    stop() { this.onend && this.onend(); }
    abort() { this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
  window.__say = (text) => {
    const r = window.__recs[window.__recs.length - 1];
    r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    r.onend();
  };
  window.__silence = (err) => { const r = window.__recs[window.__recs.length - 1]; if (err) r.onerror({ error: err }); r.onend(); };
})();`

interface Spoken {
  text?: string
  lang?: string
  voice?: string
  rate?: number
  volume?: number
  cancel?: boolean
}
interface MockWindow {
  __spoken: Spoken[]
  __recs: { lang: string }[]
  __speakDelay: number
  __say: (text: string) => void
  __silence: (err?: string) => void
}
interface GeminiRequest {
  url: string
  headers: Record<string, string>
  body: {
    systemInstruction: { parts: { text: string }[] }
    contents: { role: string; parts: { text: string }[] }[]
    generationConfig: { responseMimeType: string; responseSchema: { required: string[] } }
  }
}
interface MockReply {
  status?: number
  payload: unknown
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-goog-api-key',
  'access-control-allow-methods': 'POST,OPTIONS',
}

async function installMocks(context: BrowserContext) {
  await context.addInitScript(SPEECH_MOCK)
  const requests: GeminiRequest[] = []
  const queue: MockReply[] = []
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    requests.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || '{}') })
    const next = queue.shift() ?? { status: 500, payload: { error: { message: 'no mock queued' } } }
    await route.fulfill({
      status: next.status ?? 200,
      headers: { ...CORS, 'content-type': 'application/json' },
      body: JSON.stringify(next.payload),
    })
  })
  return { requests, queue }
}

const turn = (o: Record<string, unknown>) => ({ say: '', say_ko: '', cue: '', repeat: '', repeat_ko: '', hints: [], words: [], ...o })
const reply = (t: unknown): MockReply => ({
  payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(t) }] }, finishReason: 'STOP' }] },
})
const lastUserText = (r: GeminiRequest) => r.body.contents[r.body.contents.length - 1].parts[0].text

const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as MockWindow).__spoken.filter((s) => !s.cancel && s.volume !== 0))
const clearSpoken = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as MockWindow).__spoken = []
  })
const lastRecLang = (page: Page) =>
  page.evaluate(() => {
    const recs = (window as unknown as MockWindow).__recs
    return recs[recs.length - 1]?.lang
  })
const say = (page: Page, text: string) => page.evaluate((t) => (window as unknown as MockWindow).__say(t), text)
const aiBubbles = (page: Page) => page.locator('.msg.ai:not(.error) .bubble:not(.typing)')

test('처음 시작부터 마무리·복습까지 한 바퀴', async ({ page, context }) => {
  const { requests, queue } = await installMocks(context)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    // 일부러 만든 404 응답을 브라우저가 기록하는 줄은 예상된 것
    if (m.text().includes('status of 404') && (m.location().url || '').includes('generativelanguage')) return
    if (m.type() === 'error') errors.push('console: ' + m.text())
  })

  await page.goto('/')

  await test.step('키 없이 시작하면 설정이 열린다', async () => {
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#startMsg')).toContainText('API 키')
    await page.click('#btnStart')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await expect(page.locator('#settingsNotice')).toContainText('API 키')
    const voiceOptions = await page.$$eval('#voiceSelect option', (os) => os.map((o) => (o as HTMLOptionElement).value))
    expect(voiceOptions).toContain('Google US English')
    expect(voiceOptions).not.toContain('Google 한국의')
  })

  await test.step('설정이 브라우저에 저장된다', async () => {
    await page.fill('input[name=apiKey]', 'TEST-KEY-123')
    await page.fill('input[name=likes]', '커피, 여행')
    await page.fill('input[name=minutes]', '3')
    await page.click('#settingsForm button[type=submit]')
    await expect(page.locator('#settingsSheet')).toBeHidden()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('englishFriend.settings') || '{}'))
    expect(saved).toMatchObject({ apiKey: 'TEST-KEY-123', minutes: 3, likes: '커피, 여행' })
  })

  await test.step('첫 인사: 요청 형식과 화면, 읽기', async () => {
    queue.push({
      payload: {
        candidates: [
          {
            content: {
              parts: [
                { text: '(생각 중인 내용)', thought: true },
                {
                  text: JSON.stringify(
                    turn({
                      say: "Hi! I'm Emma. How was your day?",
                      say_ko: '안녕! 나는 Emma야. 오늘 하루 어땠어?',
                      hints: [
                        { en: 'Good.', ko: '좋았어.' },
                        { en: 'Tired.', ko: '피곤했어.' },
                      ],
                      words: [{ en: 'day', ko: '하루' }],
                    }),
                  ),
                },
              ],
            },
          },
        ],
      },
    })
    await page.click('#btnStart')
    await expect(aiBubbles(page)).toHaveCount(1)
    const r0 = requests[0]
    expect(r0.headers['x-goog-api-key']).toBe('TEST-KEY-123')
    expect(r0.url).not.toContain('TEST-KEY')
    expect(r0.url).toMatch(/\/models\/gemini-3\.5-flash-lite:generateContent$/)
    const sys = r0.body.systemInstruction.parts[0].text
    expect(sys).toContain('단어 몇 개 앎')
    expect(sys).toContain('커피, 여행')
    expect(sys).not.toContain('[복습]')
    expect(r0.body.generationConfig.responseMimeType).toBe('application/json')
    expect(r0.body.generationConfig.responseSchema.required).toContain('hints')
    expect(r0.body.contents[0].role).toBe('user')
    await expect(page.locator('#chat')).not.toContainText('생각 중인 내용')
    await expect(page.locator('.chip.hint')).toHaveCount(2)
    await expect(page.locator('.chip.word')).toHaveCount(1)
    await expect(page.locator('.msg.ai .meaning').first()).toContainText('오늘 하루')
    await expect
      .poll(() => spoken(page))
      .toContainEqual(
        expect.objectContaining({ text: "Hi! I'm Emma. How was your day?", lang: 'en-US', voice: 'Google US English', rate: 0.85 }),
      )
    const unlocked = await page.evaluate(() => (window as unknown as MockWindow).__spoken.some((s) => s.volume === 0))
    expect(unlocked).toBe(true)
  })

  await test.step('한국어로 대답하면 따라 말하기 제안, 신호는 한국어 목소리로', async () => {
    await clearSpoken(page)
    queue.push(
      reply(turn({ say: "Oh, you're tired.", say_ko: '아, 피곤하구나.', cue: '따라 해 볼까요?', repeat: "I'm so tired.", repeat_ko: '나 너무 피곤해.' })),
    )
    await page.click('#micKo')
    expect(await lastRecLang(page)).toBe('ko-KR')
    await expect(page.locator('#micEn')).toBeDisabled()
    await say(page, '오늘 좀 피곤했어')
    await expect(aiBubbles(page)).toHaveCount(2)
    const r1 = requests[1]
    expect(lastUserText(r1)).toBe('[한국어] 오늘 좀 피곤했어')
    expect(r1.body.contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(JSON.parse(r1.body.contents[1].parts[0].text).say).toBeTruthy()
    await expect
      .poll(async () => (await spoken(page)).map((s) => `${s.lang}|${s.voice}|${s.text}|${s.rate}`))
      .toEqual([
        "en-US|Google US English|Oh, you're tired.|0.85",
        'ko-KR|Google 한국의|따라 해 볼까요?|1',
        "en-US|Google US English|I'm so tired.|0.85",
      ])
    await expect(page.locator('#micEn')).toHaveClass(/recommend/)
    await expect(page.locator('#guide')).toContainText("I'm so tired.")
    await page.screenshot({ path: 'test-results/shots/chat.png' })
  })

  await test.step('EN 버튼으로 따라 말하기, 섞인 답은 나눠 읽기', async () => {
    await clearSpoken(page)
    queue.push(
      reply(
        turn({
          say: 'Nice! 잘했어요. What did you eat?',
          say_ko: '좋아! 잘했어. 뭐 먹었어?',
          hints: [
            { en: 'Pizza.', ko: '피자.' },
            { en: 'Rice.', ko: '밥.' },
          ],
        }),
      ),
    )
    await page.click('#micEn')
    expect(await lastRecLang(page)).toBe('en-US')
    await say(page, 'I am so tired')
    await expect(aiBubbles(page)).toHaveCount(3)
    expect(lastUserText(requests[2])).toBe('[따라 말하기 — 목표 문장: "I\'m so tired."] I am so tired')
    await expect(page.locator('.msg.me .tag').last()).toHaveText('따라 말하기')
    await expect
      .poll(async () => (await spoken(page)).map((s) => `${s.lang}|${s.text}`))
      .toEqual(['en-US|Nice!', 'ko-KR|잘했어요.', 'en-US|What did you eat?'])
    await expect(page.locator('#micEn')).not.toHaveClass(/recommend/)
  })

  await test.step('모델 이름 오류 → 안내 → 다시 시도', async () => {
    queue.push({ status: 404, payload: { error: { code: 404, message: 'models/gemini-old is not found for API version v1beta' } } })
    queue.push(reply(turn({ say: 'Pizza! I like pizza too.', say_ko: '피자! 나도 피자 좋아해.' })))
    await page.fill('#typeInput', 'pizza')
    await page.press('#typeInput', 'Enter')
    await expect(page.locator('.msg.error')).toContainText('모델을 찾을 수 없어요')
    expect(lastUserText(requests[3])).toBe('[영어] pizza')
    await page.click('.msg.error >> text=다시 시도')
    await expect(aiBubbles(page)).toHaveCount(4)
    expect(JSON.stringify(requests[4].body.contents)).toBe(JSON.stringify(requests[3].body.contents))
    await expect(page.locator('.msg.error')).toHaveCount(0)
  })

  await test.step('JSON이 아닌 답도 그대로 보여 준다', async () => {
    queue.push({ payload: { candidates: [{ content: { parts: [{ text: 'Sounds fun!' }] } }] } })
    await page.fill('#typeInput', '재밌었어')
    await page.press('#typeInput', 'Enter')
    await expect(aiBubbles(page)).toHaveCount(5)
    await expect(page.locator('.msg.ai .say').last()).toHaveText('Sounds fun!')
    expect(lastUserText(requests[5])).toBe('[한국어] 재밌었어')
  })

  await test.step('마이크 권한 오류를 한국어로 안내', async () => {
    await page.click('#micKo')
    await page.evaluate(() => (window as unknown as MockWindow).__silence('not-allowed'))
    await expect(page.locator('#toast')).toContainText('마이크가 막혀')
    await expect(page.locator('#micEn')).toBeEnabled()
  })

  await test.step('마무리: 듣고 읽기 → 써 보기', async () => {
    await page.click('#btnEnd')
    await expect(page.locator('#wrapSheet')).toBeVisible()
    await expect(page.locator('#toast')).toHaveCount(0)
    await expect(page.locator('#wrapBody .card .say')).toHaveText(["I'm so tired."])
    await page.click('#wrapBody >> text=🎤 읽어 보기')
    expect(await lastRecLang(page)).toBe('en-US')
    await expect(page.locator('#wrapBody >> text=듣는 중…')).toBeVisible()
    await say(page, "i'm so tired")
    await expect(page.locator('#wrapBody .card .result').first()).toContainText('잘 들렸어요')
    await expect(page.locator('#wrapBody >> text=🎤 읽어 보기')).toBeVisible()

    const before = requests.length
    await page.fill('#wrapBody textarea', "I'm so tired")
    await page.click('#wrapBody >> text=확인')
    await expect(page.locator('#wrapBody .result').last()).toContainText('완벽')
    expect(requests.length).toBe(before)

    queue.push(reply({ ok: false, fixed: "I'm so tired.", comment: "거의 맞았어요! 앞에 I'm만 붙이면 돼요." }))
    await page.fill('#wrapBody textarea', 'I so tired')
    await page.click('#wrapBody >> text=확인')
    await expect(page.locator('#wrapBody .result').last()).toContainText('거의 맞았어요')
    await expect(page.locator('#wrapBody .result').last()).toContainText("I'm so tired.")
    expect(requests[requests.length - 1].body.generationConfig.responseSchema.required).toContain('fixed')
    await page.screenshot({ path: 'test-results/shots/wrap.png' })
  })

  await test.step('저장하고 끝내기 → 문장장', async () => {
    await page.click('#btnFinish')
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#startMsg')).toContainText('1문장')
    const learned = await page.evaluate(() => JSON.parse(localStorage.getItem('englishFriend.learned') || '[]'))
    expect(learned).toHaveLength(1)
    expect(learned[0]).toMatchObject({ en: "I'm so tired.", ko: '나 너무 피곤해.' })
    expect(learned[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await page.click('#btnStartBook')
    await expect(page.locator('#bookBody')).toContainText("I'm so tired.")
    await page.click('#btnBookClose')
  })

  await test.step('다음 대화: 복습 문장 포함, 뜻 숨기기·소리 먼저', async () => {
    await page.click('#btnStartSettings')
    await page.uncheck('input[name=showKo]')
    await page.check('input[name=soundFirst]')
    await page.click('#settingsForm button[type=submit]')
    await page.evaluate(() => {
      ;(window as unknown as MockWindow).__speakDelay = 600
    })
    queue.push(reply(turn({ say: 'Hi again! Are you still tired?', say_ko: '또 만났네! 아직 피곤해?' })))
    await page.click('#btnStart')
    await expect(aiBubbles(page)).toHaveCount(1)
    const sys = requests[requests.length - 1].body.systemInstruction.parts[0].text
    expect(sys).toContain('[복습]')
    expect(sys).toContain("I'm so tired.")
    await expect(page.locator('.msg.ai .bubble.veiled')).toHaveCount(1)
    await expect(page.locator('.meaning.concealed')).toHaveCount(1)
    await expect(page.locator('.msg.ai .bubble.veiled')).toHaveCount(0, { timeout: 5000 })
    await page.click('.meaning.concealed')
    await expect(page.locator('.meaning.concealed')).toHaveCount(0)
  })

  await test.step('휴대폰 폭에서 가로 넘침 없음', async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.screenshot({ path: 'test-results/shots/dark.png' })
  })

  expect(errors).toEqual([])
})

test('정한 시간이 지나면 마무리 배너', async ({ page, context }) => {
  const { queue } = await installMocks(context)
  await page.clock.install()
  await context.addInitScript(() => {
    localStorage.setItem('englishFriend.settings', JSON.stringify({ apiKey: 'K', minutes: 3 }))
  })
  await page.goto('/')
  queue.push(reply(turn({ say: 'Hi!', say_ko: '안녕!' })))
  await page.click('#btnStart')
  await expect(aiBubbles(page)).toHaveCount(1)
  await expect(page.locator('#timeBanner')).toHaveCount(0)
  await page.clock.fastForward('03:20')
  await expect(page.locator('#timeBanner')).toBeVisible()
  await expect(page.locator('#timer')).toContainText('/ 03:00')
  await page.click('#btnMore')
  await expect(page.locator('#timeBanner')).toHaveCount(0)
  await expect(page.locator('#timer')).toContainText('/ 08:00')
  await page.clock.fastForward('05:00')
  await page.click('#btnWrapNow')
  await expect(page.locator('#wrapSheet')).toBeVisible()
  await page.click('#btnBackToChat')
  await expect(page.locator('#timeBanner')).toHaveCount(0)
})

test('내보내기 → 다른 기기에서 가져오기', async ({ browser }) => {
  // 기기 A: 문장 2개, 친구 이름 Mia
  const deviceA = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  await deviceA.addInitScript(() => {
    if (localStorage.getItem('englishFriend.learned')) return
    localStorage.setItem(
      'englishFriend.learned',
      JSON.stringify([
        { en: "I'm so tired.", ko: '나 너무 피곤해.', date: '2026-10-05' },
        { en: 'I like coffee.', ko: '커피 좋아해.', date: '2026-10-06' },
      ]),
    )
    localStorage.setItem(
      'englishFriend.settings',
      JSON.stringify({ apiKey: 'KEY-A', friendName: 'Mia', voiceName: 'PC Voice', rate: 0.7 }),
    )
  })
  const pa = await deviceA.newPage()
  await pa.goto('/')
  await pa.click('#btnStartBook')
  await pa.click('#btnExport')
  await expect(pa.locator('#transferResult')).toContainText('복사했어요 (문장 2개)')
  const code = await pa.locator('#exportCode').inputValue()
  expect(code).toMatch(/^EF1\./)
  expect(await pa.evaluate(() => navigator.clipboard.readText())).toBe(code)

  // 기기 B: 자기 키·목소리가 있고, 문장 1개가 겹친다
  const deviceB = await browser.newContext()
  await deviceB.addInitScript(() => {
    if (localStorage.getItem('englishFriend.settings')) return
    localStorage.setItem('englishFriend.settings', JSON.stringify({ apiKey: 'KEY-B', voiceName: 'Phone Voice' }))
    localStorage.setItem('englishFriend.learned', JSON.stringify([{ en: 'I am so tired', ko: '피곤해', date: '2026-10-07' }]))
  })
  const pb = await deviceB.newPage()
  await pb.goto('/')
  await pb.click('#btnStartBook')
  await pb.click('#btnImportOpen')

  // 잘못 붙여 넣은 경우
  await pb.fill('#importCode', '안녕하세요')
  await pb.click('#btnImportRun')
  await expect(pb.locator('#transferResult')).toContainText('영어 친구 코드가 아니에요')
  await pb.fill('#importCode', code.slice(0, code.length - 12))
  await pb.click('#btnImportRun')
  await expect(pb.locator('#transferResult')).toContainText('잘렸거나')

  // 카톡에서 복사하며 줄바꿈이 섞여도 된다
  await pb.fill('#importCode', `${code.slice(0, 20)}\n${code.slice(20)}\n`)
  await pb.click('#btnImportRun')
  await expect(pb.locator('#transferResult')).toContainText('1문장을 새로 가져왔어요 (모두 2문장)')
  await expect(pb.locator('#bookBody .repeat-text')).toHaveText(['I like coffee.', 'I am so tired'])
  const saved = await pb.evaluate(() => JSON.parse(localStorage.getItem('englishFriend.settings') || '{}'))
  expect(saved).toMatchObject({ apiKey: 'KEY-B', voiceName: 'Phone Voice', friendName: 'Mia', rate: 0.7 })
  const learnedB = await pb.evaluate(() => JSON.parse(localStorage.getItem('englishFriend.learned') || '[]'))
  expect(learnedB).toHaveLength(2)
  expect(learnedB[0]).toMatchObject({ en: 'I am so tired', date: '2026-10-05' })
  await pb.screenshot({ path: 'test-results/shots/transfer.png', fullPage: true })

  await pb.click('#btnBookClose')
  await expect(pb.locator('#startTitle')).toContainText('Mia')
  await deviceA.close()
  await deviceB.close()
})
