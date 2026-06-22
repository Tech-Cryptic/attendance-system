/**
 * Face AI Detector — @vladmandic/human pipeline
 *
 * Core functions:
 *  - initHuman()          : load models, warm up WebGPU/WebGL shaders
 *  - detectAndEmbed()     : run inference on a video frame
 *  - cosineSimilarity()   : compare two 1024-dim embeddings
 *  - matchEmbedding()     : course-scoped nearest-neighbour search
 *  - extractIrisDescriptor(): compute iris biometric feature vector
 *
 * NDPR compliance: no frame data leaves this module. Raw pixels are
 * consumed by the model and immediately discarded. Only the mathematical
 * vector output (embedding) is passed out.
 */

import Human from '@vladmandic/human'
import { humanConfig } from './humanConfig'

// ── Singleton Human instance ───────────────────────────────────
let humanInstance = null
let isReady = false

/**
 * Initialize the Human instance and load all model weights.
 * Call once on app mount. Subsequent calls are no-ops.
 *
 * @param {Function} onProgress - optional callback(loaded, total) for progress UI
 * @returns {Promise<Human>}
 */
export async function initHuman(onProgress) {
  if (isReady && humanInstance) return humanInstance

  humanInstance = new Human(humanConfig)

  // Wire up model load progress
  if (onProgress) {
    humanInstance.events.addEventListener('load', (ev) => {
      onProgress(ev.loaded, ev.total)
    })
  }

  await humanInstance.load()
  await humanInstance.warmup()

  // Detect actual backend used (WebGPU may fall back to WebGL)
  const backend = humanInstance.tf.getBackend()
  console.info(`[FaceAI] Ready — backend: ${backend}`)

  isReady = true
  return humanInstance
}

export function getHuman() {
  return humanInstance
}

export function isHumanReady() {
  return isReady
}

export function getBackendName() {
  return humanInstance?.tf?.getBackend() ?? 'uninitialized'
}

// ── Core Detection ─────────────────────────────────────────────

/**
 * Run a full face inference pass on a video/canvas element.
 *
 * @param {HTMLVideoElement|HTMLCanvasElement} source
 * @returns {Promise<DetectionResult|null>}
 */
export async function detectAndEmbed(source) {
  if (!humanInstance || !isReady) throw new Error('Human not initialized. Call initHuman() first.')

  const result = await humanInstance.detect(source)

  if (!result.face || result.face.length === 0) return null

  // Take the highest-confidence face (maxDetected=1, but defensive check)
  const face = result.face.reduce((a, b) => (a.faceScore > b.faceScore ? a : b))

  if (!face.embedding || face.embedding.length !== 1024) return null

  return {
    // ── Face Embedding ──────────────────────────────────────
    embedding:    face.embedding,      // Float32Array[1024] — FaceRes descriptor

    // ── Mesh & Geometry ─────────────────────────────────────
    mesh:         face.mesh,           // Float32Array[478*3] — 3D face mesh
    annotations:  face.annotations,   // named landmark groups (leftEye, rightEye, etc.)
    box:          face.box,            // [x, y, w, h] — bounding box in pixel coords
    boxRaw:       face.boxRaw,         // [x, y, w, h] — normalized 0–1

    // ── Iris ────────────────────────────────────────────────
    iris:         face.iris,           // iris landmarks (human.js extended set)
    irisDistance: face.iris,           // raw — processed in extractIrisDescriptor()
    irisDescriptor: extractIrisDescriptor(face),

    // ── Liveness & Antispoof ─────────────────────────────────
    // Values 0–1, higher = more likely real / live
    antispoofScore: face.real  ?? null,   // passive antispoof model score
    livenessScore:  face.live  ?? null,   // passive liveness model score
    faceScore:      face.faceScore,       // face detection confidence

    // ── Age/Gender (supplementary, not used for matching) ───
    age:    face.age    ?? null,
    gender: face.gender ?? null,

    // ── Raw human.js result (needed for draw utilities) ─────
    rawResult: result,
  }
}

// ── Iris Descriptor ────────────────────────────────────────────

/**
 * Extract a lightweight iris biometric feature vector from iris landmarks.
 *
 * Uses 5 iris landmarks per eye (center + 4 perimeter points) to compute:
 * - Iris radius (normalized)
 * - Pupil-to-iris ratio
 * - Ellipse axis ratios
 * - Left/right iris comparison ratios
 *
 * This is a supplementary discriminator for the twin disambiguation
 * branch — it does NOT replace the 1024-dim face embedding.
 *
 * @param {Object} face - human.js face result object
 * @returns {Float32Array|null} — 20-dim iris descriptor
 */
