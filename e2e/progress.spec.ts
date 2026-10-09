import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { collectErrors, horizontalOverflow, installMocks } from './helpers'

// 이번 주 기록 화면: 요약 숫자, 7일 막대(목표선·오늘 강조·값), 6주 '영어로 스스로 대답한 비율', 표, 기록 없음 안내.
// 한국 시간 2026-10-08(목) 오전 10시 가짜 시계에서 돈다. 이번 주는 10/5(월)부터.

test.use({ timezoneId: 'Asia/Seoul' })

const NOW = new Date('2026-10-08T10:00:00+09:00')
const SHOTS = '/tmp/claude-0/-home-user-vvv/7bab918b-2504-5552-92a0-e06f0319c269/scratchpad/feat-shots'

let seq = 0
const log = (date: string, extra: Record<string, number> = {}) => ({
  id: `00seed${String(++seq).padStart(4, '0')}`,
  date,
  stage: 1,
  unit: 's1-1',
  minutes: 10,
  turns: 6,
  koTurns: 0,
  enOwnTurns: 0,
  enOwnWords: 0,
  repeatTurns: 0,
  ...extra,
})

// 지난주(9/28~)는 한국어가 많고, 이번 주는 영어로 스스로 대답한 게 늘었다
const SESSIONS = [
  log('2026-09-15', { minutes: 6, enOwnTurns: 1, koTurns: 4, enOwnWords: 2 }),
  log('2026-09-29', { minutes: 10, enOwnTurns: 2, koTurns: 6, enOwnWords: 4, repeatTurns: 2 }),
  log('2026-10-01', { minutes: 12, enOwnTurns: 2, koTurns: 2, enOwnWords: 4 }),
  log('2026-10-05', { minutes: 15, enOwnTurns: 6, koTurns: 2, enOwnWords: 18, repeatTurns: 3 }),
  log('2026-10-07', { minutes: 5, enOwnTurns: 3, koTurns: 1, enOwnWords: 9, repeatTurns: 1 }),
  log('2026-10-08', { minutes: 20, enOwnTurns: 3, koTurns: 1, enOwnWords: 9 }),
]
const PROGRESS = { stage: 1, unit: 's1-1', doneUnits: [], sessions: SESSIONS, days: { '2026-10-02': 8 } }

async function open(page: Page, context: BrowserContext, progress?: unknown, colorScheme: 'light' | 'dark' = 'light') {
  await page.emulateMedia({ colorScheme })
  await context.clock.install({ time: NOW })
  const storage: Record<string, unknown> = { 'englishFriend.settings': { apiKey: 'K', minutes: 15 } }
  if (progress) storage['englishFriend.progress'] = progress
  await installMocks(context, { storage })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  await page.click('#tab-library')
  await page.click('#btnProgress')
  await expect(page.locator('#progressSheet')).toBeVisible()
  // 누른 자리에 남은 마우스가 막대 위에 올라가 '자세히 보기'를 바꾸지 않게 치운다
  await page.mouse.move(0, 0)
  return errors
}

const barHeight = async (page: Page, sel: string) => (await page.locator(sel).boundingBox())?.height ?? -1

