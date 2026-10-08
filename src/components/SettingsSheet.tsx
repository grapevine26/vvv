import { useState } from 'react'
import { GEMINI_KEY_URL, REPEAT_AMOUNTS, sanitizeSettings } from '../lib/config'
import type { Settings } from '../lib/types'

interface Props {
  settings: Settings
  notice: string
  voices: SpeechSynthesisVoice[]
  onSave: (next: Settings) => void
  onClose: () => void
  onTestVoice: (voiceName: string, rate: number) => void
}

export function SettingsSheet({ settings, notice, voices, onSave, onClose, onTestVoice }: Props) {
  const [form, setForm] = useState<Settings>(settings)
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm((f) => ({ ...f, [key]: value }))
  const voiceValue = voices.some((v) => v.name === form.voiceName) ? form.voiceName : ''

  return (
    <section className="sheet" id="settingsSheet">
      <form
        className="sheet-card"
        id="settingsForm"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(sanitizeSettings(form))
        }}
      >
        <h2>설정</h2>
        {notice && (
          <p className="notice" id="settingsNotice">
            {notice}
          </p>
        )}
        <fieldset>
          <legend>AI 연결</legend>
          <label className="field">
            <span>Gemini API 키</span>
            <input
              type="password"
              name="apiKey"
              autoComplete="off"
              placeholder="AIza…로 시작하는 키"
              value={form.apiKey}
              onChange={(e) => set('apiKey', e.target.value)}
            />
          </label>
          <p className="note">
            <a href={GEMINI_KEY_URL} target="_blank" rel="noopener noreferrer">
              Google AI Studio
            </a>
            에서 무료로 받을 수 있어요. 키는 이 브라우저에만 저장돼요. 무료 키로 한 대화는 구글이 서비스 개선에 쓸 수
            있으니 개인정보는 말하지 마세요.
          </p>
          <label className="field">
            <span>모델 이름</span>
            <input name="model" autoComplete="off" value={form.model} onChange={(e) => set('model', e.target.value)} />
          </label>
          <p className="note">
            "모델을 찾을 수 없어요"가 뜨면 여기를 바꾸세요. 예: gemini-3.5-flash-lite(빠름), gemini-3.8-flash(더 똑똑함)
          </p>
        </fieldset>

        <fieldset>
          <legend>내 사용설명서</legend>
          <p className="note">수준은 교육과정 단계로 정해져요. 시작 화면의 "교육과정"에서 바꿀 수 있어요.</p>
          <label className="field">
            <span>좋아하는 것</span>
            <input
              name="likes"
              placeholder="예: 커피, 여행, 업무 자동화, 드라마"
              value={form.likes}
              onChange={(e) => set('likes', e.target.value)}
            />
          </label>
          <label className="field">
            <span>하루에 쓸 시간(분)</span>
            <input
              type="number"
              name="minutes"
              min={3}
              max={120}
              step={1}
              value={form.minutes}
              onChange={(e) => set('minutes', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>따라 말하기 양</span>
            <select name="repeatAmount" value={form.repeatAmount} onChange={(e) => set('repeatAmount', e.target.value)}>
              {REPEAT_AMOUNTS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </fieldset>

        <fieldset>
          <legend>친구</legend>
          <label className="field">
            <span>이름</span>
            <input name="friendName" maxLength={20} value={form.friendName} onChange={(e) => set('friendName', e.target.value)} />
          </label>
          <label className="field">
            <span>성격</span>
            <input name="friendStyle" maxLength={40} value={form.friendStyle} onChange={(e) => set('friendStyle', e.target.value)} />
          </label>
        </fieldset>

        <fieldset>
          <legend>소리와 글자</legend>
          <label className="field">
            <span>
              영어 말 속도: <b>{Number(form.rate).toFixed(2)}</b>
            </span>
            <input
              type="range"
              name="rate"
              min={0.6}
              max={1.1}
              step={0.05}
              value={form.rate}
              onChange={(e) => set('rate', Number(e.target.value))}
            />
          </label>
          <label className="field">
            <span>영어 목소리</span>
            <span className="inline">
              <select name="voiceName" id="voiceSelect" value={voiceValue} onChange={(e) => set('voiceName', e.target.value)}>
                <option value="">자동으로 고르기</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <button className="mini" type="button" onClick={() => onTestVoice(voiceValue, Number(form.rate))}>
                들어보기
              </button>
            </span>
          </label>
          <p className="note">엣지 브라우저라면 이름에 "Natural"이 붙은 목소리가 더 자연스러워요.</p>
          <label className="check">
            <input type="checkbox" name="showKo" checked={form.showKo} onChange={(e) => set('showKo', e.target.checked)} />
            한국어 뜻 바로 보이기 (끄면 눌러야 보여요)
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
        </fieldset>

        <div className="actions">
          <button className="secondary" id="btnSettingsCancel" type="button" onClick={onClose}>
            닫기
          </button>
          <button className="primary" type="submit">
            저장
          </button>
        </div>
      </form>
    </section>
  )
}
