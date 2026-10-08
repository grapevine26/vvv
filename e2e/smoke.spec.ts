import { expect, test } from '@playwright/test'
import { aiBubbles, collectErrors, installMocks, reply, say, turn } from './helpers'

test('도구 확인: 키 있는 상태로 첫 인사', async ({ page, context }) => {
  const { queue, requests } = await installMocks(context, { storage: { 'englishFriend.settings': { apiKey: 'K' } } })
  const errors = collectErrors(page)
  await page.goto('/')
  await expect(page.locator('#micStatus')).not.toContainText('막혀')
  queue.push(reply(turn({ say: 'Hi!', say_ko: '안녕!' })))
  await page.click('#btnStart')
  await expect(aiBubbles(page)).toHaveCount(1)
  queue.push(reply(turn({ say: 'Nice.', say_ko: '좋아.' })))
  await page.click('#micEn')
  await say(page, 'I am fine')
  await expect(aiBubbles(page)).toHaveCount(2)
  expect(requests).toHaveLength(2)
  expect(errors).toEqual([])
})
