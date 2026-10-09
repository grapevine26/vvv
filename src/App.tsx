import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookSheet } from './components/BookSheet'
import { Composer, type Phase } from './components/Composer'
import { CourseSheet } from './components/CourseSheet'
import { Header } from './components/Header'
import { AiBubble, ErrorBubble, TypingBubble, UserBubble } from './components/Messages'
import { SettingsSheet } from './components/SettingsSheet'
import { StartScreen } from './components/StartScreen'
import { TransferSheet } from './components/TransferSheet'
import { WrapSheet } from './components/WrapSheet'
import { WarmupSheet } from './components/WarmupSheet'
import { QuizSheet } from './components/QuizSheet'
import { ProgressSheet } from './components/ProgressSheet'
import { ListenSheet } from './components/ListenSheet'
import { isBackupDue } from './lib/backup'
import { useLatestRef } from './hooks/useLatestRef'
import { sanitizeSettings, TARGET } from './lib/config'
import { changeStage, chooseUnit, getStage, getUnit, MIN_TURNS_FOR_UNIT, mergeProgress, minutesOn, unitById } from './lib/curriculum'
import { AppError, callGemini, checkKey, checkWriting, errorText, parseTurn, TURN_SCHEMA } from './lib/gemini'
import { buildSystemPrompt, pushHistory, recentHistory, startMessage, userTag } from './lib/prompt'
import { commitSession, EMPTY_STATS, type SessionData } from './lib/session'
import {
  currentEnv,
  getRecognitionCtor,
  inAppBrowser,
  listen,
  micBlockedHelp,
  micErrorText,
  micPermission,
  micRequestText,
  openExternalUrl,
  openInChromeUrl,
  requestMic,
  Speaker,
  type Listening,
  type MicState,
} from './lib/speech'
import {
  activeElsewhere,
  clearDraft,
  draftExists,
  draftKey,
  getTabId,
  isAppKey,
  loadDailyChecks,
  loadDrafts,
  loadLearned,
  loadProgress,
  loadSettings,
  mergeLearned,
  resumableDrafts,
  saveDailyChecks,
  saveDraft,
  saveLearned,
  saveProgress,
  saveSettings,
  storageWorks,
} from './lib/storage'
import { applyImportedSettings, mergeImported, type TransferData } from './lib/transfer'
import { localDate, normWords, overlap, ro, same, turnSegments } from './lib/text'
import type { Content, Draft, FixTarget, Lang, Message, Pair, Progress, Segment, Settings } from './lib/types'

type SheetName = 'settings' | 'wrap' | 'book' | 'course' | 'transfer' | 'warmup' | 'quiz' | 'progress' | 'listen' | null

interface SettingsOpen {
  notice: string
  firstRun: boolean
  focus: FixTarget
  // 저장하면 바로 대화를 시작한다 (처음 키를 넣을 때)
  startAfter: boolean
}
const NO_SETTINGS: SettingsOpen = { notice: '', firstRun: false, focus: null, startAfter: false }

// 답이 이만큼 늦으면 '그만 기다리기'를 보여 준다
const SLOW_WAIT_MS = 8000
// 친구 말이 끝나고 자동으로 듣기 전 잠깐 쉰다 (스피커 소리 끝자락을 내 말로 듣지 않게)
const AUTO_LISTEN_DELAY_MS = 400
// 대화 중 임시 저장 간격
const DRAFT_EVERY_SEC = 15
// 다른 앱에 이만큼 넘게 가 있었으면 그 시간은 공부 시간에서 뺀다
const AWAY_MS = 60_000

// 현재 시각 (이벤트 처리기·효과에서만 부른다)
const nowMs = () => Date.now()