test('여러 날 기록: 요약 숫자, 7일 막대 높이·목표선, 6주 비율, 표, 비교 문구', async ({ page, context }) => {
  const errors = await open(page, context, PROGRESS)
  const sheet = page.locator('#progressSheet')
  await expect(sheet.locator('#pgEmpty')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/progress-light.png`, animations: 'disabled' })

  // 이번 주: 10/5 15분 + 10/7 5분 + 10/8 20분 = 40분, 3일. 연속: 10/7·10/8 = 2일
  await expect(page.locator('#pgWeekMin')).toHaveText('40분')
  await expect(page.locator('#pgWeekDays')).toHaveText('3일')
  await expect(page.locator('#pgStreak')).toHaveText('2일')
  // 지난주 33%(4/12) → 이번 주 75%(12/16)
  await expect(page.locator('#pgCompare')).toHaveText('지난주보다 영어로 스스로 대답한 비율이 42%p 올랐어요. 정말 잘하고 있어요!')

  // 7일 막대: 10/2(금) ~ 10/8(목, 오늘)
  const cols = page.locator('#pgDayChart .pg-col')
  await expect(cols).toHaveCount(7)
  await expect(page.locator('#pgDayChart .pg-val')).toHaveText(['8', '0', '0', '15', '0', '5', '20'])
  await expect(page.locator('.pg-x').first()).toHaveText('금토일월화수오늘')
  await expect(cols.last()).toHaveClass(/pg-now/)
  await expect(page.locator('#pgDayChart .pg-col.pg-now')).toHaveCount(1)
  // 막대 높이는 분에 비례 (가장 큰 값 20분 = 칸 전체)
  const area = (await page.locator('#pgDayChart').boundingBox())!.height
  const h20 = await barHeight(page, '#pgDayChart .pg-col[data-date="2026-10-08"] .pg-bar')
  const h15 = await barHeight(page, '#pgDayChart .pg-col[data-date="2026-10-05"] .pg-bar')
  const h5 = await barHeight(page, '#pgDayChart .pg-col[data-date="2026-10-07"] .pg-bar')
  expect(h20).toBeGreaterThan(area * 0.95)
  expect(h15 / h20).toBeCloseTo(0.75, 1)
  expect(h5 / h20).toBeCloseTo(0.25, 1)
  expect(await barHeight(page, '#pgDayChart .pg-col[data-date="2026-10-04"] .pg-bar')).toBeLessThan(1)
  // 목표선 15분 = 15분 막대의 꼭대기 높이
  const bar15 = (await page.locator('#pgDayChart .pg-col[data-date="2026-10-05"] .pg-bar').boundingBox())!
  const goal = (await page.locator('#pgGoalLine').boundingBox())!
  expect(Math.abs(goal.y + goal.height - bar15.y)).toBeLessThan(1.5)
  await expect(page.locator('.pg-legend')).toContainText('목표 15분')

  // 기본은 오늘을 자세히, 다른 날을 누르면 그날을 보여 준다
  await expect(page.locator('#pgDayReadout')).toHaveText('오늘 목요일 10/8 · 20분 · 목표 달성')
  await page.locator('#pgDayChart .pg-col[data-date="2026-10-07"]').click()
  await expect(page.locator('#pgDayReadout')).toHaveText('수요일 10/7 · 5분 · 목표 15분')
  await expect(page.locator('#pgDayChart .pg-col[data-date="2026-10-07"]')).toHaveAttribute('aria-pressed', 'true')

  // 6주 비율: 8/31, 9/7, 9/14(20%), 9/21, 지난주(33%), 이번 주(75%)
  await expect(page.locator('#pgWeekChart .pg-val')).toHaveText(['-', '-', '20%', '-', '33%', '75%'])
  const wArea = (await page.locator('#pgWeekChart').boundingBox())!.height
  const w75 = await barHeight(page, '#pgWeekChart .pg-col[data-week="2026-10-05"] .pg-bar')
  const w33 = await barHeight(page, '#pgWeekChart .pg-col[data-week="2026-09-28"] .pg-bar')
  expect(w75 / wArea).toBeCloseTo(0.75, 1)
  expect(w33 / wArea).toBeCloseTo(0.333, 1)
  await expect(page.locator('#pgWeekReadout')).toHaveText('이번 주 · 75% (영어 12번, 한국어 4번)')

  // 표: 최근 주가 맨 위. 이번 주 3일·40분·75%·3.0단어·4번 / 지난주 3일(9/29, 10/1, 10/2)·30분·33%·2.0단어·2번
  const rows = page.locator('#pgTable tbody tr')
  await expect(rows).toHaveCount(6)
  await expect(rows.nth(0).locator('th, td')).toHaveText(['이번 주', '3일', '40분', '75%', '3.0단어', '4번'])
  await expect(rows.nth(1).locator('th, td')).toHaveText(['지난주', '3일', '30분', '33%', '2.0단어', '2번'])
  await expect(rows.nth(3).locator('th, td')).toHaveText(['9/14~', '1일', '6분', '20%', '2.0단어', '0번'])
  await expect(rows.nth(5).locator('th, td')).toHaveText(['8/31~', '0일', '0분', '-', '-', '0번'])

  // 누르는 것은 모두 44px 이상, 가로로 넘치지 않음
  for (const b of await page.locator('#progressSheet button').all()) {
    const box = (await b.boundingBox())!
    expect(box.width).toBeGreaterThanOrEqual(44)
    expect(box.height).toBeGreaterThanOrEqual(44)
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

  await page.locator('#pgTable').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/progress-light-2.png`, animations: 'disabled' })

  // 닫기 → 시작 화면, 연 버튼으로 포커스가 돌아간다
  await page.click('#btnProgressClose')
  await expect(page.locator('#progressSheet')).toHaveCount(0)
  await expect(page.locator('#btnProgress')).toBeFocused()
  expect(errors).toEqual([])
})

test('기록이 없으면 안내만 보여 준다', async ({ page, context }) => {
  const errors = await open(page, context)
  await expect(page.locator('#pgEmpty')).toBeVisible()
  await expect(page.locator('#pgEmpty')).toContainText('아직 기록이 없어요')
  await expect(page.locator('#pgEmpty')).toContainText('저장하고 끝내기')
  await expect(page.locator('#pgDayChart')).toHaveCount(0)
  await expect(page.locator('#pgTable')).toHaveCount(0)
  await page.screenshot({ path: `${SHOTS}/progress-empty.png`, animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(page.locator('#progressSheet')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('이번 주에 아직 안 했으면 부담 없는 격려, 어두운 화면', async ({ page, context }) => {
  // 지난주만 기록이 있다 (이번 주 0분)
  const errors = await open(page, context, { ...PROGRESS, sessions: SESSIONS.slice(0, 3), days: {} }, 'dark')
  await expect(page.locator('#pgWeekMin')).toHaveText('0분')
  await expect(page.locator('#pgStreak')).toHaveText('0일')
  await expect(page.locator('#pgCompare')).toHaveText('이번 주는 아직 쉬는 중이에요. 오늘 5분만 해 볼까요?')
  await expect(page.locator('#pgDayReadout')).toHaveText('오늘 목요일 10/8 · 0분 · 목표 15분')
  await page.screenshot({ path: `${SHOTS}/progress-dark-quiet.png`, animations: 'disabled' })
  expect(errors).toEqual([])
})

test('어두운 화면 (여러 날 기록)', async ({ page, context }) => {
  const errors = await open(page, context, PROGRESS, 'dark')
  await expect(page.locator('#pgWeekMin')).toHaveText('40분')
  // 오늘 막대는 진한 강조색, 다른 날은 옅게
  const [today, other] = await Promise.all(
    ['2026-10-08', '2026-10-05'].map((d) =>
      page.locator(`#pgDayChart .pg-col[data-date="${d}"] .pg-bar`).evaluate((el) => getComputedStyle(el).backgroundColor),
    ),
  )
  expect(today).not.toBe(other)
  await page.screenshot({ path: `${SHOTS}/progress-dark.png`, animations: 'disabled' })
  await page.locator('#pgTable').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${SHOTS}/progress-dark-2.png`, animations: 'disabled' })
  expect(errors).toEqual([])
})
