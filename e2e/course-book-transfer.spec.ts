import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { gunzipSync } from 'node:zlib'
import {
  aiBubbles,
  clearSpoken,
  collectErrors,
  installMocks,
  lastUserText,
  reply,
  say,
  spoken,
  startWithGreeting,
  storageGet,
  systemText,
  turn,
  type MockReply,
} from './helpers'

// 교육과정(단원 마치기·승급·단원/단계 고르기·단계별 지시문), 내 문장 노트(목록·더 보기·복습·지우기·[복습] 지시문),
// 폰↔PC 옮기기(내보내기·가져오기·병합·키 안내·잘못된 코드), 시트 공통(Esc·✕·배경·포커스·inert).
// 날짜가 걸린 계산(오늘 단원 완료, 복습 고르기)이 있어서 한국 시간 2026-10-08 오전 10시에서 시작하는 가짜 시계로 돈다 (시계는 저절로 흐른다).

test.use({ timezoneId: 'Asia/Seoul' })

const NOW = new Date('2026-10-08T10:00:00+09:00')
const TODAY = '2026-10-08'
// 오늘에서 며칠 앞뒤의 날짜 ('YYYY-MM-DD')
const day = (offset: number) => new Date(Date.UTC(2026, 9, 8 + offset)).toISOString().slice(0, 10)

const K = {
  settings: 'englishFriend.settings',
  learned: 'englishFriend.learned',
  progress: 'englishFriend.progress',
}

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
interface Learned {
  en: string
  ko: string
  date: string
}

// 지난 대화 기록 하나. id는 실제 기록(시각 기반)보다 앞에 정렬되게 '00'으로 시작
let seq = 0
const log = (date: string, extra: Partial<SessionLogLike> = {}): SessionLogLike => ({
  id: `00seed${String(++seq).padStart(4, '0')}`,
  date,
  stage: 1,
  unit: 's1-1',
  minutes: 10,
  turns: 6,
  koTurns: 0,
  enOwnTurns: 6,
  enOwnWords: 24,
  repeatTurns: 0,
  ...extra,
})
const S1_ALL = Array.from({ length: 10 }, (_, i) => `s1-${i + 1}`)

interface OpenOptions {
  // null이면 설정(키)을 넣지 않는다
  settings?: Record<string, unknown> | null
  storage?: Record<string, unknown>
}

// 가짜 시계·AI·마이크를 깔고(기본: 키 있음) 시작 화면을 연다
async function open(page: Page, context: BrowserContext, opts: OpenOptions = {}) {
  await context.clock.install({ time: NOW })
  const storage: Record<string, unknown> = { ...opts.storage }
  if (opts.settings !== null) storage[K.settings] = { apiKey: 'K', ...opts.settings }
  const mocks = await installMocks(context, { storage })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#startSheet')).toBeVisible()
  return { ...mocks, errors }
}

// 다른 기기(B) 흉내: 새 context
async function openOtherDevice(browser: Browser, baseURL: string | undefined, opts: OpenOptions = {}) {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' })
  const page = await context.newPage()
  const r = await open(page, context, opts)
  return { context, page, ...r }
}

