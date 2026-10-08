import { TARGET } from '../lib/config'
import { splitByScript, turnSegments } from '../lib/text'
import type { Lang, Segment, Turn } from '../lib/types'
import { ChipRow, Meaning, MiniButton } from './common'

type Play = (segments: Segment[], slow?: boolean) => void

interface AiProps {
  turn: Turn
  veiled: boolean
  showKo: boolean
  onUnveil: () => void
  onPlay: Play
}

export function AiBubble({ turn, veiled, showKo, onUnveil, onPlay }: AiProps) {
  const segs = turnSegments(turn)
  return (
    <div className="msg ai">
      <div className={`bubble${veiled ? ' veiled' : ''}`} onClick={onUnveil}>
        {turn.say && <div className="say">{turn.say}</div>}
        {turn.say && turn.say_ko && <Meaning text={turn.say_ko} conceal={!showKo} />}
        {turn.repeat && (
          <div className="repeat">
            <div className="cue">{turn.cue}</div>
            <div className="repeat-line">
              <span className="repeat-text">{turn.repeat}</span>
              <MiniButton label="🔊" ariaLabel="따라 할 문장 듣기" onClick={() => onPlay(splitByScript(turn.repeat))} />
            </div>
            {turn.repeat_ko && <Meaning text={turn.repeat_ko} conceal={!showKo} />}
          </div>
        )}
        {turn.tip && <div className="tip">💡 {turn.tip}</div>}
        {turn.hints.length > 0 && (
          <ChipRow
            label="이렇게 대답해도 돼요 (누르면 들려요)"
            items={turn.hints}
            kind="hint"
            onPlay={(en) => onPlay([{ text: en, lang: 'en' }])}
          />
        )}
        {turn.words.length > 0 && (
          <ChipRow label="단어" items={turn.words} kind="word" onPlay={(en) => onPlay([{ text: en, lang: 'en' }])} />
        )}
        <div className="tools">
          <MiniButton label="🔊 다시" onClick={() => onPlay(segs)} />
          <MiniButton label="🐢 천천히" onClick={() => onPlay(segs, true)} />
        </div>
      </div>
    </div>
  )
}

export function UserBubble({ text, lang, isRepeat }: { text: string; lang: Lang; isRepeat: boolean }) {
  const tag = isRepeat ? '따라 말하기' : lang === 'ko' ? '한국어' : TARGET.label
  return (
    <div className="msg me">
      <div className="bubble">
        <div className="tag">{tag}</div>
        <div>{text}</div>
      </div>
    </div>
  )
}

export function ErrorBubble({ text, onRetry, onSettings }: { text: string; onRetry: () => void; onSettings: () => void }) {
  return (
    <div className="msg ai error">
      <div className="bubble">
        {text}
        <div className="tools">
          <MiniButton label="다시 시도" onClick={onRetry} />
          <MiniButton label="설정 열기" onClick={onSettings} />
        </div>
      </div>
    </div>
  )
}
