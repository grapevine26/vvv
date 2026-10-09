import type { LearnedItem, Settings } from '../lib/types'
import { Sheet } from './common'
import type { Mic, Play } from './WrapSheet'

// 2) 5분 복습 퀴즈: 문장장 문장으로 듣고 뜻 고르기·뜻 보고 말하기·단어 순서 맞추기
export interface QuizProps {
  learned: LearnedItem[]
  settings: Settings
  onPlay: Play
  onMic: Mic
  onClose: () => void
}

export function QuizSheet({ learned, onClose }: QuizProps) {
  return (
    <Sheet id="quizSheet" title="5분 복습 퀴즈" onClose={onClose}>
      <p className="muted">준비 중 ({learned.length}문장)</p>
    </Sheet>
  )
}
