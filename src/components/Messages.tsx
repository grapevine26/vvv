import { TARGET } from '../lib/config'
import { splitByScript, turnSegments } from '../lib/text'
import type { FixTarget, Lang, Pair, Segment, Turn } from '../lib/types'
import { Meaning, WordMarks } from './common'

type Play = (segments: Segment[], slow?: boolean) => void

interface AiProps {
  turn: Turn
  friendName: string
  veiled: boolean
  showKo: boolean
  pickedHint: string
  onUnveil: () => void
  onPlay: Play
  onPickHint: (hint: Pair) => void
}

const initialOf = (name: string) => (name || 'E').trim().charAt(0).toUpperCase()

// 말풍선 머리의 작은 알약 버튼 (말풍선 클릭 = 가림 해제와 겹치지 않게 위로 전달하지 않는다)
function Pill({ label, onClick, ariaLabel }: { label: string; onClick: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      className="pill-btn"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

export function AiBubble({ turn, friendName, veiled, showKo, pickedHint, onUnveil, onPlay, onPickHint }: AiProps) {
  const segs = turnSegments(turn)
  return (
    <div className="msg ai">
      <div className="msg-avatar" aria-hidden="true">
        {initialOf(friendName)}
      </div>
      <div className={`bubble${veiled ? ' veiled' : ''}`} onClick={onUnveil}>
        <div className="bubble-head">
          <span className="bubble-speaker">{friendName}의 질문</span>
          <div className="bubble-pills">
            <Pill label="🔊 다시 듣기" ariaLabel="다시 듣기" onClick={() => onPlay(segs)} />
            <Pill label="🐢 천천히" ariaLabel="천천히" onClick={() => onPlay(segs, true)} />
          </div>
        </div>
        {veiled && <div className="veil-note">🔊 {friendName}의 말을 먼저 들어 보세요. 다 들으면 글자가 보여요 (누르면 바로 보기)</div>}
        {turn.say && (
          <div className="say" lang="en">
            {turn.say}
          </div>
        )}
        {turn.say && turn.say_ko && <Meaning text={turn.say_ko} conceal={!showKo} />}
        {turn.repeat && (
          <div className="hint-box repeat">
            <span className="hint-box-label cue">{turn.cue || '이렇게 따라 말해 보세요'}</span>
            <div className="hint-row">
              <span className="hint-row-text">
                <span className="repeat-text" lang="en">
                  {turn.repeat}
                </span>
                {turn.repeat_ko && <Meaning text={turn.repeat_ko} conceal={!showKo} />}
              </span>
              <span className="hint-row-tools">
                <Pill label="🐢" ariaLabel={`따라 할 문장 천천히 듣기: ${turn.repeat}`} onClick={() => onPlay(splitByScript(turn.repeat), true)} />
                <button
                  type="button"
                  className="follow-btn"
                  aria-label={`따라 할 문장 듣기: ${turn.repeat}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlay(splitByScript(turn.repeat))
                  }}
                >
                  따라하기
                </button>
              </span>
            </div>
          </div>
        )}
        {turn.tip && (
          <div className="tip">
            <span>{turn.tip}</span>
          </div>
        )}
        {turn.hints.length > 0 && (
          <div className="hint-box">
            <span className="hint-box-label">💡 이렇게 대답해 보세요 (누르면 들려요)</span>
            <div className="chips">
              {turn.hints.map((h) => (
                <button
                  key={h.en}
                  type="button"
                  className={`chip hint${pickedHint === h.en ? ' picked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onPickHint(h)
                  }}
                >
                  <span className="chip-text">
                    <span className="c-en" lang="en">
                      {h.en}
                    </span>
                    <span className="c-ko">{h.ko}</span>
                  </span>
                  <span className="follow-btn" aria-hidden="true">
                    따라하기
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {turn.words.length > 0 && (
          <div className="words">
            <span className="words-label">단어</span>
            <div className="chips">
              {turn.words.map((w) => (
                <button
                  key={w.en}
                  type="button"
                  className="chip word"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPlay([{ text: w.en, lang: 'en' }])
                  }}
                >
                  <span className="c-en" lang="en">
                    {w.en}
                  </span>
                  <span className="c-ko">{w.ko}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface UserBubbleProps {
  text: string
  lang: Lang
  isRepeat: boolean
  fromHint?: boolean
  heardWell?: boolean
  // 따라 말하기·대답 예시의 목표 문장 (발음 피드백용)
  goal?: string
}

export function UserBubble({ text, lang, isRepeat, fromHint, heardWell, goal }: UserBubbleProps) {
  const tag = isRepeat ? '따라 말하기' : fromHint ? '대답 예시' : lang === 'ko' ? '한국어' : TARGET.label
  return (
    <div className="msg me">
      <div className="bubble">
        <div className="me-label">
          내 답변 (<span className="tag">{tag}</span>)
        </div>
        <div className="me-text" lang={lang === 'en' ? 'en' : undefined}>
          {text}
        </div>
        {heardWell && (
          <div className="heard">
            잘 들렸어요
          </div>
        )}
      </div>
      {goal && <WordMarks goal={goal} said={text} />}
    </div>
  )
}

// 친구가 말하는 동안 대화 칸 아래에 뜨는 네온 오디오 웨이브
export function SpeakingWave({ friendName }: { friendName: string }) {
  return (
    <div className="wave-card" id="speakingWave" aria-hidden="true">
      <WaveBars />
      <span className="wave-text">{friendName}가 말하는 중… 끝나면 내 차례예요</span>
    </div>
  )
}

function WaveBars() {
  return (
    <div className="wave-bars">
      <span className="wave-bar bar-1" />
      <span className="wave-bar bar-2" />
      <span className="wave-bar bar-3" />
      <span className="wave-bar bar-4" />
      <span className="wave-bar bar-5" />
    </div>
  )
}

const FIX_LABEL: Record<Exclude<FixTarget, null>, string> = { apiKey: '키 다시 넣기', model: '모델 이름 고치기' }

export function ErrorBubble({
  text,
  fix,
  canRetry,
  onRetry,
  onSettings,
}: {
  text: string
  fix: FixTarget
  canRetry: boolean
  onRetry: () => void
  onSettings: (fix: FixTarget) => void
}) {
  return (
    <div className="msg ai error">
      <div className="msg-avatar" aria-hidden="true">
        !
      </div>
      <div className="bubble" role="alert">
        {text}
        <div className="tools">
          {fix ? (
            <button type="button" className="primary small" onClick={() => onSettings(fix)}>
              {FIX_LABEL[fix]}
            </button>
          ) : (
            canRetry && (
              <button type="button" className="primary small btn-retry" onClick={onRetry}>
                다시 시도
              </button>
            )
          )}
          {fix && canRetry && (
            <button type="button" className="secondary small btn-retry" onClick={onRetry}>
              다시 시도
            </button>
          )}
          {!fix && (
            <button type="button" className="secondary small" onClick={() => onSettings(null)}>
              설정 열기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// 생각 중 표시. 오래 걸리면 기다리기를 그만둘 수 있게 한다
export function TypingBubble({ friendName, slow, onCancel }: { friendName: string; slow: boolean; onCancel: () => void }) {
  return (
    <div className="msg ai">
      <div className="msg-avatar" aria-hidden="true">
        {initialOf(friendName)}
      </div>
      <div className="bubble typing">
        <span className="dots" aria-label="생각 중">
          <i />
          <i />
          <i />
        </span>
        {slow && (
          <div className="tools">
            <span className="muted">조금 오래 걸려요…</span>
            <button type="button" className="secondary small" id="btnCancelWait" onClick={onCancel}>
              그만 기다리기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
