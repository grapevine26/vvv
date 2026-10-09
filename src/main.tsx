import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 한글·영문 글꼴 (앱에 함께 넣어 오프라인·홈 화면 앱에서도 같은 글꼴, 쓰는 글자만 내려받음)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './index.css'
import App from './App.tsx'
import { applyTheme, loadTheme } from './lib/theme'

// 그리기 전에 테마를 맞춰 깜빡이지 않게
applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
