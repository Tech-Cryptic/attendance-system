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
  const [fallbackSessions, setFallbackSessions] = useState([])
  const [fallbackQRs, setFallbackQRs] = useState({})
  const [courseStats, setCourseStats] = useState([])

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
        const res = await fetch(`${API_BASE}/student/fallback-sessions`, { headers: authHeaders(token) })
        if (res.ok) {
          const sessions = await res.json()
          setFallbackSessions(sessions)
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
                color: { dark: '#0f0f0e', light: '#ffffff' },
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
  const atRiskCourses   = courseStats.filter(c => {
    const pct = c.total > 0 ? (c.present / c.total) * 100 : 100
    return pct < 75
  })

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <div>
            <h2 style={{ margin: 0 }}>{user?.full_name}</h2>
            {user?.matric_number && (
              <p className="font-mono text-muted" style={{ marginTop: '2px', fontSize: 'var(--text-xs)' }}>
                {user.matric_number}
              </p>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
              <div className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </div>
            {pending > 0 && <span className="badge badge-warning">{pending} queued</span>}
            <span className="badge badge-brand">Student</span>
          </div>
        </header>

        <div className="page-body fade-in-up">

          {/* ── At-risk warning — surfaces immediately, not buried ── */}
          {atRiskCourses.length > 0 && (
            <div className="alert alert-danger" style={{ marginBottom: 'var(--sp-5)' }}>
              <strong>{atRiskCourses.length} course{atRiskCourses.length > 1 ? 's' : ''}</strong> below 75% attendance.
              {' '}You may be barred from examinations.
            </div>
          )}

          {/* ── Offline queue warning ── */}
          {pending > 0 && (
            <div className="alert alert-warning" style={{ marginBottom: 'var(--sp-5)' }}>
              <strong>{pending}</strong> attendance record{pending > 1 ? 's' : ''} queued offline.
              {isOnline ? ' Syncing now…' : ' Will sync automatically when you reconnect.'}
            </div>
          )}

          {/* ── Metrics: inline row, no emoji pedestals ── */}
          <div className="metric-row">
            <div className="metric-item">
              <div className="metric-value" style={{ color: 'var(--accent)' }}>
                {loading ? '—' : coursesEnrolled}
              </div>
              <div className="metric-label">Courses enrolled</div>
            </div>
            <div className="metric-item">
              <div className="metric-value">{loading ? '—' : totalSessions}</div>
              <div className="metric-label">Sessions attended</div>
            </div>
            <div className="metric-item">
              <div className="metric-value" style={{ color: pending > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                {pending}
              </div>
              <div className="metric-label">Pending sync</div>
            </div>
            <div className="metric-item">
              <div className="metric-value" style={{ color: atRiskCourses.length > 0 ? 'var(--danger)' : 'var(--success)' }}>
                {loading ? '—' : atRiskCourses.length}
              </div>
              <div className="metric-label">At-risk courses</div>
            </div>
          </div>

          {/* ── Fallback QR — shown only when lecturer releases it ── */}
          {fallbackSessions.length > 0 && fallbackSessions.map(s => (
            <div key={s.session_id} style={{
              background: 'var(--warning-bg)',
              border: '1px solid var(--warning-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--sp-5)',
              marginBottom: 'var(--sp-5)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-1)' }}>
                <span className="badge badge-warning">Fallback QR</span>
                <span className="font-mono text-sm">{s.course_code}</span>
                <span className="text-muted text-sm">· Session {s.session_id?.slice(0, 8)}</span>
              </div>
              <p className="text-sm" style={{ margin: '0 0 var(--sp-4)', color: 'var(--text-secondary)' }}>
                The face scan did not detect you. Show this QR to your lecturer to confirm
                you are physically present. Expires in {s.minutes_remaining} min.
              </p>
              <div style={{ display: 'flex', gap: 'var(--sp-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                {fallbackQRs[s.session_id] && (
                  <div className="qr-box">
                    <img src={fallbackQRs[s.session_id]} alt="Fallback QR" width={140} height={140} />
                  </div>
                )}
                <button
                  onClick={() => claimFallback(s.session_id)}
                  className="btn btn-ghost"
                  style={{ borderColor: 'var(--warning-border)', color: 'var(--warning)', alignSelf: 'flex-end' }}
                >
                  Confirm present (fallback)
                </button>
              </div>
            </div>
          ))}

          {/* ── Course attendance bars ── */}
          {courseStats.length > 0 && (
            <div className="card" style={{ marginBottom: 'var(--sp-5)', padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border-subtle)' }}>
                <h4 style={{ margin: 0 }}>Attendance by course</h4>
              </div>
              {courseStats.map(c => {
                const pct   = c.total > 0 ? Math.round((c.present / c.total) * 100) : 0
                const atRisk = pct < 75
                return (
                  <div key={c.course_code} style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                    padding: 'var(--sp-3) var(--sp-5)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}>
                    <span className="badge badge-brand font-mono" style={{ minWidth: 80, justifyContent: 'center' }}>
                      {c.course_code}
                    </span>
                    <div style={{ flex: 1, background: 'var(--border-subtle)', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: atRisk ? 'var(--danger)' : 'var(--accent)',
                        borderRadius: 2, transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ minWidth: 44, fontWeight: 700, fontSize: 'var(--text-sm)', color: atRisk ? 'var(--danger)' : 'var(--text-primary)', textAlign: 'right' }}>
                      {pct}%
                    </span>
                    {atRisk && <span className="badge badge-danger">At risk</span>}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Quick actions — plain, no card wrapper ── */}
          <div style={{ display: 'flex', gap: 'var(--sp-3)', marginBottom: 'var(--sp-5)', flexWrap: 'wrap' }}>
            <Link to="/enroll" className="btn btn-ghost">Re-enroll face</Link>
            <Link to="/student/qr" className="btn btn-ghost">My QR code</Link>
          </div>

          {/* ── Attendance history ── */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border-subtle)' }}>
              <h4 style={{ margin: 0 }}>Attendance history</h4>
            </div>
            {loading ? (
              <div style={{ padding: 'var(--sp-10)', textAlign: 'center' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </div>
            ) : attendance.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-label">No records yet</span>
                <p>Scan a session QR in class to mark your first attendance.</p>
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Date &amp; Time</th><th>Course</th><th>Match confidence</th><th>Method</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {attendance.map((a, i) => (
                    <tr key={i}>
                      <td className="font-mono" style={{ fontSize: 'var(--text-xs)' }}>{new Date(a.matched_at).toLocaleString()}</td>
                      <td><span className="badge badge-brand font-mono">{a.course_code}</span></td>
                      <td>
                        <span style={{
                          fontWeight: 600,
                          fontSize: 'var(--text-sm)',
                          color: a.similarity_distance < 0.35 ? 'var(--success)' : 'var(--warning)',
                        }}>
                          {a.method === 'fallback_qr' ? '—' : `${((1 - (a.similarity_distance ?? 0)) * 100).toFixed(1)}%`}
                        </span>
                      </td>
                      <td>
                        {a.method === 'batch_face'      && <span className="badge badge-brand">Face scan</span>}
                        {a.method === 'fallback_qr'     && <span className="badge badge-warning">Fallback QR</span>}
                        {a.method === 'manual_override' && <span className="badge badge-danger">Manual</span>}
                        {!a.method                      && <span className="badge badge-success">Live</span>}
                      </td>
                      <td>
                        {a.synced_from_client
                          ? <span className="badge badge-info">Synced</span>
                          : <span className="badge badge-success">Live</span>
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
