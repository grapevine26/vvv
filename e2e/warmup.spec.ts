import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { aiBubbles, clearSpoken, collectErrors, horizontalOverflow, installMocks, lastRec, reply, say, spoken, turn } from './helpers'

// 대화 전 2분 연습: 오늘 단원의 문장 틀을 듣고 → 따라 말하고 → 단어를 바꿔 말한 뒤 대화를 시작한다.
// 연습 중에는 AI를 부르지 않는다 (마이크 결과는 문장 비교만).

const K = { settings: 'englishFriend.settings', progress: 'englishFriend.progress' }

async function open(context: BrowserContext, page: Page, progress?: Record<string, unknown>) {
  const storage: Record<string, unknown> = { [K.settings]: { apiKey: 'K' } }
  if (progress) storage[K.progress] = progress
  const mocks = await installMocks(context, { storage })
  await page.goto('/')
  await page.click('#btnWarmup')
  await expect(page.locator('#warmupSheet')).toBeVisible()
  return mocks
}

const spokenTexts = async (page: Page) => (await spoken(page)).map((s) => s.text)

test('1단계 첫 단원: 듣기 → 따라 말하기 → 단어 바꿔 말하기 → 끝까지 → 대화 시작', async ({ context, page }) => {
  const errors = collectErrors(page)
  const mocks = await open(context, page)
  const sheet = page.locator('#warmupSheet')

  await expect(sheet).toContainText('인사와 자기소개')
  await expect(page.locator('#wuProgress')).toContainText('1 / 3')
  await expect(page.locator('#wuFrame')).toContainText("Hi, I'm")
  await expect(page.locator('#wuFrame')).toContainText('안녕, 나는 ○○야.')
  expect(await horizontalOverflow(page)).toBe(0)

  // ① 듣기: 예문을 소리로 들려준다
  await expect(page.locator('#wuListen')).toContainText("Hi, I'm Minsu.")
  await expect(page.locator('#wuListen')).toContainText('안녕, 나는 민수야.')
  await expect(page.locator('#btnWarmupNext')).toHaveClass(/secondary/)
  await page.locator('#wuListen').getByRole('button', { name: "Hi, I'm Minsu. 듣기" }).click()
  await expect.poll(() => spokenTexts(page)).toContain("Hi, I'm Minsu.")
  // 들었으면 '다음'이 앞으로 나온다
  await expect(page.locator('#btnWarmupNext')).toHaveClass(/primary/)
  await expect(page.locator('#btnWarmupNext')).toContainText('다음: 따라 말하기')
  await page.click('#btnWarmupNext')

  // ② 따라 말하기: 덜 들린 단어 표시 → 다시 해서 칭찬
  const sayCard = page.locator('#wuSay')
  await expect(sayCard).toBeVisible()
  await sayCard.getByRole('button', { name: '따라 말하기' }).click()
  await expect.poll(() => lastRec(page)).toMatchObject({ lang: 'en-US', started: true })
  await expect(sayCard.locator('.wu-mic')).toContainText('듣는 중')
  await say(page, 'hi I am')
  await expect(sayCard.locator('.wm.miss')).toHaveText([/^Minsu\./])
  await expect(sayCard).toContainText('이렇게 들렸어요')
  await expect(sayCard.locator('.wu-mic')).toContainText('따라 말하기')
  await sayCard.getByRole('button', { name: '따라 말하기' }).click()
  await say(page, "Hi I'm Minsu")
  await expect(sayCard).toContainText('잘 들렸어요')
  await expect(sayCard.locator('.word-marks')).toHaveCount(0)
  await expect(page.locator('#btnWarmupNext')).toContainText('다음: 바꿔 말하기')
  await page.click('#btnWarmupNext')

  // ③ 단어 바꿔 말하기: 칩을 누르면 바뀐 문장을 들려주고, 말해 보면 칩에 체크
  const swap = page.locator('#wuSwap')
  await expect(swap.locator('.wu-chip')).toHaveCount(2)
  await expect(page.locator('#wuSwapCount')).toHaveText('2개 중 0개 해 봤어요.')
  await clearSpoken(page)
  await swap.getByRole('button', { name: /Jiyoung/ }).click()
  await expect.poll(() => spokenTexts(page)).toContain("Hi, I'm Jiyoung.")
  await expect(swap.locator('.wu-swapped')).toContainText('안녕, 나는 지영이야.')
  await swap.getByRole('button', { name: '말해 보기' }).click()
  await say(page, "hi I'm Jiyoung")
  await expect(swap).toContainText('잘 들렸어요')
  await expect(page.locator('#wuSwapCount')).toHaveText('2개 중 1개 해 봤어요.')
  await expect(page.locator('#btnWarmupNext')).toHaveClass(/secondary/)
  await swap.getByRole('button', { name: /Tom/ }).click()
  await expect(swap.locator('.wu-result')).toHaveCount(0)
  await swap.getByRole('button', { name: '말해 보기' }).click()
  await say(page, 'hi I am')
  await expect(swap.locator('.wm.miss')).toHaveText([/^Tom\./])
  await expect(page.locator('#wuSwapCount')).toContainText('다 바꿔 말해 봤어요')
  await expect(swap.locator('.wu-chip.done')).toHaveCount(2)
  await expect(page.locator('#btnWarmupNext')).toHaveClass(/primary/)
  await expect(page.locator('#btnWarmupNext')).toContainText('다음 문장 틀')
  await page.click('#btnWarmupNext')

  // 두 번째 틀은 빈칸 없는 고정 표현: 듣기·따라 말하기만
  await expect(page.locator('#wuProgress')).toContainText('2 / 3')
  await expect(page.locator('#wuFrame')).toContainText('통째로 외우는 말')
  await expect(page.locator('#wuProgress li')).toHaveCount(2)
  await page.click('#btnWarmupNext')
  await expect(page.locator('#btnWarmupNext')).toContainText('다음 문장 틀')
  await page.click('#btnWarmupNext')

  // 세 번째 틀
  await expect(page.locator('#wuProgress')).toContainText('3 / 3')
  await expect(page.locator('#wuListen')).toContainText("I'm from Korea.")
  await page.click('#btnWarmupNext')
  await page.click('#btnWarmupNext')
  await expect(page.locator('#btnWarmupNext')).toContainText('연습 마치기')
  await page.click('#btnWarmupNext')

  // 끝: 대화에서 써 보라는 안내와 대화 시작
  await expect(page.locator('#wuDone')).toContainText('이제 대화에서 써 봐요')
  await expect(page.locator('#wuDone li')).toHaveCount(3)
  await expect(page.locator('#btnWarmupSkip')).toHaveCount(0)
  // 연습하는 동안 AI는 한 번도 부르지 않았다
  expect(mocks.requests).toHaveLength(0)

  mocks.queue.push(reply(turn({ say: "Hi! I'm Emma. What's your name?", say_ko: '안녕! 나는 Emma야. 이름이 뭐야?' })))
  await page.click('#btnWarmupDone')
  await expect(page.locator('#warmupSheet')).toHaveCount(0)
  await expect(aiBubbles(page)).toHaveCount(1)
  expect(mocks.requests).toHaveLength(1)
  expect(errors).toEqual([])
})

