import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { collectErrors, horizontalOverflow, installMocks, lastRec, say, spoken, storageGet } from './helpers'

// 5분 복습 퀴즈: 내 문장 노트의 문장을 라이트너 상자로 다시 꺼내 본다. AI는 부르지 않는다.
// 날짜가 걸려 있어서 한국 시간 2026-10-08 오전 10시에서 시작하는 가짜 시계로 돈다
test.use({ timezoneId: 'Asia/Seoul' })
const NOW = new Date('2026-10-08T10:00:00+09:00')
const QUIZ = 'englishFriend.quiz'

const SENTENCES: [string, string][] = [
  ['I like coffee.', '커피를 좋아해요.'],
  ['See you tomorrow.', '내일 봐요.'],
  ['How was your day?', '오늘 하루 어땠어요?'],
  ['I am a little tired.', '조금 피곤해요.'],
  ['Can you help me?', '도와줄 수 있어요?'],
  ['This is my friend.', '이 사람은 제 친구예요.'],
]
const learnedOf = (list: [string, string][]) => list.map(([en, ko]) => ({ en, ko, date: '2026-10-01' }))
const enOf = (ko: string) => SENTENCES.find((s) => s[1] === ko)?.[0] ?? ''
const koOf = (en: string) => SENTENCES.find((s) => s[0] === en)?.[1] ?? ''
// 순서 맞추기 조각 (앱과 같은 방식으로 문장부호를 뗀다)
const piecesOf = (en: string) => en.split(/\s+/).map((w) => w.replace(/[.,!?]/g, ''))

async function open(page: Page, context: BrowserContext, learned: { en: string; ko: string; date: string }[], extra: Record<string, unknown> = {}) {
  await context.clock.install({ time: NOW })
  const mocks = await installMocks(context, {
    storage: { 'englishFriend.settings': { apiKey: 'K' }, 'englishFriend.learned': learned, ...extra },
  })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  return { ...mocks, errors }
}

const sheet = (page: Page) => page.locator('#quizSheet')
const kindNow = (page: Page) => sheet(page).locator('.qz-q').getAttribute('data-kind')

// 지금 문제의 영어 문장 알아내기: 뜻 고르기는 들려준 소리로, 나머지는 보여 준 한국어 뜻으로
async function currentEn(page: Page, kind: string | null): Promise<string> {
  if (kind === 'meaning') {
    let en = ''
    await expect
      .poll(async () => {
        const said = (await spoken(page)).map((s) => s.text ?? '')
        en = [...said].reverse().find((t) => koOf(t)) ?? ''
        return en
      })
      .not.toBe('')
    return en
  }
  return enOf((await page.locator('#qzPrompt').textContent())?.trim() ?? '')
}

async function clearSpoken(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __spoken: unknown[] }).__spoken = []
  })
}

// 마이크로 말하기
async function speakAnswer(page: Page, text: string) {
  const before = (await lastRec(page))?.count ?? 0
  await page.click('#qzMic')
  await expect.poll(async () => (await lastRec(page))?.count ?? 0).toBe(before + 1)
  await expect(page.locator('#qzMic')).toContainText('듣는 중')
  await say(page, text)
}

// 한 문제를 맞히거나 틀린다. 어떤 문장이었는지 돌려준다
async function answer(page: Page, good: boolean): Promise<{ kind: string; en: string }> {
  const kind = (await kindNow(page)) ?? ''
  const en = await currentEn(page, kind)
  expect(en, '문장을 알아내지 못함').not.toBe('')
  if (kind === 'meaning') {
    const choices = sheet(page).locator('.qz-choice')
    await expect(choices).toHaveCount(3)
    if (good) await choices.filter({ hasText: koOf(en) }).click()
    else await choices.filter({ hasNotText: koOf(en) }).first().click()
  } else if (kind === 'speak') {
    await speakAnswer(page, good ? en.toLowerCase().replace(/[.?!]/g, '') : en.split(' ')[0])
  } else {
    const words = piecesOf(en)
    for (const w of good ? words : words.slice().reverse()) {
      await sheet(page).locator('.qz-pool .qz-piece:not(.used)', { hasText: new RegExp(`^${w}$`) }).first().click()
    }
  }
  const fb = page.locator('#qzFeedback')
  await expect(fb).toBeVisible()
  // 색만이 아니라 아이콘과 글자로도 알린다
  await expect(fb).toHaveClass(good ? /\bok\b/ : /\bbad\b/)
  await expect(fb.locator('.qz-feedback-title svg')).toHaveCount(1)
  await expect(fb.locator('.qz-feedback-title')).toContainText(good ? '맞았어요' : '아쉬워요')
  await expect(page.locator('#qzAnswer')).toHaveText(en)
  return { kind, en }
}

