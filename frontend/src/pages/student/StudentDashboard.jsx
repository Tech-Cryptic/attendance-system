import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { useAuth } from '../../context/AuthContext'
import { onSyncEvent, getPendingCount } from '../../lib/sync/syncQueue'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

export default function StudentDashboard() {
  const { user, token } = useAuth()

  const [attendance, setAttendance] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [pending,    setPending]    = useState(0)
  const [isOnline,   setIsOnline]   = useState(navigator.onLine)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/student/attendance`, { headers: authHeaders(token) })
        if (res.ok) setAttendance(await res.json())
      } catch {}
      finally { setLoading(false) }
    }
    if (token) load()

    // Track pending queue
    getPendingCount().then(setPending)
    const unsub = onSyncEvent(async () => setPending(await getPendingCount()))

    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      unsub()
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [token])

  const totalSessions   = attendance.length
  const coursesSet      = new Set(attendance.map(a => a.course_code))
  const coursesEnrolled = coursesSet.size

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Student Portal</h2>
            {user?.matric_number && (
              <p className="font-mono text-sm text-muted" style={{ marginTop: '2px' }}>{user.matric_number}</p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
              <div className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </div>
            {pending > 0 && <span className="badge badge-warning">{pending} queued</span>}
            <span className="badge badge-success">Student</span>
          </div>
        </header>

        <div className="page-body fade-in-up">
          {/* Welcome */}
          <div className="card" style={{ marginBottom: '20px', background: 'linear-gradient(135deg,rgba(16,185,129,0.1),rgba(6,182,212,0.06))', borderColor: 'rgba(16,185,129,0.3)' }}>
            <h3>Welcome, {user?.full_name} 👋</h3>
            <p className="text-secondary text-sm" style={{ marginTop: '6px' }}>
              Mark your attendance by scanning the QR code your lecturer displays in class.
            </p>
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
            <div className="stat-card card-glow">
              <div style={{ fontSize: '22px' }}>📚</div>
              <div className="stat-value" style={{ color: 'var(--brand-mid)' }}>{loading ? '…' : coursesEnrolled}</div>
              <div className="stat-label">Courses</div>
            </div>
            <div className="stat-card card-glow">
              <div style={{ fontSize: '22px' }}>✅</div>
              <div className="stat-value" style={{ color: 'var(--success)' }}>{loading ? '…' : totalSessions}</div>
              <div className="stat-label">Sessions Attended</div>
            </div>
            <div className="stat-card card-glow">
              <div style={{ fontSize: '22px' }}>{pending > 0 ? '⏳' : '☁️'}</div>
              <div className="stat-value" style={{ color: pending > 0 ? 'var(--warning)' : 'var(--info)' }}>{pending}</div>
              <div className="stat-label">Pending Sync</div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <h4 style={{ marginBottom: '14px' }}>Quick Actions</h4>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Link to="/student/attendance" className="btn btn-primary">📷 Mark Attendance</Link>
              <Link to="/enroll" className="btn btn-ghost">🔄 Re-Enroll Face</Link>
            </div>
          </div>

          {/* Offline queue warning */}
          {pending > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: '20px' }}>
              📶 You have <strong>{pending}</strong> attendance record{pending > 1 ? 's' : ''} queued offline.
              {isOnline ? ' Syncing now…' : ' They will sync automatically when you reconnect.'}
            </div>
          )}

          {/* Attendance history */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
              <h4 style={{ margin: 0 }}>Attendance History</h4>
            </div>
            {loading ? (
              <div style={{ padding: '40px', textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </div>
            ) : attendance.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
                <p>No attendance records yet.<br />Scan a session QR to mark your first attendance.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Date & Time</th><th>Course</th><th>Similarity</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {attendance.map((a, i) => (
                    <tr key={i}>
                      <td className="text-sm">{new Date(a.matched_at).toLocaleString()}</td>
                      <td><span className="badge badge-brand font-mono">{a.course_code}</span></td>
                      <td>
                        <span style={{ fontWeight: 600, color: a.similarity_distance < 0.35 ? 'var(--success)' : 'var(--warning)' }}>
                          {((1 - (a.similarity_distance ?? 0)) * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        {a.synced_from_client
                          ? <span className="badge" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}>📶 Synced</span>
                          : <span className="badge badge-success">✅ Live</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
