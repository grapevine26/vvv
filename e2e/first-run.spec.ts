import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  aiBubbles,
  collectErrors,
  errorReply,
  horizontalOverflow,
  installMocks,
  lastUserText,
  reply,
  say,
  setMic,
  silence,
  storageGet,
  systemText,
  turn,
  type MockOptions,
  type MockWindow,
} from './helpers'

// 첫 실행과 준비 단계: 키 없는 첫 화면 → 키 넣기 시트 → 키 확인 → 첫 인사,
// 마이크 권한 미리 확인, 카카오톡 인앱 안내, PWA 설치 정보, 휴대폰 폭 터치 영역

const KEY_URL = 'https://aistudio.google.com/apikey'
const SETTINGS = 'englishFriend.settings'
const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const GREETING = { say: "Hi! I'm Emma. What's your name?", say_ko: '안녕! 나는 Emma야. 이름이 뭐야?' }
const PC_MIC_HELP = '주소창 왼쪽 아이콘을 누르고 마이크를 "허용"으로 바꿔 주세요.'

const UA = {
  // 카카오톡 인앱 브라우저 (안드로이드 웹뷰)
  kakao:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36;KAKAOTALK 2410320',
  // 네이버 앱 인앱 브라우저
  naver:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.10.3)',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
}

// ── 이 파일 안에서만 쓰는 작은 도우미 ──

// 키 없이 열고 '키 넣고 시작하기'로 키 시트를 연다
async function openKeySheet(page: Page) {
  await page.goto('/')
  await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
  await page.click('#btnStart')
  await expect(page.locator('#settingsSheet')).toBeVisible()
}

// 원하는 UA로 새 context를 만들어 연다 (기본 context는 데스크톱 크롬 UA)
async function openWithUA(browser: Browser, baseURL: string | undefined, userAgent: string, opts: MockOptions = {}) {
  const context = await browser.newContext({
    baseURL,
    userAgent,
    viewport: { width: 360, height: 780 },
    isMobile: true,
    hasTouch: true,
  })
  const mocks = await installMocks(context, opts)
  const page = await context.newPage()
  const errors = collectErrors(page)
  await page.goto('/')
  return { context, page, mocks, errors }
}

// 가로로 넘치는 것: 문서 전체 + 스크롤되는 시트 카드 안쪽(카드는 overflow-y:auto라 문서 폭에 안 잡힌다) + 화면 밖으로 나간 요소
async function overflowReport(page: Page) {
  const doc = await horizontalOverflow(page)
  const inner = await page.evaluate(() => {
    const out: string[] = []
    const vw = document.documentElement.clientWidth
    for (const card of document.querySelectorAll<HTMLElement>('.sheet-card')) {
      if (card.closest('[inert]') && !card.closest('#startSheet')) continue
      if (card.scrollWidth - card.clientWidth > 0) out.push(`card ${card.parentElement?.id}: +${card.scrollWidth - card.clientWidth}px`)
      for (const el of card.querySelectorAll<HTMLElement>('*')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        if (r.right > vw + 0.5 || r.left < -0.5)
          out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || '').trim().slice(0, 20)}" ${Math.round(r.left)}~${Math.round(r.right)}`)
      }
    }
    return out
  })
  return { doc, inner }
}

interface Target {
  what: string
  w: number
  h: number
  min: number
  // 문장 속 글자 링크 (WCAG 2.5.8 '문장 안' 예외)
  inline: boolean
}

