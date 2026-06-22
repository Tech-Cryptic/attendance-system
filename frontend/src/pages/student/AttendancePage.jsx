import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Html5QrcodeScanner, Html5QrcodeScanType } from 'html5-qrcode'
import FaceCamera from '../../components/FaceCamera'
import LivenessGate from '../../components/LivenessGate'
import { matchEmbedding, averageEmbeddings } from '../../lib/faceai/detector'
import { queueAttendance, onSyncEvent, getPendingCount } from '../../lib/sync/syncQueue'
import db from '../../lib/db/schema'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const CAPTURE_FRAMES = 5

// ── Steps ──────────────────────────────────────────────────────
const STEPS = ['Scan QR', 'Liveness', 'Matching', 'Done']

export default function AttendancePage() {
  const { token } = useAuth()
  const [step, setStep] = useState(0)

  // Step 0 — QR scan
  const [scanError,   setScanError]   = useState('')
  const [sessionData, setSessionData] = useState(null)   // { session_id, course_code, expires_at, qr_payload, qr_signature }
  const [manualEntry, setManualEntry] = useState(false)
  const [manualCode,  setManualCode]  = useState('')
  const qrDivRef = useRef(null)
  const scannerRef = useRef(null)

  // Step 1 — Liveness
  const [livenessStatus, setLivenessStatus] = useState(null)
  const [rppgStatus,     setRppgStatus]     = useState(null)

  // Step 2 — Capture & match
  const [embeddings,    setEmbeddings]   = useState([])  // captured this session
  const [matchResult,   setMatchResult]  = useState(null)
  const [matchError,    setMatchError]   = useState('')
  const [captureCount,  setCaptureCount] = useState(0)
  const [isProcessing,  setIsProcessing] = useState(false)

  // Step 3 — Result
  const [pendingCount,  setPendingCount] = useState(0)
  const [isOnline,      setIsOnline]     = useState(navigator.onLine)

  const faceCamRef       = useRef(null)
  const lastDetectionRef = useRef(null)

  // ── Network status ─────────────────────────────────────────
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    // Sync events → update pending count
    const unsub = onSyncEvent(async () => {
      setPendingCount(await getPendingCount())
    })
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
      unsub()
    }
  }, [])

  // ── QR Scanner ────────────────────────────────────────────
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
      false  // verbose = false
    )

    scanner.render(
      (text) => handleQRSuccess(text, scanner),
      (err) => { /* per-frame errors — ignore */ }
    )
    scannerRef.current = scanner

    return () => {
      scanner.clear().catch(() => {})
    }
  }, [step, manualEntry])

  function handleQRSuccess(text, scanner) {
    scanner?.clear().catch(() => {})
    try {
      const parsed = JSON.parse(text)
      const { payload, signature } = parsed
      if (!payload || !signature) throw new Error('Malformed QR')

      const data = JSON.parse(payload)
      const { session_id, course_code, expires_at } = data

      if (!session_id || !course_code) throw new Error('Missing session fields in QR')

      // Basic client-side expiry check
      if (expires_at && new Date(expires_at) < new Date()) {
        setScanError('This session has expired. Ask your lecturer to start a new one.')
        return
      }

      setSessionData({ session_id, course_code, expires_at, qr_payload: payload, qr_signature: signature })
      setScanError('')
      setStep(1)  // → Liveness
    } catch (e) {
      setScanError('Invalid QR code. Please scan the lecturer\'s session QR.')
    }
  }

  function handleManualSubmit(e) {
    e.preventDefault()
    // Accept a session_id directly for fallback mode
    if (manualCode.trim().length < 8) {
      setScanError('Please enter a valid session code.')
      return
    }
    setScanError('Manual session codes require the backend to be reachable. Scanning QR is preferred.')
  }

  // ── Liveness → auto-advance ────────────────────────────────
  const handleDetect = useCallback((result) => {
    lastDetectionRef.current = result
    if (result.livenessStatus) setLivenessStatus(result.livenessStatus)
    if (result.rppgStatus)     setRppgStatus(result.rppgStatus)

    if (result.livenessStatus?.passed && step === 1) {
      setStep(2)  // → Capture & match
    }
  }, [step])

  // ── Capture & match ───────────────────────────────────────
  useEffect(() => {
    if (step !== 2 || isProcessing) return

    async function captureAndMatch() {
      setIsProcessing(true)
      setMatchError('')

      try {
        // 1. Collect N embedding frames
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
        setEmbeddings(captured)

        // 2. Load course embeddings (Dexie first, then backend)
        const courseEmbeddings = await loadCourseEmbeddings(sessionData.course_code)

        if (!courseEmbeddings || courseEmbeddings.length === 0) {
          setMatchError('No enrolled students found for this course. Is the course embedding cache up to date?')
          setIsProcessing(false)
          return
        }

        // 3. Average frames → stable probe embedding
        const probeEmbedding = averageEmbeddings(captured)

        // 4. Course-scoped nearest-neighbour match
        const { match, similarity, distance } = matchEmbedding(probeEmbedding, courseEmbeddings)

        if (!match) {
          setMatchError(`Face not recognised (best similarity: ${(similarity * 100).toFixed(1)}%). Please re-enroll or try again.`)
          setIsProcessing(false)
          return
        }

        // 5. Queue attendance record (offline-first)
        const livenessEAR  = livenessStatus?.ear    ?? null
        const rppgScore    = rppgStatus?.score       ?? null
        const irisDistance = lastDetectionRef.current?.irisDescriptor ? 0 : null

        await queueAttendance({
          session_id:          sessionData.session_id,
          qr_payload:          sessionData.qr_payload,
          qr_signature:        sessionData.qr_signature,
          embedding:           Array.from(probeEmbedding),
          liveness_ear_score:  livenessEAR,
          liveness_rppg_score: rppgScore,
          iris_distance:       irisDistance,
          method:              'face',
        })

        setMatchResult({ match, similarity, distance })
        setPendingCount(await getPendingCount())
        setStep(3)  // → Done

      } catch (err) {
        setMatchError(err.message)
      } finally {
        setIsProcessing(false)
      }
    }

    captureAndMatch()
  }, [step])

  // ── Load course embeddings (offline-first) ─────────────────
  async function loadCourseEmbeddings(courseCode) {
    // 1. Try Dexie cache first
    const cached = await db.biometricStore
      .where('course_code').equals(courseCode)
      .toArray()

    if (cached.length > 0) return cached

    // 2. Fetch from backend and cache
    if (!navigator.onLine || !token) return []

    try {
      const res = await fetch(`${API_BASE}/courses/${courseCode}/embeddings`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) return []
      const data = await res.json()

      // Cache in Dexie
      const records = data.embeddings.map(e => ({
        matric_number: e.matric_number,
        full_name:     e.full_name,
        course_code:   courseCode,
        embedding:     e.embedding,
        iris_embedding:e.iris_embedding,
        high_similarity_flag: e.high_similarity_flag,
        cached_at:     Date.now(),
      }))
      await db.biometricStore.bulkPut(records)
      return records
    } catch {
      return []
    }
  }

  // ── Reset for retry ────────────────────────────────────────
  function reset() {
    setStep(0)
    setSessionData(null)
    setLivenessStatus(null)
    setRppgStatus(null)
    setMatchResult(null)
    setMatchError('')
    setCaptureCount(0)
    setIsProcessing(false)
    setEmbeddings([])
    setScanError('')
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '32px' }}>
      <div style={{ width: '100%', maxWidth: 560, zIndex: 1 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <Link to="/student" className="btn btn-ghost btn-sm">← Dashboard</Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <div className={`sync-dot ${isOnline ? 'online' : 'offline'}`} />
            {isOnline ? 'Online' : 'Offline'}
            {pendingCount > 0 && <span className="badge badge-warning">{pendingCount} queued</span>}
          </div>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: '0', marginBottom: '24px' }}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div className={`step-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} style={{ margin: '0 auto 4px', width: 28, height: 28, fontSize: '12px' }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <div style={{ fontSize: '10px', color: i === step ? 'var(--brand-mid)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {s}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ height: 2, flex: 0.5, background: i < step ? 'var(--brand-mid)' : 'var(--border-subtle)', transition: 'background 0.3s', margin: '0 4px', marginBottom: '20px' }} />
              )}
            </div>
          ))}
        </div>

        {/* ── STEP 0: QR Scan ── */}
        {step === 0 && (
          <div className="card fade-in-up">
            <h3 style={{ marginBottom: '6px' }}>📷 Scan Session QR</h3>
            <p className="text-secondary text-sm" style={{ marginBottom: '20px' }}>
              Scan the QR code displayed by your lecturer to begin attendance.
            </p>

            {scanError && <div className="alert alert-danger" style={{ marginBottom: '16px' }}>{scanError}</div>}

            {!manualEntry ? (
              <>
                {/* QR scanner renders here */}
                <div id="qr-reader" ref={qrDivRef} style={{ borderRadius: '12px', overflow: 'hidden' }} />

                <button
                  className="btn btn-ghost btn-sm btn-full"
                  style={{ marginTop: '16px' }}
                  onClick={() => { scannerRef.current?.clear().catch(()=>{}); setManualEntry(true) }}
                >
                  Can't scan? Enter session code manually
                </button>
              </>
            ) : (
              <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">Session ID</label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    placeholder="Paste session ID from lecturer"
                    value={manualCode}
                    onChange={e => setManualCode(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setManualEntry(false)}>
                    ← Back to Scanner
                  </button>
                  <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>Continue</button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* ── STEP 1: Liveness ── */}
        {step === 1 && (
          <div className="card fade-in-up">
            <div style={{ marginBottom: '12px' }}>
              <div className="badge badge-brand" style={{ marginBottom: '6px' }}>{sessionData?.course_code}</div>
              <h3 style={{ margin: 0 }}>👁 Liveness Check</h3>
              <p className="text-secondary text-sm" style={{ marginTop: '4px' }}>
                Look at the camera and blink twice to prove you're present.
              </p>
            </div>
            <FaceCamera
              ref={faceCamRef}
              mode="liveness"
              onDetect={handleDetect}
              requiredBlinks={2}
            />
            <div style={{ marginTop: '16px' }}>
              <LivenessGate status={livenessStatus} rppgScore={rppgStatus?.score ?? null} />
            </div>
            {livenessStatus?.failed && (
              <button className="btn btn-ghost btn-full" style={{ marginTop: '12px' }}
                onClick={() => faceCamRef.current?.resetLiveness()}>
                🔄 Retry Liveness
              </button>
            )}
          </div>
        )}

        {/* ── STEP 2: Capture & Match ── */}
        {step === 2 && (
          <div className="card fade-in-up">
            <h3 style={{ margin: '0 0 8px' }}>🔍 Verifying Identity</h3>
            <p className="text-secondary text-sm" style={{ marginBottom: '20px' }}>
              Hold still while we capture and match your face.
            </p>

            <FaceCamera ref={faceCamRef} mode="enroll" onDetect={handleDetect} requiredBlinks={0} />

            <div style={{ marginTop: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px' }}>
                <span className="text-secondary">
                  {isProcessing ? `Frame ${captureCount}/${CAPTURE_FRAMES}` : 'Queuing…'}
                </span>
                <span style={{ color: 'var(--brand-mid)', fontWeight: 600 }}>
                  {Math.round((captureCount / CAPTURE_FRAMES) * 100)}%
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(captureCount / CAPTURE_FRAMES) * 100}%`, transition: 'width 0.4s ease' }} />
              </div>
            </div>

            {matchError && (
              <div className="alert alert-danger" style={{ marginTop: '16px' }}>
                {matchError}
                <button className="btn btn-sm btn-ghost" style={{ marginTop: '10px' }} onClick={reset}>
                  Start Over
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Done ── */}
        {step === 3 && matchResult && (
          <div className="card fade-in-up text-center" style={{ padding: '40px 32px' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
              background: 'var(--success-bg)', border: '2px solid var(--success)',
              display: 'grid', placeItems: 'center', fontSize: '32px',
              boxShadow: '0 0 30px rgba(16,185,129,0.3)',
            }}>
              ✅
            </div>

            <h2 style={{ marginBottom: '6px' }}>Attendance Marked!</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '4px' }}>
              {matchResult.match.full_name}
            </p>
            <p className="font-mono text-sm text-muted" style={{ marginBottom: '20px' }}>
              {matchResult.match.matric_number}
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
              <div className="stat-card" style={{ minWidth: 100 }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--success)' }}>
                  {(matchResult.similarity * 100).toFixed(1)}%
                </div>
                <div className="stat-label">Similarity</div>
              </div>
              <div className="stat-card" style={{ minWidth: 100 }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--brand-mid)' }}>
                  {matchResult.distance.toFixed(3)}
                </div>
                <div className="stat-label">Distance</div>
              </div>
              <div className="stat-card" style={{ minWidth: 100 }}>
                <div style={{ fontSize: '18px', fontWeight: 800, color: isOnline ? 'var(--success)' : 'var(--warning)' }}>
                  {isOnline ? 'Synced' : 'Queued'}
                </div>
                <div className="stat-label">Status</div>
              </div>
            </div>

            {!isOnline && pendingCount > 0 && (
              <div className="alert alert-warning text-sm" style={{ marginBottom: '16px', textAlign: 'left' }}>
                📶 You're offline. Your record is saved locally and will sync automatically when you reconnect ({pendingCount} pending).
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={reset}>Mark Another</button>
              <Link to="/student" className="btn btn-primary">Back to Dashboard</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
