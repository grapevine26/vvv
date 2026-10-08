import { useEffect, useRef, useState } from 'react'
import { TARGET } from '../lib/config'
import { HANGUL } from '../lib/text'
import type { Lang } from '../lib/types'

// 지금 누구 차례인지: 친구가 생각 중 / 말하는 중 / 내가 말하는 중 / 내 차례
export type Phase = 'thinking' | 'speaking' | 'listening' | 'yourTurn'

interface Props {
  friendName: string
  phase: Phase
  listening: Lang | null
  interim: string
  pendingRepeat: string
  pickedHint: string
  // 마이크가 막혔을 때처럼, 사라지면 안 되는 안내
  notice: string
  // 마지막 말풍선이 오류인지 (그때는 '다시 시도'를 먼저 안내)
  hasError: boolean
  firstTime: boolean
  veiled: boolean
  onMic: (lang: Lang) => void
  onCancelListen: () => void
  onStopSpeaking: () => void
  onSend: (text: string, lang: Lang) => void
}

const IDLE_LABEL: Record<Lang, string> = { ko: '눌러서 한국어로 말하기', en: `눌러서 ${TARGET.label}로 말하기` }

export function Composer(props: Props) {
  const { friendName, phase, listening, interim, pendingRepeat, pickedHint, notice, hasError, firstTime, veiled } = props
  const { onMic, onCancelListen, onStopSpeaking, onSend } = props
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const typedRef = useRef(false)
  const busy = phase === 'thinking'
  const keyboardOpen = useKeyboardOpen()

  // 키보드로 보냈으면, 답이 온 뒤 입력칸에 다시 포커스해서 이어서 칠 수 있게 한다
  useEffect(() => {
    if (!busy && typedRef.current) {
      typedRef.current = false
      inputRef.current?.focus()
    }
  }, [busy])

  const target = pickedHint || pendingRepeat
  let guide: string
  let guideClass = 'guide'
  if (phase === 'thinking') guide = `🤔 ${friendName}가 생각 중이에요…`
  else if (phase === 'speaking')
    guide = veiled ? '👂 먼저 잘 들어 보세요. 다 들으면 글자가 보여요' : `🔊 ${friendName}가 말하는 중… 끝나면 내 차례예요`
  else if (phase === 'listening') guide = '🎤 듣는 중… 말을 멈추면 자동으로 보내져요'
  else if (notice) {
    guide = notice
    guideClass += ' warn'
  } else if (pickedHint) guide = `👉 EN을 누르고 "${pickedHint}" 말해 보세요`
  else if (hasError) {
    guide = '연결이 안 됐어요. 위의 "다시 시도"를 누르거나, 다시 말해 보세요.'
    guideClass += ' warn'
  }
  else if (pendingRepeat) guide = `👉 이제 내 차례! EN을 누르고 "${pendingRepeat}" 따라 말해요`
  else if (firstTime) guide = '버튼을 한 번 톡 누르고 말하세요 (누르고 있지 않아도 돼요). 한국어로 대답해도 돼요.'
  else guide = `한국어로 대답해도 돼요. ${TARGET.label}로 해 보고 싶으면 EN 버튼!`

  const micButton = (lang: Lang, badge: string) => {
    const classes = ['mic']
    if (lang === 'en' && phase === 'yourTurn' && target) classes.push('recommend')
    if (listening === lang) classes.push('listening')
    const label = listening === lang ? '듣는 중… 누르면 보내기' : busy ? `${friendName} 생각 중…` : IDLE_LABEL[lang]
    return (
      <button
        id={lang === 'ko' ? 'micKo' : 'micEn'}
        type="button"
        className={classes.join(' ')}
        disabled={busy}
        aria-pressed={listening === lang}
        onClick={() => onMic(lang)}
      >
        <span className="badge" aria-hidden="true">
          {badge}
        </span>
        <span className="mic-label">{label}</span>
      </button>
    )
  }

  return (
    // 입력칸에 포커스가 있어도 화면 키보드가 실제로 열려 있을 때만 마이크 줄을 숨긴다 (키보드만 내려도 버튼이 돌아오게)
    <footer className={`composer${typing && keyboardOpen ? ' typing' : ''}`} id="composer">
      <div className={guideClass} id="guide" role="status">
        <span>{guide}</span>
        {phase === 'speaking' && (
          <button type="button" className="secondary small" id="btnStopSpeak" onClick={onStopSpeaking}>
            ■ 그만
          </button>
        )}
        {phase === 'listening' && (
          <button type="button" className="secondary small" id="btnMicCancel" onClick={onCancelListen}>
            ✕ 취소
          </button>
        )}
      </div>
      {interim && (
        <div className="interim" id="interim" lang={listening === 'en' ? 'en' : undefined}>
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
          typedRef.current = true
          onSend(t, HANGUL.test(t) ? 'ko' : 'en')
        }}
      >
        <input
          id="typeInput"
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          placeholder="키보드로 입력 (한/영 OK)"
          autoComplete="off"
          enterKeyHint="send"
          readOnly={busy}
          aria-busy={busy}
        />
        <button type="submit" id="typeSend" disabled={busy}>
          보내기
        </button>
      </form>
    </footer>
  )
}

// 화면 키보드가 열려 있는지: 화면 높이가 지금까지 본 가장 큰 높이보다 크게 줄었으면 열린 것으로 본다
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const vv = window.visualViewport
    let base = window.innerHeight
    const height = () => Math.min(window.innerHeight, vv ? vv.height : window.innerHeight)
    const check = () => {
      base = Math.max(base, window.innerHeight)
      setOpen(base - height() > 120)
    }
    // 화면을 돌리면 기준 높이를 새로 잡는다
    const onRotate = () =>
      setTimeout(() => {
        base = window.innerHeight
        check()
      }, 300)
    check()
    window.addEventListener('resize', check)
    vv?.addEventListener('resize', check)
    window.addEventListener('orientationchange', onRotate)
    return () => {
      window.removeEventListener('resize', check)
      vv?.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', onRotate)
    }
  }, [])
  return open
}
