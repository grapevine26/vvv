import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import {
  clearSpoken,
  collectErrors,
  errorReply,
  horizontalOverflow,
  installMocks,
  lastRec,
  lastUserText,
  reply,
  say,
  spoken,
  storageGet,
  systemText,
} from './helpers'

// 듣고 따라 말하기(쉐도잉): 이야기 만들기 → 전체 듣기 → 한 문장씩 따라 말하기 → 문장장 저장 → 다른 이야기,
// 오류(키 권한·서버 바쁨·이상한 답), 그만두기, 키 없을 때, 지난 이야기 다시 듣기

const STORY = {
  title: 'My Lunch',
  title_ko: '나의 점심',
  sentences: [
    { en: 'I am very hungry.', ko: '나는 아주 배고파.' },
    { en: 'I like hot soup.', ko: '나는 뜨거운 수프를 좋아해.' },
    { en: 'I like pizza.', ko: '나는 피자를 좋아해.' },
    { en: 'Lunch is so good.', ko: '점심이 정말 맛있어.' },
  ],
}
const STORY2 = {
  title: 'At the Park',
  title_ko: '공원에서',
  sentences: [
    { en: 'I walk in the park.', ko: '나는 공원을 걸어.' },
    { en: 'It is sunny today.', ko: '오늘은 맑아.' },
    { en: 'I like the trees.', ko: '나는 나무가 좋아.' },
    { en: 'I feel happy.', ko: '나는 기분이 좋아.' },
  ],
}

const K = { settings: 'englishFriend.settings', learned: 'englishFriend.learned', progress: 'englishFriend.progress' }
const PROGRESS = { stage: 1, unit: 's1-3', doneUnits: [], sessions: [], days: {} }

async function open(page: Page, context: BrowserContext, storage: Record<string, unknown> = {}) {
  const mocks = await installMocks(context, {
    storage: {
      [K.settings]: { apiKey: 'K', likes: '축구' },
      [K.progress]: PROGRESS,
      [K.learned]: [{ en: 'I like pizza.', ko: '피자 좋아.', date: '2026-10-01' }],
      ...storage,
    },
  })
  const errors = collectErrors(page)
  await page.goto('/')
  await page.click('#btnListen')
  await expect(page.locator('#listenSheet')).toBeVisible()
  return { ...mocks, errors }
}

const sheet = (page: Page) => page.locator('#listenSheet')

