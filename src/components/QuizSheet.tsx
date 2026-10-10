import { CircleCheck, CircleX, Headphones, Mic as MicIcon, Puzzle, RotateCcw, Snail, Trophy, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  buildQuestions,
  countDueBy,
  grade,
  loadQuizStats,
  nextDue,
  orderCorrect,
  pickAhead,
  pickQuiz,
  saveQuizStats,
  SPEAK_PASS,
  type Question,
  type QuizStats,
} from '../lib/quiz'
import { quizPool } from '../lib/starter'
import { addDays, localDate, overlap, splitByScript } from '../lib/text'
import type { LearnedItem, Pair, Settings } from '../lib/types'
import { useLatestRef } from '../hooks/useLatestRef'
import { MiniButton, Sheet, WordMarks } from './common'
import type { Mic, Play } from './WrapSheet'
import './quiz.css'

// 2) 5분 복습 퀴즈: 내 문장 노트의 문장으로 듣고 뜻 고르기·뜻 보고 말하기·단어 순서 맞추기
export interface QuizProps {
  learned: LearnedItem[]
  settings: Settings
  onPlay: Play
  onMic: Mic
  // 듣는 중인 마이크를 보내지 않고 끈다
  onStopMic?: () => void
  onClose: () => void
  // 창 대신 복습·퀴즈 탭 화면 안에 그린다
  page?: boolean
}

// 한 문제를 푼 결과
interface Answer {
  correct: boolean
  // 고른 보기 (뜻 고르기)
  chosen?: string
  // 말하거나 쓴 문장 (말하기)
  said?: string
  // 모르겠어요를 눌렀는지
  skipped?: boolean
}

type Phase = 'intro' | 'question' | 'done'

// '2026-10-12' → '10월 12일'
const dayLabel = (d: string) => {
  const [, m, day] = d.split('-').map(Number)
  return `${m}월 ${day}일`
}

export function QuizSheet({ learned, onPlay, onMic, onStopMic, onClose, page }: QuizProps) {
  const [today] = useState(() => localDate())
  const [stats, setStats] = useState<QuizStats>(loadQuizStats)
  // 처음 연 순간의 오늘 할 문장 (다시 그려도 섞이지 않게 한 번만 고른다)
  // 노트가 비면(첫날) 기본 표현으로 낸다
  const pool = quizPool(learned)
  const [picked] = useState(() => pickQuiz(pool, stats, today))
  const [phase, setPhase] = useState<Phase>('intro')
  const [questions, setQuestions] = useState<Question[]>([])
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<Answer[]>([])

  const start = (items: Pair[]) => {
    setQuestions(buildQuestions(items, pool))
    setIdx(0)
    setAnswers([])
    setPhase('question')
  }

  const q = questions[idx]
  const answer = answers[idx]
  const last = idx === questions.length - 1

  const submit = (a: Answer) => {
    if (!q || answers[idx]) return
    setAnswers((list) => {
      const next = list.slice()
      next[idx] = a
      return next
    })
    // 듣던 마이크는 끈다 (입력칸으로 답했을 때 다음 말하기 문제의 첫 누르기가 헛돌지 않게)
    onStopMic?.()
    // 쓰기 직전에 저장소를 다시 읽어 이 문장만 바꾼다 (다른 탭에서 푼 결과를 덮어쓰지 않게)
    const s = grade(loadQuizStats(), q.item.en, a.correct, today)
    setStats(s)
    saveQuizStats(s)
    // 틀렸으면 정답 문장을 바로 들려준다 (뜻 고르기는 이미 들었으니 뺀다)
    if (!a.correct && q.kind !== 'meaning') onPlay(splitByScript(q.item.en))
  }

  const next = () => {
    if (last) setPhase('done')
    else setIdx((i) => i + 1)
  }

  let footer = null
  if (phase === 'intro' && picked.length > 0)
    footer = (
      <button className="primary" id="qzStart" type="button" onClick={() => start(picked)}>
        시작하기
      </button>
    )
  else if (phase === 'question' && answer)
    footer = (
      <button className="primary" id="qzNext" type="button" onClick={next}>
        {last ? '결과 보기' : '다음 문제'}
      </button>
    )
  else if (phase === 'done' || phase === 'intro')
    footer = (
      <button className="primary" id="qzClose" type="button" onClick={onClose}>
        {phase === 'done' ? '끝내기' : '닫기'}
      </button>
    )

  return (
    <Sheet
      id="quizSheet"
      title="5분 복습 퀴즈"
      page={page}
      side={phase === 'question' ? `${idx + 1} / ${questions.length} 문제` : undefined}
      onClose={onClose}
      footer={footer}
    >
      {phase === 'intro' && (
        <Intro pool={pool} starter={learned.length === 0} picked={picked} stats={stats} onAhead={() => start(pickAhead(pool, stats))} />
      )}
      {phase === 'question' && q && (
        <div className="qz-body">
          <Progress now={idx + (answer ? 1 : 0)} total={questions.length} label={`${idx + 1}번째 문제 / 모두 ${questions.length}문제`} />
          {q.kind === 'meaning' && <MeaningQuestion key={idx} q={q} answer={answer} onPlay={onPlay} onAnswer={submit} />}
          {q.kind === 'speak' && <SpeakQuestion key={idx} q={q} answer={answer} onPlay={onPlay} onMic={onMic} onAnswer={submit} />}
          {q.kind === 'order' && <OrderQuestion key={idx} q={q} answer={answer} onPlay={onPlay} onAnswer={submit} />}
          {answer && <Feedback item={q.item} answer={answer} kind={q.kind} onPlay={onPlay} />}
        </div>
      )}
      {phase === 'done' && <Result questions={questions} answers={answers} stats={stats} today={today} learned={pool} onPlay={onPlay} />}
    </Sheet>
  )
}

