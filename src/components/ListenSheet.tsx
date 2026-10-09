import type { LearnedItem, Pair, Progress, Settings } from '../lib/types'
import { Sheet } from './common'
import type { Mic, Play } from './WrapSheet'

// 6) 듣고 따라 말하기(쉐도잉): AI가 내 수준의 짧은 이야기를 만들고, 한 문장씩 듣고 따라 말한다
export interface ListenProps {
  settings: Settings
  progress: Progress
  learned: LearnedItem[]
  onPlay: Play
  onMic: Mic
  // 문장장에 더하고, 새로 더한 개수를 돌려준다
  onSaveSentences: (pairs: Pair[]) => number
  // 키·모델 문제면 설정을 연다
  onNeedSettings: () => void
  onClose: () => void
}

export function ListenSheet({ onClose }: ListenProps) {
  return (
    <Sheet id="listenSheet" title="듣고 따라 말하기" onClose={onClose}>
      <p className="muted">준비 중</p>
    </Sheet>
  )
}
