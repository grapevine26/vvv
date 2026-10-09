import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectErrors, horizontalOverflow, installMocks, storageGet } from './helpers'

// 4) 기록 백업: 시작 화면 안내(#backupReminder) → 옮기기 시트에서 파일로 저장 → 안내가 사라짐,
// 다른 기기(새 context)에서 그 파일로 되살리기(합치기), 잘못된 파일 오류, 처음 쓰는 날엔 안내 없음.
// 날짜 계산이 있어서 한국 시간 2026-10-08 오전 10시에서 시작하는 가짜 시계로 돈다.

test.use({ timezoneId: 'Asia/Seoul' })

const NOW = new Date('2026-10-08T10:00:00+09:00')
const TODAY = '2026-10-08'
const day = (offset: number) => new Date(Date.UTC(2026, 9, 8 + offset)).toISOString().slice(0, 10)

const K = {
  settings: 'englishFriend.settings',
  learned: 'englishFriend.learned',
  progress: 'englishFriend.progress',
  lastBackup: 'englishFriend.lastBackup',
}
const FILE_NAME = `english-friend-backup-${TODAY}.txt`
const NOTE = '영어 친구 기록 백업 파일이에요. 앱의 "폰↔PC 옮기기" → "파일에서 되살리기"로 이 파일을 고르면 기록이 돌아와요.'

