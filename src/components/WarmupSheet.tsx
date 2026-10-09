import { useLatestRef } from '../hooks/useLatestRef'
import { ArrowRight, Check, CircleCheckBig, Mic as MicIcon, Snail, Square, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { diffWords } from '../lib/pronounce'
import { BLANK, exampleOf, patternsFor, sentence, speakable, swapFills, type Fill, type Pattern } from '../lib/patterns'
import { splitByScript } from '../lib/text'
import type { Pair, Stage, Unit } from '../lib/types'
import { MiniButton, Sheet, WordMarks } from './common'
import type { Mic, Play } from './WrapSheet'
import './warmup.css'

// 1) 기초 틀 연습: 대화 전에 오늘 단원의 문장 틀 몇 개를 듣고·따라 하고·단어를 바꿔 말해 본다
export interface WarmupProps {
  stage: Stage
  unit: Unit
  onPlay: Play
  onMic: Mic
  // 듣는 중인 마이크를 보내지 않고 끈다
  onStopMic?: () => void
  // 연습을 마치고 바로 대화 시작
  onDone: () => void
  onClose: () => void
}

// 틀 하나 안의 순서: ① 듣기 → ② 따라 말하기 → ③ 단어 바꿔 말하기(빈칸이 있을 때만)
type Step = 'listen' | 'say' | 'swap'
const STEP_NAMES: Record<Step, string> = { listen: '듣기', say: '따라 말하기', swap: '바꿔 말하기' }

const stepsOf = (p: Pattern): Step[] => (swapFills(p).length > 0 ? ['listen', 'say', 'swap'] : ['listen', 'say'])

export function WarmupSheet({ unit, onPlay, onMic, onStopMic, onDone, onClose }: WarmupProps) {
  const patterns = useMemo(() => patternsFor(unit), [unit])
  const [idx, setIdx] = useState(0)
  const [step, setStep] = useState<Step>('listen')
  // 지금 단계에서 할 일을 한 번 해 봤는지 (했으면 '다음' 버튼을 앞세운다)
  const [tried, setTried] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)
  const markTried = useCallback(() => setTried(true), [])

  const finished = idx >= patterns.length
  const pattern = patterns[Math.min(idx, patterns.length - 1)]
  const steps = pattern ? stepsOf(pattern) : []
  const stepNo = steps.indexOf(step)
  const lastStep = stepNo === steps.length - 1
  const lastFrame = idx === patterns.length - 1

  // 새 단계로 넘어가면 맨 위(진행 표시)부터 보이게
  useEffect(() => {
    topRef.current?.scrollIntoView({ block: 'nearest' })
  }, [idx, step])

  const next = () => {
    setTried(false)
    if (!lastStep) {
      setStep(steps[stepNo + 1])
      return
    }
    setIdx((i) => i + 1)
    setStep('listen')
  }

  const nextLabel = !lastStep
    ? `다음: ${STEP_NAMES[steps[stepNo + 1]]}`
    : lastFrame
      ? '연습 마치기'
      : '다음 문장 틀'

  const footer =
    finished || patterns.length === 0 ? (
      <button className="primary" id="btnWarmupDone" type="button" onClick={onDone}>
        대화 시작하기
      </button>
    ) : (
      <>
        <button className="secondary" id="btnWarmupSkip" type="button" onClick={onDone}>
          바로 대화하기
        </button>
        <button className={`${tried ? 'primary' : 'secondary'} wu-next`} id="btnWarmupNext" type="button" onClick={next}>
          {nextLabel}
          <ArrowRight className="ico" aria-hidden="true" />
        </button>
      </>
    )

  return (
    <Sheet id="warmupSheet" title="대화 전 2분 연습" onClose={onClose} footer={footer}>
      <div className="wu" ref={topRef}>
        <p className="wu-unit">
          오늘 단원 <b>「{unit.title}」</b>
        </p>
        {patterns.length === 0 ? (
          <p className="note" id="wuEmpty">
            이 단원은 정해진 문장 틀 없이 자유롭게 이야기해요. 바로 대화를 시작해 볼까요?
          </p>
        ) : finished ? (
          <DoneView patterns={patterns} onPlay={onPlay} />
        ) : (
          <>
            <Progress idx={idx} total={patterns.length} steps={steps} step={step} />
            <FrameLine pattern={pattern} />
            {step === 'listen' && <ListenStep key={`l${idx}`} pattern={pattern} onPlay={onPlay} onTried={() => setTried(true)} />}
            {step === 'say' && <SayStep key={`s${idx}`} pattern={pattern} onPlay={onPlay} onMic={onMic} onStopMic={onStopMic} onTried={() => setTried(true)} />}
            {step === 'swap' && <SwapStep key={`w${idx}`} pattern={pattern} onPlay={onPlay} onMic={onMic} onStopMic={onStopMic} onAllDone={markTried} />}
          </>
        )}
      </div>
    </Sheet>
  )
}

