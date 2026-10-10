import { ArrowLeftRight, Repeat, Snail, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { pickReview } from '../lib/prompt'
import { localDate, splitByScript } from '../lib/text'
import type { LearnedItem } from '../lib/types'
import { MiniButton, Sheet } from './common'
import { ReadCard, WriteBox, type Check, type Mic, type Play } from './WrapSheet'

interface Props {
  learned: LearnedItem[]
  // 시작 화면의 '하러 가기'로 열면 바로 복습 화면
  initialReview?: boolean
  onPlay: Play
  onMic: Mic
  onCheck: Check
  onToast: (text: string) => void
  onTransfer: () => void
  onClear: () => void
  onClose: () => void
}

const PAGE = 20
const REVIEW_COUNT = 5

export function BookSheet({ learned, initialReview, onPlay, onMic, onCheck, onToast, onTransfer, onClear, onClose }: Props) {
  const [reviewing, setReviewing] = useState(!!initialReview && learned.length > 0)
  const [shown, setShown] = useState(PAGE)
  const recentFirst = learned.slice().reverse()
  // 오늘 복습: 최근 문장과 잊을 때쯤 된 문장을 섞어 5개
  const review = pickReview(learned, localDate(), REVIEW_COUNT)

  return (
    <Sheet
      id="bookSheet"
      title={reviewing ? '오늘 복습' : '내 문장 노트'}
      onClose={onClose}
      footer={
        reviewing ? (
          <button className="primary" id="btnReviewDone" type="button" onClick={() => setReviewing(false)}>
            목록으로
          </button>
        ) : (
          <button className="primary" id="btnBookClose" type="button" onClick={onClose}>
            닫기
          </button>
        )
      }
    >
      {reviewing ? (
        <div id="reviewBody">
          <p className="note">듣고 → 소리 내어 읽고 → 뜻 보고 써 보세요. 대화 없이 5분이면 돼요.</p>
          {review.map((c) => (
            <ReadCard key={c.en} card={c} onPlay={onPlay} onMic={onMic} />
          ))}
          <h3>뜻 보고 써 보기</h3>
          <WriteBox cards={review} onPlay={onPlay} onCheck={onCheck} onToast={onToast} />
        </div>
      ) : (
        <div id="bookBody">
          {learned.length === 0 ? (
            <p className="muted">
              아직 저장된 문장이 없어요. 대화를 끝낼 때 "저장하고 끝내기"를 누르면 여기에 모여요. 다른 기기에서 쓰던 문장은
              아래 "폰↔PC 옮기기"로 가져올 수 있어요.
            </p>
          ) : (
            <>
              <button className="primary wide" id="btnReview" type="button" onClick={() => setReviewing(true)}>
                <Repeat className="ico" aria-hidden="true" />
                오늘 복습 {Math.min(REVIEW_COUNT, learned.length)}문장
              </button>
              <p className="note">모두 {learned.length}문장 · 최근 것부터</p>
              {recentFirst.slice(0, shown).map((s) => (
                <div className="card" key={s.en}>
                  <div className="repeat-line">
                    <span className="repeat-text" lang="en">
                      {s.en}
                    </span>
                    <MiniButton label="" icon={<Volume2 className="ico" aria-hidden="true" />} ariaLabel={`${s.en} 듣기`} onClick={() => onPlay(splitByScript(s.en))} />
                    <MiniButton label="" icon={<Snail className="ico" aria-hidden="true" />} ariaLabel={`${s.en} 천천히 듣기`} onClick={() => onPlay(splitByScript(s.en), true)} />
                  </div>
                  {s.ko && <div className="meaning">{s.ko}</div>}
                  {s.date && <div className="book-date">{s.date}</div>}
                </div>
              ))}
              {shown < learned.length && (
                <button className="secondary wide" id="btnBookMore" type="button" onClick={() => setShown((n) => n + PAGE)}>
                  더 보기 ({learned.length - shown}문장 남음)
                </button>
              )}
            </>
          )}
          <div className="book-links">
            <button className="link" id="btnBookTransfer" type="button" onClick={onTransfer}>
              <ArrowLeftRight className="ico" aria-hidden="true" />
              폰↔PC 옮기기
            </button>
            {learned.length > 0 && (
              <button className="link danger" id="btnBookClear" type="button" onClick={onClear}>
                내 문장 노트 모두 지우기
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
