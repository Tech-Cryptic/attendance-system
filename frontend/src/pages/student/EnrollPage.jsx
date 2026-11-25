import { useState, useRef, useCallback, useEffect, Fragment } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import FaceCamera from '../../components/FaceCamera'
import NDPRConsent from '../../components/NDPRConsent'
import LivenessGate from '../../components/LivenessGate'
import { averageEmbeddings } from '../../lib/faceai/detector'
import QRCode from 'qrcode'
import { API_BASE } from '../../lib/api'
import {
  MotionCapturer,
  TouchVectorCapturer,
  KeystrokeCapturer,
  buildBehaviouralProfile
} from '../../lib/behavioural/motionCapture'

const CAPTURE_FRAMES = 5    // number of frames to average for robust embedding
const CAPTURE_INTERVAL_MS = 800  // wait 800ms between captures

const STEPS = [
  { id: 'details',      label: 'Details' },
  { id: 'consent',      label: 'Consent' },
  { id: 'face',         label: 'Face' },
  { id: 'verification', label: 'Verification' },
  { id: 'done',         label: 'Done' },
]

function stepLabel(item) {
  if (typeof item === 'number') return `Step ${item + 1}`
  if (item && typeof item === 'object') return item.label ?? String(item.id ?? '')
  return String(item)
}

function stepKey(item, index) {
  if (item && typeof item === 'object') return item.id ?? index
  return `${item}-${index}`
}

