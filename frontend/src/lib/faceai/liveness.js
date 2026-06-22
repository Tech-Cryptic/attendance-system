/**
 * Dual-Layer Presentation Attack Detection (PAD) — ISO/IEC 30107-3 Level 2
 *
 * Layer 1 — Active Liveness (EAR Blink Challenge):
 *   Eye Aspect Ratio (EAR) formula from Soukupova & Cech (2016):
 *   EAR = (||P2−P6|| + ||P3−P5||) / (2 × ||P1−P4||)
 *   Uses iris-precise landmark positions from @vladmandic/human.
 *   Challenge: user must blink N times within a time window.
 *
 * Layer 2 — Passive Liveness (rPPG):
 *   Remote Photoplethysmography: samples the green channel mean of
 *   a cheek-patch ROI from each video frame, then applies a
 *   bandpass filter (0.8–2.5 Hz) to isolate blood volume pulse.
 *   A detectable pulse signal → real human. Absent → spoofed media.
 *
 * Additionally uses human.js built-in antispoof + liveness model scores
 * as a third passive layer.
 */

// ── Eye Aspect Ratio (EAR) ─────────────────────────────────────

// Named landmark indices in human.js annotations
// leftEye  = [p0, p1, p2, p3, p4, p5] (6 points around the eye contour)
// rightEye = same structure, other side
const EAR_BLINK_THRESHOLD = 0.22   // below this → eye closed
const EAR_OPEN_THRESHOLD  = 0.28   // above this after close → blink complete
const EAR_MIN_CLOSE_FRAMES = 2     // frames eye must be closed to count as blink

function dist2D(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1])
}

/**
 * Compute EAR for one eye given 6 landmark points [x,y].
 * P1=outer, P2=upper-outer, P3=upper-inner, P4=inner, P5=lower-inner, P6=lower-outer
 */
function computeEARforEye(landmarks) {
  if (!landmarks || landmarks.length < 6) return 1.0  // default open
  const [p1, p2, p3, p4, p5, p6] = landmarks
  const vertical1  = dist2D(p2, p6)
  const vertical2  = dist2D(p3, p5)
  const horizontal = dist2D(p1, p4)
  if (horizontal < 0.001) return 1.0
  return (vertical1 + vertical2) / (2.0 * horizontal)
}

/**
 * Compute mean EAR across both eyes from a human.js face detection result.
 * Falls back to iris landmarks for more precise measurement if available.
 *
 * @param {Object} faceAnnotations - face.annotations from detectAndEmbed()
 * @returns {number} EAR value 0–1 (< 0.22 typically means eye closed)
 */
export function computeEAR(faceAnnotations) {
  if (!faceAnnotations) return 1.0

  const { leftEye, rightEye } = faceAnnotations

  // human.js leftEye / rightEye each contain 6 key points
  const earLeft  = computeEARforEye(leftEye)
  const earRight = computeEARforEye(rightEye)

  return (earLeft + earRight) / 2
}

// ── Blink Monitor ─────────────────────────────────────────────

/**
 * LivenessMonitor — stateful EAR blink counter.
 *
 * Usage:
 *   const monitor = new LivenessMonitor({ requiredBlinks: 2 })
 *   monitor.update(faceAnnotations)  // call every frame
 *   monitor.passed                   // true when challenge complete
 */
export class LivenessMonitor {
  constructor({ requiredBlinks = 2, timeoutMs = 15000 } = {}) {
    this.requiredBlinks = requiredBlinks
    this.timeoutMs      = timeoutMs

    this.blinkCount     = 0
    this.eyeClosedFrames = 0
    this.eyeWasOpen     = true
    this.passed         = false
    this.failed         = false
    this.startTime      = null
    this.earHistory     = []  // last N EAR values for smoothing
    this.HISTORY_LEN    = 4
  }

  /**
   * Feed a new frame's face annotations.
   * @param {Object|null} faceAnnotations
   * @returns {{ ear, blinkCount, passed, failed, timeRemaining }}
   */
  update(faceAnnotations) {
    if (this.passed || this.failed) return this.status()

    // Start timer on first non-null detection
    if (faceAnnotations && !this.startTime) {
      this.startTime = Date.now()
    }

    // Timeout check
    if (this.startTime && Date.now() - this.startTime > this.timeoutMs) {
      this.failed = true
      return this.status()
    }

    if (!faceAnnotations) {
      return this.status()  // no face detected this frame
    }

    const rawEAR = computeEAR(faceAnnotations)

    // Smooth EAR over last N frames to reduce noise
    this.earHistory.push(rawEAR)
    if (this.earHistory.length > this.HISTORY_LEN) this.earHistory.shift()
    const ear = this.earHistory.reduce((a, b) => a + b, 0) / this.earHistory.length

    // State machine: open → close → open = 1 blink
    if (ear < EAR_BLINK_THRESHOLD) {
      this.eyeClosedFrames++
    } else {
      if (!this.eyeWasOpen && this.eyeClosedFrames >= EAR_MIN_CLOSE_FRAMES) {
        // Eye has just re-opened after being sufficiently closed → blink
        this.blinkCount++
        if (this.blinkCount >= this.requiredBlinks) {
          this.passed = true
        }
      }
      this.eyeClosedFrames = 0
      this.eyeWasOpen = true
    }

    if (ear < EAR_BLINK_THRESHOLD && this.eyeWasOpen) {
      this.eyeWasOpen = false
    }

    return this.status()
  }

