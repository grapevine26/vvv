interface Props {
  friendName: string
  status: string
  // 대화 중에만: 단원까지 주고받은 횟수, 남은 시간
  turnsText: string | null
  timeText: string | null
  onSettings: () => void
  onEnd: (() => void) | null
}

export function Header({ friendName, status, turnsText, timeText, onSettings, onEnd }: Props) {
  const initial = (friendName || 'E').trim().charAt(0).toUpperCase()
  return (
    <header>
      <div className="avatar" aria-hidden="true">
        {initial}
      </div>
      <div className="who">
        {/* 대화 중엔 둘째 줄에 칸 수·남은 시간이 있어서, 상태 글자는 이름 옆으로 올린다 */}
        <div className="who-name">
          <b id="friendName">{friendName}</b>
          {turnsText && <span id="status">{status}</span>}
        </div>
        <small className="who-line">
          {!turnsText && <span id="status">{status}</span>}
          {turnsText && (
            <span className="pill" id="turnCount">
              {turnsText}
            </span>
          )}
          {timeText && (
            <span className="pill" id="timer">
              {timeText}
            </span>
          )}
        </small>
      </div>
      <button className="icon-btn" id="btnSettings" type="button" aria-label="설정" onClick={onSettings}>
        ⚙️
      </button>
      {onEnd && (
        <button className="icon-btn end" id="btnEnd" type="button" onClick={onEnd}>
          끝내기
        </button>
      )}
    </header>
  )
}
