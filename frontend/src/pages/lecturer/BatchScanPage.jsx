/**
 * BatchScanPage — Lecturer-operated multi-face proximity scan
 *
 * Flow:
 *  1. Lecturer opens a live session → navigates here
 *  2. Camera activates with batchConfig (maxDetected: 15)
 *  3. Groups of students step up to the device
 *  4. System detects all faces → matches each against course embeddings
 *  5. Live overlay: green = matched, amber = uncertain, grey = unknown
 *  6. Lecturer taps "Confirm Batch" → records submitted to backend
 *  7. After all groups: "Release Fallback QR" button for unmatched students
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { initHuman, detectAndEmbedAll, matchEmbedding } from '../../lib/faceai/detector'
import { batchConfig } from '../../lib/faceai/humanConfig'
import { getEmbeddingsByCourse } from '../../lib/db/queries'
import { toast } from '../../components/Toast'

import { API_BASE } from '../../lib/api'



// ── Constants ────────────────────────────────────────────────
const SCAN_INTERVAL_MS = 800

export default function BatchScanPage() {
  const { sessionId, courseCode } = useParams()
  const navigate = useNavigate()

  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const scanTimerRef = useRef(null)
  const humanRef    = useRef(null)

  // ── State ────────────────────────────────────────────────
  const [status, setStatus]         = useState('loading')   // loading | ready | scanning | done
  const [detectedFaces, setDetectedFaces] = useState([])    // live detected faces with match info
  const [confirmedMatches, setConfirmedMatches] = useState([]) // accumulated across all groups
  const [courseEmbeddings, setCourseEmbeddings] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [sessionStatus, setSessionStatus] = useState(null)
  const [fallbackReleasing, setFallbackReleasing] = useState(false)
  const [fallbackDone, setFallbackDone] = useState(false)

  // ── Init ─────────────────────────────────────────────────
  useEffect(() => {
    let stream = null

    async function init() {
      try {
        // Load human.js with batch config
        const human = await initHuman()
        // Apply batch config (maxDetected: 15)
        await human.load(batchConfig)
        humanRef.current = human

        // Load course embeddings from IndexedDB
        const embeddings = await getEmbeddingsByCourse(courseCode)
        setCourseEmbeddings(embeddings)

        // Start camera (rear-facing preferred for room scan)
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

  // ── Live Scan Loop ────────────────────────────────────────
  const startScanning = useCallback(() => {
    if (status !== 'ready' && status !== 'scanning') return
    setStatus('scanning')

    scanTimerRef.current = setInterval(async () => {
      if (!videoRef.current || !humanRef.current) return
      if (videoRef.current.readyState < 2) return

      try {
        const faces = await detectAndEmbedAll(videoRef.current, 0.35)

        // Match each detected face against course embeddings
        const matched = faces.map(face => {
          const result = matchEmbedding(face.embedding, courseEmbeddings, 0.60)
          return {
            box:            face.box,
            boxRaw:         face.boxRaw,
            faceScore:      face.faceScore,
            antispoofScore: face.antispoofScore,
            matchResult:    result,
            // Unique key for React
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

  // ── Canvas Overlay ────────────────────────────────────────
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

      // Colour by confidence band
      const color = matchResult.band === 'high'      ? '#166534'
                  : matchResult.band === 'uncertain' ? '#92400e'
                  : '#6b7280'

      // Bounding box
      ctx.strokeStyle = color
      ctx.lineWidth   = 3
      ctx.strokeRect(x, y, w, h)

      // Label
      const label = matchResult.band !== 'reject' && matchResult.match
        ? `${matchResult.match.full_name} ${Math.round(matchResult.similarity * 100)}%`
        : matchResult.band === 'uncertain' ? 'Low confidence'
        : 'Unknown'

      ctx.fillStyle = color
      ctx.fillRect(x, y - 24, Math.min(w, label.length * 8 + 12), 24)
      ctx.fillStyle = '#fff'
      ctx.font      = '13px Inter, sans-serif'
      ctx.fillText(label, x + 6, y - 7)
    }
  }

  // ── Confirm this group ────────────────────────────────────
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

    // Merge — deduplicate by matric_number
    setConfirmedMatches(prev => {
      const existing = new Set(prev.map(m => m.matric_number))
      const newOnes  = toAdd.filter(m => !existing.has(m.matric_number))
      return [...prev, ...newOnes]
    })

    toast.success(`${toAdd.length} student${toAdd.length !== 1 ? 's' : ''} added to batch`)
  }

  // ── Submit all to backend ─────────────────────────────────
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

      // Fetch session status to show matched vs unmatched
      await refreshStatus()
      setStatus('done')
      stopScanning()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Refresh session status ────────────────────────────────
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

  // ── Release fallback QR ───────────────────────────────────
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
      toast.success(`Fallback QR active — valid for 15 minutes`)
      await refreshStatus()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setFallbackReleasing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <button onClick={() => navigate(-1)} style={styles.backBtn}>← Back</button>
        <div>
          <h1 style={styles.title}>Batch Scan</h1>
          <p style={styles.subtitle}>{courseCode} · Session {sessionId?.slice(0, 8)}</p>
        </div>
        <div style={styles.scanBadge}>
          {status === 'scanning' && <span style={styles.liveDot} />}
          <span>{status === 'scanning' ? 'LIVE' : status.toUpperCase()}</span>
        </div>
      </div>

      {/* Camera + Overlay */}
      <div style={styles.cameraWrap}>
        <video ref={videoRef} style={styles.video} muted playsInline />
        <canvas ref={canvasRef} style={styles.canvas} />

        {status === 'loading' && (
          <div style={styles.overlay}>
            <div style={styles.spinner} />
            <p style={{ color: '#ffffff', fontWeight: 600 }}>Loading face model…</p>
          </div>
        )}

        {status === 'ready' && (
          <div style={styles.overlay}>
            <button onClick={startScanning} style={styles.startBtn}>
              Start Scanning
            </button>
            <p style={{ color: '#c8d1cb', marginTop: 8 }}>
              Direct students to step up in groups of up to 15
            </p>
          </div>
        )}
      </div>

      {/* Live detection list */}
      {status === 'scanning' && detectedFaces.length > 0 && (
        <div style={styles.liveList}>
          <h3 style={styles.sectionTitle}>In Frame ({detectedFaces.length})</h3>
          <div style={styles.faceGrid}>
            {detectedFaces.map((f, i) => {
              const m = f.matchResult
              const color = m.band === 'high' ? 'var(--success)'
                          : m.band === 'uncertain' ? 'var(--warning)'
                          : 'var(--text-muted)'
              return (
                <div key={i} style={{ ...styles.faceChip, borderColor: color }}>
                  <span style={{ color, fontWeight: 700 }}>
                    {m.band === 'reject' ? '?' : `${Math.round(m.similarity * 100)}%`}
                  </span>
                  <span style={styles.chipName}>
                    {m.match ? m.match.full_name : 'Unknown'}
                  </span>
                </div>
              )
            })}
          </div>
          <div style={styles.scanControls}>
            <button onClick={confirmGroup} style={styles.confirmBtn}>
              Add Group to Batch
            </button>
            <button onClick={stopScanning} style={styles.stopBtn}>
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Confirmed matches summary */}
      {confirmedMatches.length > 0 && (
        <div style={styles.matchedSection}>
          <h3 style={styles.sectionTitle}>
            Confirmed for Submission ({confirmedMatches.length})
          </h3>
          <div style={styles.matchList}>
            {confirmedMatches.map((m, i) => (
              <div key={i} style={styles.matchRow}>
                <span style={styles.matchName}>{m.full_name}</span>
                <span style={{
                  ...styles.matchBand,
                  background: m.confidence_band === 'high' ? 'var(--success-bg)' : 'var(--warning-bg)',
                  color:      m.confidence_band === 'high' ? 'var(--success)'   : 'var(--warning)',
                }}>
                  {m.confidence_band === 'high' ? 'High' : 'Uncertain'}
                </span>
                <span style={styles.matchDist}>
                  {Math.round((1 - m.similarity_distance) * 100)}% match
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={submitBatch}
            disabled={submitting}
            style={styles.submitBtn}
          >
            {submitting ? 'Saving…' : `Submit ${confirmedMatches.length} Records`}
          </button>
        </div>
      )}

      {/* Post-submission status */}
      {status === 'done' && sessionStatus && (
        <div style={styles.doneSection}>
          <h3 style={styles.sectionTitle}>Scan Complete</h3>
          <div style={styles.statRow}>
            <Stat label="Matched" value={sessionStatus.matched?.length ?? 0} color="var(--success)" />
            <Stat label="Unmatched" value={sessionStatus.unmatched?.length ?? 0} color="var(--warning)" />
            <Stat label="Total Enrolled" value={sessionStatus.total_enrolled ?? 0} color="var(--text-muted)" />
          </div>

          {sessionStatus.unmatched?.length > 0 && !fallbackDone && (
            <div style={styles.fallbackBox}>
              <p style={styles.fallbackText}>
                <strong>{sessionStatus.unmatched.length} enrolled students</strong> were not
                detected in the scan. Release the fallback QR so they can mark attendance from
                their dashboard if they are physically present.
              </p>
              <p style={styles.fallbackSub}>
                Unmatched: {sessionStatus.unmatched.slice(0, 5).map(u => u.full_name).join(', ')}
                {sessionStatus.unmatched.length > 5 ? ` +${sessionStatus.unmatched.length - 5} more` : ''}
              </p>
              <button
                onClick={releaseFallback}
                disabled={fallbackReleasing}
                style={styles.fallbackBtn}
              >
                {fallbackReleasing ? 'Releasing…' : 'Release Fallback QR (15 min window)'}
              </button>
            </div>
          )}

          {fallbackDone && (
            <div style={styles.fallbackSuccess}>
              Fallback QR is live. Unmatched students can use their dashboard to mark attendance.
              Window expires in 15 minutes.
            </div>
          )}

          <button
            onClick={() => navigate(-1)}
            style={styles.doneBtn}
          >
            Return to Session
          </button>
        </div>
      )}
    </div>
  )
}

// ── Sub-component ─────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={styles.statBox}>
      <span style={{ ...styles.statNum, color }}>{value}</span>
      <span style={styles.statLabel}>{label}</span>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────
const styles = {
  page: {
    minHeight: '100dvh',
    background: 'var(--bg-base)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 20px',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-default)',
  },
  backBtn: {
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border-default)',
    color: 'var(--text-secondary)',
    borderRadius: 'var(--radius-md)',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 13,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' },
  subtitle: { margin: 0, fontSize: 12, color: 'var(--text-muted)' },
  scanBadge: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-full)',
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--success)',
  },
  cameraWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16/9',
    background: '#111714',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  canvas: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(24, 30, 27, 0.78)',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid rgba(255,255,255,0.28)',
    borderTop: '3px solid #ffffff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: 12,
  },
  startBtn: {
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '14px 32px',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },
  liveList: {
    padding: '16px 20px',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-default)',
  },
  sectionTitle: {
    margin: '0 0 12px',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  faceGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  faceChip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: 'var(--bg-surface)',
    border: '1.5px solid',
    borderRadius: 'var(--radius-full)',
    fontSize: 13,
  },
  chipName: { color: 'var(--text-primary)', fontSize: 12 },
  scanControls: { display: 'flex', gap: 12 },
  confirmBtn: {
    flex: 1,
    background: 'var(--success)',
    color: 'var(--text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '12px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  stopBtn: {
    background: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 20px',
    fontSize: 14,
    cursor: 'pointer',
  },
  matchedSection: {
    padding: '16px 20px',
    background: 'var(--bg-surface)',
    borderBottom: '1px solid var(--border-default)',
  },
  matchList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 16,
    maxHeight: 220,
    overflowY: 'auto',
  },
  matchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
  },
  matchName: { flex: 1, fontSize: 13, color: 'var(--text-primary)' },
  matchBand: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 'var(--radius-full)',
  },
  matchDist: { fontSize: 12, color: 'var(--text-muted)' },
  submitBtn: {
    width: '100%',
    background: 'var(--accent)',
    color: 'var(--text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '14px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  doneSection: {
    padding: '20px',
    background: 'var(--bg-surface)',
  },
  statRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    background: 'var(--bg-subtle)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  statNum: { fontSize: 28, fontWeight: 700 },
  statLabel: { fontSize: 12, color: 'var(--text-muted)' },
  fallbackBox: {
    background: 'var(--warning-bg)',
    border: '1px solid var(--warning-border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    marginBottom: 16,
  },
  fallbackText: { margin: '0 0 8px', fontSize: 14, color: 'var(--warning)' },
  fallbackSub: { margin: '0 0 12px', fontSize: 12, color: 'var(--text-secondary)' },
  fallbackBtn: {
    width: '100%',
    background: 'var(--warning)',
    color: 'var(--text-inverse)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '12px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  fallbackSuccess: {
    background: 'var(--success-bg)',
    border: '1px solid var(--success-border)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 16px',
    fontSize: 13,
    color: 'var(--success)',
    marginBottom: 16,
  },
  doneBtn: {
    width: '100%',
    background: 'var(--bg-subtle)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    padding: '12px',
    fontSize: 14,
    cursor: 'pointer',
  },
}
