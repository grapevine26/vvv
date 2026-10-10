import { useState } from 'react'
import { splitByScript } from '../lib/text'
import { loadTheme, saveTheme, type Theme } from '../lib/theme'
import { percent, weeklyStats } from '../lib/weekly'
import type { LearnedItem, Progress, Segment } from '../lib/types'

interface Props {
  inert: boolean
  learned: LearnedItem[]
  progress: Progress
  today: string
  onPlay: (segments: Segment[]) => void
  onBook: () => void
  onCourse: () => void
  onProgress: () => void
  onSettings: () => void
  onTransfer: () => void
}

// 영어로 스스로 대답한 비율: 지금까지 전체와 지난주 대비 변화
function ownRatio(progress: Progress, today: string): { ratio: number | null; change: number | null } {
  const sum = (k: 'enOwnTurns' | 'koTurns') => progress.sessions.reduce((a, s) => a + s[k], 0)
  const en = sum('enOwnTurns')
  const all = en + sum('koTurns')
  const [lastWeek, thisWeek] = weeklyStats(progress, today, 2)
  const change =
    thisWeek.ratio !== null && lastWeek.ratio !== null ? Math.round(thisWeek.ratio * 100) - Math.round(lastWeek.ratio * 100) : null
  return { ratio: all > 0 ? en / all : null, change }
}

// 내 서재: 내 문장 노트 & 성장 통계, 그리고 교육과정·기록·설정·옮기기로 가는 길
export function LibraryScreen({ inert, learned, progress, today, onPlay, onBook, onCourse, onProgress, onSettings, onTransfer }: Props) {
  const { ratio, change } = ownRatio(progress, today)
  const recent = learned.slice(-3).reverse()
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const pickTheme = (t: Theme) => {
    setTheme(t)
    saveTheme(t)
  }

  return (
    <section className="screen library" id="libraryScreen" inert={inert}>
      <div className="page-head">
        <h2>내 문장 노트 &amp; 성장 통계</h2>
        <span className="page-head-side">총 {learned.length}문장</span>
      </div>

      <div className="stat-card" id="ratioCard">
        <div className="stat-row">
          <span className="stat-label">영어로 직접 대답한 비율</span>
          {change !== null && change !== 0 && (
            <span className={`stat-change${change > 0 ? ' up' : ' down'}`}>
              {change > 0 ? `▲ +${change}%p 상승` : `▼ ${change}%p`}
            </span>
          )}
        </div>
        <div className="stat-value">
          <span className="stat-big">{percent(ratio)}</span>
          <span className="stat-desc">{ratio === null ? '대화를 하면 여기에 쌓여요' : '한국어 대신 영어로 스스로 생각하여 말함'}</span>
        </div>
        <div className="bar" aria-hidden="true">
          <span className="green" style={{ width: `${Math.round((ratio ?? 0) * 100)}%` }} />
        </div>
      </div>

      <div className="saved">
        <h4>최근 저장된 핵심 표현</h4>
        {recent.length === 0 && <p className="saved-empty">대화를 마치고 저장하면 따라 말한 문장이 여기에 모여요.</p>}
        {recent.map((item) => (
          <div className="saved-row" key={item.en}>
            <div className="saved-text">
              <b lang="en">"{item.en}"</b>
              {item.ko && <span>{item.ko}</span>}
            </div>
            <button type="button" className="sq-btn" aria-label={`최근 표현 듣기: ${item.en}`} onClick={() => onPlay(splitByScript(item.en))}>
              🔊
            </button>
          </div>
        ))}
      </div>

      <div className="lib-menu">
        <button className="lib-btn" id="btnStartBook" type="button" onClick={onBook}>
          <span aria-hidden="true">📒</span> 내 문장 노트 전체 보기 · 복습하기
        </button>
        <button className="lib-btn" id="btnStartCourse" type="button" onClick={onCourse}>
          <span aria-hidden="true">🗺️</span> 교육과정 · 단원 고르기
        </button>
        <button className="lib-btn" id="btnProgress" type="button" onClick={onProgress}>
          <span aria-hidden="true">📊</span> 이번 주 기록
        </button>
        <button className="lib-btn" id="btnStartSettings" type="button" onClick={onSettings}>
          <span aria-hidden="true">⚙️</span> 설정
        </button>
        <button className="lib-btn" id="btnStartTransfer" type="button" onClick={onTransfer}>
          <span aria-hidden="true">🔄</span> 폰 ↔ PC 데이터 동기화 및 백업
        </button>
      </div>

      <div className="theme-switch" role="group" aria-label="화면 테마">
        <button type="button" id="btnThemeDark" aria-pressed={theme === 'dark'} onClick={() => pickTheme('dark')}>
          🌙 다크 모드
        </button>
        <button type="button" id="btnThemeLight" aria-pressed={theme === 'light'} onClick={() => pickTheme('light')}>
          ☀️ 라이트 모드
        </button>
      </div>
    </section>
  )
}