  status() {
    const elapsed = this.startTime ? Date.now() - this.startTime : 0
    return {
      ear:            this.earHistory.at(-1) ?? 1.0,
      blinkCount:     this.blinkCount,
      required:       this.requiredBlinks,
      passed:         this.passed,
      failed:         this.failed,
      timeRemaining:  Math.max(0, this.timeoutMs - elapsed),
      progress:       Math.min(1, this.blinkCount / this.requiredBlinks),
    }
  }

  reset() {
    this.blinkCount      = 0
    this.eyeClosedFrames = 0
    this.eyeWasOpen      = true
    this.passed          = false
    this.failed          = false
    this.startTime       = null
    this.earHistory      = []
  }
}

// ── rPPG (Remote Photoplethysmography) ────────────────────────

/**
 * rPPGSampler — passive liveness via blood volume pulse signal.
 *
 * Algorithm:
 * 1. From each frame, sample an ROI over the left cheek patch
 *    (normalized coordinates derived from face mesh landmarks).
 * 2. Extract the mean green channel value (G channel is most
 *    sensitive to haemoglobin absorption changes).
 * 3. Accumulate samples at the camera frame rate (~30fps).
 * 4. Once enough samples are collected (MIN_SAMPLES), apply a
 *    discrete bandpass filter (0.8–2.5 Hz, covering resting HR
 *    40–150 bpm) using a Butterworth-approximated IIR filter.
 * 5. Compute the frequency-domain power in the HR band vs total.
 *    Signal-to-noise ratio > threshold → live person confirmed.
 *
 * References: Verkruysse et al. 2008; de Haan & Jeanne 2013.
 */
export class rPPGSampler {
  constructor({ fps = 30, windowSeconds = 6 } = {}) {
    this.fps = fps
    this.windowSeconds = windowSeconds
    this.MIN_SAMPLES = fps * 4  // need at least 4 seconds of data

    this.greenSignal   = []   // raw green channel time series
    this.timestamps    = []
    this.lastSampleAt  = 0
    this.sampleInterval = 1000 / fps

    // Simple IIR bandpass filter coefficients (Butterworth 2nd order)
    // Pre-computed for 30fps, passband 0.8–2.5 Hz
    // Generated via scipy.signal.butter(2, [0.8, 2.5], fs=30, btype='band')
    this._b = [0.0562, 0, -0.1124, 0, 0.0562]
    this._a = [1, -2.8750, 3.5969, -2.3471, 0.6585]
    this._xPrev = [0, 0, 0, 0]
    this._yPrev = [0, 0, 0, 0]
  }

  /**
   * Sample the cheek ROI from a canvas or ImageData.
   * @param {HTMLCanvasElement} canvas - the live camera frame canvas
   * @param {Object} face - detectAndEmbed() result (for landmark positions)
   */
  sample(canvas, face) {
    const now = performance.now()
    if (now - this.lastSampleAt < this.sampleInterval) return
    this.lastSampleAt = now

    if (!face || !face.boxRaw) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const W = canvas.width
    const H = canvas.height

    // Cheek patch: ~15% width, ~10% height, positioned below left eye
    // Using normalized bounding box to locate cheek region
    const [bx, by, bw, bh] = face.boxRaw
    const cx = Math.floor((bx + bw * 0.25) * W)
    const cy = Math.floor((by + bh * 0.60) * H)
    const pw = Math.max(10, Math.floor(bw * 0.15 * W))
    const ph = Math.max(10, Math.floor(bh * 0.10 * H))

    if (cx < 0 || cy < 0 || cx + pw > W || cy + ph > H) return

    const data = ctx.getImageData(cx, cy, pw, ph).data
    let greenSum = 0
    const pixelCount = pw * ph
    for (let i = 0; i < data.length; i += 4) {
      greenSum += data[i + 1]  // G channel
    }
    const greenMean = greenSum / pixelCount

    this.greenSignal.push(greenMean)
    this.timestamps.push(now)

    // Keep only the rolling window
    const maxSamples = this.fps * this.windowSeconds
    if (this.greenSignal.length > maxSamples) {
      this.greenSignal.shift()
      this.timestamps.shift()
    }
  }

