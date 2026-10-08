import { expect, type BrowserContext, type Page } from '@playwright/test'

// 브라우저 음성·마이크 기능을 가짜로 바꾼다.
// - 말한 내용은 window.__spoken에 쌓이고, __say()로 마이크에 말한 척한다
// - 마이크 권한은 window.__mic.state('granted'|'denied'|'prompt')로 정하고, __setMic()으로 바꾼다
// - 권한 창(getUserMedia)은 window.__mic.allow가 true면 허용, false면 거절된 것으로 한다
export const SPEECH_MOCK = `(() => {
  window.__spoken = [];
  window.__recs = [];
  window.__speakDelay = 5;
  class FakeVoice { constructor(name, lang) { this.name = name; this.lang = lang; this.default = false; this.localService = true; this.voiceURI = name; } }
  const voices = [
    new FakeVoice('Microsoft David - English (United States)', 'en-US'),
    new FakeVoice('Google US English', 'en-US'),
    new FakeVoice('Google 한국의', 'ko-KR'),
  ];
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.volume = 1; } };
  const synth = {
    onvoiceschanged: null,
    getVoices() { return voices; },
    speak(u) {
      window.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name, rate: u.rate, volume: u.volume });
      // __speakError를 정해 두면 소리가 안 나는 목소리 오류를 흉내 낸다
      if (window.__speakError && u.volume !== 0) { const err = window.__speakError; setTimeout(() => { u.onerror && u.onerror({ error: err }); }, 5); return; }
      setTimeout(() => { u.onend && u.onend({}); }, window.__speakDelay);
    },
    cancel() { window.__spoken.push({ cancel: true }); },
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true });
  class FakeRecognition {
    constructor() { this.lang = ''; this.started = false; this.stopped = false; window.__recs.push(this); }
    start() { this.started = true; }
    stop() { if (this.stopped) return; this.stopped = true; this.onend && this.onend(); }
    abort() { if (this.stopped) return; this.stopped = true; this.onerror && this.onerror({ error: 'aborted' }); this.onend && this.onend(); }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
  window.__say = (text, final = true) => {
    const r = window.__recs[window.__recs.length - 1];
    r.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] });
    if (final) { r.stopped = true; r.onend(); }
  };
  window.__silence = (err) => { const r = window.__recs[window.__recs.length - 1]; r.stopped = true; if (err) r.onerror({ error: err }); r.onend(); };
  // 말은 했는데 알아듣지 못함 (크롬의 nomatch 이벤트)
  window.__nomatch = () => { const r = window.__recs[window.__recs.length - 1]; r.stopped = true; r.onnomatch && r.onnomatch(); r.onend(); };

  // allow: true(허용) / false(거절) / 'NotFoundError' 같은 오류 이름(그 오류로 실패, 권한은 그대로)
  window.__mic = Object.assign({ state: 'granted', allow: true }, window.__micPreset || {});
  const status = new EventTarget();
  Object.defineProperty(status, 'state', { get() { return window.__mic.state; } });
  status.onchange = null;
  window.__setMic = (s) => {
    window.__mic.state = s;
    const ev = new Event('change');
    if (status.onchange) status.onchange(ev);
    status.dispatchEvent(ev);
  };
  if (navigator.permissions) {
    const realQuery = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = (d) => (d && d.name === 'microphone' ? Promise.resolve(status) : realQuery(d));
  }
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = () => {
      window.__micRequests = (window.__micRequests || 0) + 1;
      if (window.__mic.allow === true) { window.__setMic('granted'); return Promise.resolve({ getTracks: () => [] }); }
      if (typeof window.__mic.allow === 'string') return Promise.reject(new DOMException('mic error', window.__mic.allow));
      window.__setMic('denied');
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
})();`

export interface Spoken {
  text?: string
  lang?: string
  voice?: string
  rate?: number
  volume?: number
  cancel?: boolean
}
export interface MockWindow {
  __spoken: Spoken[]
  __recs: { lang: string; started: boolean; stopped: boolean }[]
  __speakDelay: number
  __say: (text: string, final?: boolean) => void
  __silence: (err?: string) => void
  __mic: { state: string; allow: boolean | string }
  __speakError?: string
  __nomatch: () => void
  __setMic: (s: string) => void
  __micRequests?: number
}
export interface GeminiRequest {
  url: string
  headers: Record<string, string>
  body: {
    systemInstruction: { parts: { text: string }[] }
    contents: { role: string; parts: { text: string }[] }[]
    generationConfig: { responseMimeType: string; responseSchema: { required: string[] } }
  }
}
export interface MockReply {
  status?: number
  payload: unknown
  // 응답을 늦게 보내기 (느린 응답 테스트용, ms)
  delayMs?: number
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-goog-api-key',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
}

export interface MockOptions {
  // 처음 열 때 마이크 권한 상태 (기본 granted)
  mic?: { state?: 'granted' | 'denied' | 'prompt'; allow?: boolean | string }
  // 처음 한 번만 넣어 둘 저장값 (새로고침해도 앱이 바꾼 값은 유지)
  storage?: Record<string, unknown>
}