test('퀴즈 끝까지: 세 종류를 맞히고 틀리고, 결과·저장값, 다음 날엔 틀린 것만 다시', async ({ page, context }) => {
  const { errors, requests } = await open(page, context, learnedOf(SENTENCES))
  await page.click('#btnQuiz')
  await expect(sheet(page)).toBeVisible()
  await expect(page.locator('#quizSheet-title')).toHaveText('5분 복습 퀴즈')
  await expect(page.locator('#qzIntro')).toContainText('오늘 볼 문장 6개')
  // 들려준 소리로 문장을 알아내니, 다음 문제로 넘기기 전마다 비운다
  await clearSpoken(page)
  await page.click('#qzStart')

  const done: { kind: string; en: string; good: boolean }[] = []
  for (let i = 0; i < 6; i++) {
    await expect(page.locator('#qzProgress')).toHaveText(`${i + 1}번째 문제 / 모두 6문제`)
    await expect(sheet(page).locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', String(i))
    await expect(page.locator('#qzNext')).toHaveCount(0)
    // 처음 세 문제(세 종류)는 맞히고, 다음 세 문제(세 종류)는 틀린다
    const good = i < 3
    const r = await answer(page, good)
    done.push({ ...r, good })
    await expect(sheet(page).locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', String(i + 1))
    if (r.kind === 'speak' && !good) {
      // 덜 들린 단어를 표시한다
      await expect(page.locator('#qzFeedback .word-marks .wm.miss').first()).toBeVisible()
    }
    if (r.kind !== 'meaning' && !good) {
      // 틀리면 정답 문장을 바로 들려준다
      await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(r.en)
    }
    if (r.kind === 'meaning' && !good) {
      await expect(sheet(page).locator('.qz-choice.right')).toContainText('정답')
      await expect(sheet(page).locator('.qz-choice.wrong')).toContainText('고른 답')
    }
    // 정답 문장 듣기
    await clearSpoken(page)
    await page.click('#qzAnswerPlay')
    await expect.poll(async () => (await spoken(page)).map((s) => s.text)).toContain(r.en)
    expect(await horizontalOverflow(page)).toBe(0)
    await clearSpoken(page)
    await page.click('#qzNext')
  }
  expect(done.map((d) => d.kind).sort()).toEqual(['meaning', 'meaning', 'order', 'order', 'speak', 'speak'])
  for (const k of ['meaning', 'speak', 'order']) {
    expect(done.filter((d) => d.kind === k).map((d) => d.good).sort()).toEqual([false, true])
  }

  await expect(page.locator('#qzResult')).toBeVisible()
  await expect(page.locator('#qzScore')).toHaveText('6문제 중 3개 맞혔어요')
  await expect(page.locator('#qzTomorrow')).toHaveText('내일 다시 볼 문장: 3개')
  await expect(page.locator('.qz-wrong-card')).toHaveCount(3)

  const stats = await storageGet(page, QUIZ)
  for (const d of done) {
    expect(stats[d.en]).toEqual(d.good ? { box: 2, due: '2026-10-10', seen: 1 } : { box: 1, due: '2026-10-09', seen: 1 })
  }
  await page.click('#qzClose')
  await expect(sheet(page)).toHaveCount(0)

  // 오늘은 다 했다
  await page.click('#btnQuiz')
  await expect(page.locator('#qzAllDone')).toContainText('오늘 복습할 문장은 다 봤어요')
  await expect(page.locator('#qzAllDone')).toContainText('10월 9일')
  await page.keyboard.press('Escape')

  // 다음 날: 틀린 세 문장만 다시 나온다
  await context.clock.setSystemTime(new Date('2026-10-09T09:00:00+09:00'))
  await page.reload()
  await expect(page.locator('#startSheet')).toBeVisible()
  await page.click('#btnQuiz')
  await expect(page.locator('#qzIntro')).toContainText('오늘 볼 문장 3개')
  await clearSpoken(page)
  await page.click('#qzStart')
  const again: string[] = []
  for (let i = 0; i < 3; i++) {
    again.push((await answer(page, true)).en)
    await clearSpoken(page)
    await page.click('#qzNext')
  }
  expect(again.sort()).toEqual(done.filter((d) => !d.good).map((d) => d.en).sort())
  await expect(page.locator('#qzScore')).toHaveText('3문제 중 3개 맞혔어요')
  const after = await storageGet(page, QUIZ)
  for (const en of again) expect(after[en]).toEqual({ box: 2, due: '2026-10-11', seen: 2 })
  // 어제 맞힌 것은 그대로
  for (const d of done.filter((x) => x.good)) expect(after[d.en]).toEqual({ box: 2, due: '2026-10-10', seen: 1 })

  expect(requests).toHaveLength(0)
  expect(errors).toEqual([])
})

test('노트가 비면 기본 표현으로 퀴즈를 풀고, 결과는 복습 일정에만 저장되고 노트는 비어 있다', async ({ page, context }) => {
  const { errors, requests } = await open(page, context, [])
  await page.click('#btnQuiz')
  await expect(page.locator('#qzStarterNote')).toHaveText('아직 내 문장 노트가 비어 있어요. 먼저 기본 표현으로 풀어 봐요.')
  await page.click('#qzStart')
  await expect(page.locator('#qzProgress')).toBeVisible()
  // 한 문제 풀기: 뜻 고르기면 첫 보기, 아니면 모르겠어요
  if ((await kindNow(page)) === 'meaning') await sheet(page).locator('.qz-choice').first().click()
  else await page.click('#qzSkip')
  await expect(page.locator('#qzFeedback')).toBeVisible()
  const stats = (await storageGet(page, QUIZ)) as Record<string, { box: number; due: string }>
  const keys = Object.keys(stats)
  expect(keys).toHaveLength(1)
  expect(['Sorry? Can you say that again?', 'Slowly, please.', "I don't know.", 'Thank you.', 'Yes, please.', 'Nice to meet you.', "I'm from Korea.", 'I like coffee.', 'How are you?', 'What does it mean?']).toContain(keys[0])
  // 기본 표현은 노트에 넣지 않는다
  expect((await storageGet(page, 'englishFriend.learned')) ?? []).toEqual([])
  expect(requests).toHaveLength(0)

  // 나중에 같은 문장을 노트에 저장하면: 복습 일정은 이어지고, 문제는 노트 문장만
  const saved = stats[keys[0]]
  await page.evaluate((en) => localStorage.setItem('englishFriend.learned', JSON.stringify([{ en, ko: '뜻', date: '2026-10-08' }])), keys[0])
  await page.reload()
  await page.click('#btnQuiz')
  await expect(page.locator('#qzStarterNote')).toHaveCount(0)
  expect(((await storageGet(page, QUIZ)) as Record<string, unknown>)[keys[0]]).toEqual(saved)
  if (await page.locator('#qzAhead').count()) await page.click('#qzAhead')
  else await page.click('#qzStart')
  await expect(page.locator('#qzProgress')).toHaveText('1번째 문제 / 모두 1문제')
  expect(errors).toEqual([])
})

test('문장이 1~2개뿐이어도 깨지지 않는다 (기본 오답 보기, 입력칸으로 답하기, 모르겠어요)', async ({ page, context }) => {
  const { errors } = await open(page, context, learnedOf(SENTENCES.slice(0, 2)))
  await page.click('#btnQuiz')
  await expect(page.locator('#qzIntro')).toContainText('오늘 볼 문장 2개')
  await page.click('#qzStart')
  const kinds: string[] = []
  for (let i = 0; i < 2; i++) {
    const kind = (await kindNow(page)) ?? ''
    kinds.push(kind)
    const en = await currentEn(page, kind)
    if (kind === 'meaning') {
      // 문장이 둘뿐이라 오답 하나는 다른 문장, 하나는 기본 목록에서
      const choices = sheet(page).locator('.qz-choice')
      await expect(choices).toHaveCount(3)
      const texts = await choices.allTextContents()
      expect(new Set(texts).size).toBe(3)
      await choices.filter({ hasText: koOf(en) }).click()
      await expect(page.locator('#qzFeedback')).toHaveClass(/\bok\b/)
    } else {
      // 마이크 대신 써서 답하기
      await page.fill('#qzInput', en.toLowerCase())
      await page.keyboard.press('Enter')
      await expect(page.locator('#qzFeedback')).toHaveClass(/\bok\b/)
    }
    await page.click('#qzNext')
  }
  expect(kinds).toEqual(['meaning', 'speak'])
  await expect(page.locator('#qzScore')).toHaveText('2문제 중 2개 맞혔어요')
  await expect(page.locator('#qzTomorrow')).toContainText('없어요')
  await page.click('#qzClose')

  // 하나만 있을 때, 오늘 다 했어도 미리 더 풀기 → 모르겠어요
  await page.evaluate(() => {
    localStorage.setItem('englishFriend.learned', JSON.stringify([{ en: 'See you tomorrow.', ko: '내일 봐요.', date: '2026-10-01' }]))
  })
  await page.reload()
  await page.click('#btnQuiz')
  await page.click('#qzAhead')
  await expect(sheet(page).locator('.qz-choice')).toHaveCount(3)
  await sheet(page).locator('.qz-choice', { hasText: '내일 봐요.' }).click()
  await page.click('#qzNext')
  await expect(page.locator('#qzScore')).toHaveText('1문제 중 1개 맞혔어요')
  expect((await storageGet(page, QUIZ))['See you tomorrow.'].box).toBe(3)
  expect(errors).toEqual([])
})

test('말하기에서 모르겠어요를 누르면 틀린 것으로 하고 정답을 보여 준다', async ({ page, context }) => {
  // 첫 문장은 뜻이 없어서 말하기(듣고 따라 말하기)로 나온다
  await open(page, context, [{ en: 'Nice to meet you.', ko: '', date: '2026-10-01' }])
  await page.click('#btnQuiz')
  await page.click('#qzStart')
  expect(await kindNow(page)).toBe('speak')
  await expect(page.locator('#qzSpeakPlay')).toBeVisible()
  await page.click('#qzSkip')
  await expect(page.locator('#qzFeedback')).toHaveClass(/\bbad\b/)
  await expect(page.locator('#qzAnswer')).toHaveText('Nice to meet you.')
  await page.click('#qzNext')
  await expect(page.locator('#qzTomorrow')).toHaveText('내일 다시 볼 문장: 1개')
  expect((await storageGet(page, QUIZ))['Nice to meet you.']).toEqual({ box: 1, due: '2026-10-09', seen: 1 })
})
