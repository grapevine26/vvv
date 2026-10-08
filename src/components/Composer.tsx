import { useState } from 'react'
import { TARGET } from '../lib/config'
import { HANGUL } from '../lib/text'
import type { Lang } from '../lib/types'

interface Props {
  busy: boolean
  listening: Lang | null
  interim: string
  pendingRepeat: string
  onMic: (lang: Lang) => void
  onSend: (text: string, lang: Lang) => void
}

const IDLE_LABEL: Record<Lang, string> = { ko: '한국어로 말하기', en: `${TARGET.label}로 말하기` }

export function Composer({ busy, listening, interim, pendingRepeat, onMic, onSend }: Props) {
  const [text, setText] = useState('')
  const guide = pendingRepeat
    ? `👉 EN 버튼을 누르고 "${pendingRepeat}" 따라 말해 보세요`
    : `한국어로 대답해도 돼요. ${TARGET.label}로 해 보고 싶으면 EN 버튼!`

  const micButton = (lang: Lang, badge: string) => {
    const classes = ['mic']
    if (lang === 'en' && pendingRepeat) classes.push('recommend')
    if (listening === lang) classes.push('listening')
    return (
      <button
        id={lang === 'ko' ? 'micKo' : 'micEn'}
        type="button"
        className={classes.join(' ')}
        disabled={busy || (listening !== null && listening !== lang)}
        onClick={() => onMic(lang)}
      >
        <span className="badge">{badge}</span>
        <span className="mic-label">{listening === lang ? '듣는 중… (누르면 멈춤)' : IDLE_LABEL[lang]}</span>
      </button>
    )
  }

  return (
    <footer className="composer" id="composer">
      <div className="guide" id="guide">
        {guide}
      </div>
      {interim && (
        <div className="interim" id="interim">
          {interim}
        </div>
      )}
      <div className="mics">
        {micButton('ko', '한')}
        {micButton('en', 'EN')}
      </div>
      <form
        className="typebar"
        id="typeForm"
        onSubmit={(e) => {
          e.preventDefault()
          const t = text.trim()
          if (!t || busy) return
          setText('')
          onSend(t, HANGUL.test(t) ? 'ko' : 'en')
        }}
      >
        <input
          id="typeInput"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="키보드로 입력 (한/영 OK)"
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" id="typeSend" disabled={busy}>
          보내기
        </button>
      </form>
    </footer>
  )
}
