import { CalendarCheck, Clock, Flame, Sparkles } from 'lucide-react'
import { useState } from 'react'
import type { Progress } from '../lib/types'
import { percent, shortDate, weeklyReport, words, type DayBar, type WeekStat } from '../lib/weekly'
import { Sheet } from './common'
import './progress.css'

// 5) 주간 성장 화면: 이번 주 공부 시간, 영어로 스스로 대답한 비율이 오르는 모습
export interface ProgressProps {
  progress: Progress
  today: string
  minutesGoal: number
  onClose: () => void
}

export function ProgressSheet({ progress, today, minutesGoal, onClose }: ProgressProps) {
  const r = weeklyReport(progress, today, minutesGoal)
  return (
    <Sheet
      id="progressSheet"
      title="이번 주 기록"
      onClose={onClose}
      footer={
        <button className="primary" id="btnProgressClose" type="button" onClick={onClose}>
          닫기
        </button>
      }
    >
      {!r.hasData ? (
        <div className="pg-empty" id="pgEmpty">
          <p className="pg-empty-title">아직 기록이 없어요</p>
          <p className="note">
            시작 화면에서 「시작하기」를 눌러 대화하고, 끝낼 때 「저장하고 끝내기」를 누르면 여기에 공부한 시간과 영어로 대답한 비율이 쌓여요.
          </p>
        </div>
      ) : (
        <>
          <div className="pg-summary" id="pgSummary">
            <div className="pg-stat">
              <Clock className="ico" aria-hidden="true" />
              <span className="pg-stat-label">이번 주</span>
              <b id="pgWeekMin">{r.thisWeekMinutes}분</b>
            </div>
            <div className="pg-stat">
              <CalendarCheck className="ico" aria-hidden="true" />
              <span className="pg-stat-label">공부한 날</span>
              <b id="pgWeekDays">{r.thisWeekDays}일</b>
            </div>
            <div className="pg-stat">
              <Flame className="ico pg-flame" aria-hidden="true" />
              <span className="pg-stat-label">연속</span>
              <b id="pgStreak">{r.streak}일</b>
            </div>
          </div>
          <p className="pg-compare" id="pgCompare">
            <Sparkles className="ico" aria-hidden="true" />
            <span>{r.compare}</span>
          </p>

          <h3>최근 7일 공부한 시간</h3>
          <DayChart days={r.days} goal={minutesGoal} />

          <h3>영어로 스스로 대답한 비율</h3>
          <p className="note">한국어 대신 영어로, 따라 하지 않고 직접 대답한 비율이에요. 조금씩 오르면 잘하고 있는 거예요.</p>
          <WeekChart weeks={r.weeks} />

          <h3>주별 숫자</h3>
          <WeekTable weeks={r.weeks} />
        </>
      )}
    </Sheet>
  )
}

// 최근 7일 막대: 목표선, 오늘 강조, 막대마다 분. 누르면(또는 마우스를 올리면) 아래에 자세히 보여 준다
function DayChart({ days, goal }: { days: DayBar[]; goal: number }) {
  const [picked, setPicked] = useState(days.length - 1)
  const max = Math.max(goal, ...days.map((d) => d.minutes), 1)
  const pct = (m: number) => `${Math.round((m / max) * 1000) / 10}%`
  const sel = days[picked] ?? days[days.length - 1]
  const detail = (d: DayBar) =>
    `${d.isToday ? '오늘 ' : ''}${d.label}요일 ${shortDate(d.date)} · ${d.minutes}분${goal > 0 ? (d.metGoal ? ' · 목표 달성' : ` · 목표 ${goal}분`) : ''}`
  return (
    <div className="pg-chart">
      <div className="pg-area" id="pgDayChart" role="group" aria-label="최근 7일 공부한 분">
        {goal > 0 && <div className="pg-goal" id="pgGoalLine" style={{ bottom: pct(goal) }} aria-hidden="true" />}
        <div className="pg-cols pg-cols-7">
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              className={`pg-col${d.isToday ? ' pg-now' : ''}${i === picked ? ' picked' : ''}`}
              data-date={d.date}
              aria-label={detail(d)}
              aria-pressed={i === picked}
              onClick={() => setPicked(i)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setPicked(i)}
            >
              <span className="pg-bar" style={{ height: pct(d.minutes) }}>
                <span className="pg-val">{d.minutes}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="pg-cols pg-cols-7 pg-x" aria-hidden="true">
        {days.map((d) => (
          <span key={d.date} className={d.isToday ? 'pg-now' : ''}>
            {d.isToday ? '오늘' : d.label}
          </span>
        ))}
      </div>
      <div className="pg-legend" aria-hidden="true">
        <span>
          <i className="pg-key-bar" />
          공부한 분
        </span>
        {goal > 0 && (
          <span>
            <i className="pg-key-goal" />
            목표 {goal}분
          </span>
        )}
      </div>
      <p className="pg-readout" id="pgDayReadout" aria-live="polite">
        {detail(sel)}
      </p>
    </div>
  )
}

