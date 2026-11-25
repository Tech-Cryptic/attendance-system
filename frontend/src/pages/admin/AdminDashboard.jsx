import { useState, useEffect } from 'react'
import AppShell from '../../components/AppShell'
import { useAuth } from '../../context/AuthContext'
import { API_BASE } from '../../lib/api'


function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

export default function AdminDashboard({ defaultTab = 'overview' }) {
  const { user, token } = useAuth()
  const [tab, setTab] = useState(defaultTab)

  // Keep tab in sync if the route changes (browser back or forward via sidebar)
  useEffect(() => { setTab(defaultTab) }, [defaultTab])

  // Data state
  const [stats,    setStats]    = useState(null)
  const [students, setStudents] = useState([])
  const [courses,  setCourses]  = useState([])
  const [lecturers,setLecturers] = useState([])
  const [conflicts,setConflicts]= useState([])
  const [users,    setUsers]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [notice,   setNotice]   = useState(null)
  const [confirmState, setConfirmState] = useState(null)

  // Token creation form
  const [tokenForm,    setTokenForm]    = useState({ course_code: '', matric_number: '', expires_in_hours: 24 })
  const [tokenCreating,setTokenCreating]= useState(false)
  const [tokenMsg,     setTokenMsg]     = useState('')
  const [newToken,     setNewToken]     = useState('')

  // Course creation form
  const [courseForm,    setCourseForm]    = useState({ course_code: '', course_title: '', expected_count: '', matric_list: '', lecturer_id: '' })
  const [courseCreating,setCourseCreating]= useState(false)
  const [courseMsg,     setCourseMsg]     = useState('')
  const [newCourseLink, setNewCourseLink] = useState('')
  const [copiedLink,    setCopiedLink]    = useState(false)

  // User creation form
  const [userForm, setUserForm] = useState({ email: '', password: '', full_name: '', role: 'lecturer', linked_matric: '' })
  const [userCreating, setUserCreating] = useState(false)
  const [userMsg, setUserMsg] = useState('')
  const [userCheckMsg, setUserCheckMsg] = useState('')

  // User edit modal
  const [editUser, setEditUser] = useState(null)
  const [editForm, setEditForm] = useState({ full_name: '', email: '', linked_matric: '', password: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [editMsg, setEditMsg] = useState('')

  // Course reassign and delete
  const [courseActionMsg, setCourseActionMsg] = useState('')

  function showNotice(text, tone = 'info') {
    setNotice({ text, tone })
  }

  function requestConfirm(title, message, confirmLabel, onConfirm) {
    setConfirmState({ title, message, confirmLabel, onConfirm })
  }

  function runConfirm() {
    const action = confirmState?.onConfirm
    setConfirmState(null)
    if (action) action()
  }

  function copyLink(url) {
    navigator.clipboard.writeText(window.location.origin + url)
      .then(() => { setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2000) })
      .catch(() => {})
  }

  // Duplicate check before user creation
  async function checkUserDuplicate(email, matric) {
    if (!email) { setUserCheckMsg(''); return }
    try {
      const params = new URLSearchParams({ email })
      if (matric) params.append('matric', matric)
      const res = await fetch(`${API_BASE}/admin/users/check?${params}`, { headers: authHeaders(token) })
      if (!res.ok) return
      const { email_taken, matric_taken } = await res.json()
      if (email_taken && matric_taken) setUserCheckMsg('This email and matric are already registered.')
      else if (email_taken)            setUserCheckMsg('This email is already registered.')
      else if (matric_taken)           setUserCheckMsg('This matric number is already linked to another account.')
      else                             setUserCheckMsg('')
    } catch { setUserCheckMsg('') }
  }

  // Open edit modal
  function openEditUser(u) {
    setEditUser(u)
    setEditForm({ full_name: u.full_name, email: u.email, linked_matric: u.linked_matric ?? '', password: '' })
    setEditMsg('')
  }

  // Save user edits
  async function handleEditUser(e) {
    e.preventDefault()
    if (!editUser) return
    setEditSaving(true); setEditMsg('')
    try {
      const body = { full_name: editForm.full_name, email: editForm.email }
      if (editUser.role === 'student') body.linked_matric = editForm.linked_matric
      if (editForm.password) body.password = editForm.password

      const res = await fetch(`${API_BASE}/admin/users/${editUser.id}`, {
        method: 'PATCH', headers: authHeaders(token), body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) { setEditMsg(`Error: ${data.detail}`); return }

      setUsers(prev => prev.map(u => u.id === editUser.id
        ? { ...u, full_name: editForm.full_name, email: editForm.email, linked_matric: editForm.linked_matric || u.linked_matric }
        : u
      ))
      setEditUser(null)
    } catch { setEditMsg('Network error.') }
    finally { setEditSaving(false) }
  }

  // Delete course
  async function handleDeleteCourse(courseCode) {
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseCode}`, {
        method: 'DELETE', headers: authHeaders(token)
      })
      if (!res.ok && res.status !== 204) {
        const d = await res.json().catch(() => ({}))
        showNotice(`Error deleting course: ${d.detail ?? res.status}`, 'danger')
        return
      }
      setCourses(prev => prev.filter(c => c.course_code !== courseCode))
      setStats(prev => ({ ...prev, courses: (prev?.courses ?? 1) - 1 }))
      setCourseActionMsg(`Course ${courseCode} deleted.`)
    } catch { showNotice('Network error deleting course.', 'danger') }
  }

  // Reassign lecturer on a course
  async function handleReassignLecturer(courseCode, lecturerId) {
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseCode}`, {
        method: 'PATCH', headers: authHeaders(token),
        body: JSON.stringify({ lecturer_id: lecturerId ? parseInt(lecturerId) : null })
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); showNotice(`Error: ${d.detail}`, 'danger'); return }
      const lecName = lecturers.find(l => l.id === parseInt(lecturerId))?.full_name ?? 'Unassigned'
      setCourses(prev => prev.map(c => c.course_code === courseCode ? { ...c, lecturer_name: lecName } : c))
      setCourseActionMsg(`Lecturer updated for ${courseCode}.`)
    } catch { showNotice('Network error.', 'danger') }
  }

  // Load data
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [studRes, crsRes, lecRes, usrRes] = await Promise.all([
          fetch(`${API_BASE}/admin/students`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/admin/courses`,  { headers: authHeaders(token) }),
          fetch(`${API_BASE}/admin/lecturers`, { headers: authHeaders(token) }),
          fetch(`${API_BASE}/admin/users`, { headers: authHeaders(token) }),
        ])
        const stud = studRes.ok ? await studRes.json() : []
        const crs  = crsRes.ok  ? await crsRes.json()  : []
        const lec  = lecRes.ok  ? await lecRes.json()  : []
        const usr  = usrRes.ok  ? await usrRes.json()  : []
        const studArr = Array.isArray(stud) ? stud : stud.students ?? []
        const crsArr  = Array.isArray(crs)  ? crs  : crs.courses  ?? []
        setStudents(studArr)
        setCourses(crsArr)
        setLecturers(Array.isArray(lec) ? lec : [])
        setUsers(Array.isArray(usr) ? usr : [])
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
      // Parse matric list from textarea (one per line or comma separated)
      const rawList = courseForm.matric_list.trim()
      const matricList = rawList
        ? rawList.split(/[\n,]+/).map(m => m.trim()).filter(Boolean)
        : []

      const res = await fetch(`${API_BASE}/admin/courses`, {
        method: 'POST', headers: authHeaders(token),
        body: JSON.stringify({
          course_code:    courseForm.course_code.trim().toUpperCase(),
          course_title:   courseForm.course_title.trim(),
          lecturer_id:    courseForm.lecturer_id ? parseInt(courseForm.lecturer_id) : null,
          expected_count: courseForm.expected_count ? parseInt(courseForm.expected_count) : null,
          matric_list:    matricList,
        })
      })
      const data = await res.json()
      if (!res.ok) { setCourseMsg(`Error: ${data.detail}`); return }
      setCourseMsg(`Course "${data.course_code}" created. Share the enrollment link below.`)
      setNewCourseLink(data.enrollment_url)
      setCourses(prev => [...prev, data])
      setCourseForm({ course_code: '', course_title: '', expected_count: '', matric_list: '', lecturer_id: '' })
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
      setTokenMsg(`Token issued for ${tokenForm.course_code}`)
    } catch { setTokenMsg('Network error.') }
    finally  { setTokenCreating(false) }
  }

  async function handleGenerateLink(courseCode) {
    try {
      const res = await fetch(`${API_BASE}/admin/courses/${courseCode}/generate-link`, {
        method: 'POST',
        headers: authHeaders(token)
      })
      const data = await res.json()
      if (res.ok) {
        setCourses(prev => prev.map(c => c.course_code === courseCode ? { ...c, enrollment_link_token: data.enrollment_link_token } : c))
      } else {
        showNotice(`Error generating link: ${data.detail}`, 'danger')
      }
    } catch {
      showNotice('Network error generating link.', 'danger')
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault()
    setUserCreating(true); setUserMsg('')
    try {
      const payload = {
        email: userForm.email.trim(),
        password: userForm.password,
        full_name: userForm.full_name.trim(),
        role: userForm.role,
        linked_matric: userForm.role === 'student' ? userForm.linked_matric.trim() : null
      }
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) {
        setUserMsg(`Error: ${data.detail}`)
        return
      }
      setUserMsg(`${userForm.role.toUpperCase()} "${userForm.full_name}" registered.`)
      setUserForm({ email: '', password: '', full_name: '', role: 'lecturer', linked_matric: '' })

      const [usrRes, lecRes] = await Promise.all([
        fetch(`${API_BASE}/admin/users`, { headers: authHeaders(token) }),
        fetch(`${API_BASE}/admin/lecturers`, { headers: authHeaders(token) }),
      ])
      if (usrRes.ok) setUsers(await usrRes.json())
      if (lecRes.ok) setLecturers(await lecRes.json())
    } catch {
      setUserMsg('Network error registering user.')
    } finally {
      setUserCreating(false)
    }
  }

  async function handleDeleteUser(userId, userName) {
    try {
      const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      })
      if (!res.ok) {
        const data = await res.json()
        showNotice(`Error deleting user: ${data.detail}`, 'danger')
        return
      }
      setUsers(prev => prev.filter(u => u.id !== userId))

      const [lecRes, studRes, crsRes] = await Promise.all([
        fetch(`${API_BASE}/admin/lecturers`, { headers: authHeaders(token) }),
        fetch(`${API_BASE}/admin/students`, { headers: authHeaders(token) }),
        fetch(`${API_BASE}/admin/courses`,  { headers: authHeaders(token) }),
      ])
      if (lecRes.ok) setLecturers(await lecRes.json())
      if (studRes.ok) {
        const stud = await studRes.json()
        const studArr = Array.isArray(stud) ? stud : stud.students ?? []
        setStudents(studArr)
        const flagged = studArr.filter(s => s.high_similarity_flag)
        setConflicts(flagged)
        setStats(prev => ({ ...prev, students: studArr.length, conflicts: flagged.length }))
      }
      if (crsRes.ok) {
        const crs = await crsRes.json()
        setCourses(Array.isArray(crs) ? crs : crs.courses ?? [])
      }
      showNotice(`User "${userName}" deleted successfully.`, 'success')
    } catch {
      showNotice('Network error deleting user.', 'danger')
    }
  }

  const TAB_MAP = [
    ['overview','Overview'], ['courses','Courses'], ['tokens','Issue token'],
    ['students','Students'], ['conflicts','Conflicts'], ['users','Create users'], ['export','Export'],
  ]

  return (
    <AppShell
      title="Admin dashboard"
      subtitle={`System management for ${user?.full_name}`}
      actions={<span className="badge badge-info">Admin</span>}
    >
      {(error || notice) && (
        <div className="stack-sm">
          {error && <div className="alert alert-danger">{error}</div>}
          {notice && (
            <div className={`alert alert-${notice.tone}`}>
              <span>{notice.text}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setNotice(null)}>Dismiss</button>
            </div>
          )}
        </div>
      )}

      <div className="metric-row">
        <div className="metric-item">
          <div className="metric-value tabular">{loading ? '...' : stats?.students}</div>
          <div className="metric-label">Enrolled students</div>
        </div>
        <div className="metric-item">
          <div className="metric-value tabular">{loading ? '...' : stats?.courses}</div>
          <div className="metric-label">Active courses</div>
        </div>
        <div className="metric-item">
          <div className={`metric-value tabular ${(stats?.conflicts ?? 0) > 0 ? 'text-warning' : 'text-muted'}`}>
            {loading ? '...' : stats?.conflicts}
          </div>
          <div className="metric-label">Similarity flags</div>
        </div>
        <div className="metric-item">
          <div className="metric-value tabular">{loading ? '...' : users.length}</div>
          <div className="metric-label">System users</div>
        </div>
      </div>

      <div className="tab-bar">
        {TAB_MAP.map(([id, label]) => (
          <button key={id} className={`tab-btn ${tab===id?'active':''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Shortcuts</p>
              <h3 className="panel-title">Quick actions</h3>
            </div>
          </div>
          <div className="panel-body">
            <div className="toolbar">
              <button className="btn btn-ghost" onClick={() => setTab('courses')}>Create course</button>
              <button className="btn btn-ghost" onClick={() => setTab('tokens')}>Issue token</button>
              <button className="btn btn-ghost" onClick={() => setTab('conflicts')}>View conflicts</button>
              <button className="btn btn-ghost" onClick={() => setTab('users')}>Create users</button>
              <button className="btn btn-ghost" onClick={() => setTab('export')}>Export data</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'courses' && (
        <div className="stack-lg">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Setup</p>
                <h3 className="panel-title">Create course</h3>
                <p className="panel-subtitle">Admin sets the course up. Students self enroll via the generated link. Enrolled counts above the expected size are flagged automatically.</p>
              </div>
            </div>
            <div className="panel-body stack">
              {courseMsg && (
                <div className={`alert ${courseMsg.startsWith('Error') || courseMsg.startsWith('Network') ? 'alert-danger' : 'alert-success'}`}>
                  {courseMsg}
                </div>
              )}

              {newCourseLink && (
                <div className="alert alert-success stack-sm">
                  <p className="eyebrow">Enrollment link: share with students</p>
                  <div className="toolbar">
                    <code className="font-mono">{window.location.origin + newCourseLink}</code>
                    <button type="button" onClick={() => copyLink(newCourseLink)} className="btn btn-sm btn-ghost">
                      {copiedLink ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              <form onSubmit={handleCreateCourse} className="stack">
                <div className="field-grid-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="course-code">Course code</label>
                    <input id="course-code" className="form-input font-mono" placeholder="e.g. CSC401" value={courseForm.course_code}
                      onChange={e => setCourseForm(p => ({...p, course_code: e.target.value}))} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="course-title">Course title</label>
                    <input id="course-title" className="form-input" placeholder="e.g. Computer Networks" value={courseForm.course_title}
                      onChange={e => setCourseForm(p => ({...p, course_title: e.target.value}))} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="course-lecturer">Assign lecturer</label>
                    <select id="course-lecturer" className="form-input" value={courseForm.lecturer_id}
                      onChange={e => setCourseForm(p => ({...p, lecturer_id: e.target.value}))}>
                      <option value="">Select lecturer</option>
                      {lecturers.map(l => (
                        <option key={l.id} value={l.id}>{l.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="course-expected">Expected students</label>
                    <input id="course-expected" className="form-input tabular" type="number" min="1" placeholder="e.g. 120"
                      value={courseForm.expected_count}
                      onChange={e => setCourseForm(p => ({...p, expected_count: e.target.value}))} />
                  </div>
                  <div className="form-group field-full">
                    <label className="form-label" htmlFor="course-matric-list">
                      Official matric number list
                      <span className="text-xs text-muted">One per line or comma separated. Students not on this list cannot self enroll.</span>
                    </label>
                    <textarea
                      id="course-matric-list"
                      className="form-input font-mono"
                      rows={4}
                      placeholder="19/52EE001&#10;19/52EE002&#10;19/52EE003"
                      value={courseForm.matric_list}
                      onChange={e => setCourseForm(p => ({...p, matric_list: e.target.value}))}
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={courseCreating}>
                    {courseCreating ? 'Creating...' : 'Create course and generate link'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {courses.some(c => c.over_enrollment_flagged) && (
            <div className="alert alert-danger">
              <strong>Over enrollment detected</strong> in {courses.filter(c => c.over_enrollment_flagged).map(c => c.course_code).join(', ')}.
              Enrolled count exceeds the expected class size. Review immediately.
            </div>
          )}

          {courseActionMsg && <div className="alert alert-success">{courseActionMsg}</div>}

          <div className="panel">
            <div className="panel-header">
              <h3 className="panel-title">All courses ({courses.length})</h3>
            </div>
            <div className="table-wrapper">
              <table className="data-table data-table--wide">
                <thead><tr><th>Code</th><th>Title</th><th>Lecturer</th><th>Enrolled</th><th>Expected</th><th>Status</th><th>Enrollment link</th><th>Actions</th></tr></thead>
                <tbody>
                  {courses.length === 0
                    ? (
                      <tr>
                        <td colSpan={8}>
                          <div className="empty-state">
                            <span className="empty-state-label">No courses yet</span>
                            <p>Create a course to start enrolling students.</p>
                          </div>
                        </td>
                      </tr>
                    )
                    : courses.map(c => (
                        <tr key={c.course_code}>
                          <td><span className="badge badge-brand font-mono">{c.course_code}</span></td>
                          <td>{c.course_title}</td>
                          <td>
                            <select
                              className="form-input"
                              aria-label={`Lecturer for ${c.course_code}`}
                              defaultValue={lecturers.find(l => l.full_name === c.lecturer_name)?.id ?? ''}
                              onChange={e => handleReassignLecturer(c.course_code, e.target.value)}
                            >
                              <option value="">Unassigned</option>
                              {lecturers.map(l => (
                                <option key={l.id} value={l.id}>{l.full_name}</option>
                              ))}
                            </select>
                          </td>
                          <td><strong className="tabular">{c.enrolled_count ?? 'N/A'}</strong></td>
                          <td className="text-muted tabular">{c.expected_count ?? 'N/A'}</td>
                          <td>
                            {c.over_enrollment_flagged
                              ? <span className="badge badge-danger">Over</span>
                              : <span className="badge badge-success">OK</span>
                            }
                          </td>
                          <td>
                            {c.enrollment_link_token ? (
                              <button
                                className="btn btn-sm btn-ghost font-mono"
                                onClick={() => copyLink(`/enroll?token=${c.enrollment_link_token}&course=${c.course_code}`)}
                              >
                                Copy link
                              </button>
                            ) : (
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={() => handleGenerateLink(c.course_code)}
                              >
                                Generate link
                              </button>
                            )}
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => requestConfirm(
                                'Delete course',
                                `Delete ${c.course_code}? This permanently removes the course, its sessions, attendance records, course enrollments, and enrollment tokens. This cannot be undone.`,
                                'Delete course',
                                () => handleDeleteCourse(c.course_code)
                              )}
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'tokens' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Access</p>
              <h3 className="panel-title">Issue enrollment token</h3>
              <p className="panel-subtitle">Tokens allow a specific student to enroll in a course. Each token is single use.</p>
            </div>
          </div>
          <div className="panel-body stack">
            {tokenMsg && (
              <div className={`alert ${tokenMsg.startsWith('Error') || tokenMsg.startsWith('Network') ? 'alert-danger' : 'alert-success'}`}>
                {tokenMsg}
              </div>
            )}
            {newToken && (
              <div className="alert alert-success stack-sm">
                <p className="eyebrow">Share this token with the student</p>
                <div className="font-mono">{newToken}</div>
                <div>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(newToken)}>Copy</button>
                </div>
              </div>
            )}
            <form onSubmit={handleCreateToken} className="stack">
              <div className="field-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="token-course">Course</label>
                  <select id="token-course" className="form-input" value={tokenForm.course_code}
                    onChange={e => setTokenForm(p => ({...p, course_code: e.target.value}))} required>
                    <option value="">Select course</option>
                    {courses.map(c => <option key={c.course_code} value={c.course_code}>{c.course_code}: {c.course_title}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="token-matric">Matric number <span className="text-muted">(optional)</span></label>
                  <input id="token-matric" className="form-input font-mono" placeholder="e.g. 22/01DL068 (leave blank for open token)"
                    value={tokenForm.matric_number} onChange={e => setTokenForm(p => ({...p, matric_number: e.target.value}))} />
                </div>
                <div className="form-group field-full">
                  <label id="token-validity-label" className="form-label" htmlFor="token-validity">Token validity</label>
                  <div id="token-validity" className="toolbar" role="group" aria-labelledby="token-validity-label">
                    {[1,6,24,48,168].map(h => (
                      <button key={h} type="button" className={`btn btn-sm ${tokenForm.expires_in_hours===h?'btn-primary':'btn-ghost'}`}
                        onClick={() => setTokenForm(p => ({...p, expires_in_hours: h}))}>
                        {h < 24 ? `${h}h` : h < 168 ? `${h/24}d` : '1 week'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={tokenCreating || courses.length===0}>
                  {tokenCreating ? 'Generating...' : 'Generate token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'students' && (
        <div className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Enrolled students ({students.length})</h3>
            <div className="toolbar-end">
              <a href={`${API_BASE}/admin/export/students.csv`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Export CSV</a>
            </div>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr><th>Matric no.</th><th>Full name</th><th>Enrolled</th><th>Flag</th></tr></thead>
              <tbody>
                {students.length === 0
                  ? (
                    <tr>
                      <td colSpan={4}>
                        <div className="empty-state">
                          <span className="empty-state-label">No students enrolled yet</span>
                          <p>Students appear here after they enroll in a course.</p>
                        </div>
                      </td>
                    </tr>
                  )
                  : students.map(s => (
                      <tr key={s.matric_number}>
                        <td><span className="font-mono text-sm">{s.matric_number}</span></td>
                        <td>{s.full_name}</td>
                        <td className="text-sm text-muted">{new Date(s.enrolled_at).toLocaleDateString()}</td>
                        <td>{s.high_similarity_flag ? <span className="badge badge-warning">Twin flag</span> : <span className="badge badge-success">Clear</span>}</td>
                      </tr>
                    ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'conflicts' && (
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3 className="panel-title">High similarity flags ({conflicts.length})</h3>
              <p className="panel-subtitle">These students have facial embeddings within the twin flag threshold (cosine distance &lt; 0.50). They require additional behavioural verification at attendance time.</p>
            </div>
          </div>
          <div className="panel-body stack">
            {conflicts.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-label">No conflicts detected</span>
                <p>Flagged student pairs appear here when similarity thresholds are exceeded.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead><tr><th>Matric</th><th>Name</th><th>Flagged pair</th><th>Enrolled</th></tr></thead>
                  <tbody>
                    {conflicts.map(s => (
                      <tr key={s.matric_number}>
                        <td className="font-mono text-sm">{s.matric_number}</td>
                        <td>{s.full_name}</td>
                        <td className="font-mono text-sm text-muted">{s.flagged_pair_matric ?? 'N/A'}</td>
                        <td className="text-sm text-muted">{new Date(s.enrolled_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="stack-lg">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Accounts</p>
                <h3 className="panel-title">Register user account</h3>
                <p className="panel-subtitle">Create login accounts for lecturers or students. Student accounts must link to a valid matric number.</p>
              </div>
            </div>
            <div className="panel-body stack">
              {userMsg && (
                <div className={`alert ${userMsg.startsWith('Error') || userMsg.startsWith('Network') ? 'alert-danger' : 'alert-success'}`}>
                  {userMsg}
                </div>
              )}
              {userCheckMsg && <div className="alert alert-warning">{userCheckMsg}</div>}

              <form onSubmit={handleCreateUser} className="stack">
                <div className="field-grid">
                  <div className="form-group">
                    <label className="form-label" htmlFor="user-full-name">Full name</label>
                    <input id="user-full-name" className="form-input" placeholder="e.g. Dr. John Doe or Jane Smith" value={userForm.full_name}
                      onChange={e => setUserForm(p => ({...p, full_name: e.target.value}))} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="user-email">Email address</label>
                    <input id="user-email" className="form-input" type="email" placeholder="user@unilorin.edu.ng" value={userForm.email}
                      onChange={e => setUserForm(p => ({...p, email: e.target.value}))}
                      onBlur={e => checkUserDuplicate(e.target.value, userForm.linked_matric)}
                      required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="user-role">Role</label>
                    <select id="user-role" className="form-input" value={userForm.role}
                      onChange={e => setUserForm(p => ({...p, role: e.target.value}))}>
                      <option value="lecturer">Lecturer</option>
                      <option value="student">Student</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="user-password">Password <span className="text-muted">(min 8 chars)</span></label>
                    <input id="user-password" className="form-input" type="password" placeholder="••••••••" minLength={8} value={userForm.password}
                      onChange={e => setUserForm(p => ({...p, password: e.target.value}))} required />
                  </div>
                  {userForm.role === 'student' && (
                    <div className="form-group">
                      <label className="form-label" htmlFor="user-linked-matric">Linked matric number</label>
                      <input id="user-linked-matric" className="form-input font-mono" placeholder="e.g. 22/01DL068" value={userForm.linked_matric}
                        onChange={e => setUserForm(p => ({...p, linked_matric: e.target.value}))}
                        onBlur={e => checkUserDuplicate(userForm.email, e.target.value)}
                        required />
                    </div>
                  )}
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={userCreating}>
                    {userCreating ? 'Registering...' : 'Register user'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h3 className="panel-title">All registered users ({users.length})</h3>
            </div>
            <div className="table-wrapper">
              <table className="data-table data-table--wide">
                <thead>
                  <tr>
                    <th>Full name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Detail</th>
                    <th>Created</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-state">
                          <span className="empty-state-label">No users found</span>
                          <p>Registered accounts appear here once they are created.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    users.map(u => (
                      <tr key={u.id}>
                        <td><strong>{u.full_name}</strong></td>
                        <td>{u.email}</td>
                        <td>
                          <span className={`badge ${
                            u.role === 'admin' ? 'badge-brand' :
                            u.role === 'lecturer' ? 'badge-info' : 'badge-success'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="font-mono text-sm">
                          {u.role === 'student' ? (u.linked_matric ?? 'N/A') : 'N/A'}
                        </td>
                        <td className="text-sm text-muted">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : 'N/A'}
                        </td>
                        <td>
                          {u.id === parseInt(user?.id) ? (
                            <span className="text-muted">Active admin</span>
                          ) : (
                            <div className="inline-meta">
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={() => openEditUser(u)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn btn-sm btn-danger"
                                onClick={() => requestConfirm(
                                  'Delete user',
                                  `Delete user "${u.full_name}"? This permanently removes all of their associated records.`,
                                  'Delete user',
                                  () => handleDeleteUser(u.id, u.full_name)
                                )}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'export' && (
        <div className="stack">
          <div className="section-heading">
            <div>
              <h3>Export data</h3>
              <p>Download attendance and student records as CSV. Raw biometric data is not included.</p>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Attendance records</h3>
                <p className="panel-subtitle">Full log: session ID, course, timestamp, match confidence, liveness scores, and sync status.</p>
              </div>
              <div className="toolbar-end">
                <a id="btn-export-attendance" href={`${API_BASE}/admin/export/attendance.csv`} target="_blank" rel="noreferrer"
                  className="btn btn-ghost">
                  Download attendance CSV
                </a>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h3 className="panel-title">Student registry</h3>
                <p className="panel-subtitle">All enrolled students: matric number, full name, enrollment date, and twin flag status.</p>
              </div>
              <div className="toolbar-end">
                <a id="btn-export-students" href={`${API_BASE}/admin/export/students.csv`} target="_blank" rel="noreferrer"
                  className="btn btn-ghost">
                  Download students CSV
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div className="modal-backdrop" onClick={() => setEditUser(null)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="edit-user-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 id="edit-user-title" className="panel-title">Edit account</h3>
                <p className="inline-meta">
                  <span>{editUser.email}</span>
                  <span>{editUser.role}</span>
                </p>
              </div>
              <button type="button" className="modal-close-btn" aria-label="Close dialog" onClick={() => setEditUser(null)}><CloseIcon /></button>
            </div>

            {editMsg && <div className="alert alert-danger">{editMsg}</div>}

            <form onSubmit={handleEditUser} className="stack">
              <div className="field-grid">
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-full-name">Full name</label>
                  <input id="edit-full-name" className="form-input" value={editForm.full_name}
                    onChange={e => setEditForm(p => ({...p, full_name: e.target.value}))} required />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="edit-email">Email address</label>
                  <input id="edit-email" className="form-input" type="email" value={editForm.email}
                    onChange={e => setEditForm(p => ({...p, email: e.target.value}))} required />
                </div>
                {editUser.role === 'student' && (
                  <div className="form-group">
                    <label className="form-label" htmlFor="edit-linked-matric">Linked matric number</label>
                    <input id="edit-linked-matric" className="form-input font-mono" value={editForm.linked_matric}
                      onChange={e => setEditForm(p => ({...p, linked_matric: e.target.value}))} />
                  </div>
                )}
                <div className="form-group field-full">
                  <label className="form-label" htmlFor="edit-password">New password <span className="text-muted">(leave blank to keep current)</span></label>
                  <input id="edit-password" className="form-input" type="password" placeholder="••••••••" minLength={8}
                    value={editForm.password}
                    onChange={e => setEditForm(p => ({...p, password: e.target.value}))} />
                </div>
              </div>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEditUser(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={editSaving}>
                  {editSaving ? 'Saving...' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmState && (
        <div className="modal-backdrop" onClick={() => setConfirmState(null)}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 id="confirm-title" className="panel-title">{confirmState.title}</h3>
              </div>
              <button type="button" className="modal-close-btn" aria-label="Close dialog" onClick={() => setConfirmState(null)}><CloseIcon /></button>
            </div>
            <p className="text-sm text-secondary">{confirmState.message}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmState(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={runConfirm}>{confirmState.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
