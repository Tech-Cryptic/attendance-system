/**
 * Behavioural Biometrics — Multi-modal Branch for Twin Disambiguation
 *
 * Addresses Section 3.5.3 of the methodology:
 * When two enrolled students have cosine similarity < 0.30 (high_similarity_flag),
 * the system triggers a 30-second behavioural profiling session to collect:
 *
 * Channel 1 — Micro-Tremor (DeviceMotion API):
 *   Captures linear acceleration from the IMU sensor at ~60Hz.
 *   The micro-tremor profile (involuntary hand movement) is unique per individual.
 *   Features: RMS acceleration, dominant frequency band, variance per axis.
 *
 * Channel 2 — Touch Velocity Vector (Pointer Events):
 *   Records touch/drag velocity, pressure (if available), and trajectory
 *   when the user is asked to trace a simple on-screen pattern.
 *   Features: mean velocity, acceleration, curvature, pressure signature.
 *
 * The combined profile is stored as behavioural_profile JSONB in the DB
 * and is matched using a simple nearest-neighbour comparison at attendance time.
 */

// ── DeviceMotion Capture ───────────────────────────────────────

export class MotionCapturer {
  constructor() {
    this.samples = []
    this.isActive = false
    this._handler = null
    this.startTime = null
  }

  /**
   * Request DeviceMotion permission (required on iOS 13+) and start capture.
   * @returns {Promise<boolean>} true if permission granted
   */
  async start() {
    // iOS 13+ requires explicit permission
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const permission = await DeviceMotionEvent.requestPermission()
      if (permission !== 'granted') return false
    }

    if (!window.DeviceMotionEvent) {
      console.warn('[MotionCapturer] DeviceMotion API not available on this device.')
      return false
    }

    this.samples = []
    this.isActive = true
    this.startTime = performance.now()

    this._handler = (event) => {
      if (!this.isActive) return
      const { acceleration, accelerationIncludingGravity, rotationRate, interval } = event
      this.samples.push({
        t:   performance.now() - this.startTime,
        ax:  acceleration?.x ?? 0,
        ay:  acceleration?.y ?? 0,
        az:  acceleration?.z ?? 0,
        agx: accelerationIncludingGravity?.x ?? 0,
        agy: accelerationIncludingGravity?.y ?? 0,
        agz: accelerationIncludingGravity?.z ?? 0,
        rrAlpha: rotationRate?.alpha ?? 0,
        rrBeta:  rotationRate?.beta  ?? 0,
        rrGamma: rotationRate?.gamma ?? 0,
        interval: interval ?? 16,
      })
    }

    window.addEventListener('devicemotion', this._handler)
    return true
  }

  stop() {
    this.isActive = false
    if (this._handler) {
      window.removeEventListener('devicemotion', this._handler)
      this._handler = null
    }
  }

  /**
   * Extract a compact statistical feature vector from the motion samples.
   * @returns {Object} micro-tremor feature profile
   */
  extractFeatures() {
    if (this.samples.length < 10) return null

    const axes = ['ax', 'ay', 'az']
    const features = {}

    for (const axis of axes) {
      const values = this.samples.map(s => s[axis])
      const mean   = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
      const rms    = Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length)
      const max    = Math.max(...values.map(Math.abs))

      // Zero-crossing rate (approximates dominant frequency)
      let crossings = 0
      for (let i = 1; i < values.length; i++) {
        if ((values[i - 1] < mean) !== (values[i] < mean)) crossings++
      }
      const zcr = crossings / (this.samples.length / 60)  // per second

      features[axis] = { mean, variance, rms, max, zcr }
    }

    // Overall RMS (L2 norm of acceleration vector)
    const overallRMS = Math.sqrt(
      this.samples.reduce((a, s) => a + s.ax ** 2 + s.ay ** 2 + s.az ** 2, 0) / this.samples.length
    )

    return {
      sampleCount: this.samples.length,
      durationMs:  this.samples.at(-1)?.t ?? 0,
      axes:        features,
      overallRMS,
    }
  }
}

// ── Touch Velocity Capture ─────────────────────────────────────

export class TouchVectorCapturer {
  constructor() {
    this.events  = []
    this.isActive = false
    this._moveHandler  = null
    this._startHandler = null
    this._endHandler   = null
    this.startTime = null
  }

