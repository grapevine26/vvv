import { Eye } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { useLatestRef } from '../hooks/useLatestRef'
import { diffWords } from '../lib/pronounce'

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

// 발음 피드백: 목표 문장에서 안 들린 단어를 표시한다. 다 들렸으면 아무것도 그리지 않는다
export function WordMarks({ goal, said }: { goal: string; said: string }) {
  const marks = diffWords(goal, said)
  if (marks.every((m) => m.ok)) return null
  return (
    <div className="word-marks" lang="en">
      <span className="wm-label" lang="ko">
        덜 들린 단어:
      </span>{' '}
      {marks.map((m, i) => (
        <span key={i} className={m.ok ? 'wm ok' : 'wm miss'}>
          {m.word}
          {m.ok ? '' : <span className="sr-only"> (안 들림)</span>}
        </span>
      ))}
    </div>
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

interface SheetProps {
  id: string
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  // 제목 줄 오른쪽 (예: '2 / 4 문제')
  side?: ReactNode
  // 창으로 띄우지 않고 탭 화면 안에 그린다 (복습·퀴즈 탭)
  page?: boolean
}

// 탭 화면 안에 그리는 창: 제목 줄과 아래 버튼만 같은 모양
function PageSheet({ id, title, onClose, children, footer, side }: SheetProps) {
  return (
    <section className="screen page-sheet" id={id} aria-labelledby={`${id}-title`}>
      <div className="sheet-head">
        <button type="button" className="sheet-x" aria-label="홈으로 가기" onClick={onClose}>
          ‹ 홈
        </button>
        <h2 id={`${id}-title`} tabIndex={-1}>
          {title}
        </h2>
        <span className="sheet-side">{side}</span>
      </div>
      <div className="page-body">{children}</div>
      {footer && <div className="actions">{footer}</div>}
    </section>
  )
}

export function Sheet(props: SheetProps) {
  return props.page ? <PageSheet {...props} /> : <DialogSheet {...props} />
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
function DialogSheet({ id, title, onClose, children, footer, side }: SheetProps) {
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
          <button type="button" className="sheet-x" aria-label="닫기" onClick={onClose}>
            ‹ 뒤로
          </button>
          <h2 id={`${id}-title`} tabIndex={-1} ref={titleRef}>
            {title}
          </h2>
          <span className="sheet-side">{side}</span>
        </div>
        {children}
        {footer && <div className="actions">{footer}</div>}
      </div>
    </section>
  )
}
