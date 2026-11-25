import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { initHuman, detectAndEmbedAll, matchEmbedding } from '../../lib/faceai/detector'
import { batchConfig } from '../../lib/faceai/humanConfig'
import { getEmbeddingsByCourse } from '../../lib/db/queries'
import { toast } from '../../components/Toast'

import { API_BASE } from '../../lib/api'


const SCAN_INTERVAL_MS = 800

export default function BatchScanPage() {
  const { sessionId, courseCode } = useParams()
  const navigate = useNavigate()

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const scanTimerRef = useRef(null)
  const humanRef = useRef(null)

  const [status, setStatus]           = useState('loading')
  const [detectedFaces, setDetectedFaces] = useState([])
  const [confirmedMatches, setConfirmedMatches] = useState([])
  const [courseEmbeddings, setCourseEmbeddings] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [sessionStatus, setSessionStatus] = useState(null)
  const [fallbackReleasing, setFallbackReleasing] = useState(false)
  const [fallbackDone, setFallbackDone] = useState(false)

  const statusLabel = {
    loading: 'Loading',
    ready: 'Ready',
    scanning: 'Scanning',
    done: 'Complete',
    error: 'Error',
  }[status] ?? 'Idle'
  const statusChipClass = status === 'scanning' || status === 'done'
    ? 'chip chip-success'
    : status === 'error'
      ? 'chip chip-danger'
      : 'chip chip-warning'
  const statusDotClass = status === 'scanning' || status === 'done'
    ? 'status-dot live'
    : status === 'ready' || status === 'loading'
      ? 'status-dot pending'
      : 'status-dot'

  useEffect(() => {
    let stream = null

    async function init() {
      try {
        const human = await initHuman()
        await human.load(batchConfig)
        humanRef.current = human

        const embeddings = await getEmbeddingsByCourse(courseCode)
        setCourseEmbeddings(embeddings)

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: 1280, height: 720 },
          audio: false
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }

        setStatus('ready')
      } catch (err) {
        console.error('[BatchScan] Init failed:', err)
        toast.error('Camera or model failed to load')
        setStatus('error')
      }
    }

    init()

    return () => {
      if (scanTimerRef.current) clearInterval(scanTimerRef.current)
      if (stream) stream.getTracks().forEach(t => t.stop())
    }
  }, [courseCode])

  const startScanning = useCallback(() => {
    if (status !== 'ready' && status !== 'scanning') return
    setStatus('scanning')

    scanTimerRef.current = setInterval(async () => {
      if (!videoRef.current || !humanRef.current) return
      if (videoRef.current.readyState < 2) return

      try {
        const faces = await detectAndEmbedAll(videoRef.current, 0.35)

        const matched = faces.map(face => {
          const result = matchEmbedding(face.embedding, courseEmbeddings, 0.60)
          return {
            box:            face.box,
            boxRaw:         face.boxRaw,
            faceScore:      face.faceScore,
            antispoofScore: face.antispoofScore,
            matchResult:    result,
            key: `${face.boxRaw?.[0]?.toFixed(2)}-${face.boxRaw?.[1]?.toFixed(2)}`,
          }
        })

        setDetectedFaces(matched)
        drawOverlay(matched)
      } catch (err) {
        console.error('[BatchScan] Scan error:', err)
      }
    }, SCAN_INTERVAL_MS)
  }, [status, courseEmbeddings])

  const stopScanning = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    setStatus('ready')
    setDetectedFaces([])
  }, [])

  function drawOverlay(faces) {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video) return

    canvas.width  = video.videoWidth  || video.clientWidth
    canvas.height = video.videoHeight || video.clientHeight

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    for (const face of faces) {
      const { box, matchResult } = face
      if (!box) continue
      const [x, y, w, h] = box

      const color = matchResult.band === 'high'      ? '#166534'
                  : matchResult.band === 'uncertain' ? '#92400e'
                  : '#6b7280'

      ctx.strokeStyle = color
      ctx.lineWidth   = 3
      ctx.strokeRect(x, y, w, h)

      const label = matchResult.band !== 'reject' && matchResult.match
        ? `${matchResult.match.full_name} ${Math.round(matchResult.similarity * 100)}%`
        : matchResult.band === 'uncertain' ? 'Low confidence'
        : 'Unknown'

      ctx.fillStyle = color
      ctx.fillRect(x, y - 24, Math.min(w, label.length * 8 + 12), 24)
      ctx.fillStyle = '#ffffff'
      ctx.font      = '13px Inter, sans-serif'
      ctx.fillText(label, x + 6, y - 7)
    }
  }

  function confirmGroup() {
    const toAdd = detectedFaces
      .filter(f => f.matchResult.band !== 'reject' && f.matchResult.match)
      .map(f => ({
        matric_number:      f.matchResult.match.matric_number,
        full_name:          f.matchResult.match.full_name,
        similarity_distance: f.matchResult.distance,
        confidence_band:    f.matchResult.band,
        antispoofScore:     f.antispoofScore,
      }))

    setConfirmedMatches(prev => {
      const existing = new Set(prev.map(m => m.matric_number))
      const newOnes  = toAdd.filter(m => !existing.has(m.matric_number))
      return [...prev, ...newOnes]
    })

    toast.success(`${toAdd.length} student${toAdd.length !== 1 ? 's' : ''} added to batch`)
  }

  async function submitBatch() {
    if (confirmedMatches.length === 0) {
      toast.error('No confirmed matches to submit')
      return
    }
    setSubmitting(true)
    try {
      const token = localStorage.getItem('fa_token')
      const payload = {
        session_id: sessionId,
        records: confirmedMatches.map(m => ({
          matric_number:       m.matric_number,
          similarity_distance: m.similarity_distance,
          confidence_band:     m.confidence_band,
        })),
        client_uuid: localStorage.getItem('faceattend_client_uuid') || 'web',
      }
      const res = await fetch(`${API_BASE}/attendance/batch`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Submit failed')

      toast.success(`${data.inserted} records saved`)

      await refreshStatus()
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current)
        scanTimerRef.current = null
      }
      setDetectedFaces([])
      setStatus('done')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function refreshStatus() {
    try {
      const token = localStorage.getItem('fa_token')
      const res = await fetch(`${API_BASE}/attendance/session/${sessionId}/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setSessionStatus(data)
    } catch { setSessionStatus(null) }
  }

  async function releaseFallback() {
    setFallbackReleasing(true)
    try {
      const token = localStorage.getItem('fa_token')
      const res = await fetch(`${API_BASE}/attendance/fallback-release`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Release failed')
      setFallbackDone(true)
      toast.success(`Fallback QR active, valid for 15 minutes`)
      await refreshStatus()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setFallbackReleasing(false)
    }
  }

  return (
    <div className="min-h-screen stack-lg">
      <header className="toolbar">
        <button onClick={() => navigate(-1)} className="btn btn-subtle btn-sm">
          Back to session
        </button>
        <div className="stack-sm">
          <div>
            <p className="eyebrow">Attendance</p>
            <h1 className="panel-title">Batch Scan</h1>
          </div>
          <div className="inline-meta">
            <span><strong>Course</strong> {courseCode}</span>
            <span><strong>Session</strong> <span className="font-mono">{sessionId?.slice(0, 8)}</span></span>
          </div>
        </div>
        <div className="toolbar-end">
          <span className={statusChipClass}>
            <span className={statusDotClass} aria-hidden="true" />
            {statusLabel}
          </span>
        </div>
      </header>

      <span className="sr-only" role="status" aria-live="polite">
        {`${statusLabel}. ${detectedFaces.length} face${detectedFaces.length === 1 ? '' : 's'} detected.`}
      </span>

      <div className="camera-stage">
        <video ref={videoRef} aria-label="Batch scan camera feed" muted playsInline />
        <canvas ref={canvasRef} aria-hidden="true" />

        {status === 'loading' && (
          <div className="camera-stage-overlay">
            <div className="camera-spinner" aria-hidden="true" />
            <p>Loading face model...</p>
          </div>
        )}

        {status === 'ready' && (
          <div className="camera-stage-overlay">
            <button onClick={startScanning} className="btn btn-primary">
              Start Scanning
            </button>
            <p>Direct students to step up in groups of up to 15</p>
          </div>
        )}
      </div>

      {status === 'scanning' && detectedFaces.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live detection</p>
              <h2 className="panel-title">In frame ({detectedFaces.length})</h2>
            </div>
            <span className="chip chip-success">Scanning</span>
          </div>
          <div className="panel-body stack">
            <div className="section-heading">
              <div>
                <h3>Detected faces</h3>
                <p className="text-muted">Review matches before adding the group</p>
              </div>
            </div>
            <div className="inline-meta">
              {detectedFaces.map((f, i) => {
                const m = f.matchResult
                const chipClass = m.band === 'high'
                  ? 'chip chip-success'
                  : m.band === 'uncertain'
                    ? 'chip chip-warning'
                    : 'chip chip-danger'
                return (
                  <span key={i} className={chipClass}>
                    <span className="font-mono tabular">
                      {m.band === 'reject' ? 'Review' : `${Math.round(m.similarity * 100)}%`}
                    </span>
                    <span>{m.match ? m.match.full_name : 'Unknown'}</span>
                  </span>
                )
              })}
            </div>
          </div>
          <div className="panel-footer">
            <button onClick={confirmGroup} className="btn btn-primary">
              Add Group to Batch
            </button>
            <button onClick={stopScanning} className="btn btn-ghost">
              Stop
            </button>
          </div>
        </section>
      )}

      {confirmedMatches.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Submission queue</p>
              <h2 className="panel-title">Confirmed for submission ({confirmedMatches.length})</h2>
            </div>
            <span className="badge badge-info">Pending</span>
          </div>
          <div className="panel-body stack">
            <div className="section-heading">
              <div>
                <h3>Student matches</h3>
                <p className="text-muted">Records included in the next submission</p>
              </div>
            </div>
            <div className="table-wrapper">
              <table className="data-table data-table--wide">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Confidence</th>
                    <th>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedMatches.map((m, i) => (
                    <tr key={i}>
                      <td>{m.full_name}</td>
                      <td>
                        <span className={`badge ${m.confidence_band === 'high' ? 'badge-success' : 'badge-warning'}`}>
                          {m.confidence_band === 'high' ? 'High' : 'Uncertain'}
                        </span>
                      </td>
                      <td className="font-mono tabular">
                        {Math.round((1 - m.similarity_distance) * 100)}% match
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="panel-footer">
            <button
              onClick={submitBatch}
              disabled={submitting}
              className="btn btn-primary btn-full"
            >
              {submitting ? 'Saving...' : `Submit ${confirmedMatches.length} Records`}
            </button>
          </div>
        </section>
      )}

      {status === 'done' && sessionStatus && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Session summary</p>
              <h2 className="panel-title">Scan Complete</h2>
            </div>
            <span className="chip chip-success">Complete</span>
          </div>
          <div className="panel-body stack">
            <div className="metric-row">
              <Stat label="Matched" value={sessionStatus.matched?.length ?? 0} />
              <Stat label="Unmatched" value={sessionStatus.unmatched?.length ?? 0} />
              <Stat label="Total Enrolled" value={sessionStatus.total_enrolled ?? 0} />
            </div>

            {sessionStatus.unmatched?.length > 0 && !fallbackDone && (
              <div className="alert alert-warning stack-sm">
                <p>
                  <strong>{sessionStatus.unmatched.length} enrolled students</strong> were not
                  detected in the scan. Release the fallback QR so they can mark attendance from
                  their dashboard if they are physically present.
                </p>
                <p>
                  Unmatched: {sessionStatus.unmatched.slice(0, 5).map(u => u.full_name).join(', ')}
                  {sessionStatus.unmatched.length > 5 ? ` +${sessionStatus.unmatched.length - 5} more` : ''}
                </p>
                <button
                  onClick={releaseFallback}
                  disabled={fallbackReleasing}
                  className="btn btn-primary btn-full"
                >
                  {fallbackReleasing ? 'Releasing...' : 'Release Fallback QR (15 min window)'}
                </button>
              </div>
            )}

            {fallbackDone && (
              <div className="alert alert-success">
                Fallback QR is live. Unmatched students can use their dashboard to mark attendance.
                Window expires in 15 minutes.
              </div>
            )}
          </div>
          <div className="panel-footer">
            <button
              onClick={() => navigate(-1)}
              className="btn btn-subtle btn-full"
            >
              Return to Session
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="metric-item">
      <span className="metric-value tabular">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  )
}
