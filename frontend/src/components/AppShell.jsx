import { useEffect, useState } from 'react'
import Sidebar from './Sidebar'

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  )
}

export default function AppShell({ title, subtitle, actions, children }) {
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!mobileOpen) return undefined
    const onKeyDown = event => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen])

  return (
    <div className="app-layout">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className={`sidebar-backdrop${mobileOpen ? ' open' : ''}`} onClick={() => setMobileOpen(false)} />
      <div className="main-content">
        <header className="page-header">
          <div className="page-heading">
            <button
              type="button"
              className="mobile-menu-btn"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <MenuIcon />
            </button>
            <div>
              <h2 className="page-title">{title}</h2>
              {subtitle && <p className="page-subtitle">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </header>
        <main className="page-body fade-in-up">{children}</main>
      </div>
    </div>
  )
}