  start(targetElement) {
    this.events   = []
    this.isActive = true
    this.startTime = performance.now()

    this._startHandler = (e) => {
      const touch = e.changedTouches?.[0] ?? e
      this.events.push({
        type: 'start', t: performance.now() - this.startTime,
        x: touch.clientX, y: touch.clientY,
        pressure: touch.force ?? touch.pressure ?? 0,
      })
    }

    this._moveHandler = (e) => {
      if (!this.isActive) return
      const touch = e.changedTouches?.[0] ?? e
      this.events.push({
        type: 'move', t: performance.now() - this.startTime,
        x: touch.clientX, y: touch.clientY,
        pressure: touch.force ?? touch.pressure ?? 0,
      })
    }

    this._endHandler = (e) => {
      const touch = e.changedTouches?.[0] ?? e
      this.events.push({
        type: 'end', t: performance.now() - this.startTime,
        x: touch.clientX, y: touch.clientY,
      })
    }

    const el = targetElement ?? window
    el.addEventListener('touchstart', this._startHandler, { passive: true })
    el.addEventListener('touchmove',  this._moveHandler,  { passive: true })
    el.addEventListener('touchend',   this._endHandler,   { passive: true })
    // Also capture mouse for desktop testing
    el.addEventListener('mousedown',  this._startHandler)
    el.addEventListener('mousemove',  this._moveHandler)
    el.addEventListener('mouseup',    this._endHandler)
    this._target = el
  }

  stop() {
    this.isActive = false
    if (this._target) {
      this._target.removeEventListener('touchstart', this._startHandler)
      this._target.removeEventListener('touchmove',  this._moveHandler)
      this._target.removeEventListener('touchend',   this._endHandler)
      this._target.removeEventListener('mousedown',  this._startHandler)
      this._target.removeEventListener('mousemove',  this._moveHandler)
      this._target.removeEventListener('mouseup',    this._endHandler)
    }
  }

  /**
   * Compute velocity, acceleration, and curvature from touch trajectory.
   */
  extractFeatures() {
    const moves = this.events.filter(e => e.type === 'move')
    if (moves.length < 5) return null

    const velocities = []
    const accelerations = []

    for (let i = 1; i < moves.length; i++) {
      const dt = moves[i].t - moves[i - 1].t
      if (dt <= 0) continue
      const dx = moves[i].x - moves[i - 1].x
      const dy = moves[i].y - moves[i - 1].y
      const vel = Math.hypot(dx, dy) / dt * 1000  // px/s
      velocities.push(vel)
    }

    for (let i = 1; i < velocities.length; i++) {
      const dt = moves[i + 1]?.t - moves[i]?.t
      if (dt <= 0) continue
      accelerations.push((velocities[i] - velocities[i - 1]) / (dt / 1000))
    }

    const meanVel  = velocities.reduce((a, b) => a + b, 0)  / velocities.length
    const maxVel   = Math.max(...velocities)
    const stdVel   = Math.sqrt(velocities.reduce((a, b) => a + (b - meanVel) ** 2, 0) / velocities.length)

    const meanAcc  = accelerations.length
      ? accelerations.reduce((a, b) => a + b, 0) / accelerations.length
      : 0
    const maxAcc   = accelerations.length ? Math.max(...accelerations.map(Math.abs)) : 0

    const meanPressure = moves
      .filter(e => e.pressure > 0)
      .reduce((a, b, _, arr) => a + b.pressure / arr.length, 0)

    return {
      sampleCount: moves.length,
      velocity:   { mean: meanVel, max: maxVel, std: stdVel },
      acceleration: { mean: meanAcc, max: maxAcc },
      pressure:   { mean: meanPressure },
    }
  }
}

// ── Keystroke dynamics capture ────────────────────────────────
export class KeystrokeCapturer {
  constructor() {
    this.keyEvents = []
    this.isActive = false
    this.startTime = null
    this._keydownHandler = null
    this._keyupHandler = null
  }

