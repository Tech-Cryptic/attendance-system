import Dexie from 'dexie'

/**
 * FaceAttend Local Database — Dexie.js IndexedDB Schema
 *
 * Offline-first. All biometric and attendance data lives here first
 * and syncs to the backend PostgreSQL when connectivity is available.
 *
 * Tables:
 *  - biometricStore   : course embedding cache for offline matching (NEW v2)
 *  - students         : enrolled student profiles (local mirror)
 *  - sessions         : attendance sessions cache
 *  - attendanceQueue  : offline records awaiting sync
 *  - syncLog          : sync operation history
 *  - appState         : key-value store for app state
 */
export const db = new Dexie('FaceAttendDB')

// v1 — initial schema
db.version(1).stores({
  students: 'matric_number, full_name, course_code, enrolled_at, high_similarity_flag',
  embeddings: 'matric_number, course_code',
  sessions: 'session_id, course_code, lecturer_id, expires_at, active',
  attendanceQueue: '++id, matric_number, session_id, status, matched_at, client_uuid',
  syncLog: '++id, session_id, synced_at, record_count',
  appState: 'key',
})

// v2 — add biometricStore for offline course embedding cache
db.version(2).stores({
  students: 'matric_number, full_name, course_code, enrolled_at, high_similarity_flag',
  embeddings: 'matric_number, course_code',

  /**
   * biometricStore — downloaded course embedding cache.
   *
   * Populated by AttendancePage from GET /courses/{code}/embeddings.
   * Each record: { matric_number, full_name, course_code, embedding[1024],
   *                iris_embedding[25]?, high_similarity_flag, cached_at }
   *
   * Primary key: [matric_number+course_code] compound key.
   * Index on course_code for fast batch retrieval.
   */
  biometricStore: '[matric_number+course_code], course_code, cached_at',

  sessions: 'session_id, course_code, lecturer_id, expires_at, active',

  /**
   * attendanceQueue — offline-first records.
   *
   * Fields written by queueAttendance():
   *   session_id, qr_payload, qr_signature,
   *   embedding[1024], liveness_ear_score, liveness_rppg_score,
   *   iris_distance, method, status, retries, createdAt, syncedAt
   */
  attendanceQueue: '++id, session_id, status, createdAt, client_uuid',

  syncLog: '++id, session_id, synced_at, record_count',
  appState: 'key',
})

export default db
