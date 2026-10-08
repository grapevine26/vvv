import { useRef, useState } from 'react'
import { TARGET } from '../lib/config'
import { errorText } from '../lib/gemini'
import { overlap, same, splitByScript } from '../lib/text'
import type { Lang, Pair, Segment, WriteCheck } from '../lib/types'
import { MiniButton, Sheet } from './common'

export type Play = (segments: Segment[], slow?: boolean) => void
// 마이크를 실제로 켰으면 true. onEnd는 듣기가 끝나면 항상 불린다
export type Mic = (lang: Lang, onText: (text: string) => void, onEnd?: () => void) => boolean
export type Check = (target: Pair, written: string) => Promise<WriteCheck>

interface Props {
  cards: Pair[]
  unitTitle: string
  turns: number
  minTurns: number
  onPlay: Play
  onMic: Mic
  onCheck: Check
  onToast: (text: string) => void
  onBack: () => void
  onFinish: () => void
}

// 마무리: 단원까지 남은 것 → ③ 듣고 소리 내어 읽기 → ④ 한국어 뜻 보고 영어로 써 보기
export function WrapSheet({ cards, unitTitle, turns, minTurns, onPlay, onMic, onCheck, onToast, onBack, onFinish }: Props) {
  const left = minTurns - turns
  return (
    <Sheet
      id="wrapSheet"
      title="오늘 마무리"
      onClose={onBack}
      footer={
        <>
          <button className={left > 0 ? 'primary' : 'secondary'} id="btnBackToChat" type="button" onClick={onBack}>
            대화로 돌아가기
          </button>
          <button className={left > 0 ? 'secondary' : 'primary'} id="btnFinish" type="button" onClick={onFinish}>
            저장하고 끝내기
          </button>
        </>
      }
    >
      <div className={`unit-status${left > 0 ? ' warn' : ' good'}`} id="wrapUnitStatus">
        {left > 0
          ? `${left}번만 더 주고받으면 「${unitTitle}」 단원을 마쳐요. 대화로 돌아가서 조금만 더 해 볼까요?`
          : `「${unitTitle}」 단원 조건을 채웠어요 ✓ 저장하면 다음 단원으로 넘어가요.`}
      </div>
      <div id="wrapBody">
        {cards.length === 0 ? (
          <p className="muted">오늘은 아직 따라 말한 문장이 없어요. 그래도 저장하면 대화 기록은 남아요.</p>
        ) : (
          <>
            <h3>① 듣고 소리 내어 읽기</h3>
            <p className="note">🔊로 듣고, 🎤를 누른 뒤 소리 내어 읽어 보세요.</p>
            {cards.map((c) => (
              <ReadCard key={c.en} card={c} onPlay={onPlay} onMic={onMic} />
            ))}
            <h3>② 뜻 보고 써 보기</h3>
            <WriteBox cards={cards} onPlay={onPlay} onCheck={onCheck} onToast={onToast} />
          </>
        )}
      </div>
    </Sheet>
  )
}

export function ReadCard({ card, onPlay, onMic }: { card: Pair; onPlay: Play; onMic: Mic }) {
  const [listening, setListening] = useState(false)
  const [result, setResult] = useState<{ good: boolean; text: string } | null>(null)

  const read = () => {
    const started = onMic(
      'en',
      (said) => {
        const good = overlap(card.en, said) >= 0.7
        setResult({
          good,
          text: good ? `잘 들렸어요 👍 ("${said}")` : `이렇게 들렸어요: "${said}" — 한 번 더 해 볼까요?`,
        })
      },
      () => setListening(false),
    )
    if (started) setListening(true)
  }

  return (
    <div className="card read-card">
      <div className="say" lang="en">
        {card.en}
      </div>
      {card.ko && <div className="meaning">{card.ko}</div>}
      <div className="tools">
        <MiniButton label="🔊 듣기" ariaLabel={`${card.en} 듣기`} onClick={() => onPlay(splitByScript(card.en))} />
        <MiniButton label="🐢 천천히" ariaLabel={`${card.en} 천천히 듣기`} onClick={() => onPlay(splitByScript(card.en), true)} />
        <MiniButton label={listening ? '듣는 중… 누르면 끝' : '🎤 읽어 보기'} className="btn-read" onClick={read} />
      </div>
      {result && <div className={`result${result.good ? ' good' : ''}`}>{result.text}</div>}
    </div>
  )
}

interface WriteResult {
  good: boolean
  message: string
  answer?: string
}

export function WriteBox({
  cards,
  onPlay,
  onCheck,
  onToast,
}: {
  cards: Pair[]
  onPlay: Play
  onCheck: Check
  onToast: (text: string) => void
}) {
  const [idx, setIdx] = useState(0)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<WriteResult | null>(null)
  const [checking, setChecking] = useState(false)
  const toolsRef = useRef<HTMLDivElement>(null)
  const card = cards[Math.min(idx, cards.length - 1)]

  const check = async () => {
    const written = value.trim()
    if (!written) {
      onToast('먼저 써 보세요. 모르겠으면 "정답 보기"를 눌러도 돼요.')
      return
    }
    // 정확히 맞으면 AI를 부르지 않는다 (무료 사용량 아끼기)
    if (same(written, card.en)) {
      setResult({ good: true, message: '완벽해요! 👍' })
      return
    }
    setChecking(true)
    setResult({ good: false, message: '보는 중…' })
    try {
      const r = await onCheck(card, written)
      setResult({ good: r.ok, message: r.comment || (r.ok ? '잘했어요!' : '거의 다 왔어요!'), answer: r.fixed })
    } catch (err) {
      setResult({ good: false, message: errorText(err) })
    } finally {
      setChecking(false)
    }
  }

  const next = () => {
    setIdx((i) => (i + 1) % cards.length)
    setValue('')
    setResult(null)
  }

  return (
    <div className="card write-box">
      <div className="write-prompt">
        "{card.ko || card.en}" → {TARGET.label}로?
      </div>
      <textarea
        rows={2}
        lang="en"
        enterKeyHint="done"
        placeholder={`${TARGET.label}로 써 보세요 (철자가 틀려도 괜찮아요)`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // 폰 키보드의 완료(Enter)로 바로 확인
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void check()
          }
        }}
        onFocus={() => setTimeout(() => toolsRef.current?.scrollIntoView({ block: 'nearest' }), 300)}
      />
      <div className="tools" ref={toolsRef}>
        <button type="button" className="primary btn-check" disabled={checking} onClick={() => void check()}>
          확인
        </button>
        {cards.length > 1 && <MiniButton label="다음 문장 →" onClick={next} />}
        <MiniButton
          label="정답 보기"
          className="push-right"
          onClick={() => setResult({ good: false, message: '', answer: card.en })}
        />
      </div>
      {result && (
        <div className={`result${result.good ? ' good' : ''}`}>
          {result.message && <div>{result.message}</div>}
          {result.answer && (
            <div>
              <b lang="en">{result.answer} </b>
              <MiniButton label="🔊" ariaLabel={`${result.answer} 듣기`} onClick={() => onPlay(splitByScript(result.answer ?? ''))} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