function Progress({ idx, total, steps, step }: { idx: number; total: number; steps: Step[]; step: Step }) {
  const at = steps.indexOf(step)
  return (
    <div className="wu-progress" id="wuProgress">
      <div className="wu-count">
        <span className="sr-only">문장 틀 {total}개 중 </span>
        <b>{idx + 1}</b> / {total}
        <span className="sr-only">번째</span>
      </div>
      <ol className="wu-steps" aria-label="이 틀에서 할 일">
        {steps.map((s, i) => (
          <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
            <span className="wu-dot" aria-hidden="true">
              {i < at ? <Check className="ico" /> : i + 1}
            </span>
            {STEP_NAMES[s]}
          </li>
        ))}
      </ol>
    </div>
  )
}

// 빈칸(___)을 노란 칸으로 그린다
function FrameText({ text }: { text: string }) {
  const parts = text.split(BLANK)
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="wu-blank">
              <span className="sr-only">빈칸</span>
            </span>
          )}
        </span>
      ))}
    </>
  )
}

// 문장 틀과 뜻
function FrameLine({ pattern }: { pattern: Pattern }) {
  const parts = pattern.frame.split(BLANK)
  const hasBlank = parts.length > 1
  return (
    <div className="wu-frame" id="wuFrame">
      <div className="wu-frame-label">{pattern.fills.length > 0 ? '문장 틀' : hasBlank ? '자주 쓰는 말' : '통째로 외우는 말'}</div>
      <div className="wu-frame-en" lang="en">
        <FrameText text={pattern.frame} />
      </div>
      {pattern.ko ? (
        <div className="wu-frame-ko">{pattern.ko.replaceAll(BLANK, '○○')}</div>
      ) : (
        <div className="wu-frame-ko">오늘 대화에서 자주 쓸 말이에요.</div>
      )}
      {hasBlank && pattern.fills.length === 0 && <div className="wu-frame-ko">빈칸에는 하고 싶은 말을 넣으면 돼요.</div>}
    </div>
  )
}

function Guide({ n, children }: { n: number; children: string }) {
  return (
    <p className="wu-guide" aria-live="polite">
      <span className="wu-guide-n" aria-hidden="true">
        {n}
      </span>
      {children}
    </p>
  )
}

// 들을 문장 (빈칸은 빼고 읽는다)
function Sentence({ pair }: { pair: Pair }) {
  return (
    <>
      <div className="say wu-say" lang="en">
        <FrameText text={pair.en} />
      </div>
      {pair.ko && <div className="meaning">{pair.ko}</div>}
    </>
  )
}

function PlayButtons({ text, onPlay, onHeard, strong }: { text: string; onPlay: Play; onHeard?: () => void; strong?: boolean }) {
  const say = speakable(text)
  return (
    <>
      <button
        type="button"
        className={`${strong ? 'primary' : 'secondary'} wu-play`}
        aria-label={`${say} 듣기`}
        onClick={() => {
          onPlay(splitByScript(say))
          onHeard?.()
        }}
      >
        <Volume2 className="ico" aria-hidden="true" />
        듣기
      </button>
      <MiniButton
        label="천천히"
        icon={<Snail className="ico" aria-hidden="true" />}
        ariaLabel={`${say} 천천히 듣기`}
        onClick={() => {
          onPlay(splitByScript(say), true)
          onHeard?.()
        }}
      />
    </>
  )
}

