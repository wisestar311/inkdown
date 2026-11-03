import { useEffect, useRef, useState } from 'react'

export type MenuItem =
  | { divider: true }
  | { label: string; shortcut?: string; action: () => void; checked?: boolean; disabled?: boolean }

export interface Menu {
  label: string
  items: MenuItem[]
}

export function MenuBar({ menus, title }: { menus: Menu[]; title: string }) {
  const [open, setOpen] = useState<number | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open === null) return
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <header className="menubar" ref={barRef}>
      <nav className="menus">
        {menus.map((menu, i) => (
          <div key={menu.label} className="menu">
            <button
              className={`menu-button ${open === i ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                setOpen(open === i ? null : i)
              }}
              onMouseEnter={() => open !== null && setOpen(i)}
            >
              {menu.label}
            </button>
            {open === i && (
              <div className="menu-dropdown" role="menu">
                {menu.items.map((item, j) =>
                  'divider' in item ? (
                    <div key={j} className="menu-divider" />
                  ) : (
                    <button
                      key={j}
                      role="menuitem"
                      className="menu-item"
                      disabled={item.disabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpen(null)
                        item.action()
                      }}
                    >
                      <span className="check">{item.checked ? '✓' : ''}</span>
                      <span className="label">{item.label}</span>
                      {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="window-title">{title}</div>
    </header>
  )
}
