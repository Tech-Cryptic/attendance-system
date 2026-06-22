import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { initHuman, detectAndEmbed, isHumanReady } from '../lib/faceai/detector'
import { LivenessMonitor, rPPGSampler, computeEAR } from '../lib/faceai/liveness'

/**
 * FaceCamera — Real-time face detection camera component.
 *
 * Features:
 *  - Live webcam feed with mirrored display
 *  - FaceMesh 478-point overlay drawn on canvas
 *  - Coloured bounding box indicating liveness state
 *  - EAR blink detection via LivenessMonitor
 *  - rPPG passive liveness sampling
 *  - Emits detection results to parent via onDetect callback
 *
 * Ref API (useImperativeHandle):
 *  - captureEmbedding()   : capture a single high-quality embedding frame
 *  - getLivenessStatus()  : current LivenessMonitor status
 *  - getRPPGStatus()      : current rPPG analysis result
 *
 * Props:
 *  - onDetect(result)      : called every frame with DetectionResult
 *  - onLivenessChange(st)  : called when liveness state changes
 *  - onModelLoad(progress) : called during model load with { loaded, total }
 *  - mode                  : 'enroll' | 'verify' | 'preview'
 *  - requiredBlinks        : number of blinks for liveness challenge (default 2)
 *  - width / height        : camera resolution (default 640×480)
 */
