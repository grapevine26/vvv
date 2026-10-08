import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useLatestRef } from '../hooks/useLatestRef'
import type { Pair } from '../lib/types'

interface MiniButtonProps {
  label: string
  onClick: () => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
  id?: string
}

// 말풍선 클릭(가림 해제)과 겹치지 않게 클릭을 위로 전달하지 않는다
export function MiniButton({ label, onClick, ariaLabel, disabled, className, id }: MiniButtonProps) {
  return (
    <button
      type="button"
      id={id}
      className={`mini${className ? ' ' + className : ''}`}
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

// 설정에서 "뜻 바로 보이기"를 끄면 가려 두고, '👀 뜻 보기'를 누르면 보여 준다
export function Meaning({ text, conceal }: { text: string; conceal: boolean }) {
  const [hidden, setHidden] = useState(conceal)
  if (!hidden) return <div className="meaning">{text}</div>
  return (
    <button
      type="button"
      className="meaning concealed"
      aria-expanded={false}
      onClick={(e) => {
        e.stopPropagation()
        setHidden(false)
      }}
    >
      <span className="blurred" aria-hidden="true">
        {text}
      </span>
      <span className="reveal-tag">👀 뜻 보기</span>
    </button>
  )
}

interface ChipRowProps {
  label: string
  items: Pair[]
  kind: 'hint' | 'word'
  picked?: string
  onPick: (item: Pair) => void
}

export function ChipRow({ label, items, kind, picked, onPick }: ChipRowProps) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="chips">
        {items.map((item) => (
          <button
            key={item.en}
            type="button"
            className={`chip ${kind}${picked === item.en ? ' picked' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              onPick(item)
            }}
          >
            <span className="c-en" lang="en">
              {item.en}
            </span>
            <span className="c-ko">{item.ko}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

interface SheetProps {
  id: string
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

// 아래에서 올라오는 창: ✕·바깥 누르기·Esc로 닫고, 열리면 제목으로 포커스, 닫히면 원래 자리로 돌려준다
export function Sheet({ id, title, onClose, children, footer }: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const onCloseRef = useLatestRef(onClose)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    // 안쪽 칸이 이미 포커스를 가져갔으면(예: 키 입력칸) 그대로 둔다
    if (!sheetRef.current?.contains(document.activeElement)) titleRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (before && document.contains(before)) before.focus()
    }
  }, [onCloseRef])

  return (
    <section
      className="sheet"
      id={id}
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="sheet-card">
        <div className="sheet-head">
          <h2 id={`${id}-title`} tabIndex={-1} ref={titleRef}>
            {title}
          </h2>
          <button type="button" className="icon-btn sheet-x" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="actions">{footer}</div>}
      </div>
    </section>
  )
}
