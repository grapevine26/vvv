interface Props {
  friendName: string
  status: string
  // 대화 중에만: 단원까지 주고받은 횟수, 남은 시간
  turnsText: string | null
  timeText: string | null
  onHome: () => void
  onEnd: () => void
}

// 대화방 머리줄: ‹ 홈 · 친구 · (단원·횟수·남은 시간) · 세션 종료
export function Header({ friendName, status, turnsText, timeText, onHome, onEnd }: Props) {
  const initial = (friendName || 'E').trim().charAt(0).toUpperCase()
  return (
    <header id="header" className="chat-head">
      <div className="chat-head-left">
        <button className="back-link" id="btnBackHome" type="button" onClick={onHome} aria-label="홈으로 가기">
          ‹ 홈
        </button>
        <div className="avatar" aria-hidden="true">
          {initial}
        </div>
        <div className="who">
          <b id="friendName">{friendName}</b>
          <small className="who-line">
            <span id="status">{status}</span>
            {turnsText && (
              <>
                {' · '}
                <span id="turnCount">{turnsText}</span>
              </>
            )}
            {timeText && (
              <>
                {' · '}
                <span id="timer">{timeText}</span>
              </>
            )}
          </small>
        </div>
      </div>
      <button className="end-pill" id="btnEnd" type="button" onClick={onEnd}>
        세션 종료
      </button>
    </header>
  )
}
