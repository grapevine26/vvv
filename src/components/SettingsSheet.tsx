import { useState } from 'react'
import { clamp, GEMINI_KEY_URL, REPEAT_AMOUNTS, sanitizeSettings } from '../lib/config'
import { AppError, errorText } from '../lib/gemini'
import type { FixTarget, Settings } from '../lib/types'
import { Sheet } from './common'

interface Props {
  settings: Settings
  // 지금 단계의 기본 말 속도 (느리게·빠르게 버튼의 기준)
  stageRate: number
  notice: string
  // 키가 없을 때: 키 넣는 칸만 보여 준다
  firstRun: boolean
  // 오류에서 열었을 때 바로 보여 줄 칸
  focus: FixTarget
  startAfterSave: boolean
  voices: SpeechSynthesisVoice[]
  onCheckKey: (s: Settings) => Promise<void>
  onSave: (next: Settings) => void
  onClose: () => void
  onTestVoice: (voiceName: string, rate: number) => void
  onUnlockSound: () => void
}

type CheckState = { state: 'idle' } | { state: 'checking' } | { state: 'error'; text: string; canSkip: boolean }

const REPEAT_HELP: Record<string, string> = { 적게: '가끔', 보통: '두세 번에 한 번', 많이: '거의 매번' }

export function SettingsSheet(props: Props) {
  const { settings, stageRate, notice, firstRun, focus, startAfterSave, voices } = props
  const { onCheckKey, onSave, onClose, onTestVoice, onUnlockSound } = props
  const [form, setForm] = useState<Settings>(settings)
  const [check, setCheck] = useState<CheckState>({ state: 'idle' })
  const [showKey, setShowKey] = useState(false)
  const [editKey, setEditKey] = useState(firstRun || !settings.apiKey || focus === 'apiKey')
  const [advancedOpen, setAdvancedOpen] = useState(focus === 'model')
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }))
  const voiceValue = voices.some((v) => v.name === form.voiceName) ? form.voiceName : ''
  const keyLooksOdd = form.apiKey.trim() !== '' && !/^AIza/.test(form.apiKey.replace(/[\s"'“”‘’`]/g, ''))

  const close = () => {
    const changed = JSON.stringify(sanitizeSettings(form)) !== JSON.stringify(sanitizeSettings(settings))
    if (changed && !window.confirm('바꾼 내용을 저장하지 않고 닫을까요?')) return
    onClose()
  }

  const submit = async (skipCheck = false) => {
    // 이 누르기 안에서 소리를 열어 둬야 '저장하고 시작하기' 뒤 첫 인사가 막히지 않는다
    onUnlockSound()
    const next = sanitizeSettings(form)
    if (!next.apiKey && firstRun) {
      setCheck({ state: 'error', text: '키를 먼저 붙여 넣어 주세요.', canSkip: false })
      return
    }
    const connectionChanged = next.apiKey !== settings.apiKey || next.model !== settings.model
    if (next.apiKey && (connectionChanged || firstRun) && !skipCheck) {
      setCheck({ state: 'checking' })
      try {
        await onCheckKey(next)
      } catch (err) {
        const fix = err instanceof AppError ? err.fix : null
        if (fix === 'model') setAdvancedOpen(true)
        setCheck({ state: 'error', text: errorText(err), canSkip: err instanceof AppError && err.retryable })
        return
      }
    }
    setCheck({ state: 'idle' })
    onSave(next)
  }

  const pasteKey = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) set('apiKey', t.trim())
    } catch {
      setCheck({ state: 'error', text: '자동 붙여넣기가 안 돼요. 칸을 길게 누르거나 Ctrl+V로 붙여 넣어 주세요.', canSkip: false })
    }
  }

  const keyField = (
    <div className="field" id="keyField">
      <span>Gemini API 키</span>
      <span className="inline">
        <input
          type={showKey ? 'text' : 'password'}
          name="apiKey"
          autoComplete="off"
          spellCheck={false}
          placeholder="AIza…로 시작하는 긴 글자"
          value={form.apiKey}
          autoFocus={firstRun || focus === 'apiKey'}
          onChange={(e) => set('apiKey', e.target.value)}
        />
        <button className="secondary small" type="button" onClick={pasteKey}>
          붙여넣기
        </button>
        <button className="secondary small" type="button" aria-pressed={showKey} onClick={() => setShowKey((v) => !v)}>
          {showKey ? '가리기' : '보기'}
        </button>
      </span>
      {keyLooksOdd && <div className="warn-text">키는 보통 "AIza"로 시작해요. 다른 글자가 섞이지 않았는지 확인해 주세요.</div>}
    </div>
  )

  const checkLine =
    check.state === 'checking' ? (
      <div className="result" id="keyCheck" role="status">
        키 확인 중…
      </div>
    ) : check.state === 'error' ? (
      <div className="result bad" id="keyCheck" role="alert">
        {check.text}
        {check.canSkip && (
          <div className="tools">
            <button className="secondary" type="button" onClick={() => void submit(true)}>
              확인 없이 저장
            </button>
          </div>
        )}
      </div>
    ) : null

  const footer = (
    <>
      <button className="secondary" id="btnSettingsCancel" type="button" onClick={close}>
        {firstRun ? '나중에' : '닫기'}
      </button>
      <button className="primary" id="btnSettingsSave" type="submit" form="settingsForm" disabled={check.state === 'checking'}>
        {startAfterSave ? '저장하고 시작하기' : '저장'}
      </button>
    </>
  )

  return (
    <Sheet id="settingsSheet" title={firstRun ? 'Gemini 키 넣기' : '설정'} onClose={close} footer={footer}>
      <form
        id="settingsForm"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {notice && (
          <p className="notice" id="settingsNotice">
            {notice}
          </p>
        )}

        {firstRun ? (
          <>
            <div className="key-guide" id="keyGuide">
              <b>키 받는 법 (2분, 무료)</b>
              <a className="primary link-btn" href={GEMINI_KEY_URL} target="_blank" rel="noopener noreferrer" id="btnOpenStudio">
                Google AI Studio 열기 ↗
              </a>
              <ol className="list steps">
                <li>구글 계정으로 로그인해요. 처음이면 약관에 체크하고 파란 버튼을 눌러요.</li>
                <li>
                  <b lang="en">Create API key</b>(또는 <span lang="en">Get API key</span>)를 눌러요. 프로젝트를 고르라고 하면 맨 위 항목을
                  골라요.
                </li>
                <li>
                  <b lang="en">AIza</b>로 시작하는 긴 글자 옆 복사 아이콘을 누르고 이 화면으로 돌아와요.
                </li>
                <li>아래 칸에 붙여 넣고 "{startAfterSave ? '저장하고 시작하기' : '저장'}"를 눌러요.</li>
              </ol>
            </div>
            {keyField}
            {checkLine}
            <p className="note">
              키는 이 브라우저에만 저장돼요. 폰에서도 쓰려면 PC에서 키를 복사해 카톡 "나와의 채팅"으로 보내 붙여 넣어도 돼요(남에게는
              보내지 마세요).
            </p>
            <p className="note">무료 키로 한 대화는 구글이 서비스 개선에 쓸 수 있으니 개인정보는 말하지 마세요.</p>
          </>
        ) : (
          <>
            <fieldset>
              <legend>소리와 글자</legend>
              <div className="field">
                <span>
                  영어 말 속도 <b id="rateValue">{Number(form.rate).toFixed(2)}</b>
                  {Math.abs(form.rate - stageRate) < 0.026 ? ' (이 단계 기본)' : ''}
                </span>
                <div className="tools three" id="rateButtons">
                  {[
                    { label: '느리게', v: stageRate - 0.1 },
                    { label: '단계 기본', v: stageRate },
                    { label: '빠르게', v: stageRate + 0.1 },
                  ].map((b) => {
                    const v = Math.round(clamp(b.v, 0.5, 1.2, stageRate) * 100) / 100
                    return (
                      <button
                        key={b.label}
                        type="button"
                        className={`secondary${Math.abs(form.rate - v) < 0.026 ? ' selected' : ''}`}
                        aria-pressed={Math.abs(form.rate - v) < 0.026}
                        onClick={() => set('rate', v)}
                      >
                        {b.label}
                      </button>
                    )
                  })}
                </div>
                <input
                  type="range"
                  name="rate"
                  aria-label="영어 말 속도 세밀하게"
                  min={0.5}
                  max={1.2}
                  step={0.05}
                  value={form.rate}
                  onChange={(e) => set('rate', Number(e.target.value))}
                />
                <button className="secondary small" type="button" onClick={() => onTestVoice(voiceValue, Number(form.rate))}>
                  🔊 들어보기
                </button>
              </div>
              <label className="check">
                <input type="checkbox" name="showKo" checked={form.showKo} onChange={(e) => set('showKo', e.target.checked)} />
                한국어 뜻 바로 보이기 (끄면 친구 말의 뜻은 눌러야 보여요)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="soundFirst"
                  checked={form.soundFirst}
                  onChange={(e) => set('soundFirst', e.target.checked)}
                />
                소리 먼저, 글자는 다 들은 뒤에
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  name="autoListen"
                  checked={form.autoListen}
                  onChange={(e) => set('autoListen', e.target.checked)}
                />
                친구 말이 끝나면 바로 듣기 (버튼을 안 눌러도 돼요)
              </label>
              <label className="field">
                <span>하루 목표 시간(분)</span>
                <input
                  type="number"
                  name="minutes"
                  inputMode="numeric"
                  min={3}
                  max={120}
                  step={1}
                  value={form.minutes}
                  onChange={(e) => set('minutes', Number(e.target.value))}
                />
              </label>
            </fieldset>

            <fieldset>
              <legend>나에 대해</legend>
              <label className="field">
                <span>좋아하는 것 (대화 주제에 써요)</span>
                <input
                  name="likes"
                  placeholder="예: 커피, 여행, 업무 자동화, 드라마"
                  value={form.likes}
                  onChange={(e) => set('likes', e.target.value)}
                />
              </label>
              <label className="field">
                <span>따라 말하기 양</span>
                <select name="repeatAmount" value={form.repeatAmount} onChange={(e) => set('repeatAmount', e.target.value)}>
                  {REPEAT_AMOUNTS.map((r) => (
                    <option key={r} value={r}>
                      {r} ({REPEAT_HELP[r]})
                    </option>
                  ))}
                </select>
              </label>
              <p className="note">수준은 교육과정 단계로 정해져요. 시작 화면의 "교육과정"에서 바꿀 수 있어요.</p>
            </fieldset>

            <fieldset>
              <legend>AI 연결</legend>
              {editKey ? (
                keyField
              ) : (
                <div className="inline" id="keyStatus">
                  <span className="ok-text">연결됨 ✓ (…{settings.apiKey.slice(-4)})</span>
                  <button className="secondary small" type="button" id="btnChangeKey" onClick={() => setEditKey(true)}>
                    키 바꾸기
                  </button>
                </div>
              )}
              {checkLine}
              <p className="note">
                키가 없으면{' '}
                <a href={GEMINI_KEY_URL} target="_blank" rel="noopener noreferrer">
                  Google AI Studio
                </a>
                에서 무료로 받아요. 키는 이 브라우저에만 저장돼요.
              </p>
            </fieldset>

            <details className="more" id="advanced" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
              <summary>고급 (보통은 안 바꿔도 돼요)</summary>
              <label className="field">
                <span>모델 이름</span>
                <input
                  name="model"
                  autoComplete="off"
                  spellCheck={false}
                  value={form.model}
                  autoFocus={focus === 'model'}
                  onChange={(e) => set('model', e.target.value)}
                />
              </label>
              <p className="note">"모델을 찾을 수 없어요"가 뜨면 여기를 바꾸세요. 예: gemini-3.5-flash-lite(빠름), gemini-3.8-flash(더 똑똑함)</p>
              <label className="field">
                <span>친구 이름</span>
                <input name="friendName" maxLength={20} value={form.friendName} onChange={(e) => set('friendName', e.target.value)} />
              </label>
              <label className="field">
                <span>친구 성격</span>
                <input name="friendStyle" maxLength={40} value={form.friendStyle} onChange={(e) => set('friendStyle', e.target.value)} />
              </label>
              <label className="field">
                <span>영어 목소리</span>
                <select name="voiceName" id="voiceSelect" value={voiceValue} onChange={(e) => set('voiceName', e.target.value)}>
                  <option value="">자동으로 고르기</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </label>
              <p className="note">엣지 브라우저라면 이름에 "Natural"이 붙은 목소리가 더 자연스러워요.</p>
              <p className="note">폰에서는 크롬 메뉴 ⋮ → "홈 화면에 추가"를 하면 앱처럼 바로 열 수 있어요.</p>
            </details>
          </>
        )}
      </form>
    </Sheet>
  )
}
