import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../../components/AppShell'
import { useAuth } from '../../context/AuthContext'
import { onSyncEvent, getPendingCount } from '../../lib/sync/syncQueue'
import { getPresencePendingCount } from '../../lib/presence'
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
      } catch { setAttendance([]); setCourseStats([]) }
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
                color: { dark: '#17211f', light: '#ffffff' },
              })
              setFallbackQRs(prev => ({ ...prev, [s.session_id]: url }))
            }
          }
        }
      } catch { setFallbackSessions([]) }
    }

    if (token) {
      load()
      checkFallback()
    }

    async function refreshPending() {
      setPending((await getPendingCount()) + (await getPresencePendingCount()))
    }
    refreshPending()
    const unsub = onSyncEvent(refreshPending)

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
    } catch { return }
  }

  const totalSessions   = attendance.length
  const coursesSet      = new Set(attendance.map(a => a.course_code))
  const coursesEnrolled = coursesSet.size
  const atRiskCourses   = courseStats.filter(c => {
    const pct = c.total > 0 ? (c.present / c.total) * 100 : 100
    return pct < 75
  })

  return (
    <AppShell
      title={user?.full_name}
      subtitle={user?.matric_number}
      actions={
        <div className="header-status">
          <div className="connection-status">
            <div className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </div>
          {pending > 0 && <span className="badge badge-warning">{pending} queued</span>}
          <span className="badge badge-info">Student</span>
        </div>
      }
    >
      <div className="stack-lg">
        {atRiskCourses.length > 0 && (
          <div className="alert alert-danger">
            <strong>{atRiskCourses.length} course{atRiskCourses.length > 1 ? 's' : ''}</strong> below 75% attendance.
            {' '}You may be barred from examinations.
          </div>
        )}

        {pending > 0 && (
          <div className="alert alert-warning">
            <strong>{pending}</strong> attendance record{pending > 1 ? 's' : ''} queued offline.
            {isOnline ? ' Syncing now...' : ' Will sync automatically when you reconnect.'}
          </div>
        )}

        <div className="metric-row">
          <div className="metric-item">
            <div className="metric-value text-brand">{loading ? '...' : coursesEnrolled}</div>
            <div className="metric-label">Courses enrolled</div>
          </div>
          <div className="metric-item">
            <div className="metric-value">{loading ? '...' : totalSessions}</div>
            <div className="metric-label">Sessions attended</div>
          </div>
          <div className="metric-item">
            <div className={`metric-value ${pending > 0 ? 'text-warning' : 'text-muted'}`}>{pending}</div>
            <div className="metric-label">Pending sync</div>
          </div>
          <div className="metric-item">
            <div className={`metric-value ${loading ? '' : atRiskCourses.length > 0 ? 'text-danger' : 'text-success'}`}>
              {loading ? '...' : atRiskCourses.length}
            </div>
            <div className="metric-label">At-risk courses</div>
          </div>
        </div>

        {fallbackSessions.length > 0 && fallbackSessions.map(s => (
          <div key={s.session_id} className="panel stack">
            <div className="inline-meta">
              <span className="badge badge-warning">Fallback QR</span>
              <span className="font-mono text-sm">{s.course_code}</span>
              <span className="text-muted text-sm">Session {s.session_id?.slice(0, 8)}</span>
            </div>
            <p className="text-sm text-secondary">
              The face scan did not detect you. Show this QR to your lecturer to confirm
              you are physically present. Expires in {s.minutes_remaining} min.
            </p>
            <div className="toolbar">
              {fallbackQRs[s.session_id] && (
                <div className="qr-box">
                  <img src={fallbackQRs[s.session_id]} alt="Fallback QR" width={140} height={140} />
                </div>
              )}
              <button onClick={() => claimFallback(s.session_id)} className="btn btn-ghost">
                Confirm present (fallback)
              </button>
            </div>
          </div>
        ))}

        {courseStats.length > 0 && (
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Progress</p>
                <h3 className="panel-title">Attendance by course</h3>
              </div>
            </div>
            <div className="table-wrapper">
              <table className="data-table data-table--wide">
                <thead><tr><th>Course</th><th>Attendance rate</th><th>Status</th></tr></thead>
                <tbody>
                  {courseStats.map(c => {
                    const pct   = c.total > 0 ? Math.round((c.present / c.total) * 100) : 0
                    const atRisk = pct < 75
                    return (
                      <tr key={c.course_code}>
                        <td><span className="badge badge-brand font-mono">{c.course_code}</span></td>
                        <td>
                          <div className="toolbar">
                            <div className="progress-track">
                              <div className="progress-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`font-semibold tabular text-sm ${atRisk ? 'text-danger' : ''}`}>{pct}%</span>
                          </div>
                        </td>
                        <td>
                          {atRisk
                            ? <span className="badge badge-danger">At risk</span>
                            : <span className="badge badge-success">On track</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="toolbar">
          <Link to="/student/attendance" className="btn btn-primary">Mark attendance</Link>
          <Link to="/enroll" className="btn btn-ghost">Re-enroll face</Link>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Records</p>
              <h3 className="panel-title">Attendance history</h3>
            </div>
          </div>
          {loading ? (
            <div className="loading-state">
              <div className="spinner" /> Loading attendance...
            </div>
          ) : attendance.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-label">No records yet</span>
              <p>Scan a session QR in class to mark your first attendance.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table data-table--wide">
                <thead>
                  <tr><th>Date and time</th><th>Course</th><th>Match confidence</th><th>Method</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {attendance.map((a, i) => (
                    <tr key={i}>
                      <td className="font-mono text-xs">{new Date(a.matched_at).toLocaleString()}</td>
                      <td><span className="badge badge-brand font-mono">{a.course_code}</span></td>
                      <td>
                        <span className={`font-semibold text-sm ${a.similarity_distance < 0.35 ? 'text-success' : 'text-warning'}`}>
                          {a.method === 'fallback_qr' ? 'N/A' : `${((1 - (a.similarity_distance ?? 0)) * 100).toFixed(1)}%`}
                        </span>
                      </td>
                      <td>
                        {a.method === 'batch_face'      && <span className="badge badge-brand">Face scan</span>}
                        {a.method === 'fallback_qr'     && <span className="badge badge-warning">Fallback QR</span>}
                        {a.method === 'manual_override' && <span className="badge badge-danger">Manual</span>}
                        {!a.method                      && <span className="badge badge-success">Live</span>}
                      </td>
                      <td>
                        {a.presence_status === 'present'        && <span className="badge badge-success">Present</span>}
                        {a.presence_status === 'exempted'       && <span className="badge badge-warning">Exempted</span>}
                        {a.presence_status === 'left_early'     && <span className="badge badge-danger">Left early</span>}
                        {a.presence_status === 'pending_review' && <span className="badge badge-warning">For review</span>}
                        {!a.presence_status && (
                          a.synced_from_client
                            ? <span className="badge badge-info">Synced</span>
                            : <span className="badge badge-success">Live</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
