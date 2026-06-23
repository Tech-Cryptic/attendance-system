import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { useAuth } from '../../context/AuthContext'
import { onSyncEvent, getPendingCount } from '../../lib/sync/syncQueue'
import QRCode from 'qrcode'
import { API_BASE } from '../../lib/api'

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` }
}

export default function StudentDashboard() {
  const { user, token } = useAuth()

  const [attendance, setAttendance] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [pending,    setPending]    = useState(0)
  const [isOnline,   setIsOnline]   = useState(navigator.onLine)
  const [fallbackSessions, setFallbackSessions] = useState([])  // active sessions with fallback released
  const [fallbackQRs, setFallbackQRs] = useState({})            // sessionId -> QR data URL
  const [courseStats, setCourseStats] = useState([])            // per-course attendance %

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/student/attendance`, { headers: authHeaders(token) })
        if (res.ok) {
          const data = await res.json()
          setAttendance(data)
          buildCourseStats(data)
        }
      } catch {}
      finally { setLoading(false) }
    }

    async function checkFallback() {
      try {
        // Poll for active sessions where fallback is released and student is unmatched
        const res = await fetch(`${API_BASE}/student/fallback-sessions`, { headers: authHeaders(token) })
        if (res.ok) {
          const sessions = await res.json()
          setFallbackSessions(sessions)
          // Generate QR for each active fallback session
          for (const s of sessions) {
            if (!fallbackQRs[s.session_id]) {
              const payload = JSON.stringify({
                type: 'fallback_qr',
                session_id: s.session_id,
                matric: user?.matric_number,
                ts: Date.now(),
              })
              const url = await QRCode.toDataURL(payload, {
                width: 280, margin: 2,
                color: { dark: '#0a0a1a', light: '#ffffff' },
              })
              setFallbackQRs(prev => ({ ...prev, [s.session_id]: url }))
            }
          }
        }
      } catch {}
    }

    if (token) {
      load()
      checkFallback()
    }

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

  function buildCourseStats(records) {
    const map = {}
    for (const r of records) {
      if (!map[r.course_code]) map[r.course_code] = { course_code: r.course_code, present: 0, total: 0 }
      map[r.course_code].present++
      map[r.course_code].total++
    }
    setCourseStats(Object.values(map))
  }

  async function claimFallback(sessionId) {
    try {
      const res = await fetch(`${API_BASE}/attendance/fallback-claim`, {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, matric_number: user.matric_number }),
      })
      if (res.ok) {
        setFallbackSessions(prev => prev.filter(s => s.session_id !== sessionId))
        const res2 = await fetch(`${API_BASE}/student/attendance`, { headers: authHeaders(token) })
        if (res2.ok) setAttendance(await res2.json())
      }
    } catch {}
  }

  const totalSessions   = attendance.length
  const coursesSet      = new Set(attendance.map(a => a.course_code))
  const coursesEnrolled = coursesSet.size
  const atRiskCount     = courseStats.filter(c => {
    const pct = c.total > 0 ? (c.present / c.total) * 100 : 100
    return pct < 75
  }).length

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

          {/* Fallback QR — only shown when lecturer releases it for this student */}
          {fallbackSessions.length > 0 && fallbackSessions.map(s => (
            <div key={s.session_id} style={{
              background: 'linear-gradient(135deg,rgba(245,158,11,0.12),rgba(234,179,8,0.06))',
              border: '1px solid rgba(245,158,11,0.4)',
              borderRadius: 14,
              padding: 20,
              marginBottom: 20,
            }}>
              <h4 style={{ margin: '0 0 4px', color: '#fbbf24' }}>📱 Fallback QR Active</h4>
              <p className="text-sm text-muted" style={{ margin: '0 0 16px' }}>
                {s.course_code} — Session {s.session_id?.slice(0,8)}. Show this to your lecturer.
                Expires in {s.minutes_remaining} min.
              </p>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {fallbackQRs[s.session_id] && (
                  <div style={{ background: '#fff', borderRadius: 12, padding: 12 }}>
                    <img src={fallbackQRs[s.session_id]} alt="Fallback QR" width={160} height={160} />
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <p className="text-sm" style={{ color: '#fbbf24', marginBottom: 12 }}>
                    ⚠️ The face scan did not detect you. Show this QR to your lecturer who will
                    confirm you are physically present.
                  </p>
                  <button
                    onClick={() => claimFallback(s.session_id)}
                    style={{
                      background: '#f59e0b',
                      color: '#0f172a',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 20px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✅ Mark Me Present (Fallback)
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Quick actions */}
          <div className="card" style={{ marginBottom: '20px' }}>
            <h4 style={{ marginBottom: '14px' }}>Quick Actions</h4>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <Link to="/enroll" className="btn btn-ghost">🔄 Re-Enroll Face</Link>
              <Link to="/student/qr" className="btn btn-ghost">📲 My QR Code</Link>
            </div>
          </div>

          {/* At-risk warning */}
          {atRiskCount > 0 && (
            <div className="alert alert-danger" style={{ marginBottom: '20px' }}>
              ⚠️ <strong>{atRiskCount} course{atRiskCount > 1 ? 's' : ''}</strong> below the 75% attendance threshold.
              You may be barred from examinations. Attend more lectures.
            </div>
          )}

          {/* Offline queue warning */}
          {pending > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: '20px' }}>
              📶 You have <strong>{pending}</strong> attendance record{pending > 1 ? 's' : ''} queued offline.
              {isOnline ? ' Syncing now…' : ' They will sync automatically when you reconnect.'}
            </div>
          )}

          {/* Course attendance percentages */}
          {courseStats.length > 0 && (
            <div className="card" style={{ marginBottom: 20, padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                <h4 style={{ margin: 0 }}>Course Attendance</h4>
              </div>
              {courseStats.map(c => {
                const pct = c.total > 0 ? Math.round((c.present / c.total) * 100) : 0
                const atRisk = pct < 75
                return (
                  <div key={c.course_code} style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '12px 20px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    <span className="badge badge-brand font-mono">{c.course_code}</span>
                    <div style={{ flex: 1, background: 'var(--bg-card-alt)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: atRisk ? 'var(--danger)' : 'var(--success)', borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                    <span style={{ minWidth: 44, fontWeight: 700, color: atRisk ? 'var(--danger)' : 'var(--success)', fontSize: 13 }}>{pct}%</span>
                    {atRisk && <span className="badge" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 10 }}>AT RISK</span>}
                  </div>
                )
              })}
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
                  <tr><th>Date & Time</th><th>Course</th><th>Match</th><th>Method</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {attendance.map((a, i) => (
                    <tr key={i}>
                      <td className="text-sm">{new Date(a.matched_at).toLocaleString()}</td>
                      <td><span className="badge badge-brand font-mono">{a.course_code}</span></td>
                      <td>
                        <span style={{ fontWeight: 600, color: a.similarity_distance < 0.35 ? 'var(--success)' : 'var(--warning)' }}>
                          {a.method === 'fallback_qr' ? '—' : `${((1 - (a.similarity_distance ?? 0)) * 100).toFixed(1)}%`}
                        </span>
                      </td>
                      <td>
                        {a.method === 'batch_face' && <span className="badge" style={{ background: '#4f46e522', color: '#818cf8' }}>📸 Face Scan</span>}
                        {a.method === 'fallback_qr' && <span className="badge" style={{ background: '#f59e0b22', color: '#fbbf24' }}>📱 Fallback QR</span>}
                        {a.method === 'manual_override' && <span className="badge" style={{ background: '#ef444422', color: '#f87171' }}>🔧 Manual</span>}
                        {!a.method && <span className="badge badge-success">✅ Live</span>}
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
