/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // e2e/ 폴더는 Playwright가 따로 돌린다
    include: ['src/**/*.test.ts'],
  },
})
