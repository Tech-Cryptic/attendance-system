import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import QRCode from 'qrcode'
import { API_BASE } from '../../lib/api'


function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function SessionPage() {
  const { token } = useAuth()

  // ── State ────────────────────────────────────────────────────
  const [courses,        setCourses]        = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [duration,       setDuration]       = useState(10)   // default 10 min
  const [extendedMode,   setExtendedMode]   = useState(false) // lecturer unlocks >30 min
  const [creating,       setCreating]       = useState(false)
  const [createError,    setCreateError]    = useState('')


  const [session,        setSession]        = useState(null)   // active session data
  const [qrDataURL,      setQrDataURL]      = useState(null)
  const [attendance,     setAttendance]     = useState([])
  const [pollError,      setPollError]      = useState('')
  const [timeLeft,       setTimeLeft]       = useState(null)   // seconds remaining
  const [ending,         setEnding]         = useState(false)

  const pollRef  = useRef(null)
  const timerRef = useRef(null)

  // ── Load courses ─────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/lecturer/courses`, { headers: authHeaders(token) })
        if (res.ok) setCourses(await res.json())
      } catch {}
    }
    load()
  }, [token])

  // ── Countdown timer ───────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    function tick() {
      const left = Math.max(0, Math.floor((new Date(session.expires_at) - Date.now()) / 1000))
      setTimeLeft(left)
    }
    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => clearInterval(timerRef.current)
  }, [session])

  // ── Live attendance polling ───────────────────────────────────
  useEffect(() => {
    if (!session) return
    async function poll() {
      try {
        const res = await fetch(`${API_BASE}/sessions/${session.session_id}`, {
          headers: authHeaders(token)
        })
        if (res.ok) {
          const data = await res.json()
          setAttendance(data.records ?? [])
          setPollError('')
        } else {
          setPollError('Poll failed')
        }
      } catch { setPollError('Network error') }
    }
    poll()
    pollRef.current = setInterval(poll, 5000)
    return () => clearInterval(pollRef.current)
  }, [session, token])

  // ── Create session ────────────────────────────────────────────
  async function handleCreateSession(e) {
    e.preventDefault()
    if (!selectedCourse) { setCreateError('Please select a course.'); return }
    setCreating(true); setCreateError('')

    try {
      const res = await fetch(`${API_BASE}/sessions`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ course_code: selectedCourse, duration_minutes: duration })
      })
      const data = await res.json()
      if (!res.ok) { setCreateError(data.detail ?? 'Failed to create session.'); return }

      setSession(data)

      // Generate QR image
      const qrContent = JSON.stringify({ payload: data.qr_payload, signature: data.qr_signature })
      const url = await QRCode.toDataURL(qrContent, {
        width: 400, margin: 2,
        color: { dark: '#0a0a1a', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setQrDataURL(url)
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  // ── End session ───────────────────────────────────────────────
  async function handleEndSession() {
    if (!session) return
    setEnding(true)
    try {
      await fetch(`${API_BASE}/sessions/${session.session_id}/end`, {
        method: 'POST', headers: authHeaders(token)
      })
      clearInterval(pollRef.current)
      clearInterval(timerRef.current)
      setSession(prev => ({ ...prev, active: false }))
    } finally {
      setEnding(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  function formatTime(secs) {
    if (secs == null) return '--:--'
    const m = Math.floor(secs / 60), s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const isExpired = session && timeLeft === 0

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '32px' }}>
      <div style={{ width: '100%', maxWidth: 700, zIndex: 1 }}>

        {/* Back link */}
        <Link to="/lecturer" className="btn btn-ghost btn-sm" style={{ marginBottom: '20px', display: 'inline-flex' }}>
          ← Dashboard
        </Link>

        {/* ── No active session: create form ── */}
        {!session && (
          <div className="card fade-in-up">
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ margin: 0 }}>📡 Start Attendance Session</h2>
              <p className="text-secondary text-sm" style={{ marginTop: '6px' }}>
                Select a course and duration. A signed QR code will appear for students to scan.
              </p>
            </div>

            {createError && <div className="alert alert-danger" style={{ marginBottom: '16px' }}>{createError}</div>}

            <form onSubmit={handleCreateSession} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="course-select">Course</label>
                {courses.length > 0 ? (
                  <select
                    id="course-select"
                    className="form-input"
                    value={selectedCourse}
                    onChange={e => setSelectedCourse(e.target.value)}
                    required
                  >
                    <option value="">— Select a course —</option>
                    {courses.map(c => (
                      <option key={c.course_code} value={c.course_code}>
                        {c.course_code} · {c.course_title} ({c.enrolled_count} enrolled)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="alert alert-warning">
                    No courses found. Ask an admin to create a course and assign it to you.
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">
                  Session Duration —{' '}
                  <span style={{ color: 'var(--brand-mid)', fontWeight: 700 }}>{duration} min</span>
                  <span className="text-muted text-xs" style={{ marginLeft: '8px', fontWeight: 400 }}>
                    {duration <= 10 ? '(minimum window)' : duration <= 20 ? '(standard)' : duration <= 30 ? '(maximum standard)' : '(extended — special occasion)'}
                  </span>
                </label>

                {/* Slider */}
                <input
                  id="duration-slider"
                  type="range"
                  min={extendedMode ? 10 : 10}
                  max={extendedMode ? 120 : 30}
                  step={5}
                  value={duration}
                  onChange={e => setDuration(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer', marginTop: '8px' }}
                />

                {/* Tick labels */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  <span>10 min</span>
                  {!extendedMode ? (
                    <>
                      <span>20 min</span>
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>30 min (max)</span>
                    </>
                  ) : (
                    <>
                      <span>30 min</span>
                      <span>60 min</span>
                      <span style={{ color: 'var(--warning)', fontWeight: 600 }}>120 min (max)</span>
                    </>
                  )}
                </div>

                {/* Extended mode toggle */}
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    id="btn-extended-mode"
                    type="button"
                    onClick={() => {
                      setExtendedMode(v => !v)
                      if (extendedMode && duration > 30) setDuration(30)
                    }}
                    className={`btn btn-sm ${extendedMode ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderColor: extendedMode ? 'var(--warning)' : undefined, color: extendedMode ? 'var(--warning)' : undefined }}
                  >
                    {extendedMode ? '⏱ Extended Mode ON' : '⏱ Enable Extended Mode'}
                  </button>
                  <span className="text-xs text-muted">For special occasions only — requires lecturer override</span>
                </div>

                {/* Policy note */}
                <div style={{ marginTop: '10px', padding: '10px 14px', background: 'var(--accent-muted)', borderRadius: 'var(--radius-md)', border: '1px solid var(--accent-border)' }}>
                  <p className="text-xs text-muted" style={{ margin: 0 }}>
                    📋 <strong>Policy:</strong> Standard sessions run 10–30 minutes. Students must mark attendance within this window. Extended mode (30–120 min) is for lab sessions or special examinations.
                  </p>
                </div>
              </div>

              <button
                id="btn-start-session"
                type="submit"
                className="btn btn-primary"
                disabled={creating || courses.length === 0}
                style={{ marginTop: '8px' }}
              >
                {creating ? <><div className="spinner" /> Creating session…</> : '📡 Start Session & Generate QR'}
              </button>
            </form>
          </div>
        )}

        {/* ── Active session: QR + live list ── */}
        {session && (
          <div className="fade-in-up" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Session header */}
            <div className="card" style={{ background: isExpired ? 'var(--danger-bg)' : 'var(--bg-elevated)', borderColor: isExpired ? 'var(--danger-border)' : 'var(--border-default)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div className="badge badge-brand" style={{ marginBottom: '6px' }}>
                    {session.course_code}
                  </div>
                  <h3 style={{ margin: 0 }}>
                    {isExpired ? '⏰ Session Expired' : (session.active ? '🟢 Session Active' : '🔴 Session Ended')}
                  </h3>
                  <p className="text-secondary text-sm" style={{ marginTop: '4px' }}>
                    {attendance.length} student{attendance.length !== 1 ? 's' : ''} marked attendance
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  {/* Timer */}
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 800,
                    color: (timeLeft ?? 999) < 60 ? 'var(--danger)' : 'var(--accent)',
                    transition: 'color 0.5s',
                  }}>
                    {formatTime(timeLeft)}
                  </div>

                  {session.active && !isExpired && (
                    <button
                      id="btn-end-session"
                      className="btn btn-sm btn-ghost"
                      style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                      onClick={handleEndSession}
                      disabled={ending}
                    >
                      {ending ? 'Ending…' : '⏹ End Session'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* QR Code */}
            <div className="card text-center" style={{ padding: '32px' }}>
              <p className="text-sm text-muted" style={{ marginBottom: '16px' }}>
                Project or display this QR code. Students scan it with their FaceAttend app.
              </p>
              {qrDataURL ? (
                <div className="qr-box">
                  <img src={qrDataURL} alt="Session QR code" width={320} height={320} />
                </div>
              ) : (
                <div className="skeleton" style={{ width: 320, height: 320, margin: '0 auto' }} />
              )}
              <div style={{ marginTop: '16px', display: 'flex', gap: '10px', justifyContent: 'center' }}>
                {qrDataURL && (
                  <a
                    href={qrDataURL}
                    download={`session-qr-${session.session_id.slice(0,8)}.png`}
                    className="btn btn-ghost btn-sm"
                    id="btn-download-session-qr"
                  >
                    📥 Download QR
                  </a>
                )}
                <span className="btn btn-ghost btn-sm font-mono" style={{ cursor: 'default', fontSize: '11px' }}>
                  {session.session_id.slice(0, 8)}…
                </span>
              </div>
            </div>

            {/* ── Batch Scan — Primary attendance method ── */}
            {session.active && !isExpired && (
              <div className="card" style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent-border)',
                padding: 'var(--sp-5)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <h4 style={{ margin: '0 0 var(--sp-1)', color: 'var(--accent)' }}>
                      Batch face scan
                    </h4>
                    <p className="text-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>
                      Point your camera at groups of up to 15 students. The system detects
                      and matches enrolled faces simultaneously.
                    </p>
                  </div>
                  <a
                    id="btn-batch-scan"
                    href={`/batch-scan/${session.session_id}/${session.course_code}`}
                    className="btn btn-primary"
                    style={{ whiteSpace: 'nowrap', fontWeight: 700 }}
                  >
                    Open batch scanner
                  </a>
                </div>
              </div>
            )}

            {/* Live attendance list */}

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
                <h4 style={{ margin: 0 }}>
                  ✅ Attendance ({attendance.length})
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                  <div className="sync-dot online" />
                  Live · refreshes every 5s
                </div>
              </div>

              {pollError && <div className="alert alert-warning text-sm" style={{ marginBottom: '12px' }}>{pollError}</div>}

              {attendance.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>👁</div>
                  Waiting for students to mark attendance…
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {attendance.map((rec, i) => (
                    <div key={rec.matric_number} className="record-enter" style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                      padding: 'var(--sp-2) var(--sp-4)',
                      borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%',
                        background: 'var(--accent-muted)',
                        border: '1px solid var(--accent-border)',
                        display: 'grid', placeItems: 'center',
                        fontSize: 'var(--text-xs)', fontWeight: 700,
                        color: 'var(--accent)',
                        flexShrink: 0,
                      }}>
                        {rec.full_name.charAt(0)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {rec.full_name}
                        </div>
                        <div className="font-mono text-xs text-muted">{rec.matric_number}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          {new Date(rec.matched_at).toLocaleTimeString()}
                        </div>
                        <div style={{ fontSize: '11px', color: rec.similarity_distance < 0.35 ? 'var(--success)' : 'var(--warning)' }}>
                          d={rec.similarity_distance?.toFixed(3)}
                        </div>
                      </div>
                      {rec.synced_from_client && (
                        <div title="Synced from offline queue">
                          <div className="sync-dot syncing" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
