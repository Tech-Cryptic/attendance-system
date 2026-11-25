import { useState, useEffect, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import QRCode from 'qrcode'
import { API_BASE } from '../../lib/api'
import ExemptionPanel from '../../components/ExemptionPanel'
import PresenceReviewPanel from '../../components/PresenceReviewPanel'
import { toast } from '../../components/Toast'

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export default function SessionPage() {
  const { token } = useAuth()
  const { sessionId } = useParams()

  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState('')
  const [duration, setDuration] = useState(10)
  const [extendedMode, setExtendedMode] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState('')
  const [qrDataURL, setQrDataURL] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [outcomes, setOutcomes] = useState([])
  const [pollError, setPollError] = useState('')
  const [outcomesRefresh, setOutcomesRefresh] = useState(0)
  const [timeLeft, setTimeLeft] = useState(null)
  const [ending, setEnding] = useState(false)
  const [checkpointQr, setCheckpointQr] = useState(null)
  const [checkpointError, setCheckpointError] = useState('')

  const pollRef = useRef(null)
  const timerRef = useRef(null)

  const viewingExisting = Boolean(sessionId)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE}/lecturer/courses`, { headers: authHeaders(token) })
        if (res.ok) setCourses(await res.json())
      } catch {
        setCourses([])
      }
    }
    load()
  }, [token])

  useEffect(() => {
    if (!sessionId) return undefined
    let cancelled = false
    setSessionLoading(true)
    setSessionError('')

    async function load() {
      try {
        const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
          headers: authHeaders(token)
        })
        if (!res.ok) throw new Error('Could not load this session.')
        const data = await res.json()
        if (!cancelled) setSession(data)
      } catch (err) {
        if (!cancelled) setSessionError(err.message ?? 'Could not load this session.')
      } finally {
        if (!cancelled) setSessionLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [sessionId, token])

  useEffect(() => {
    if (!session) return undefined
    function tick() {
      const left = Math.max(0, Math.floor((new Date(session.expires_at) - Date.now()) / 1000))
      setTimeLeft(left)
    }
    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => clearInterval(timerRef.current)
  }, [session])

  useEffect(() => {
    if (!session) return undefined
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

  useEffect(() => {
    if (!session?.session_id || session.active) return undefined
    let cancelled = false

    async function loadOutcomes() {
      try {
        const res = await fetch(`${API_BASE}/presence/sessions/${session.session_id}/outcomes`, {
          headers: authHeaders(token)
        })
        const data = await res.json()
        if (res.ok && !cancelled) setOutcomes(data)
      } catch {
        if (!cancelled) setOutcomes([])
      }
    }

    loadOutcomes()
    return () => { cancelled = true }
  }, [session?.session_id, session?.active, token, outcomesRefresh])

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

      const qrContent = JSON.stringify({ payload: data.qr_payload, signature: data.qr_signature })
      const url = await QRCode.toDataURL(qrContent, {
        width: 400, margin: 2,
        color: { dark: '#17211f', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setQrDataURL(url)
    } catch (err) {
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function generateCheckpoint(eventType) {
    if (!session) return
    setCheckpointError('')
    try {
      const res = await fetch(`${API_BASE}/presence/checkpoints`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          session_id: session.session_id,
          event_type: eventType,
          label: eventType === 'check_out' ? 'End of lecture' : 'Mid-lecture check',
          expires_in_minutes: 10,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Could not generate QR.')

      const content = JSON.stringify({ payload: data.qr_payload, signature: data.qr_signature })
      const url = await QRCode.toDataURL(content, {
        width: 320, margin: 2,
        color: { dark: '#17211f', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      })
      setCheckpointQr({ url, eventType, label: data.label ?? eventType })
      toast.success(`${eventType === 'check_out' ? 'Check-out' : 'Checkpoint'} QR ready.`)
    } catch (err) {
      setCheckpointError(err.message)
    }
  }

  async function handleEndSession() {
    if (!session) return
    setEnding(true)
    try {
      const res = await fetch(`${API_BASE}/sessions/${session.session_id}/end`, {
        method: 'POST', headers: authHeaders(token)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Could not end session.')

      clearInterval(pollRef.current)
      clearInterval(timerRef.current)
      setSession(prev => ({ ...prev, active: false }))
      toast.success(
        `Session ended. Presence: ${data.presence_summary?.present ?? 0} present, ` +
        `${data.presence_summary?.pending_review ?? 0} for review.`
      )
    } catch (err) {
      toast.error(err.message)
    } finally {
      setEnding(false)
    }
  }

  function formatTime(secs) {
    if (secs == null) return '--:--'
    const m = Math.floor(secs / 60), s = secs % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const isExpired = session && (session.is_expired || timeLeft === 0)

  return (
    <div className="focus-page">
      <div className="focus-shell">
        <div className="toolbar">
          <Link to="/lecturer" className="btn btn-ghost btn-sm">Back to sessions</Link>
        </div>

        {sessionLoading && (
          <div className="panel">
            <div className="loading-state">Loading session...</div>
          </div>
        )}

        {sessionError && !sessionLoading && (
          <div className="panel">
            <div className="panel-body stack">
              <div className="alert alert-danger">{sessionError}</div>
              <div className="form-actions">
                <Link to="/lecturer" className="btn btn-subtle">Back to sessions</Link>
              </div>
            </div>
          </div>
        )}

        {!viewingExisting && !session && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Attendance</p>
                <h3 className="panel-title">Start attendance session</h3>
                <p className="panel-subtitle">Select a course and duration. A signed QR code will be issued when the session starts.</p>
              </div>
            </div>
            <div className="panel-body stack">
              {createError && <div className="alert alert-danger">{createError}</div>}

              <form onSubmit={handleCreateSession} className="stack">
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
                      <option value="">Select course</option>
                      {courses.map(c => (
                        <option key={c.course_code} value={c.course_code}>
                          {c.course_code}: {c.course_title} ({c.enrolled_count} enrolled)
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
                  <label className="form-label" htmlFor="duration-slider">
                    Session duration: <span className="text-brand font-semibold">{duration} min</span>
                    <span className="text-muted text-xs">
                      {' '}{duration <= 10 ? '(minimum window)' : duration <= 20 ? '(standard)' : duration <= 30 ? '(maximum standard)' : '(extended, special occasion)'}
                    </span>
                  </label>
                  <input
                    id="duration-slider"
                    type="range"
                    min={extendedMode ? 10 : 10}
                    max={extendedMode ? 120 : 30}
                    step={5}
                    value={duration}
                    onChange={e => setDuration(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div className="inline-meta">
                    <span>10 min</span>
                    {!extendedMode ? (
                      <>
                        <span>20 min</span>
                        <span className="text-warning font-semibold">30 min (max)</span>
                      </>
                    ) : (
                      <>
                        <span>30 min</span>
                        <span>60 min</span>
                        <span className="text-warning font-semibold">120 min (max)</span>
                      </>
                    )}
                  </div>
                  <div className="toolbar">
                    <button
                      id="btn-extended-mode"
                      type="button"
                      onClick={() => {
                        setExtendedMode(v => !v)
                        if (extendedMode && duration > 30) setDuration(30)
                      }}
                      className={`btn btn-sm ${extendedMode ? 'btn-primary' : 'btn-ghost'}`}
                    >
                      {extendedMode ? 'Extended mode on' : 'Enable extended mode'}
                    </button>
                    <span className="text-xs text-muted">For special occasions only. Requires a lecturer override</span>
                  </div>
                  <div className="alert alert-info">
                    <p className="text-xs text-muted">
                      <strong>Policy:</strong> Standard sessions run 10 to 30 minutes. Students must mark attendance within this window. Extended mode (30 to 120 min) is for lab sessions or special examinations.
                    </p>
                  </div>
                </div>

                <div className="form-actions">
                  <button
                    id="btn-start-session"
                    type="submit"
                    className="btn btn-primary"
                    disabled={creating || courses.length === 0}
                  >
                    {creating ? <><div className="spinner" /> Creating session...</> : 'Start session and generate QR'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {session && (
          <div className="stack-lg fade-in-up">
            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">{session.course_code}</p>
                  <h3 className="panel-title">{session.course_title ?? 'Attendance session'}</h3>
                  <p className="panel-subtitle">
                    Started at {new Date(session.started_at).toLocaleString()}. {attendance.length} student{attendance.length !== 1 ? 's' : ''} checked in
                  </p>
                </div>
                <div className="toolbar-end">
                  <span className={`chip ${isExpired ? 'chip-danger' : session.active ? 'chip-success' : ''}`}>
                    {isExpired ? 'Expired' : session.active ? 'Active' : 'Ended'}
                  </span>
                  <span className="font-mono tabular">{formatTime(timeLeft)}</span>
                  {session.active && !isExpired && (
                    <button
                      id="btn-end-session"
                      className="btn btn-sm btn-danger"
                      onClick={handleEndSession}
                      disabled={ending}
                    >
                      {ending ? 'Ending...' : 'End session'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Student check-in</p>
                  <h3 className="panel-title">Session QR</h3>
                </div>
              </div>
              <div className="panel-body stack">
                {viewingExisting ? (
                  <div className="alert alert-info stack-sm">
                    <p>The signed QR code was issued when this session started. It cannot be regenerated from this page.</p>
                    <p className="font-mono">Session ID: {session.session_id}</p>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-muted">Project this QR code so students can scan it with their FaceAttend app.</p>
                    {qrDataURL ? (
                      <div className="text-center">
                        <div className="qr-box">
                          <img src={qrDataURL} alt="Session QR code" width={320} height={320} />
                        </div>
                      </div>
                    ) : (
                      <div className="loading-state">Generating QR code...</div>
                    )}
                    <div className="toolbar">
                      {qrDataURL && (
                        <a
                          href={qrDataURL}
                          download={`session-qr-${session.session_id.slice(0,8)}.png`}
                          className="btn btn-ghost btn-sm"
                          id="btn-download-session-qr"
                        >
                          Download QR
                        </a>
                      )}
                      <span className="chip font-mono">{session.session_id.slice(0, 8)}...</span>
                    </div>
                  </>
                )}

                <div className="stack-sm">
                  <p className="text-sm text-secondary">Generate a short-lived QR when you want to confirm students are still in class.</p>
                  <div className="toolbar">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => generateCheckpoint('checkpoint')}
                      disabled={!session.active}
                    >
                      Midpoint check
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => generateCheckpoint('check_out')}
                      disabled={!session.active}
                    >
                      End-of-class check-out
                    </button>
                  </div>
                  {checkpointError && <p className="form-error">{checkpointError}</p>}
                  {checkpointQr && (
                    <div className="stack-sm">
                      <p className="text-sm text-muted">{checkpointQr.label} (valid 10 minutes)</p>
                      <div className="text-center">
                        <div className="qr-box">
                          <img src={checkpointQr.url} alt={`${checkpointQr.eventType} QR code`} width={220} height={220} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {session.active && !isExpired && (
              <div className="panel">
                <div className="panel-body toolbar">
                  <div className="stack-sm">
                    <h4>Batch face scan</h4>
                    <p className="text-sm text-secondary">
                      Point your camera at groups of up to 15 students. The system detects
                      and matches enrolled faces simultaneously.
                    </p>
                  </div>
                  <a
                    id="btn-batch-scan"
                    href={`/batch-scan/${session.session_id}/${session.course_code}`}
                    className="btn btn-primary"
                  >
                    Open batch scanner
                  </a>
                </div>
              </div>
            )}

            <div className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Live attendance</p>
                  <h3 className="panel-title">Attendance ({attendance.length})</h3>
                </div>
                <span className="chip chip-success">
                  <span className="sync-dot online" /> Live, refreshes every 5s
                </span>
              </div>
              {pollError && <div className="alert alert-warning">{pollError}</div>}
              {attendance.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-label">Waiting for students</span>
                  <p>Attendance records will appear here as students check in.</p>
                </div>
              ) : (
                <div className="table-wrapper">
                  <table className="data-table data-table--wide">
                    <thead>
                      <tr><th>Student</th><th>Matric number</th><th>Checked in</th><th>Match distance</th><th>Sync</th></tr>
                    </thead>
                    <tbody>
                      {attendance.map(rec => (
                        <tr key={rec.matric_number} className="record-enter">
                          <td className="font-medium">{rec.full_name}</td>
                          <td className="font-mono">{rec.matric_number}</td>
                          <td className="tabular">{new Date(rec.matched_at).toLocaleTimeString()}</td>
                          <td className={`tabular ${rec.similarity_distance < 0.35 ? 'text-success' : 'text-warning'}`}>
                            d={rec.similarity_distance?.toFixed(3)}
                          </td>
                          <td>
                            {rec.synced_from_client && (
                              <span className="badge badge-info" title="Synced from offline queue">Synced</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {!session.active && (
              <>
                <PresenceReviewPanel
                  session={session}
                  outcomes={outcomes}
                  onDecision={() => setOutcomesRefresh(n => n + 1)}
                />
                <ExemptionPanel session={session} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
