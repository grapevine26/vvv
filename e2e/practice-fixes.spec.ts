import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { collectErrors, installMocks, lastRec, reply, say, spoken, storageGet, type MockOptions } from './helpers'

// 연습 기능 검토에서 나온 문제를 고친 뒤, 다시 생기지 않게 지키는 테스트
test.use({ timezoneId: 'Asia/Seoul' })
const NOW = new Date('2026-10-08T10:00:00+09:00')
const KAKAO_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 KAKAOTALK 10.4.5'
const LEARNED = [
  ['I like tea.', '차를 좋아해요.'],
  ['See you tomorrow.', '내일 봐요.'],
  ['I am hungry.', '배가 고파요.'],
  ['It is cold today.', '오늘 추워요.'],
].map(([en, ko]) => ({ en, ko, date: '2026-10-01' }))

async function open(page: Page, context: BrowserContext, opts: MockOptions & { settings?: Record<string, unknown> } = {}) {
  await context.clock.install({ time: NOW })
  const mocks = await installMocks(context, {
    mic: opts.mic,
    storage: { 'englishFriend.settings': { apiKey: 'K', ...opts.settings }, 'englishFriend.learned': LEARNED, ...opts.storage },
  })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  return { ...mocks, errors }
}

// 지금 문제를 '모르겠어요'로 넘기거나(말하기·순서) 첫 보기를 골라(뜻 고르기) 답한다
async function answerOne(page: Page) {
  const skip = page.locator('#qzSkip')
  if (await skip.isVisible()) await skip.click()
  else await page.locator('.qz-choice').first().click()
  await expect(page.locator('#qzFeedback')).toBeVisible()
}

test('퀴즈: 다른 탭에서 푼 복습 기록을 덮어쓰지 않는다', async ({ page, context }) => {
  const { errors } = await open(page, context)
  await page.click('#btnQuiz')
  await page.click('#qzStart')
  // 그사이 다른 탭이 다른 문장들의 결과를 저장했다
  const other = { 'Other sentence one.': { box: 3, due: '2026-10-12', seen: 3 }, 'Other sentence two.': { box: 2, due: '2026-10-10', seen: 2 } }
  await page.evaluate((o) => localStorage.setItem('englishFriend.quiz', JSON.stringify(o)), other)
  await answerOne(page)
  const saved = await storageGet(page, 'englishFriend.quiz')
  expect(saved).toMatchObject(other)
  expect(Object.keys(saved).length).toBe(3)
  expect(errors).toEqual([])
})

test('퀴즈: 말하기 문제에서 마이크를 켠 채 입력칸으로 답해도, 다음 문제로 가면 마이크가 꺼진다', async ({ page, context }) => {
  const { errors } = await open(page, context)
  await page.click('#btnQuiz')
  await page.click('#qzStart')
  // 말하기 문제가 나올 때까지 넘긴다
  for (let i = 0; i < 6 && !(await page.locator('.qz-q[data-kind="speak"]').isVisible()); i++) {
    await answerOne(page)
    await page.click('#qzNext')
  }
  await expect(page.locator('.qz-q[data-kind="speak"]')).toBeVisible()
  await page.click('#qzMic')
  await expect.poll(async () => (await lastRec(page))?.started).toBe(true)
  await page.fill('#qzInput', 'something')
  await page.click('#qzCheck')
  await expect(page.locator('#qzFeedback')).toBeVisible()
  await expect.poll(async () => (await lastRec(page))?.stopped).toBe(true)
  expect(errors).toEqual([])
})

test('시트를 닫으면 읽던 소리도 멈춘다', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  await page.evaluate(() => {
    ;(window as unknown as { __speakDelay: number }).__speakDelay = 5000
  })
  queue.push(reply({ title: 'My Day', title_ko: '나의 하루', sentences: [{ en: 'I wake up.', ko: '일어나요.' }, { en: 'I eat.', ko: '먹어요.' }, { en: 'I go out.', ko: '나가요.' }, { en: 'I sleep.', ko: '자요.' }] }))
  await page.click('#btnListen')
  await page.click('#lsnMake')
  await expect(page.locator('#lsnTitle')).toBeVisible()
  await page.click('#lsnPlayAll')
  await expect.poll(async () => (await spoken(page)).length).toBeGreaterThan(0)
  await page.evaluate(() => {
    ;(window as unknown as { __spoken: unknown[] }).__spoken = []
  })
  await page.keyboard.press('Escape')
  await expect(page.locator('#listenSheet')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: { cancel?: boolean }[] }).__spoken.some((s) => s.cancel))).toBe(true)
  expect(errors).toEqual([])
})

