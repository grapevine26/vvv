import { defineConfig, devices } from '@playwright/test'

// 화면 흐름 테스트: 빌드된 앱을 띄우고, AI·마이크·스피커는 가짜로 바꿔서 돌린다
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