// 보이는 버튼·링크·체크박스 라벨·펼치기·입력칸 중 터치 영역이 작은 것 (칩은 40, 나머지 44)
async function smallTargets(page: Page, rootSel: string): Promise<Target[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel)
    if (!root) throw new Error('no root ' + sel)
    const out: Target[] = []
    const els = root.querySelectorAll<HTMLElement>(
      'button, a[href], label, summary, select, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden])',
    )
    for (const el of els) {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue
      // 글자 입력칸을 감싸는 라벨(.field)은 누르는 곳이 아니라 이름표. 체크박스 라벨만 본다
      if (el.tagName === 'LABEL' && !el.querySelector('input[type=checkbox], input[type=radio]')) continue
      const min = el.classList.contains('chip') ? 40 : 44
      const inline = el.tagName === 'A' && !el.classList.contains('link-btn') && !!el.closest('p')
      if (r.width + 0.5 < min || r.height + 0.5 < min) {
        const label = (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).name || '').trim().slice(0, 24)
        out.push({
          what: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + String(el.className).split(' ').join('.') : ''} "${label}"`,
          w: Math.round(r.width),
          h: Math.round(r.height),
          min,
          inline,
        })
      }
    }
    return out
  }, rootSel)
}

const micRequests = (page: Page) => page.evaluate(() => (window as unknown as MockWindow).__micRequests ?? 0)

// ─────────────────────────────────────────────
test.describe('1) 키 없는 첫 화면', () => {
  test('처음 열면 3단계 안내·"키 넣고 시작하기"·키 안내 문구가 보이고, 오늘 할 일·오늘 기록은 아직 없다', async ({ page, context }) => {
    const { requests, keyChecks } = await installMocks(context)
    const errors = collectErrors(page)
    await page.goto('/')

    await expect(page).toHaveTitle('영어 친구')
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#startTitle')).toHaveText('AI Emma')
    const guide = page.locator('#firstGuide')
    await expect(guide).toBeVisible()
    await expect(guide.locator('li')).toHaveCount(3)
    await expect(guide).toContainText('「한국어로 말하기」로 대답해도 돼요')
    await expect(guide).toContainText('「대화 끝내기」 → 「저장하고 끝내기」')
    await expect(page.locator('#startMsg')).toHaveText('처음이면 "키 넣고 시작하기"를 눌러 Gemini 키부터 넣어요. 2분이면 돼요.')
    await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
    // 1단계 첫 단원부터
    await expect(page.locator('#courseCard')).toContainText('1단계 · 첫걸음')
    // 화면 글자는 쉬운 우리말
    await expect(page.locator('#courseCard .hero-badge')).toHaveText(/^오늘의 단원 \d\d$/)
    await expect(page.locator('#btnListen b')).toHaveText('듣고 따라 하기')
    await expect(page.locator('#courseCard .hero-title')).toHaveText('인사와 자기소개')
    // 처음엔 오늘 할 일·연속 일수·승급 진행이 없다
    await expect(page.locator('#todayRoutine')).toHaveCount(0)
    await expect(page.locator('#todayLine')).toHaveCount(0)
    await expect(page.locator('#promoProgress')).toHaveCount(0)
    await expect(page.locator('#draftCard')).toHaveCount(0)
    await expect(page.locator('#inAppBanner')).toHaveCount(0)
    // 열기만 해서는 AI를 부르지 않는다
    expect(requests).toHaveLength(0)
    expect(keyChecks).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('다른 기기에서 진도만 옮겨 왔고 키가 없으면 "진도는 옮겨졌어요" 안내와 오늘 할 일이 보인다', async ({ page, context }) => {
    await installMocks(context, {
      storage: {
        'englishFriend.progress': {
          stage: 1,
          unit: 's1-2',
          doneUnits: ['s1-1'],
          sessions: [
            { id: '0abc-1', date: '2026-10-01', stage: 1, unit: 's1-1', minutes: 10, turns: 8, koTurns: 4, enOwnTurns: 2, enOwnWords: 4, repeatTurns: 2 },
          ],
        },
      },
    })
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('#startMsg')).toHaveText('진도는 옮겨졌어요. 이 기기에 Gemini 키만 넣으면 이어서 해요.')
    await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
    await expect(page.locator('#firstGuide')).toHaveCount(0)
    await expect(page.locator('#todayRoutine')).toBeVisible()
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('2) 키 넣기 시트', () => {
  test('시작 버튼을 누르면 키 받는 법·AI Studio 링크·키 칸이 있는 시트가 열리고, 키 칸에 바로 커서가 간다', async ({ page, context }) => {
    const { requests, keyChecks } = await installMocks(context)
    const errors = collectErrors(page)
    await openKeySheet(page)

    const sheet = page.locator('#settingsSheet')
    await expect(sheet).toHaveAttribute('role', 'dialog')
    await expect(sheet).toHaveAttribute('aria-modal', 'true')
    await expect(page.locator('#settingsSheet-title')).toHaveText('Gemini 키 넣기')
    const guide = page.locator('#keyGuide')
    await expect(guide).toBeVisible()
    await expect(guide).toContainText('키 받는 법 (2분, 무료)')
    await expect(guide.locator('ol li')).toHaveCount(4)
    await expect(guide).toContainText('"저장하고 시작하기"를 눌러요')
    const studio = page.locator('#btnOpenStudio')
    await expect(studio).toHaveAttribute('href', KEY_URL)
    await expect(studio).toHaveAttribute('target', '_blank')
    await expect(studio).toHaveAttribute('rel', /noopener/)
    // 키 칸: 가려진 입력, 자동 완성 끔. 폰 키보드가 '키 받는 법'을 가리지 않게 자동 포커스는 하지 않는다 (제목에 포커스)
    const key = sheet.locator('input[name=apiKey]')
    await expect(key).toHaveAttribute('type', 'password')
    await expect(key).toHaveAttribute('autocomplete', 'off')
    await expect(key).not.toBeFocused()
    await expect(page.locator('#settingsSheet-title')).toBeFocused()
    // 낭독기가 칸 이름을 읽을 수 있게 이름표가 연결돼 있다
    await expect(page.getByLabel('Gemini API 키')).toHaveAttribute('name', 'apiKey')
    await expect(page.locator('#btnSettingsSave')).toHaveText('저장하고 시작하기')
    await expect(page.locator('#btnSettingsCancel')).toHaveText('나중에')
    // 고급 설정은 첫 실행에서 안 보인다
    await expect(sheet.locator('#advanced')).toHaveCount(0)
    // 시트 뒤 시작 화면은 누를 수 없다
    await expect(page.locator('#startSheet')).toHaveAttribute('inert', '')
    // '보기'로 키를 확인할 수 있다
    await key.fill('AIzaSHOW')
    await sheet.getByRole('button', { name: '보기' }).click()
    await expect(key).toHaveAttribute('type', 'text')
    await expect(sheet.getByRole('button', { name: '가리기' })).toHaveAttribute('aria-pressed', 'true')
    expect(requests).toHaveLength(0)
    expect(keyChecks).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('AI Studio 링크는 새 탭으로 열리고, 돌아오면 키 시트가 그대로 있다', async ({ page, context }) => {
    await installMocks(context)
    await context.route('https://aistudio.google.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>studio</p>' }))
    const errors = collectErrors(page)
    await openKeySheet(page)
    const [popup] = await Promise.all([context.waitForEvent('page'), page.click('#btnOpenStudio')])
    await popup.waitForLoadState()
    expect(popup.url()).toBe(KEY_URL)
    await popup.close()
    await page.bringToFront()
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await expect(page.locator('#keyGuide')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('따옴표·공백이 섞인 키를 붙여 넣어도 깨끗한 키로 확인·저장하고, 키는 헤더로만 보낸다', async ({ page, context }) => {
    const { requests, keyChecks, queue } = await installMocks(context)
    const errors = collectErrors(page)
    await openKeySheet(page)
    const key = page.locator('#settingsSheet input[name=apiKey]')
    await key.fill('  "AIzaTEST" ')
    // 따옴표·공백만 섞였으면 "AIza로 시작해요" 경고를 띄우지 않는다
    await expect(page.locator('#keyField .warn-text')).toHaveCount(0)
    queue.push(reply(turn(GREETING)))
    await page.click('#btnSettingsSave')
    await expect(aiBubbles(page)).toHaveCount(1)

    expect(keyChecks).toHaveLength(1)
    expect(keyChecks[0].headers['x-goog-api-key']).toBe('AIzaTEST')
    expect(keyChecks[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}`)
    expect(keyChecks[0].url).not.toContain('AIza')
    expect(keyChecks[0].url).not.toContain('key=')
    expect((await storageGet(page, SETTINGS)).apiKey).toBe('AIzaTEST')
    expect(requests).toHaveLength(1)
    expect(requests[0].headers['x-goog-api-key']).toBe('AIzaTEST')
    expect(requests[0].url).not.toContain('AIza')
    expect(errors).toEqual([])
  })

  test('AIza로 시작하지 않는 글자를 넣으면 경고하고, 빈 칸으로 저장하면 확인 요청 없이 "키를 먼저" 안내', async ({ page, context }) => {
    const { requests, keyChecks } = await installMocks(context)
    const errors = collectErrors(page)
    await openKeySheet(page)
    const key = page.locator('#settingsSheet input[name=apiKey]')
    await key.fill('복사가 잘못된 글자')
    await expect(page.locator('#keyField .warn-text')).toHaveText('키는 보통 "AIza"로 시작해요. 다른 글자가 섞이지 않았는지 확인해 주세요.')
    await key.fill('')
    await expect(page.locator('#keyField .warn-text')).toHaveCount(0)
    await page.click('#btnSettingsSave')
    await expect(page.locator('#keyCheck')).toHaveText('키를 먼저 붙여 넣어 주세요.')
    // 공백·따옴표만 넣어도 빈 키로 본다
    await key.fill('  "" ')
    await page.click('#btnSettingsSave')
    await expect(page.locator('#keyCheck')).toHaveText('키를 먼저 붙여 넣어 주세요.')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    expect(keyChecks).toHaveLength(0)
    expect(requests).toHaveLength(0)
    expect(await storageGet(page, SETTINGS)).toBeNull()
    expect(errors).toEqual([])
  })

  test('"붙여넣기" 버튼을 누르면 클립보드의 키를 칸에 넣고, 그 키로 시작한다', async ({ page, context }) => {
    const { keyChecks, queue } = await installMocks(context)
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.evaluate(() => navigator.clipboard.writeText('  AIzaCLIP  '))
    await page.locator('#keyField').getByRole('button', { name: '붙여넣기' }).click()
    await expect(page.locator('#settingsSheet input[name=apiKey]')).toHaveValue('AIzaCLIP')
    queue.push(reply(turn(GREETING)))
    await page.click('#btnSettingsSave')
    await expect(aiBubbles(page)).toHaveCount(1)
    expect(keyChecks[0].headers['x-goog-api-key']).toBe('AIzaCLIP')
    expect(errors).toEqual([])
  })

  test('클립보드를 못 읽는 브라우저에서 "붙여넣기"를 누르면 길게 누르기·Ctrl+V로 붙여 넣으라고 안내', async ({ page, context }) => {
    await installMocks(context)
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new Error('denied')) }, configurable: true })
    })
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.locator('#keyField').getByRole('button', { name: '붙여넣기' }).click()
    await expect(page.locator('#keyCheck')).toHaveText('자동 붙여넣기가 안 돼요. 칸을 길게 누르거나 Ctrl+V로 붙여 넣어 주세요.')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('3) 키 확인 실패', () => {
  const cases = [
    { status: 400, message: 'API key not valid. Please pass a valid API key.', expectText: 'API 키가 맞지 않아요. 설정에서 키를 다시 붙여 넣어 주세요.' },
    { status: 403, message: 'Permission denied: Consumer has been suspended.', expectText: 'API 키 권한 문제예요. 키가 막혔거나 지워졌을 수 있어요. 새 키를 받아 넣어 보세요.' },
  ]
  for (const c of cases) {
    test(`키 확인이 ${c.status}이면 한국어로 알려 주고, 시트를 닫지 않고, 대화도 시작하지 않는다 (고쳐서 다시 저장하면 시작)`, async ({
      page,
      context,
    }) => {
      const { requests, keyChecks, keyCheck, queue } = await installMocks(context)
      Object.assign(keyCheck, errorReply(c.status, c.message))
      const errors = collectErrors(page)
      await openKeySheet(page)
      await page.locator('#settingsSheet input[name=apiKey]').fill('AIzaBAD')
      await page.click('#btnSettingsSave')

      const line = page.locator('#keyCheck')
      await expect(line).toContainText(c.expectText)
      await expect(line).toContainText(c.message.slice(0, 20)) // 원문도 같이 보여 준다
      await expect(line).toHaveAttribute('role', 'alert')
      // 키 문제는 '확인 없이 저장'으로 넘어가게 하지 않는다
      await expect(line.getByRole('button', { name: '확인 없이 저장' })).toHaveCount(0)
      await expect(page.locator('#settingsSheet')).toBeVisible()
      await expect(page.locator('#btnSettingsSave')).toBeEnabled()
      await expect(page.locator('#composer')).toHaveCount(0)
      expect(keyChecks).toHaveLength(1)
      expect(requests).toHaveLength(0)
      expect(await storageGet(page, SETTINGS)).toBeNull()

      // 새 키로 고치면 바로 시작
      Object.assign(keyCheck, { status: 200, payload: { name: `models/${DEFAULT_MODEL}` } })
      queue.push(reply(turn(GREETING)))
      await page.locator('#settingsSheet input[name=apiKey]').fill('AIzaGOOD')
      await page.click('#btnSettingsSave')
      await expect(aiBubbles(page)).toHaveCount(1)
      expect(keyChecks).toHaveLength(2)
      expect(keyChecks[1].headers['x-goog-api-key']).toBe('AIzaGOOD')
      expect(requests).toHaveLength(1)
      expect(requests[0].headers['x-goog-api-key']).toBe('AIzaGOOD')
      expect(errors).toEqual([])
    })
  }

  test('키 확인 중 인터넷이 끊기면 "연결하지 못했어요"와 "확인 없이 저장"을 보여 주고, 그걸 누르면 저장하고 시작한다', async ({
    page,
    context,
  }) => {
    const { requests, keyChecks, queue } = await installMocks(context)
    // 키 확인(GET)만 네트워크 오류로 끊는다 (페이지 route가 context route보다 먼저 받는다)
    await page.route('https://generativelanguage.googleapis.com/**', (route) =>
      route.request().method() === 'GET' ? route.abort('internetdisconnected') : route.fallback(),
    )
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.locator('#settingsSheet input[name=apiKey]').fill('AIzaNET')
    await page.click('#btnSettingsSave')
    const line = page.locator('#keyCheck')
    await expect(line).toContainText('AI 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    expect(requests).toHaveLength(0)
    expect(keyChecks).toHaveLength(0) // 끊긴 요청은 가짜 서버까지 오지 않는다
    expect(await storageGet(page, SETTINGS)).toBeNull()

    queue.push(reply(turn(GREETING)))
    await line.getByRole('button', { name: '확인 없이 저장' }).click()
    await expect(aiBubbles(page)).toHaveCount(1)
    expect((await storageGet(page, SETTINGS)).apiKey).toBe('AIzaNET')
    expect(requests).toHaveLength(1)
    // 일부러 끊은 요청의 브라우저 기록 한 줄만 뺀다
    expect(errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e))).toEqual([])
  })

  test('키 확인이 서버 오류(500)면 "잠시 바빠요"와 "확인 없이 저장"을 보여 준다', async ({ page, context }) => {
    const { requests, keyCheck } = await installMocks(context)
    Object.assign(keyCheck, errorReply(500, 'Internal error'))
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.locator('#settingsSheet input[name=apiKey]').fill('AIza500')
    await page.click('#btnSettingsSave')
    await expect(page.locator('#keyCheck')).toContainText('AI 서버가 잠시 바빠요')
    await expect(page.locator('#keyCheck').getByRole('button', { name: '확인 없이 저장' })).toBeVisible()
    await expect(page.locator('#settingsSheet')).toBeVisible()
    expect(requests).toHaveLength(0)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('4) 키 확인 성공', () => {
  test('"저장하고 시작하기": 확인 중엔 버튼을 잠그고, 저장한 뒤 바로 1단계 첫 단원 인사를 받는다', async ({ page, context }) => {
    const { requests, keyChecks, keyCheck, queue } = await installMocks(context)
    keyCheck.delayMs = 600
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.locator('#settingsSheet input[name=apiKey]').fill('AIzaOK')
    queue.push(reply(turn(GREETING)))
    await page.click('#btnSettingsSave')
    await expect(page.locator('#keyCheck')).toHaveText('키 확인 중…')
    await expect(page.locator('#btnSettingsSave')).toBeDisabled()

    await expect(aiBubbles(page)).toHaveCount(1)
    await expect(aiBubbles(page).first()).toContainText(GREETING.say)
    await expect(aiBubbles(page).first()).toContainText(GREETING.say_ko)
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('#startSheet')).toHaveCount(0)
    await expect(page.locator('#composer')).toBeVisible()
    await expect(page.locator('#friendName')).toHaveText('Emma')

    expect(keyChecks).toHaveLength(1)
    expect(requests).toHaveLength(1)
    const r = requests[0]
    expect(r.url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`)
    expect(r.headers['x-goog-api-key']).toBe('AIzaOK')
    const sys = systemText(r)
    expect(sys).toContain('교육과정 1단계 「첫걸음」')
    expect(sys).toContain('[오늘 단원] 인사와 자기소개')
    expect(r.body.contents).toHaveLength(1)
    expect(lastUserText(r)).toContain('「인사와 자기소개」')
    const saved = await storageGet(page, SETTINGS)
    expect(saved.apiKey).toBe('AIzaOK')
    expect(saved.model).toBe(DEFAULT_MODEL)
    // 첫 인사를 소리로 읽어 준다
    await expect.poll(async () => (await page.evaluate(() => (window as unknown as MockWindow).__spoken)).some((s) => s.text === GREETING.say)).toBe(true)
    expect(errors).toEqual([])
  })

  test('키 없이 ⚙️ 설정에서 키를 넣으면 확인 후 저장만 하고(대화는 안 시작), 시작 버튼이 "시작하기"로 바뀐다', async ({ page, context }) => {
    const { requests, keyChecks } = await installMocks(context)
    const errors = collectErrors(page)
    await page.goto('/')
    await page.click('#tab-library')
    await page.click('#btnStartSettings')
    await expect(page.locator('#settingsSheet-title')).toHaveText('설정')
    await expect(page.locator('#btnSettingsSave')).toHaveText('저장')
    await page.locator('#settingsSheet input[name=apiKey]').fill('AIzaSET')
    await page.click('#btnSettingsSave')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await page.click('#tab-home')
    await expect(page.locator('#btnStart')).toHaveText('지금 Emma와 수다 떨기')
    await expect(page.locator('#startMsg')).toHaveCount(0)
    expect(keyChecks).toHaveLength(1)
    expect(keyChecks[0].headers['x-goog-api-key']).toBe('AIzaSET')
    expect(requests).toHaveLength(0)
    expect((await storageGet(page, SETTINGS)).apiKey).toBe('AIzaSET')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('5) 나중에', () => {
  test('"나중에"를 누르면 시트만 닫히고 대화는 안 시작하며, 다시 시작을 누르면 또 키 시트가 열린다', async ({ page, context }) => {
    const { requests, keyChecks } = await installMocks(context)
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.click('#btnSettingsCancel')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#startSheet')).not.toHaveAttribute('inert', '')
    await expect(page.locator('#composer')).toHaveCount(0)
    await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
    await expect(page.locator('#firstGuide')).toBeVisible()
    expect(await storageGet(page, SETTINGS)).toBeNull()

    await page.click('#btnStart')
    await expect(page.locator('#settingsSheet-title')).toHaveText('Gemini 키 넣기')
    await expect(page.locator('#keyGuide')).toBeVisible()
    await expect(page.locator('#btnSettingsSave')).toHaveText('저장하고 시작하기')
    expect(requests).toHaveLength(0)
    expect(keyChecks).toHaveLength(0)
    expect(errors).toEqual([])
  })

  test('키를 넣다가 "나중에"를 누르면 한 번 묻고, 취소하면 그대로·확인하면 저장 없이 닫는다', async ({ page, context }) => {
    const { requests, keyChecks } = await installMocks(context)
    const errors = collectErrors(page)
    await openKeySheet(page)
    await page.locator('#settingsSheet input[name=apiKey]').fill('AIzaHALF')
    const dialogs: string[] = []
    page.once('dialog', (d) => {
      dialogs.push(d.message())
      void d.dismiss()
    })
    await page.click('#btnSettingsCancel')
    await expect.poll(() => dialogs.length).toBe(1)
    expect(dialogs[0]).toBe('바꾼 내용을 저장하지 않고 닫을까요?')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await expect(page.locator('#settingsSheet input[name=apiKey]')).toHaveValue('AIzaHALF')

    page.once('dialog', (d) => void d.accept())
    await page.click('#btnSettingsCancel')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    expect(await storageGet(page, SETTINGS)).toBeNull()
    expect(requests).toHaveLength(0)
    expect(keyChecks).toHaveLength(0)
    expect(errors).toEqual([])
  })

  const closers: { name: string; act: (page: Page) => Promise<unknown> }[] = [
    { name: '✕ 버튼', act: (page) => page.locator('#settingsSheet .sheet-x').click() },
    { name: 'Esc 키', act: (page) => page.keyboard.press('Escape') },
    // 휴대폰 폭에서는 창이 화면을 꽉 채우므로, 넓은 화면에서 양옆의 어두운 곳을 누른다
    {
      name: '바깥(어두운 곳) 누르기',
      act: async (page) => {
        await page.setViewportSize({ width: 900, height: 844 })
        await page.locator('#settingsSheet').click({ position: { x: 10, y: 10 } })
      },
    },
    // 안드로이드 뒤로 가기: 앱을 떠나지 않고 시트만 닫는다
    { name: '뒤로 가기', act: (page) => page.goBack() },
  ]
  for (const c of closers) {
    test(`키 시트는 ${c.name}로도 닫히고 대화는 시작하지 않는다`, async ({ page, context }) => {
      const { requests, keyChecks } = await installMocks(context)
      const errors = collectErrors(page)
      await openKeySheet(page)
      await c.act(page)
      await expect(page.locator('#settingsSheet')).toHaveCount(0)
      await expect(page.locator('#startSheet')).toBeVisible()
      expect(new URL(page.url()).origin).toBe(new URL(test.info().project.use.baseURL ?? page.url()).origin)
      // 닫은 뒤에도 다시 열 수 있다
      await page.click('#btnStart')
      await expect(page.locator('#keyGuide')).toBeVisible()
      expect(requests).toHaveLength(0)
      expect(keyChecks).toHaveLength(0)
      expect(errors).toEqual([])
    })
  }

  test('키 시트를 닫으면 키보드 포커스가 "키 넣고 시작하기" 버튼으로 돌아온다', async ({ page, context }) => {
    await installMocks(context)
    const errors = collectErrors(page)
    await page.goto('/')
    await page.locator('#btnStart').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('#settingsSheet')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#settingsSheet')).toHaveCount(0)
    await expect(page.locator('#btnStart')).toBeFocused()
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('6) 첫 인사에서 키 오류', () => {
  const cases = [
    { status: 401, message: 'Request had invalid authentication credentials.', expectText: 'API 키 권한 문제예요' },
    { status: 403, message: 'Permission denied: API key was reported as leaked.', expectText: 'API 키 권한 문제예요' },
    { status: 400, message: 'API key expired. Please renew the API key.', expectText: 'API 키가 맞지 않아요' },
  ]
  for (const c of cases) {
    test(`저장된 키로 시작했는데 첫 인사가 ${c.status}면, 빈 대화 대신 안내와 함께 키 시트로 돌아가고, 고치면 바로 시작`, async ({
      page,
      context,
    }) => {
      const { requests, keyChecks, queue } = await installMocks(context, { storage: { [SETTINGS]: { apiKey: 'AIzaOLD' } } })
      const errors = collectErrors(page)
      await page.goto('/')
      await expect(page.locator('#btnStart')).toHaveText('지금 Emma와 수다 떨기')
      queue.push(errorReply(c.status, c.message))
      await page.click('#btnStart')

      await expect(page.locator('#settingsSheet')).toBeVisible()
      await expect(page.locator('#settingsSheet-title')).toHaveText('Gemini 키 넣기')
      await expect(page.locator('#settingsNotice')).toContainText(c.expectText)
      await expect(page.locator('#keyGuide')).toBeVisible()
      await expect(page.locator('#btnSettingsSave')).toHaveText('저장하고 시작하기')
      const key = page.locator('#settingsSheet input[name=apiKey]')
      await expect(key).toBeFocused()
      await expect(key).toHaveValue('AIzaOLD')
      // 뒤는 시작 화면 (빈 대화 화면이나 오류 말풍선에 두지 않는다)
      await expect(page.locator('#startSheet')).toBeVisible()
      await expect(page.locator('#composer')).toHaveCount(0)
      await expect(page.locator('.msg')).toHaveCount(0)
      await expect(page.locator('#firstGuide')).toBeVisible()
      expect(requests).toHaveLength(1)
      expect(requests[0].headers['x-goog-api-key']).toBe('AIzaOLD')

      queue.push(reply(turn(GREETING)))
      await key.fill('AIzaNEW')
      await page.click('#btnSettingsSave')
      await expect(aiBubbles(page)).toHaveCount(1)
      await expect(page.locator('.msg.error')).toHaveCount(0)
      expect(keyChecks).toHaveLength(1)
      expect(keyChecks[0].headers['x-goog-api-key']).toBe('AIzaNEW')
      expect(requests).toHaveLength(2)
      expect(requests[1].headers['x-goog-api-key']).toBe('AIzaNEW')
      expect(requests[1].body.contents).toHaveLength(1)
      expect((await storageGet(page, SETTINGS)).apiKey).toBe('AIzaNEW')
      // 버린 대화는 임시 저장으로 남지 않는다
      expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('englishFriend.draft.')))).toEqual([])
      expect(errors).toEqual([])
    })
  }
})

// ─────────────────────────────────────────────
test.describe('7) 마이크 권한 미리 확인', () => {
  test('권한을 아직 안 정했으면 "마이크 켜기"가 보이고, 허용하면 "마이크 준비됨"으로 바뀐다', async ({ page, context }) => {
    await installMocks(context, { mic: { state: 'prompt', allow: true } })
    const errors = collectErrors(page)
    await page.goto('/')
    const status = page.locator('#micStatus')
    await expect(status).toContainText('말하기에 마이크가 필요해요.')
    await expect(page.locator('#btnMicAllow')).toHaveText('마이크 켜기')
    await page.click('#btnMicAllow')
    await expect(status).toHaveText('마이크 준비됨')
    await expect(page.locator('#btnMicAllow')).toHaveCount(0)
    expect(await micRequests(page)).toBe(1)
    // 처음 허용할 때는 '다시 눌러 보세요' 같은 알림을 띄우지 않는다 (누를 것이 없다)
    expect(await page.locator('#toast.show').count()).toBe(0)
    expect(errors).toEqual([])
  })

  test('권한 창에서 거절하면 막힘 안내(PC: 주소창)로 바뀌고 알림으로도 알려 준다', async ({ page, context }) => {
    await installMocks(context, { mic: { state: 'prompt', allow: false } })
    const errors = collectErrors(page)
    await page.goto('/')
    await page.click('#btnMicAllow')
    await expect(page.locator('#micStatus')).toHaveText(`마이크가 막혀 있어요. ${PC_MIC_HELP}`)
    await expect(page.locator('#btnMicAllow')).toHaveCount(0)
    await expect(page.locator('#toast')).toHaveText(`마이크를 켜지 못했어요. ${PC_MIC_HELP}`)
    expect(errors).toEqual([])
  })

  test('이미 막혀 있으면(denied) 처음부터 PC 크롬 고치는 법을 보여 주고, 설정에서 허용하면 새로고침 없이 "준비됨"으로 바뀐다', async ({
    page,
    context,
  }) => {
    await installMocks(context, { mic: { state: 'denied' } })
    const errors = collectErrors(page)
    await page.goto('/')
    const status = page.locator('#micStatus')
    await expect(status).toHaveText(`마이크가 막혀 있어요. ${PC_MIC_HELP}`)
    await expect(page.locator('#btnMicAllow')).toHaveCount(0)
    // 사용자가 주소창에서 허용으로 바꿈
    await setMic(page, 'granted')
    await expect(status).toHaveText('마이크 준비됨')
    await expect(page.locator('#toast')).toHaveText('이제 마이크가 돼요. 마이크 버튼을 눌러 말해 보세요.')
    expect(await micRequests(page)).toBe(0)
    expect(errors).toEqual([])
  })

  test('대화 중 마이크가 막혀 안내가 떠 있다가 권한이 허용으로 바뀌면 안내가 사라지고 알림이 뜬다', async ({ page, context }) => {
    const { queue } = await installMocks(context, { mic: { state: 'denied' }, storage: { [SETTINGS]: { apiKey: 'AIzaK' } } })
    const errors = collectErrors(page)
    await page.goto('/')
    queue.push(reply(turn(GREETING)))
    await page.click('#btnStart')
    await expect(aiBubbles(page)).toHaveCount(1)
    await expect(page.locator('#guide')).not.toContainText('말하는 중')
    // 막힌 마이크로 말하기를 누름 → 인식기가 not-allowed로 끝남
    await page.click('#micKo')
    await silence(page, 'not-allowed')
    const guide = page.locator('#guide')
    await expect(guide).toHaveClass(/warn/)
    await expect(guide).toContainText(`마이크가 막혀 있어요. ${PC_MIC_HELP} 그동안은 아래 입력칸에 써도 돼요.`)
    await setMic(page, 'granted')
    await expect(page.locator('#toast')).toHaveText('이제 마이크가 돼요. 마이크 버튼을 눌러 말해 보세요.')
    await expect(guide).not.toHaveClass(/warn/)
    await expect(guide).not.toContainText('막혀')
    // 대화 중 권한이 막혀도(denied) 화면이 깨지지 않는다
    await setMic(page, 'denied')
    await expect(page.locator('#composer')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('마이크를 정하지 않은 채 대화에서 처음 눌러 권한 창에서 허용하면, 듣기가 이어지고 말한 것이 그대로 보내진다', async ({ page, context }) => {
    const { queue, requests } = await installMocks(context, { mic: { state: 'prompt', allow: true }, storage: { [SETTINGS]: { apiKey: 'AIzaK' } } })
    const errors = collectErrors(page)
    await page.goto('/')
    queue.push(reply(turn(GREETING)))
    await page.click('#btnStart')
    await expect(aiBubbles(page)).toHaveCount(1)
    await expect(page.locator('#guide')).not.toContainText('말하는 중')
    await page.click('#micKo')
    await expect(page.locator('#guide')).toContainText('듣는 중…')
    // 브라우저 권한 창에서 '허용'을 누른 것 (인식기는 그대로 듣고 있다)
    await setMic(page, 'granted')
    await expect(page.locator('#micKo')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#guide')).toContainText('듣는 중…')
    // 듣는 중인데 '다시 눌러 보세요' 알림이 뜨면, 따라 누르다 빈 말로 멈춘다
    expect(await page.locator('#toast.show').count()).toBe(0)
    queue.push(reply(turn({ say: 'Nice to meet you!', say_ko: '만나서 반가워!' })))
    await say(page, '안녕 나는 민수야')
    await expect(aiBubbles(page)).toHaveCount(2)
    expect(lastUserText(requests[1])).toContain('안녕 나는 민수야')
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('8) 카카오톡 같은 앱 안 브라우저', () => {
  test('카카오톡 인앱이면 크롬으로 열라는 배너와 kakaotalk://web/openExternal 버튼을 보여 주고, 마이크 줄은 숨긴다', async ({
    browser,
    baseURL,
  }) => {
    const { context, page, errors } = await openWithUA(browser, baseURL, UA.kakao)
    try {
      const banner = page.locator('#inAppBanner')
      await expect(banner).toBeVisible()
      await expect(banner).toHaveAttribute('role', 'alert')
      await expect(banner).toContainText('카카오톡·네이버 같은 앱 안에서는 마이크와 저장이 제대로 안 돼요. 크롬에서 열어 주세요.')
      const btn = page.locator('#btnOpenChrome')
      await expect(btn).toHaveText('크롬으로 열기')
      // 안드로이드 카카오톡: 크롬을 콕 집어 열고(기본 브라우저가 삼성 인터넷이어도), 안 되면 기본 브라우저로 여는 두 번째 버튼
      const u = new URL(page.url())
      await expect(btn).toHaveAttribute(
        'href',
        `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=http;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(page.url())};end`,
      )
      await expect(page.locator('#btnOpenExternal')).toHaveAttribute('href', 'kakaotalk://web/openExternal?url=' + encodeURIComponent(page.url()))
      await expect(page.locator('#micStatus')).toHaveCount(0)
      // 배너가 있어도 키 넣고 시작하기는 그대로 된다
      await expect(page.locator('#btnStart')).toHaveText('키 넣고 시작하기')
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('네이버 앱 같은 다른 인앱(안드로이드)이면 크롬 intent:// 주소로 연다', async ({ browser, baseURL }) => {
    const { context, page, errors } = await openWithUA(browser, baseURL, UA.naver)
    try {
      await expect(page.locator('#inAppBanner')).toBeVisible()
      const u = new URL(page.url())
      await expect(page.locator('#btnOpenChrome')).toHaveAttribute(
        'href',
        `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=http;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(page.url())};end`,
      )
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('안드로이드 크롬에서는 배너가 없고, 마이크가 막혔으면 휴대폰 설정 경로로 안내한다', async ({ browser, baseURL }) => {
    const { context, page, errors } = await openWithUA(browser, baseURL, UA.androidChrome, { mic: { state: 'denied' } })
    try {
      await expect(page.locator('#startSheet')).toBeVisible()
      await expect(page.locator('#inAppBanner')).toHaveCount(0)
      await expect(page.locator('#btnOpenChrome')).toHaveCount(0)
      await expect(page.locator('#micStatus')).toContainText('마이크가 막혀 있어요. 주소창 왼쪽 아이콘 → 권한 → 마이크')
      await expect(page.locator('#micStatus')).toContainText('휴대폰 설정 → 애플리케이션 → Chrome → 권한 → 마이크')
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('PC 크롬에서는 앱 안 브라우저 배너가 없다', async ({ page, context }) => {
    await installMocks(context)
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(page.locator('#inAppBanner')).toHaveCount(0)
    await expect(page.locator('#btnOpenChrome')).toHaveCount(0)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('9) 홈 화면에 추가(PWA)', () => {
  test('manifest: 이름·standalone·시작 주소·아이콘 3개(192, 512, 512 maskable)', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toMatch(/manifest\+json|json/)
    const m = await res.json()
    expect(m.name).toBe('영어 친구')
    expect(m.short_name).toBeTruthy()
    expect(m.short_name.length).toBeLessThanOrEqual(12)
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.lang).toBe('ko')
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(m.icons).toHaveLength(3)
    expect(m.icons.map((i: { sizes: string }) => i.sizes).sort()).toEqual(['192x192', '512x512', '512x512'])
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
    expect(m.icons.every((i: { type: string }) => i.type === 'image/png')).toBe(true)
  })

  test('아이콘 PNG 3개가 200으로 오고, 실제 크기가 manifest와 같다', async ({ request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json()
    for (const icon of m.icons as { src: string; sizes: string }[]) {
      const res = await request.get(icon.src)
      expect(res.status(), icon.src).toBe(200)
      expect(res.headers()['content-type'], icon.src).toBe('image/png')
      const buf = await res.body()
      // PNG 서명과 IHDR의 가로·세로
      expect(buf.subarray(0, 8).toString('hex'), icon.src).toBe('89504e470d0a1a0a')
      expect(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, icon.src).toBe(icon.sizes)
    }
    const fav = await request.get('/favicon.svg')
    expect(fav.status()).toBe(200)
  })

  test('index.html에 manifest 링크·theme-color·apple-touch-icon이 있고, 브라우저가 manifest를 읽는다', async ({ page, context }) => {
    await installMocks(context)
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest')
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/icon-192.png')
    // 시안처럼 다크가 기본: 주소창 색은 하나, 화면 테마를 바꾸면 그 색으로 바뀐다
    const themes = page.locator('meta[name=theme-color]')
    await expect(themes).toHaveCount(1)
    await expect(themes).toHaveAttribute('content', '#0f172a')
    const m = await page.evaluate(async () => (await fetch(document.querySelector<HTMLLinkElement>('link[rel=manifest]')!.href)).json())
    expect(m.theme_color).toBe('#0f172a')
    await page.click('#tab-library')
    await page.click('#btnThemeLight')
    await expect(themes).toHaveAttribute('content', '#f8fafc')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.locator('meta[name=viewport]')).toHaveAttribute('content', /width=device-width/)
    expect(errors).toEqual([])
  })
})

// ─────────────────────────────────────────────
test.describe('10) 360px 휴대폰 폭', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true })

  test('첫 화면(마이크 아직 안 정함)과 키 시트: 가로 넘침이 없다', async ({ page, context }) => {
    await installMocks(context, { mic: { state: 'prompt', allow: true } })
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('#btnMicAllow')).toBeVisible()
    expect(await overflowReport(page)).toEqual({ doc: 0, inner: [] })

    await page.click('#btnStart')
    await expect(page.locator('#keyGuide')).toBeVisible()
    await page.locator('#settingsSheet input[name=apiKey]').fill('not-a-key-' + 'x'.repeat(60))
    await expect(page.locator('#keyField .warn-text')).toBeVisible()
    expect(await overflowReport(page)).toEqual({ doc: 0, inner: [] })
    expect(errors).toEqual([])
  })

  test('첫 화면(마이크 아직 안 정함): 보이는 버튼·링크가 모두 44x44 이상', async ({ page, context }) => {
    await installMocks(context, { mic: { state: 'prompt', allow: true } })
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.locator('#btnMicAllow')).toBeVisible()
    const small = await smallTargets(page, '#startSheet')
    expect(small.filter((t) => !t.inline)).toEqual([])
    expect(errors).toEqual([])
  })

  test('키 시트: 보이는 버튼·링크·입력칸이 모두 44x44 이상', async ({ page, context }) => {
    await installMocks(context)
    const errors = collectErrors(page)
    await openKeySheet(page)
    const small = await smallTargets(page, '#settingsSheet')
    expect(small.filter((t) => !t.inline)).toEqual([])
    expect(errors).toEqual([])
  })

  test('키를 넣은 뒤의 설정 시트(고급 펼침 포함): 가로 넘침이 없고, 버튼·링크·체크박스 라벨이 44x44 이상 (문장 속 글자 링크는 예외)', async ({
    page,
    context,
  }) => {
    await installMocks(context, { storage: { [SETTINGS]: { apiKey: 'AIzaKEY0123456789' } } })
    const errors = collectErrors(page)
    await page.goto('/')
    await page.click('#tab-library')
    await page.click('#btnStartSettings')
    await expect(page.locator('#keyStatus')).toContainText('연결됨 ✓ (…6789)')
    await page.locator('#advanced > summary').click()
    await expect(page.locator('#voiceSelect')).toBeVisible()
    expect(await overflowReport(page)).toEqual({ doc: 0, inner: [] })

    const small = await smallTargets(page, '#settingsSheet')
    const inline = small.filter((t) => t.inline)
    // 예외: "키가 없으면 Google AI Studio에서…" 문장 속 링크 (WCAG 2.5.8 문장 안 예외). 그 밖의 예외는 없어야 한다
    expect(inline.map((t) => t.what)).toEqual(['a "Google AI Studio"'])
    test.info().annotations.push({ type: '예외(문장 속 링크)', description: inline.map((t) => `${t.what} ${t.w}x${t.h}`).join(', ') })
    expect(small.filter((t) => !t.inline)).toEqual([])
    expect(errors).toEqual([])
  })
})