// 가짜 Gemini 서버. POST(대화·써 보기 확인)는 queue에서 하나씩 꺼내 답하고,
// GET(키 확인: models/{모델})은 keyCheck 값으로 바로 답한다 (queue를 쓰지 않음)
export async function installMocks(context: BrowserContext, opts: MockOptions = {}) {
  if (opts.mic) {
    await context.addInitScript((m) => {
      ;(window as unknown as { __micPreset: unknown }).__micPreset = m
    }, opts.mic)
  }
  await context.addInitScript(SPEECH_MOCK)
  if (opts.storage) {
    await context.addInitScript((s) => {
      // 저장소가 막힌 브라우저를 흉내 내는 테스트에서는 넣지 못해도 그냥 넘어간다
      try {
        if (sessionStorage.getItem('__seeded')) return
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v))
        sessionStorage.setItem('__seeded', '1')
      } catch {
        // 무시
      }
    }, opts.storage)
  }
  const requests: GeminiRequest[] = []
  const keyChecks: { url: string; headers: Record<string, string> }[] = []
  const queue: MockReply[] = []
  const keyCheck: MockReply = { status: 200, payload: { name: 'models/x' } }
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const req = route.request()
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const isGet = req.method() === 'GET'
    let next: MockReply
    if (isGet) {
      keyChecks.push({ url: req.url(), headers: req.headers() })
      next = keyCheck
    } else {
      requests.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData() || '{}') })
      next = queue.shift() ?? { status: 500, payload: { error: { message: 'no mock queued' } } }
    }
    if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs))
    await route
      .fulfill({
        status: next.status ?? 200,
        headers: { ...CORS, 'content-type': 'application/json' },
        body: typeof next.payload === 'string' ? next.payload : JSON.stringify(next.payload),
      })
      .catch(() => {}) // 앱이 기다리기를 그만둬서 이미 끊긴 요청
  })
  return { requests, keyChecks, queue, keyCheck }
}

// AI 한 턴의 모양 (빠진 칸은 빈 값)
export const turn = (o: Record<string, unknown>) => ({
  say: '',
  say_ko: '',
  cue: '',
  repeat: '',
  repeat_ko: '',
  hints: [],
  words: [],
  tip: '',
  ...o,
})
// Gemini 응답 모양으로 감싼다 (t가 문자열이면 그대로 text에 넣는다)
export const reply = (t: unknown): MockReply => ({
  payload: {
    candidates: [{ content: { parts: [{ text: typeof t === 'string' ? t : JSON.stringify(t) }] }, finishReason: 'STOP' }],
  },
})
export const errorReply = (status: number, message: string): MockReply => ({ status, payload: { error: { message } } })
export const lastUserText = (r: GeminiRequest) => r.body.contents[r.body.contents.length - 1].parts[0].text
export const systemText = (r: GeminiRequest) => r.body.systemInstruction.parts[0].text

export const spoken = (page: Page) =>
  page.evaluate(() => (window as unknown as MockWindow).__spoken.filter((s) => !s.cancel && s.volume !== 0))
export const clearSpoken = (page: Page) =>
  page.evaluate(() => {
    ;(window as unknown as MockWindow).__spoken = []
  })
export const lastRec = (page: Page) =>
  page.evaluate(() => {
    const recs = (window as unknown as MockWindow).__recs
    const r = recs[recs.length - 1]
    return r ? { lang: r.lang, started: r.started, stopped: r.stopped, count: recs.length } : null
  })
export const say = (page: Page, text: string, final = true) =>
  page.evaluate(([t, f]) => (window as unknown as MockWindow).__say(t as string, f as boolean), [text, final] as const)
export const silence = (page: Page, err?: string) =>
  page.evaluate((e) => (window as unknown as MockWindow).__silence(e), err)
export const setMic = (page: Page, state: string, allow?: boolean) =>
  page.evaluate(
    ([s, a]) => {
      const w = window as unknown as MockWindow
      if (a !== undefined) w.__mic.allow = a as boolean
      w.__setMic(s as string)
    },
    [state, allow] as const,
  )
export const aiBubbles = (page: Page) => page.locator('.msg.ai:not(.error) .bubble:not(.typing)')

export const storageGet = (page: Page, key: string) =>
  page.evaluate((k) => {
    const v = localStorage.getItem(k)
    return v === null ? null : JSON.parse(v)
  }, key)

// 페이지 오류·콘솔 오류를 모은다. 일부러 만든 실패 응답을 브라우저가 기록하는 줄은 뺀다
export function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (/status of \d{3}/.test(m.text()) && (m.location().url || '').includes('generativelanguage')) return
    errors.push('console: ' + m.text())
  })
  return errors
}

// 키가 있는 상태로 열고 첫 인사까지 받는다
export async function startWithGreeting(
  page: Page,
  queue: MockReply[],
  greeting: Record<string, unknown> = { say: "Hi! I'm Emma. How are you?", say_ko: '안녕! 나는 Emma야. 잘 지내?' },
) {
  queue.push(reply(turn(greeting)))
  await page.click('#btnStart')
  await expect(aiBubbles(page)).toHaveCount(1)
}

// 휴대폰 폭에서 가로로 넘치는 요소가 없는지
export const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
