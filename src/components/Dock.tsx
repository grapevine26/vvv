import { DockIcon, type DockIconName } from './icons'

export type Tab = 'home' | 'chat' | 'practice' | 'library'

const TABS: { tab: Tab; label: string; icon: DockIconName }[] = [
  { tab: 'home', label: '홈', icon: 'home' },
  { tab: 'chat', label: '대화', icon: 'chat' },
  { tab: 'practice', label: '복습·퀴즈', icon: 'practice' },
  { tab: 'library', label: '내 서재', icon: 'library' },
]

// 아래 4칸 독: 홈 · 대화 · 복습·퀴즈 · 내 서재
export function Dock({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav id="bottom-dock" className="bottom-dock" aria-label="아래 메뉴">
      {TABS.map((t) => {
        const active = t.tab === tab
        return (
          <button
            key={t.tab}
            type="button"
            id={`tab-${t.tab}`}
            className={`dock-btn${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onTab(t.tab)}
          >
            <span className="dock-icon-wrap">
              <DockIcon name={t.icon} bold={active} />
            </span>
            <span className="dock-label">{t.label}</span>
            {t.tab === 'chat' && <span className="dock-dot" aria-hidden="true" />}
          </button>
        )
      })}
    </nav>
  )
}