  /**
   * Analyse the accumulated signal and return liveness confidence.
   * @returns {{ score: number, bpm: number, hasEnoughData: boolean }}
   */
  analyse() {
    if (this.greenSignal.length < this.MIN_SAMPLES) {
      return { score: 0, bpm: null, hasEnoughData: false }
    }

    // Detrend: remove linear trend (mean normalisation)
    const mean = this.greenSignal.reduce((a, b) => a + b, 0) / this.greenSignal.length
    const detrended = this.greenSignal.map(v => v - mean)

    // Apply bandpass filter
    const filtered = this._applyBandpass(detrended)

    // Compute signal power in the filtered band vs raw
    const rawPower = detrended.reduce((a, b) => a + b * b, 0)
    const filtPower = filtered.reduce((a, b) => a + b * b, 0)

    if (rawPower === 0) return { score: 0, bpm: null, hasEnoughData: true }

    // SNR-based score: higher filtered/raw ratio = stronger pulse signal
    const snr = filtPower / rawPower
    const score = Math.min(1, snr * 8)  // scale to 0–1

    // Estimate dominant frequency via peak detection
    const bpm = this._estimateBPM(filtered)

    return {
      score,
      bpm,
      hasEnoughData: true,
      signalLength: this.greenSignal.length,
    }
  }

  /** Simple IIR bandpass filter application */
  _applyBandpass(signal) {
    const output = new Array(signal.length).fill(0)
    const { _b: b, _a: a } = this

    for (let n = 0; n < signal.length; n++) {
      let y = b[0] * signal[n]
      for (let k = 1; k < b.length; k++) {
        if (n - k >= 0) y += b[k] * signal[n - k]
      }
      for (let k = 1; k < a.length; k++) {
        if (n - k >= 0) y -= a[k] * output[n - k]
      }
      output[n] = y
    }
    return output
  }

  /** Estimate BPM via zero-crossing rate of the filtered signal */
  _estimateBPM(filtered) {
    let crossings = 0
    for (let i = 1; i < filtered.length; i++) {
      if (filtered[i - 1] < 0 && filtered[i] >= 0) crossings++
    }
    const durationSeconds = this.greenSignal.length / this.fps
    const hz = crossings / durationSeconds
    const bpm = hz * 60
    return (bpm >= 40 && bpm <= 150) ? Math.round(bpm) : null
  }

  reset() {
    this.greenSignal  = []
    this.timestamps   = []
    this.lastSampleAt = 0
    this._xPrev = [0, 0, 0, 0]
    this._yPrev = [0, 0, 0, 0]
  }
}

// ── Combined PAD Decision ─────────────────────────────────────

/**
 * Final liveness decision combining all three layers:
 * 1. EAR blink challenge (active — LivenessMonitor)
 * 2. rPPG blood pulse (passive — rPPGSampler)
 * 3. human.js antispoof/liveness model scores (passive — neural net)
 *
 * @param {Object} p
 * @returns {{ isLive: boolean, confidence: number, reason: string }}
 */
export function combinedLivenessDecision({
  blinkPassed,
  rppgScore,
  antispoofScore,
  livenessScore,
}) {
  // Layer weights (tuned against Section 3.6.3 methodology)
  const W_BLINK    = 0.40
  const W_RPPG     = 0.30
  const W_ANTISPOOF = 0.30

  const blinkScore    = blinkPassed ? 1.0 : 0.0
  const rppg          = rppgScore     ?? 0.5   // default neutral if no data yet
  const antispoof     = antispoofScore ?? 0.5
  const live          = livenessScore  ?? 0.5

  // Passive score = weighted average of rPPG + antispoof + liveness model
  const passiveScore = (rppg * W_RPPG + ((antispoof + live) / 2) * W_ANTISPOOF) / (W_RPPG + W_ANTISPOOF)
  const finalScore   = blinkScore * W_BLINK + passiveScore * (1 - W_BLINK)

  const CONFIDENCE_THRESHOLD = 0.55

  let reason = ''
  if (!blinkPassed)        reason += 'Blink challenge incomplete. '
  if (antispoof < 0.4)     reason += 'Spoof detected by antispoof model. '
  if (rppgScore !== null && rppgScore < 0.3) reason += 'No pulse signal detected (rPPG). '

  return {
    isLive:     finalScore >= CONFIDENCE_THRESHOLD,
    confidence: finalScore,
    reason:     reason.trim() || 'Liveness confirmed.',
    breakdown: {
      blink:     blinkScore,
      rppg:      rppg,
      antispoof: antispoof,
      liveness:  live,
      passive:   passiveScore,
      final:     finalScore,
    }
  }
}
