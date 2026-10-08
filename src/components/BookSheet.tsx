import { splitByScript } from '../lib/text'
import type { TransferData } from '../lib/transfer'
import type { LearnedItem, Progress, Segment, Settings } from '../lib/types'
import { MiniButton } from './common'
import { TransferBox } from './TransferBox'

interface Props {
  learned: LearnedItem[]
  settings: Settings
  progress: Progress
  onPlay: (segments: Segment[]) => void
  onImport: (data: TransferData) => { added: number; total: number }
  onClear: () => void
  onClose: () => void
}

export function BookSheet({ learned, settings, progress, onPlay, onImport, onClear, onClose }: Props) {
  return (
    <section className="sheet" id="bookSheet">
      <div className="sheet-card">
        <h2>내 문장장</h2>
        <div id="bookBody">
          {learned.length === 0 ? (
            <p className="muted">아직 저장된 문장이 없어요. 대화를 끝낼 때 "저장하고 끝내기"를 누르면 여기에 모여요.</p>
          ) : (
            <>
              <p className="note">모두 {learned.length}문장 · 최근 것부터</p>
              {learned
                .slice()
                .reverse()
                .map((s) => (
                  <div className="card" key={s.en}>
                    <div className="repeat-line">
                      <span className="repeat-text">{s.en}</span>
                      <MiniButton label="🔊" ariaLabel="듣기" onClick={() => onPlay(splitByScript(s.en))} />
                    </div>
                    {s.ko && <div className="meaning">{s.ko}</div>}
                    {s.date && <div className="book-date">{s.date}</div>}
                  </div>
                ))}
            </>
          )}
        </div>
        <TransferBox learned={learned} settings={settings} progress={progress} onImport={onImport} />
        <div className="actions">
          {learned.length > 0 && (
            <button className="secondary" id="btnBookClear" type="button" onClick={onClear}>
              모두 지우기
            </button>
          )}
          <button className="primary" id="btnBookClose" type="button" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </section>
  )
}
