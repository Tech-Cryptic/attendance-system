/**
 * Sync Queue — Offline-First Attendance Sync Manager
 *
 * Architecture (Section 3.7.2):
 *   1. Attendance records are written to Dexie `attendanceQueue` FIRST,
 *      regardless of network state (offline-first guarantee).
 *   2. This module monitors `navigator.onLine` and the Vite HMR channel.
 *   3. When the device comes online, the queue is drained in FIFO order.
 *   4. Each record is POSTed to /attendance/mark with synced_from_client=true.
 *   5. Successfully synced records are removed from the queue.
 *   6. Failed records (auth/session expired) are marked 'failed' and logged.
 *   7. Listeners can subscribe to sync events for UI updates.
 */

import db from '../db/schema'
import { toast } from '../../components/Toast'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const SYNC_DEBOUNCE_MS = 2000
const MAX_RETRY = 3

// ── Event emitter (lightweight) ────────────────────────────────
const listeners = new Set()

export function onSyncEvent(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(event) {
  for (const fn of listeners) {
    try { fn(event) } catch {}
  }

  // ── Toast notifications on key events ──────────────────────
  if (event.type === 'online')         toast.info('Back online — syncing attendance…')
  if (event.type === 'offline')        toast.warning('You\'re offline. Records will sync when reconnected.')
  if (event.type === 'sync_complete' && event.synced > 0)
    toast.success(`${event.synced} attendance record${event.synced > 1 ? 's' : ''} synced successfully.`)
  if (event.type === 'sync_complete' && event.failed > 0)
    toast.error(`${event.failed} record${event.failed > 1 ? 's' : ''} failed to sync.`)
  if (event.type === 'record_failed' && event.permanent)
    toast.error('A record could not be synced — session may have expired.')
}


// ── Queue a new attendance record ──────────────────────────────

/**
 * Queue an attendance record for sync.
 * Always succeeds immediately (offline-first).
 * Triggers an immediate sync attempt if online.
 *
 * @param {Object} record
 * @returns {Promise<number>} Dexie record id
 */
export async function queueAttendance(record) {
  const id = await db.attendanceQueue.add({
    ...record,
    status:   'pending',
    retries:  0,
    createdAt: Date.now(),
    syncedAt:  null,
  })

  emit({ type: 'queued', id, record })

  // Attempt sync immediately if online
  if (navigator.onLine) {
    setTimeout(() => drainQueue(), 500)
  }

  return id
}

// ── Queue status helpers ───────────────────────────────────────

export async function getPendingCount() {
  return db.attendanceQueue.where('status').equals('pending').count()
}

export async function getSyncedCount() {
  return db.attendanceQueue.where('status').equals('synced').count()
}

export async function clearSyncedRecords() {
  await db.attendanceQueue.where('status').equals('synced').delete()
}

// ── Drain the queue ────────────────────────────────────────────

let draining = false

export async function drainQueue() {
  if (draining || !navigator.onLine) return
  draining = true

  try {
    const pending = await db.attendanceQueue
      .where('status').equals('pending')
      .sortBy('createdAt')

    if (pending.length === 0) {
      emit({ type: 'queue_empty' })
      return
    }

    emit({ type: 'sync_start', count: pending.length })
    let synced = 0, failed = 0

    for (const record of pending) {
      if (!navigator.onLine) {
        emit({ type: 'sync_paused', reason: 'went_offline' })
        break
      }

      try {
        const res = await fetch(`${API_BASE}/attendance/mark`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id:          record.session_id,
            qr_payload:          record.qr_payload,
            qr_signature:        record.qr_signature,
            embedding:           record.embedding,
            liveness_ear_score:  record.liveness_ear_score,
            liveness_rppg_score: record.liveness_rppg_score,
            iris_distance:       record.iris_distance ?? null,
            method:              record.method ?? 'face',
            synced_from_client:  true,
            client_uuid:         record.client_uuid ?? getClientUUID(),
          }),
          signal: AbortSignal.timeout(15000),
        })

        if (res.ok) {
          const data = await res.json()
          await db.attendanceQueue.update(record.id, {
            status:   'synced',
            syncedAt: Date.now(),
            serverResponse: data,
          })
          synced++
          emit({ type: 'record_synced', id: record.id, data })

        } else if (res.status === 403 || res.status === 401) {
          // Session expired / invalid QR — permanent failure, don't retry
          await db.attendanceQueue.update(record.id, {
            status: 'failed',
            error:  `HTTP ${res.status}: Session expired or invalid`,
          })
          failed++
          emit({ type: 'record_failed', id: record.id, permanent: true })

        } else {
          // Transient error — increment retry counter
          const retries = (record.retries ?? 0) + 1
          if (retries >= MAX_RETRY) {
            await db.attendanceQueue.update(record.id, {
              status: 'failed', retries,
              error: `Max retries exceeded (HTTP ${res.status})`,
            })
            failed++
          } else {
            await db.attendanceQueue.update(record.id, { retries })
          }
        }

      } catch (err) {
        // Network error — will retry next time online
        emit({ type: 'record_error', id: record.id, error: err.message })
      }
    }

    emit({ type: 'sync_complete', synced, failed })

  } finally {
    draining = false
  }
}

// ── Online/offline watcher ─────────────────────────────────────

let syncTimer = null

function handleOnline() {
  clearTimeout(syncTimer)
  emit({ type: 'online' })
  // Debounce: wait a moment for network to stabilise
  syncTimer = setTimeout(() => drainQueue(), SYNC_DEBOUNCE_MS)
}

function handleOffline() {
  clearTimeout(syncTimer)
  emit({ type: 'offline' })
}

/**
 * Start the sync manager. Call once at app startup.
 * Returns a cleanup function for React useEffect.
 */
export function startSyncManager() {
  window.addEventListener('online',  handleOnline)
  window.addEventListener('offline', handleOffline)

  // Initial drain if already online
  if (navigator.onLine) {
    setTimeout(() => drainQueue(), 3000)
  }

  return function stop() {
    window.removeEventListener('online',  handleOnline)
    window.removeEventListener('offline', handleOffline)
    clearTimeout(syncTimer)
  }
}

// ── Device UUID (stable per-browser-install) ───────────────────

function getClientUUID() {
  let id = localStorage.getItem('faceattend_client_uuid')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('faceattend_client_uuid', id)
  }
  return id
}

export { getClientUUID }
