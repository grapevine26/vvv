import { getStage, getUnit, promotionStatus, STAGES, totalMinutes } from '../lib/curriculum'
import type { Progress } from '../lib/types'
import { Sheet } from './common'

interface Props {
  progress: Progress
  onChooseUnit: (unitId: string) => void
  onChangeStage: (n: number) => void
  onPromote: () => void
  onClose: () => void
}

function formatTime(minutes: number): string {
  return minutes < 60 ? `${minutes}분` : `${(minutes / 60).toFixed(1)}시간`
}

export function CourseSheet({ progress, onChooseUnit, onChangeStage, onPromote, onClose }: Props) {
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const promo = promotionStatus(progress)
  const doneCount = stage.units.filter((u) => progress.doneUnits.includes(u.id)).length

  return (
    <Sheet
      id="courseSheet"
      title="교육과정"
      onClose={onClose}
      footer={
        <button className="primary" id="btnCourseClose" type="button" onClick={onClose}>
          닫기
        </button>
      }
    >
      <div className="card course-now">
        <div className="course-stage">
          {stage.n}단계 · {stage.name}
        </div>
        <div>{stage.goal}</div>
        <ul className="list">
          {stage.canDo.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>

      <h3>다음 단계로 가는 조건</h3>
      {promo ? (
        <>
          <ul className="list criteria" id="criteria">
            {promo.criteria.map((c) => (
              <li key={c.label} className={c.ok ? 'ok' : ''}>
                {c.ok ? '✓' : '○'} {c.label}: {c.current} / 목표 {c.target}
              </li>
            ))}
          </ul>
          {promo.ready ? (
            <button className="primary" id="btnPromote" type="button" onClick={onPromote}>
              {stage.n + 1}단계로 올라가기
            </button>
          ) : (
            <p className="note">조건을 다 채우면 여기서 올라갈 수 있어요.</p>
          )}
        </>
      ) : (
        <p className="note">마지막 단계예요. 단원을 돌며 계속 다듬어요.</p>
      )}

      <h3>
        단원 (완료 {doneCount}/{stage.units.length})
      </h3>
      <p className="note">누르면 다음 대화의 단원으로 정해져요.</p>
      <div className="units" id="unitList">
        {stage.units.map((u, i) => {
          const done = progress.doneUnits.includes(u.id)
          const classes = ['unit']
          if (u.id === unit.id) classes.push('current')
          if (done) classes.push('done')
          return (
            <button
              key={u.id}
              type="button"
              className={classes.join(' ')}
              aria-current={u.id === unit.id ? 'true' : undefined}
              onClick={() => onChooseUnit(u.id)}
            >
              <span className="unit-no" aria-label={done ? '완료' : undefined}>
                {done ? '✓' : i + 1}
              </span>
              <span className="unit-body">
                <b>
                  {u.title}
                  {u.roleplay ? ' (상황극)' : ''}
                </b>
                <small lang="en">{u.focus}</small>
              </span>
            </button>
          )
        })}
      </div>

      <details className="more" id="routineDetails">
        <summary>하루 루틴 (약 1시간)</summary>
        <ul className="list" id="routine">
          {stage.routine.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      <details className="more" id="stagesDetails">
        <summary>전체 단계 보기 · 단계 바꾸기</summary>
        <div id="stageList">
          {STAGES.map((st) => (
            <div key={st.n} className={`card stage${st.n === stage.n ? ' current' : ''}`}>
              <b>
                {st.n}단계 · {st.name} ({st.cefr})
              </b>
              <div>{st.goal}</div>
              <small className="muted">처음부터 여기까지 보통 {st.hours} (수업 기준)</small>
              {st.n !== stage.n && (
                <div className="tools">
                  <button className="mini" type="button" onClick={() => onChangeStage(st.n)}>
                    이 단계로 바꾸기
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </details>

      <details className="more">
        <summary>지금까지 공부한 것</summary>
        <p id="courseStats">
          대화 {progress.sessions.length}번 · 앱에서 {formatTime(totalMinutes(progress))}
        </p>
        <p className="note">
          원어민 수준(C2)까지는 수업 기준으로도 보통 1,000시간이 넘게 걸려요. 앱 대화만으로는 부족하고, 하루 루틴의
          듣기·읽기가 실력의 대부분을 만들어요.
        </p>
      </details>
    </Sheet>
  )
}
