import { Mic } from 'lucide-react'
import { doneToday, getStage, getUnit, minutesOn, promotionStatus, streakDays } from '../lib/curriculum'
import type { MicState } from '../lib/speech'
import type { Draft, Progress } from '../lib/types'

export interface MicInfo {
  state: MicState
  // 이 브라우저가 음성 인식을 하는지
  supported: boolean
  inApp: 'kakao' | 'other' | null
  chromeUrl: string | null
  // 카카오톡의 '기본 브라우저로 열기' (크롬 열기가 안 될 때)
  externalUrl: string | null
  help: string
}

interface Props {
  // 다른 창이 위에 떠 있으면 홈은 누를 수 없게
  inert: boolean
  friendName: string
  message: string
  // 대화를 마친 결과 문구면 true (초록 상자), 안내 문구면 false
  messageIsResult: boolean
  progress: Progress
  hasKey: boolean
  // 지금 대화가 이어지는 중이면 (홈에 잠깐 나와 있음)
  live: boolean
  today: string
  minutesGoal: number
  // 오늘 복습할 문장 수
  quizDue: number
  draft: Draft | null
  busyElsewhere: boolean
  mic: MicInfo
  // 이 브라우저에 쌓인 문장장·기록이 있는지 (앱 안 브라우저에서 떠나기 전에 옮기라고 알린다)
  hasData: boolean
  // 오래 백업하지 않았으면 안내
  backupDue: boolean
  dailyChecks: number[]
  onToggleCheck: (i: number) => void
  onStart: () => void
  onResumeDraft: () => void
  onSaveDraft: () => void
  onDiscardDraft: () => void
  onAllowMic: () => void
  onReview: () => void
  onTransfer: () => void
  onPromote: () => void
  onWarmup: () => void
  onQuiz: () => void
  onListen: () => void
}

// 승급 조건 중 가장 모자란 것에 맞춘 한 줄 도움말. 오늘 단원을 이미 마쳤으면 단원 말고 다른 조건을 말한다
function promoTip(labels: { label: string; ok: boolean }[], finishedToday: boolean): string {
  const missing = labels.find((c) => !c.ok && !(finishedToday && c.label.startsWith('단원')))
  if (!missing) return finishedToday && labels.some((c) => !c.ok) ? '오늘 단원은 마쳤어요. 내일 다음 단원을 이어 가요.' : ''
  if (missing.label.startsWith('단원')) return '오늘 단원을 끝까지 해 봐요.'
  if (missing.label.includes('비율')) return '한국어 대신 EN 버튼으로 스스로 대답해 보세요. 짧아도 괜찮아요.'
  return '대답을 한두 단어만 더 길게 해 보세요.'
}

// 'Emma' → 'EM' (시안의 프로필 글자)
const initials = (name: string) => (name || 'Emma').trim().slice(0, 2).toUpperCase()

