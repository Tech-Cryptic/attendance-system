import { db } from './schema'

/* ── Client UUID ─────────────────────────────────────────────
   A persistent device identifier used to tag offline records.
   Generated once and stored in appState.
─────────────────────────────────────────────────────────────── */
export async function getClientUUID() {
  let record = await db.appState.get('client_uuid')
  if (!record) {
    const uuid = crypto.randomUUID()
    await db.appState.put({ key: 'client_uuid', value: uuid })
    return uuid
  }
  return record.value
}

/* ── Student Queries ─────────────────────────────────────────── */

/**
 * Save a newly enrolled student record (without embedding).
 * Embedding is saved separately via saveEmbedding().
 */
export async function saveStudent(studentData) {
  return db.students.put({
    matric_number:        studentData.matric_number,
    full_name:            studentData.full_name,
    course_code:          studentData.course_code,
    enrolled_at:          studentData.enrolled_at ?? new Date().toISOString(),
    consent_given_at:     studentData.consent_given_at,
    consent_version:      studentData.consent_version ?? '1.0',
    high_similarity_flag: studentData.high_similarity_flag ?? false,
    flagged_pair_matric:  studentData.flagged_pair_matric ?? null,
  })
}

export async function getStudent(matric_number) {
  return db.students.get(matric_number)
}

export async function getAllStudents() {
  return db.students.toArray()
}

export async function getStudentsByCourse(course_code) {
  return db.students.where('course_code').equals(course_code).toArray()
}

/* ── Embedding Queries ───────────────────────────────────────── */

/**
 * Save the 1024-dim FaceRes embedding + optional 512-dim iris embedding.
 * Stored as regular JS arrays (IndexedDB doesn't support Float32Array natively).
 */
export async function saveEmbedding(matric_number, course_code, embedding, irisEmbedding = null) {
  return db.embeddings.put({
    matric_number,
    course_code,
    embedding:      Array.from(embedding),       // 1024-dim FaceRes vector
    iris_embedding: irisEmbedding ? Array.from(irisEmbedding) : null,
    saved_at:       new Date().toISOString(),
  })
}

export async function getEmbedding(matric_number) {
  return db.embeddings.get(matric_number)
}

/**
 * Get all embeddings for a specific course (used during attendance matching).
 * This scopes the cosine-similarity search to enrolled students only.
 */
export async function getEmbeddingsByCourse(course_code) {
  return db.embeddings.where('course_code').equals(course_code).toArray()
}

export async function deleteEmbedding(matric_number) {
  return db.embeddings.delete(matric_number)
}

/* ── Session Queries ─────────────────────────────────────────── */

export async function saveSession(session) {
  return db.sessions.put(session)
}

export async function getSession(session_id) {
  return db.sessions.get(session_id)
}

export async function getActiveSession(course_code) {
  return db.sessions
    .where('course_code').equals(course_code)
    .and(s => s.active === true)
    .first()
}

export async function getAllSessions() {
  return db.sessions.reverse().sortBy('expires_at')
}

/* ── Attendance Queue (Offline-First) ────────────────────────── */

/**
 * Queue an attendance record for later sync to the backend.
 * @param {Object} record - attendance data from the matching pipeline
 */
export async function queueAttendance(record) {
  const client_uuid = await getClientUUID()
  return db.attendanceQueue.add({
    matric_number:       record.matric_number,
    session_id:          record.session_id,
    matched_at:          new Date().toISOString(),
    similarity_distance: record.similarity_distance,
    liveness_ear_score:  record.liveness_ear_score ?? null,
    liveness_rppg_score: record.liveness_rppg_score ?? null,
    iris_distance:       record.iris_distance ?? null,
    method:              record.method ?? 'face',
    status:              'pending',
    retry_count:         0,
    client_uuid,
  })
}

export async function getUnsyncedQueue() {
  return db.attendanceQueue.where('status').anyOf(['pending', 'failed']).toArray()
}

export async function markQueueItemSyncing(id) {
  return db.attendanceQueue.update(id, { status: 'syncing' })
}

export async function markQueueItemSynced(id) {
  return db.attendanceQueue.update(id, { status: 'synced', synced_at: new Date().toISOString() })
}

export async function markQueueItemFailed(id, error) {
  return db.attendanceQueue.update(id, {
    status: 'failed',
    last_error: error,
    retry_count: (await db.attendanceQueue.get(id))?.retry_count + 1 ?? 1
  })
}

export async function getPendingCount() {
  return db.attendanceQueue.where('status').anyOf(['pending', 'failed']).count()
}

/* ── Sync Log ────────────────────────────────────────────────── */

export async function logSync(session_id, record_count) {
  return db.syncLog.add({
    session_id,
    synced_at: new Date().toISOString(),
    record_count,
  })
}

export async function getSyncHistory() {
  return db.syncLog.reverse().limit(50).toArray()
}

/* ── App State ───────────────────────────────────────────────── */

export async function setAppState(key, value) {
  return db.appState.put({ key, value })
}

export async function getAppState(key) {
  const record = await db.appState.get(key)
  return record?.value ?? null
}

/* ── Database Utilities ──────────────────────────────────────── */

/**
 * Hard-reset the local database (used on logout for NDPR compliance:
 * student data should be cleared from shared/borrowed devices).
 */
export async function clearLocalData() {
  await db.transaction('rw', db.students, db.embeddings, db.sessions, db.attendanceQueue, async () => {
    await db.students.clear()
    await db.embeddings.clear()
    // Keep sessions and queue — they may have unsynced records
  })
}

export async function getDBStats() {
  const [students, embeddings, pending, sessions] = await Promise.all([
    db.students.count(),
    db.embeddings.count(),
    getPendingCount(),
    db.sessions.count(),
  ])
  return { students, embeddings, pendingSync: pending, sessions }
}