function Intro({
  pool,
  starter,
  picked,
  stats,
  onAhead,
}: {
  pool: Pair[]
  // 노트가 비어서 기본 표현으로 내는 중
  starter: boolean
  picked: Pair[]
  stats: QuizStats
  onAhead: () => void
}) {
  const starterNote = starter && (
    <p className="note" id="qzStarterNote">
      아직 내 문장 노트가 비어 있어요. 먼저 기본 표현으로 풀어 봐요.
    </p>
  )
  if (picked.length === 0) {
    const due = nextDue(pool, stats)
    return (
      <div className="qz-empty" id="qzAllDone">
        {starterNote}
        <CircleCheck className="qz-empty-ico ok" aria-hidden="true" />
        <p className="qz-lead">오늘 복습할 문장은 다 봤어요.</p>
        {due && <p className="muted">다음 복습은 {dayLabel(due)}이에요. 잊을 때쯤 다시 꺼내 줄게요.</p>}
        <button className="secondary wide" id="qzAhead" type="button" onClick={onAhead}>
          그래도 더 풀어 보기
        </button>
      </div>
    )
  }
  return (
    <div id="qzIntro">
      {starterNote}
      <p className="qz-lead">
        오늘 볼 문장 <b>{picked.length}개</b>
      </p>
      <p className="muted">잊을 때쯤 다시 꺼내 보면 오래 기억에 남아요. 세 가지 문제가 섞여 나와요.</p>
      <ul className="qz-kinds">
        <li>
          <Headphones className="ico" aria-hidden="true" />
          영어를 듣고 뜻 고르기
        </li>
        <li>
          <MicIcon className="ico" aria-hidden="true" />
          한국어 뜻 보고 영어로 말하기
        </li>
        <li>
          <Puzzle className="ico" aria-hidden="true" />
          단어 조각을 순서대로 놓기
        </li>
      </ul>
      <p className="note">틀려도 괜찮아요. 틀린 문장은 내일 다시 나와요.</p>
    </div>
  )
}

