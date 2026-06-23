/**
 * @vladmandic/human — Configuration
 *
 * Two configs:
 *  humanConfig    — single-face mode (enrollment, individual fallback)
 *  batchConfig    — multi-face proximity-batch mode (lecturer room scan)
 *
 * Aligned with Chapter 3 methodology:
 * - 478-point dense 3D FaceMesh (468 mesh + 10 iris landmarks per eye)
 * - 1024-dim FaceRes descriptor embedding
 * - WebGPU → WebGL fallback execution
 * - Three-layer PAD: antispoof model + EAR blink (active) + rPPG (passive)
 * - NDPA 2023: no frame upload — all inference on-device
 *
 * Models are served from the vladmandic CDN and cached by the
 * Workbox service worker after first load (offline-first).
 */

export const humanConfig = {
  // ── Execution Backend ──────────────────────────────────────
  // WebGPU first (targets modern Android Chrome 113+),
  // falls back automatically to WebGL2, then WASM.
  backend: 'webgpu',
  wasmPath: 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm/dist/',

  // ── Model source ───────────────────────────────────────────
  // Using the official vladmandic CDN. Service worker caches these
  // after first download for offline-first operation.
  modelBasePath: 'https://vladmandic.github.io/human/models/',

  // ── Caching ────────────────────────────────────────────────
  // Cache model weights in IndexedDB via TFJS model store.
  // On subsequent loads, models are served from local cache.
  cacheSensitivity: 0,   // 0 = always use cached version if available

  // ── Warmup ────────────────────────────────────────────────
  // Performs a dummy inference on init to pre-compile shaders.
  // Prevents first-frame latency spike.
  warmup: 'face',

  // ── Face Pipeline ─────────────────────────────────────────
  face: {
    enabled: true,

    // Face detector
    detector: {
      enabled: true,
      modelPath: 'blazeface.json',
      rotation: false,          // disable rotation for speed (device held upright)
      maxDetected: 1,           // single-face mode: enrollment + fallback
      minConfidence: 0.35,
      iouThreshold: 0.1,
      skipFrames: 5,            // re-detect every 5 frames, track in between
    },

    // 468-point 3D FaceMesh (+ 10 iris pts per eye = 478 total)
    mesh: {
      enabled: true,
      modelPath: 'facemesh.json',
      keepInvalid: false,
    },

    // Iris landmark detection — adds 10 pts per eye on top of mesh (total 478)
    // Also used for precise EAR blink calculation and iris biometric descriptor
    iris: {
      enabled: true,
      modelPath: 'iris.json',
    },

    // 1024-dim FaceRes embedding descriptor
    // This is the face recognition model used for matching
    description: {
      enabled: true,
      modelPath: 'faceres.json',  // FaceRes → 1024-dim
      minConfidence: 0.1,
      skipFrames: 0,              // compute embedding on every frame during capture
    },

    // Passive liveness: neural network predicts real vs spoof
    // Outputs face.real (antispoof score 0–1) + face.live (liveness score 0–1)
    antispoof: {
      enabled: true,
      modelPath: 'antispoof.json',
      skipFrames: 10,
    },

    liveness: {
      enabled: true,
      modelPath: 'liveness.json',
      skipFrames: 10,
    },

    // Disabled for performance — not needed for attendance
    emotion:   { enabled: false },
    attention: { enabled: false },
    gear:      { enabled: false },
  },

  // ── Disable unused pipelines ──────────────────────────────
  body:        { enabled: false },
  hand:        { enabled: false },
  object:      { enabled: false },
  gesture:     { enabled: false },
  segmentation:{ enabled: false },

  // ── Output filters ────────────────────────────────────────
  filter: {
    enabled: true,
    width: 0,
    height: 0,
    return: false,        // do not return filtered image (NDPR: no frame storage)
    flip: false,
    brightness: 0,
    contrast: 0,
    sharpness: 0,
    blur: 0,
    saturation: 0,
    hue: 0,
    negative: false,
    sepia: false,
    vintage: false,
    kodachrome: false,
    technicolor: false,
    polaroid: false,
    pixelate: 0,
  },

  // ── Canvas output ─────────────────────────────────────────
  // We handle canvas drawing ourselves for full UI control.
  // human.js draw utilities used for mesh overlay.
  canvas: undefined,
}

/**
 * Draw configuration for the FaceMesh overlay canvas.
 * Controls what gets rendered on the camera preview.
 */
export const drawConfig = {
  drawBoxes: true,
  drawPoints: false,         // too cluttered for 478 points
  drawPolygons: true,
  fillPolygons: false,
  drawLabels: false,
  drawGestures: false,
  drawDescriptions: false,
  useDepth: true,            // use Z-depth for 3D shading effect on mesh
  useCurves: true,
  // Mesh color changes based on liveness state (set dynamically in FaceCamera)
  color: 'rgba(124, 58, 237, 0.5)',
  labelColor: '#ffffff',
  lineWidth: 1,
  pointSize: 2,
}

/**
 * Batch config — multi-face proximity scan mode (Section 3.5 proximity-batch).
 *
 * Differences from humanConfig:
 *  - maxDetected: 15 (proximity group, up to 15 faces simultaneously)
 *  - iris disabled (not needed for batch matching; saves ~40ms per face)
 *  - skipFrames: 8 (allow more time between full detections)
 *  - antispoof/liveness skipFrames: 15 (run less frequently in batch)
 */
export const batchConfig = {
  ...humanConfig,
  face: {
    ...humanConfig.face,
    detector: {
      ...humanConfig.face.detector,
      maxDetected: 15,        // proximity-batch: up to 15 students simultaneously
      minConfidence: 0.40,    // slightly higher threshold for group detection
      skipFrames: 8,
    },
    iris: {
      enabled: false,         // disabled in batch mode for performance
    },
    antispoof: {
      ...humanConfig.face.antispoof,
      skipFrames: 15,         // run less frequently in batch
    },
    liveness: {
      ...humanConfig.face.liveness,
      skipFrames: 15,
    },
  },
}