const FaceCamera = forwardRef(function FaceCamera({
  onDetect,
  onLivenessChange,
  onModelLoad,
  mode = 'preview',
  requiredBlinks = 2,
  width = 640,
  height = 480,
  className = '',
}, ref) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)  // face mesh overlay canvas
  const rafRef    = useRef(null)  // requestAnimationFrame handle
  const streamRef = useRef(null)  // MediaStream

  const livenessMonitorRef = useRef(null)
  const rppgSamplerRef     = useRef(null)

  const [modelState, setModelState] = useState('idle')  // idle|loading|ready|error
  const [loadProgress, setLoadProgress] = useState(0)
  const [cameraState, setCameraState] = useState('off') // off|starting|live|error
  const [lastResult, setLastResult] = useState(null)
  const [livenessStatus, setLivenessStatus] = useState(null)

  // ── Expose API to parent via ref ──────────────────────────────
  useImperativeHandle(ref, () => ({
    captureEmbedding: () => lastResult?.embedding ?? null,
    getLivenessStatus: () => livenessMonitorRef.current?.status() ?? null,
    getRPPGStatus: () => rppgSamplerRef.current?.analyse() ?? null,
    resetLiveness: () => {
      livenessMonitorRef.current?.reset()
      rppgSamplerRef.current?.reset()
    },
    stopCamera: stopCamera,
  }), [lastResult])

  // ── Model initialisation ──────────────────────────────────────
  useEffect(() => {
    if (isHumanReady()) {
      setModelState('ready')
      return
    }
    setModelState('loading')
    initHuman((loaded, total) => {
      setLoadProgress(total > 0 ? loaded / total : 0)
      if (onModelLoad) onModelLoad({ loaded, total })
    })
      .then(() => setModelState('ready'))
      .catch(err => {
        console.error('[FaceCamera] Model load error:', err)
        setModelState('error')
      })
  }, [])

  // ── Liveness monitors ─────────────────────────────────────────
  useEffect(() => {
    livenessMonitorRef.current = new LivenessMonitor({ requiredBlinks, timeoutMs: 20000 })
    rppgSamplerRef.current     = new rPPGSampler({ fps: 30, windowSeconds: 6 })
    return () => {
      livenessMonitorRef.current = null
      rppgSamplerRef.current     = null
    }
  }, [requiredBlinks])

  // ── Camera startup ────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (!videoRef.current) return
    setCameraState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode: 'user',           // front-facing camera
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setCameraState('live')
    } catch (err) {
      console.error('[FaceCamera] Camera error:', err)
      setCameraState('error')
    }
  }, [width, height])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraState('off')
  }, [])

  // Start camera once model is ready
  useEffect(() => {
    if (modelState === 'ready') startCamera()
    return () => stopCamera()
  }, [modelState])

  // ── Inference loop ────────────────────────────────────────────
  useEffect(() => {
    if (cameraState !== 'live' || modelState !== 'ready') return
    if (!videoRef.current || !canvasRef.current) return

    const video  = videoRef.current
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    let frameCount = 0

    async function loop() {
      if (!videoRef.current || !canvasRef.current) return

      // Sync canvas resolution to actual video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth  || width
        canvas.height = video.videoHeight || height
      }

      frameCount++

      let result = null
      try {
        result = await detectAndEmbed(video)
      } catch (err) {
        // Silently ignore per-frame errors (can happen during model loading)
      }

      // Clear overlay
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (result) {
        // ── Draw mesh overlay ────────────────────────────────
        drawFaceMeshOverlay(ctx, result, canvas.width, canvas.height)

        // ── EAR Blink ────────────────────────────────────────
        const livenessStatus = livenessMonitorRef.current?.update(result.annotations)
        if (livenessStatus) {
          setLivenessStatus(livenessStatus)
          if (onLivenessChange) onLivenessChange(livenessStatus)
        }

        // ── rPPG (sample every frame, analyse every 30 frames) ─
        rppgSamplerRef.current?.sample(canvas, result)

        // ── Emit result to parent ─────────────────────────────
        const rppg = frameCount % 30 === 0
          ? rppgSamplerRef.current?.analyse()
          : null

        const enrichedResult = {
          ...result,
          livenessStatus,
          rppgStatus: rppg,
        }
        setLastResult(enrichedResult)
        if (onDetect) onDetect(enrichedResult)
      } else {
        // No face — reset blink state partially
        livenessMonitorRef.current?.update(null)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [cameraState, modelState, onDetect, onLivenessChange])

  // ── Liveness state → box color ────────────────────────────────
  const boxClass = (() => {
    if (!livenessStatus) return ''
    if (livenessStatus.passed) return 'liveness-pass'
    if (livenessStatus.failed) return 'liveness-fail'
    return 'liveness-checking'
  })()

  // ── Status bar content ────────────────────────────────────────
  const statusText = (() => {
    if (modelState === 'loading') {
      return `Loading AI models… ${Math.round(loadProgress * 100)}%`
    }
    if (modelState === 'error')  return '⚠️ Model failed to load'
    if (cameraState === 'error') return '⚠️ Camera access denied'
    if (cameraState === 'starting') return 'Starting camera…'
    if (!lastResult)             return 'Position your face in frame'
    if (livenessStatus?.passed)  return '✅ Liveness confirmed'
    if (livenessStatus?.failed)  return '❌ Liveness timeout — please retry'
    const blinks = livenessStatus?.blinkCount ?? 0
    const req    = livenessStatus?.required   ?? requiredBlinks
    return `👁  Please blink naturally (${blinks}/${req} detected)`
  })()

  const confidenceText = lastResult?.faceScore
    ? `Face: ${Math.round(lastResult.faceScore * 100)}%`
    : ''

  const antispoofText = lastResult?.antispoofScore != null
    ? `Real: ${Math.round(lastResult.antispoofScore * 100)}%`
    : ''

  return (
    <div className={`face-camera-container ${className}`} style={{ position: 'relative', overflow: 'hidden', borderRadius: '16px' }}>
      {/* Video feed */}
      <video
        ref={videoRef}
        className="face-camera-video"
        playsInline
        muted
        autoPlay
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
      />

      {/* Mesh overlay canvas */}
      <canvas
        ref={canvasRef}
        className="face-camera-canvas"
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          transform: 'scaleX(-1)',
        }}
      />

      {/* Scanning corner brackets */}
      <ScanBrackets active={cameraState === 'live' && modelState === 'ready'} />

      {/* Model loading overlay */}
      {modelState === 'loading' && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(8,8,16,0.85)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: '16px', backdropFilter: 'blur(4px)',
        }}>
          <div className="spinner spinner-lg" />
          <p style={{ color: 'var(--text-primary)', fontSize: '14px' }}>
            Loading AI models… {Math.round(loadProgress * 100)}%
          </p>
          <div className="progress-track" style={{ width: '200px' }}>
            <div className="progress-fill" style={{ width: `${loadProgress * 100}%` }} />
          </div>
          <p className="text-xs text-muted">First load may take ~15s. Cached offline after.</p>
        </div>
      )}

      {/* Status bar */}
      <div className="camera-status-bar">
        <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{statusText}</span>
        <div style={{ display: 'flex', gap: '8px', fontSize: '12px', color: 'var(--text-muted)' }}>
          {confidenceText && <span>{confidenceText}</span>}
          {antispoofText  && <span>{antispoofText}</span>}
        </div>
      </div>

      {/* Liveness blink indicator (top-right) */}
      {livenessStatus && !livenessStatus.passed && (
        <div style={{
          position: 'absolute', top: '12px', right: '12px',
          background: 'rgba(8,8,16,0.8)', borderRadius: '20px',
          padding: '4px 12px', fontSize: '12px', fontWeight: 600,
          color: livenessStatus.passed ? 'var(--success)' : 'var(--warning)',
          backdropFilter: 'blur(6px)', border: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <span>👁</span>
          <span>{livenessStatus.blinkCount}/{livenessStatus.required} blinks</span>
        </div>
      )}
    </div>
  )
})