function Progress({ now, total, label }: { now: number; total: number; label: string }) {
  return (
    <div className="qz-progress">
      <div className="qz-progress-text" id="qzProgress">
        {label}
      </div>
      <div className="qz-bar" role="progressbar" aria-label="푼 문제" aria-valuemin={0} aria-valuemax={total} aria-valuenow={now}>
        <div className="qz-bar-fill" style={{ width: `${(now / total) * 100}%` }} />
      </div>
    </div>
  )
}

// 문제 제목: 다음 문제로 넘어가면 여기로 포커스를 옮겨 화면 읽기 프로그램도 새 문제를 읽게 한다
function Ask({ children, icon, badge, top }: { children: string; icon: ReactNode; badge: string; top?: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    // 처음 문제는 시트 제목에 포커스가 있으니, 버튼(시작·다음)에서 넘어온 경우만 옮긴다
    const a = document.activeElement
    if (a && a.tagName === 'BUTTON') ref.current?.focus()
  }, [])
  return (
    <div className="qz-card">
      <span className="qz-badge">{badge}</span>
      {top}
      <h3 className="qz-ask" tabIndex={-1} ref={ref}>
        {icon}
        {children}
      </h3>
    </div>
  )
}

function ListenTools({ en, onPlay, idPrefix }: { en: string; onPlay: Play; idPrefix: string }) {
  return (
    <div className="tools">
      <MiniButton id={`${idPrefix}Play`} label="듣기" icon={<Volume2 className="ico" aria-hidden="true" />} onClick={() => onPlay(splitByScript(en))} />
      <MiniButton label="천천히" icon={<Snail className="ico" aria-hidden="true" />} onClick={() => onPlay(splitByScript(en), true)} />
    </div>
  )
}

interface QuestionProps {
  q: Question
  answer?: Answer
  onPlay: Play
  onAnswer: (a: Answer) => void
}