test('듣기 연습에서 키를 넣으러 갔다가 저장하면 듣기 화면으로 돌아온다', async ({ page, context }) => {
  const { errors } = await open(page, context, { settings: { apiKey: '' } })
  await page.click('#btnListen')
  await page.click('#lsnNeedKey')
  await expect(page.locator('#settingsSheet')).toBeVisible()
  await page.fill('input[name=apiKey]', 'AIzaNEW')
  await page.click('#btnSettingsSave')
  await expect(page.locator('#listenSheet')).toBeVisible()
  await expect(page.locator('#lsnMake')).toBeVisible()
  expect(errors).toEqual([])
})

test('백업 파일로 되살리면 시작 화면이 바로 "백업하세요"라고 재촉하지 않는다', async ({ page, context }) => {
  const progress = { stage: 1, unit: 's1-1', doneUnits: [], sessions: [{ id: '0a', date: '2026-09-20', stage: 1, unit: 's1-1', minutes: 10, turns: 3, koTurns: 3, enOwnTurns: 0, enOwnWords: 0, repeatTurns: 0 }] }
  const { errors } = await open(page, context, { storage: { 'englishFriend.progress': progress } })
  await expect(page.locator('#backupReminder')).toBeVisible()
  // 다른 곳에서 만든 백업 파일 (내용은 이 기기의 내보내기 코드)
  await page.click('#btnBackupNow')
  await page.click('#btnExport')
  const code = (await page.locator('#exportCode').inputValue()).trim()
  await page.evaluate(() => localStorage.removeItem('englishFriend.lastBackup'))
  await page.locator('#backupFile').setInputFiles({ name: 'backup.txt', mimeType: 'text/plain', buffer: Buffer.from(`영어 친구 백업\n\n${code}\n`) })
  await expect(page.locator('#transfer')).toContainText('기록을 되살렸어요')
  await page.keyboard.press('Escape')
  await expect(page.locator('#startSheet')).toBeVisible()
  await expect(page.locator('#backupReminder')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('카톡 안 브라우저에서는 "파일로 저장"을 숨기고 코드 복사를 백업으로 안내한다', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: KAKAO_UA, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const { errors } = await open(page, context)
  await page.click('#tab-library')
  await page.click('#btnStartTransfer')
  await expect(page.locator('#backupInApp')).toContainText('파일이 저장되지 않아요')
  await expect(page.locator('#btnBackupSave')).toHaveCount(0)
  await expect(page.locator('#btnExport')).toBeVisible()
  expect(errors).toEqual([])
  await context.close()
})

test('옮기기 코드에 퀴즈 복습 일정이 들어가고, 가져오면 문장마다 합쳐진다', async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pa = await a.newPage()
  const quizA = { 'I like tea.': { box: 4, due: '2026-10-20', seen: 5 } }
  await open(pa, a, { storage: { 'englishFriend.quiz': quizA } })
  await pa.click('#tab-library')
  await pa.click('#btnStartTransfer')
  await pa.click('#btnExport')
  const code = (await pa.locator('#exportCode').inputValue()).trim()
  await a.close()

  const b = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pb = await b.newPage()
  const quizB = { 'I like tea.': { box: 1, due: '2026-10-09', seen: 1 }, 'I am hungry.': { box: 2, due: '2026-10-10', seen: 2 } }
  const { errors } = await open(pb, b, { storage: { 'englishFriend.quiz': quizB } })
  await pb.click('#tab-library')
  await pb.click('#btnStartTransfer')
  await pb.click('#btnImportOpen')
  await pb.fill('#importCode', code)
  await pb.click('#btnImportRun')
  await expect(pb.locator('#transferResult')).toBeVisible()
  expect(await storageGet(pb, 'englishFriend.quiz')).toEqual({ 'I like tea.': quizA['I like tea.'], 'I am hungry.': quizB['I am hungry.'] })
  expect(errors).toEqual([])
  await b.close()
})

test('대화 전 연습: 단계를 넘기면 듣던 마이크가 꺼진다', async ({ page, context }) => {
  const { errors } = await open(page, context)
  await page.click('#btnWarmup')
  await expect(page.locator('#warmupSheet')).toBeVisible()
  // 듣기 단계 → 따라 말하기 단계로
  await page.click('#btnWarmupNext')
  const mic = page.locator('#warmupSheet .wu-mic').first()
  await mic.click()
  await expect.poll(async () => (await lastRec(page))?.started).toBe(true)
  await page.click('#btnWarmupNext')
  await expect.poll(async () => (await lastRec(page))?.stopped).toBe(true)
  // 끄기만 하고, 들은 말이 엉뚱한 단계로 가지 않는다
  await say(page, 'hello').catch(() => {})
  expect(errors).toEqual([])
})