  start(inputElement) {
    if (!inputElement) return
    this.keyEvents = []
    this.isActive = true
    this.startTime = performance.now()

    this._keydownHandler = (e) => {
      if (!this.isActive) return
      if (e.repeat) return // ignore repeated keys when held down
      
      this.keyEvents.push({
        type: 'keydown',
        key: e.key,
        t: performance.now() - this.startTime
      })
    }

    this._keyupHandler = (e) => {
      if (!this.isActive) return
      this.keyEvents.push({
        type: 'keyup',
        key: e.key,
        t: performance.now() - this.startTime
      })
    }

    inputElement.addEventListener('keydown', this._keydownHandler)
    inputElement.addEventListener('keyup', this._keyupHandler)
    this._input = inputElement
  }

  stop() {
    this.isActive = false
    if (this._input) {
      this._input.removeEventListener('keydown', this._keydownHandler)
      this._input.removeEventListener('keyup', this._keyupHandler)
    }
  }

  extractFeatures() {
    if (this.keyEvents.length < 4) return null

    const keydowns = {}
    const dwells = []
    const flights = []
    let lastKeyupTime = null

    for (const ev of this.keyEvents) {
      if (ev.type === 'keydown') {
        keydowns[ev.key] = ev.t
        if (lastKeyupTime !== null) {
          flights.push(ev.t - lastKeyupTime)
        }
      } else if (ev.type === 'keyup') {
        const downTime = keydowns[ev.key]
        if (downTime !== undefined) {
          dwells.push(ev.t - downTime)
          delete keydowns[ev.key]
        }
        lastKeyupTime = ev.t
      }
    }

    const meanDwell = dwells.length ? dwells.reduce((a, b) => a + b, 0) / dwells.length : 0
    const meanFlight = flights.length ? flights.reduce((a, b) => a + b, 0) / flights.length : 0

    return {
      sampleCount: this.keyEvents.length,
      dwells,
      flights,
      meanDwell,
      meanFlight
    }
  }
}

// ── Combined Behavioural Profile Builder ──────────────────────

/**
 * Build a compact behavioural profile from motion + touch + keystroke data.
 * Stored in students.behavioural_profile (JSONB in PostgreSQL).
 *
 * @returns {Object} serialisable behavioural profile
 */
export function buildBehaviouralProfile(motionFeatures, touchFeatures, keystrokeFeatures) {
  return {
    version:   '1.0',
    capturedAt: new Date().toISOString(),
    motion:    motionFeatures,
    touch:     touchFeatures,
    keystroke: keystrokeFeatures,
  }
}

/**
 * Compare two behavioural profiles.
 * Returns similarity score 0–1 (higher = more similar = same person).
 */
export function compareBehaviouralProfiles(profileA, profileB) {
  if (!profileA || !profileB) return 0.5  // neutral

  const scores = []

  // Compare motion RMS
  if (profileA.motion?.overallRMS && profileB.motion?.overallRMS) {
    const diff = Math.abs(profileA.motion.overallRMS - profileB.motion.overallRMS)
    const maxRMS = Math.max(profileA.motion.overallRMS, profileB.motion.overallRMS)
    scores.push(1 - Math.min(1, diff / (maxRMS + 0.001)))
  }

  // Compare touch velocity
  if (profileA.touch?.velocity && profileB.touch?.velocity) {
    const diff = Math.abs(profileA.touch.velocity.mean - profileB.touch.velocity.mean)
    const maxV = Math.max(profileA.touch.velocity.mean, profileB.touch.velocity.mean)
    scores.push(1 - Math.min(1, diff / (maxV + 0.001)))
  }

  // Compare keystroke mean dwell
  if (profileA.keystroke?.meanDwell && profileB.keystroke?.meanDwell) {
    const diff = Math.abs(profileA.keystroke.meanDwell - profileB.keystroke.meanDwell)
    const maxD = Math.max(profileA.keystroke.meanDwell, profileB.keystroke.meanDwell)
    scores.push(1 - Math.min(1, diff / (maxD + 0.001)))
  }

  // Compare keystroke mean flight
  if (profileA.keystroke?.meanFlight && profileB.keystroke?.meanFlight) {
    const diff = Math.abs(profileA.keystroke.meanFlight - profileB.keystroke.meanFlight)
    const maxF = Math.max(profileA.keystroke.meanFlight, profileB.keystroke.meanFlight)
    scores.push(1 - Math.min(1, diff / (maxF + 0.001)))
  }

  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0.5
}
