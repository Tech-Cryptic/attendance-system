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
const SCAN_INTERVAL_MS = 800       // run inference every 800ms during live scan
const CONFIRM_LOCK_MS  = 2000      // debounce before allowing re-confirm

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
  const [scanCount, setScanCount]   = useState(0)
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
        setScanCount(c => c + 1)
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
      const color = matchResult.band === 'high'      ? '#22c55e'   // green
                  : matchResult.band === 'uncertain' ? '#f59e0b'   // amber
                  : '#6b7280'                                        // grey = no match

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
      const token = localStorage.getItem('token')
      const payload = {
        session_id: sessionId,
        records: confirmedMatches.map(m => ({
          matric_number:       m.matric_number,
          similarity_distance: m.similarity_distance,
          confidence_band:     m.confidence_band,
        })),
        client_uuid: localStorage.getItem('clientUUID') || 'web',
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
      const token = localStorage.getItem('token')
      const res = await fetch(`${API_BASE}/attendance/session/${sessionId}/status`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const data = await res.json()
      setSessionStatus(data)
    } catch {}
  }

  // ── Release fallback QR ───────────────────────────────────
  async function releaseFallback() {
    setFallbackReleasing(true)
    try {
      const token = localStorage.getItem('token')
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
            <p>Loading AI models…</p>
          </div>
        )}

        {status === 'ready' && (
          <div style={styles.overlay}>
            <button onClick={startScanning} style={styles.startBtn}>
              ▶ Start Scanning
            </button>
            <p style={{ color: '#94a3b8', marginTop: 8 }}>
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
              const color = m.band === 'high' ? '#22c55e'
                          : m.band === 'uncertain' ? '#f59e0b'
                          : '#6b7280'
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
              ✓ Add Group to Batch
            </button>
            <button onClick={stopScanning} style={styles.stopBtn}>
              ■ Stop
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
                  background: m.confidence_band === 'high' ? '#16a34a22' : '#d9770622',
                  color:      m.confidence_band === 'high' ? '#16a34a'   : '#d97706',
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
            <Stat label="Matched" value={sessionStatus.matched?.length ?? 0} color="#22c55e" />
            <Stat label="Unmatched" value={sessionStatus.unmatched?.length ?? 0} color="#f59e0b" />
            <Stat label="Total Enrolled" value={sessionStatus.total_enrolled ?? 0} color="#94a3b8" />
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
                {fallbackReleasing ? 'Releasing…' : '📱 Release Fallback QR (15 min window)'}
              </button>
            </div>
          )}

          {fallbackDone && (
            <div style={styles.fallbackSuccess}>
              ✅ Fallback QR is live. Unmatched students can use their dashboard to mark attendance.
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
    background: '#0f172a',
    color: '#f1f5f9',
    fontFamily: 'Inter, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 20px',
    background: '#1e293b',
    borderBottom: '1px solid #334155',
  },
  backBtn: {
    background: 'none',
    border: '1px solid #334155',
    color: '#94a3b8',
    borderRadius: 8,
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: 13,
  },
  title: { margin: 0, fontSize: 18, fontWeight: 700, color: '#f1f5f9' },
  subtitle: { margin: 0, fontSize: 12, color: '#64748b' },
  scanBadge: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: 20,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
    animation: 'pulse 1.2s infinite',
  },
  cameraWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: '16/9',
    background: '#000',
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
    background: 'rgba(15,23,42,0.75)',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #334155',
    borderTop: '3px solid #7c3aed',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: 12,
  },
  startBtn: {
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: 12,
    padding: '14px 32px',
    fontSize: 16,
    fontWeight: 700,
    cursor: 'pointer',
  },
  liveList: {
    padding: '16px 20px',
    borderBottom: '1px solid #1e293b',
  },
  sectionTitle: {
    margin: '0 0 12px',
    fontSize: 14,
    fontWeight: 600,
    color: '#94a3b8',
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
    background: '#1e293b',
    border: '1.5px solid',
    borderRadius: 20,
    fontSize: 13,
  },
  chipName: { color: '#e2e8f0', fontSize: 12 },
  scanControls: { display: 'flex', gap: 12 },
  confirmBtn: {
    flex: 1,
    background: 'linear-gradient(135deg, #16a34a, #15803d)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '12px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  stopBtn: {
    background: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: '12px 20px',
    fontSize: 14,
    cursor: 'pointer',
  },
  matchedSection: {
    padding: '16px 20px',
    borderBottom: '1px solid #1e293b',
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
    background: '#1e293b',
    borderRadius: 8,
  },
  matchName: { flex: 1, fontSize: 13, color: '#e2e8f0' },
  matchBand: {
    fontSize: 11,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
  },
  matchDist: { fontSize: 12, color: '#64748b' },
  submitBtn: {
    width: '100%',
    background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '14px',
    fontSize: 15,
    fontWeight: 700,
    cursor: 'pointer',
  },
  doneSection: {
    padding: '20px',
  },
  statRow: {
    display: 'flex',
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    background: '#1e293b',
    borderRadius: 12,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  statNum: { fontSize: 28, fontWeight: 800 },
  statLabel: { fontSize: 12, color: '#64748b' },
  fallbackBox: {
    background: '#1e293b',
    border: '1px solid #f59e0b44',
    borderRadius: 12,
    padding: '16px',
    marginBottom: 16,
  },
  fallbackText: { margin: '0 0 8px', fontSize: 14, color: '#fbbf24' },
  fallbackSub: { margin: '0 0 12px', fontSize: 12, color: '#64748b' },
  fallbackBtn: {
    width: '100%',
    background: '#f59e0b',
    color: '#0f172a',
    border: 'none',
    borderRadius: 10,
    padding: '12px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  fallbackSuccess: {
    background: '#16a34a22',
    border: '1px solid #16a34a44',
    borderRadius: 10,
    padding: '12px 16px',
    fontSize: 13,
    color: '#4ade80',
    marginBottom: 16,
  },
  doneBtn: {
    width: '100%',
    background: '#1e293b',
    color: '#94a3b8',
    border: '1px solid #334155',
    borderRadius: 10,
    padding: '12px',
    fontSize: 14,
    cursor: 'pointer',
  },
}