export function StartScreen(props: Props) {
  const { friendName, message, progress, hasKey, live, today, minutesGoal, draft, busyElsewhere, mic, dailyChecks } = props
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const unitNo = stage.units.findIndex((u) => u.id === unit.id) + 1
  const doneCount = stage.units.filter((u) => progress.doneUnits.includes(u.id)).length
  const promo = promotionStatus(progress)
  const firstTime = progress.sessions.length === 0
  const todayMin = minutesOn(progress, today)
  const streak = streakDays(progress, today)
  const finishedToday = doneToday(progress, today)
  const routineDone = stage.routine.filter((_, i) => (i === 0 && todayMin >= minutesGoal) || dailyChecks.includes(i)).length

  return (
    <section className="screen home" id="startSheet" inert={props.inert}>
      {/* 프로필 & 연속 일수 */}
      <div className="home-head">
        <div className="profile">
          <div className="profile-ring" aria-hidden="true">
            <div className="profile-inner">{initials(friendName)}</div>
          </div>
          <span className="online-dot" aria-hidden="true" />
        </div>
        <div className="home-head-text">
          <h1 id="startTitle">AI {friendName}</h1>
          <p className="home-sub">
            {stage.n}단계 {stage.name} · 반가워요!
          </p>
        </div>
        {streak > 0 && (
          <div className="streak-badge" id="streakBadge">
            {streak}일 연속
          </div>
        )}
      </div>

      {(mic.inApp || !mic.supported) && (
        <div className="card-box warn" id="inAppBanner" role="alert">
          {mic.inApp
            ? '카카오톡·네이버 같은 앱 안에서는 마이크와 저장이 제대로 안 돼요. 크롬에서 열어 주세요.'
            : '이 브라우저는 음성 인식이 안 돼요. 크롬이나 엣지에서 열어 주세요. (입력칸에 써서 연습할 수는 있어요)'}
          {mic.inApp && props.hasData && (
            <div className="note" id="inAppData">
              여기서 쓰던 문장장·진도는 크롬에 없어요. 크롬으로 열기 전에 <b>폰↔PC 옮기기 → 내보내기</b>로 코드를 복사해
              두고, 크롬에서 가져오기 하세요.{' '}
              <button className="secondary small" id="btnInAppExport" type="button" onClick={props.onTransfer}>
                코드 복사하러 가기
              </button>
            </div>
          )}
          {mic.chromeUrl && (
            <a className="primary link-btn" id="btnOpenChrome" href={mic.chromeUrl}>
              크롬으로 열기
            </a>
          )}
          {mic.externalUrl && mic.externalUrl !== mic.chromeUrl && (
            <a className="secondary link-btn" id="btnOpenExternal" href={mic.externalUrl}>
              크롬이 안 열리면: 다른 브라우저로 열기
            </a>
          )}
        </div>
      )}

      {draft && (
        <div className="card-box" id="draftCard">
          <b>저장 안 된 대화가 있어요</b>
          <div className="muted">
            {draft.date === today ? '오늘' : draft.date} · {draft.stats.turns}번 주고받음 · 문장 {draft.repeats.length}개
          </div>
          <div className="tools">
            {draft.date === today && (
              <button className="primary small" id="btnDraftResume" type="button" onClick={props.onResumeDraft}>
                이어서 하기
              </button>
            )}
            <button className="secondary small" id="btnDraftSave" type="button" onClick={props.onSaveDraft}>
              저장하고 닫기
            </button>
            <button className="secondary small" id="btnDraftDiscard" type="button" onClick={props.onDiscardDraft}>
              버리기
            </button>
          </div>
        </div>
      )}
      {busyElsewhere && (
        <p className="note" id="busyElsewhere">
          다른 탭(창)에서 대화 중이에요. 같은 기기에서는 한 곳에서만 대화하는 게 안전해요.
        </p>
      )}
      {message && (
        <div className={`result ${props.messageIsResult ? 'good' : 'info'}`} id="startMsg" role="status">
          {message}
        </div>
      )}

      {/* 오늘의 핵심 회화 카드 */}
      <div className="hero" id="courseCard">
        <div className="hero-top">
          <div className="hero-text">
            <span className="hero-badge">Today's Unit {String(unitNo).padStart(2, '0')}</span>
            <h2 className="hero-title">
              {unit.title}
              {unit.roleplay ? ' (상황극)' : ''}
            </h2>
            <p className="hero-focus" lang="en">
              {unit.focus}
            </p>
          </div>
          <div className="hero-emoji" aria-hidden="true">
            ☕
          </div>
        </div>

        <div className="hero-meta">
          {stage.n}단계 · {stage.name} · 완료 {doneCount}/{stage.units.length}
          {finishedToday && (
            <>
              {' · '}
              <span className="ok-text">오늘 단원 완료 ✓</span>
            </>
          )}
        </div>

        {!firstTime && (
          <div className="hero-time" id="todayLine">
            <div className="hero-time-row">
              <span>오늘 말한 시간</span>
              <b>
                {todayMin}분 / {minutesGoal}분
              </b>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (todayMin / Math.max(1, minutesGoal)) * 100)}%` }} />
            </div>
          </div>
        )}

        {promo && !firstTime && (
          <div className="promo" id="promoProgress">
            {promo.ready ? (
              <div className="course-ready">
                다음 단계로 올라갈 준비가 됐어요!{' '}
                <button className="primary small" id="btnPromoteStart" type="button" onClick={props.onPromote}>
                  {stage.n + 1}단계로
                </button>
              </div>
            ) : (
              <>
                <div className="muted">
                  다음 단계까지:{' '}
                  {promo.criteria.map((c, i) => (
                    <span key={c.label} className={c.ok ? 'ok-text' : ''}>
                      {i > 0 ? ' · ' : ''}
                      {c.ok ? '✓ ' : ''}
                      {c.label.replace(' (최근 대화)', '').replace('영어로 스스로 대답한 비율', '영어 대답').replace('영어 대답 평균 길이', '평균 길이')}{' '}
                      {c.current}/{c.target}
                    </span>
                  ))}
                </div>
                <div className="tip-line">{promoTip(promo.criteria, !!finishedToday)}</div>
              </>
            )}
          </div>
        )}

        <button className="cta" id="btnStart" type="button" onClick={props.onStart}>
          {live ? `${friendName}와 대화 이어 가기` : !hasKey ? '키 넣고 시작하기' : draft ? '새로 시작하기' : `지금 ${friendName}와 수다 떨기`}
        </button>
      </div>

      {firstTime && !draft && (
        <ol className="card-box steps first-guide" id="firstGuide">
          <li>{friendName}가 영어로 묻고, 한국어 뜻도 같이 보여 줘요.</li>
          <li>「한국어로 말하기」로 대답해도 돼요. 노란 칸이 나오면 「EN」을 누르고 따라 말해요.</li>
          <li>끝낼 땐 오른쪽 위 「세션 종료」 → 「저장하고 끝내기」를 눌러요.</li>
        </ol>
      )}

      {mic.supported && !mic.inApp && mic.state !== 'granted' && (
        <div className="mic-line" id="micStatus">
          {mic.state === 'denied' ? (
            <span className="warn-text">마이크가 막혀 있어요. {mic.help}</span>
          ) : (
            <>
              <span>말하기에 마이크가 필요해요.</span>
              <button className="secondary small" id="btnMicAllow" type="button" onClick={props.onAllowMic}>
                <Mic className="ico" aria-hidden="true" />
                마이크 켜기
              </button>
            </>
          )}
        </div>
      )}
      {mic.supported && !mic.inApp && mic.state === 'granted' && (
        <div className="mic-line ok-text" id="micStatus">
          <Mic className="ico" aria-hidden="true" />
          마이크 준비됨
        </div>
      )}

      {/* 대화 전 2분 입 풀기 */}
      {hasKey && (
        <button className="row-card" id="btnWarmup" type="button" onClick={props.onWarmup}>
          <span className="row-card-ico amber" aria-hidden="true">
            ⚡
          </span>
          <span className="row-card-text">
            <b>대화 전 2분 입 풀기</b>
            <small>오늘 쓸 문장 틀 3개 미리 소리 내어 연습</small>
          </span>
          <span className="row-card-go">연습 ›</span>
        </button>
      )}

      {props.backupDue && (
        <div className="card-box" id="backupReminder">
          <span>기록을 일주일 넘게 백업하지 않았어요. 폰을 바꾸거나 크롬 기록을 지우면 사라질 수 있어요.</span>
          <button className="secondary small" id="btnBackupNow" type="button" onClick={props.onTransfer}>
            지금 백업하기
          </button>
        </div>
      )}

      {/* 5분 퀴즈 & 30초 쉐도잉 */}
      <div className="quick-grid">
        <button className="quick" id="btnQuiz" type="button" onClick={props.onQuiz}>
          <span className="quick-emoji" aria-hidden="true">
            🎯
          </span>
          <b>5분 복습 퀴즈</b>
          <small className={props.quizDue > 0 ? 'good' : ''}>{props.quizDue > 0 ? `복습할 문장 ${props.quizDue}개 대기` : '잊을 때쯤 다시 꺼내 보기'}</small>
        </button>
        <button className="quick" id="btnListen" type="button" onClick={props.onListen}>
          <span className="quick-emoji" aria-hidden="true">
            🎧
          </span>
          <b>30초 쉐도잉</b>
          <small>원어민 발음 따라하기</small>
        </button>
      </div>

      {/* 오늘 루틴 */}
      {!firstTime && (
        <div className="routine" id="todayRoutine">
          <div className="routine-head">
            <h3>오늘의 {stage.routine.length}대 루틴</h3>
            <span>
              {routineDone} / {stage.routine.length} 완료
            </span>
          </div>
          <ul className="checklist">
            {stage.routine.map((r, i) => {
              // 첫 항목(앱 대화)은 오늘 목표 시간을 채우면 저절로 체크된다
              const auto = i === 0 && todayMin >= minutesGoal
              const checked = auto || dailyChecks.includes(i)
              return (
                <li key={r}>
                  <label className="check">
                    <input type="checkbox" checked={checked} disabled={auto} onChange={() => props.onToggleCheck(i)} />
                    {/* 앱 대화 시간은 내가 정한 하루 목표로 보여 준다 (자동 체크 기준과 같게) */}
                    <span className={checked ? 'done-text' : ''}>{i === 0 ? r.replace(/앱 대화 \d+분/, `앱 대화 ${minutesGoal}분`) : r}</span>
                  </label>
                  {r.includes('문장장') && progress.sessions.length > 0 && (
                    <button className="link-go" type="button" onClick={props.onReview}>
                      하러 가기
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
