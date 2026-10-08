import { useState } from 'react'
import { TARGET } from '../lib/config'
import { errorText } from '../lib/gemini'
import { overlap, same, splitByScript } from '../lib/text'
import type { Lang, Pair, Segment, WriteCheck } from '../lib/types'
import { MiniButton } from './common'

type Play = (segments: Segment[], slow?: boolean) => void
// 마이크를 실제로 켰으면 true. onEnd는 듣기가 끝나면 항상 불린다
type Mic = (lang: Lang, onText: (text: string) => void, onEnd?: () => void) => boolean

interface Props {
  cards: Pair[]
  onPlay: Play
  onMic: Mic
  onCheck: (target: Pair, written: string) => Promise<WriteCheck>
  onToast: (text: string) => void
  onBack: () => void
  onFinish: () => void
}

// 마무리: ③ 듣고 소리 내어 읽기 → ④ 한국어 뜻 보고 영어로 써 보기
export function WrapSheet({ cards, onPlay, onMic, onCheck, onToast, onBack, onFinish }: Props) {
  return (
    <section className="sheet" id="wrapSheet">
      <div className="sheet-card">
        <h2>오늘 마무리</h2>
        <div id="wrapBody">
          {cards.length === 0 ? (
            <p className="muted">오늘은 아직 따라 말한 문장이 없어요. 조금 더 이야기해 볼까요?</p>
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
        <div className="actions">
          <button className="secondary" id="btnBackToChat" type="button" onClick={onBack}>
            대화로 돌아가기
          </button>
          <button className="primary" id="btnFinish" type="button" onClick={onFinish}>
            저장하고 끝내기
          </button>
        </div>
      </div>
    </section>
  )
}

function ReadCard({ card, onPlay, onMic }: { card: Pair; onPlay: Play; onMic: Mic }) {
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
    <div className="card">
      <div className="say">{card.en}</div>
      {card.ko && <div className="meaning">{card.ko}</div>}
      <div className="tools">
        <MiniButton label="🔊 듣기" onClick={() => onPlay(splitByScript(card.en))} />
        <MiniButton label="🐢" ariaLabel="천천히 듣기" onClick={() => onPlay(splitByScript(card.en), true)} />
        <MiniButton label={listening ? '듣는 중…' : '🎤 읽어 보기'} onClick={read} />
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

function WriteBox({
  cards,
  onPlay,
  onCheck,
  onToast,
}: {
  cards: Pair[]
  onPlay: Play
  onCheck: Props['onCheck']
  onToast: (text: string) => void
}) {
  const [idx, setIdx] = useState(0)
  const [value, setValue] = useState('')
  const [result, setResult] = useState<WriteResult | null>(null)
  const [checking, setChecking] = useState(false)
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
    <div className="card">
      <div className="write-prompt">
        "{card.ko || card.en}" → {TARGET.label}로?
      </div>
      <textarea
        rows={2}
        placeholder={`${TARGET.label}로 써 보세요 (철자가 틀려도 괜찮아요)`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="tools">
        <MiniButton label="확인" onClick={check} disabled={checking} />
        <MiniButton label="정답 보기" onClick={() => setResult({ good: false, message: '', answer: card.en })} />
        {cards.length > 1 && <MiniButton label="다음 문장 →" onClick={next} />}
      </div>
      {result && (
        <div className={`result${result.good ? ' good' : ''}`}>
          {result.message && <div>{result.message}</div>}
          {result.answer && (
            <div>
              <b>{result.answer} </b>
              <MiniButton label="🔊" ariaLabel="듣기" onClick={() => onPlay(splitByScript(result.answer ?? ''))} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
