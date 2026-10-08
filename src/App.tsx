import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookSheet } from './components/BookSheet'
import { Composer } from './components/Composer'
import { Header } from './components/Header'
import { AiBubble, ErrorBubble, UserBubble } from './components/Messages'
import { SettingsSheet } from './components/SettingsSheet'
import { StartScreen } from './components/StartScreen'
import { WrapSheet } from './components/WrapSheet'
import { TARGET } from './lib/config'
import { callGemini, checkWriting, errorText, parseTurn, TURN_SCHEMA } from './lib/gemini'
import { buildSystemPrompt, pushHistory, recentHistory, START_MESSAGE, userTag } from './lib/prompt'
import { getRecognitionCtor, listen, micErrorText, Speaker, type Listening } from './lib/speech'
import { loadLearned, loadSettings, mergeLearned, saveLearned, saveSettings } from './lib/storage'
import { applyImportedSettings, mergeImported, type TransferData } from './lib/transfer'
import { fmt, localDate, same, turnSegments } from './lib/text'
import type { Content, Lang, Message, Pair, Segment, Settings } from './lib/types'

type Sheet = 'settings' | 'wrap' | 'book' | null

// AI 응답을 기다리는 동안 설정이 바뀌어도 최신 값을 읽기 위한 ref
function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [learned, setLearned] = useState(loadLearned)
  const [screen, setScreen] = useState<'start' | 'chat'>('start')
  const [sheet, setSheet] = useState<Sheet>(null)
  const [settingsNotice, setSettingsNotice] = useState('')
  const [startMsg, setStartMsg] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState<Lang | null>(null)
  const [interim, setInterim] = useState('')
  const [pendingRepeat, setPendingRepeat] = useState('')
  const [repeats, setRepeats] = useState<Pair[]>([])
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [limitSec, setLimitSec] = useState(0)
  const [timeUpAck, setTimeUpAck] = useState(false)
  const [toast, setToast] = useState('')
  const [, setVoicesVersion] = useState(0)

  const settingsRef = useLatest(settings)
  const learnedRef = useLatest(learned)
  const historyRef = useRef<Content[]>([])
  const activeRef = useRef(false)
  const busyRef = useRef(false)
  const pendingRepeatRef = useRef('')
  const listenerRef = useRef<Listening | null>(null)
  const idRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const chatRef = useRef<HTMLElement>(null)

  const [speaker] = useState(() => new Speaker())
  useLayoutEffect(() => {
    speaker.setOptions({ rate: settings.rate, voiceName: settings.voiceName })
  }, [speaker, settings.rate, settings.voiceName])

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

  useEffect(() => {
    if (screen !== 'chat') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [screen])

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const showTimeBanner = screen === 'chat' && sheet !== 'wrap' && elapsed >= limitSec && !timeUpAck

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
  }
  const play = (segments: Segment[], slow?: boolean) => {
    void speaker.play(segments, slow)
  }
  const unveil = (id: number) =>
    setMessages((prev) => prev.map((m) => (m.id === id && m.kind === 'ai' && m.veiled ? { ...m, veiled: false } : m)))

  // ── 대화 흐름 ──
  const aiTurn = async () => {
    setBusyBoth(true)
    let turn
    try {
      const s = settingsRef.current
      const raw = await callGemini(s, buildSystemPrompt(s, learnedRef.current), recentHistory(historyRef.current), TURN_SCHEMA)
      turn = parseTurn(raw)
    } catch (err) {
      setBusyBoth(false)
      if (activeRef.current) addMessage({ kind: 'error', id: nextId(), text: errorText(err) })
      return
    }
    setBusyBoth(false)
    if (!activeRef.current) return
    pushHistory(historyRef.current, 'model', JSON.stringify(turn))
    pendingRepeatRef.current = turn.repeat
    setPendingRepeat(turn.repeat)
    const repeat = { en: turn.repeat, ko: turn.repeat_ko }
    if (repeat.en) setRepeats((prev) => (prev.some((r) => same(r.en, repeat.en)) ? prev : [...prev, repeat]))
    const id = nextId()
    const veiled = settingsRef.current.soundFirst
    addMessage({ kind: 'ai', id, turn, veiled })
    await speaker.play(turnSegments(turn))
    if (veiled) unveil(id)
  }

  const sendUser = (text: string, lang: Lang) => {
    if (!activeRef.current || busyRef.current) return
    const target = lang === 'en' ? pendingRepeatRef.current : ''
    addMessage({ kind: 'me', id: nextId(), text, lang, isRepeat: !!target })
    pushHistory(historyRef.current, 'user', `${userTag(lang, target)} ${text}`)
    void aiTurn()
  }

  // 마이크를 실제로 켰으면 true. 이미 듣는 중이면 멈추기만 한다
  const startMic = (lang: Lang, onText: (text: string) => void, onEnd?: () => void): boolean => {
    if (listenerRef.current) {
      listenerRef.current.stop()
      return false
    }
    if (!getRecognitionCtor()) {
      showToast('이 브라우저는 음성 인식이 안 돼요. 크롬이나 엣지에서 열거나, 입력칸에 써 주세요.')
      return false
    }
    speaker.cancel()
    try {
      listenerRef.current = listen(lang, setInterim, (text, error) => {
        listenerRef.current = null
        setListening(null)
        setInterim('')
        onEnd?.()
        if (text) onText(text)
        else if (error && error !== 'aborted') showToast(micErrorText(error))
        else if (!error) showToast('소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.')
      })
      setListening(lang)
      return true
    } catch (err) {
      listenerRef.current = null
      showToast('마이크를 시작하지 못했어요: ' + (err instanceof Error ? err.message : String(err)))
      return false
    }
  }

  const openSettings = (notice = '') => {
    hideToast()
    setSettingsNotice(notice)
    setSheet('settings')
  }

  const startSession = () => {
    if (!settings.apiKey.trim()) {
      openSettings('먼저 Gemini API 키를 넣어 주세요. 아래 링크에서 무료로 받을 수 있어요.')
      return
    }
    // 첫 인사가 자동 재생 차단에 걸리지 않게, 이 클릭 안에서 소리를 열어 둔다
    speaker.unlock()
    const t = Date.now()
    historyRef.current = []
    pendingRepeatRef.current = ''
    activeRef.current = true
    setMessages([])
    setRepeats([])
    setPendingRepeat('')
    setInterim('')
    setStartedAt(t)
    setNow(t)
    setLimitSec(settings.minutes * 60)
    setTimeUpAck(false)
    setStartMsg(null)
    setSheet(null)
    setScreen('chat')
    pushHistory(historyRef.current, 'user', START_MESSAGE)
    void aiTurn()
  }

  const stopEverything = () => {
    listenerRef.current?.abort()
    speaker.cancel()
    hideToast()
  }

  const endSession = (message: string) => {
    activeRef.current = false
    stopEverything()
    setSheet(null)
    setScreen('start')
    setStartMsg(message)
  }

  const openWrap = () => {
    stopEverything()
    setTimeUpAck(true)
    setSheet('wrap')
  }

  const finishSession = () => {
    const { list, added } = mergeLearned(learned, repeats, localDate())
    setLearned(list)
    saveLearned(list)
    endSession(added ? `오늘 ${added}문장을 문장장에 저장했어요. 다음 대화에서 다시 써 볼 거예요.` : '오늘도 수고했어요. 또 만나요!')
  }

  const saveNewSettings = (next: Settings) => {
    setSettings(next)
    if (!saveSettings(next)) showToast('이 브라우저에서는 설정이 저장되지 않아요(사생활 보호 모드?). 이번에만 적용돼요.')
    if (activeRef.current) setLimitSec((l) => Math.max(l, next.minutes * 60))
    setSheet(null)
  }

  // 다른 기기에서 가져온 문장장은 합치고, 설정은 키·목소리만 빼고 맞춘다
  const importData = (data: TransferData) => {
    const { list, added } = mergeImported(learned, data.learned)
    setLearned(list)
    saveLearned(list)
    const next = applyImportedSettings(settings, data.settings)
    setSettings(next)
    saveSettings(next)
    return { added, total: list.length }
  }

  const clearBook = () => {
    if (!window.confirm('문장장을 모두 지울까요? 되돌릴 수 없어요.')) return
    setLearned([])
    saveLearned([])
  }

  const startMessage =
    startMsg ??
    (settings.apiKey
      ? `버튼을 누르면 ${settings.friendName}가 먼저 인사해요. 한국어로 대답해도 괜찮아요.`
      : '처음이면 아래 "설정"에서 Gemini API 키부터 넣어 주세요.')

  return (
    <>
      <div className="app">
        <Header
          friendName={settings.friendName}
          status={busy ? '생각 중…' : screen === 'chat' ? '' : `${TARGET.label} 친구`}
          timer={screen === 'chat' ? `${fmt(elapsed)} / ${fmt(limitSec)}` : null}
          onSettings={() => openSettings()}
          onEnd={screen === 'chat' ? openWrap : null}
        />
        {showTimeBanner && (
          <div className="banner" id="timeBanner">
            <span>오늘 정한 시간이 다 됐어요.</span>
            <button className="primary" id="btnWrapNow" type="button" onClick={openWrap}>
              마무리하기
            </button>
            <button className="secondary" id="btnMore" type="button" onClick={() => setLimitSec((l) => l + 300)}>
              5분 더
            </button>
          </div>
        )}
        <main id="chat" ref={chatRef} aria-live="polite">
          {messages.map((m) => {
            if (m.kind === 'ai')
              return (
                <AiBubble
                  key={m.id}
                  turn={m.turn}
                  veiled={m.veiled}
                  showKo={settings.showKo}
                  onUnveil={() => unveil(m.id)}
                  onPlay={play}
                />
              )
            if (m.kind === 'me') return <UserBubble key={m.id} text={m.text} lang={m.lang} isRepeat={m.isRepeat} />
            return (
              <ErrorBubble
                key={m.id}
                text={m.text}
                onRetry={() => {
                  if (busyRef.current) return
                  setMessages((prev) => prev.filter((x) => x.id !== m.id))
                  void aiTurn()
                }}
                onSettings={() => openSettings()}
              />
            )
          })}
          {busy && (
            <div className="msg ai">
              <div className="bubble typing">…</div>
            </div>
          )}
        </main>
        {screen === 'chat' && (
          <Composer
            busy={busy}
            listening={listening}
            interim={interim}
            pendingRepeat={pendingRepeat}
            onMic={(lang) => startMic(lang, (text) => sendUser(text, lang))}
            onSend={sendUser}
          />
        )}
      </div>

      {screen === 'start' && (
        <StartScreen
          friendName={settings.friendName}
          message={startMessage}
          onStart={startSession}
          onSettings={() => openSettings()}
          onBook={() => {
            hideToast()
            setSheet('book')
          }}
        />
      )}
      {sheet === 'settings' && (
        <SettingsSheet
          settings={settings}
          notice={settingsNotice}
          voices={speaker.voicesFor(TARGET.tts)}
          onSave={saveNewSettings}
          onClose={() => setSheet(null)}
          onTestVoice={(voiceName, rate) => {
            void speaker.play([{ text: 'Hi! Nice to meet you.', lang: 'en', voiceName }], false, rate)
          }}
        />
      )}
      {sheet === 'wrap' && (
        <WrapSheet
          cards={repeats.slice(-3)}
          onPlay={play}
          onMic={startMic}
          onCheck={(target, written) => checkWriting(settingsRef.current, target, written)}
          onToast={showToast}
          onBack={() => setSheet(null)}
          onFinish={finishSession}
        />
      )}
      {sheet === 'book' && (
        <BookSheet
          learned={learned}
          settings={settings}
          onPlay={play}
          onImport={importData}
          onClear={clearBook}
          onClose={() => setSheet(null)}
        />
      )}
      {toast && (
        <div className="toast" id="toast" role="status">
          {toast}
        </div>
      )}
    </>
  )
}
