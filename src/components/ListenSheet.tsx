import { ArrowRight, BookmarkPlus, ChevronLeft, CircleCheck, Headphones, LoaderCircle, Mic as MicIcon, RefreshCw, RotateCcw, Settings as SettingsIcon, Snail, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { getStage, getUnit } from '../lib/curriculum'
import { AppError, errorText } from '../lib/gemini'
import { diffWords } from '../lib/pronounce'
import { loadLastStory, makeStory, saveLastStory, type Story } from '../lib/listen'
import { overlap, same } from '../lib/text'
import type { FixTarget, LearnedItem, Pair, Progress, Settings } from '../lib/types'
import { Meaning, MiniButton, Sheet, WordMarks } from './common'
import type { Mic, Play } from './WrapSheet'
import './listen.css'

// 6) 듣고 따라 말하기(쉐도잉): AI가 내 수준의 짧은 이야기를 만들고, 한 문장씩 듣고 따라 말한다
export interface ListenProps {
  settings: Settings
  progress: Progress
  learned: LearnedItem[]
  onPlay: Play
  onMic: Mic
  // 내 문장 노트에 더하고, 새로 더한 개수를 돌려준다
  onSaveSentences: (pairs: Pair[]) => number
  // 키·모델 문제면 설정을 연다
  // 키·모델 문제면 그 칸이 열린 설정을 연다
  onNeedSettings: (fix?: FixTarget) => void
  onClose: () => void
}

type Phase = 'intro' | 'loading' | 'story' | 'done'

interface Heard {
  said: string
  // 대체로 잘 들림
  good: boolean
  // 모든 단어가 들림
  perfect: boolean
}

interface Failure {
  text: string
  fix: FixTarget
  retryable: boolean
}

// 따라 말한 말이 이만큼 겹치면 잘 들린 것으로 본다 (마무리 읽기와 같은 기준)
const GOOD_OVERLAP = 0.7

const sentenceSegs = (s: Pair) => [{ text: s.en, lang: 'en' as const }]

export function ListenSheet({ settings, progress, learned, onPlay, onMic, onSaveSentences, onNeedSettings, onClose }: ListenProps) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [story, setStory] = useState<Story | null>(null)
  const [last] = useState(() => loadLastStory())
  const [idx, setIdx] = useState(0)
  const [heard, setHeard] = useState<Record<number, Heard>>({})
  const [listening, setListening] = useState<number | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [savedText, setSavedText] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  // 이 시트에서 들은 제목 ('다른 이야기'가 같은 이야기로 나오지 않게)
  const titlesRef = useRef<string[]>([])
  const stage = getStage(progress.stage)
  const unit = getUnit(progress)
  const hasKey = !!settings.apiKey.trim()
  // 방금 만든 이야기가 없으면 지난번에 저장해 둔 이야기
  const lastStory = story ?? last?.story ?? null
  const inBook = (en: string) => learned.some((l) => same(l.en, en))
  const allInBook = !!story && story.sentences.every((s) => inBook(s.en))

  // 시트를 닫으면 기다리던 요청도 그만둔다
  useEffect(() => () => abortRef.current?.abort(), [])

  const openStory = (s: Story) => {
    setStory(s)
    setIdx(0)
    setHeard({})
    setListening(null)
    setSavedText('')
    setPicked(new Set(s.sentences.filter((x) => !inBook(x.en)).map((x) => x.en)))
    if (!titlesRef.current.includes(s.title)) titlesRef.current.push(s.title)
    setPhase('story')
  }

  const make = async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setFailure(null)
    setPhase('loading')
    try {
      const s = await makeStory(settings, progress, learned, titlesRef.current, ctrl.signal)
      if (abortRef.current !== ctrl) return
      abortRef.current = null
      saveLastStory(s)
      openStory(s)
    } catch (err) {
      // 그만두기를 눌렀거나 새 요청으로 바뀌었으면 조용히 끝낸다
      if (abortRef.current !== ctrl) return
      abortRef.current = null
      setFailure(
        err instanceof AppError
          ? { text: err.message, fix: err.fix, retryable: err.retryable }
          : { text: errorText(err), fix: null, retryable: true },
      )
      setPhase('intro')
    }
  }

  const cancel = () => {
    const ctrl = abortRef.current
    abortRef.current = null
    ctrl?.abort()
    setPhase(story ? 'done' : 'intro')
  }

  const shadow = () => {
    if (!story) return
    const i = idx
    const goal = story.sentences[i].en
    const started = onMic(
      'en',
      (said) =>
        setHeard((h) => ({
          ...h,
          [i]: { said, good: overlap(goal, said) >= GOOD_OVERLAP, perfect: diffWords(goal, said).every((m) => m.ok) },
        })),
      () => setListening((l) => (l === i ? null : l)),
    )
    if (started) setListening(i)
  }

  const goTo = (i: number) => {
    if (!story) return
    setIdx(i)
    setListening(null)
    // 넘기면 바로 그 문장을 들려준다 (먼저 듣고 따라 하기)
    onPlay(sentenceSegs(story.sentences[i]))
  }

  const save = () => {
    if (!story) return
    const pairs = story.sentences.filter((s) => picked.has(s.en) && !inBook(s.en))
    const added = onSaveSentences(pairs)
    setPicked(new Set())
    setSavedText(added > 0 ? `내 문장 노트에 ${added}개 더했어요. 대화할 때 다시 연습해요.` : '새로 더한 문장이 없어요. 이미 내 문장 노트에 있어요.')
  }

  const togglePick = (en: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(en)) n.delete(en)
      else n.add(en)
      return n
    })

  // ── 아래 고정 버튼줄 ──
  let footer = null
  if (phase === 'intro') {
    footer = hasKey ? (
      <button className="primary" id="lsnMake" type="button" onClick={() => void make()}>
        {failure?.retryable ? <RefreshCw className="ico" aria-hidden="true" /> : <Headphones className="ico" aria-hidden="true" />}
        {failure?.retryable ? '다시 시도' : '이야기 만들기'}
      </button>
    ) : (
      <button className="primary" id="lsnNeedKey" type="button" onClick={() => onNeedSettings('apiKey')}>
        <SettingsIcon className="ico" aria-hidden="true" />
        설정에서 키 넣기
      </button>
    )
  } else if (phase === 'story' && story) {
    const lastCard = idx >= story.sentences.length - 1
    footer = (
      <>
        <button className="secondary lsn-prev" id="lsnPrev" type="button" disabled={idx === 0} onClick={() => goTo(idx - 1)}>
          <ChevronLeft className="ico" aria-hidden="true" />
          이전
        </button>
        <button
          className="primary"
          id="lsnNext"
          type="button"
          onClick={() => {
            if (lastCard) {
              setListening(null)
              setPhase('done')
            } else goTo(idx + 1)
          }}
        >
          {lastCard ? '다 했어요' : '다음 문장'}
          <ArrowRight className="ico" aria-hidden="true" />
        </button>
      </>
    )
  } else if (phase === 'done') {
    footer = (
      <>
        <button className="secondary" id="lsnClose" type="button" onClick={onClose}>
          닫기
        </button>
        <button className={`${savedText || picked.size === 0 ? 'primary' : 'secondary'} lsn-grow`} id="lsnAnother" type="button" onClick={() => void make()}>
          <RefreshCw className="ico" aria-hidden="true" />
          다른 이야기
        </button>
      </>
    )
  }

  return (
    <Sheet id="listenSheet" title="듣고 따라 말하기" onClose={onClose} footer={footer}>
      {phase === 'intro' && (
        <div className="lsn-intro">
          <div className="lsn-hero">
            <span className="lsn-hero-ico" aria-hidden="true">
              <Headphones className="ico" />
            </span>
            <div>
              <p className="lsn-hero-text">30초짜리 짧은 영어 이야기를 듣고, 한 문장씩 따라 말해요.</p>
              <p className="lsn-unit" id="lsnUnit">
                {stage.n}단계 · 오늘 단원 「{unit.title}」에 맞춰 만들어요
              </p>
            </div>
          </div>
          <ol className="lsn-steps">
            <li>
              <b>전체 듣기</b> 뜻은 몰라도 괜찮아요. 소리에 익숙해지기
            </li>
            <li>
              <b>한 문장씩 따라 말하기</b> 듣고, 마이크를 눌러 똑같이 말하기
            </li>
            <li>
              <b>마음에 드는 문장 저장</b> 내 문장 노트에 넣어 두고 다시 연습하기
            </li>
          </ol>

          {!hasKey && (
            <div className="banner-box warn" id="lsnNoKey" role="note">
              이야기를 만들려면 Gemini API 키가 필요해요. 아래 버튼을 눌러 설정에서 키를 넣어 주세요.
            </div>
          )}

          {failure && (
            <div className="lsn-error" id="lsnError" role="alert">
              <p>{failure.text}</p>
              {failure.fix ? (
                <button className="secondary small" id="lsnFixSettings" type="button" onClick={() => onNeedSettings(failure.fix)}>
                  <SettingsIcon className="ico" aria-hidden="true" />
                  설정 열기
                </button>
              ) : (
                !failure.text.includes('다시 시도') && <p className="lsn-error-next">아래 「다시 시도」를 눌러 주세요.</p>
              )}
            </div>
          )}

          {lastStory && hasKey && (
            <button className="secondary wide lsn-last" id="lsnLast" type="button" onClick={() => openStory(lastStory)}>
              <RotateCcw className="ico" aria-hidden="true" />
              <span>
                지난 이야기 다시 듣기
                <span className="lsn-last-title" lang="en">
                  {lastStory.title}
                </span>
              </span>
            </button>
          )}
        </div>
      )}

      {phase === 'loading' && (
        <div className="lsn-loading" id="lsnLoading" role="status">
          <LoaderCircle className="ico lsn-spin" aria-hidden="true" />
          <p>
            <b>이야기를 만들고 있어요…</b>
            <br />
            <span className="muted">보통 몇 초 걸려요. 20초가 넘으면 다시 시도하게 알려 드려요.</span>
          </p>
          <button className="secondary small" id="lsnCancel" type="button" onClick={cancel}>
            그만두기
          </button>
        </div>
      )}

      {phase === 'story' && story && (
        <div className="lsn-story">
          <div className="lsn-title-card">
            <div className="lsn-kicker">오늘의 이야기</div>
            <h3 className="lsn-title" id="lsnTitle" lang="en">
              {story.title}
            </h3>
            {story.title_ko && <Meaning key={'t-' + story.title} text={story.title_ko} conceal />}
          </div>

          <h3 className="lsn-step">① 먼저 전체 듣기</h3>
          <p className="note">뜻은 몰라도 괜찮아요. 전체를 한두 번 들어 보세요.</p>
          <div className="tools two">
            <button className="secondary" id="lsnPlayAll" type="button" onClick={() => onPlay(story.sentences.flatMap(sentenceSegs))}>
              <Volume2 className="ico" aria-hidden="true" />
              전체 듣기
            </button>
            <button className="secondary" id="lsnPlayAllSlow" type="button" onClick={() => onPlay(story.sentences.flatMap(sentenceSegs), true)}>
              <Snail className="ico" aria-hidden="true" />
              천천히
            </button>
          </div>

          <div className="lsn-step-row">
            <h3 className="lsn-step">② 한 문장씩 따라 말하기</h3>
            <span className="lsn-count" id="lsnCount" aria-label={`${story.sentences.length}문장 중 ${idx + 1}번째`}>
              {idx + 1} / {story.sentences.length}
            </span>
          </div>
          <div className="lsn-dots" aria-hidden="true">
            {story.sentences.map((_, i) => (
              <span key={i} className={`lsn-dot${i === idx ? ' now' : ''}${heard[i]?.good ? ' good' : heard[i] ? ' tried' : ''}`} />
            ))}
          </div>

          <SentenceCard
            key={`${story.title}-${idx}`}
            sentence={story.sentences[idx]}
            heard={heard[idx]}
            listening={listening === idx}
            onPlay={onPlay}
            onShadow={shadow}
          />
        </div>
      )}

      {phase === 'done' && story && (
        <div className="lsn-done">
          <DoneSummary total={story.sentences.length} heard={heard} />

          <h3 className="lsn-step">③ 마음에 드는 문장 저장</h3>
          <p className="note">내 문장 노트에 넣어 두면 대화할 때 친구가 다시 연습시켜 줘요.</p>
          <ul className="lsn-picks" id="lsnPicks">
            {story.sentences.map((s) => {
              const already = inBook(s.en)
              return (
                <li key={s.en}>
                  <label className={`lsn-pick${already ? ' in-book' : ''}`}>
                    <input
                      type="checkbox"
                      checked={already || picked.has(s.en)}
                      disabled={already}
                      onChange={() => togglePick(s.en)}
                    />
                    <span className="lsn-pick-text">
                      <span className="lsn-pick-en" lang="en">
                        {s.en}
                      </span>
                      {s.ko && <span className="lsn-pick-ko">{s.ko}</span>}
                      {already && (
                        <span className="lsn-tag">
                          <CircleCheck className="ico" aria-hidden="true" />
                          내 문장 노트에 있어요
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          {!allInBook && (
            <button className="primary wide" id="lsnSave" type="button" disabled={picked.size === 0} onClick={save}>
              <BookmarkPlus className="ico" aria-hidden="true" />
              {picked.size > 0 ? `고른 ${picked.size}문장 내 문장 노트에 저장` : '저장할 문장을 골라 주세요'}
            </button>
          )}
          {savedText && (
            <div className="lsn-saved" id="lsnSaved" role="status">
              <CircleCheck className="ico" aria-hidden="true" />
              {savedText}
            </div>
          )}
          <button className="secondary wide" id="lsnReplay" type="button" onClick={() => openStory(story)}>
            <RotateCcw className="ico" aria-hidden="true" />이 이야기 처음부터 다시
          </button>
        </div>
      )}
    </Sheet>
  )
}

function SentenceCard({
  sentence,
  heard,
  listening,
  onPlay,
  onShadow,
}: {
  sentence: Pair
  heard?: Heard
  listening: boolean
  onPlay: Play
  onShadow: () => void
}) {
  return (
    <div className="card lsn-card" id="lsnCard">
      <div className="say lsn-say" lang="en">
        {sentence.en}
      </div>
      {sentence.ko && <Meaning text={sentence.ko} conceal />}
      <div className="tools two">
        <MiniButton label="듣기" icon={<Volume2 className="ico" aria-hidden="true" />} ariaLabel={`${sentence.en} 듣기`} id="lsnPlayOne" onClick={() => onPlay(sentenceSegs(sentence))} />
        <MiniButton
          label="천천히"
          icon={<Snail className="ico" aria-hidden="true" />}
          ariaLabel={`${sentence.en} 천천히 듣기`}
          id="lsnPlayOneSlow"
          onClick={() => onPlay(sentenceSegs(sentence), true)}
        />
      </div>
      <button className={`primary wide lsn-mic${listening ? ' on' : ''}`} id="lsnShadow" type="button" aria-pressed={listening} onClick={onShadow}>
        <MicIcon className="ico" aria-hidden="true" />
        {listening ? '듣는 중… 다 말했으면 누르기' : heard ? '한 번 더 따라 말하기' : '따라 말하기'}
      </button>
      {heard && (
        <div className={`result lsn-result${heard.good ? ' good' : ''}`} id="lsnResult" role="status">
          {heard.perfect ? (
            <span className="lsn-good">
              <CircleCheck className="ico" aria-hidden="true" />다 들렸어요! 다음 문장으로 가 볼까요?
            </span>
          ) : heard.good ? (
            <span className="lsn-good">
              <CircleCheck className="ico" aria-hidden="true" />
              잘했어요! 표시된 단어만 한 번 더 또렷하게 말해 볼까요?
            </span>
          ) : (
            <span>
              이렇게 들렸어요: <b lang="en">"{heard.said}"</b>
              <br />
              「듣기」로 한 번 더 듣고 다시 해 볼까요?
            </span>
          )}
          <WordMarks goal={sentence.en} said={heard.said} />
        </div>
      )}
      {!heard && !listening && <p className="note lsn-hint">먼저 「듣기」를 누르고, 바로 「따라 말하기」를 눌러 똑같이 말해 보세요.</p>}
    </div>
  )
}

function DoneSummary({ total, heard }: { total: number; heard: Record<number, Heard> }) {
  const tried = Object.keys(heard).length
  const good = Object.values(heard).filter((h) => h.good).length
  return (
    <div className="unit-status good lsn-summary" id="lsnSummary">
      <CircleCheck className="ico" aria-hidden="true" />
      <span>
        {tried === 0
          ? `이야기를 끝까지 들었어요! 다음엔 「따라 말하기」도 눌러 보세요.`
          : `${total}문장 중 ${tried}문장을 따라 말했고, ${good}문장이 잘 들렸어요.`}
      </span>
    </div>
  )
}