test('흐름 전체: 이야기 만들기 → 듣기 → 따라 말하기 → 문장장 저장 → 다른 이야기', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  await expect(page.locator('#lsnUnit')).toContainText('1단계')
  await expect(page.locator('#lsnUnit')).toContainText('좋아하는 음식')

  queue.push(reply(STORY))
  await page.click('#lsnMake')
  await expect(page.locator('#lsnTitle')).toHaveText('My Lunch')

  // 요청 본문: 단계·단원·좋아하는 것·1단계 문장 길이, 이야기 스키마
  expect(requests).toHaveLength(1)
  const sys = systemText(requests[0])
  expect(sys).toContain('1단계')
  expect(sys).toContain('좋아하는 음식')
  expect(sys).toContain('축구')
  expect(sys).toContain('4~7단어')
  expect(sys).toContain('- I like pizza.')
  expect(requests[0].body.generationConfig.responseSchema.required).toEqual(['title', 'title_ko', 'sentences'])
  expect(requests[0].body.generationConfig.responseMimeType).toBe('application/json')

  // 제목 뜻은 눌러야 보인다
  const titleCard = sheet(page).locator('.lsn-title-card')
  await expect(titleCard.locator('button.meaning.concealed')).toBeVisible()
  await titleCard.locator('button.meaning.concealed').click()
  await expect(titleCard.locator('.meaning')).toHaveText('나의 점심')

  // ① 전체 듣기 (보통·천천히)
  await clearSpoken(page)
  await page.click('#lsnPlayAll')
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(STORY.sentences.map((s) => s.en))
  const normalRate = (await spoken(page))[0].rate ?? 1
  await clearSpoken(page)
  await page.click('#lsnPlayAllSlow')
  await expect.poll(async () => (await spoken(page)).length).toBe(4)
  expect((await spoken(page))[0].rate ?? 1).toBeLessThan(normalRate)

  // ② 첫 문장: 뜻은 가려져 있다
  await expect(page.locator('#lsnCount')).toHaveText('1 / 4')
  const card = page.locator('#lsnCard')
  await expect(card.locator('.say')).toHaveText('I am very hungry.')
  await expect(card.locator('button.meaning.concealed')).toBeVisible()
  await card.locator('button.meaning.concealed').click()
  await expect(card.locator('.meaning')).toHaveText('나는 아주 배고파.')

  // 따라 말하기: 덜 들린 단어 표시
  await page.click('#lsnShadow')
  await expect(page.locator('#lsnShadow')).toContainText('듣는 중')
  expect((await lastRec(page))?.started).toBe(true)
  expect((await lastRec(page))?.lang).toMatch(/^en/)
  await say(page, 'I hungry')
  await expect(page.locator('#lsnResult')).toContainText('이렇게 들렸어요: "I hungry"')
  await expect(page.locator('#lsnResult .wm.miss')).toHaveText([/^am/, /^very/])
  await expect(page.locator('#lsnShadow')).toHaveText('한 번 더 따라 말하기')
  await expect(sheet(page).locator('.lsn-dot.tried')).toHaveCount(1)
  // 거의 다 들리면 칭찬하고 덜 들린 단어만 짚는다
  await page.click('#lsnShadow')
  await say(page, 'I am hungry')
  await expect(page.locator('#lsnResult')).toContainText('잘했어요')
  await expect(page.locator('#lsnResult .wm.miss')).toHaveText([/^very/])
  // 다시 해서 다 들리면 칭찬, 표시 없음
  await page.click('#lsnShadow')
  await say(page, 'I am very hungry')
  await expect(page.locator('#lsnResult')).toContainText('다 들렸어요')
  await expect(page.locator('#lsnResult .word-marks')).toHaveCount(0)
  await expect(sheet(page).locator('.lsn-dot.good')).toHaveCount(1)

  // 다음 문장: 넘기면 바로 들려준다. 새 카드의 뜻은 다시 가려진다
  await clearSpoken(page)
  await expect(page.locator('#lsnPrev')).toBeDisabled()
  await page.click('#lsnNext')
  await expect(page.locator('#lsnCount')).toHaveText('2 / 4')
  await expect(card.locator('.say')).toHaveText('I like hot soup.')
  await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toEqual(['I like hot soup.'])
  await expect(card.locator('button.meaning.concealed')).toBeVisible()
  await expect(page.locator('#lsnResult')).toHaveCount(0)
  // 이전으로 가면 지난 결과가 남아 있다
  await page.click('#lsnPrev')
  await expect(page.locator('#lsnResult')).toContainText('다 들렸어요')
  await page.click('#lsnNext')
  await page.click('#lsnShadow')
  await say(page, 'I soup')
  await expect(page.locator('#lsnResult .wm.miss')).toHaveText([/^like/, /^hot/])
  await page.click('#lsnNext')
  await page.click('#lsnNext')
  await expect(page.locator('#lsnCount')).toHaveText('4 / 4')
  await expect(page.locator('#lsnNext')).toContainText('다 했어요')
  await page.click('#lsnNext')

  // ③ 끝: 요약, 문장장에 이미 있는 문장은 고를 수 없다
  await expect(page.locator('#lsnSummary')).toContainText('4문장 중 2문장을 따라 말했고, 1문장이 잘 들렸어요')
  const picks = page.locator('#lsnPicks input[type=checkbox]')
  await expect(picks).toHaveCount(4)
  await expect(picks.nth(2)).toBeDisabled()
  await expect(page.locator('#lsnPicks .lsn-tag')).toHaveCount(1)
  await expect(page.locator('#lsnSave')).toContainText('고른 3문장')
  await picks.nth(3).uncheck()
  await expect(page.locator('#lsnSave')).toContainText('고른 2문장')
  await page.click('#lsnSave')
  await expect(page.locator('#lsnSaved')).toContainText('문장장에 2개 더했어요')
  const learned = (await storageGet(page, K.learned)) as { en: string }[]
  expect(learned.map((l) => l.en)).toEqual(['I like pizza.', 'I am very hungry.', 'I like hot soup.'])
  // 저장한 문장은 이제 '문장장에 있어요'
  await expect(page.locator('#lsnPicks .lsn-tag')).toHaveCount(3)
  // 남은 한 문장은 고르지 않았으니 버튼은 꺼져 있다. 그것까지 저장하면 버튼이 사라진다
  await expect(page.locator('#lsnSave')).toBeDisabled()
  await picks.nth(3).check()
  await page.click('#lsnSave')
  await expect(page.locator('#lsnSaved')).toContainText('문장장에 1개 더했어요')
  await expect(page.locator('#lsnSave')).toHaveCount(0)

  // 다른 이야기: 방금 들은 제목은 피해 달라고 한다
  queue.push(reply(STORY2))
  await page.click('#lsnAnother')
  await expect(page.locator('#lsnTitle')).toHaveText('At the Park')
  expect(requests).toHaveLength(2)
  expect(lastUserText(requests[1])).toContain('"My Lunch"')
  await expect(page.locator('#lsnCount')).toHaveText('1 / 4')

  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  expect(errors).toEqual([])
})

