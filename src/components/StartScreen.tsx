import { ArrowLeftRight, BookOpen, ChartColumn, Dumbbell, Flame, Headphones, Home, ListChecks, Map as MapIcon, MessageCircle, Mic, Play, Settings } from 'lucide-react'
import { TARGET } from '../lib/config'
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
  // 다른 창이 위에 떠 있으면 시작 화면은 누를 수 없게
  inert: boolean
  friendName: string
  message: string
  // 대화를 마친 결과 문구면 true (초록 상자), 안내 문구면 false
  messageIsResult: boolean
  progress: Progress
  hasKey: boolean
  today: string
  minutesGoal: number
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
  onSettings: () => void
  onBook: () => void
  onReview: () => void
  onCourse: () => void
  onTransfer: () => void
  onPromote: () => void
  // 오늘의 연습
  onWarmup: () => void
  onQuiz: () => void
  onListen: () => void
  onProgress: () => void
}

// 승급 조건 중 가장 모자란 것에 맞춘 한 줄 도움말. 오늘 단원을 이미 마쳤으면 단원 말고 다른 조건을 말한다
function promoTip(labels: { label: string; ok: boolean }[], finishedToday: boolean): string {
  const missing = labels.find((c) => !c.ok && !(finishedToday && c.label.startsWith('단원')))
  if (!missing) return finishedToday && labels.some((c) => !c.ok) ? '오늘 단원은 마쳤어요. 내일 다음 단원을 이어 가요.' : ''
  if (missing.label.startsWith('단원')) return '오늘 단원을 끝까지 해 봐요.'
  if (missing.label.includes('비율')) return '한국어 대신 EN 버튼으로 스스로 대답해 보세요. 짧아도 괜찮아요.'
  return '대답을 한두 단어만 더 길게 해 보세요.'
}

