import { describe, expect, it } from 'vitest'
import { inAppBrowser, micBlockedHelp, micErrorText, openInChromeUrl } from './speech'

const KAKAO = 'Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A; wv) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36 KAKAOTALK 10.4.5'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36'
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

describe('앱 안 브라우저 알아보기', () => {
  it('카카오톡·네이버·웹뷰는 앱 안 브라우저, 크롬은 아님', () => {
    expect(inAppBrowser(KAKAO)).toBe('kakao')
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 14) NAVER(inapp; search; 2000; 12.1.0)')).toBe('other')
    expect(inAppBrowser(CHROME_ANDROID)).toBeNull()
    expect(inAppBrowser(CHROME_WIN)).toBeNull()
  })

  it('크롬으로 여는 주소', () => {
    expect(openInChromeUrl('https://english.vercel.app/', KAKAO)).toBe('kakaotalk://web/openExternal?url=https%3A%2F%2Fenglish.vercel.app%2F')
    expect(openInChromeUrl('https://english.vercel.app/?a=1', CHROME_ANDROID)).toBe(
      'intent://english.vercel.app/?a=1#Intent;scheme=https;package=com.android.chrome;end',
    )
    expect(openInChromeUrl('https://english.vercel.app/', CHROME_WIN)).toBeNull()
  })
})

describe('마이크가 막혔을 때 안내', () => {
  it('안드로이드·홈 화면 앱은 휴대폰 설정 경로, PC는 주소창', () => {
    expect(micBlockedHelp({ ua: CHROME_ANDROID, standalone: false })).toContain('휴대폰 설정')
    expect(micBlockedHelp({ ua: CHROME_WIN, standalone: true })).toContain('휴대폰 설정')
    expect(micBlockedHelp({ ua: CHROME_WIN, standalone: false })).toContain('주소창')
  })

  it('막힘 오류에는 입력칸 대안을 덧붙인다', () => {
    expect(micErrorText('not-allowed', { ua: CHROME_WIN, standalone: false })).toContain('입력칸에 써도 돼요')
    expect(micErrorText('weird', { ua: CHROME_WIN, standalone: false })).toContain('weird')
  })
})
