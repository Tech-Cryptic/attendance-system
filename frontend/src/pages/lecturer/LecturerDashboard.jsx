import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../../components/Sidebar'
import { useAuth } from '../../context/AuthContext'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function LecturerDashboard({ defaultTab = 'overview' }) {
  const { user, token } = useAuth()
  const [tab, setTab]   = useState(defaultTab)

  // Keep tab in sync when route changes (sidebar navigation)
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
            <h2 style={{ margin: 0, fontSize: '20px' }}>Lecturer Dashboard</h2>
            <p className="text-sm text-muted" style={{ marginTop: '2px' }}>{user?.full_name}</p>
          </div>
          <span className="badge badge-info">Lecturer</span>
        </header>

        <div className="page-body fade-in-up">
          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '24px' }}>
            <StatCard label="Sessions Today" value={loading ? '…' : todaySessions.length} icon="📋" color="var(--brand-mid)" />
            <StatCard label="Total Sessions" value={loading ? '…' : sessions.length}      icon="📊" color="var(--info)" />
            <StatCard label="Avg Attendance" value={loading ? '…' : avgAttendance}         icon="👥" color="var(--success)" />
          </div>

          {/* Tab bar */}
          <div className="tab-bar">
            {[['overview','Overview'], ['history','Session History'], ['export','Export']].map(([id, label]) => (
              <button key={id} className={`tab-btn ${tab===id?'active':''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card" style={{ background: 'linear-gradient(135deg,rgba(6,182,212,0.1),rgba(79,70,229,0.08))', borderColor: 'rgba(6,182,212,0.3)' }}>
                <h3 style={{ marginBottom: '8px' }}>Welcome, {user?.full_name} 👋</h3>
                <p className="text-secondary text-sm">Start a session to generate a QR code for your class, or review past sessions below.</p>
              </div>

              <div className="card">
                <h4 style={{ marginBottom: '16px' }}>Actions</h4>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <Link to="/lecturer/session/new" className="btn btn-primary">📡 Start New Session</Link>
                  <button className="btn btn-ghost" onClick={() => setTab('history')}>📋 Session History</button>
                  <button className="btn btn-ghost" onClick={() => setTab('export')}>📥 Export Data</button>
                </div>
              </div>

              {/* Courses assigned */}
              <div className="card">
                <h4 style={{ marginBottom: '16px' }}>Your Courses</h4>
                {courses.length === 0 ? (
                  <p className="text-muted text-sm">No courses assigned. Ask an admin to assign courses to your account.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {courses.map(c => (
                      <div key={c.course_code} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 14px', background: 'rgba(255,255,255,0.03)',
                        borderRadius: '10px', border: '1px solid var(--border-subtle)',
                      }}>
                        <div>
                          <span className="badge badge-brand font-mono" style={{ marginRight: '10px' }}>{c.course_code}</span>
                          <span style={{ fontSize: '14px' }}>{c.course_title}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span className="text-sm text-muted">{c.enrolled_count ?? 0} enrolled</span>
                          <Link to="/lecturer/session/new" className="btn btn-ghost btn-sm">Start →</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Session History ── */}
          {tab === 'history' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>Session History ({sessions.length})</h4>
                <Link to="/lecturer/session/new" className="btn btn-primary btn-sm">📡 New Session</Link>
              </div>
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Course</th><th>Duration</th><th>Attendance</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {sessions.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        No sessions yet. Start your first session above.
                      </td>
                    </tr>
                  ) : sessions.map(s => {
                    const start   = new Date(s.started_at)
                    const end     = new Date(s.expires_at)
                    const durMins = Math.round((end - start) / 60000)
                    return (
                      <tr key={s.session_id}>
                        <td className="text-sm">
                          {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className="badge badge-brand font-mono">{s.course_code}</span></td>
                        <td className="text-sm text-muted">{durMins} min</td>
                        <td>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.attendance_count ?? 0}</span>
                          <span className="text-muted text-sm"> students</span>
                        </td>
                        <td>
                          {s.active
                            ? <span className="badge badge-success">🟢 Active</span>
                            : <span className="badge" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>Ended</span>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card" style={{ background: 'linear-gradient(135deg,rgba(6,182,212,0.08),rgba(79,70,229,0.05))', borderColor: 'rgba(6,182,212,0.3)' }}>
                <h4 style={{ marginBottom: '8px' }}>📥 Export Attendance Data</h4>
                <p className="text-secondary text-sm">Download your session attendance records as a CSV file.</p>
              </div>

              <div className="card card-glow">
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>📋</div>
                <h4 style={{ marginBottom: '6px' }}>Full Attendance Report</h4>
                <p className="text-secondary text-sm" style={{ marginBottom: '20px' }}>
                  All sessions with student names, matric numbers, timestamps, similarity scores, and liveness data.
                </p>
                <a
                  id="btn-lecturer-export-csv"
                  href={`${API_BASE}/admin/export/attendance.csv`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
                >
                  📥 Download Attendance CSV
                </a>
              </div>

              <div className="card" style={{ padding: '14px 20px' }}>
                <p className="text-xs text-muted" style={{ margin: 0 }}>
                  🔒 NDPR compliant — No raw biometric data is exported. Attendance records contain metadata only.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }) {
  return (
    <div className="stat-card card-glow">
      <div style={{ fontSize: '24px' }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