function ListenStep({ pattern, onPlay, onTried }: { pattern: Pattern; onPlay: Play; onTried: () => void }) {
  const [heard, setHeard] = useState(false)
  const ex = exampleOf(pattern)
  return (
    <>
      <Guide n={1}>먼저 들어 보세요</Guide>
      <div className="card wu-card" id="wuListen">
        <Sentence pair={ex} />
        <div className="tools">
          <PlayButtons
            text={ex.en}
            onPlay={onPlay}
            strong={!heard}
            onHeard={() => {
              setHeard(true)
              onTried()
            }}
          />
        </div>
        {heard && (
          <p className="wu-hint" role="status">
            한 번 더 들어도 돼요. 됐으면 아래 <b>다음</b>을 눌러요.
          </p>
        )}
      </div>
    </>
  )
}

interface Heard {
  said: string
  good: boolean
}

// 마이크로 말해 보고, 목표 문장과 단어를 비교한다 (AI는 부르지 않는다)
function useTry(onMic: Mic, onStopMic?: () => void) {
  const [listening, setListening] = useState(false)
  // 이 단계를 떠나면 듣던 마이크를 끈다 (다음 단계의 첫 누르기가 헛돌지 않게)
  const stopRef = useLatestRef(onStopMic)
  useEffect(() => () => stopRef.current?.(), [stopRef])
  const [heard, setHeard] = useState<Heard | null>(null)
  const start = (goal: string, onResult?: (h: Heard) => void) => {
    const started = onMic(
      'en',
      (said) => {
        const h = { said, good: diffWords(goal, said).every((m) => m.ok) }
        setHeard(h)
        onResult?.(h)
      },
      () => setListening(false),
    )
    if (started) setListening(true)
  }
  return { listening, heard, start, reset: () => setHeard(null) }
}

function MicButton({ listening, label, onClick, strong }: { listening: boolean; label: string; onClick: () => void; strong: boolean }) {
  return (
    <button
      type="button"
      className={`${strong && !listening ? 'primary' : 'secondary'} wu-mic${listening ? ' listening' : ''}`}
      onClick={onClick}
    >
      {listening ? <Square className="ico" aria-hidden="true" /> : <MicIcon className="ico" aria-hidden="true" />}
      {listening ? '듣는 중… 다 말하면 누르기' : label}
    </button>
  )
}

function HeardResult({ goal, heard }: { goal: string; heard: Heard }) {
  return (
    <div className={`result wu-result${heard.good ? ' good' : ''}`} role="status">
      {heard.good ? (
        <div className="wu-praise">
          <CircleCheckBig className="ico" aria-hidden="true" />
          잘 들렸어요! 아주 좋아요.
        </div>
      ) : (
        <div>
          이렇게 들렸어요: <span lang="en">"{heard.said}"</span>
          <br />
          빨간 단어를 조금 더 또렷하게, 한 번 더 해 볼까요?
        </div>
      )}
      <WordMarks goal={goal} said={heard.said} />
    </div>
  )
}

function SayStep({ pattern, onPlay, onMic, onStopMic, onTried }: { pattern: Pattern; onPlay: Play; onMic: Mic; onStopMic?: () => void; onTried: () => void }) {
  const ex = exampleOf(pattern)
  const goal = speakable(ex.en)
  const t = useTry(onMic, onStopMic)
  return (
    <>
      <Guide n={2}>듣고 똑같이 따라 말해 보세요</Guide>
      <div className="card wu-card" id="wuSay">
        <Sentence pair={ex} />
        <div className="tools">
          <PlayButtons text={ex.en} onPlay={onPlay} />
        </div>
        <MicButton listening={t.listening} label="따라 말하기" strong={!t.heard?.good} onClick={() => t.start(goal, onTried)} />
        {t.heard && <HeardResult goal={goal} heard={t.heard} />}
      </div>
    </>
  )
}

