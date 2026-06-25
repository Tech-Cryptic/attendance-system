import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useState, useEffect } from 'react'
import { getPendingCount } from '../lib/db/queries'

// ── Icons (inline SVG, no external icon library needed) ─────────
const Icons = {
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  users: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  book: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
  scan: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
      <rect x="7" y="7" width="10" height="10" rx="1"/>
    </svg>
  ),
  alert: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  export: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  ),
  logout: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  history: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 0 .5-4.5"/>
      <polyline points="3 3 3 9 9 9"/>
    </svg>
  ),
  face: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  ),
}

// ── Nav config per role ─────────────────────────────────────────
const navConfig = {
  admin: [
    { to: '/admin',           label: 'Dashboard',   icon: Icons.dashboard },
    { to: '/admin/courses',   label: 'Courses',     icon: Icons.book },
    { to: '/admin/students',  label: 'Students',    icon: Icons.users },
    { to: '/admin/tokens',    label: 'Tokens',      icon: Icons.scan },
    { to: '/admin/conflicts', label: 'Conflicts',   icon: Icons.alert },
    { to: '/admin/export',    label: 'Export',      icon: Icons.export },
  ],
  lecturer: [
    { to: '/lecturer',              label: 'Dashboard',  icon: Icons.dashboard },
    { to: '/lecturer/session/new',  label: 'New Session',icon: Icons.scan },
    { to: '/lecturer/history',      label: 'History',    icon: Icons.history },
    { to: '/lecturer/export',       label: 'Export',     icon: Icons.export },
  ],
  student: [
    { to: '/student',              label: 'Dashboard',  icon: Icons.dashboard },
    { to: '/student/attendance',   label: 'Mark Attendance', icon: Icons.face },
    { to: '/enroll',               label: 'Re-Enroll',  icon: Icons.scan },
  ],
}

// ── Face icon for logo ──────────────────────────────────────────
function LogoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  )
}

export default function Sidebar({ mobileOpen, onClose }) {
  const { user, logout, isAdmin, isLecturer } = useAuth()
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)

  // Poll pending sync count every 5s
  useEffect(() => {
    const update = async () => {
      try { setPendingCount(await getPendingCount()) } catch {}
    }
    update()
    const id = setInterval(update, 5000)
    return () => clearInterval(id)
  }, [])

  const navItems = navConfig[user?.role] ?? []

  async function handleLogout() {
    await logout(false) // keep local data on shared devices by default
    navigate('/login')
  }

  return (
    <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`} role="navigation" aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <LogoIcon />
        </div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>FaceAttend</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {user?.role ?? 'System'}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/admin' || item.to === '/lecturer' || item.to === '/student'}
            className={({ isActive }) => `sidebar-nav-item${isActive ? ' active' : ''}`}
            onClick={onClose}
          >
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer: sync status + user + logout */}
      <div className="sidebar-footer">
        {/* Offline sync indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '12px', color: 'var(--text-muted)' }}>
          <div className={`sync-dot ${pendingCount > 0 ? 'offline' : 'online'}`} />
          {pendingCount > 0 ? `${pendingCount} record${pendingCount > 1 ? 's' : ''} pending sync` : 'All synced'}
        </div>

        {/* User info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--accent-muted)',
            border: '1px solid var(--accent-border)',
            display: 'grid', placeItems: 'center',
            fontSize: 'var(--text-sm)', fontWeight: 700,
            color: 'var(--accent)',
            flexShrink: 0,
          }}>
            {user?.full_name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.full_name ?? 'Unknown'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email ?? ''}
            </div>
          </div>
        </div>

        <button id="btn-logout" className="btn btn-ghost btn-full btn-sm" onClick={handleLogout}>
          {Icons.logout}
          Sign Out
        </button>
      </div>
    </aside>
  )
}
