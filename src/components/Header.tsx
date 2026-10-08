interface Props {
  friendName: string
  status: string
  timer: string | null
  onSettings: () => void
  onEnd: (() => void) | null
}

export function Header({ friendName, status, timer, onSettings, onEnd }: Props) {
  const initial = (friendName || 'E').trim().charAt(0).toUpperCase()
  return (
    <header>
      <div className="avatar" aria-hidden="true">
        {initial}
      </div>
      <div className="who">
        <b id="friendName">{friendName}</b>
        <small>
          <span id="status">{status}</span>
          {timer && (
            <span className="timer" id="timer">
              {timer}
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