export function extractIrisDescriptor(face) {
  if (!face.annotations) return null
  const { leftIris, rightIris } = face.annotations
  if (!leftIris || !rightIris || leftIris.length < 5 || rightIris.length < 5) return null

  function irisFeatures(iris) {
    const [cx, cy] = iris[0]  // center (pupil)
    // 4 perimeter landmarks
    const r = iris.slice(1).map(([x, y]) => Math.hypot(x - cx, y - cy))
    const rMean = r.reduce((a, b) => a + b, 0) / r.length
    const rStd  = Math.sqrt(r.reduce((a, b) => a + (b - rMean) ** 2, 0) / r.length)
    // Axis dimensions: top-bottom (vertical) vs left-right (horizontal)
    const [top, right, bottom, left] = iris.slice(1)
    const vAxis = Math.hypot(top[0] - bottom[0], top[1] - bottom[1])
    const hAxis = Math.hypot(left[0] - right[0], left[1] - right[1])
    const eccentricity = hAxis > 0 ? vAxis / hAxis : 0
    return [cx, cy, rMean, rStd, vAxis, hAxis, eccentricity,
            r[0], r[1], r[2], r[3]]  // 11 features per eye
  }

  try {
    const leftF  = irisFeatures(leftIris)
    const rightF = irisFeatures(rightIris)
    // Add inter-eye ratios (3 more features)
    const ratios = [
      leftF[2] / (rightF[2] || 1),      // radius ratio L/R
      leftF[6] / (rightF[6] || 1),      // eccentricity ratio
      Math.abs(leftF[0] - rightF[0]),   // inter-pupil distance x
    ]
    const descriptor = new Float32Array([...leftF, ...rightF, ...ratios])
    return descriptor  // 25-dim iris descriptor
  } catch {
    return null
  }
}

// ── Similarity Metrics ─────────────────────────────────────────

/**
 * Cosine similarity between two embedding vectors.
 * Returns value in range [0, 1] — higher = more similar.
 * Threshold for same-person: typically > 0.6
 *
 * @param {Float32Array|number[]} a
 * @param {Float32Array|number[]} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * Cosine distance (used as the similarity_distance stored in attendance records).
 * Lower = more similar. 0 = identical. 1 = completely different.
 */
export function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b)
}

/**
 * Euclidean distance between two embeddings.
 * Alternative metric — used for twin-flag comparison at enrollment.
 */
export function euclideanDistance(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

// ── Course-Scoped Nearest Neighbour Match ─────────────────────

/**
 * Match a probe embedding against all enrolled embeddings for a course.
 * Returns the best match if similarity exceeds the threshold.
 *
 * This implements Section 3.5.2 of the methodology:
 * matching is scoped to enrolled students in the active course only,
 * not against the full student table.
 *
 * @param {Float32Array}  probeEmbedding   - live extracted embedding
 * @param {Array}         courseEmbeddings - from getEmbeddingsByCourse()
 * @param {number}        threshold        - cosine similarity threshold (default 0.60)
 * @returns {{ match: Object|null, similarity: number, distance: number }}
 */
export function matchEmbedding(probeEmbedding, courseEmbeddings, threshold = 0.60) {
  if (!courseEmbeddings || courseEmbeddings.length === 0) {
    return { match: null, similarity: 0, distance: 1 }
  }

  let bestMatch = null
  let bestSimilarity = -1

  for (const record of courseEmbeddings) {
    const stored = record.embedding
    if (!stored || stored.length !== 1024) continue

    const sim = cosineSimilarity(probeEmbedding, stored)
    if (sim > bestSimilarity) {
      bestSimilarity = sim
      bestMatch = record
    }
  }

  if (bestSimilarity >= threshold) {
    return {
      match:      bestMatch,
      similarity: bestSimilarity,
      distance:   1 - bestSimilarity,
    }
  }

  return { match: null, similarity: bestSimilarity, distance: 1 - bestSimilarity }
}

/**
 * Average multiple embedding captures (N frames) into one stable vector.
 * Used during enrollment to reduce per-frame noise.
 *
 * @param {Float32Array[]} embeddings - array of N embeddings
 * @returns {Float32Array} — averaged 1024-dim vector
 */
export function averageEmbeddings(embeddings) {
  const dim = embeddings[0].length
  const avg = new Float32Array(dim)
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i]
  }
  const n = embeddings.length
  for (let i = 0; i < dim; i++) avg[i] /= n
  return avg
}
