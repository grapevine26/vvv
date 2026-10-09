// 화면 테마: 시안처럼 다크가 기본, 내 서재에서 라이트로 바꿀 수 있다 (이 기기에만 저장)
export type Theme = 'dark' | 'light'

const KEY = 'englishFriend.theme'
const BAR_COLOR: Record<Theme, string> = { dark: '#0f172a', light: '#f8fafc' }

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[theme])
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 저장이 막힌 브라우저에서는 이번에만 적용
  }
}
