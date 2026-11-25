import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../../components/AppShell'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../lib/api'

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function LecturerDashboard({ defaultTab = 'overview' }) {
  const { user, token } = useAuth()
  const [tab, setTab] = useState(defaultTab)
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
      } catch { setSessions([]); setCourses([]) }
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
    <AppShell
      title={user?.full_name}
      subtitle="Lecturer, FaceAttend"
      actions={<span className="badge badge-info">Lecturer</span>}
    >
      <div className="metric-row">
        <div className="metric-item">
          <div className="metric-value text-brand">{loading ? '...' : todaySessions.length}</div>
          <div className="metric-label">Sessions today</div>
        </div>
        <div className="metric-item">
          <div className="metric-value">{loading ? '...' : sessions.length}</div>
          <div className="metric-label">Total sessions</div>
        </div>
        <div className="metric-item">
          <div className="metric-value">{loading ? '...' : avgAttendance}</div>
          <div className="metric-label">Avg attendance</div>
        </div>
        <div className="metric-item">
          <div className="metric-value text-brand">{loading ? '...' : courses.length}</div>
          <div className="metric-label">Courses assigned</div>
        </div>
      </div>

      <div className="tab-bar">
        {[['overview', 'Overview'], ['history', 'Session history'], ['export', 'Export']].map(([id, label]) => (
          <button key={id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="stack-lg">
          <div className="toolbar">
            <Link to="/lecturer/session/new" className="btn btn-primary">Start attendance session</Link>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Assignments</p>
                <h3 className="panel-title">Your courses</h3>
              </div>
            </div>
            {loading ? (
              <div className="loading-state">Loading courses...</div>
            ) : courses.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-label">No courses assigned</span>
                <p>Ask an admin to assign courses to your account.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Code</th><th>Title</th><th>Enrolled</th><th>Action</th></tr></thead>
                  <tbody>
                    {courses.map(c => (
                      <tr key={c.course_code}>
                        <td><span className="badge badge-brand font-mono">{c.course_code}</span></td>
                        <td className="font-medium">{c.course_title}</td>
                        <td className="text-muted tabular">{c.enrolled_count ?? 0} enrolled</td>
                        <td>
                          <Link to="/lecturer/session/new" className="btn btn-ghost btn-sm">Start session</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {sessions.length > 0 && (
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Activity</p>
                  <h3 className="panel-title">Recent sessions</h3>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setTab('history')}>All history</button>
              </div>
              {loading ? (
                <div className="loading-state">Loading sessions...</div>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Course</th><th>Attendance</th><th>Status</th></tr></thead>
                    <tbody>
                      {sessions.slice(0, 5).map(s => {
                        const start = new Date(s.started_at)
                        return (
                          <tr key={s.session_id}>
                            <td className="font-mono text-xs">
                              {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td><span className="badge badge-brand font-mono">{s.course_code}</span></td>
                            <td className="font-semibold tabular">{s.attendance_count ?? 0} students</td>
                            <td>
                              {s.active
                                ? <span className="badge badge-success">Active</span>
                                : <span className="badge text-muted">Ended</span>
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
        </div>
      )}

      {tab === 'history' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Records</p>
              <h3 className="panel-title">Session history ({sessions.length})</h3>
            </div>
            <Link to="/lecturer/session/new" className="btn btn-primary btn-sm">New session</Link>
          </div>
          {loading ? (
            <div className="loading-state">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-label">No sessions yet</span>
              <p>Start your first session from the overview tab.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table data-table--wide">
                <thead>
                  <tr><th>Date</th><th>Course</th><th>Duration</th><th>Attendance</th><th>Status</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {sessions.map(s => {
                    const start   = new Date(s.started_at)
                    const end     = new Date(s.expires_at)
                    const durMins = Math.round((end - start) / 60000)
                    return (
                      <tr key={s.session_id}>
                        <td className="font-mono text-xs">
                          {start.toLocaleDateString()} {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className="badge badge-brand font-mono">{s.course_code}</span></td>
                        <td className="text-muted tabular">{durMins} min</td>
                        <td>
                          <span className="font-semibold tabular">{s.attendance_count ?? 0}</span>
                          <span className="text-muted text-xs"> students</span>
                        </td>
                        <td>
                          {s.active
                            ? <span className="badge badge-success">Active</span>
                            : <span className="badge text-muted">Ended</span>
                          }
                        </td>
                        <td>
                          <Link to={`/lecturer/session/${s.session_id}`} className="btn btn-ghost btn-sm">View</Link>
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

      {tab === 'export' && (
        <div className="stack-lg">
          <div className="section-heading">
            <div>
              <h3>Export attendance data</h3>
              <p className="text-muted">Download session records as a CSV file for your records or to submit to the department.</p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Report</p>
                <h3 className="panel-title">Full attendance report</h3>
                <p className="panel-subtitle">All sessions with student names, matric numbers, timestamps, similarity scores, and liveness data.</p>
              </div>
            </div>
            <div className="panel-body stack">
              <a
                id="btn-lecturer-export-csv"
                href={`${API_BASE}/admin/export/attendance.csv`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-ghost"
              >
                Download attendance CSV
              </a>
              <p className="text-muted text-xs">Exports contain attendance metadata only. Raw biometric data is not included.</p>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