type How = 'type' | 'en' | 'ko'
// 내 말 하나 보내고 AI 답 하나 받기. how: 입력칸(type) / EN 마이크 / 한 마이크
async function exchange(
  page: Page,
  queue: MockReply[],
  said: string,
  ai: Record<string, unknown> = { say: 'Nice!', say_ko: '좋아!' },
  how: How = 'type',
) {
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

// 다음에 뜨는 확인 창을 받거나 거절하고, 그 문구를 돌려준다
const nextDialog = (page: Page, accept: boolean) =>
  new Promise<string>((resolve) => {
    page.once('dialog', async (d) => {
      const m = d.message()
      if (accept) await d.accept()
      else await d.dismiss()
      resolve(m)
    })
  })

const progressIn = async (page: Page) => (await storageGet(page, K.progress)) as ProgressLike | null
const settingsIn = async (page: Page) => (await storageGet(page, K.settings)) as Record<string, unknown>
const learnedIn = async (page: Page) => ((await storageGet(page, K.learned)) as Learned[] | null) ?? []

// 옮기기 코드 풀기 (EF1. = gzip, EF0. = 그대로)
const decodeCode = (code: string) => {
  const body = Buffer.from(code.slice(4), 'base64url')
  return JSON.parse((code.startsWith('EF1.') ? gunzipSync(body) : body).toString('utf8'))
}
// 압축 없는 코드 만들기 (압축을 못 하는 브라우저가 내보낸 것과 같은 모양)
const plainCode = (obj: unknown) => 'EF0.' + Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url')

// 복습 고르기를 확인하기 좋은 내 문장 노트: 배운 지 60·45·30·20·14·10·7·5·3·2·1·0·0·0일
// pickReview(n=8) → 최근 3개 + 1·3·7·14·30일쯤 된 것 5개 = 정확히 8개가 정해진다
const SPACED_AGES = [60, 45, 30, 20, 14, 10, 7, 5, 3, 2, 1, 0, 0, 0]
const SPACED: Learned[] = SPACED_AGES.map((age, i) => ({ en: `Spaced ${i + 1} (${age}d).`, ko: `간격 ${i + 1}`, date: day(-age) }))
const SPACED_PICK = [2, 4, 6, 8, 10, 11, 12, 13].map((i) => SPACED[i])

// ─────────────────────────────────────────────
// 1) 단원 마치기
// ─────────────────────────────────────────────

test.describe('1) 단원 마치기', () => {
  test('영어로 스스로 5번 대답 → 단원 조건 토스트·"단원 ✓" → 저장하면 doneUnits에 들어가고 다음 단원으로, 다음 대화도 그 단원', async ({
    page,
    context,
  }) => {
    const { queue, requests, errors } = await open(page, context)
    await expect(page.locator('#courseCard .hero-title')).toHaveText('인사와 자기소개')
    await startWithGreeting(page, queue, { say: "Hi! I'm Emma. What's your name?", say_ko: '안녕! 난 Emma야. 이름이 뭐야?' })
    expect(systemText(requests[0])).toContain('[오늘 단원] 인사와 자기소개')
    // 내 문장 노트가 비어 있으면 [복습]은 없다
    expect(systemText(requests[0])).not.toContain('[복습]')

    const answers: [string, How][] = [
      ['My name is Tom', 'type'],
      ['I am from Seoul', 'en'],
      ['I like coffee', 'type'],
      ['I work at a bank', 'en'],
    ]
    for (const [i, [said, how]] of answers.entries()) {
      await exchange(page, queue, said, { say: 'Cool! Tell me more.', say_ko: '멋지다! 더 말해 줘.' }, how)
      await expect(page.locator('#turnCount')).toHaveText(`${i + 1}/5 턴 완료`)
    }
    // 4번째까지는 단원 토스트가 없다
    await expect(page.locator('#toast.show')).toHaveCount(0)

    await exchange(page, queue, 'Nice to meet you too', { say: 'Nice to meet you!', say_ko: '만나서 반가워!' })
    await expect(page.locator('#toast')).toHaveText('「인사와 자기소개」 단원 조건을 채웠어요! 더 이야기해도 좋아요.')
    await expect(page.locator('#turnCount')).toHaveText('단원 ✓')
    // 모두 '[영어]'(스스로 한 영어 대답)로 보냈다
    expect(requests.slice(1).map(lastUserText)).toEqual([
      '[영어] My name is Tom',
      '[영어] I am from Seoul',
      '[영어] I like coffee',
      '[영어] I work at a bank',
      '[영어] Nice to meet you too',
    ])

    // 마무리: 조건 채움 안내, '저장하고 끝내기'를 앞세움
    await page.click('#btnEnd')
    await expect(page.locator('#wrapUnitStatus')).toHaveText('「인사와 자기소개」 단원 조건을 채웠어요 ✓ 저장하면 다음 단원으로 넘어가요.')
    await expect(page.locator('#wrapUnitStatus')).toHaveClass(/good/)
    await expect(page.locator('#btnFinish')).toHaveClass(/primary/)
    await page.click('#btnFinish')

    await expect(page.locator('#startMsg')).toContainText('「인사와 자기소개」 단원을 마쳤어요.')
    const p = await progressIn(page)
    expect(p?.doneUnits).toEqual(['s1-1'])
    expect(p?.unit).toBe('s1-2')
    expect(p?.stage).toBe(1)
    expect(p?.sessions).toHaveLength(1)
    // 4+4+3+5+5 = 21단어
    expect(p?.sessions[0]).toMatchObject({
      date: TODAY,
      stage: 1,
      unit: 's1-1',
      turns: 5,
      koTurns: 0,
      repeatTurns: 0,
      enOwnTurns: 5,
      enOwnWords: 21,
    })

    // 시작 화면 교육과정 카드: 완료 1/10, 오늘 하나 끝냈으니 '다음 단원 2'
    await expect(page.locator('#courseCard .hero-meta')).toContainText('1단계 · 첫걸음 · 완료 1/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('오늘 기분')
    await expect(page.locator('#courseCard .hero-focus')).toHaveText('"I\'m tired." / "I\'m happy." / "I\'m so-so."')
    await expect(page.locator('#courseCard .ok-text').first()).toHaveText('오늘 단원 완료 ✓')
    // 승급까지 진행: 단원은 모자라고 비율·길이는 채움
    await expect(page.locator('#promoProgress .muted')).toHaveText('다음 단계까지: 단원 1개/10개 · ✓ 영어 대답 100%/50% · ✓ 평균 길이 4.2단어/3단어')
    await expect(page.locator('#promoProgress .muted .ok-text')).toHaveCount(2)

    // 다음 대화는 '오늘 기분' 단원으로
    await startWithGreeting(page, queue)
    const last = requests[requests.length - 1]
    expect(systemText(last)).toContain('[오늘 단원] 오늘 기분')
    expect(systemText(last)).toContain('- 연습할 표현: "I\'m tired." / "I\'m happy." / "I\'m so-so."')
    expect(lastUserText(last)).toBe('[대화 시작] 먼저 짧게 인사하고, 오늘 단원 「오늘 기분」 주제로 첫 질문 하나만 해.')
    await expect(page.locator('#turnCount')).toHaveText('0/5 턴 완료')
    expect(errors).toEqual([])
  })

  test('한국어 대답·따라 말하기·대답 예시 칩 읽기는 「스스로 한 영어 대답」으로 세지 않는다 (승급 기준 0%)', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await startWithGreeting(page, queue, {
      say: 'Hi! How are you?',
      say_ko: '안녕! 잘 지내?',
      cue: '따라 해 볼까요?',
      repeat: "I'm fine.",
      repeat_ko: '난 괜찮아.',
    })
    // 1: 따라 말하기
    await exchange(
      page,
      queue,
      "I'm fine",
      {
        say: 'What food do you like?',
        say_ko: '무슨 음식 좋아해?',
        hints: [
          { en: 'I like pizza.', ko: '피자 좋아해.' },
          { en: 'I like rice.', ko: '밥 좋아해.' },
        ],
      },
      'en',
    )
    // 2: 대답 예시 칩 문장을 그대로 읽기
    await exchange(page, queue, 'I like pizza', { say: 'Yum! How was your day?', say_ko: '맛있지! 오늘 하루 어땠어?' }, 'en')
    // 3: 한국어 마이크
    await exchange(
      page,
      queue,
      '오늘 너무 피곤했어',
      { say: 'Oh no!', say_ko: '저런!', cue: '이렇게 말해 보세요', repeat: "I'm so tired.", repeat_ko: '너무 피곤해.' },
      'ko',
    )
    // 4: 따라 말하기
    await exchange(page, queue, "I'm so tired", { say: 'Rest well.', say_ko: '푹 쉬어.' }, 'en')
    // 5: 한국어 입력
    await exchange(page, queue, '고마워', { say: "You're welcome!", say_ko: '천만에!' }, 'type')

    expect(requests.slice(1).map(lastUserText)).toEqual([
      '[따라 말하기 — 목표 문장: "I\'m fine."] I\'m fine',
      '[영어 — 대답 예시를 보고 말함] I like pizza',
      '[한국어] 오늘 너무 피곤했어',
      '[따라 말하기 — 목표 문장: "I\'m so tired."] I\'m so tired',
      '[한국어] 고마워',
    ])
    // 주의: 이 대화로 단원을 마친 것으로 칠지(토스트·doneUnits)는 앱 설계가 '주고받은 횟수' 기준이라 여기서 단언하지 않는다 (보고서 참고)

    await page.click('#btnEnd')
    await page.click('#btnFinish')
    await expect(page.locator('#startSheet')).toBeVisible()
    const p = await progressIn(page)
    expect(p?.sessions).toHaveLength(1)
    expect(p?.sessions[0]).toMatchObject({ turns: 5, koTurns: 2, repeatTurns: 3, enOwnTurns: 0, enOwnWords: 0 })
    // 승급 기준의 '영어 대답' 비율·길이는 0
    const promo = page.locator('#promoProgress .muted')
    await expect(promo).toContainText('영어 대답 0%/50%')
    await expect(promo).toContainText('평균 길이 0.0단어/3단어')
    await expect(promo.locator('.ok-text')).toHaveCount(0)
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    await expect(page.locator('#criteria li').nth(1)).toHaveText('○ 영어로 스스로 대답한 비율 (최근 대화): 0% / 목표 50%')
    await expect(page.locator('#criteria li').nth(2)).toHaveText('○ 영어 대답 평균 길이 (최근 대화): 0.0단어 / 목표 3단어')
    await expect(page.locator('#btnPromote')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 2) 시작 화면 교육과정 카드
// ─────────────────────────────────────────────

test.describe('2) 시작 화면 #courseCard·#promoProgress', () => {
  test('처음이면 1단계 첫 단원과 연습 표현만 보이고, 승급 진행 줄은 없다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await expect(page.locator('#courseCard .hero-meta')).toContainText('1단계 · 첫걸음 · 완료 0/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('인사와 자기소개')
    await expect(page.locator('#courseCard .hero-focus')).toHaveText('"Hi, I\'m ~." / "Nice to meet you." / "I\'m from Korea."')
    await expect(page.locator('#promoProgress')).toHaveCount(0)
    await expect(page.locator('#btnPromoteStart')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  const cases: {
    name: string
    progress: ProgressLike
    stage: string
    unit: string
    promo: string
    okCount: number
    tip: string
  }[] = [
    {
      name: '단원이 모자라면',
      progress: {
        stage: 1,
        unit: 's1-3',
        doneUnits: ['s1-1', 's1-2'],
        sessions: [
          log(day(-2), { turns: 4, koTurns: 3, enOwnTurns: 1, enOwnWords: 2 }),
          log(day(-1), { turns: 6, koTurns: 2, enOwnTurns: 3, enOwnWords: 6 }),
        ],
      },
      stage: '1단계 · 첫걸음 · 완료 2/10',
      unit: '오늘 단원 3 · 좋아하는 음식',
      // 영어 4번, 한국어 5번 → 44%, 8단어/4번 → 2.0
      promo: '다음 단계까지: 단원 2개/10개 · 영어 대답 44%/50% · 평균 길이 2.0단어/3단어',
      okCount: 0,
      tip: '오늘 단원을 끝까지 해 봐요.',
    },
    {
      name: '단원은 다 했고 영어 대답 비율이 모자라면',
      progress: { stage: 1, unit: 's1-1', doneUnits: S1_ALL, sessions: [log(day(-1), { koTurns: 3, enOwnTurns: 2, enOwnWords: 8 })] },
      stage: '1단계 · 첫걸음 · 완료 10/10',
      unit: '오늘 단원 1 · 인사와 자기소개',
      promo: '다음 단계까지: ✓ 단원 10개/10개 · 영어 대답 40%/50% · ✓ 평균 길이 4.0단어/3단어',
      okCount: 2,
      tip: '한국어 대신 EN 버튼으로 스스로 대답해 보세요. 짧아도 괜찮아요.',
    },
    {
      name: '대답 길이만 모자라면',
      progress: { stage: 1, unit: 's1-1', doneUnits: S1_ALL, sessions: [log(day(-1), { koTurns: 0, enOwnTurns: 5, enOwnWords: 10 })] },
      stage: '1단계 · 첫걸음 · 완료 10/10',
      unit: '오늘 단원 1 · 인사와 자기소개',
      promo: '다음 단계까지: ✓ 단원 10개/10개 · ✓ 영어 대답 100%/50% · 평균 길이 2.0단어/3단어',
      okCount: 2,
      tip: '대답을 한두 단어만 더 길게 해 보세요.',
    },
    {
      name: '2단계 상황극 단원이면 (1단계 기록은 2단계 승급에 안 셈)',
      progress: { stage: 2, unit: 's2-3', doneUnits: [...S1_ALL, 's2-1'], sessions: [log(day(-1))] },
      stage: '2단계 · 기초 대화 · 완료 1/10',
      unit: '오늘 단원 3 · 카페·식당에서 주문 (상황극)',
      promo: '다음 단계까지: 단원 1개/10개 · 영어 대답 0%/80% · 평균 길이 0.0단어/5단어',
      okCount: 0,
      tip: '오늘 단원을 끝까지 해 봐요.',
    },
  ]
  test('오늘 단원을 이미 마쳤으면 승급 도움말이 "오늘 단원을 끝까지 해 봐요"라고 하지 않는다 (바로 위 "오늘 단원 하나 완료 ✓"와 모순)', async ({
    page,
    context,
  }) => {
    // 오늘 한국어로만 5번 주고받아 단원 하나를 마친 상태: 정말 모자란 건 영어 대답 비율(0%)
    const { errors } = await open(page, context, {
      storage: {
        [K.progress]: {
          stage: 1,
          unit: 's1-2',
          doneUnits: ['s1-1'],
          sessions: [log(TODAY, { turns: 5, koTurns: 5, enOwnTurns: 0, enOwnWords: 0 })],
        },
      },
    })
    await expect(page.locator('#courseCard .hero-title')).toHaveText('오늘 기분')
    await expect(page.locator('#courseCard')).toContainText('오늘 단원 완료 ✓')
    await expect(page.locator('#promoProgress .muted')).toHaveText('다음 단계까지: 단원 1개/10개 · 영어 대답 0%/50% · 평균 길이 0.0단어/3단어')
    await expect(page.locator('#promoProgress .tip-line')).not.toHaveText('오늘 단원을 끝까지 해 봐요.')
    expect(errors).toEqual([])
  })

  for (const c of cases) {
    test(`${c.name}: 카드 문구와 승급 진행·도움말`, async ({ page, context }) => {
      const { errors } = await open(page, context, { storage: { [K.progress]: c.progress } })
      await expect(page.locator('#courseCard .hero-meta')).toContainText(c.stage)
      await expect(page.locator('#courseCard .hero-title')).toHaveText(c.unit.replace(/^(오늘|다음) 단원 \d+ · /, ''))
      await expect(page.locator('#promoProgress .muted')).toHaveText(c.promo)
      await expect(page.locator('#promoProgress .muted .ok-text')).toHaveCount(c.okCount)
      await expect(page.locator('#promoProgress .tip-line')).toHaveText(c.tip)
      await expect(page.locator('#btnPromoteStart')).toHaveCount(0)
      expect(errors).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────
// 3) 교육과정 시트
// ─────────────────────────────────────────────

test.describe('3) 교육과정 시트', () => {
  test('조건이 안 되면: 지금 단계·조건 목록(○)·안내 문구만, 올라가기 버튼 없음, 단원 목록에 완료·현재 표시', async ({ page, context }) => {
    const { errors } = await open(page, context, {
      storage: {
        [K.progress]: {
          stage: 1,
          unit: 's1-3',
          doneUnits: ['s1-1', 's1-2'],
          sessions: [
            log(day(-2), { minutes: 12, turns: 4, koTurns: 3, enOwnTurns: 1, enOwnWords: 2 }),
            log(day(-1), { minutes: 10, turns: 6, koTurns: 2, enOwnTurns: 3, enOwnWords: 6 }),
          ],
        },
      },
    })
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    const sheet = page.locator('#courseSheet')
    await expect(sheet).toBeVisible()
    await expect(page.locator('#courseSheet-title')).toHaveText('교육과정')
    await expect(sheet.locator('.course-now .course-stage')).toHaveText('1단계 · 첫걸음')
    await expect(page.locator('#criteria li')).toHaveText([
      '○ 단원: 2개 / 목표 10개',
      '○ 영어로 스스로 대답한 비율 (최근 대화): 44% / 목표 50%',
      '○ 영어 대답 평균 길이 (최근 대화): 2.0단어 / 목표 3단어',
    ])
    await expect(page.locator('#criteria li.ok')).toHaveCount(0)
    await expect(page.locator('#btnPromote')).toHaveCount(0)
    await expect(sheet).toContainText('조건을 다 채우면 여기서 올라갈 수 있어요.')
    await expect(sheet.getByRole('heading', { name: '단원 (완료 2/10)' })).toBeVisible()

    const units = page.locator('#unitList button')
    await expect(units).toHaveCount(10)
    await expect(units.nth(0)).toHaveClass(/done/)
    await expect(units.nth(0).locator('.unit-no')).toHaveText('✓')
    await expect(units.nth(0).locator('.unit-no')).toHaveAttribute('aria-label', '완료')
    await expect(units.nth(2)).toHaveClass(/current/)
    await expect(units.nth(2)).toHaveAttribute('aria-current', 'true')
    await expect(units.nth(2).locator('.unit-no')).toHaveText('3')
    await expect(units.nth(2)).toContainText('좋아하는 음식')
    await expect(page.locator('#unitList [aria-current]')).toHaveCount(1)
    await expect(page.locator('#courseStats')).toHaveText('대화 2번 · 앱에서 22분')
    expect(errors).toEqual([])
  })

  test('조건을 채우면 "2단계로 올라가기" → 확인 취소는 그대로, 수락하면 2단계·설정 맞춤 → 다음 대화 지시문이 2단계 규칙', async ({
    page,
    context,
  }) => {
    const { queue, requests, errors } = await open(page, context, {
      storage: { [K.progress]: { stage: 1, unit: 's1-1', doneUnits: S1_ALL, sessions: [log(day(-1))] } },
    })
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    await expect(page.locator('#criteria li.ok')).toHaveCount(3)
    await expect(page.locator('#criteria li')).toHaveText([
      '✓ 단원: 10개 / 목표 10개',
      '✓ 영어로 스스로 대답한 비율 (최근 대화): 100% / 목표 50%',
      '✓ 영어 대답 평균 길이 (최근 대화): 4.0단어 / 목표 3단어',
    ])
    const promote = page.locator('#btnPromote')
    await expect(promote).toHaveText('2단계로 올라가기')

    // 확인 창에서 취소 → 아무것도 안 바뀜
    let dialog = nextDialog(page, false)
    await promote.click()
    expect(await dialog).toBe('2단계로 바꿀까요? 말 속도와 뜻 보이기도 그 단계에 맞춰져요. 마친 단원 기록은 그대로 남아요.')
    await expect(page.locator('#courseSheet .course-now .course-stage')).toHaveText('1단계 · 첫걸음')
    expect((await progressIn(page))?.stage).toBe(1)
    await expect(page.locator('#toast.show')).toHaveCount(0)

    // 수락 → 2단계
    dialog = nextDialog(page, true)
    await promote.click()
    await dialog
    await expect(page.locator('#toast')).toHaveText('2단계 「기초 대화」 시작! 말 속도와 뜻 보이기를 이 단계에 맞췄어요.')
    await expect(page.locator('#courseSheet .course-now .course-stage')).toHaveText('2단계 · 기초 대화')
    await expect(page.locator('#criteria li')).toHaveText([
      '○ 단원: 0개 / 목표 10개',
      '○ 영어로 스스로 대답한 비율 (최근 대화): 0% / 목표 80%',
      '○ 영어 대답 평균 길이 (최근 대화): 0.0단어 / 목표 5단어',
    ])
    await expect(page.locator('#btnPromote')).toHaveCount(0)
    const p = await progressIn(page)
    expect(p).toMatchObject({ stage: 2, unit: 's2-1', doneUnits: S1_ALL })
    expect(await settingsIn(page)).toMatchObject({ apiKey: 'K', rate: 0.85, showKo: true, repeatAmount: '보통' })

    await page.click('#btnCourseClose')
    await page.click('#tab-home')
    await expect(page.locator('#courseCard .hero-meta')).toContainText('2단계 · 기초 대화 · 완료 0/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('어제 한 일')

    // 다음 대화: 지시문이 2단계 규칙으로, 첫 단원은 '어제 한 일', 말 속도 0.85
    await startWithGreeting(page, queue, { say: 'Hi! What did you do yesterday?', say_ko: '안녕! 어제 뭐 했어?' })
    const sys = systemText(requests[0])
    expect(sys).toContain('- 교육과정 2단계 「기초 대화」(A2): 자주 쓰는 표현은 알아듣고 짧은 문장으로 대답할 수 있어. 과거·미래 표현은 아직 서툴러.')
    expect(sys).toContain('- 이 단계 목표: 어제 한 일과 계획을 짧은 문장 여러 개로 말하기')
    expect(sys).toContain('- say: 영어만 써. 반응 + 질문 하나. 최대 2문장, 한 문장에 10단어 이하, 일상 단어 위주.')
    expect(sys).toContain('- hints: 내가 한국어로 대답했거나 막힌 것 같을 때만 쉬운 대답 2개와 뜻. 영어로 잘 대답하고 있으면 빈 배열.')
    expect(sys).toContain('따라 말하기 횟수: 두세 번에 한 번.')
    expect(sys).toContain('[오늘 단원] 어제 한 일')
    expect(sys).not.toContain('「첫걸음」')
    expect(sys).not.toContain('한 문장에 6단어 이하')
    expect(lastUserText(requests[0])).toBe('[대화 시작] 먼저 짧게 인사하고, 오늘 단원 「어제 한 일」 주제로 첫 질문 하나만 해.')
    await expect.poll(async () => (await spoken(page)).find((s) => s.lang === 'en-US')?.rate).toBe(0.85)
    expect(errors).toEqual([])
  })

  test('마지막 단원을 마치면 "올라갈 준비가 됐어요" → 시작 화면 #btnPromoteStart (취소/수락)', async ({ page, context }) => {
    const { queue, errors } = await open(page, context, {
      storage: {
        [K.progress]: { stage: 1, unit: 's1-10', doneUnits: S1_ALL.slice(0, 9), sessions: [log(day(-1)), log(day(-2))] },
      },
    })
    await expect(page.locator('#courseCard .hero-meta')).toContainText('1단계 · 첫걸음 · 완료 9/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('집과 동네')
    await expect(page.locator('#btnPromoteStart')).toHaveCount(0)

    await startWithGreeting(page, queue, { say: 'Where do you live?', say_ko: '어디 살아?' })
    for (const said of ['I live in Seoul now', 'My house is small', 'There is a big park', 'I walk there every day', 'I love my town a lot']) {
      await exchange(page, queue, said)
    }
    await page.click('#btnEnd')
    await page.click('#btnFinish')
    const msg = page.locator('#startMsg')
    await expect(msg).toContainText('「집과 동네」 단원을 마쳤어요.')
    await expect(msg).toContainText('다음 단계로 올라갈 준비가 됐어요!')
    await expect(page.locator('#courseCard .hero-meta')).toContainText('1단계 · 첫걸음 · 완료 10/10')
    await expect(page.locator('#promoProgress .course-ready')).toContainText('다음 단계로 올라갈 준비가 됐어요!')
    const btn = page.locator('#btnPromoteStart')
    await expect(btn).toHaveText('2단계로')

    let dialog = nextDialog(page, false)
    await btn.click()
    expect(await dialog).toBe('2단계로 바꿀까요? 말 속도와 뜻 보이기도 그 단계에 맞춰져요. 마친 단원 기록은 그대로 남아요.')
    expect((await progressIn(page))?.stage).toBe(1)
    await expect(btn).toBeVisible()

    dialog = nextDialog(page, true)
    await btn.click()
    await dialog
    await expect(page.locator('#toast')).toHaveText('2단계 「기초 대화」 시작! 말 속도와 뜻 보이기를 이 단계에 맞췄어요.')
    await expect(page.locator('#courseCard .hero-meta')).toContainText('2단계 · 기초 대화 · 완료 0/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('어제 한 일')
    await expect(page.locator('#btnPromoteStart')).toHaveCount(0)
    expect(await progressIn(page)).toMatchObject({ stage: 2, unit: 's2-1' })
    expect((await progressIn(page))?.doneUnits.sort()).toEqual([...S1_ALL].sort())
    expect(await settingsIn(page)).toMatchObject({ rate: 0.85, showKo: true, repeatAmount: '보통' })
    expect(errors).toEqual([])
  })

  test('단원 목록에서 단원을 고르면 시트가 닫히고 토스트, 카드·저장값이 바뀌고, 다음 대화 지시문이 그 단원', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context)
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    await page.locator('#unitList button', { hasText: '나의 하루' }).click()
    await expect(page.locator('#courseSheet')).toHaveCount(0)
    await expect(page.locator('#toast')).toHaveText('「나의 하루」로 정했어요. 시작하기를 누르세요.')
    // 고르면 바뀐 카드와 시작 버튼이 있는 홈으로 간다
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#courseCard .hero-title')).toHaveText('나의 하루')
    expect((await progressIn(page))?.unit).toBe('s1-5')

    // 다시 열면 그 단원이 현재로 표시
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    await expect(page.locator('#unitList [aria-current="true"]')).toContainText('나의 하루')
    await page.click('#btnCourseClose')

    await startWithGreeting(page, queue, { say: 'What time do you get up?', say_ko: '몇 시에 일어나?' })
    const sys = systemText(requests[0])
    expect(sys).toContain('[오늘 단원] 나의 하루')
    expect(sys).toContain('- 연습할 표현: "I get up at ~." / "I go to work." / "I eat lunch at ~."')
    expect(sys).not.toContain('[오늘 단원] 인사와 자기소개')
    expect(lastUserText(requests[0])).toBe('[대화 시작] 먼저 짧게 인사하고, 오늘 단원 「나의 하루」 주제로 첫 질문 하나만 해.')
    await expect(page.locator('#status')).toHaveText('나의 하루')
    expect(errors).toEqual([])
  })

  test('받침으로 끝나는 단원(좋아하는 음식)을 고르면 토스트 조사도 맞게 ("…음식」으로", "…음식」로" 아님)', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    await page.locator('#unitList button', { hasText: '좋아하는 음식' }).click()
    const toast = page.locator('#toast')
    await expect(toast).toContainText('「좋아하는 음식」')
    await expect(toast).toContainText('시작하기를 누르세요.')
    expect((await progressIn(page))?.unit).toBe('s1-3')
    // '음식'은 받침(ㄱ)으로 끝나서 '로'가 아니라 '으로'가 붙어야 한다
    expect(await toast.textContent()).not.toContain('음식」로 ')
    expect(errors).toEqual([])
  })

  test('"전체 단계 보기"에서 다른 단계를 고르면 확인: 취소는 그대로, 수락하면 그 단계로 (내려가도 마친 단원은 남음)', async ({
    page,
    context,
  }) => {
    const { errors } = await open(page, context, {
      storage: { [K.progress]: { stage: 1, unit: 's1-3', doneUnits: ['s1-1', 's1-2'], sessions: [log(day(-1))] } },
    })
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    const list = page.locator('#stageList')
    await expect(list).toBeHidden()
    await page.locator('#stagesDetails summary').click()
    await expect(list).toBeVisible()
    const cards = list.locator('.card.stage')
    await expect(cards).toHaveCount(6)
    await expect(cards.nth(0)).toHaveClass(/current/)
    await expect(cards.nth(0).getByRole('button', { name: '이 단계로 바꾸기' })).toHaveCount(0)
    await expect(list.getByRole('button', { name: '이 단계로 바꾸기' })).toHaveCount(5)
    await expect(cards.nth(3)).toContainText('4단계 · 자신감 있는 대화 (B2)')

    // 4단계: 취소
    let dialog = nextDialog(page, false)
    await cards.nth(3).getByRole('button', { name: '이 단계로 바꾸기' }).click()
    expect(await dialog).toBe('4단계로 바꿀까요? 말 속도와 뜻 보이기도 그 단계에 맞춰져요. 마친 단원 기록은 그대로 남아요.')
    await expect(page.locator('#courseSheet .course-now .course-stage')).toHaveText('1단계 · 첫걸음')
    expect((await progressIn(page))?.stage).toBe(1)

    // 4단계: 수락 → 시트는 열린 채로 4단계 내용
    dialog = nextDialog(page, true)
    await cards.nth(3).getByRole('button', { name: '이 단계로 바꾸기' }).click()
    await dialog
    await expect(page.locator('#toast')).toHaveText('4단계 「자신감 있는 대화」 시작! 말 속도와 뜻 보이기를 이 단계에 맞췄어요.')
    await expect(page.locator('#courseSheet')).toBeVisible()
    await expect(page.locator('#courseSheet .course-now .course-stage')).toHaveText('4단계 · 자신감 있는 대화')
    await expect(page.locator('#criteria li').nth(1)).toHaveText('○ 영어로 스스로 대답한 비율 (최근 대화): 0% / 목표 95%')
    await expect(page.locator('#criteria li').nth(2)).toHaveText('○ 영어 대답 평균 길이 (최근 대화): 0.0단어 / 목표 12단어')
    await expect(cards.nth(3)).toHaveClass(/current/)
    await expect(cards.nth(0).getByRole('button', { name: '이 단계로 바꾸기' })).toHaveCount(1)
    expect(await progressIn(page)).toMatchObject({ stage: 4, unit: 's4-1', doneUnits: ['s1-1', 's1-2'] })
    expect(await settingsIn(page)).toMatchObject({ rate: 1, showKo: false, repeatAmount: '적게' })

    // 1단계로 다시 내려가면: 마친 단원은 남고, 안 한 첫 단원으로
    dialog = nextDialog(page, true)
    await cards.nth(0).getByRole('button', { name: '이 단계로 바꾸기' }).click()
    await dialog
    await expect(page.locator('#courseSheet .course-now .course-stage')).toHaveText('1단계 · 첫걸음')
    expect(await progressIn(page)).toMatchObject({ stage: 1, unit: 's1-3', doneUnits: ['s1-1', 's1-2'] })
    expect(await settingsIn(page)).toMatchObject({ rate: 0.8, showKo: true, repeatAmount: '많이' })
    await page.click('#btnCourseClose')
    await page.click('#tab-home')
    await expect(page.locator('#courseCard .hero-meta')).toContainText('1단계 · 첫걸음 · 완료 2/10')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 4) 4단계 이상 대화
// ─────────────────────────────────────────────

test.describe('4) 높은 단계 대화', () => {
  test('4단계 상황극 단원: 지시문이 4단계 규칙(대답 예시 없음·따라 말하기 횟수 없음)·상황극 첫마디, tip은 말풍선에 💡로', async ({
    page,
    context,
  }) => {
    const { queue, requests, errors } = await open(page, context, {
      settings: { rate: 1, showKo: false, repeatAmount: '적게' },
      storage: { [K.progress]: { stage: 4, unit: 's4-3', doneUnits: [...S1_ALL], sessions: [log(day(-1), { stage: 4, unit: 's4-1' })] } },
    })
    await expect(page.locator('#courseCard .hero-meta')).toContainText('4단계 · 자신감 있는 대화 · 완료 0/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('회의에서 제안하기 (상황극)')

    const tip1 = '회의에서 의견을 낼 때는 "I\'d suggest ~"로 시작하면 부드러워요.'
    await startWithGreeting(page, queue, {
      say: "Okay team, let's begin. Any ideas for the new project?",
      say_ko: '자, 시작하죠. 새 프로젝트 아이디어 있어요?',
      tip: tip1,
    })
    // 4단계부터 한국어 버튼은 작은 보조 버튼 (누르면 그대로 한국어로 들음)
    await expect(page.locator('#micKo')).toHaveClass(/small-ko/)
    await expect(page.locator('#micKo .mic-label')).toHaveText('한국어')
    await expect(page.locator('#micEn .mic-label')).toHaveText('영어로 대답하기 (추천)')
    const koBox = await page.locator('#micKo').boundingBox()
    const enBox = await page.locator('#micEn').boundingBox()
    expect((koBox?.width ?? 0) * 3).toBeLessThan(enBox?.width ?? 0)
    const sys = systemText(requests[0])
    expect(sys).toContain('- 교육과정 4단계 「자신감 있는 대화」(B2): 일상 대화는 대부분 할 수 있고, 이제 의견을 근거와 함께 길게 말하는 연습이 필요해.')
    expect(sys).toContain('- say: 영어만 써. 원어민이 친구에게 말하듯 자연스럽게, 2~4문장. 어려운 단어는 가끔만.')
    expect(sys).toContain('- hints: 항상 빈 배열.')
    expect(sys).toContain('- tip: 서너 번에 한 번, 더 원어민다운 표현이나 반복되는 실수를 한국어 한 문장으로. 나머지는 빈칸.')
    expect(sys).toContain('3. 고쳐 주기: 먼저 맞는 문장으로 되받아 말하고, 반복되는 실수는 tip으로 알려 줘.')
    expect(sys).toContain('[오늘 단원] 회의에서 제안하기')
    expect(sys).toContain('이 단원은 상황극이야.')
    // 3단계까지만 따라 말하기 횟수를 정한다
    expect(sys).not.toContain('따라 말하기 횟수')
    expect(sys).not.toContain('「첫걸음」')
    expect(lastUserText(requests[0])).toBe('[대화 시작] 오늘 단원은 상황극이야. 네 역할로 바로 첫마디를 해. 상황 설명이 필요하면 tip에 한국어 한 줄로.')

    const first = aiBubbles(page).nth(0)
    await expect(first.locator('.tip')).toHaveText(tip1)
    // 4단계 기본은 뜻 가리기
    await expect(first.locator('.meaning.concealed')).toBeVisible()

    // tip이 있는 답 / 없는 답
    const tip2 = '"I think we should"보다 "What if we"가 제안할 때 더 자연스러워요.'
    await exchange(page, queue, 'I think we should make an app for kids', {
      say: 'Interesting. What if we made it for parents too?',
      say_ko: '흥미롭네요. 부모용으로도 만들면 어때요?',
      tip: tip2,
    })
    await expect(aiBubbles(page).nth(1).locator('.tip')).toHaveText(tip2)
    await exchange(page, queue, 'That sounds good to me', { say: 'Great, let us vote.', say_ko: '좋아요, 투표하죠.' })
    await expect(aiBubbles(page).nth(2).locator('.tip')).toHaveCount(0)
    // 같은 대화 안에서는 지시문이 그대로 4단계
    expect(systemText(requests[2])).toContain('「자신감 있는 대화」(B2)')
    await expect.poll(async () => (await spoken(page)).find((s) => s.lang === 'en-US')?.rate).toBe(1)
    expect(errors).toEqual([])
  })

  test('6단계(마지막): 승급 조건 대신 "마지막 단계" 안내, 지시문은 6단계 규칙(따라 말하기 쓰지 않음)', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context, {
      settings: { rate: 1.05, showKo: false, repeatAmount: '적게' },
      storage: { [K.progress]: { stage: 6, unit: 's6-2', doneUnits: ['s6-1'], sessions: [log(day(-1), { stage: 6, unit: 's6-1' })] } },
    })
    await expect(page.locator('#courseCard .hero-meta')).toContainText('6단계 · 원어민 수준 · 완료 1/10')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('농담과 문화 맥락')
    await expect(page.locator('#promoProgress')).toHaveCount(0)
    await page.click('#tab-library')
    await page.click('#btnStartCourse')
    await expect(page.locator('#criteria')).toHaveCount(0)
    await expect(page.locator('#btnPromote')).toHaveCount(0)
    await expect(page.locator('#courseSheet')).toContainText('마지막 단계예요. 단원을 돌며 계속 다듬어요.')
    await page.click('#btnCourseClose')

    await startWithGreeting(page, queue, {
      say: "Ha, that's a classic dad joke. Got any better ones?",
      say_ko: '하, 전형적인 아재 개그네. 더 좋은 거 있어?',
      tip: '"dad joke"는 뻔하고 썰렁한 말장난 농담이에요.',
    })
    const sys = systemText(requests[0])
    expect(sys).toContain('- 교육과정 6단계 「원어민 수준」(C2)')
    expect(sys).toContain('- say: 영어만 써. 원어민 친구처럼 완전히 자연스럽게. 속어, 줄임말, 농담도 섞어.')
    expect(sys).toContain('- repeat: 따라 말할 영어 문장 하나. 쓰지 마. 항상 빈칸. 없으면 빈칸.')
    expect(sys).toContain('[오늘 단원] 농담과 문화 맥락')
    expect(sys).not.toContain('따라 말하기 횟수')
    await expect(aiBubbles(page).nth(0).locator('.tip')).toHaveText('"dad joke"는 뻔하고 썰렁한 말장난 농담이에요.')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 5) 내 문장 노트
// ─────────────────────────────────────────────

const many = (n: number): Learned[] =>
  Array.from({ length: n }, (_, i) => ({ en: `Phrase ${i + 1}.`, ko: `문장 ${i + 1}`, date: day(-n + i) }))

test.describe('5) 내 문장 노트', () => {
  test('비어 있으면 안내만 (복습·지우기·더 보기 없음), "폰↔PC 옮기기"로 옮기기 시트를 연다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#bookSheet-title')).toHaveText('내 문장 노트')
    await expect(page.locator('#bookBody')).toContainText('아직 저장된 문장이 없어요.')
    await expect(page.locator('#btnReview')).toHaveCount(0)
    await expect(page.locator('#btnBookClear')).toHaveCount(0)
    await expect(page.locator('#btnBookMore')).toHaveCount(0)
    await page.click('#btnBookTransfer')
    await expect(page.locator('#transferSheet')).toBeVisible()
    await expect(page.locator('#bookSheet')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('25문장: 최근 것부터 20개 → "더 보기 (5문장 남음)" → 25개, 🔊·🐢로 듣기', async ({ page, context }) => {
    const learned = many(25)
    const { errors } = await open(page, context, { storage: { [K.learned]: learned } })
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#btnReview')).toHaveText('오늘 복습 5문장')
    await expect(page.locator('#bookBody')).toContainText('모두 25문장 · 최근 것부터')
    const cards = page.locator('#bookBody > .card')
    await expect(cards).toHaveCount(20)
    await expect(cards.nth(0).locator('.repeat-text')).toHaveText('Phrase 25.')
    await expect(cards.nth(0).locator('.meaning')).toHaveText('문장 25')
    await expect(cards.nth(0).locator('.book-date')).toHaveText(day(-1))
    await expect(cards.nth(19).locator('.repeat-text')).toHaveText('Phrase 6.')
    const more = page.locator('#btnBookMore')
    await expect(more).toHaveText('더 보기 (5문장 남음)')
    await more.click()
    await expect(cards).toHaveCount(25)
    await expect(cards.nth(24).locator('.repeat-text')).toHaveText('Phrase 1.')
    await expect(more).toHaveCount(0)

    await clearSpoken(page)
    await page.getByRole('button', { name: 'Phrase 25. 듣기', exact: true }).click()
    await expect.poll(() => spoken(page)).toEqual([expect.objectContaining({ text: 'Phrase 25.', lang: 'en-US', rate: 0.8 })])
    await clearSpoken(page)
    await page.getByRole('button', { name: 'Phrase 25. 천천히 듣기' }).click()
    await expect.poll(() => spoken(page)).toEqual([expect.objectContaining({ text: 'Phrase 25.', lang: 'en-US', rate: expect.closeTo(0.6, 5) })])
    expect(errors).toEqual([])
  })

  test('복습: #btnReview → 복습 카드(최근 3문장 포함)·읽어 보기·써 보기 → "목록으로", 시작 화면 "하러 가기"는 바로 복습', async ({
    page,
    context,
  }) => {
    const learned = many(25)
    const { requests, errors } = await open(page, context, {
      storage: { [K.learned]: learned, [K.progress]: { stage: 1, unit: 's1-2', doneUnits: ['s1-1'], sessions: [log(day(-1))] } },
    })
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await page.click('#btnReview')
    await expect(page.locator('#bookSheet-title')).toHaveText('오늘 복습')
    const body = page.locator('#reviewBody')
    await expect(body).toBeVisible()
    await expect(page.locator('#bookBody')).toHaveCount(0)
    await expect(body).toContainText('듣고 → 소리 내어 읽고 → 뜻 보고 써 보세요. 대화 없이 5분이면 돼요.')
    const says = await body.locator('.read-card .say').allTextContents()
    expect(says.length).toBeGreaterThan(0)
    // 최근 3문장은 꼭 들어가고, 모두 내 문장 노트에 있는 문장
    for (const en of ['Phrase 23.', 'Phrase 24.', 'Phrase 25.']) expect(says).toContain(en)
    for (const en of says) expect(learned.map((x) => x.en)).toContain(en)

    // 🎤 읽어 보기
    const card = body.locator('.read-card', { hasText: 'Phrase 25.' })
    await card.locator('.btn-read').click()
    await say(page, 'phrase 25')
    await expect(card.locator('.result')).toHaveText('잘 들렸어요! ("phrase 25")')

    // 뜻 보고 써 보기: 정확히 쓰면 AI 없이 칭찬
    await expect(body.getByRole('heading', { name: '뜻 보고 써 보기' })).toBeVisible()
    const box = body.locator('.write-box')
    const prompt = (await box.locator('.write-prompt').textContent()) ?? ''
    const n = /문장 (\d+)/.exec(prompt)?.[1]
    expect(n).toBeTruthy()
    await box.locator('textarea').fill(`phrase ${n}`)
    await box.locator('.btn-check').click()
    await expect(box.locator('.result')).toHaveText('완벽해요!')
    expect(requests).toHaveLength(0)

    await expect(page.locator('#btnReviewDone')).toHaveText('목록으로')
    await page.click('#btnReviewDone')
    await expect(page.locator('#bookSheet-title')).toHaveText('내 문장 노트')
    await expect(page.locator('#bookBody')).toBeVisible()
    await page.click('#btnBookClose')
    await expect(page.locator('#bookSheet')).toHaveCount(0)

    // 홈 '오늘 할 일'의 '하러 가기' → 바로 복습 화면
    await page.click('#tab-home')
    await page.locator('#todayRoutine').getByRole('button', { name: '하러 가기' }).click()
    await expect(page.locator('#bookSheet-title')).toHaveText('오늘 복습')
    await expect(page.locator('#reviewBody')).toBeVisible()
    await page.keyboard.press('Escape')
    // 다시 내 문장 노트를 열면 목록부터
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#bookSheet-title')).toHaveText('내 문장 노트')
    expect(errors).toEqual([])
  })

  test('복습 카드 수는 버튼에 적힌 수(5문장)와 같다 — 오래 쓴 내 문장 노트(간격 복습 대상이 많을 때)', async ({ page, context }) => {
    const { errors } = await open(page, context, { storage: { [K.learned]: SPACED } })
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#btnReview')).toHaveText('오늘 복습 5문장')
    await page.click('#btnReview')
    const says = page.locator('#reviewBody .read-card .say')
    await expect(says.first()).toBeVisible()
    // 최근 3문장(오늘 배운 것)은 들어간다
    for (const x of SPACED.slice(-3)) await expect(page.locator('#reviewBody .read-card', { hasText: x.en })).toHaveCount(1)
    // 버튼에 '5문장'이라고 했으면 5장이어야 한다
    await expect(says).toHaveCount(5)
    expect(errors).toEqual([])
  })

  test('"내 문장 노트 모두 지우기": 확인 취소면 그대로, 수락하면 비우고 저장소도 []', async ({ page, context }) => {
    const learned = many(3)
    const { errors } = await open(page, context, { storage: { [K.learned]: learned } })
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await expect(page.locator('#bookBody > .card')).toHaveCount(3)

    let dialog = nextDialog(page, false)
    await page.click('#btnBookClear')
    expect(await dialog).toBe('내 문장 노트를 모두 지울까요? 되돌릴 수 없어요.')
    await expect(page.locator('#bookBody > .card')).toHaveCount(3)
    expect(await learnedIn(page)).toEqual(learned)

    dialog = nextDialog(page, true)
    await page.click('#btnBookClear')
    await dialog
    await expect(page.locator('#bookBody > .card')).toHaveCount(0)
    await expect(page.locator('#bookBody')).toContainText('아직 저장된 문장이 없어요.')
    await expect(page.locator('#btnBookClear')).toHaveCount(0)
    await expect(page.locator('#btnReview')).toHaveCount(0)
    expect(await learnedIn(page)).toEqual([])
    expect(errors).toEqual([])
  })

  test('복습 문장은 다음 대화 지시문에 [복습]으로: 최근 3개 + 1·3·7·14·30일쯤 된 문장, 배운 순서대로 8개', async ({ page, context }) => {
    const { queue, requests, errors } = await open(page, context, { storage: { [K.learned]: SPACED } })
    await startWithGreeting(page, queue)
    const sys = systemText(requests[0])
    const block = sys.slice(sys.indexOf('[복습]'))
    expect(block.startsWith('[복습] 지난번에 같이 연습한 문장이야. 오늘 대화에서 1~2개를 자연스럽게 다시 쓰거나 따라 말하게 해 줘.')).toBe(true)
    const lines = block.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toEqual(SPACED_PICK.map((x) => `- ${x.en} (${x.ko})`))
    // 고르지 않은 문장(60·45·20·10·5·2일)은 빠진다
    for (const x of SPACED.filter((s) => !SPACED_PICK.includes(s))) expect(sys).not.toContain(x.en)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 6) 폰↔PC 옮기기
// ─────────────────────────────────────────────

test.describe('6) 옮기기', () => {
  const A_SETTINGS = {
    apiKey: 'KEY_A',
    friendName: 'Mia',
    likes: '커피, 여행',
    minutes: 20,
    rate: 0.9,
    showKo: false,
    repeatAmount: '보통',
    voiceName: 'Microsoft David - English (United States)',
    autoListen: false,
  }
  const A_LEARNED: Learned[] = [
    { en: 'I like coffee.', ko: '커피 좋아해.', date: day(-6) },
    { en: 'Nice to meet you.', ko: '만나서 반가워.', date: day(-5) },
    { en: "I'm tired.", ko: '피곤해.', date: day(-3) },
  ]
  const A_PROGRESS: ProgressLike = {
    stage: 2,
    unit: 's2-2',
    doneUnits: [...S1_ALL, 's2-1'],
    sessions: [log(day(-6), { id: '00a0001' }), log(day(-3), { id: '00a0002', stage: 2, unit: 's2-1' })],
  }
  const B_SETTINGS = { apiKey: 'KEY_B', friendName: 'Emma', voiceName: 'Google US English', autoListen: true, minutes: 15 }
  const B_LEARNED: Learned[] = [
    { en: 'I like coffee!', ko: '커피 좋아!', date: day(-2) },
    { en: 'Where is the station?', ko: '역이 어디예요?', date: day(-4) },
  ]
  const B_PROGRESS: ProgressLike = {
    stage: 1,
    unit: 's1-3',
    doneUnits: ['s1-1', 's1-2'],
    sessions: [log(day(-4), { id: '00b0001' })],
  }

  test('A에서 내보내기(EF1. 코드 복사, 키·목소리 빼고) → B(다른 키·문장)에서 가져오기: 문장 합집합·진도 병합·B 키 유지', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    // ── A 기기: 내보내기 ──
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const a = await open(page, context, {
      settings: A_SETTINGS,
      storage: { [K.learned]: A_LEARNED, [K.progress]: A_PROGRESS },
    })
    await page.click('#tab-library')
    await page.click('#btnStartTransfer')
    await expect(page.locator('#transferSheet-title')).toHaveText('폰↔PC 옮기기')
    await expect(page.locator('#exportCode')).toHaveCount(0)
    await page.click('#btnExport')
    const codeBox = page.locator('#exportCode')
    await expect(codeBox).toBeVisible()
    await expect(codeBox).toHaveAttribute('readonly', '')
    const code = await codeBox.inputValue()
    expect(code).toMatch(/^EF[01]\.[A-Za-z0-9_-]+$/)
    // 크롬은 압축을 지원하므로 EF1.
    expect(code.startsWith('EF1.')).toBe(true)
    await expect(page.locator('#transferResult')).toHaveText('복사했어요 (문장 3개). 카톡 "나와의 채팅"에 붙여 넣어 보내세요.')
    await expect(page.locator('#transferResult')).toHaveClass(/good/)
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
    // 코드 안에는 키·목소리·자동 듣기가 없다
    const data = decodeCode(code)
    expect(data.v).toBe(1)
    expect(data.l).toEqual(A_LEARNED.map((x) => [x.en, x.ko, x.date]))
    expect(Object.keys(data.s).sort()).toEqual(
      ['model', 'likes', 'minutes', 'repeatAmount', 'friendName', 'friendStyle', 'rate', 'showKo', 'soundFirst'].sort(),
    )
    expect(code).not.toContain('KEY_A')
    expect(JSON.stringify(data)).not.toContain('KEY_A')
    expect(JSON.stringify(data)).not.toContain('Microsoft David')
    expect(data.p).toMatchObject({ stage: 2, unit: 's2-2' })
    expect(a.errors).toEqual([])

    // ── B 기기: 가져오기 ──
    const b = await openOtherDevice(browser, baseURL, {
      settings: B_SETTINGS,
      storage: { [K.learned]: B_LEARNED, [K.progress]: B_PROGRESS },
    })
    try {
      const bp = b.page
      await expect(bp.locator('#courseCard .hero-meta')).toContainText('1단계 · 첫걸음 · 완료 2/10')
      await bp.click('#tab-library')
      await bp.click('#btnStartTransfer')
      await expect(bp.locator('#importCode')).toHaveCount(0)
      await bp.click('#btnImportOpen')
      await expect(bp.locator('#importCode')).toBeVisible()
      await bp.fill('#importCode', code)
      await bp.click('#btnImportRun')
      const result = bp.locator('#transferResult')
      await expect(result).toHaveText('2문장을 새로 가져왔어요 (모두 4문장). 설정과 진도도 맞췄어요.')
      await expect(result).toHaveClass(/good/)
      await expect(bp.locator('#importCode')).toHaveValue('')
      // B에는 키가 있으니 키 안내는 없다
      await expect(bp.locator('#transferNeedKey')).toHaveCount(0)

      // 문장: 합집합, 겹치는 문장은 B 것을 남기되 더 이른 날짜, 날짜순
      expect(await learnedIn(bp)).toEqual([
        { en: 'I like coffee!', ko: '커피 좋아!', date: day(-6) },
        { en: 'Nice to meet you.', ko: '만나서 반가워.', date: day(-5) },
        { en: 'Where is the station?', ko: '역이 어디예요?', date: day(-4) },
        { en: "I'm tired.", ko: '피곤해.', date: day(-3) },
      ])
      // 진도: 더 높은 단계, 마친 단원 합집합, 기록 합집합
      const p = await progressIn(bp)
      expect(p?.stage).toBe(2)
      expect(p?.unit).toBe('s2-2')
      expect([...(p?.doneUnits ?? [])].sort()).toEqual([...S1_ALL, 's2-1'].sort())
      expect(p?.sessions.map((s) => s.id).sort()).toEqual(['00a0001', '00a0002', '00b0001'])
      // 설정: 키·목소리·자동 듣기는 B 것, 나머지는 A 것
      expect(await settingsIn(bp)).toMatchObject({
        apiKey: 'KEY_B',
        voiceName: 'Google US English',
        autoListen: true,
        friendName: 'Mia',
        likes: '커피, 여행',
        minutes: 20,
        rate: 0.9,
        showKo: false,
        repeatAmount: '보통',
      })

      // 시트를 닫으면 시작 화면도 가져온 진도·이름으로
      await bp.click('#btnTransferClose')
      await bp.click('#tab-home')
      await expect(bp.locator('#courseCard .hero-meta')).toContainText('2단계 · 기초 대화 · 완료 1/10')
      await expect(bp.locator('#courseCard .hero-title')).toHaveText('주말 계획')
      await expect(bp.locator('#startTitle')).toHaveText('AI Mia')
      await expect(bp.locator('#btnStart')).toHaveText('지금 Mia와 수다 떨기')
      await bp.click('#tab-library')
      await bp.click('#btnStartBook')
      await expect(bp.locator('#bookBody')).toContainText('모두 4문장 · 최근 것부터')
      await bp.keyboard.press('Escape')

      // B에서 대화를 시작하면 B 키로 보내고, 가져온 2단계로
      await startWithGreeting(bp, b.queue)
      expect(b.requests[0].headers['x-goog-api-key']).toBe('KEY_B')
      expect(systemText(b.requests[0])).toContain('[오늘 단원] 주말 계획')
      expect(systemText(b.requests[0])).toContain('"Mia"')

      // 같은 코드를 다시 가져오면 새 문장은 없다
      await bp.click('#btnEnd')
      await bp.click('#btnFinish')
      await bp.click('#tab-library')
      await bp.click('#btnStartTransfer')
      await bp.click('#btnImportOpen')
      await bp.fill('#importCode', code)
      await bp.click('#btnImportRun')
      await expect(bp.locator('#transferResult')).toHaveText('새 문장은 없었어요 (모두 4문장). 설정과 진도는 맞췄어요.')
      expect(b.errors).toEqual([])
    } finally {
      await b.context.close()
    }
  })

  test('키가 없는 기기에서 가져오면 #transferNeedKey 안내 → "키 넣기"가 키 시트를 열고, 닫으면 "진도는 옮겨졌어요"', async ({
    page,
    context,
  }) => {
    const code = plainCode({
      v: 1,
      l: A_LEARNED.map((x) => [x.en, x.ko, x.date]),
      s: { friendName: 'Mia', minutes: 20 },
      p: A_PROGRESS,
    })
    const { keyChecks, errors } = await open(page, context, { settings: null })
    await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
    await page.click('#tab-library')
    await page.click('#btnStartTransfer')
    await page.click('#btnImportOpen')
    await page.fill('#importCode', code)
    await page.click('#btnImportRun')
    await expect(page.locator('#transferResult')).toHaveText('3문장을 새로 가져왔어요 (모두 3문장). 설정과 진도도 맞췄어요.')
    const need = page.locator('#transferNeedKey')
    await expect(need).toBeVisible()
    await expect(need).toContainText('이 기기엔 아직 Gemini 키가 없어요. 키를 넣으면 이어서 대화할 수 있어요.')
    // 키는 옮겨지지 않는다
    expect((await settingsIn(page)).apiKey).toBe('')
    expect((await settingsIn(page)).friendName).toBe('Mia')

    await page.click('#btnTransferKey')
    await expect(page.locator('#transferSheet')).toHaveCount(0)
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await expect(page.locator('#settingsSheet-title')).toHaveText('Gemini 키 넣기')
    // 키보드가 안내를 가리지 않게 키 칸에 자동으로 커서를 두지 않는다
    await expect(page.locator('#keyField input')).not.toBeFocused()
    await expect(page.locator('#btnSettingsSave')).toHaveText('저장')
    expect(keyChecks).toHaveLength(0)

    await page.click('#btnSettingsCancel')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await page.click('#tab-home')
    await expect(page.locator('#startMsg')).toHaveText('진도는 옮겨졌어요. 이 기기에 Gemini 키만 넣으면 이어서 해요.')
    await expect(page.locator('#courseCard .hero-meta')).toContainText('2단계 · 기초 대화 · 완료 1/10')
    await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
    expect(errors).toEqual([])
  })

  test('잘못된 코드는 한국어로 알려 주고 아무것도 바꾸지 않는다 (빈 칸·다른 글·잘린 코드·형식 다름)', async ({ page, context }) => {
    const learned = many(2)
    const { errors } = await open(page, context, { storage: { [K.learned]: learned } })
    await page.click('#tab-library')
    await page.click('#btnStartTransfer')
    await page.click('#btnImportOpen')
    const result = page.locator('#transferResult')
    const cases: [string, string][] = [
      ['', '받은 코드를 먼저 붙여 넣어 주세요.'],
      ['   ', '받은 코드를 먼저 붙여 넣어 주세요.'],
      ['안녕하세요 이거 받아', '영어 친구 코드가 아니에요. "내보내기"로 만든 코드를 통째로 붙여 넣어 주세요.'],
      ['EF1.H4sIAAAAAAAAA6tW', '코드가 잘렸거나 바뀌었어요. 처음부터 끝까지 다시 복사해서 붙여 넣어 주세요.'],
      ['EF0.e3sie', '코드가 잘렸거나 바뀌었어요. 처음부터 끝까지 다시 복사해서 붙여 넣어 주세요.'],
      [plainCode({ v: 2, l: [] }), '코드 형식이 맞지 않아요. 보내는 기기에서 앱을 새로고침한 뒤 다시 내보내 주세요.'],
      [plainCode({ v: 1 }), '코드 형식이 맞지 않아요. 보내는 기기에서 앱을 새로고침한 뒤 다시 내보내 주세요.'],
    ]
    for (const [input, message] of cases) {
      await page.fill('#importCode', input)
      await page.click('#btnImportRun')
      await expect(result).toHaveText(message)
      await expect(result).not.toHaveClass(/good/)
      // 실패하면 붙여 넣은 글은 그대로 둔다 (고쳐서 다시 할 수 있게)
      await expect(page.locator('#importCode')).toHaveValue(input)
    }
    await expect(page.locator('#transferNeedKey')).toHaveCount(0)
    expect(await learnedIn(page)).toEqual(learned)
    expect(await progressIn(page)).toBeNull()
    expect((await settingsIn(page)).apiKey).toBe('K')
    expect(errors).toEqual([])
  })

  test('메신저가 줄바꿈·공백을 넣은 EF0. 코드, 진도가 없는 옛 코드도 가져온다 (진도는 그대로)', async ({ page, context }) => {
    const code = plainCode({ v: 1, l: [['Good morning.', '좋은 아침.', day(-1)]], s: { likes: '야구' } })
    const mangled = code.slice(0, 10) + '\n' + code.slice(10, 25) + '  ' + code.slice(25) + '\n'
    const { errors } = await open(page, context, {
      storage: { [K.progress]: { stage: 1, unit: 's1-2', doneUnits: ['s1-1'], sessions: [log(day(-1))] } },
    })
    await page.click('#tab-library')
    await page.click('#btnStartTransfer')
    await page.click('#btnImportOpen')
    await page.fill('#importCode', mangled)
    await page.click('#btnImportRun')
    await expect(page.locator('#transferResult')).toHaveText('1문장을 새로 가져왔어요 (모두 1문장). 설정과 진도도 맞췄어요.')
    expect(await learnedIn(page)).toEqual([{ en: 'Good morning.', ko: '좋은 아침.', date: day(-1) }])
    expect(await progressIn(page)).toMatchObject({ stage: 1, unit: 's1-2', doneUnits: ['s1-1'] })
    expect(await settingsIn(page)).toMatchObject({ apiKey: 'K', likes: '야구' })
    expect(errors).toEqual([])
  })

  test('자동 복사가 막힌 브라우저에서 내보내면 직접 복사하라고 안내하고 코드는 보여 준다', async ({ page, context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('denied')), readText: () => Promise.reject(new Error('denied')) },
        configurable: true,
      })
    })
    const { errors } = await open(page, context, { storage: { [K.learned]: many(2) } })
    await page.click('#tab-library')
    await page.click('#btnStartTransfer')
    await page.click('#btnExport')
    await expect(page.locator('#transferResult')).toHaveText('자동 복사가 안 됐어요. 아래 코드를 눌러 전체 선택한 뒤 복사해 주세요.')
    await expect(page.locator('#transferResult')).not.toHaveClass(/good/)
    const code = await page.locator('#exportCode').inputValue()
    expect(decodeCode(code).l).toHaveLength(2)
    // 코드 칸을 누르면 전체 선택
    await page.click('#exportCode')
    expect(await page.evaluate(() => {
      const t = document.querySelector<HTMLTextAreaElement>('#exportCode')
      return t ? t.selectionEnd - t.selectionStart === t.value.length : false
    })).toBe(true)
    // 가져오기 쪽 '붙여넣기'도 막혀 있으면 길게 눌러 붙여 넣으라고
    await page.click('#btnImportOpen')
    await page.locator('#transferSheet').getByRole('button', { name: '붙여넣기' }).click()
    await expect(page.locator('#transferResult')).toHaveText('자동 붙여넣기가 안 돼요. 칸을 길게 눌러 붙여 넣어 주세요.')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
// 7) 시트 공통
// ─────────────────────────────────────────────

test.describe('7) 시트 공통', () => {
  const sheets = [
    { name: '교육과정', opener: '#btnStartCourse', id: 'courseSheet', footerClose: '#btnCourseClose' },
    { name: '내 문장 노트', opener: '#btnStartBook', id: 'bookSheet', footerClose: '#btnBookClose' },
    { name: '옮기기', opener: '#btnStartTransfer', id: 'transferSheet', footerClose: '#btnTransferClose' },
  ]
  for (const s of sheets) {
    test(`${s.name} 시트: 대화상자 속성, 열면 제목에 포커스·배경 inert, Esc·✕·배경·닫기로 닫히고 포커스는 여는 버튼으로`, async ({
      page,
      context,
    }) => {
      const { errors } = await open(page, context)
      // 여는 버튼은 아래 독의 '내 서재' 칸에 있다
      await page.click('#tab-library')
      const opener = page.locator(s.opener)
      const sheet = page.locator('#' + s.id)
      const start = page.locator('#libraryScreen')

      const openIt = async () => {
        await opener.click()
        await expect(sheet).toBeVisible()
        await expect(page.locator(`#${s.id}-title`)).toBeFocused()
        await expect(start).toHaveAttribute('inert', '')
        await expect(page.locator('.app')).toHaveAttribute('inert', '')
      }
      const closedBack = async () => {
        await expect(sheet).toHaveCount(0)
        await expect(start).not.toHaveAttribute('inert')
        await expect(opener).toBeFocused()
      }

      await openIt()
      await expect(sheet).toHaveAttribute('role', 'dialog')
      await expect(sheet).toHaveAttribute('aria-modal', 'true')
      await expect(sheet).toHaveAttribute('aria-labelledby', `${s.id}-title`)
      await expect(page.getByRole('dialog', { name: s.id === 'courseSheet' ? '교육과정' : s.id === 'bookSheet' ? '내 문장 노트' : '폰↔PC 옮기기' })).toBeVisible()
      // 배경(내 서재) 버튼은 누를 수 없다
      await expect(opener).not.toBeFocused()

      // Esc
      await page.keyboard.press('Escape')
      await closedBack()

      // ✕
      await openIt()
      await expect(sheet.locator('.sheet-x')).toHaveAttribute('aria-label', '닫기')
      await sheet.locator('.sheet-x').click()
      await closedBack()

      // 아래쪽 닫기 버튼
      await openIt()
      await page.click(s.footerClose)
      await closedBack()

      // 배경 누르기: 창 위쪽 빈 곳(어두운 부분)을 누른다. 창이 화면을 다 덮으면 누를 배경이 없다
      await openIt()
      const box = await sheet.locator('.sheet-card').boundingBox()
      expect(box).not.toBeNull()
      if (box && box.y > 24) {
        await page.mouse.click(20, box.y / 2)
        await closedBack()
      } else {
        // 창 안쪽을 누르면 닫히지 않는다
        await page.locator(`#${s.id}-title`).click()
        await expect(sheet).toBeVisible()
        await page.keyboard.press('Escape')
        await closedBack()
      }
      // 창 안쪽(제목)을 눌러도 닫히지 않는다
      await openIt()
      await page.locator(`#${s.id}-title`).click()
      await expect(sheet).toBeVisible()
      await page.keyboard.press('Escape')
      await closedBack()
      expect(errors).toEqual([])
    })
  }

  test('옮기기·내 문장 노트 시트는 화면을 꽉 채운 페이지로 열리고, 왼쪽 위 "‹ 뒤로"로 닫으면 여는 버튼으로 돌아온다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await page.click('#tab-library')
    for (const [opener, id] of [
      ['#btnStartTransfer', '#transferSheet'],
      ['#btnStartBook', '#bookSheet'],
    ]) {
      await page.click(opener)
      // 올라오는 움직임이 끝나면 맨 위에 붙는다
      await expect.poll(async () => (await page.locator(`${id} .sheet-card`).boundingBox())?.y).toBe(0)
      await expect(page.locator(`${id} .sheet-x`)).toHaveText('‹ 뒤로')
      await page.click(`${id} .sheet-x`)
      await expect(page.locator(id)).toHaveCount(0)
      await expect(page.locator(opener)).toBeFocused()
    }
    expect(errors).toEqual([])
  })

  test('내 문장 노트 → "폰↔PC 옮기기"로 이어 연 시트를 닫으면 포커스가 시작 화면(내 문장 노트 버튼)으로 돌아온다', async ({ page, context }) => {
    const { errors } = await open(page, context)
    await page.click('#tab-library')
    await page.click('#btnStartBook')
    await page.click('#btnBookTransfer')
    await expect(page.locator('#transferSheet')).toBeVisible()
    await expect(page.locator('#transferSheet-title')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('#transferSheet')).toHaveCount(0)
    await expect(page.locator('#libraryScreen')).not.toHaveAttribute('inert')
    await expect(page.locator('#btnStartBook')).toBeFocused()
    expect(errors).toEqual([])
  })

  test('옮기기 → "키 넣기"로 이어 연 키 시트를 닫으면 포커스가 시작 화면(옮기기 버튼)으로 돌아온다', async ({ page, context }) => {
    const { errors } = await open(page, context, { settings: null })
    await page.click('#tab-library')
    await page.click('#btnStartTransfer')
    await page.click('#btnImportOpen')
    await page.fill('#importCode', plainCode({ v: 1, l: [['Hi.', '안녕', day(-1)]], s: {} }))
    await page.click('#btnImportRun')
    await page.click('#btnTransferKey')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await page.locator('#keyField input').focus()
    await page.keyboard.press('Escape')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('#libraryScreen')).not.toHaveAttribute('inert')
    await expect(page.locator('#btnStartTransfer')).toBeFocused()
    expect(errors).toEqual([])
  })

  test('대화 중 내 서재에서 연 시트(설정)는 .app을 inert로 만들고, 닫으면 풀리고 포커스는 설정 버튼으로, 대화는 그대로 이어진다', async ({ page, context }) => {
    const { queue, errors } = await open(page, context)
    await startWithGreeting(page, queue)
    await expect(page.locator('.app')).not.toHaveAttribute('inert')
    await page.click('#tab-library')
    await page.click('#btnStartSettings')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await expect(page.locator('.app')).toHaveAttribute('inert', '')
    await expect(page.locator('#settingsSheet-title')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('.app')).not.toHaveAttribute('inert')
    await expect(page.locator('#btnStartSettings')).toBeFocused()
    // 대화 칸으로 돌아가면 하던 대화가 그대로 있다
    await page.click('#tab-chat')
    await expect(page.locator('#composer')).toBeVisible()
    await expect(aiBubbles(page)).toHaveCount(1)
    expect(errors).toEqual([])
  })
})