export default function App() {
  // ── 저장된 값 ──
  const [settings, setSettings] = useState(loadSettings)
  const [learned, setLearned] = useState(loadLearned)
  const [progress, setProgress] = useState(loadProgress)
  const [tabId] = useState(getTabId)
  const [drafts, setDrafts] = useState(loadDrafts)
  const [daily, setDaily] = useState(() => ({ date: localDate(), checks: loadDailyChecks(localDate()) }))

  // ── 화면 ──
  const [screen, setScreen] = useState<'start' | 'chat'>('start')
  const [sheet, setSheet] = useState<SheetName>(null)
  const [settingsOpen, setSettingsOpen] = useState<SettingsOpen>(NO_SETTINGS)
  const [bookReview, setBookReview] = useState(false)
  const [startMsg, setStartMsg] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [micState, setMicState] = useState<MicState>('unknown')
  const [env] = useState(currentEnv)

  // ── 대화 ──
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [busySince, setBusySince] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState<Lang | null>(null)
  const [interim, setInterim] = useState('')
  const [pendingRepeat, setPendingRepeat] = useState('')
  const [pickedHint, setPickedHint] = useState('')
  const [micNotice, setMicNotice] = useState('')
  const [awaitingReply, setAwaitingReply] = useState(false)
  const [repeats, setRepeats] = useState<Pair[]>([])
  const [turns, setTurns] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [limitSec, setLimitSec] = useState(0)
  const [timeUpAck, setTimeUpAck] = useState(false)
  const [wrapCards, setWrapCards] = useState<Pair[]>([])
  const [session, setSession] = useState({ stage: 1, unit: 's1-1', date: localDate() })
  const [, setVoicesVersion] = useState(0)

  // 비동기 작업(AI 응답 대기, 소리 재생) 뒤에도 최신 값을 읽기 위한 ref
  const settingsRef = useLatestRef(settings)
  const learnedRef = useLatestRef(learned)
  const progressRef = useLatestRef(progress)
  const sheetRef = useLatestRef(sheet)
  const sessionRef = useLatestRef(session)
  const statsRef = useRef({ ...EMPTY_STATS })
  const historyRef = useRef<Content[]>([])
  const activeRef = useRef(false)
  const busyRef = useRef(false)
  const speakingRef = useRef(false)
  const pendingRepeatRef = useRef('')
  const pickedHintRef = useRef('')
  // 이 대화의 임시 저장을 한 번이라도 썼는지 (다른 탭이 가져가 지웠는지 알아채는 데 쓴다)
  const draftSavedRef = useRef(false)
  const hiddenAtRef = useRef(0)
  const ignorePopRef = useRef(false)
  const settingsBackRef = useRef<(() => void) | null>(null)
  const listenerRef = useRef<Listening | null>(null)
  const listeningLangRef = useRef<Lang | null>(null)
  const lastLangRef = useRef<Lang>('ko')
  const lastHintsRef = useRef<string[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const playIdRef = useRef(0)
  const idRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chatRef = useRef<HTMLElement>(null)

  const [speaker] = useState(() => new Speaker())
  useLayoutEffect(() => {
    speaker.setOptions({ rate: settings.rate, voiceName: settings.voiceName })
  }, [speaker, settings.rate, settings.voiceName])

  const today = localDate(new Date(now))
  const dailyChecks = daily.date === today ? daily.checks : []
  const leftTurns = MIN_TURNS_FOR_UNIT - turns
  // 답이 오래 걸리면 '그만 기다리기' (시계가 1초마다 돌아서 따로 타이머가 필요 없다)
  const slowWait = busy && now - busySince >= SLOW_WAIT_MS
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const showTimeBanner = screen === 'chat' && sheet !== 'wrap' && elapsed >= limitSec && !timeUpAck
  const unitTitle = unitById(session.unit)?.title ?? ''
  const recognitionSupported = !!getRecognitionCtor()
  const inApp = inAppBrowser(env.ua)

  // ── 작은 도우미 ──
  const showToast = (text: string) => {
    setToast(text)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4500)
  }
  const hideToast = () => {
    clearTimeout(toastTimer.current)
    setToast('')
  }
  const addMessage = (m: Message) => setMessages((prev) => [...prev, m])
  const nextId = () => ++idRef.current
  const setBusyBoth = (on: boolean) => {
    busyRef.current = on
    setBusy(on)
    if (on) setBusySince(nowMs())
  }
  const unveil = (id: number) =>
    setMessages((prev) => prev.map((m) => (m.id === id && m.kind === 'ai' && m.veiled ? { ...m, veiled: false } : m)))

  // 듣는 중인 마이크를 보내지 않고 끈다
  const stopListening = () => listenerRef.current?.abort()

  const stopSpeaking = () => {
    playIdRef.current++
    speaker.cancel()
    speakingRef.current = false
    setSpeaking(false)
  }

  // 모든 소리는 여기로: 재생 전에 듣기를 꺼서 스피커 소리를 내 말로 보내지 않는다. 끝까지 다 읽었으면 true
  const play = async (segments: Segment[], slow?: boolean, rate?: number): Promise<boolean> => {
    stopListening()
    const id = ++playIdRef.current
    speakingRef.current = true
    setSpeaking(true)
    const result = await speaker.play(segments, slow, rate)
    if (playIdRef.current === id) {
      speakingRef.current = false
      setSpeaking(false)
    }
    if (result === 'error' && activeRef.current && !sheetRef.current)
      setMicNotice('소리가 안 나왔어요. 말풍선의 "다시"를 누르거나, 설정 → 고급에서 목소리를 바꿔 보세요.')
    return result === 'done'
  }

  // ── 바깥 사정 살피기 ──
  // 목소리 목록은 늦게 도착할 수 있다
  useEffect(() => {
    if (!speaker.supported) return
    const synth = window.speechSynthesis
    synth.onvoiceschanged = () => {
      speaker.refresh()
      setVoicesVersion((v) => v + 1)
    }
    return () => {
      synth.onvoiceschanged = null
    }
  }, [speaker])

  // 마이크 권한을 미리 확인하고, 바뀌면 알려 준다
  const showToastRef = useLatestRef(showToast)
  useEffect(() => {
    let status: PermissionStatus | null = null
    let cancelled = false
    let prev: MicState = 'unknown'
    void micPermission().then((r) => {
      if (cancelled) return
      setMicState(r.state)
      prev = r.state
      status = r.status
      if (!status) return
      status.onchange = () => {
        const st = (status?.state ?? 'unknown') as MicState
        setMicState(st)
        if (st === 'granted') setMicNotice('')
        // 막혀 있다가 풀렸을 때만 알린다. 처음 허용(권한 창)은 이미 듣는 중이거나 화면에 '준비됨'이 보인다
        if (st === 'granted' && prev === 'denied' && !listenerRef.current)
          showToastRef.current('이제 마이크가 돼요. 마이크 버튼을 눌러 말해 보세요.')
        prev = st
      }
    })
    return () => {
      cancelled = true
      if (status) status.onchange = null
    }
  }, [showToastRef])

  // 시계: 대화 중에는 1초, 시작 화면에서는 10초마다
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), screen === 'chat' ? 1000 : 10_000)
    return () => clearInterval(id)
  }, [screen])

  // 대화 중 화면이 저절로 꺼지지 않게
  useEffect(() => {
    if (screen !== 'chat' || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let disposed = false
    const request = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (disposed) void l.release()
          else lock = l
        })
        .catch(() => {})
    }
    request()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!lock || lock.released)) request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisible)
      if (lock && !lock.released) void lock.release().catch(() => {})
    }
  }, [screen])

  // 다른 앱에 오래 가 있던 시간은 공부 시간에서 뺀다 (전화 받기, 다른 일)
  useEffect(() => {
    if (screen !== 'chat') return
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        return
      }
      const away = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0
      hiddenAtRef.current = 0
      if (away > AWAY_MS && activeRef.current) setStartedAt((t) => t + away)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [screen])

  // 대화 중 탭을 닫으려 하면 한 번 묻는다 (임시 저장은 되어 있음)
  useEffect(() => {
    if (screen !== 'chat') return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (statsRef.current.turns > 0) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [screen])

  // 새 말풍선: 길면 첫 줄이 보이게 머리에 맞추고, 짧으면 맨 아래로
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const last = el.lastElementChild as HTMLElement | null
    if (last && last.classList.contains('ai') && !last.classList.contains('error') && last.offsetHeight > el.clientHeight - 24) {
      el.scrollTop += last.getBoundingClientRect().top - el.getBoundingClientRect().top - 8
    } else {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, busy, slowWait])

  // 화면 키보드가 열려 대화 칸이 줄어도, 맨 아래를 보고 있었으면 맨 아래를 유지
  useEffect(() => {
    const el = chatRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let nearBottom = true
    const onScroll = () => {
      nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    }
    const ro = new ResizeObserver(() => {
      if (nearBottom) el.scrollTop = el.scrollHeight
    })
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', onScroll)
    }
  }, [screen])

  // ── 저장 ──
  const updateProgress = (next: Progress) => {
    setProgress(next)
    saveProgress(next)
  }

  // 저장 직전에 저장소를 다시 읽어 다른 탭의 기록과 합친다. 저장소가 막혔으면 이 탭의 값으로 이어 간다
  const freshLearned = () => (storageWorks() ? loadLearned() : learnedRef.current)
  const freshProgress = () => (storageWorks() ? loadProgress() : progressRef.current)

  // 대화 한 번을 저장
  const commit = (data: SessionData) => {
    const r = commitSession(data, freshLearned(), freshProgress())
    setLearned(r.learned)
    saveLearned(r.learned)
    if (r.recorded) updateProgress(r.progress)
    return r
  }

  const refreshDrafts = () => setDrafts(loadDrafts())

  // ── 대화 흐름 ──
  const openSettings = (opts: Partial<SettingsOpen> = {}) => {
    stopListening()
    hideToast()
    setSettingsOpen({ ...NO_SETTINGS, ...opts })
    setSheet('settings')
  }

  // 친구 말이 끝나면 자동으로 듣기. 타이머 뒤에도 지금 그림의 startMic·sendUser를 쓰게 ref로 부른다
  const autoListenRef = useRef<(lang: Lang) => void>(() => {})
  const maybeAutoListen = (lang: Lang) => {
    if (!settingsRef.current.autoListen) return
    setTimeout(() => {
      if (!activeRef.current || sheetRef.current || listenerRef.current || busyRef.current || speakingRef.current) return
      autoListenRef.current(lang)
    }, AUTO_LISTEN_DELAY_MS)
  }

  const abandonSession = () => {
    activeRef.current = false
    abortRef.current?.abort()
    stopListening()
    stopSpeaking()
    clearDraft(tabId)
    draftSavedRef.current = false
    setBusyBoth(false)
    setScreen('start')
  }

  // 다른 탭(또는 다시 연 창)이 이 대화를 이어받거나 저장했다: 여기서는 기록하지 않고 닫는다
  const takeOver = () => {
    if (!activeRef.current) return
    activeRef.current = false
    draftSavedRef.current = false
    abortRef.current?.abort()
    stopListening()
    stopSpeaking()
    setBusyBoth(false)
    setSheet(null)
    setScreen('start')
    setDrafts(loadDrafts())
    setStartMsg('이 대화는 다른 탭에서 이어받았거나 저장했어요. 같은 대화가 두 번 기록되지 않게 여기서는 닫았어요.')
  }

  // 다른 탭에서 저장하면 이 탭 화면도 맞춘다 (오래된 탭이 새 기록을 덮어쓰지 않게)
  const takenOverRef = useLatestRef(() => takeOver())
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && !isAppKey(e.key)) return
      // 다른 탭이 이 탭의 대화를 저장하거나 이어받아 지웠다
      if (e.key === draftKey(tabId) && e.newValue === null && activeRef.current && draftSavedRef.current) takenOverRef.current()
      setSettings(loadSettings())
      setLearned(loadLearned())
      setProgress(loadProgress())
      setDrafts(loadDrafts())
      setDaily({ date: localDate(), checks: loadDailyChecks(localDate()) })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [tabId, takenOverRef])

  // 임시 저장: 말풍선이 바뀔 때와 15초마다
  const saveTick = Math.floor(elapsed / DRAFT_EVERY_SEC)
  useEffect(() => {
    if (screen !== 'chat' || !activeRef.current) return
    const stats = statsRef.current
    if (stats.turns === 0 && repeats.length === 0) return
    // 저장해 둔 것이 사라졌으면 다른 탭이 이 대화를 가져간 것: 다시 쓰면 같은 대화가 두 번 기록된다
    if (draftSavedRef.current && draftExists(tabId) === false) {
      takenOverRef.current()
      return
    }
    // 다른 앱에 오래 가 있는 중이면 그 시간은 빼고 적는다 (이 탭이 그대로 버려져도 부풀지 않게)
    const hidAt = hiddenAtRef.current
    const end = hidAt && Date.now() - hidAt > AWAY_MS ? hidAt : Date.now()
    const saved = saveDraft({
      tabId,
      savedAt: Date.now(),
      date: session.date,
      activeMs: end - startedAt,
      limitSec,
      stage: session.stage,
      unit: session.unit,
      stats: { ...stats },
      repeats,
      messages,
      history: historyRef.current,
      pendingRepeat,
    })
    // 실제로 써졌을 때만 '썼다'로 친다. 저장소가 꽉 차 쓰기만 실패하는 브라우저에서 이어받음으로 잘못 보지 않게
    if (saved) draftSavedRef.current = true
  }, [screen, messages, repeats, pendingRepeat, saveTick, tabId, session, startedAt, limitSec, takenOverRef])

  const aiTurn = async () => {
    setBusyBoth(true)
    const controller = new AbortController()
    abortRef.current = controller
    let turn
    try {
      const s = settingsRef.current
      const sess = sessionRef.current
      const prog = { ...progressRef.current, stage: sess.stage, unit: sess.unit }
      const raw = await callGemini(s, buildSystemPrompt(s, learnedRef.current, prog), recentHistory(historyRef.current), TURN_SCHEMA, controller.signal)
      turn = parseTurn(raw)
    } catch (err) {
      if (abortRef.current === controller) abortRef.current = null
      setBusyBoth(false)
      if (!activeRef.current) return
      const fix = err instanceof AppError ? err.fix : null
      // 첫 인사부터 키 문제면 빈 대화 화면에 두지 않고 키 넣는 곳으로 바로 보낸다
      if (fix === 'apiKey' && historyRef.current.length === 1) {
        abandonSession()
        openSettings({ notice: errorText(err), firstRun: true, focus: 'apiKey', startAfter: true })
        return
      }
      addMessage({ kind: 'error', id: nextId(), text: errorText(err), fix })
      return
    }
    if (abortRef.current === controller) abortRef.current = null
    setBusyBoth(false)
    if (!activeRef.current) return
    setAwaitingReply(false)
    pushHistory(historyRef.current, 'model', JSON.stringify(turn))
    pendingRepeatRef.current = turn.repeat
    setPendingRepeat(turn.repeat)
    lastHintsRef.current = turn.hints.map((h) => h.en)
    const repeat = { en: turn.repeat, ko: turn.repeat_ko }
    if (repeat.en) setRepeats((prev) => (prev.some((r) => same(r.en, repeat.en)) ? prev : [...prev, repeat]))
    const id = nextId()
    const veiled = settingsRef.current.soundFirst
    // 답이 왔으니 지난 오류 말풍선과 지난 차례에 고른 대답 예시는 치운다
    setMessages((prev) => [...prev.filter((m) => m.kind !== 'error'), { kind: 'ai', id, turn, veiled }])
    pickedHintRef.current = ''
    setPickedHint('')
    // 마무리 창이 열려 있으면 늦게 온 답은 소리 내지 않는다
    if (sheetRef.current) {
      if (veiled) unveil(id)
      return
    }
    const done = await play(turnSegments(turn))
    if (veiled) unveil(id)
    if (done) maybeAutoListen(turn.repeat ? 'en' : lastLangRef.current)
  }

  // 영어로 한 말이 무엇인지 가른다: 고른 대답 예시를 읽음(chip) / 따라 말하기(target) / 내 대답(둘 다 아님)
  const classify = (text: string): { target: string; chip: string } => {
    const picked = pickedHintRef.current
    const repeat = pendingRepeatRef.current
    const words = normWords(text).length
    // 예시보다 길게 늘려 말했으면(한 단어 넘게) 고른 예시가 있어도 내 대답
    const readAloud = (h: string, min: number) => overlap(h, text) >= min && words <= normWords(h).length + 1
    if (picked && readAloud(picked, 0.5)) return { target: '', chip: picked }
    // 따라 할 문장과 거의 안 겹치면 질문에 직접 대답한 것으로 본다
    if (repeat && overlap(repeat, text) >= 0.3) return { target: repeat, chip: '' }
    // 보이는 대답 예시를 (누르지 않고) 그대로 읽음
    const chip = lastHintsRef.current.find((h) => readAloud(h, 0.7)) ?? ''
    return { target: '', chip }
  }

  const sendUser = (text: string, lang: Lang) => {
    if (!activeRef.current || busyRef.current) return
    // 입력칸으로 보냈는데 마이크가 듣고 있었으면 보내지 않고 끈다
    stopListening()
    const { target, chip } = lang === 'en' ? classify(text) : { target: '', chip: '' }
    // 지난 말에 아직 답을 못 받았으면(오류 뒤 다시 말함) 같은 차례로 합쳐 보내므로 한 번만 센다
    const last = historyRef.current[historyRef.current.length - 1]
    // 시작 메시지는 한 줄이고, 답을 못 받은 내 말은 줄바꿈으로 이어 붙는다
    const unanswered = last?.role === 'user' && (historyRef.current.length > 1 || last.parts[0].text.includes('\n'))
    const stats = statsRef.current
    if (!unanswered) {
      stats.turns++
      // 대답 예시·따라 할 문장을 읽은 것은 '스스로 한 대답'으로 세지 않는다 (승급 기준이 부풀지 않게)
      if (lang === 'ko') stats.koTurns++
      else if (target || chip) stats.repeatTurns++
      else {
        stats.enOwnTurns++
        stats.enOwnWords += normWords(text).length
      }
      setTurns(stats.turns)
      if (stats.turns === MIN_TURNS_FOR_UNIT)
        showToast(`「${unitById(sessionRef.current.unit)?.title ?? ''}」 단원 조건을 채웠어요! 더 이야기해도 좋아요.`)
    }
    const goal = target || chip
    const heardWell = !!goal && overlap(goal, text) >= 0.7
    const mine: Message = { kind: 'me', id: nextId(), text, lang, isRepeat: !!target, fromHint: !!chip, heardWell, goal: goal || undefined }
    // 지난 오류 말풍선은 새 말을 하면 치운다
    setMessages((prev) => [...prev.filter((m) => m.kind !== 'error'), mine])
    pickedHintRef.current = ''
    setPickedHint('')
    setMicNotice('')
    lastLangRef.current = lang
    pushHistory(historyRef.current, 'user', `${userTag(lang, target, !!chip)} ${text}`)
    setAwaitingReply(true)
    void aiTurn()
  }

  // 마이크를 실제로 켰으면 true.
  // 같은 버튼을 다시 누르면 지금까지 들은 말을 보내고, 다른 언어 버튼을 누르면 보내지 않고 그 언어로 다시 듣는다
  const startMic = (lang: Lang, onText: (text: string) => void, onEnd?: () => void, auto = false): boolean => {
    const current = listenerRef.current
    if (current) {
      if (listeningLangRef.current === lang) {
        current.stop()
        return false
      }
      current.abort()
      listenerRef.current = null
    }
    if (!getRecognitionCtor()) {
      const text = '이 브라우저는 음성 인식이 안 돼요. 크롬이나 엣지에서 열거나, 입력칸에 써 주세요.'
      if (sheetRef.current) showToast(text)
      else setMicNotice(text)
      return false
    }
    stopSpeaking()
    setMicNotice('')
    let me: Listening | null = null
    const notify = (text: string) => {
      if (sheetRef.current) showToast(text)
      else setMicNotice(text)
    }
    try {
      me = listen(
        lang,
        (t) => {
          if (listenerRef.current === me) setInterim(t)
        },
        (text, error) => {
          if (listenerRef.current === me) {
            listenerRef.current = null
            listeningLangRef.current = null
            setListening(null)
            setInterim('')
          }
          onEnd?.()
          if (error === 'aborted') return
          if (text) {
            onText(text)
            return
          }
          // 막혔다는 오류가 와도 실제 권한은 다시 물어봐서 맞춘다 (권한 창을 닫기만 한 경우 등)
          if (error === 'not-allowed') void micPermission().then((r) => setMicState(r.state === 'unknown' ? 'denied' : r.state))
          if (error && error !== 'no-speech') notify(micErrorText(error, env))
          else notify(auto ? '버튼을 눌러 말해요.' : '소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.')
        },
      )
      listenerRef.current = me
      listeningLangRef.current = lang
      setListening(lang)
      return true
    } catch (err) {
      listenerRef.current = null
      notify('마이크를 시작하지 못했어요: ' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }

  const openSheet = (name: Exclude<SheetName, 'settings' | null>) => {
    stopListening()
    hideToast()
    setSheet(name)
  }

  useLayoutEffect(() => {
    autoListenRef.current = (lang) => startMic(lang, (t) => sendUser(t, lang), undefined, true)
  })

  const closeSheet = () => {
    // 마무리·문장장 카드에서 켠 마이크가 시트를 닫은 뒤에도 듣고 있지 않게
    stopListening()
    setSheet(null)
    setSettingsOpen(NO_SETTINGS)
    setBookReview(false)
  }

  // 시작하기 전에, 닫힌 탭에 남은 저장 안 된 대화를 먼저 저장한다 (이어서 할 것 하나는 빼고)
  const commitStaleDrafts = (exceptTab?: string) => {
    for (const d of resumableDrafts(loadDrafts(), tabId, nowMs())) {
      if (d.tabId === exceptTab) continue
      commit(draftData(d))
      clearDraft(d.tabId)
    }
    refreshDrafts()
  }

  const startSession = (s: Settings = settings) => {
    if (!s.apiKey.trim()) {
      openSettings({ firstRun: true, startAfter: true })
      return
    }
    // 첫 인사가 자동 재생 차단에 걸리지 않게, 이 누르기 안에서 소리를 열어 둔다
    speaker.unlock()
    commitStaleDrafts()
    const p = freshProgress()
    const t = nowMs()
    const day = localDate()
    setProgress(p)
    setSession({ stage: p.stage, unit: p.unit, date: day })
    sessionRef.current = { stage: p.stage, unit: p.unit, date: day }
    historyRef.current = []
    pendingRepeatRef.current = ''
    pickedHintRef.current = ''
    lastHintsRef.current = []
    statsRef.current = { ...EMPTY_STATS }
    draftSavedRef.current = false
    activeRef.current = true
    setMessages([])
    setRepeats([])
    setTurns(0)
    setPendingRepeat('')
    setPickedHint('')
    setMicNotice('')
    setInterim('')
    setStartedAt(t)
    setNow(t)
    // 오늘 이미 공부한 시간은 빼고, 적어도 5분
    setLimitSec(Math.max(5 * 60, (s.minutes - minutesOn(p, day)) * 60))
    setTimeUpAck(false)
    setStartMsg(null)
    setSheet(null)
    setScreen('chat')
    pushHistory(historyRef.current, 'user', startMessage(p))
    setAwaitingReply(true)
    void aiTurn()
  }

  const draftData = (d: Draft): SessionData => ({
    repeats: d.repeats,
    stats: d.stats,
    minutes: d.activeMs / 60000,
    date: d.date,
    stage: d.stage,
    unit: d.unit,
  })

  const resumeDraft = (d: Draft) => {
    speaker.unlock()
    if (d.tabId !== tabId) {
      // 다른 탭의 대화를 이 탭으로 가져온다. 이 탭에 남아 있던 대화(등 다른 남은 대화)는 덮어쓰기 전에 먼저 저장한다
      commitStaleDrafts(d.tabId)
      clearDraft(d.tabId)
      draftSavedRef.current = false
    } else draftSavedRef.current = true
    const t = nowMs()
    historyRef.current = d.history
    statsRef.current = { ...d.stats }
    pendingRepeatRef.current = d.pendingRepeat
    pickedHintRef.current = ''
    const lastTurn = [...d.messages].reverse().find((m) => m.kind === 'ai')
    lastHintsRef.current = lastTurn && lastTurn.kind === 'ai' ? lastTurn.turn.hints.map((h) => h.en) : []
    idRef.current = d.messages.reduce((a, m) => Math.max(a, m.id), 0)
    setSession({ stage: d.stage, unit: d.unit, date: d.date })
    sessionRef.current = { stage: d.stage, unit: d.unit, date: d.date }
    activeRef.current = true
    // 끊기기 전 오류 말풍선은 되살리지 않는다 (필요하면 다시 받아 온다)
    setMessages(d.messages.filter((m) => m.kind !== 'error').map((m) => (m.kind === 'ai' ? { ...m, veiled: false } : m)))
    setRepeats(d.repeats)
    setTurns(d.stats.turns)
    setPendingRepeat(d.pendingRepeat)
    setPickedHint('')
    setMicNotice('')
    setStartedAt(t - d.activeMs)
    setNow(t)
    setLimitSec(d.limitSec)
    setTimeUpAck(false)
    setStartMsg(null)
    setScreen('chat')
    refreshDrafts()
    // 답을 기다리다 끊겼으면 다시 받아 온다
    const waiting = d.history[d.history.length - 1]?.role === 'user'
    setAwaitingReply(waiting)
    if (waiting) void aiTurn()
  }

  const saveDraftOnly = (d: Draft) => {
    const r = commit(draftData(d))
    clearDraft(d.tabId)
    refreshDrafts()
    setStartMsg(r.message)
  }

  const discardDraft = (d: Draft) => {
    if (!window.confirm('이 대화를 버릴까요? 따라 한 문장과 기록이 저장되지 않아요.')) return
    clearDraft(d.tabId)
    refreshDrafts()
  }

  const endSession = (message: string) => {
    activeRef.current = false
    abortRef.current?.abort()
    stopListening()
    stopSpeaking()
    hideToast()
    setBusyBoth(false)
    setSheet(null)
    setScreen('start')
    setStartMsg(message)
  }

  const openWrap = () => {
    stopListening()
    stopSpeaking()
    hideToast()
    // 시간이 된 뒤에 연 것만 '배너를 봤다'로 친다 (일찍 열었다 돌아가면 나중에 배너가 다시 뜨게)
    if (elapsed >= limitSec) setTimeUpAck(true)
    setWrapCards(repeats.slice(-3))
    setSheet('wrap')
  }

  const finishSession = () => {
    if (draftSavedRef.current && draftExists(tabId) === false) {
      takeOver()
      return
    }
    const r = commit({
      repeats,
      stats: statsRef.current,
      minutes: (nowMs() - startedAt) / 60000,
      date: session.date,
      stage: session.stage,
      unit: session.unit,
    })
    clearDraft(tabId)
    draftSavedRef.current = false
    refreshDrafts()
    endSession(r.message)
  }

  const retry = (id: number) => {
    if (busyRef.current) return
    setMessages((prev) => prev.filter((m) => m.id !== id))
    if (historyRef.current[historyRef.current.length - 1]?.role === 'user') void aiTurn()
  }

  const pickHint = (h: Pair) => {
    pickedHintRef.current = h.en
    setPickedHint(h.en)
    void play([{ text: h.en, lang: 'en' }]).then((done) => {
      if (done) maybeAutoListen('en')
    })
  }

  // ── 안드로이드 뒤로 가기: 앱을 나가지 않고 창을 닫거나 마무리로 ──
  const handleBack = () => {
    const open = sheetRef.current
    if (open === 'wrap') {
      // 단원까지 남았으면 실수로 끝내지 않게 한 번 묻는다
      if (leftTurns <= 0 || window.confirm(`지금 저장하고 끝낼까요? 단원은 대화 한 번에 ${MIN_TURNS_FOR_UNIT}번 주고받아야 마쳐요.`)) finishSession()
    } else if (open === 'settings' && settingsBackRef.current) settingsBackRef.current()
    else if (open) closeSheet()
    else if (screen === 'chat') openWrap()
  }
  const backRef = useLatestRef(handleBack)
  const needGuard = screen === 'chat' || sheet !== null
  // 뒤로 가기를 처리한 뒤 다시 막아 둘지 살피게 하는 신호
  const [popTick, setPopTick] = useState(0)
  useEffect(() => {
    const guarded = !!(window.history.state as { efGuard?: boolean } | null)?.efGuard
    if (needGuard && !guarded) window.history.pushState({ efGuard: true }, '')
    // 버튼으로 닫아 막을 필요가 없어졌으면, 넣어 둔 칸을 거둬서 다음 뒤로 가기가 바로 앱을 나가게 한다
    if (!needGuard && guarded && !ignorePopRef.current) {
      ignorePopRef.current = true
      window.history.back()
    }
  }, [needGuard, popTick])
  useEffect(() => {
    const onPop = () => {
      if (ignorePopRef.current) {
        ignorePopRef.current = false
        return
      }
      backRef.current()
      setPopTick((t) => t + 1)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [backRef])

  // ── 교육과정 ──
  // 단계를 바꾸면 말 속도·뜻 보이기·따라 말하기 양도 그 단계에 맞춘다
  const moveToStage = (n: number) => {
    updateProgress(changeStage(freshProgress(), n))
    const stage = getStage(n)
    const next = sanitizeSettings({ ...settings, ...stage.defaults })
    setSettings(next)
    saveSettings(next)
    showToast(`${stage.n}단계 「${stage.name}」 시작! 말 속도와 뜻 보이기를 이 단계에 맞췄어요.`)
  }

  const askStageChange = (n: number) => {
    if (!window.confirm(`${n}단계로 바꿀까요? 말 속도와 뜻 보이기도 그 단계에 맞춰져요. 마친 단원 기록은 그대로 남아요.`)) return
    moveToStage(n)
  }

  const pickUnit = (unitId: string) => {
    updateProgress(chooseUnit(freshProgress(), unitId))
    closeSheet()
    const title = unitById(unitId)?.title ?? ''
    showToast(`「${title}」${ro(title)} 정했어요. 시작하기를 누르세요.`)
  }

  // ── 설정·옮기기·문장장 ──
  const saveNewSettings = (next: Settings) => {
    // 키 확인을 기다리는 사이 창을 닫았으면 저장하지 않는다 ('저장 안 함'을 고른 것)
    if (sheetRef.current !== 'settings') return
    const startAfter = settingsOpen.startAfter && !activeRef.current && !!next.apiKey
    setSettings(next)
    settingsRef.current = next
    if (!saveSettings(next)) showToast('이 브라우저에서는 설정이 저장되지 않아요(사생활 보호 모드?). 이번에만 적용돼요.')
    if (activeRef.current) setLimitSec((l) => Math.max(l, next.minutes * 60 - minutesOn(progress, session.date) * 60))
    closeSheet()
    if (startAfter) startSession(next)
  }

  // 다른 기기에서 가져온 문장장·진도는 합치고, 설정은 키·목소리만 빼고 맞춘다
  const importData = (data: TransferData) => {
    const { list, added } = mergeImported(freshLearned(), data.learned)
    setLearned(list)
    saveLearned(list)
    const next = applyImportedSettings(settings, data.settings)
    setSettings(next)
    saveSettings(next)
    if (data.progress) updateProgress(mergeProgress(freshProgress(), data.progress))
    return { added, total: list.length }
  }

  // 듣기 연습에서 고른 문장을 문장장에 더한다 (다른 탭 기록과 합쳐서)
  const saveSentences = (pairs: Pair[]): number => {
    const { list, added } = mergeLearned(freshLearned(), pairs, localDate())
    setLearned(list)
    saveLearned(list)
    return added
  }

  const clearBook = () => {
    if (!window.confirm('문장장을 모두 지울까요? 되돌릴 수 없어요.')) return
    setLearned([])
    saveLearned([])
  }

  // 쓰기 전에 다시 읽는다 (다른 탭에서 체크한 것을 지우지 않게, 자정이 지났으면 새 날로)
  const toggleCheck = (i: number) => {
    const day = localDate()
    const cur = storageWorks() ? loadDailyChecks(day) : dailyChecks
    const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i]
    setDaily({ date: day, checks: next })
    saveDailyChecks(day, next)
  }

  const allowMic = () => {
    void requestMic().then(async (r) => {
      if (r === 'granted') {
        setMicState('granted')
        return
      }
      if (r === 'blocked') {
        // 권한 창을 닫기만 했으면 아직 '묻기'라서 다시 누를 수 있게 둔다
        const now = (await micPermission()).state
        setMicState(now === 'unknown' ? 'denied' : now)
        showToast(now === 'prompt' ? '권한 창이 닫혔어요. 다시 누르고 "허용"을 골라 주세요.' : micRequestText(r, env))
        return
      }
      showToast(micRequestText(r, env))
    })
  }

  // ── 화면에 보일 값 ──
  const resumable = resumableDrafts(drafts, tabId, now)
  const draft = screen === 'start' ? (resumable[0] ?? null) : null
  const lastAi = [...messages].reverse().find((m) => m.kind === 'ai')
  const lastMsg = messages[messages.length - 1]
  const phase: Phase = busy ? 'thinking' : listening ? 'listening' : speaking ? 'speaking' : 'yourTurn'
  const status = busy ? '생각 중…' : speaking ? '말하는 중…' : screen === 'chat' ? unitTitle : `${TARGET.label} 친구`
  const startText =
    startMsg ??
    (!settings.apiKey
      ? learned.length || progress.sessions.length
        ? '진도는 옮겨졌어요. 이 기기에 Gemini 키만 넣으면 이어서 해요.'
        : '처음이면 "키 넣고 시작하기"를 눌러 Gemini 키부터 넣어요. 2분이면 돼요.'
      : '')

  return (
    <>
      <div className="app" inert={sheet !== null || screen === 'start'}>
        <Header
          friendName={settings.friendName}
          status={status}
          turnsText={screen === 'chat' ? (leftTurns > 0 ? `${turns}/${MIN_TURNS_FOR_UNIT}번` : '단원 ✓') : null}
          timeText={
            screen === 'chat' ? (elapsed >= limitSec ? '시간 됐어요' : `${Math.ceil((limitSec - elapsed) / 60)}분 남음`) : null
          }
          onSettings={() => openSettings()}
          onEnd={screen === 'chat' ? openWrap : null}
        />
        {showTimeBanner && (
          <div className="banner" id="timeBanner">
            <span>{leftTurns > 0 ? `시간이 됐어요. 단원까지 ${leftTurns}번 남았어요.` : '오늘 목표 시간을 채웠어요.'}</span>
            <button
              className={leftTurns > 0 ? 'primary' : 'secondary'}
              id="btnMore"
              type="button"
              onClick={() => setLimitSec((l) => Math.max(l, elapsed) + 300)}
            >
              5분 더
            </button>
            <button className={leftTurns > 0 ? 'secondary' : 'primary'} id="btnWrapNow" type="button" onClick={openWrap}>
              마무리하기
            </button>
          </div>
        )}
        <main id="chat" ref={chatRef}>
          {messages.map((m) => {
            if (m.kind === 'ai')
              return (
                <AiBubble
                  key={m.id}
                  turn={m.turn}
                  friendName={settings.friendName}
                  veiled={m.veiled}
                  showKo={settings.showKo}
                  pickedHint={m.id === lastAi?.id ? pickedHint : ''}
                  onUnveil={() => unveil(m.id)}
                  onPlay={(segs, slow) =>
                    void play(segs, slow).then((done) => {
                      // 마지막 말을 다시 들었으면, 자동 듣기를 켜 둔 사람은 다시 듣기 시작
                      if (done && m.id === lastAi?.id) maybeAutoListen(m.turn.repeat ? 'en' : lastLangRef.current)
                    })
                  }
                  onPickHint={pickHint}
                />
              )
            if (m.kind === 'me')
              return (
                <UserBubble
                  key={m.id}
                  text={m.text}
                  lang={m.lang}
                  isRepeat={m.isRepeat}
                  fromHint={m.fromHint}
                  heardWell={m.heardWell}
                  goal={m.goal}
                />
              )
            return (
              <ErrorBubble
                key={m.id}
                text={m.text}
                fix={m.fix}
                canRetry={awaitingReply}
                onRetry={() => retry(m.id)}
                onSettings={(fix) => openSettings({ focus: fix })}
              />
            )
          })}
          {busy && <TypingBubble slow={slowWait} onCancel={() => abortRef.current?.abort()} />}
        </main>
        <div className="sr-only" aria-live="polite">
          {lastAi && lastAi.kind === 'ai' ? `${lastAi.turn.say} ${lastAi.turn.say_ko}` : ''}
        </div>
        {screen === 'chat' && (
          <Composer
            friendName={settings.friendName}
            phase={phase}
            listening={listening}
            interim={interim}
            pendingRepeat={pendingRepeat}
            pickedHint={pickedHint}
            notice={micNotice}
            errorFix={lastMsg?.kind === 'error' ? lastMsg.fix : undefined}
            firstTime={progress.sessions.length === 0}
            veiled={!!lastAi && lastAi.kind === 'ai' && lastAi.veiled}
            onMic={(lang) => startMic(lang, (text) => sendUser(text, lang))}
            onCancelListen={stopListening}
            onStopSpeaking={stopSpeaking}
            onSend={sendUser}
          />
        )}
      </div>

      {screen === 'start' && (
        <StartScreen
          inert={sheet !== null}
          friendName={settings.friendName}
          message={startText}
          messageIsResult={startMsg !== null}
          progress={progress}
          hasKey={!!settings.apiKey}
          today={today}
          minutesGoal={settings.minutes}
          draft={draft}
          busyElsewhere={activeElsewhere(drafts, tabId, now)}
          mic={{
            state: micState,
            supported: recognitionSupported,
            inApp,
            chromeUrl: inApp || !recognitionSupported ? openInChromeUrl(window.location.href, env.ua) : null,
            externalUrl: inApp ? openExternalUrl(window.location.href, env.ua) : null,
            help: micBlockedHelp(env),
          }}
          hasData={learned.length > 0 || progress.sessions.length > 0}
          backupDue={isBackupDue(today, learned.length > 0 || progress.sessions.length > 0)}
          dailyChecks={dailyChecks}
          onToggleCheck={toggleCheck}
          onStart={() => startSession()}
          onResumeDraft={() => draft && resumeDraft(draft)}
          onSaveDraft={() => draft && saveDraftOnly(draft)}
          onDiscardDraft={() => draft && discardDraft(draft)}
          onAllowMic={allowMic}
          onSettings={() => openSettings()}
          onBook={() => openSheet('book')}
          onReview={() => {
            setBookReview(true)
            openSheet('book')
          }}
          onCourse={() => openSheet('course')}
          onTransfer={() => openSheet('transfer')}
          onPromote={() => askStageChange(progress.stage + 1)}
          onWarmup={() => openSheet('warmup')}
          onQuiz={() => openSheet('quiz')}
          onListen={() => openSheet('listen')}
          onProgress={() => openSheet('progress')}
        />
      )}
      {sheet === 'warmup' && (
        <WarmupSheet
          stage={getStage(progress.stage)}
          unit={getUnit(progress)}
          onPlay={(segs, slow) => void play(segs, slow)}
          onMic={startMic}
          onDone={() => startSession()}
          onClose={closeSheet}
        />
      )}
      {sheet === 'quiz' && (
        <QuizSheet learned={learned} settings={settings} onPlay={(segs, slow) => void play(segs, slow)} onMic={startMic} onClose={closeSheet} />
      )}
      {sheet === 'progress' && (
        <ProgressSheet progress={progress} today={today} minutesGoal={settings.minutes} onClose={closeSheet} />
      )}
      {sheet === 'listen' && (
        <ListenSheet
          settings={settings}
          progress={progress}
          learned={learned}
          onPlay={(segs, slow) => void play(segs, slow)}
          onMic={startMic}
          onSaveSentences={saveSentences}
          onNeedSettings={(fix) => openSettings({ focus: fix ?? 'apiKey' })}
          onClose={closeSheet}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          settings={settings}
          stageRate={getStage(progress.stage).defaults.rate}
          notice={settingsOpen.notice}
          firstRun={settingsOpen.firstRun}
          focus={settingsOpen.focus}
          startAfterSave={settingsOpen.startAfter}
          voices={speaker.voicesFor(TARGET.tts)}
          onCheckKey={(s, signal) => checkKey(s, signal)}
          onSave={saveNewSettings}
          onClose={closeSheet}
          backRef={settingsBackRef}
          onTestVoice={(voiceName, rate) => void play([{ text: 'Hi! Nice to meet you.', lang: 'en', voiceName }], false, rate)}
          onUnlockSound={() => speaker.unlock()}
        />
      )}
      {sheet === 'wrap' && (
        <WrapSheet
          cards={wrapCards}
          unitTitle={unitTitle}
          turns={turns}
          minTurns={MIN_TURNS_FOR_UNIT}
          onPlay={(segs, slow) => void play(segs, slow)}
          onMic={startMic}
          onCheck={(target, written) => checkWriting(settingsRef.current, target, written)}
          onToast={showToast}
          onBack={closeSheet}
          onFinish={finishSession}
        />
      )}
      {sheet === 'book' && (
        <BookSheet
          learned={learned}
          initialReview={bookReview}
          onPlay={(segs, slow) => void play(segs, slow)}
          onMic={startMic}
          onCheck={(target, written) => checkWriting(settingsRef.current, target, written)}
          onToast={showToast}
          onTransfer={() => openSheet('transfer')}
          onClear={clearBook}
          onClose={closeSheet}
        />
      )}
      {sheet === 'course' && (
        <CourseSheet
          progress={progress}
          onChooseUnit={pickUnit}
          onChangeStage={askStageChange}
          onPromote={() => askStageChange(progress.stage + 1)}
          onClose={closeSheet}
        />
      )}
      {sheet === 'transfer' && (
        <TransferSheet
          learned={learned}
          settings={settings}
          progress={progress}
          onImport={importData}
          onNeedKey={() => openSettings({ firstRun: true })}
          onClose={closeSheet}
        />
      )}
      {/* 낭독기가 알림을 놓치지 않게 상자는 늘 두고 글자만 바꾼다 */}
      <div className={`toast${toast ? ' show' : ''}`} id="toast" role="status">
        {toast}
      </div>
    </>
  )
}
