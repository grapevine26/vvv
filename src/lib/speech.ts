import { NATIVE, TARGET } from './config'
import type { Lang, Segment } from './types'

export interface SpeakOptions {
  rate: number
  voiceName: string
}

// 말하기: 브라우저 기본 음성(무료). 한 발화에 목소리 하나라서 언어별로 나눠 읽는다
export class Speaker {
  readonly supported: boolean
  voices: SpeechSynthesisVoice[] = []
  private token = 0
  private keep: SpeechSynthesisUtterance[] = []
  private options: SpeakOptions = { rate: 0.85, voiceName: '' }

  constructor() {
    this.supported =
      typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
    this.refresh()
  }

  // 설정이 바뀔 때마다 화면 쪽에서 불러 준다
  setOptions(options: SpeakOptions): void {
    this.options = options
  }

  refresh(): void {
    if (this.supported) this.voices = window.speechSynthesis.getVoices() ?? []
  }

  voicesFor(lang: string): SpeechSynthesisVoice[] {
    return this.voices.filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(lang))
  }

  voiceFor(lang: string, override?: string): SpeechSynthesisVoice | null {
    const list = this.voicesFor(lang)
    const wanted = override ?? (lang === TARGET.tts ? this.options.voiceName : '')
    if (wanted) {
      const chosen = list.find((v) => v.name === wanted)
      if (chosen) return chosen
    }
    const score = (v: SpeechSynthesisVoice) =>
      (/natural/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/^(en-us|ko-kr)$/i.test(v.lang) ? 1 : 0)
    return list.slice().sort((a, b) => score(b) - score(a))[0] ?? null
  }

  cancel(): void {
    this.token++
    if (this.supported) window.speechSynthesis.cancel()
  }

  // 첫 클릭 안에서 한 번 말해 두어야 이후 자동 재생이 막히지 않는다
  unlock(): void {
    if (!this.supported) return
    try {
      const u = new SpeechSynthesisUtterance(' ')
      u.volume = 0
      window.speechSynthesis.speak(u)
    } catch {
      // 소리 잠금 해제는 실패해도 대화는 이어 간다
    }
  }

  async play(segments: Segment[], slow = false, rateOverride?: number): Promise<void> {
    this.cancel()
    const my = this.token
    if (!this.supported) return
    for (const seg of segments) {
      if (my !== this.token) return
      await this.speakOne(seg, slow, rateOverride)
    }
  }

  private speakOne(seg: Segment, slow: boolean, rateOverride?: number): Promise<void> {
    return new Promise((resolve) => {
      const isTarget = seg.lang === 'en'
      const u = new SpeechSynthesisUtterance(seg.text)
      u.lang = isTarget ? TARGET.stt : NATIVE.stt
      const voice = this.voiceFor(isTarget ? TARGET.tts : NATIVE.tts, seg.voiceName)
      if (voice) u.voice = voice
      const base = isTarget ? (rateOverride ?? this.options.rate) : 1
      u.rate = slow ? Math.max(0.5, base * 0.75) : base
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve()
      }
      // 일부 브라우저는 onend를 빼먹는다. 예상 시간이 지나면 다음으로 넘어간다
      const timer = setTimeout(finish, 2500 + (seg.text.length * 140) / u.rate)
      u.onend = finish
      u.onerror = finish
      this.keep.push(u)
      if (this.keep.length > 20) this.keep.shift()
      window.speechSynthesis.speak(u)
    })
  }
}

// 듣기: 브라우저 음성 인식. 한 번에 한 언어만 알아듣는다
interface RecognitionResult {
  readonly isFinal: boolean
  readonly [index: number]: { transcript: string }
}
interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => Recognition

export function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export interface Listening {
  stop(): void
  abort(): void
}

export function listen(
  lang: Lang,
  onInterim: (text: string) => void,
  onDone: (text: string, error: string) => void,
): Listening {
  const Ctor = getRecognitionCtor()
  if (!Ctor) throw new Error('이 브라우저는 음성 인식을 지원하지 않아요')
  const rec = new Ctor()
  rec.lang = lang === 'en' ? TARGET.stt : NATIVE.stt
  rec.interimResults = true
  rec.continuous = false
  rec.maxAlternatives = 1
  let finalText = ''
  let interimText = ''
  let error = ''
  rec.onresult = (e) => {
    interimText = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]
      if (r.isFinal) finalText += r[0].transcript
      else interimText += r[0].transcript
    }
    onInterim(finalText + interimText)
  }
  rec.onerror = (e) => {
    error = e.error || 'unknown'
  }
  rec.onend = () => onDone((finalText || interimText).trim(), error)
  rec.start()
  return rec
}

export function micErrorText(code: string): string {
  const messages: Record<string, string> = {
    'not-allowed': '마이크가 막혀 있어요. 주소창 왼쪽 아이콘을 눌러 마이크를 "허용"으로 바꿔 주세요.',
    'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없어요. 크롬이나 엣지에서 열어 주세요.',
    'no-speech': '소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.',
    'audio-capture': '마이크를 찾지 못했어요. 마이크(이어폰)가 연결돼 있는지 확인해 주세요.',
    network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
    'language-not-supported': '이 브라우저가 이 언어 인식을 지원하지 않아요.',
  }
  return messages[code] ?? `음성 인식 오류(${code}). 다시 눌러 보거나 입력칸에 써 주세요.`
}