// ── Canvas drawing — FaceMesh overlay ─────────────────────────

/**
 * Draw the 478-point face mesh and coloured bounding box on canvas.
 * Uses raw landmark coordinates from human.js result.
 */
function drawFaceMeshOverlay(ctx, result, canvasW, canvasH) {
  if (!result?.mesh || !result?.box) return

  const [bx, by, bw, bh] = result.box

  // Bounding box
  const antispoofScore = result.antispoofScore ?? 0.5
  const livenessScore  = result.livenessScore  ?? 0.5
  const passiveScore   = (antispoofScore + livenessScore) / 2
  const boxColor = passiveScore > 0.6
    ? 'rgba(16, 185, 129, 0.8)'   // green — likely real
    : passiveScore > 0.35
    ? 'rgba(245, 158, 11, 0.8)'   // amber — uncertain
    : 'rgba(239, 68, 68, 0.8)'    // red — likely spoof

  ctx.strokeStyle = boxColor
  ctx.lineWidth = 2
  ctx.shadowColor = boxColor
  ctx.shadowBlur = 12
  ctx.strokeRect(canvasW - bx - bw, by, bw, bh)  // mirror flip for scaleX(-1) canvas
  ctx.shadowBlur = 0

  // Draw simplified face mesh — only key feature groups for visual clarity
  if (!result.annotations) return
  ctx.strokeStyle = 'rgba(124, 58, 237, 0.45)'
  ctx.lineWidth = 1

  const landmarkGroups = [
    result.annotations.leftEye,
    result.annotations.rightEye,
    result.annotations.leftEyeBrow,
    result.annotations.rightEyeBrow,
    result.annotations.nose,
    result.annotations.lips,
    result.annotations.faceOval,
  ].filter(Boolean)

  for (const group of landmarkGroups) {
    if (!group?.length) continue
    ctx.beginPath()
    for (let i = 0; i < group.length; i++) {
      const [x, y] = group[i]
      // Mirror x coordinate (canvas is scaleX(-1) mirrored)
      const mx = canvasW - x
      if (i === 0) ctx.moveTo(mx, y)
      else ctx.lineTo(mx, y)
    }
    ctx.closePath()
    ctx.stroke()
  }

  // Iris overlay — cyan dots for iris landmarks
  const irisGroups = [result.annotations.leftIris, result.annotations.rightIris].filter(Boolean)
  ctx.fillStyle = 'rgba(6, 182, 212, 0.7)'
  for (const iris of irisGroups) {
    for (const [x, y] of iris) {
      ctx.beginPath()
      ctx.arc(canvasW - x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ── Scanning Corner Brackets SVG ──────────────────────────────

function ScanBrackets({ active }) {
  const color = active ? 'rgba(124, 58, 237, 0.7)' : 'rgba(255,255,255,0.1)'
  const style = {
    position: 'absolute',
    width: 40, height: 40,
    borderColor: color,
    borderStyle: 'solid',
    transition: 'border-color 0.4s',
  }
  const size = 2
  return (
    <>
      <div style={{ ...style, top: 12, left: 12,  borderWidth: `${size}px 0 0 ${size}px` }} />
      <div style={{ ...style, top: 12, right: 12, borderWidth: `${size}px ${size}px 0 0` }} />
      <div style={{ ...style, bottom: 12+32, left: 12,  borderWidth: `0 0 ${size}px ${size}px` }} />
      <div style={{ ...style, bottom: 12+32, right: 12, borderWidth: `0 ${size}px ${size}px 0` }} />
    </>
  )
}

export default FaceCamera
