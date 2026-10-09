import type { Progress } from '../lib/types'
import { Sheet } from './common'

// 5) 주간 성장 화면: 이번 주 공부 시간, 영어로 스스로 대답한 비율이 오르는 모습
export interface ProgressProps {
  progress: Progress
  today: string
  minutesGoal: number
  onClose: () => void
}

export function ProgressSheet({ onClose }: ProgressProps) {
  return (
    <Sheet id="progressSheet" title="이번 주 기록" onClose={onClose}>
      <p className="muted">준비 중</p>
    </Sheet>
  )
}