test('3단계 단원: focus의 표현을 그대로 외우는 말로 연습한다', async ({ context, page }) => {
  const errors = collectErrors(page)
  const mocks = await open(context, page, { stage: 3, unit: 's3-3', doneUnits: [], sessions: [], days: {} })
  await expect(page.locator('#warmupSheet')).toContainText('전화로 예약하기')
  await expect(page.locator('#wuProgress')).toContainText('1 / 3')
  await expect(page.locator('#wuFrame')).toContainText('자주 쓰는 말')
  await expect(page.locator('#wuFrame')).toContainText("I'd like to book")
  await expect(page.locator('#wuFrame .wu-blank')).toHaveCount(1)
  await expect(page.locator('#wuFrame')).toContainText('빈칸에는 하고 싶은 말')
  await expect(page.locator('#wuProgress li')).toHaveCount(2)

  // 빈칸은 빼고 읽는다
  await page.locator('#wuListen').getByRole('button', { name: "I'd like to book. 듣기" }).click()
  await expect.poll(() => spokenTexts(page)).toContain("I'd like to book.")
  await page.click('#btnWarmupNext')
  await page.locator('#wuSay').getByRole('button', { name: '따라 말하기' }).click()
  await say(page, "I'd like to book a table")
  await expect(page.locator('#wuSay')).toContainText('잘 들렸어요')
  await page.click('#btnWarmupNext')
  await expect(page.locator('#wuProgress')).toContainText('2 / 3')
  await expect(page.locator('#wuFrame')).toContainText('Is')
  await expect(page.locator('#wuFrame')).toContainText('available?')
  expect(mocks.requests).toHaveLength(0)
  expect(errors).toEqual([])
})

test('건너뛰기: 바로 대화하기를 누르면 연습 없이 대화가 시작된다', async ({ context, page }) => {
  const mocks = await open(context, page)
  await expect(page.locator('#btnWarmupDone')).toHaveCount(0)
  mocks.queue.push(reply(turn({ say: 'Hi! How are you?', say_ko: '안녕! 잘 지내?' })))
  await page.click('#btnWarmupSkip')
  await expect(page.locator('#warmupSheet')).toHaveCount(0)
  await expect(aiBubbles(page)).toHaveCount(1)
  expect(mocks.requests).toHaveLength(1)
})

test('닫기(✕)를 누르면 시작 화면으로 돌아간다', async ({ context, page }) => {
  const mocks = await open(context, page)
  await page.locator('#warmupSheet').getByRole('button', { name: '닫기' }).click()
  await expect(page.locator('#warmupSheet')).toHaveCount(0)
  await expect(page.locator('#btnWarmup')).toBeFocused()
  expect(mocks.requests).toHaveLength(0)
})
