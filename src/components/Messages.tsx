import { Lightbulb, Snail, ThumbsUp, Volume2 } from 'lucide-react'
import { TARGET } from '../lib/config'
import { splitByScript, turnSegments } from '../lib/text'
import type { FixTarget, Lang, Pair, Segment, Turn } from '../lib/types'
import { ChipRow, Meaning, MiniButton, WordMarks } from './common'

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

export function AiBubble({ turn, friendName, veiled, showKo, pickedHint, onUnveil, onPlay, onPickHint }: AiProps) {
  const segs = turnSegments(turn)
  return (
    <div className="msg ai">
      <div className={`bubble${veiled ? ' veiled' : ''}`} onClick={onUnveil}>
        {veiled && (
          <div className="veil-note">
            <Volume2 className="ico" aria-hidden="true" />
            {friendName}의 말을 먼저 들어 보세요. 다 들으면 글자가 보여요 (누르면 바로 보기)
          </div>
        )}
        {turn.say && (
          <div className="say" lang="en">
            {turn.say}
          </div>
        )}
        {turn.say && turn.say_ko && <Meaning text={turn.say_ko} conceal={!showKo} />}
        {turn.repeat && (
          <div className="repeat">
            <div className="cue">{turn.cue}</div>
            <div className="repeat-line">
              <span className="repeat-text" lang="en">
                {turn.repeat}
              </span>
              <MiniButton
                label=""
                icon={<Volume2 className="ico" aria-hidden="true" />}
                ariaLabel={`따라 할 문장 듣기: ${turn.repeat}`}
                onClick={() => onPlay(splitByScript(turn.repeat))}
              />
              <MiniButton
                label=""
                icon={<Snail className="ico" aria-hidden="true" />}
                ariaLabel={`따라 할 문장 천천히 듣기: ${turn.repeat}`}
                onClick={() => onPlay(splitByScript(turn.repeat), true)}
              />
            </div>
            {turn.repeat_ko && <Meaning text={turn.repeat_ko} conceal={!showKo} />}
          </div>
        )}
        {turn.tip && (
          <div className="tip">
            <Lightbulb className="ico" aria-hidden="true" />
            <span>{turn.tip}</span>
          </div>
        )}
        {turn.hints.length > 0 && (
          <ChipRow label="이렇게 대답해도 돼요 (누르면 들려요)" items={turn.hints} kind="hint" picked={pickedHint} onPick={onPickHint} />
        )}
        {turn.words.length > 0 && (
          <ChipRow label="단어" items={turn.words} kind="word" onPick={(w) => onPlay([{ text: w.en, lang: 'en' }])} />
        )}
        <div className="tools">
          <MiniButton label="다시" icon={<Volume2 className="ico" aria-hidden="true" />} onClick={() => onPlay(segs)} />
          <MiniButton label="천천히" icon={<Snail className="ico" aria-hidden="true" />} onClick={() => onPlay(segs, true)} />
        </div>
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
        <div className="tag">{tag}</div>
        <div lang={lang === 'en' ? 'en' : undefined}>{text}</div>
      </div>
      {goal && <WordMarks goal={goal} said={text} />}
      {heardWell && (
        <div className="heard">
          <ThumbsUp className="ico" aria-hidden="true" />잘 들렸어요
        </div>
      )}
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
      <div className="bubble" role="alert">
        {text}
        <div className="tools">
          {fix ? (
            <button type="button" className="primary" onClick={() => onSettings(fix)}>
              {FIX_LABEL[fix]}
            </button>
          ) : (
            canRetry && (
              <button type="button" className="primary btn-retry" onClick={onRetry}>
                다시 시도
              </button>
            )
          )}
          {fix && canRetry && (
            <button type="button" className="secondary btn-retry" onClick={onRetry}>
              다시 시도
            </button>
          )}
          {!fix && (
            <button type="button" className="secondary" onClick={() => onSettings(null)}>
              설정 열기
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// 생각 중 표시. 오래 걸리면 기다리기를 그만둘 수 있게 한다
export function TypingBubble({ slow, onCancel }: { slow: boolean; onCancel: () => void }) {
  return (
    <div className="msg ai">
      <div className="bubble typing">
        <span className="dots" aria-label="생각 중">
          <i />
          <i />
          <i />
        </span>
        {slow && (
          <div className="tools">
            <span className="muted">조금 오래 걸려요…</span>
            <button type="button" className="secondary" id="btnCancelWait" onClick={onCancel}>
              그만 기다리기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
