import { useState, useRef, useCallback, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import FaceCamera from '../../components/FaceCamera'
import NDPRConsent from '../../components/NDPRConsent'
import LivenessGate from '../../components/LivenessGate'
import { averageEmbeddings } from '../../lib/faceai/detector'
import QRCode from 'qrcode'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const CAPTURE_FRAMES = 5    // number of frames to average for robust embedding
const CAPTURE_INTERVAL_MS = 800  // wait 800ms between captures

// ── Step configuration ─────────────────────────────────────────
const STEPS = [
  { id: 'token',    label: 'Token'    },
  { id: 'consent',  label: 'Consent'  },
  { id: 'liveness', label: 'Liveness' },
  { id: 'capture',  label: 'Capture'  },
  { id: 'success',  label: 'Complete' },
]

export default function EnrollPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  // ── State ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0)   // 0–4

  // Step 1: Token entry
  const [matricNumber, setMatricNumber] = useState('')
  const [fullName,     setFullName]     = useState('')
  const [token,        setToken]        = useState(searchParams.get('token') ?? '')
  const [tokenError,   setTokenError]   = useState('')
  const [tokenLoading, setTokenLoading] = useState(false)

  // Step 2: NDPR consent metadata
  const [consentData, setConsentData] = useState(null)

  // Step 3 & 4: Liveness + capture
  const [livenessStatus, setLivenessStatus]   = useState(null)
  const [rppgStatus,     setRppgStatus]        = useState(null)
  const [captureProgress, setCaptureProgress]  = useState(0)
  const [capturedEmbeddings, setCapturedEmbeddings] = useState([])
  const [isCapturing, setIsCapturing]          = useState(false)

  // Step 5: Submission
  const [submitting, setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [enrollResult, setEnrollResult] = useState(null) // { matric_number, qr_payload, qr_signature, high_similarity_flag }
  const [qrDataURL, setQrDataURL]    = useState(null)

  const faceCamRef = useRef(null)
  const lastDetectionRef = useRef(null)  // live reference to latest detection result

  // Pre-fill token from URL param
  useEffect(() => {
    const t = searchParams.get('token')
    if (t) setToken(t)
  }, [searchParams])

  // ── Step 1: Validate token ─────────────────────────────────────
  async function handleTokenSubmit(e) {
    e.preventDefault()
    if (!matricNumber.trim() || !fullName.trim() || !token.trim()) {
      setTokenError('All fields are required.')
      return
    }
    setTokenError('')
    setTokenLoading(true)

    try {
      const res = await fetch(`${API_BASE}/enroll/check-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), matric_number: matricNumber.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTokenError(data.detail ?? 'Invalid or expired token.')
        return
      }
      setStep(1)  // → Consent
    } catch {
      // If backend is offline, allow proceeding — token will be validated at submission
      setStep(1)
    } finally {
      setTokenLoading(false)
    }
  }

  // ── Step 2: NDPR Consent accepted ─────────────────────────────
  function handleConsentAccepted(data) {
    setConsentData(data)
    setStep(2)  // → Liveness
  }

  // ── Step 3: Liveness — FaceCamera callback ─────────────────────
  const handleDetect = useCallback((result) => {
    lastDetectionRef.current = result

    if (result.livenessStatus) {
      setLivenessStatus(result.livenessStatus)
      // Auto-advance to capture once liveness passes
      if (result.livenessStatus.passed && step === 2) {
        setStep(3)
      }
    }
    if (result.rppgStatus) {
      setRppgStatus(result.rppgStatus)
    }
  }, [step])

  // ── Step 4: Capture N embeddings ──────────────────────────────
  useEffect(() => {
    if (step !== 3 || isCapturing) return

    async function runCapture() {
      setIsCapturing(true)
      const collected = []

      for (let i = 0; i < CAPTURE_FRAMES; i++) {
        // Wait for a fresh detection result
        await new Promise(resolve => setTimeout(resolve, CAPTURE_INTERVAL_MS))

        const result = lastDetectionRef.current
        if (result?.embedding) {
          collected.push(result.embedding)
          setCaptureProgress((i + 1) / CAPTURE_FRAMES)
        } else {
          // Retry this frame
          i--
          await new Promise(r => setTimeout(r, 300))
        }
      }

      setCapturedEmbeddings(collected)
      setIsCapturing(false)

      // Auto-submit
      await handleSubmit(collected)
    }

    runCapture()
  }, [step])

  // ── Step 5: Submit enrollment ──────────────────────────────────
  async function handleSubmit(embeddings) {
    setSubmitting(true)
    setSubmitError('')

    try {
      const avgEmbedding = averageEmbeddings(embeddings)
      const embeddingArray = Array.from(avgEmbedding)

      // Iris descriptor (supplementary — 25-dim)
      const irisDescriptor = lastDetectionRef.current?.irisDescriptor
      const irisArray = irisDescriptor ? Array.from(irisDescriptor) : null

      const payload = {
        matric_number:   matricNumber.trim(),
        full_name:       fullName.trim(),
        token:           token.trim(),
        embedding:       embeddingArray,      // 1024-dim FaceRes
        iris_embedding:  irisArray,           // 25-dim iris descriptor (optional)
        consent_given:   true,
        consent_version: consentData?.consent_version ?? '1.0',
      }

      const res = await fetch(`${API_BASE}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Enrollment failed.')

      setEnrollResult(data)

      // Generate QR code image from signed payload
      if (data.qr_payload && data.qr_signature) {
        const qrContent = JSON.stringify({
          payload:   data.qr_payload,
          signature: data.qr_signature,
        })
        const url = await QRCode.toDataURL(qrContent, {
          width: 280,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        })
        setQrDataURL(url)
      }

      setStep(4)  // → Success
    } catch (err) {
      setSubmitError(err.message)
      setIsCapturing(false)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: '40px', paddingBottom: '40px' }}>
      <div style={{ width: '100%', maxWidth: 600, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px', justifyContent: 'center' }}>
          <div className="auth-logo" style={{ margin: 0, width: 44, height: 44 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--text-primary)' }}>FaceAttend</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Student Enrollment</div>
          </div>
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <div className="steps" style={{ marginBottom: '32px', gap: 0 }}>
            {STEPS.slice(0, 4).map((s, i) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div className={`step-item ${i === step ? 'active' : i < step ? 'done' : ''}`} style={{ flex: 1 }}>
                  <div className="step-dot">
                    {i < step ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: '11px' }}>{s.label}</span>
                </div>
                {i < 3 && <div className={`step-connector ${i < step ? 'done' : ''}`} style={{ height: '2px', width: '32px', flexShrink: 0 }} />}
              </div>
            ))}
          </div>
        )}

        {/* ── STEP 1: Token Entry ─── */}
        {step === 0 && (
          <div className="card fade-in-up">
            <h3 style={{ marginBottom: '8px' }}>Enter your enrollment details</h3>
            <p className="text-secondary text-sm" style={{ marginBottom: '24px' }}>
              Use the enrollment token provided by your lecturer.
            </p>

            {tokenError && <div className="alert alert-danger" style={{ marginBottom: '16px' }}>{tokenError}</div>}

            <form onSubmit={handleTokenSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="matric">Matric Number</label>
                <input
                  id="matric"
                  type="text"
                  className="form-input font-mono"
                  placeholder="e.g. 22/01DL068"
                  value={matricNumber}
                  onChange={e => setMatricNumber(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="fullname">Full Name</label>
                <input
                  id="fullname"
                  type="text"
                  className="form-input"
                  placeholder="As on your student ID"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="token">Enrollment Token</label>
                <input
                  id="token"
                  type="text"
                  className="form-input font-mono"
                  placeholder="Paste token from your lecturer"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  required
                  spellCheck="false"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>

              <button id="btn-token-continue" type="submit" className="btn btn-primary btn-full" disabled={tokenLoading} style={{ marginTop: '8px' }}>
                {tokenLoading ? <><div className="spinner" /> Validating…</> : 'Continue →'}
              </button>
            </form>

            <p className="text-xs text-muted text-center" style={{ marginTop: '20px' }}>
              No token? Contact your lecturer to issue one for your matric number.
            </p>
          </div>
        )}

        {/* ── STEP 2: NDPR Consent Modal ─── */}
        {step === 1 && (
          <NDPRConsent
            onAccept={handleConsentAccepted}
            onDecline={() => setStep(0)}
          />
        )}

        {/* ── STEP 3: Liveness Gate ─── */}
        {(step === 2 || step === 3) && (
          <div className="card fade-in-up" style={{ padding: '24px' }}>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: 0 }}>
                {step === 2 ? '👁 Liveness Verification' : '📸 Capturing Biometric'}
              </h3>
              <p className="text-secondary text-sm" style={{ marginTop: '4px' }}>
                {step === 2
                  ? 'Look directly at the camera and blink naturally twice to prove you are present.'
                  : 'Hold still while we capture your facial embedding. This takes just a moment.'}
              </p>
            </div>

            {/* Camera */}
            <FaceCamera
              ref={faceCamRef}
              mode={step === 3 ? 'enroll' : 'liveness'}
              onDetect={handleDetect}
              onLivenessChange={setLivenessStatus}
              requiredBlinks={2}
              style={{ marginBottom: '16px' }}
            />

            {/* Liveness status overlay (below camera) */}
            {step === 2 && (
              <div style={{ marginTop: '16px' }}>
                <LivenessGate status={livenessStatus} rppgScore={rppgStatus?.score ?? null} />
              </div>
            )}

            {/* Capture progress */}
            {step === 3 && (
              <div style={{ marginTop: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {submitting ? 'Submitting enrollment…' : `Capturing frame ${Math.round(captureProgress * CAPTURE_FRAMES)}/${CAPTURE_FRAMES}`}
                  </span>
                  <span style={{ color: 'var(--brand-mid)', fontWeight: 600 }}>
                    {submitting ? 'Uploading…' : `${Math.round(captureProgress * 100)}%`}
                  </span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${submitting ? 100 : captureProgress * 100}%`, transition: 'width 0.5s ease' }} />
                </div>
                {submitError && (
                  <div className="alert alert-danger" style={{ marginTop: '16px' }}>
                    {submitError}
                    <button className="btn btn-sm btn-ghost" style={{ marginLeft: '12px' }} onClick={() => { setCaptureProgress(0); setIsCapturing(false); setStep(3) }}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Liveness retry */}
            {step === 2 && livenessStatus?.failed && (
              <button
                id="btn-liveness-retry"
                className="btn btn-ghost btn-full"
                style={{ marginTop: '16px' }}
                onClick={() => faceCamRef.current?.resetLiveness()}
              >
                🔄 Retry Liveness Check
              </button>
            )}
          </div>
        )}

        {/* ── STEP 5: Success ─── */}
        {step === 4 && enrollResult && (
          <div className="card fade-in-up text-center" style={{ padding: '40px 32px' }}>
            {/* Success icon */}
            <div style={{
              width: 72, height: 72, borderRadius: '50%', margin: '0 auto 20px',
              background: 'var(--success-bg)', border: '2px solid var(--success)',
              display: 'grid', placeItems: 'center', fontSize: '32px',
              boxShadow: '0 0 30px rgba(16,185,129,0.3)',
            }}>
              ✅
            </div>

            <h2 style={{ marginBottom: '8px' }}>Enrollment Complete!</h2>
            <p className="text-secondary" style={{ marginBottom: '8px' }}>
              Welcome, <strong style={{ color: 'var(--text-primary)' }}>{enrollResult.full_name}</strong>
            </p>
            <p className="text-sm text-muted" style={{ marginBottom: '24px' }}>
              Matric: <span className="font-mono">{enrollResult.matric_number}</span>
            </p>

            {/* Twin flag warning */}
            {enrollResult.high_similarity_flag && (
              <div className="alert alert-warning" style={{ marginBottom: '20px', textAlign: 'left' }}>
                <strong>⚠️ High Similarity Flag:</strong> Your facial embedding closely matches another enrolled student. Your attendance will require additional behavioural verification. Please inform your lecturer.
              </div>
            )}

            {/* QR Code */}
            {qrDataURL ? (
              <div style={{ marginBottom: '24px' }}>
                <p className="text-sm text-muted" style={{ marginBottom: '16px' }}>
                  This is your personal attendance QR code. Save it for future sessions.
                </p>
                <div className="qr-box" style={{ display: 'inline-block' }}>
                  <img src={qrDataURL} alt="Your enrollment QR code" width={220} height={220} />
                </div>
                <div style={{ marginTop: '16px' }}>
                  <a
                    href={qrDataURL}
                    download={`FaceAttend-QR-${enrollResult.matric_number}.png`}
                    className="btn btn-ghost btn-sm"
                    id="btn-download-qr"
                  >
                    📥 Download QR Code
                  </a>
                </div>
              </div>
            ) : (
              <div className="skeleton" style={{ width: 220, height: 220, margin: '0 auto 24px' }} />
            )}

            {/* NDPR notice */}
            <div style={{
              background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)',
              borderRadius: '10px', padding: '12px 16px',
              fontSize: '12px', color: 'var(--text-muted)', textAlign: 'left',
              marginBottom: '24px',
            }}>
              🔒 Your raw facial images were never stored or transmitted. Only a 1024-dimensional mathematical vector was processed entirely on your device (NDPR compliant).
            </div>

            <button id="btn-enroll-done" className="btn btn-primary btn-full" onClick={() => navigate('/login')}>
              Proceed to Login
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
