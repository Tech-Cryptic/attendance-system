import { useState, useEffect } from 'react'
import Sidebar from '../../components/Sidebar'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../lib/api'


function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function AdminDashboard({ defaultTab = 'overview' }) {
  const { user, token } = useAuth()
  const [tab, setTab]   = useState(defaultTab)

  // Keep tab in sync if the route changes (e.g. browser back/forward via sidebar)
  useEffect(() => { setTab(defaultTab) }, [defaultTab])

  // ── Data state ───────────────────────────────────────────────
  const [stats,    setStats]    = useState(null)
  const [students, setStudents] = useState([])
  const [courses,  setCourses]  = useState([])
  const [conflicts,setConflicts]= useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  // ── Token creation form ──────────────────────────────────────
  const [tokenForm,    setTokenForm]    = useState({ course_code: '', matric_number: '', expires_in_hours: 24 })
  const [tokenCreating,setTokenCreating]= useState(false)
  const [tokenMsg,     setTokenMsg]     = useState('')
  const [newToken,     setNewToken]     = useState('')

  // ── Course creation form ────────────────────────────────────
  const [courseForm,    setCourseForm]    = useState({ course_code: '', course_title: '', expected_count: '', matric_list: '' })
  const [courseCreating,setCourseCreating]= useState(false)
  const [courseMsg,     setCourseMsg]     = useState('')
  const [newCourseLink, setNewCourseLink] = useState('')   // enrollment URL from newly created course
  const [copiedLink,    setCopiedLink]    = useState(false)

  function copyLink(url) {
    navigator.clipboard.writeText(window.location.origin + url)
      .then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) })
      .catch(() => {})
  }

  // ── Load data ────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [studRes, crsRes] = await Promise.all([
          fetch(`${API_BASE}/admin/students`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/admin/courses`,  { headers: authHeaders(token) }),
        ])
        const stud = studRes.ok ? await studRes.json() : []
        const crs  = crsRes.ok  ? await crsRes.json()  : []
        const studArr = Array.isArray(stud) ? stud : stud.students ?? []
        const crsArr  = Array.isArray(crs)  ? crs  : crs.courses  ?? []
        setStudents(studArr)
        setCourses(crsArr)
        const flagged = studArr.filter(s => s.high_similarity_flag)
        setConflicts(flagged)
        setStats({ students: studArr.length, courses: crsArr.length, conflicts: flagged.length })
      } catch {
        setError('Failed to load data. Is the backend running?')
      } finally {
        setLoading(false)
      }
    }
    if (token) load()
  }, [token])

  async function handleCreateCourse(e) {
    e.preventDefault()
    setCourseCreating(true); setCourseMsg(''); setNewCourseLink('')
    try {
      // Parse matric list from textarea (one per line or comma-separated)
      const rawList = courseForm.matric_list.trim()
      const matricList = rawList
        ? rawList.split(/[\n,]+/).map(m => m.trim()).filter(Boolean)
        : []

      const res = await fetch(`${API_BASE}/admin/courses`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify({
          course_code:    courseForm.course_code.trim().toUpperCase(),
          course_title:   courseForm.course_title.trim(),
          expected_count: courseForm.expected_count ? parseInt(courseForm.expected_count) : null,
          matric_list:    matricList,
        })
      })
      const data = await res.json()
      if (!res.ok) { setCourseMsg(`Error: ${data.detail}`); return }
      setCourseMsg(`✅ Course "${data.course_code}" created. Share the enrollment link below.`)
      setNewCourseLink(data.enrollment_url)
      setCourses(prev => [...prev, data])
      setCourseForm({ course_code: '', course_title: '', expected_count: '', matric_list: '' })
    } catch { setCourseMsg('Network error.') }
    finally  { setCourseCreating(false) }
  }

  async function handleCreateToken(e) {
    e.preventDefault()
    setTokenCreating(true); setTokenMsg(''); setNewToken('')
    try {
      const res = await fetch(`${API_BASE}/admin/tokens`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify(tokenForm)
      })
      const data = await res.json()
      if (!res.ok) { setTokenMsg(`Error: ${data.detail}`); return }
      setNewToken(data.token)
      setTokenMsg(`✅ Token issued for ${tokenForm.course_code}`)
    } catch { setTokenMsg('Network error.') }
    finally  { setTokenCreating(false) }
  }

  const TAB_MAP = [
    ['overview','Overview'], ['courses','Courses'], ['tokens','Issue Token'],
    ['students','Students'], ['conflicts','Conflicts'], ['export','Export'],
  ]

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <header className="page-header">
          <div>
            <h2 style={{ margin: 0, fontSize: '20px' }}>Admin Dashboard</h2>
            <p className="text-sm text-muted" style={{ marginTop: '2px' }}>System management · {user?.full_name}</p>
          </div>
          <span className="badge badge-brand">Admin</span>
        </header>

        <div className="page-body fade-in-up">
          {error && <div className="alert alert-danger" style={{ marginBottom: '16px' }}>{error}</div>}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '24px' }}>
            <StatCard label="Total Students"    value={loading ? '…' : stats?.students}  icon="👥" color="var(--brand-mid)" />
            <StatCard label="Active Courses"    value={loading ? '…' : stats?.courses}   icon="📚" color="var(--info)" />
            <StatCard label="Conflicts Flagged" value={loading ? '…' : stats?.conflicts} icon="⚠️" color="var(--warning)" />
          </div>

          {/* Tab bar */}
          <div className="tab-bar">
            {TAB_MAP.map(([id, label]) => (
              <button key={id} className={`tab-btn ${tab===id?'active':''}`} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>

          {/* ── Overview ── */}
          {tab === 'overview' && (
            <div className="card">
              <h4 style={{ marginBottom: '16px' }}>Quick Actions</h4>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" onClick={() => setTab('courses')}>➕ Create Course</button>
                <button className="btn btn-ghost" onClick={() => setTab('tokens')}>🔑 Issue Token</button>
                <button className="btn btn-ghost" onClick={() => setTab('conflicts')}>🚩 View Conflicts</button>
                <button className="btn btn-ghost" onClick={() => setTab('export')}>📥 Export Data</button>
              </div>
            </div>
          )}

          {/* ── Courses ── */}
          {tab === 'courses' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card">
                <h4 style={{ marginBottom: '4px' }}>Create Course</h4>
                <p className="text-sm text-muted" style={{ marginBottom: '16px' }}>
                  Admin sets the course up. Students self-enroll via the generated link. System flags overflow if enrolled &gt; expected.
                </p>
                {courseMsg && <div className={`alert ${courseMsg.startsWith('✅') ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '12px' }}>{courseMsg}</div>}

                {/* Enrollment link after creation */}
                {newCourseLink && (
                  <div style={{ marginBottom: '16px', padding: '14px 16px', background: 'rgba(16,185,129,0.08)', borderRadius: 10, border: '1px solid rgba(16,185,129,0.3)' }}>
                    <p style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600, margin: '0 0 8px' }}>🔗 Enrollment Link — share with students:</p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <code style={{ flex: 1, fontSize: 12, background: 'var(--bg-card-alt)', padding: '6px 10px', borderRadius: 6, wordBreak: 'break-all' }}>
                        {window.location.origin + newCourseLink}
                      </code>
                      <button
                        onClick={() => copyLink(newCourseLink)}
                        className="btn btn-sm btn-ghost"
                        style={{ whiteSpace: 'nowrap' }}
                      >
                        {copiedLink ? '✅ Copied!' : '📋 Copy'}
                      </button>
                    </div>
                  </div>
                )}

                <form onSubmit={handleCreateCourse} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
                      <label className="form-label">Course Code</label>
                      <input className="form-input font-mono" placeholder="e.g. CSC401" value={courseForm.course_code}
                        onChange={e => setCourseForm(p => ({...p, course_code: e.target.value}))} required />
                    </div>
                    <div className="form-group" style={{ flex: 2, minWidth: 200 }}>
                      <label className="form-label">Course Title</label>
                      <input className="form-input" placeholder="e.g. Computer Networks" value={courseForm.course_title}
                        onChange={e => setCourseForm(p => ({...p, course_title: e.target.value}))} required />
                    </div>
                    <div className="form-group" style={{ minWidth: 120 }}>
                      <label className="form-label">Expected Students</label>
                      <input className="form-input" type="number" min="1" placeholder="e.g. 120"
                        value={courseForm.expected_count}
                        onChange={e => setCourseForm(p => ({...p, expected_count: e.target.value}))} />
                    </div>
                  </div>
                  <div className="form-group">
                    <label className="form-label">
                      Official Matric Number List
                      <span className="text-xs text-muted" style={{ marginLeft: 8, fontWeight: 400 }}>One per line or comma-separated. Students not on this list cannot self-enroll.</span>
                    </label>
                    <textarea
                      className="form-input font-mono"
                      rows={4}
                      placeholder="19/52EE001&#10;19/52EE002&#10;19/52EE003"
                      value={courseForm.matric_list}
                      onChange={e => setCourseForm(p => ({...p, matric_list: e.target.value}))}
                      style={{ resize: 'vertical', fontSize: 12 }}
                    />
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={courseCreating} style={{ alignSelf: 'flex-start' }}>
                    {courseCreating ? 'Creating…' : '➕ Create Course & Generate Link'}
                  </button>
                </form>
              </div>

              {/* Over-enrollment flags */}
              {courses.some(c => c.over_enrollment_flagged) && (
                <div className="alert alert-danger">
                  ⚠️ <strong>Over-enrollment detected</strong> in {courses.filter(c => c.over_enrollment_flagged).map(c => c.course_code).join(', ')}.
                  Enrolled count exceeds the expected class size. Review immediately.
                </div>
              )}

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h4 style={{ margin: 0 }}>All Courses ({courses.length})</h4>
                </div>
                <table className="data-table">
                  <thead><tr><th>Code</th><th>Title</th><th>Enrolled</th><th>Expected</th><th>Status</th><th>Enrollment Link</th></tr></thead>
                  <tbody>
                    {courses.length === 0
                      ? <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--text-muted)', padding:'32px' }}>No courses yet.</td></tr>
                      : courses.map(c => (
                          <tr key={c.course_code}>
                            <td><span className="badge badge-brand font-mono">{c.course_code}</span></td>
                            <td>{c.course_title}</td>
                            <td style={{ fontWeight: 600 }}>{c.enrolled_count ?? '—'}</td>
                            <td style={{ color: 'var(--text-muted)' }}>{c.expected_count ?? '—'}</td>
                            <td>
                              {c.over_enrollment_flagged
                                ? <span className="badge" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>⚠️ Over</span>
                                : <span className="badge badge-success">✅ OK</span>
                              }
                            </td>
                            <td>
                              {c.enrollment_link_token ? (
                                <button
                                  className="btn btn-sm btn-ghost font-mono"
                                  style={{ fontSize: 11 }}
                                  onClick={() => copyLink(`/enroll?token=${c.enrollment_link_token}&course=${c.course_code}`)}
                                >
                                  📋 Copy Link
                                </button>
                              ) : '—'}
                            </td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Tokens ── */}
          {tab === 'tokens' && (
            <div className="card">
              <h4 style={{ marginBottom: '16px' }}>Issue Enrollment Token</h4>
              <p className="text-secondary text-sm" style={{ marginBottom: '20px' }}>
                Tokens allow a specific student to enroll in a course. Each token is single-use.
              </p>
              {tokenMsg && <div className={`alert ${tokenMsg.startsWith('✅') ? 'alert-success' : 'alert-danger'}`} style={{ marginBottom: '16px' }}>{tokenMsg}</div>}
              {newToken && (
                <div style={{ marginBottom: '20px', padding: '16px', background: 'var(--success-bg)', borderRadius: '10px', border: '1px solid var(--success)' }}>
                  <div style={{ fontSize: '12px', color: 'var(--success)', marginBottom: '6px', fontWeight: 600 }}>Share this token with the student:</div>
                  <div className="font-mono" style={{ fontSize: '15px', wordBreak: 'break-all', color: 'var(--text-primary)', letterSpacing: '0.05em' }}>{newToken}</div>
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: '10px' }} onClick={() => navigator.clipboard.writeText(newToken)}>📋 Copy</button>
                </div>
              )}
              <form onSubmit={handleCreateToken} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div className="form-group">
                  <label className="form-label">Course</label>
                  <select className="form-input" value={tokenForm.course_code}
                    onChange={e => setTokenForm(p => ({...p, course_code: e.target.value}))} required>
                    <option value="">— Select course —</option>
                    {courses.map(c => <option key={c.course_code} value={c.course_code}>{c.course_code} · {c.course_title}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Matric Number <span style={{ color:'var(--text-muted)', fontWeight:400 }}>(optional)</span></label>
                  <input className="form-input font-mono" placeholder="e.g. 22/01DL068 (leave blank for open token)"
                    value={tokenForm.matric_number} onChange={e => setTokenForm(p => ({...p, matric_number: e.target.value}))} />
                </div>
                <div className="form-group">
                  <label className="form-label">Token Validity</label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {[1,6,24,48,168].map(h => (
                      <button key={h} type="button" className={`btn btn-sm ${tokenForm.expires_in_hours===h?'btn-primary':'btn-ghost'}`}
                        onClick={() => setTokenForm(p => ({...p, expires_in_hours: h}))}>
                        {h < 24 ? `${h}h` : h < 168 ? `${h/24}d` : '1 week'}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={tokenCreating || courses.length===0} style={{ alignSelf: 'flex-start' }}>
                  {tokenCreating ? 'Generating…' : '🔑 Generate Token'}
                </button>
              </form>
            </div>
          )}

          {/* ── Students ── */}
          {tab === 'students' && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border-subtle)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <h4 style={{ margin: 0 }}>Enrolled Students ({students.length})</h4>
                <a href={`${API_BASE}/admin/export/students.csv`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">📥 Export CSV</a>
              </div>
              <table className="data-table">
                <thead><tr><th>Matric No.</th><th>Full Name</th><th>Enrolled</th><th>Flag</th></tr></thead>
                <tbody>
                  {students.length === 0
                    ? <tr><td colSpan={4} style={{ textAlign:'center', color:'var(--text-muted)', padding:'32px' }}>No students enrolled yet.</td></tr>
                    : students.map(s => (
                        <tr key={s.matric_number}>
                          <td><span className="font-mono text-sm">{s.matric_number}</span></td>
                          <td>{s.full_name}</td>
                          <td className="text-sm text-muted">{new Date(s.enrolled_at).toLocaleDateString()}</td>
                          <td>{s.high_similarity_flag ? <span className="badge badge-warning">⚠️ Twin Flag</span> : <span className="badge badge-success">✓ Clear</span>}</td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          )}

          {/* ── Conflicts ── */}
          {tab === 'conflicts' && (
            <div className="card">
              <h4 style={{ marginBottom: '8px' }}>⚠️ High Similarity Flags ({conflicts.length})</h4>
              <p className="text-secondary text-sm" style={{ marginBottom: '20px' }}>
                These students have facial embeddings within the twin-flag threshold (cosine distance &lt; 0.50). They will require additional behavioural verification at attendance time.
              </p>
              {conflicts.length === 0 ? (
                <div style={{ textAlign:'center', padding:'40px', color:'var(--text-muted)' }}>✅ No conflicts detected.</div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Matric</th><th>Name</th><th>Flagged Pair</th><th>Enrolled</th></tr></thead>
                  <tbody>
                    {conflicts.map(s => (
                      <tr key={s.matric_number}>
                        <td className="font-mono text-sm">{s.matric_number}</td>
                        <td>{s.full_name}</td>
                        <td className="font-mono text-sm text-muted">{s.flagged_pair_matric ?? '—'}</td>
                        <td className="text-sm text-muted">{new Date(s.enrolled_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Export ── */}
          {tab === 'export' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="card" style={{ background:'linear-gradient(135deg,rgba(79,70,229,0.08),rgba(6,182,212,0.05))', borderColor:'var(--border-brand)' }}>
                <h4 style={{ marginBottom: '8px' }}>📥 Data Export</h4>
                <p className="text-secondary text-sm">Download attendance and student data as CSV files for record keeping or external analysis.</p>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:'16px' }}>
                <div className="card card-glow">
                  <div style={{ fontSize:'32px', marginBottom:'12px' }}>📋</div>
                  <h4 style={{ marginBottom:'6px' }}>Attendance Records</h4>
                  <p className="text-secondary text-sm" style={{ marginBottom:'20px' }}>
                    Full attendance log with session ID, course, timestamp, similarity score, liveness scores, and sync status.
                  </p>
                  <a id="btn-export-attendance" href={`${API_BASE}/admin/export/attendance.csv`} target="_blank" rel="noreferrer"
                    className="btn btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:'8px' }}>
                    📥 Download Attendance CSV
                  </a>
                </div>
                <div className="card card-glow">
                  <div style={{ fontSize:'32px', marginBottom:'12px' }}>👥</div>
                  <h4 style={{ marginBottom:'6px' }}>Student Registry</h4>
                  <p className="text-secondary text-sm" style={{ marginBottom:'20px' }}>
                    All enrolled students with matric number, full name, enrollment date, and twin-flag status.
                  </p>
                  <a id="btn-export-students" href={`${API_BASE}/admin/export/students.csv`} target="_blank" rel="noreferrer"
                    className="btn btn-primary" style={{ display:'inline-flex', alignItems:'center', gap:'8px' }}>
                    📥 Download Students CSV
                  </a>
                </div>
              </div>
              <div className="card" style={{ padding:'14px 20px' }}>
                <p className="text-xs text-muted" style={{ margin:0 }}>
                  🔒 NDPR 2019 Compliant — Exported files contain attendance metadata only. No raw biometric data is included.
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
      <div style={{ fontSize:'28px', marginBottom:'4px' }}>{icon}</div>
      <div className="stat-value" style={{ color }}>{value ?? '—'}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
