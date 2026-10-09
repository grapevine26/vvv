import { Eye, X } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useLatestRef } from '../hooks/useLatestRef'
import type { Pair } from '../lib/types'

interface MiniButtonProps {
  label: string
  // 글자 앞에 붙는 아이콘 (SVG). 글자 없이 아이콘만 쓰면 ariaLabel을 꼭 준다
  icon?: ReactNode
  onClick: () => void
  ariaLabel?: string
  disabled?: boolean
  className?: string
  id?: string
}

// 말풍선 클릭(가림 해제)과 겹치지 않게 클릭을 위로 전달하지 않는다
export function MiniButton({ label, icon, onClick, ariaLabel, disabled, className, id }: MiniButtonProps) {
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
      {icon}
      {label}
    </button>
  )
}

// 설정에서 "뜻 바로 보이기"를 끄면 가려 두고, '👀 뜻 보기'를 누르면 보여 준다
export function Meaning({ text, conceal }: { text: string; conceal: boolean }) {
  const [hidden, setHidden] = useState(conceal)
  const shownRef = useRef<HTMLDivElement>(null)
  // 키보드로 열었으면 드러난 뜻으로 포커스를 옮긴다 (버튼이 사라져 포커스를 잃지 않게)
  const focusShown = useRef(false)
  useEffect(() => {
    if (!hidden && focusShown.current) {
      focusShown.current = false
      shownRef.current?.focus()
    }
  }, [hidden])
  if (!hidden)
    return (
      <div className="meaning" ref={shownRef} tabIndex={-1}>
        {text}
      </div>
    )
  return (
    <button
      type="button"
      className="meaning concealed"
      aria-expanded={false}
      onClick={(e) => {
        e.stopPropagation()
        focusShown.current = document.activeElement === e.currentTarget
        setHidden(false)
      }}
    >
      <span className="blurred" aria-hidden="true">
        {text}
      </span>
      <span className="reveal-tag">
        <Eye className="ico" aria-hidden="true" />뜻 보기
      </span>
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

// 시트 밖에서 마지막으로 시트를 연 요소. 시트에서 다른 시트로 이어 열어도 처음 연 버튼으로 돌아간다
let sheetOpener: HTMLElement | null = null
function captureOpener(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null
  if (!a || a === document.body) sheetOpener = null
  else if (!a.closest('[role="dialog"]')) sheetOpener = a
  return sheetOpener
}

// 아래에서 올라오는 창: ✕·바깥 누르기·Esc로 닫고, 열리면 제목으로 포커스, 닫히면 원래 자리로 돌려준다
export function Sheet({ id, title, onClose, children, footer }: SheetProps) {
  const sheetRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const onCloseRef = useLatestRef(onClose)
  // 그리기 전에 잡아야 안쪽 칸의 autoFocus보다 먼저다
  const [opener] = useState(captureOpener)

  useEffect(() => {
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
      // 배경의 inert가 풀린 다음 프레임에, 다른 시트가 없고 포커스가 갈 곳을 잃었으면 처음 연 버튼으로
      requestAnimationFrame(() => {
        if (document.querySelector('[role="dialog"]')) return
        const a = document.activeElement
        if (a && a !== document.body && document.contains(a)) return
        if (opener && document.contains(opener)) opener.focus()
      })
    }
  }, [onCloseRef, opener])

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
            <X className="ico" aria-hidden="true" />
          </button>
        </div>
        {children}
        {footer && <div className="actions">{footer}</div>}
      </div>
    </section>
  )
}