export default function EnrollPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [step, setStep] = useState(0)

  // Step 1: Token entry
  const [matricNumber, setMatricNumber] = useState('')
  const [fullName,     setFullName]     = useState('')
  const [token,        setToken]        = useState(searchParams.get('token') ?? '')
  const [tokenError,   setTokenError]   = useState('')
  const [tokenLoading, setTokenLoading] = useState(false)

  // Step 2: NDPR consent metadata
  const [consentData, setConsentData] = useState(null)

  // Step 3 and step 4: Liveness and capture
  const [livenessStatus, setLivenessStatus]   = useState(null)
  const [rppgStatus,     setRppgStatus]        = useState(null)
  const [captureProgress, setCaptureProgress]  = useState(0)
  const [isCapturing, setIsCapturing]          = useState(false)

  // Step 5: Submission
  const [submitting, setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [enrollResult, setEnrollResult] = useState(null)
  const [qrDataURL, setQrDataURL]    = useState(null)

  const faceCamRef = useRef(null)
  const lastDetectionRef = useRef(null)

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

  // Pre-fill token from URL param
  useEffect(() => {
    const t = searchParams.get('token')
    if (t) setToken(t)
  }, [searchParams])

  // Step 1: Validate token
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
      setStep(1)
    } catch {
      // If backend is offline, allow proceeding. Token will be validated at submission
      setStep(1)
    } finally {
      setTokenLoading(false)
    }
  }

  // Step 2: NDPR consent accepted
  function handleConsentAccepted(data) {
    setConsentData(data)
    setStep(2)
  }

  // Step 3: FaceCamera callback
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

  // Step 4: Capture embeddings
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

      setIsCapturing(false)

      // Auto-submit
      await handleSubmit(collected)
    }

    runCapture()
  }, [step])

  // Step 5: Submit enrollment
  async function handleSubmit(embeddings) {
    setSubmitting(true)
    setSubmitError('')

    try {
      const avgEmbedding = averageEmbeddings(embeddings)
      const embeddingArray = Array.from(avgEmbedding)

      // Iris descriptor (supplementary, 25-dim)
      const irisDescriptor = lastDetectionRef.current?.irisDescriptor
      const irisArray = irisDescriptor ? Array.from(irisDescriptor) : null

      const payload = {
        matric_number:   matricNumber.trim(),
        full_name:       fullName.trim(),
        token:           token.trim(),
        embedding:       embeddingArray,
        iris_embedding:  irisArray,
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

      if (data.high_similarity_flag) {
        setStep(5)
      } else {
        setStep(4)
      }
    } catch (err) {
      setSubmitError(err.message)
      setIsCapturing(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleBehaviouralSubmit() {
    setSubmitting(true)
    setSubmitError('')

    try {
      motionCapturer.current?.stop()
      touchCapturer.current?.stop()
      keystrokeCapturer.current?.stop()

      const motionFeatures = motionCapturer.current?.extractFeatures()
      const touchFeatures = touchCapturer.current?.extractFeatures()
      const keystrokeFeatures = keystrokeCapturer.current?.extractFeatures()

      if (!touchFeatures || !keystrokeFeatures) {
        throw new Error('Please type your matric number fully and trace the pattern box to collect timing and gestures.')
      }

      const profile = buildBehaviouralProfile(motionFeatures, touchFeatures, keystrokeFeatures)

      const res = await fetch(`${API_BASE}/enroll/behavioural`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matric_number: matricNumber.trim(),
          token: token.trim(),
          behavioural_profile: profile
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? 'Failed to submit behavioural biometrics')

      // Proceed to enrollment complete view
      setStep(4)
    } catch (err) {
      setSubmitError(err.message)
      // Restart capturers
      motionCapturer.current?.start().catch(console.error)
      if (traceCanvasRef.current) touchCapturer.current?.start(traceCanvasRef.current)
      if (typingInputRef.current) keystrokeCapturer.current?.start(typingInputRef.current)
    } finally {
      setSubmitting(false)
    }
  }

  const activeIndex = step === 5 ? 3 : Math.min(step, STEPS.length - 1)

  return (
    <div className="focus-page">
      <div className="focus-shell">
        <div className="inline-meta">
          <div className="auth-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
              <line x1="9" y1="9" x2="9.01" y2="9"/>
              <line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </div>
          <div className="stack-sm">
            <span className="focus-title">FaceAttend</span>
            <span className="eyebrow">Student Enrollment</span>
          </div>
        </div>

        <div className="steps">
          {STEPS.map((item, i) => {
            const state = i === activeIndex ? 'active' : i < activeIndex ? 'done' : ''
            return (
              <Fragment key={stepKey(item, i)}>
                <div className={`step-item ${state}`}>
                  <div className="step-dot" aria-label={i < activeIndex ? 'Complete' : undefined}>
                    {i + 1}
                  </div>
                  <span>{stepLabel(item)}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`step-connector ${i < activeIndex ? 'done' : ''}`} />
                )}
              </Fragment>
            )
          })}
        </div>

        {step === 0 && (
          <div className="focus-card fade-in-up">
            <div className="focus-header">
              <div className="stack-sm">
                <p className="eyebrow">Student enrollment</p>
                <h3 className="panel-title">Enter your enrollment details</h3>
                <p className="focus-subtitle">Use the enrollment token provided by your lecturer.</p>
              </div>
            </div>
            <div className="stack">
              {tokenError && <div className="alert alert-danger">{tokenError}</div>}
              <form onSubmit={handleTokenSubmit} className="stack">
                <div className="form-group">
                  <label className="form-label" htmlFor="matric">Matric number</label>
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
                  <label className="form-label" htmlFor="fullname">Full name</label>
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
                  <label className="form-label" htmlFor="token">Enrollment token</label>
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

                <button id="btn-token-continue" type="submit" className="btn btn-primary btn-full" disabled={tokenLoading}>
                  {tokenLoading ? <span className="loading-state"><span className="spinner" /> Validating...</span> : 'Continue'}
                </button>
              </form>

              <p className="text-muted text-sm">
                No token? Contact your lecturer to issue one for your matric number.
              </p>
            </div>
          </div>
        )}

        {step === 1 && (
          <NDPRConsent
            onAccept={handleConsentAccepted}
            onDecline={() => setStep(0)}
          />
        )}

        {(step === 2 || step === 3) && (
          <div className="focus-card fade-in-up">
            <div className="focus-header">
              <div className="stack-sm">
                <h3 className="panel-title">
                  {step === 2 ? 'Face verification' : 'Capturing biometric'}
                </h3>
                <p className="focus-subtitle">
                  {step === 2
                    ? 'Look directly at the camera and blink naturally twice to prove you are present.'
                    : 'Hold still while we capture your facial embedding. This takes just a moment.'}
                </p>
              </div>
            </div>
            <div className="stack">
              <FaceCamera
                ref={faceCamRef}
                mode={step === 3 ? 'enroll' : 'liveness'}
                onDetect={handleDetect}
                onLivenessChange={setLivenessStatus}
                requiredBlinks={2}
              />

              {step === 2 && (
                <LivenessGate status={livenessStatus} rppgScore={rppgStatus?.score ?? null} />
              )}

              {step === 3 && (
                <div className="stack-sm">
                  <div className="inline-meta">
                    <span className="text-muted">
                      {submitting
                        ? <span className="loading-state"><span className="spinner" /> Submitting enrollment...</span>
                        : `Capturing frame ${Math.round(captureProgress * CAPTURE_FRAMES)}/${CAPTURE_FRAMES}`}
                    </span>
                    <span className="tabular">
                      {submitting ? 'Uploading...' : `${Math.round(captureProgress * 100)}%`}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${submitting ? 100 : captureProgress * 100}%` }} />
                  </div>
                  {submitError && (
                    <div className="alert alert-danger">
                      <span>{submitError}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => { setCaptureProgress(0); setIsCapturing(false); setStep(3) }}>
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 2 && livenessStatus?.failed && (
                <div className="form-actions">
                  <button
                    id="btn-liveness-retry"
                    className="btn btn-ghost"
                    onClick={() => faceCamRef.current?.resetLiveness()}
                  >
                    Retry liveness check
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 4 && enrollResult && (
          <div className="focus-card fade-in-up">
            <div className="stack-lg">
              <div className="stack-sm">
                <span className="chip chip-success">Verified</span>
                <h2 className="focus-title">Enrollment complete</h2>
                <p className="lead">
                  Welcome, <strong>{enrollResult.full_name}</strong>
                </p>
                <p className="inline-meta">
                  Matric: <span className="font-mono tabular">{enrollResult.matric_number}</span>
                </p>
              </div>

              {enrollResult.high_similarity_flag && (
                <div className="alert alert-warning">
                  <strong>High similarity flag:</strong> Your facial embedding closely matches another enrolled student. Your attendance will require additional behavioural verification. Please inform your lecturer.
                </div>
              )}

              {qrDataURL ? (
                <div className="stack-sm">
                  <p className="text-muted text-sm">
                    This is your personal attendance QR code. Save it for future sessions.
                  </p>
                  <div className="qr-box">
                    <img src={qrDataURL} alt="Your enrollment QR code" width={220} height={220} />
                  </div>
                  <div className="form-actions">
                    <a
                      href={qrDataURL}
                      download={`FaceAttend-QR-${enrollResult.matric_number}.png`}
                      className="btn btn-ghost btn-sm"
                      id="btn-download-qr"
                    >
                      Download QR code
                    </a>
                  </div>
                </div>
              ) : (
                <div className="loading-state"><span className="spinner" /> Preparing QR code...</div>
              )}

              <div className="alert alert-info">
                Raw facial images are not stored or transmitted. Only a facial embedding is processed on your device.
              </div>

              <div className="form-actions">
                <button id="btn-enroll-done" className="btn btn-primary btn-full" onClick={() => navigate('/login')}>
                  Proceed to login
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="panel fade-in-up">
            <div className="panel-header">
              <div className="stack-sm">
                <p className="eyebrow">Additional identity check</p>
                <h3 className="panel-title">Behavioural verification</h3>
                <p className="panel-subtitle">
                  Your face embedding matches a look-alike student. We need to collect touch, device motion, and typing dynamics to secure your identity.
                </p>
              </div>
            </div>
            <div className="panel-body stack">
              {submitError && <div className="alert alert-danger">{submitError}</div>}
              <div className="field-grid">
                <div className="form-group field-full">
                  <label className="form-label">Trace a circle inside the target box</label>
                  <div
                    ref={traceCanvasRef}
                    aria-label="Trace a circle or path inside this box"
                    role="img"
                    style={{
                      height: 120,
                      border: '2px dashed var(--accent)',
                      borderRadius: 12,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'rgba(255,255,255,0.02)',
                      userSelect: 'none',
                      touchAction: 'none',
                      cursor: 'crosshair',
                    }}
                  >
                    <span className="text-muted" style={{ pointerEvents: 'none' }}>
                      Draw a circle or path here
                    </span>
                  </div>
                </div>

                <div className="form-group field-full">
                  <label className="form-label" htmlFor="behavioural-typing">Type your matriculation number</label>
                  <input
                    ref={typingInputRef}
                    id="behavioural-typing"
                    type="text"
                    className="form-input font-mono"
                    placeholder="Type your matriculation number here..."
                    value={typedText}
                    onChange={e => setTypedText(e.target.value)}
                    required
                    spellCheck="false"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                  />
                  <p className="inline-meta">
                    Matric: <span className="font-mono tabular">{matricNumber}</span>
                  </p>
                </div>
              </div>
            </div>
            <div className="panel-footer">
              <button
                id="btn-behavioural-submit"
                className="btn btn-primary"
                disabled={submitting}
                onClick={handleBehaviouralSubmit}
              >
                {submitting ? <span className="loading-state"><span className="spinner" /> Saving...</span> : 'Register behavioural biometrics'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