export function StartScreen(props: Props) {
  const { friendName, message, progress, hasKey, today, minutesGoal, draft, busyElsewhere, mic, dailyChecks } = props
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const unitNo = stage.units.findIndex((u) => u.id === unit.id) + 1
  const doneCount = stage.units.filter((u) => progress.doneUnits.includes(u.id)).length
  const promo = promotionStatus(progress)
  const firstTime = progress.sessions.length === 0
  const todayMin = minutesOn(progress, today)
  const streak = streakDays(progress, today)
  const finishedToday = doneToday(progress, today)
  const initial = (friendName || 'E').trim().charAt(0).toUpperCase()

  return (
    <section className="sheet solid" id="startSheet" inert={props.inert}>
      <div className="sheet-card start">
        {(mic.inApp || !mic.supported) && (
          <div className="banner-box warn" id="inAppBanner" role="alert">
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
          <div className="banner-box" id="draftCard">
            <b>저장 안 된 대화가 있어요</b>
            <div className="muted">
              {draft.date === today ? '오늘' : draft.date} · {draft.stats.turns}번 주고받음 · 문장 {draft.repeats.length}개
            </div>
            <div className="tools">
              {draft.date === today && (
                <button className="primary" id="btnDraftResume" type="button" onClick={props.onResumeDraft}>
                  이어서 하기
                </button>
              )}
              <button className="secondary" id="btnDraftSave" type="button" onClick={props.onSaveDraft}>
                저장하고 닫기
              </button>
              <button className="secondary" id="btnDraftDiscard" type="button" onClick={props.onDiscardDraft}>
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

        <div className="start-head">
          <div className="avatar" aria-hidden="true">
            {initial}
          </div>
          <div className="start-head-text">
            <h1 id="startTitle">
              {friendName}와 {TARGET.label} 수다
            </h1>
            <p className="start-subtitle">{stage.n}단계 {stage.name} · 반가워요!</p>
          </div>
          {streak > 0 && (
            <div className="streak-badge">
              <Flame className="ico" aria-hidden="true" />
              <span>{streak}일 연속</span>
            </div>
          )}
        </div>

        {!firstTime && (
          <div className="today" id="todayLine">
            <div className="today-line-header">
              <span>{streak > 0 ? `${streak}일 연속 · ` : ''}오늘 {todayMin}분 / 목표 {minutesGoal}분</span>
            </div>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, (todayMin / Math.max(1, minutesGoal)) * 100)}%` }} />
            </div>
          </div>
        )}

        <div className="course-card" id="courseCard">
          <div className="course-card-top">
            <span className="course-badge">Today's Unit {unitNo}</span>
            <span className="course-float-icon" aria-hidden="true">☕</span>
          </div>
          <div className="course-unit">
            {finishedToday ? '다음 단원' : '오늘 단원'} {unitNo} · {unit.title}
            {unit.roleplay ? ' (상황극)' : ''}
          </div>
          <div className="course-focus" lang="en">
            "{unit.focus}"
          </div>
          <div className="course-stage">
            {stage.n}단계 · {stage.name} <span className="muted">· 완료 {doneCount}/{stage.units.length}</span>
          </div>
          {finishedToday && <div className="ok-text">오늘 단원 하나 완료 ✓ 더 해도 좋아요</div>}
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
        </div>

        {firstTime && !draft && (
          <ol className="list steps first-guide" id="firstGuide">
            <li>{friendName}가 영어로 묻고, 한국어 뜻도 같이 보여 줘요.</li>
            <li>
              「한」 버튼으로 한국어로 대답해도 돼요. 노란 칸이 나오면 「EN」을 누르고 따라 말해요.
            </li>
            <li>끝낼 땐 오른쪽 위 「끝내기」 → 「저장하고 끝내기」를 눌러요.</li>
          </ol>
        )}

        {message && (
          <div className={`result ${props.messageIsResult ? 'good' : 'info'}`} id="startMsg" role="status">
            {message}
          </div>
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

        <button className="primary start-btn" id="btnStart" type="button" onClick={props.onStart}>
          <Play className="ico" aria-hidden="true" />
          {!hasKey ? '키 넣고 시작하기' : draft ? '새로 시작하기' : '시작하기'}
        </button>

        {hasKey && (
          <button className="secondary wide warmup-btn" id="btnWarmup" type="button" onClick={props.onWarmup}>
            <Dumbbell className="ico" aria-hidden="true" />
            대화 전 2분 연습 (오늘 단원 문장 틀)
          </button>
        )}

        {props.backupDue && (
          <div className="banner-box" id="backupReminder">
            <span>기록을 일주일 넘게 백업하지 않았어요. 폰을 바꾸거나 크롬 기록을 지우면 사라질 수 있어요.</span>
            <button className="secondary small" id="btnBackupNow" type="button" onClick={props.onTransfer}>
              지금 백업하기
            </button>
          </div>
        )}

        <h3 className="menu-title">더 연습하기</h3>
        <div className="start-menu">
          <button className="secondary tile" id="btnQuiz" type="button" onClick={props.onQuiz}>
            <ListChecks className="ico" aria-hidden="true" />
            5분 복습 퀴즈
          </button>
          <button className="secondary tile" id="btnListen" type="button" onClick={props.onListen}>
            <Headphones className="ico" aria-hidden="true" />
            듣고 따라 말하기
          </button>
          <button className="secondary tile" id="btnProgress" type="button" onClick={props.onProgress}>
            <ChartColumn className="ico" aria-hidden="true" />
            이번 주 기록
          </button>
        </div>
        <h3 className="menu-title">메뉴</h3>
        <div className="start-menu">
          <button className="secondary tile" id="btnStartSettings" type="button" onClick={props.onSettings}>
            <Settings className="ico" aria-hidden="true" />
            설정
          </button>
          <button className="secondary tile" id="btnStartBook" type="button" onClick={props.onBook}>
            <BookOpen className="ico" aria-hidden="true" />
            문장장
          </button>
          <button className="secondary tile" id="btnStartCourse" type="button" onClick={props.onCourse}>
            <MapIcon className="ico" aria-hidden="true" />
            교육과정
          </button>
          <button className="secondary tile" id="btnStartTransfer" type="button" onClick={props.onTransfer}>
            <ArrowLeftRight className="ico" aria-hidden="true" />
            폰↔PC 옮기기
          </button>
        </div>

        {!firstTime && (
          <div className="routine" id="todayRoutine">
            <h3>오늘 할 일</h3>
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
                      <button className="secondary small" type="button" onClick={props.onReview}>
                        하러 가기
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      <nav id="bottom-dock" className="bottom-dock" aria-label="하단 네비게이션 독">
        <button
          type="button"
          id="tab-home"
          className="dock-btn active"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <div className="dock-icon-wrap">
            <Home className="dock-icon" aria-hidden="true" />
          </div>
          <span className="dock-label">홈</span>
        </button>

        <button
          type="button"
          id="tab-chat"
          className="dock-btn"
          onClick={props.onStart}
        >
          <div className="dock-icon-wrap">
            <MessageCircle className="dock-icon" aria-hidden="true" />
          </div>
          <span className="dock-label">대화</span>
          <span className="dock-dot" aria-hidden="true" />
        </button>

        <button
          type="button"
          id="tab-practice"
          className="dock-btn"
          onClick={props.onQuiz}
        >
          <div className="dock-icon-wrap">
            <ListChecks className="dock-icon" aria-hidden="true" />
          </div>
          <span className="dock-label">복습·퀴즈</span>
        </button>

        <button
          type="button"
          id="tab-library"
          className="dock-btn"
          onClick={props.onBook}
        >
          <div className="dock-icon-wrap">
            <BookOpen className="dock-icon" aria-hidden="true" />
          </div>
          <span className="dock-label">내 서재</span>
        </button>
      </nav>
    </section>
  )
}
