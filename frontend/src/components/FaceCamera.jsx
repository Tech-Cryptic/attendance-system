import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { initHuman, detectAndEmbed, isHumanReady } from '../lib/faceai/detector'
import { LivenessMonitor, rPPGSampler } from '../lib/faceai/liveness'

const FaceCamera = forwardRef(function FaceCamera({
  onDetect,
  onLivenessChange,
  onModelLoad,
  requiredBlinks = 2,
  width = 640,
  height = 480,
  className = '',
}, ref) {
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const rafRef    = useRef(null)
  const streamRef = useRef(null)

  const livenessMonitorRef = useRef(null)
  const rppgSamplerRef     = useRef(null)

  const [modelState, setModelState] = useState('idle')
  const [loadProgress, setLoadProgress] = useState(0)
  const [cameraState, setCameraState] = useState('off')
  const [lastResult, setLastResult] = useState(null)
  const [livenessStatus, setLivenessStatus] = useState(null)

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setCameraState('off')
  }, [])

  useImperativeHandle(ref, () => ({
    captureEmbedding: () => lastResult?.embedding ?? null,
    getLivenessStatus: () => livenessMonitorRef.current?.status() ?? null,
    getRPPGStatus: () => rppgSamplerRef.current?.analyse() ?? null,
    resetLiveness: () => {
      livenessMonitorRef.current?.reset()
      rppgSamplerRef.current?.reset()
    },
    stopCamera,
  }), [lastResult, stopCamera])

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

  useEffect(() => {
    livenessMonitorRef.current = new LivenessMonitor({ requiredBlinks, timeoutMs: 20000 })
    rppgSamplerRef.current     = new rPPGSampler({ fps: 30, windowSeconds: 6 })
    return () => {
      livenessMonitorRef.current = null
      rppgSamplerRef.current     = null
    }
  }, [requiredBlinks])

  const startCamera = useCallback(async () => {
    if (!videoRef.current) return
    setCameraState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: width },
          height: { ideal: height },
          facingMode: 'user',
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

  useEffect(() => {
    if (modelState === 'ready') startCamera()
    return () => stopCamera()
  }, [modelState, startCamera, stopCamera])

  useEffect(() => {
    if (cameraState !== 'live' || modelState !== 'ready') return
    if (!videoRef.current || !canvasRef.current) return

    const video  = videoRef.current
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    let frameCount = 0

    async function loop() {
      if (!videoRef.current || !canvasRef.current) return

      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width  = video.videoWidth  || width
        canvas.height = video.videoHeight || height
      }

      frameCount++

      let result = null
      try {
        result = await detectAndEmbed(video)
      } catch { /* expected during model loading */ }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (result) {
        drawFaceMeshOverlay(ctx, result, canvas.width)

        const livenessStatus = livenessMonitorRef.current?.update(result.annotations)
        if (livenessStatus) {
          setLivenessStatus(livenessStatus)
          if (onLivenessChange) onLivenessChange(livenessStatus)
        }

        rppgSamplerRef.current?.sample(canvas, result)

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
        livenessMonitorRef.current?.update(null)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [cameraState, modelState, onDetect, onLivenessChange])

  const statusText = (() => {
    if (modelState === 'loading') {
      return `Loading face model... ${Math.round(loadProgress * 100)}%`
    }
    if (modelState === 'error')  return 'Model failed to load'
    if (cameraState === 'error') return 'Camera access denied'
    if (cameraState === 'starting') return 'Starting camera...'
    if (!lastResult)             return 'Position your face in frame'
    if (livenessStatus?.passed)  return 'Liveness confirmed'
    if (livenessStatus?.failed)  return 'Liveness timed out. Please retry'
    const blinks = livenessStatus?.blinkCount ?? 0
    const req    = livenessStatus?.required   ?? requiredBlinks
    return `Please blink naturally (${blinks}/${req} detected)`
  })()

  const confidenceText = lastResult?.faceScore
    ? `Face match: ${Math.round(lastResult.faceScore * 100)}%`
    : ''

  const antispoofText = lastResult?.antispoofScore != null
    ? `Liveness score: ${Math.round(lastResult.antispoofScore * 100)}%`
    : ''

  return (
    <div className={`face-camera-container ${className}`}>
      <span className="sr-only" aria-live="polite">{statusText}</span>
      <video
        ref={videoRef}
        className="face-camera-video"
        playsInline
        muted
        autoPlay
        style={{ transform: 'scaleX(-1)' }}
      />
      <canvas
        ref={canvasRef}
        className="face-camera-canvas"
        style={{ transform: 'scaleX(-1)' }}
      />
      <ScanBrackets active={cameraState === 'live' && modelState === 'ready'} />
      {modelState === 'loading' && (
        <div className="camera-stage-overlay stack">
          <div className="camera-spinner" />
          <p className="font-semibold">Loading face model... {Math.round(loadProgress * 100)}%</p>
          <div className="w-full">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${loadProgress * 100}%` }} />
            </div>
          </div>
          <p className="text-xs">First load may take about 15 seconds. Cached offline after.</p>
        </div>
      )}
      <div className="camera-status-bar">
        <span>{statusText}</span>
        <div className="inline-meta">
          {confidenceText && <span>{confidenceText}</span>}
          {antispoofText  && <span>{antispoofText}</span>}
        </div>
      </div>
      {livenessStatus && !livenessStatus.passed && (
        <div className="chip chip-warning camera-chip">
          <span>{livenessStatus.blinkCount}/{livenessStatus.required} blinks</span>
        </div>
      )}
    </div>
  )
})

function drawFaceMeshOverlay(ctx, result, canvasW) {
  if (!result?.mesh || !result?.box) return

  const [bx, by, bw, bh] = result.box

  const antispoofScore = result.antispoofScore ?? 0.5
  const livenessScore  = result.livenessScore  ?? 0.5
  const passiveScore   = (antispoofScore + livenessScore) / 2
  const boxColor = passiveScore > 0.6
    ? 'rgba(16, 185, 129, 0.8)'
    : passiveScore > 0.35
    ? 'rgba(245, 158, 11, 0.8)'
    : 'rgba(239, 68, 68, 0.8)'

  ctx.strokeStyle = boxColor
  ctx.lineWidth = 2
  ctx.strokeRect(canvasW - bx - bw, by, bw, bh)

  if (!result.annotations) return
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)'
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
      const mx = canvasW - x
      if (i === 0) ctx.moveTo(mx, y)
      else ctx.lineTo(mx, y)
    }
    ctx.closePath()
    ctx.stroke()
  }

  const irisGroups = [result.annotations.leftIris, result.annotations.rightIris].filter(Boolean)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
  for (const iris of irisGroups) {
    for (const [x, y] of iris) {
      ctx.beginPath()
      ctx.arc(canvasW - x, y, 2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function ScanBrackets({ active }) {
  const color = active ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255,255,255,0.18)'
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