// (a) 영어를 듣고 한국어 뜻 고르기
function MeaningQuestion({ q, answer, onPlay, onAnswer }: QuestionProps) {
  const right = q.item.ko.trim()
  // 문제가 나오면 바로 한 번 들려준다 (문제가 바뀌면 key로 새로 그리니 문제마다 한 번)
  const playRef = useLatestRef(onPlay)
  const en = q.item.en
  useEffect(() => {
    playRef.current(splitByScript(en))
  }, [playRef, en])
  return (
    <div className="qz-q" data-kind="meaning">
      <Ask badge="듣고 뜻 고르기" icon={<Headphones className="ico" aria-hidden="true" />} top={<ListenTools en={q.item.en} onPlay={onPlay} idPrefix="qzListen" />}>
        잘 듣고, 무슨 뜻인지 골라요
      </Ask>
      <div className="qz-choices">
        {q.choices.map((c) => {
          const state = !answer ? '' : c === right ? ' right' : c === answer.chosen ? ' wrong' : ' dim'
          return (
            <button
              key={c}
              type="button"
              className={`qz-choice${state}`}
              disabled={!!answer}
              aria-pressed={answer ? c === answer.chosen : undefined}
              onClick={() => onAnswer({ correct: c === right, chosen: c })}
            >
              <span className="qz-choice-text">{c}</span>
              {answer && c === right && (
                <span className="qz-tag ok">
                  <CircleCheck className="ico" aria-hidden="true" />
                  정답
                </span>
              )}
              {answer && c !== right && c === answer.chosen && (
                <span className="qz-tag bad">
                  <CircleX className="ico" aria-hidden="true" />
                  고른 답
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// (b) 한국어 뜻 보고 영어로 말하기 (마이크 또는 입력칸)
function SpeakQuestion({ q, answer, onPlay, onMic, onAnswer }: QuestionProps & { onMic: Mic }) {
  const [listening, setListening] = useState(false)
  const [typed, setTyped] = useState('')
  const answeredRef = useLatestRef(!!answer)
  const ko = q.item.ko.trim()

  const judge = (said: string) => {
    const text = said.trim()
    if (!text || answeredRef.current) return
    onAnswer({ correct: overlap(q.item.en, text) >= SPEAK_PASS, said: text })
  }

  const mic = () => {
    const started = onMic('en', judge, () => setListening(false))
    if (started) setListening(true)
  }

  return (
    <div className="qz-q" data-kind="speak">
      <Ask
        badge="뜻 보고 영어로 말하기"
        icon={<MicIcon className="ico" aria-hidden="true" />}
        top={
          ko ? (
            <div className="qz-prompt" id="qzPrompt">
              {ko}
            </div>
          ) : (
            <ListenTools en={q.item.en} onPlay={onPlay} idPrefix="qzSpeak" />
          )
        }
      >
        {ko ? '이 뜻을 영어로 말해 봐요' : '잘 듣고 그대로 말해 봐요'}
      </Ask>
      {!answer && (
        <>
          <button className={`qz-mic${listening ? ' listening' : ''}`} id="qzMic" type="button" aria-pressed={listening} onClick={mic}>
            <MicIcon className="ico" aria-hidden="true" />
            {listening ? '듣는 중… 다 말하면 누르기' : '눌러서 영어로 말하기'}
          </button>
          <form
            className="qz-type"
            onSubmit={(e) => {
              e.preventDefault()
              judge(typed)
            }}
          >
            <label className="sr-only" htmlFor="qzInput">
              영어로 써서 답하기
            </label>
            <input
              id="qzInput"
              lang="en"
              autoComplete="off"
              autoCapitalize="off"
              enterKeyHint="done"
              placeholder="말 대신 써도 돼요"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <button className="secondary" id="qzCheck" type="submit" disabled={!typed.trim()}>
              확인
            </button>
          </form>
          <button className="link qz-skip" id="qzSkip" type="button" onClick={() => onAnswer({ correct: false, skipped: true })}>
            모르겠어요, 정답 볼게요
          </button>
        </>
      )}
    </div>
  )
}

// (c) 단어 조각을 눌러 순서 맞추기
function OrderQuestion({ q, answer, onPlay, onAnswer }: QuestionProps) {
  // 놓은 조각의 번호 (q.pieces 안의 자리)
  const [placed, setPlaced] = useState<number[]>([])
  const ko = q.item.ko.trim()

  const put = (i: number) => {
    if (answer || placed.includes(i)) return
    const next = [...placed, i]
    setPlaced(next)
    // 다 놓으면 바로 채점
    if (next.length === q.pieces.length) {
      const words = next.map((n) => q.pieces[n])
      onAnswer({ correct: orderCorrect(q.item.en, words), said: words.join(' ') })
    }
  }
  const takeBack = (pos: number) => {
    if (answer) return
    setPlaced((p) => p.filter((_, k) => k !== pos))
  }

  return (
    <div className="qz-q" data-kind="order">
      <Ask
        badge="단어 조각 순서 맞추기"
        icon={<Puzzle className="ico" aria-hidden="true" />}
        top={
          ko ? (
            <div className="qz-prompt" id="qzPrompt">
              {ko}
            </div>
          ) : (
            <ListenTools en={q.item.en} onPlay={onPlay} idPrefix="qzOrder" />
          )
        }
      >
        알맞은 영어 단어 조각을 순서대로 터치하세요
      </Ask>
      <div className={`qz-slot${answer ? (answer.correct ? ' right' : ' wrong') : ''}`} id="qzSlot" aria-label="만든 문장" lang="en">
        {placed.length === 0 && (
          <span className="qz-slot-hint" lang="ko">
            아래 조각을 눌러 여기에 놓아요
          </span>
        )}
        {placed.map((n, pos) => (
          <button
            key={pos}
            type="button"
            className="qz-piece placed"
            disabled={!!answer}
            aria-label={`${q.pieces[n]} 빼기`}
            onClick={() => takeBack(pos)}
          >
            {q.pieces[n]}
          </button>
        ))}
      </div>
      {!answer && (
        <>
          <div className="qz-pool" lang="en">
            {q.pieces.map((w, i) => (
              <button key={i} type="button" className={`qz-piece${placed.includes(i) ? ' used' : ''}`} disabled={placed.includes(i)} onClick={() => put(i)}>
                {w}
              </button>
            ))}
          </div>
          <div className="tools">
            <MiniButton label="처음부터" icon={<RotateCcw className="ico" aria-hidden="true" />} disabled={placed.length === 0} onClick={() => setPlaced([])} />
            <button className="link qz-skip push-right" id="qzSkip" type="button" onClick={() => onAnswer({ correct: false, skipped: true })}>
              모르겠어요
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// 정답·오답 바로 알려 주기: 색 + 아이콘 + 글자
function Feedback({ item, answer, kind, onPlay }: { item: Pair; answer: Answer; kind: Question['kind']; onPlay: Play }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])
  const title = answer.correct ? '맞았어요!' : answer.skipped ? '괜찮아요. 정답을 같이 봐요.' : '아쉬워요. 정답을 들어 봐요.'
  return (
    <div className={`qz-feedback ${answer.correct ? 'ok' : 'bad'}`} id="qzFeedback" role="status" ref={ref}>
      <div className="qz-feedback-title">
        {answer.correct ? <CircleCheck className="ico" aria-hidden="true" /> : <CircleX className="ico" aria-hidden="true" />}
        {title}
      </div>
      {kind === 'speak' && answer.said && (
        <div className="qz-heard">
          이렇게 들렸어요: <span lang="en">"{answer.said}"</span>
          <WordMarks goal={item.en} said={answer.said} />
        </div>
      )}
      <div className="qz-answer">
        <div className="say" lang="en" id="qzAnswer">
          {item.en}
        </div>
        {item.ko && <div className="meaning">{item.ko}</div>}
        <ListenTools en={item.en} onPlay={onPlay} idPrefix="qzAnswer" />
      </div>
      <p className="qz-next-hint">{answer.correct ? '다음 문제로 가요.' : '듣고 한 번 따라 말해 본 뒤 다음으로 가요. 내일 다시 나와요.'}</p>
    </div>
  )
}

function Result({
  questions,
  answers,
  stats,
  today,
  learned,
  onPlay,
}: {
  questions: Question[]
  answers: Answer[]
  stats: QuizStats
  today: string
  learned: Pair[]
  onPlay: Play
}) {
  const right = answers.filter((a) => a?.correct).length
  const items = questions.map((q) => q.item)
  const tomorrow = countDueBy(learned, stats, addDays(today, 1))
  const wrong = questions.filter((_, i) => !answers[i]?.correct)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className="qz-result" id="qzResult" ref={ref} tabIndex={-1}>
      <Trophy className="qz-result-ico" aria-hidden="true" />
      <p className="qz-score" id="qzScore">
        {items.length}문제 중 <b>{right}개</b> 맞혔어요
      </p>
      <p className="qz-score-sub" id="qzTomorrow">
        {tomorrow > 0 ? `내일 다시 볼 문장: ${tomorrow}개` : '내일 다시 볼 문장은 없어요. 다 기억하고 있어요!'}
      </p>
      {wrong.length > 0 && (
        <>
          <h3>다시 들어 볼 문장</h3>
          {wrong.map((q) => (
            <div className="card qz-wrong-card" key={q.item.en}>
              <div className="qz-wrong-row">
                <div className="qz-wrong-text">
                  <div className="qz-wrong-en" lang="en">
                    {q.item.en}
                  </div>
                  {q.item.ko && <div className="meaning">{q.item.ko}</div>}
                </div>
                <MiniButton label="" ariaLabel={`${q.item.en} 듣기`} icon={<Volume2 className="ico" aria-hidden="true" />} onClick={() => onPlay(splitByScript(q.item.en))} />
              </div>
            </div>
          ))}
        </>
      )}
      <p className="note">맞힌 문장은 며칠 뒤에, 틀린 문장은 내일 다시 나와요.</p>
    </div>
  )
}