interface Learned {
  en: string
  ko: string
  date: string
}
let seq = 0
const log = (date: string, extra: Record<string, unknown> = {}) => ({
  id: `00bk${String(++seq).padStart(4, '0')}`,
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

// 기록이 4일 전부터 있는 폰 (백업은 한 번도 안 함)
const A_LEARNED: Learned[] = [
  { en: 'I like coffee.', ko: '커피 좋아해.', date: day(-4) },
  { en: 'Nice to meet you.', ko: '만나서 반가워.', date: day(-2) },
]
const A_PROGRESS = {
  stage: 2,
  unit: 's2-2',
  doneUnits: [...S1_ALL, 's2-1'],
  sessions: [log(day(-4), { id: '00a0001' }), log(day(-2), { id: '00a0002', stage: 2, unit: 's2-1' })],
}

interface OpenOptions {
  settings?: Record<string, unknown> | null
  storage?: Record<string, unknown>
}

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

async function openOtherDevice(browser: Browser, baseURL: string | undefined, opts: OpenOptions = {}) {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Seoul' })
  const page = await context.newPage()
  const r = await open(page, context, opts)
  return { context, page, ...r }
}

const learnedIn = async (page: Page) => ((await storageGet(page, K.learned)) as Learned[] | null) ?? []

// 시트에서 파일로 저장하고 내려받은 파일의 이름·글을 돌려준다
async function saveBackup(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnBackupSave')])
  const path = await download.path()
  return { name: download.suggestedFilename(), text: await readFile(path, 'utf8') }
}

test.describe('4) 기록 백업', () => {
  test('기록 4일째·백업 없음 → 안내 → "지금 백업하기" → 파일로 저장(안내 줄+빈 줄+코드) → 안내 사라짐', async ({ page, context }) => {
    const { errors } = await open(page, context, {
      settings: { apiKey: 'SECRET_KEY_A' },
      storage: { [K.learned]: A_LEARNED, [K.progress]: A_PROGRESS },
    })
    const reminder = page.locator('#backupReminder')
    await expect(reminder).toBeVisible()
    await expect(reminder).toContainText('백업')
    await page.click('#btnBackupNow')
    await expect(page.locator('#transferSheet')).toBeVisible()
    await expect(page.locator('#transferSheet-title')).toBeFocused()
    await expect(page.locator('#backupLast')).toHaveText('마지막 백업: 아직 한 번도 안 했어요')
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)

    // 누르는 것은 모두 44px 이상
    for (const id of ['#btnBackupSave', '#btnBackupRestore']) {
      const box = await page.locator(id).boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(box?.width).toBeGreaterThanOrEqual(44)
    }

    const { name, text } = await saveBackup(page)
    expect(name).toBe(FILE_NAME)
    const lines = text.split('\n')
    expect(lines[0]).toBe(NOTE)
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^EF1\.[A-Za-z0-9_-]+$/)
    // 키는 파일에 넣지 않는다
    expect(text).not.toContain('SECRET_KEY_A')

    const result = page.locator('#transferResult')
    await expect(result).toContainText(`"${FILE_NAME}" 파일 저장을 시작했어요`)
    // 브라우저가 내려받기를 조용히 막을 수도 있어서, 안 되면 코드를 쓰라고 함께 알린다
    await expect(result).toContainText('내보내기')
    await expect(result).toHaveClass(/good/)
    // 결과는 누른 버튼이 있는 백업 칸 안에 뜬다
    await expect(page.locator('#backupBox #transferResult')).toHaveCount(1)
    await expect(page.locator('#backupLast')).toHaveText('마지막 백업: 오늘')
    expect(await storageGet(page, K.lastBackup)).toBe(TODAY)

    await page.click('#btnTransferClose')
    await expect(page.locator('#transferSheet')).toHaveCount(0)
    await expect(reminder).toHaveCount(0)
    await page.reload()
    await expect(page.locator('#startSheet')).toBeVisible()
    await expect(reminder).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('저장한 파일을 다른 기기(새 context)에서 되살리면 문장장·진도가 합쳐지고, 키 없는 기기면 키 안내', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await open(page, context, { storage: { [K.learned]: A_LEARNED, [K.progress]: A_PROGRESS } })
    await page.click('#btnStartTransfer')
    const { text } = await saveBackup(page)
    // 내려받은 파일을 실제 파일로 둔다 (경로에 한글이 있으면 Playwright가 파일을 못 넣어서 영어 이름 임시 폴더에)
    const dir = await mkdtemp(join(tmpdir(), 'ef-backup-'))
    const filePath = join(dir, FILE_NAME)
    await writeFile(filePath, text, 'utf8')

    const b = await openOtherDevice(browser, baseURL, {
      settings: null,
      storage: {
        [K.learned]: [
          { en: 'I like coffee!', ko: '커피 좋아!', date: day(-1) },
          { en: 'Where is the station?', ko: '역이 어디예요?', date: day(-1) },
        ],
        [K.progress]: { stage: 1, unit: 's1-3', doneUnits: ['s1-1', 's1-2'], sessions: [log(day(-1), { id: '00b0001' })] },
      },
    })
    try {
      const bp = b.page
      await bp.click('#btnStartTransfer')
      await expect(bp.locator('#transferSheet')).toBeVisible()
      await expect(bp.locator('#backupFile')).toHaveAttribute('accept', '.txt,text/plain')
      await bp.setInputFiles('#backupFile', filePath)
      const result = bp.locator('#transferResult')
      await expect(result).toHaveText('기록을 되살렸어요. 1문장을 새로 가져왔어요 (모두 3문장). 설정과 진도도 맞췄어요.')
      await expect(result).toHaveClass(/good/)
      await expect(bp.locator('#transferNeedKey')).toBeVisible()

      // 문장: 합집합 (겹치는 커피 문장은 하나, 더 이른 날짜)
      expect(await learnedIn(bp)).toEqual([
        { en: 'I like coffee!', ko: '커피 좋아!', date: day(-4) },
        { en: 'Where is the station?', ko: '역이 어디예요?', date: day(-1) },
        { en: 'Nice to meet you.', ko: '만나서 반가워.', date: day(-2) },
      ].sort((x, y) => x.date.localeCompare(y.date)))
      const p = (await storageGet(bp, K.progress)) as { stage: number; unit: string; doneUnits: string[]; sessions: { id: string }[] }
      expect(p.stage).toBe(2)
      expect(p.unit).toBe('s2-2')
      expect([...p.doneUnits].sort()).toEqual([...S1_ALL, 's2-1'].sort())
      expect(p.sessions.map((s) => s.id).sort()).toEqual(['00a0001', '00a0002', '00b0001'])

      // 같은 파일을 한 번 더 골라도 다시 읽는다 (새 문장은 없음)
      await bp.setInputFiles('#backupFile', filePath)
      await expect(result).toHaveText('기록을 되살렸어요. 새 문장은 없었어요 (모두 3문장). 설정과 진도는 맞췄어요.')
      expect(b.errors).toEqual([])
    } finally {
      await b.context.close()
    }
  })

  test('잘못된 파일: 백업 파일이 아니거나 망가졌으면 한국어 오류, 기록은 그대로', async ({ page, context }) => {
    const { errors } = await open(page, context, { storage: { [K.learned]: A_LEARNED, [K.progress]: A_PROGRESS } })
    await page.click('#btnStartTransfer')
    const result = page.locator('#transferResult')

    await page.setInputFiles('#backupFile', { name: 'memo.txt', mimeType: 'text/plain', buffer: Buffer.from('장보기: 우유, 빵\n') })
    await expect(result).toHaveText(
      '영어 친구 백업 파일이 아니에요. "파일로 저장"으로 만든 english-friend-backup-날짜.txt 파일을 골라 주세요.',
    )
    await expect(result).not.toHaveClass(/good/)

    await page.setInputFiles('#backupFile', {
      name: FILE_NAME,
      mimeType: 'text/plain',
      buffer: Buffer.from(NOTE + '\n\nEF1.H4sIAAAA-broken'),
    })
    await expect(result).toHaveText('백업 파일이 망가졌거나 잘렸어요. 다른 백업 파일을 골라 주세요.')
    await expect(result).not.toHaveClass(/good/)

    expect(await learnedIn(page)).toEqual(A_LEARNED)
    // 되살리기 실패는 백업으로 치지 않는다
    expect(await storageGet(page, K.lastBackup)).toBeNull()
    expect(errors).toEqual([])
  })

  test('내보내기 코드를 복사해도 백업으로 친다 → 안내 사라짐', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await open(page, context, { storage: { [K.learned]: A_LEARNED, [K.progress]: A_PROGRESS } })
    await expect(page.locator('#backupReminder')).toBeVisible()
    await page.click('#btnBackupNow')
    await page.click('#btnExport')
    await expect(page.locator('#transferResult')).toHaveText('복사했어요 (문장 2개). 카톡 "나와의 채팅"에 붙여 넣어 보내세요.')
    await expect(page.locator('#backupLast')).toHaveText('마지막 백업: 오늘')
    await page.keyboard.press('Escape')
    await expect(page.locator('#backupReminder')).toHaveCount(0)
  })

  test('기록 1일차엔 안내 없음, 백업 3일 전이면 없음, 8일 전이면 다시 안내', async ({ page, context, browser, baseURL }) => {
    // 오늘 처음 쓴 사람
    await open(page, context, {
      storage: {
        [K.learned]: [{ en: 'Hello.', ko: '안녕.', date: TODAY }],
        [K.progress]: { stage: 1, unit: 's1-1', doneUnits: [], sessions: [log(TODAY)] },
      },
    })
    await expect(page.locator('#btnStartTransfer')).toBeVisible()
    await expect(page.locator('#backupReminder')).toHaveCount(0)

    for (const [ago, shown] of [
      [3, false],
      [8, true],
    ] as const) {
      const o = await openOtherDevice(browser, baseURL, {
        storage: { [K.learned]: A_LEARNED, [K.progress]: A_PROGRESS, [K.lastBackup]: day(-ago) },
      })
      try {
        await expect(o.page.locator('#btnStartTransfer')).toBeVisible()
        await expect(o.page.locator('#backupReminder')).toHaveCount(shown ? 1 : 0)
        await o.page.click('#btnStartTransfer')
        await expect(o.page.locator('#backupLast')).toHaveText(`마지막 백업: ${ago}일 전`)
      } finally {
        await o.context.close()
      }
    }
  })
})
