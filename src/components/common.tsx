import { useState, type MouseEvent } from 'react'
import type { Pair } from '../lib/types'

interface MiniButtonProps {
  label: string
  onClick: () => void
  ariaLabel?: string
  disabled?: boolean
}

// 말풍선 클릭(가림 해제)과 겹치지 않게 클릭을 위로 전달하지 않는다
export function MiniButton({ label, onClick, ariaLabel, disabled }: MiniButtonProps) {
  return (
    <button
      type="button"
      className="mini"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

// 설정에서 "뜻 바로 보이기"를 끄면 흐리게 가렸다가 누르면 보여 준다
export function Meaning({ text, conceal }: { text: string; conceal: boolean }) {
  const [hidden, setHidden] = useState(conceal)
  return (
    <div
      className={`meaning${hidden ? ' concealed' : ''}`}
      title={hidden ? '눌러서 뜻 보기' : undefined}
      onClick={(e) => {
        if (!hidden) return
        e.stopPropagation()
        setHidden(false)
      }}
    >
      {text}
    </div>
  )
}

interface ChipRowProps {
  label: string
  items: Pair[]
  kind: 'hint' | 'word'
  onPlay: (en: string) => void
}

export function ChipRow({ label, items, kind, onPlay }: ChipRowProps) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="chips">
        {items.map((item) => (
          <button
            key={item.en}
            type="button"
            className={`chip ${kind}`}
            onClick={(e) => {
              e.stopPropagation()
              onPlay(item.en)
            }}
          >
            <span className="c-en">{item.en}</span>
            <span className="c-ko">{item.ko}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
