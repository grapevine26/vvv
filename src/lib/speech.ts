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

  // 끝까지 다 읽었으면 true, 중간에 끊겼으면 false
  async play(segments: Segment[], slow = false, rateOverride?: number): Promise<boolean> {
    this.cancel()
    const my = this.token
    if (!this.supported) return false
    for (const seg of segments) {
      if (my !== this.token) return false
      await this.speakOne(seg, slow, rateOverride)
    }
    return my === this.token
  }

  private speakOne(seg: Segment, slow: boolean, rateOverride?: number): Promise<void> {
    return new Promise((resolve) => {
      const isTarget = seg.lang === 'en'
      const u = new SpeechSynthesisUtterance(seg.text)
      u.lang = isTarget ? TARGET.stt : NATIVE.stt
      const voice = this.voiceFor(isTarget ? TARGET.tts : NATIVE.tts, seg.voiceName)
      if (voice) u.voice = voice
      const base = isTarget ? (rateOverride ?? this.options.rate) : 1
      // 천천히는 영어에만. 한국어 신호까지 느려지면 답답하다
      u.rate = slow && isTarget ? Math.max(0.5, base * 0.75) : base
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

// ── 실행 환경 ──
export interface Env {
  ua: string
  standalone: boolean
}

export function currentEnv(): Env {
  const standalone =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
  return { ua: typeof navigator !== 'undefined' ? navigator.userAgent : '', standalone }
}

export const isAndroid = (ua: string) => /Android/i.test(ua)

// 카카오톡 같은 앱 안의 브라우저는 음성 인식이 안 되고 저장소도 크롬과 따로라서 크롬으로 보내야 한다
export function inAppBrowser(ua: string): 'kakao' | 'other' | null {
  if (/KAKAOTALK/i.test(ua)) return 'kakao'
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|; wv\)/i.test(ua)) return 'other'
  return null
}

// 앱 안 브라우저에서 크롬으로 여는 주소. 못 만들면 null (주소를 복사해 크롬에 붙여 넣으라고 안내)
export function openInChromeUrl(href: string, ua: string): string | null {
  if (/KAKAOTALK/i.test(ua)) return 'kakaotalk://web/openExternal?url=' + encodeURIComponent(href)
  if (isAndroid(ua)) {
    const u = new URL(href)
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`
  }
  return null
}

export type MicState = 'granted' | 'denied' | 'prompt' | 'unknown'

export async function micPermission(): Promise<{ state: MicState; status: PermissionStatus | null }> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return { state: status.state as MicState, status }
  } catch {
    return { state: 'unknown', status: null }
  }
}

// 대화 전에 마이크 권한 창을 미리 띄운다. 허용되면 true
export async function requestMic(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

// 마이크가 막혔을 때 기기에 맞는 고치는 법
export function micBlockedHelp(env: Env): string {
  if (env.standalone || isAndroid(env.ua)) {
    return '휴대폰 설정 → 애플리케이션 → Chrome → 권한 → 마이크를 "허용"으로 바꿔 주세요. 크롬 화면이면 주소창 왼쪽 아이콘 → 권한 → 마이크도 확인해 주세요.'
  }
  return '주소창 왼쪽 아이콘을 누르고 마이크를 "허용"으로 바꿔 주세요.'
}

export function micErrorText(code: string, env: Env = currentEnv()): string {
  const messages: Record<string, string> = {
    'not-allowed': `마이크가 막혀 있어요. ${micBlockedHelp(env)} 그동안은 아래 입력칸에 써도 돼요.`,
    'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없어요. 크롬이나 엣지에서 열어 주세요.',
    'no-speech': '소리가 안 들렸어요. 버튼을 누르고 바로 말해 주세요.',
    'audio-capture': '마이크를 찾지 못했어요. 마이크(이어폰)가 연결돼 있는지 확인해 주세요.',
    network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
    'language-not-supported': '이 브라우저가 이 언어 인식을 지원하지 않아요.',
  }
  return messages[code] ?? `음성 인식 오류(${code}). 다시 눌러 보거나 입력칸에 써 주세요.`
}