test('키 권한 오류(403): 한국어 안내 + 설정 열기', async ({ page, context }) => {
  const { queue, errors } = await open(page, context)
  queue.push(errorReply(403, 'Permission denied'))
  await page.click('#lsnMake')
  await expect(page.locator('#lsnError')).toContainText('API 키 권한 문제')
  // 키 문제는 다시 시도가 아니라 설정으로
  await expect(page.locator('#lsnMake')).toHaveText('이야기 만들기')
  await page.click('#lsnFixSettings')
  await expect(page.locator('#settingsSheet')).toBeVisible()
  await expect(page.locator('#listenSheet')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('서버 바쁨(503)이나 이상한 답이면 다시 시도할 수 있다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  queue.push(errorReply(503, 'overloaded'))
  await page.click('#lsnMake')
  await expect(page.locator('#lsnError')).toContainText('AI 서버가 잠시 바빠요')
  await expect(page.locator('#lsnFixSettings')).toHaveCount(0)
  await expect(page.locator('#lsnMake')).toHaveText('다시 시도')

  // 문장이 하나도 없는 답
  queue.push(reply({ title: 'x', title_ko: 'x', sentences: [{ en: '  ', ko: '' }] }))
  await page.click('#lsnMake')
  await expect(page.locator('#lsnError')).toContainText('이야기를 제대로 받지 못했어요')

  queue.push(reply(STORY))
  await page.click('#lsnMake')
  await expect(page.locator('#lsnTitle')).toHaveText('My Lunch')
  await expect(page.locator('#lsnError')).toHaveCount(0)
  expect(requests).toHaveLength(3)
  expect(errors).toEqual([])
})

test('키가 없으면 키 넣으라는 안내와 설정 버튼, 요청은 보내지 않는다', async ({ page, context }) => {
  const { requests, errors } = await open(page, context, { [K.settings]: { apiKey: '' } })
  await expect(page.locator('#lsnNoKey')).toContainText('API 키가 필요해요')
  await expect(page.locator('#lsnMake')).toHaveCount(0)
  await page.click('#lsnNeedKey')
  await expect(page.locator('#settingsSheet')).toBeVisible()
  expect(requests).toHaveLength(0)
  expect(errors).toEqual([])
})

test('기다리다 그만두기, 그리고 다시 열면 지난 이야기를 요청 없이 다시 듣는다', async ({ page, context }) => {
  const { queue, requests, errors } = await open(page, context)
  queue.push({ ...reply(STORY2), delayMs: 1500 })
  await page.click('#lsnMake')
  await expect(page.locator('#lsnLoading')).toBeVisible()
  await page.click('#lsnCancel')
  await expect(page.locator('#lsnLoading')).toHaveCount(0)
  await expect(page.locator('#lsnMake')).toHaveText('이야기 만들기')
  await expect(page.locator('#lsnError')).toHaveCount(0)
  await page.waitForTimeout(1700)
  // 늦게 온 답은 무시한다
  await expect(page.locator('#lsnTitle')).toHaveCount(0)

  queue.push(reply(STORY))
  await page.click('#lsnMake')
  await expect(page.locator('#lsnTitle')).toHaveText('My Lunch')
  await page.keyboard.press('Escape')
  await expect(page.locator('#listenSheet')).toHaveCount(0)

  await page.click('#btnListen')
  await expect(page.locator('#lsnLast')).toContainText('My Lunch')
  await page.click('#lsnLast')
  await expect(page.locator('#lsnTitle')).toHaveText('My Lunch')
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})

// 화면 확인용 스크린샷 (LSN_SHOTS=폴더 를 주면 찍는다)
const SHOTS = process.env.LSN_SHOTS
for (const scheme of ['light', 'dark'] as const) {
  test(`스크린샷 ${scheme}`, async ({ page, context }) => {
    test.skip(!SHOTS, '스크린샷은 LSN_SHOTS가 있을 때만')
    await page.emulateMedia({ colorScheme: scheme })
    const { queue } = await open(page, context)
    await page.screenshot({ path: `${SHOTS}/listen-intro-${scheme}.png` })
    queue.push(errorReply(503, 'overloaded'))
    await page.click('#lsnMake')
    await expect(page.locator('#lsnError')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/listen-error-${scheme}.png` })
    queue.push({ ...reply(STORY), delayMs: 800 })
    await page.click('#lsnMake')
    await expect(page.locator('#lsnLoading')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/listen-loading-${scheme}.png` })
    await expect(page.locator('#lsnTitle')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/listen-story-${scheme}.png` })
    await page.click('#lsnShadow')
    await say(page, 'I am hungry')
    await page.locator('#lsnCard').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/listen-card-${scheme}.png` })
    for (let i = 0; i < 4; i++) await page.click('#lsnNext')
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `${SHOTS}/listen-done-${scheme}.png` })
    await page.click('#lsnSave')
    await page.locator('#lsnSaved').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}/listen-saved-${scheme}.png` })
  })
}