const weekName = (w: WeekStat) => (w.label.endsWith('~') ? `${w.label.slice(0, -1)}부터 한 주` : w.label)

// 최근 6주 '영어로 스스로 대답한 비율' 막대 (0~100%)
function WeekChart({ weeks }: { weeks: WeekStat[] }) {
  const [picked, setPicked] = useState(weeks.length - 1)
  const sel = weeks[picked] ?? weeks[weeks.length - 1]
  const detail = (w: WeekStat) =>
    w.ratio === null
      ? `${weekName(w)} · 대답 기록 없음`
      : `${weekName(w)} · ${percent(w.ratio)} (영어 ${w.enOwnTurns}번, 한국어 ${w.koTurns}번)`
  return (
    <div className="pg-chart">
      <div className="pg-area pg-area-ratio" id="pgWeekChart" role="group" aria-label="주별 영어로 스스로 대답한 비율">
        <div className="pg-grid" style={{ bottom: '50%' }} aria-hidden="true">
          <span>50%</span>
        </div>
        <div className="pg-grid" style={{ bottom: '100%' }} aria-hidden="true">
          <span>100%</span>
        </div>
        <div className="pg-cols pg-cols-6">
          {weeks.map((w, i) => (
            <button
              key={w.start}
              type="button"
              className={`pg-col${i === weeks.length - 1 ? ' pg-now' : ''}${i === picked ? ' picked' : ''}`}
              data-week={w.start}
              aria-label={detail(w)}
              aria-pressed={i === picked}
              onClick={() => setPicked(i)}
              onPointerEnter={(e) => e.pointerType === 'mouse' && setPicked(i)}
            >
              <span className={`pg-bar${w.ratio === null ? ' none' : ''}`} style={{ height: w.ratio === null ? '0%' : `${Math.round(w.ratio * 1000) / 10}%` }}>
                <span className="pg-val">{w.ratio === null ? '-' : percent(w.ratio)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="pg-cols pg-cols-6 pg-x pg-x-ratio" aria-hidden="true">
        {weeks.map((w, i) => (
          <span key={w.start} className={i === weeks.length - 1 ? 'pg-now' : ''}>
            {w.label}
          </span>
        ))}
      </div>
      <p className="pg-readout" id="pgWeekReadout" aria-live="polite">
        {detail(sel)}
      </p>
    </div>
  )
}

// 차트와 같은 숫자를 글로 (최근 주가 위)
function WeekTable({ weeks }: { weeks: WeekStat[] }) {
  const rows = [...weeks].reverse()
  return (
    <div className="pg-table-wrap">
      <table className="pg-table" id="pgTable">
        <thead>
          <tr>
            <th scope="col">주</th>
            <th scope="col">공부한 날</th>
            <th scope="col">시간</th>
            <th scope="col">영어로 대답</th>
            <th scope="col">대답 길이</th>
            <th scope="col">따라 말하기</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.start} data-week={w.start}>
              <th scope="row">{w.label}</th>
              <td>{w.studyDays}일</td>
              <td>{w.minutes}분</td>
              <td>{percent(w.ratio)}</td>
              <td>{words(w.avgWords)}</td>
              <td>{w.repeats}번</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">대답 길이는 영어로 스스로 한 대답의 평균 단어 수예요.</p>
    </div>
  )
}
