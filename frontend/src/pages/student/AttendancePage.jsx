import { useState, useRef, useCallback, useEffect, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Html5QrcodeScanner, Html5QrcodeScanType } from 'html5-qrcode'
import FaceCamera from '../../components/FaceCamera'
import LivenessGate from '../../components/LivenessGate'
import { matchEmbedding, averageEmbeddings } from '../../lib/faceai/detector'
import { queueAttendance, onSyncEvent, getPendingCount } from '../../lib/sync/syncQueue'
import { queueQrPresenceEvent, getPresencePendingCount } from '../../lib/presence'
import db from '../../lib/db/schema'
import { API_BASE } from '../../lib/api'
import {
  MotionCapturer,
  TouchVectorCapturer,
  KeystrokeCapturer,
  buildBehaviouralProfile,
  compareBehaviouralProfiles
} from '../../lib/behavioural/motionCapture'

const CAPTURE_FRAMES = 5

const STEPS = [
  { value: 0, label: 'Scan QR' },
  { value: 1, label: 'Liveness' },
  { value: 2, label: 'Matching' },
  { value: 5, label: 'Verification' },
  { value: 3, label: 'Done' },
]

export default function AttendancePage() {
  const { token, user } = useAuth()
  const [step, setStep] = useState(0)

  const [scanError,   setScanError]   = useState('')
  const [sessionData, setSessionData] = useState(null)
  const [manualEntry, setManualEntry] = useState(false)
  const [manualCode,  setManualCode]  = useState('')
  const qrDivRef = useRef(null)
  const scannerRef = useRef(null)

  const [livenessStatus, setLivenessStatus] = useState(null)
  const [rppgStatus,     setRppgStatus]     = useState(null)

  const [matchResult,   setMatchResult]  = useState(null)
  const [matchError,    setMatchError]   = useState('')
  const [captureCount,  setCaptureCount] = useState(0)
  const [isProcessing,  setIsProcessing] = useState(false)

  const [pendingCount,  setPendingCount] = useState(0)
  const [isOnline,      setIsOnline]     = useState(navigator.onLine)

  const faceCamRef       = useRef(null)
  const lastDetectionRef = useRef(null)

  const [tempCheckinPayload, setTempCheckinPayload] = useState(null)
  const [typedText, setTypedText] = useState('')
  const traceCanvasRef = useRef(null)
  const typingInputRef = useRef(null)
  const motionCapturer = useRef(null)
  const touchCapturer = useRef(null)
  const keystrokeCapturer = useRef(null)

  useEffect(() => {
    if (step !== 5) return

    motionCapturer.current = new MotionCapturer()
    touchCapturer.current = new TouchVectorCapturer()
    keystrokeCapturer.current = new KeystrokeCapturer()

    motionCapturer.current.start().catch(console.error)

    if (traceCanvasRef.current) {
      touchCapturer.current.start(traceCanvasRef.current)
    }

    if (typingInputRef.current) {
      keystrokeCapturer.current.start(typingInputRef.current)
    }

    return () => {
      motionCapturer.current?.stop()
      touchCapturer.current?.stop()
      keystrokeCapturer.current?.stop()
    }
  }, [step])

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    const unsub = onSyncEvent(async () => {
      setPendingCount((await getPendingCount()) + (await getPresencePendingCount()))
    })
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsub()
    }
  }, [])

  useEffect(() => {
    if (step !== 0 || manualEntry) return
    if (!qrDivRef.current) return

    const scanner = new Html5QrcodeScanner(
      'qr-reader',
      {
        fps: 10,
        qrbox: { width: 240, height: 240 },
        rememberLastUsedCamera: true,
        supportedScanTypes: [Html5QrcodeScanType.SCAN_TYPE_CAMERA],
      },
      false
    )

    scanner.render(
      (text) => handleQRSuccess(text, scanner),
      () => undefined
    )
    scannerRef.current = scanner

    return () => {
      scanner.clear().catch(() => {})
    }
  }, [step, manualEntry])

  async function handleQRSuccess(text, scanner) {
    scanner?.clear().catch(() => {})

    try {
      const parsed = JSON.parse(text)
      const { payload, signature } = parsed
      if (!payload || !signature) throw new Error('Malformed QR')

      const data = JSON.parse(payload)
      const { session_id, course_code, expires_at } = data
      if (!session_id || !course_code) throw new Error('Missing session fields in QR')

      if (expires_at && new Date(expires_at) < new Date()) {
        setScanError('This QR has expired. Ask your lecturer to generate a new one.')
        return
      }

      await queueQrPresenceEvent({
        payload,
        signature,
        matricNumber: user?.matric_number,
        fallbackType: 'check_in',
      })
      setPendingCount((await getPendingCount()) + (await getPresencePendingCount()))

      if (data.event_type === 'checkpoint' || data.event_type === 'check_out') {
        setScanError('')
        setSessionData({ session_id, course_code, expires_at, qr_payload: payload, qr_signature: signature, event_type: data.event_type })
        setStep(3)
        return
      }

      setSessionData({ session_id, course_code, expires_at, qr_payload: payload, qr_signature: signature })
      setScanError('')
      setStep(1)
    } catch {
      setScanError('Invalid QR code. Please scan the lecturer\'s QR.')
    }
  }

  function handleManualSubmit(e) {
    e.preventDefault()
    if (manualCode.trim().length < 8) {
      setScanError('Please enter a valid session code.')
      return
    }
    setScanError('Manual session codes require the backend to be reachable. Scanning QR is preferred.')
  }

  const handleDetect = useCallback((result) => {
    lastDetectionRef.current = result
    if (result.livenessStatus) setLivenessStatus(result.livenessStatus)
    if (result.rppgStatus)     setRppgStatus(result.rppgStatus)

    if (result.livenessStatus?.passed && step === 1) {
      setStep(2)
    }
  }, [step])

  useEffect(() => {
    if (step !== 2 || isProcessing) return

    async function captureAndMatch() {
      setIsProcessing(true)
      setMatchError('')

      try {
        const captured = []
        for (let i = 0; i < CAPTURE_FRAMES; i++) {
          await new Promise(r => setTimeout(r, 800))
          const det = lastDetectionRef.current
          if (det?.embedding) {
            captured.push(det.embedding)
            setCaptureCount(captured.length)
          } else {
            i--
            await new Promise(r => setTimeout(r, 300))
          }
        }
        const courseEmbeddings = await loadCourseEmbeddings(sessionData.course_code)

        if (!courseEmbeddings || courseEmbeddings.length === 0) {
          setMatchError('No enrolled students found for this course. Is the course embedding cache up to date?')
          setIsProcessing(false)
          return
        }

        const probeEmbedding = averageEmbeddings(captured)

        const { match, similarity, distance, band } = matchEmbedding(probeEmbedding, courseEmbeddings)

        if (!match || band === 'reject') {
          setMatchError(`Face not recognised (best similarity: ${(similarity * 100).toFixed(1)}%). Please re-enroll or try again.`)
          setIsProcessing(false)
          return
        }

        if (band === 'uncertain') {
          setMatchError(`Low confidence match (${(similarity * 100).toFixed(1)}%). Please scan your QR code to confirm your identity.`)
          setIsProcessing(false)
          return
        }

        const livenessEAR  = livenessStatus?.ear    ?? null
        const rppgScore    = rppgStatus?.score       ?? null
        const irisDistance = lastDetectionRef.current?.irisDescriptor ? 0 : null

        setMatchResult({ match, similarity, distance })

        const payload = {
          session_id:          sessionData.session_id,
          qr_payload:          sessionData.qr_payload,
          qr_signature:        sessionData.qr_signature,
          embedding:           Array.from(probeEmbedding),
          liveness_ear_score:  livenessEAR,
          liveness_rppg_score: rppgScore,
          iris_distance:       irisDistance,
          method:              'face',
        }

        if (match.high_similarity_flag) {
          setTempCheckinPayload(payload)
          setStep(5)
        } else {
          await queueAttendance(payload)
          setPendingCount((await getPendingCount()) + (await getPresencePendingCount()))
          setStep(3)
        }

      } catch (err) {
        setMatchError(err.message)
      } finally {
        setIsProcessing(false)
      }
    }

    captureAndMatch()
  }, [step])

  async function handleBehaviouralVerify() {
    setIsProcessing(true)
    setMatchError('')

    try {
      motionCapturer.current?.stop()
      touchCapturer.current?.stop()
      keystrokeCapturer.current?.stop()

      const motionFeatures = motionCapturer.current?.extractFeatures()
      const touchFeatures = touchCapturer.current?.extractFeatures()
      const keystrokeFeatures = keystrokeCapturer.current?.extractFeatures()

      if (!touchFeatures || !keystrokeFeatures) {
        throw new Error('Please type your matric number fully and trace the pattern box to verify.')
      }

      const capturedProfile = buildBehaviouralProfile(motionFeatures, touchFeatures, keystrokeFeatures)

      let referenceProfile = matchResult.match.behavioural_profile

      if (!referenceProfile) {
        if (navigator.onLine) {
          const res = await fetch(`${API_BASE}/students/${matchResult.match.matric_number}/behavioural`)
          if (res.ok) {
            const data = await res.json()
            referenceProfile = data.behavioural_profile
          }
        }
      }

      if (!referenceProfile) {
        throw new Error('No reference behavioural profile found. Please register it at enrollment or contact support.')
      }

      const score = compareBehaviouralProfiles(capturedProfile, referenceProfile)

      if (score < 0.65) {
        throw new Error(`Behavioural verification failed (similarity: ${(score * 100).toFixed(1)}%). Try again.`)
      }

      await queueAttendance({
        ...tempCheckinPayload,
        method: 'face_disambiguated'
      })

      setPendingCount((await getPendingCount()) + (await getPresencePendingCount()))
      setStep(3)
    } catch (err) {
      setMatchError(err.message)
      motionCapturer.current?.start().catch(console.error)
      if (traceCanvasRef.current) touchCapturer.current?.start(traceCanvasRef.current)
      if (typingInputRef.current) keystrokeCapturer.current?.start(typingInputRef.current)
    } finally {
      setIsProcessing(false)
    }
  }

  async function loadCourseEmbeddings(courseCode) {
    const cached = await db.biometricStore
      .where('course_code').equals(courseCode)
      .toArray()

    if (cached.length > 0) return cached

    if (!navigator.onLine || !token) return []

    try {
      const res = await fetch(`${API_BASE}/courses/${courseCode}/embeddings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return []
      const data = await res.json()

      const records = data.embeddings.map(e => ({
        matric_number: e.matric_number,
        full_name:     e.full_name,
        course_code:   courseCode,
        embedding:     e.embedding,
        iris_embedding:e.iris_embedding,
        high_similarity_flag: e.high_similarity_flag,
        behavioural_profile: e.behavioural_profile,
        cached_at:     Date.now(),
      }))
      await db.biometricStore.bulkPut(records)
      return records
    } catch {
      return []
    }
  }

  function reset() {
    setStep(0)
    setSessionData(null)
    setLivenessStatus(null)
    setRppgStatus(null)
    setMatchResult(null)
    setMatchError('')
    setCaptureCount(0)
    setIsProcessing(false)
    setScanError('')
    setTempCheckinPayload(null)
    setTypedText('')
  }

  const stepItems = STEPS.map((item, index) =>
    typeof item === 'number'
      ? { value: item, label: `Step ${index + 1}` }
      : { value: item.value, label: item.label }
  )
  const activeStepIndex = stepItems.findIndex(item => item.value === step)
  const isPresenceResult = step === 3 && Boolean(sessionData?.event_type)

  return (
    <div className="focus-page">
      <div className="focus-shell">

        <div className="focus-header">
          <Link to="/student" className="btn btn-ghost btn-sm">Back to dashboard</Link>
          <div className="inline-meta">
            <span className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
            <span>{isOnline ? 'Online' : 'Offline'}</span>
            {pendingCount > 0 && <span className="badge badge-warning">{pendingCount} queued</span>}
          </div>
        </div>

        <div className="steps">
          {stepItems.map((item, i) => (
            <Fragment key={item.value}>
              <div className={`step-item ${i === activeStepIndex ? 'active' : i < activeStepIndex ? 'done' : ''}`}>
                <div className="step-dot">{i + 1}</div>
                <span>{item.label}</span>
                {i < activeStepIndex && <span className="badge badge-success">Done</span>}
              </div>
              {i < stepItems.length - 1 && (
                <div className={`step-connector ${i < activeStepIndex ? 'done' : ''}`} />
              )}
            </Fragment>
          ))}
        </div>

        {step === 0 && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Attendance</div>
                <h3 className="panel-title">Scan session QR</h3>
                <p className="panel-subtitle">
                  Scan the QR code displayed by your lecturer to begin attendance.
                </p>
              </div>
            </div>
            <div className="panel-body stack">
              {scanError && <div className="alert alert-danger">{scanError}</div>}
              {!manualEntry ? (
                <>
                  <div id="qr-reader" ref={qrDivRef} />
                  <button
                    className="btn btn-ghost btn-sm btn-full"
                    onClick={() => { scannerRef.current?.clear().catch(()=>{}); setManualEntry(true) }}
                  >
                    Can't scan? Enter session code manually
                  </button>
                </>
              ) : (
                <form onSubmit={handleManualSubmit} className="stack">
                  <div className="form-group">
                    <label className="form-label" htmlFor="session-code">Session ID</label>
                    <input
                      id="session-code"
                      type="text"
                      className="form-input font-mono"
                      placeholder="Paste session ID from lecturer"
                      value={manualCode}
                      onChange={e => setManualCode(e.target.value)}
                    />
                  </div>
                  <div className="form-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setManualEntry(false)}>
                      Back to scanner
                    </button>
                    <button type="submit" className="btn btn-primary">Continue</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <div className="eyebrow">{sessionData?.course_code}</div>
                <h3 className="panel-title">Liveness check</h3>
                <p className="panel-subtitle">
                  Look at the camera and blink twice to prove you're present.
                </p>
              </div>
            </div>
            <div className="panel-body stack">
              <FaceCamera
                ref={faceCamRef}
                mode="liveness"
                onDetect={handleDetect}
                requiredBlinks={2}
              />
              <LivenessGate status={livenessStatus} rppgScore={rppgStatus?.score ?? null} />
              {livenessStatus?.failed && (
                <button className="btn btn-ghost btn-full" onClick={() => faceCamRef.current?.resetLiveness()}>
                  Retry liveness
                </button>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Identity check</div>
                <h3 className="panel-title">Verifying identity</h3>
                <p className="panel-subtitle">Hold still while we capture and match your face.</p>
              </div>
            </div>
            <div className="panel-body stack">
              <FaceCamera ref={faceCamRef} mode="enroll" onDetect={handleDetect} requiredBlinks={0} />

              <div className="stack-sm">
                <div className="loading-state">
                  <span className="spinner" />
                  <span>{isProcessing ? `Frame ${captureCount}/${CAPTURE_FRAMES}` : 'Queuing...'}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${(captureCount / CAPTURE_FRAMES) * 100}%` }} />
                </div>
              </div>

              {matchError && (
                <div className="alert alert-danger">
                  <span>{matchError}</span>
                  <div className="form-actions">
                    <button className="btn btn-sm btn-ghost" onClick={reset}>Start over</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {isPresenceResult && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <div className="eyebrow">{sessionData.course_code}</div>
                <h2 className="panel-title">Presence submitted</h2>
                <p className="panel-subtitle">
                  {sessionData.event_type === 'check_out' ? 'Check-out submitted for verification' : 'Checkpoint submitted for verification'}
                </p>
              </div>
              <span className="badge badge-info">Submitted</span>
            </div>
            <div className="panel-body stack">
              <div className="inline-meta">
                <span className="text-muted">Session</span>
                <strong className="font-mono">{sessionData.session_id}</strong>
              </div>
              <div className="alert alert-info">
                Your presence evidence is saved on this device. It appears in the lecturer review after sync and verification.
              </div>
              {!isOnline && pendingCount > 0 && (
                <div className="alert alert-warning">
                  You're offline. Your presence record is saved locally and will sync automatically when you reconnect ({pendingCount} pending).
                </div>
              )}
            </div>
            <div className="panel-footer">
              <button className="btn btn-ghost" onClick={reset}>Record another</button>
              <Link to="/student" className="btn btn-primary">Back to dashboard</Link>
            </div>
          </div>
        )}

        {step === 3 && matchResult && !isPresenceResult && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Attendance</div>
                <h2 className="panel-title">Attendance marked</h2>
                <p className="panel-subtitle">Your attendance record has been submitted.</p>
              </div>
              <span className="badge badge-success">Recorded</span>
            </div>
            <div className="panel-body stack">
              <div className="inline-meta">
                <strong>{matchResult.match.full_name}</strong>
                <span className="font-mono">{matchResult.match.matric_number}</span>
              </div>
              <div className="field-grid">
                <div className="stat-card">
                  <div className="stat-value tabular">{(matchResult.similarity * 100).toFixed(1)}%</div>
                  <div className="stat-label">Similarity</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value tabular">{matchResult.distance.toFixed(3)}</div>
                  <div className="stat-label">Distance</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value tabular">{isOnline ? 'Synced' : 'Queued'}</div>
                  <div className="stat-label">Status</div>
                </div>
              </div>
              {!isOnline && pendingCount > 0 && (
                <div className="alert alert-warning">
                  You're offline. Your record is saved locally and will sync automatically when you reconnect ({pendingCount} pending).
                </div>
              )}
            </div>
            <div className="panel-footer">
              <button className="btn btn-ghost" onClick={reset}>Mark another</button>
              <Link to="/student" className="btn btn-primary">Back to dashboard</Link>
            </div>
          </div>
        )}

        {step === 5 && matchResult && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div>
                <div className="eyebrow">Additional check</div>
                <h3 className="panel-title">Behavioural verification required</h3>
                <p className="panel-subtitle">
                  We detected look-alike matches. Trace a circle inside the target box and type your matriculation number below to verify your identity.
                </p>
              </div>
            </div>
            <div className="panel-body stack">
              {matchError && <div className="alert alert-danger">{matchError}</div>}

              <div className="form-group">
                <label className="form-label" htmlFor="behavioural-trace">
                  1. Trace a circle inside this target box
                </label>
                <canvas
                  id="behavioural-trace"
                  ref={traceCanvasRef}
                  aria-label="Trace a circle inside this target box"
                  className="w-full"
                  style={{
                    height: 120,
                    border: '2px dashed var(--accent-border)',
                    borderRadius: 12,
                    background: 'var(--bg-subtle)',
                    userSelect: 'none',
                    touchAction: 'none',
                    cursor: 'crosshair',
                  }}
                >
                  Draw a circle or path here
                </canvas>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="behavioural-typing">
                  2. Type your matriculation number ({matchResult.match.matric_number})
                </label>
                <input
                  ref={typingInputRef}
                  id="behavioural-typing"
                  type="text"
                  className="form-input font-mono"
                  placeholder="Type your matric number here..."
                  value={typedText}
                  onChange={e => setTypedText(e.target.value)}
                  required
                  spellCheck="false"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>
            </div>
            <div className="panel-footer">
              <button className="btn btn-ghost" onClick={reset}>Cancel</button>
              <button
                id="btn-behavioural-verify"
                className="btn btn-primary"
                disabled={isProcessing}
                onClick={handleBehaviouralVerify}
              >
                {isProcessing ? <><span className="spinner" /> Verifying...</> : 'Verify identity'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
