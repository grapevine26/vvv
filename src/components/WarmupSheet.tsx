import type { Stage, Unit } from '../lib/types'
import { Sheet } from './common'
import type { Mic, Play } from './WrapSheet'

// 1) 기초 틀 연습: 대화 전에 오늘 단원의 문장 틀 몇 개를 듣고·따라 하고·단어를 바꿔 말해 본다
export interface WarmupProps {
  stage: Stage
  unit: Unit
  onPlay: Play
  onMic: Mic
  // 연습을 마치고 바로 대화 시작
  onDone: () => void
  onClose: () => void
}

export function WarmupSheet({ unit, onDone, onClose }: WarmupProps) {
  return (
    <Sheet
      id="warmupSheet"
      title="대화 전 2분 연습"
      onClose={onClose}
      footer={
        <button className="primary" id="btnWarmupDone" type="button" onClick={onDone}>
          대화 시작하기
        </button>
      }
    >
      <p className="muted">「{unit.title}」 준비 중</p>
    </Sheet>
  )
}