function SwapStep({ pattern, onPlay, onMic, onStopMic, onAllDone }: { pattern: Pattern; onPlay: Play; onMic: Mic; onStopMic?: () => void; onAllDone: () => void }) {
  const fills = swapFills(pattern)
  const [picked, setPicked] = useState<Fill | null>(null)
  const [done, setDone] = useState<string[]>([])
  const t = useTry(onMic, onStopMic)
  const now = picked ? sentence(pattern, picked) : null
  const goal = now ? speakable(now.en) : ''

  const pick = (fill: Fill) => {
    setPicked(fill)
    t.reset()
    // 바꿔 넣은 문장을 바로 들려준다
    onPlay(splitByScript(speakable(sentence(pattern, fill).en)))
  }

  const speak = () => {
    if (!picked) return
    const word = picked.en
    t.start(goal, () => {
      setDone((d) => (d.includes(word) ? d : [...d, word]))
    })
  }

  const left = fills.filter((x) => !done.includes(x.en))
  const allDone = left.length === 0
  useEffect(() => {
    if (allDone) onAllDone()
  }, [allDone, onAllDone])
  return (
    <>
      <Guide n={3}>단어를 골라 바꿔 말해 보세요</Guide>
      <div className="card wu-card" id="wuSwap">
        <div className="label">빈칸에 넣을 단어 (하나씩 눌러 보세요)</div>
        <div className="chips wu-chips">
          {fills.map((fill) => {
            const isDone = done.includes(fill.en)
            return (
              <button
                key={fill.en}
                type="button"
                className={`chip wu-chip${picked?.en === fill.en ? ' picked' : ''}${isDone ? ' done' : ''}`}
                aria-pressed={picked?.en === fill.en}
                onClick={() => pick(fill)}
              >
                {isDone && <Check className="ico wu-chip-check" aria-label="해 봄" />}
                <span className="c-en" lang="en">
                  {fill.en}
                </span>
                <span className="c-ko">{fill.ko}</span>
              </button>
            )
          })}
        </div>
        {now ? (
          <div className="wu-swapped">
            <Sentence pair={now} />
            <div className="tools">
              <PlayButtons text={now.en} onPlay={onPlay} />
            </div>
            <MicButton listening={t.listening} label="말해 보기" strong={!done.includes(picked?.en ?? '')} onClick={speak} />
            {t.heard && <HeardResult goal={goal} heard={t.heard} />}
          </div>
        ) : (
          <p className="wu-hint">단어를 누르면 바뀐 문장을 들려줘요.</p>
        )}
        <p className="wu-hint" id="wuSwapCount">
          {allDone
            ? '다 바꿔 말해 봤어요! 아래 버튼으로 넘어가요.'
            : `${fills.length}개 중 ${done.length}개 해 봤어요.`}
        </p>
      </div>
    </>
  )
}

function DoneView({ patterns, onPlay }: { patterns: Pattern[]; onPlay: Play }) {
  return (
    <div className="wu-done" id="wuDone">
      <div className="wu-done-head">
        <CircleCheckBig className="ico" aria-hidden="true" />
        <div>
          <b>다 했어요!</b>
          <div>이제 대화에서 써 봐요.</div>
        </div>
      </div>
      <p className="note">대화 중에 막히면 이 틀을 떠올려 보세요.</p>
      <ul className="wu-recap">
        {patterns.map((p) => (
          <li key={p.frame} className="card">
            <div className="wu-recap-text">
              <div className="wu-recap-en" lang="en">
                <FrameText text={p.frame} />
              </div>
              {p.ko && <div className="wu-frame-ko">{p.ko.replaceAll(BLANK, '○○')}</div>}
            </div>
            <MiniButton
              label=""
              icon={<Volume2 className="ico" aria-hidden="true" />}
              ariaLabel={`${speakable(exampleOf(p).en)} 듣기`}
              onClick={() => onPlay(splitByScript(speakable(exampleOf(p).en)))}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
