import { TARGET } from '../lib/config'
import { getStage, getUnit, promotionStatus } from '../lib/curriculum'
import type { Progress } from '../lib/types'

interface Props {
  friendName: string
  message: string
  progress: Progress
  onStart: () => void
  onSettings: () => void
  onBook: () => void
  onCourse: () => void
  onPromote: () => void
}

export function StartScreen({ friendName, message, progress, onStart, onSettings, onBook, onCourse, onPromote }: Props) {
  const initial = (friendName || 'E').trim().charAt(0).toUpperCase()
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const unitNo = stage.units.findIndex((u) => u.id === unit.id) + 1
  const ready = promotionStatus(progress)?.ready ?? false

  return (
    <section className="sheet solid" id="startSheet">
      <div className="sheet-card">
        <div className="avatar big" aria-hidden="true">
          {initial}
        </div>
        <h1 id="startTitle">
          {friendName}와 {TARGET.label} 수다
        </h1>

        <div className="course-card" id="courseCard">
          <div className="course-stage">
            {stage.n}단계 · {stage.name} ({stage.cefr})
          </div>
          <div className="course-unit">
            오늘 단원 {unitNo}/{stage.units.length} · {unit.title}
            {unit.roleplay ? ' (상황극)' : ''}
          </div>
          <div className="course-focus">{unit.focus}</div>
          {ready && (
            <div className="course-ready">
              다음 단계로 올라갈 준비가 됐어요!{' '}
              <button className="mini" id="btnPromoteStart" type="button" onClick={onPromote}>
                {stage.n + 1}단계로
              </button>
            </div>
          )}
        </div>

        <p className="muted" id="startMsg">
          {message}
        </p>
        <button className="primary start-btn" id="btnStart" type="button" onClick={onStart}>
          시작하기
        </button>
        <div className="row">
          <button className="link" id="btnStartSettings" type="button" onClick={onSettings}>
            설정
          </button>
          {' · '}
          <button className="link" id="btnStartBook" type="button" onClick={onBook}>
            내 문장장
          </button>
          {' · '}
          <button className="link" id="btnStartCourse" type="button" onClick={onCourse}>
            교육과정
          </button>
        </div>
      </div>
    </section>
  )
}
