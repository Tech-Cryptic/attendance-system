import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../lib/api'

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function LecturerDashboard({ defaultTab = 'overview' }) {
  const { user, token } = useAuth()
  const [tab, setTab]   = useState(defaultTab)
  useEffect(() => { setTab(defaultTab) }, [defaultTab])

  const [sessions, setSessions] = useState([])
  const [courses,  setCourses]  = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [sesRes, crsRes] = await Promise.all([
          fetch(`${API_BASE}/lecturer/sessions`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/lecturer/courses`,  { headers: authHeaders(token) }),
        ])
        if (sesRes.ok) setSessions(await sesRes.json())
        if (crsRes.ok) setCourses(await crsRes.json())
      } catch {}
      finally { setLoading(false) }
    }
    if (token) load()
  }, [token])

  const todaySessions = sessions.filter(
    s => new Date(s.started_at).toDateString() === new Date().toDateString()
  )
  const avgAttendance = sessions.length
    ? Math.round(sessions.reduce((a, s) => a + (s.attendance_count ?? 0), 0) / sessions.length)
    : 0

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <div>
            <h2 style={{ margin: 0 }}>{user?.full_name}</h2>
            <p className="text-muted" style={{ marginTop: '2px', fontSize: 'var(--text-xs)' }}>
              Lecturer · FaceAttend
            </p>
          </div>
          <span className="badge badge-info">Lecturer</span>
        </header>

        <div className="page-body fade-in-up">

          {/* ── Metrics: inline row ── */}
          <div className="metric-row">
            <div className="metric-item">
              <div className="metric-value" style={{ color: 'var(--accent)' }}>
                {loading ? '—' : todaySessions.length}
              </div>
              <div className="metric-label">Sessions today</div>
            </div>
            <div className="metric-item">
              <div className="metric-value">{loading ? '—' : sessions.length}</div>
              <div className="metric-label">Total sessions</div>
            </div>
            <div className="metric-item">
              <div className="metric-value">{loading ? '—' : avgAttendance}</div>
              <div className="metric-label">Avg attendance</div>
            </div>
            <div className="metric-item">
              <div className="metric-value" style={{ color: 'var(--accent)' }}>
                {loading ? '—' : courses.length}
              </div>
              <div className="metric-label">Courses assigned</div>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="tab-bar">
            {[['overview', 'Overview'], ['history', 'Session history'], ['export', 'Export']].map(([id, label]) => (
              <button key={id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>

              {/* Primary action — prominent, single, clear label */}
              <Link to="/lecturer/session/new" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                Start attendance session
              </Link>

              {/* Assigned courses */}
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <h4 style={{ margin: 0 }}>Your courses</h4>
                </div>
                {courses.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-state-label">No courses assigned</span>
                    <p>Ask an admin to assign courses to your account.</p>
                  </div>
                ) : (
                  <div>
                    {courses.map(c => (
                      <div key={c.course_code} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: 'var(--sp-3) var(--sp-5)',
                        borderBottom: '1px solid var(--border-subtle)',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                          <span className="badge badge-brand font-mono">{c.course_code}</span>
                          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>{c.course_title}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
                          <span className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                            {c.enrolled_count ?? 0} enrolled
                          </span>
                          <Link to="/lecturer/session/new" className="btn btn-ghost btn-sm">
                            Start session →
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent sessions (last 5) */}
              {sessions.length > 0 && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{
                    padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <h4 style={{ margin: 0 }}>Recent sessions</h4>
                    <button className="btn btn-ghost btn-sm" onClick={() => setTab('history')}>
                      All history →
                    </button>
                  </div>
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Course</th><th>Attendance</th><th>Status</th></tr></thead>
                    <tbody>
                      {sessions.slice(0, 5).map(s => {
                        const start = new Date(s.started_at)
                        return (
                          <tr key={s.session_id}>
                            <td className="font-mono" style={{ fontSize: 'var(--text-xs)' }}>
                              {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td><span className="badge badge-brand font-mono">{s.course_code}</span></td>
                            <td style={{ fontWeight: 600 }}>{s.attendance_count ?? 0} students</td>
                            <td>
                              {s.active
                                ? <span className="badge badge-success">Active</span>
                                : <span className="badge" style={{ background: 'var(--border-subtle)', color: 'var(--text-muted)' }}>Ended</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Session History ── */}
          {tab === 'history' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border-subtle)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <h4 style={{ margin: 0 }}>Session history ({sessions.length})</h4>
                <Link to="/lecturer/session/new" className="btn btn-primary btn-sm">
                  New session
                </Link>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Course</th><th>Duration</th><th>Attendance</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <span className="empty-state-label">No sessions yet</span>
                          <p>Start your first session above.</p>
                        </div>
                      </td>
                    </tr>
                  ) : sessions.map(s => {
                    const start   = new Date(s.started_at)
                    const end     = new Date(s.expires_at)
                    const durMins = Math.round((end - start) / 60000)
                    return (
                      <tr key={s.session_id}>
                        <td className="font-mono" style={{ fontSize: 'var(--text-xs)' }}>
                          {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className="badge badge-brand font-mono">{s.course_code}</span></td>
                        <td className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>{durMins} min</td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{s.attendance_count ?? 0}</span>
                          <span className="text-muted" style={{ fontSize: 'var(--text-xs)', marginLeft: 4 }}>students</span>
                        </td>
                        <td>
                          {s.active
                            ? <span className="badge badge-success">Active</span>
                            : <span className="badge" style={{ background: 'var(--border-subtle)', color: 'var(--text-muted)' }}>Ended</span>
                          }
                        </td>
                        <td>
                          <Link to={`/lecturer/session/${s.session_id}`} className="btn btn-ghost btn-sm">View →</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Export ── */}
          {tab === 'export' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
              <div className="section-intro">
                <h4>Export attendance data</h4>
                <p>Download your session records as a CSV file for your own records or to submit to the department.</p>
              </div>

              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
                <div>
                  <h4 style={{ marginBottom: 'var(--sp-1)' }}>Full attendance report</h4>
                  <p className="text-sm" style={{ marginBottom: 'var(--sp-4)', margin: '0 0 var(--sp-4)' }}>
                    All sessions with student names, matric numbers, timestamps, similarity scores,
                    and liveness data.
                  </p>
                </div>
                <a
                  id="btn-lecturer-export-csv"
                  href={`${API_BASE}/admin/export/attendance.csv`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost"
                  style={{ alignSelf: 'flex-start' }}
                >
                  Download attendance CSV
                </a>
              </div>

              <p className="text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                NDPR 2019 compliant — no raw biometric data is exported. Records contain attendance metadata only.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
