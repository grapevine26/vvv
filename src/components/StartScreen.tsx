import { TARGET } from '../lib/config'

interface Props {
  friendName: string
  message: string
  onStart: () => void
  onSettings: () => void
  onBook: () => void
}

export function StartScreen({ friendName, message, onStart, onSettings, onBook }: Props) {
  const initial = (friendName || 'E').trim().charAt(0).toUpperCase()
  return (
    <section className="sheet solid" id="startSheet">
      <div className="sheet-card">
        <div className="avatar big" aria-hidden="true">
          {initial}
        </div>
        <h1 id="startTitle">
          {friendName}와 {TARGET.label} 수다
        </h1>
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
        </div>
      </div>
    </section>
  )
}
