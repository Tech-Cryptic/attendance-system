/** Offline capture helpers for presence evidence. */

import db from './db/schema'
import { drainPresenceQueue } from './sync/syncQueue'

function getClientUUID() {
  let id = localStorage.getItem('faceattend_client_uuid')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('faceattend_client_uuid', id)
  }
  return id
}

function readNativeVenueSignals() {
  const bridge = window.FaceAttendVenueBridge
  if (!bridge || typeof bridge.getSignals !== 'function') return {}
  try {
    return bridge.getSignals() ?? {}
  } catch {
    return {}
  }
}

function readGps() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({})
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy_m: position.coords.accuracy,
      }),
      () => resolve({}),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 30000 },
    )
  })
}

export async function captureVenueSignal() {
  const [gps, native] = await Promise.all([readGps(), Promise.resolve(readNativeVenueSignals())])
  // Native values override browser GPS when both are present.
  return { ...gps, ...native }
}

export async function queuePresenceEvent(event) {
  const signal = event.signal ?? {}
  const record = {
    event_id: event.event_id ?? crypto.randomUUID(),
    session_id: event.session_id,
    matric_number: event.matric_number,
    event_type: event.event_type,
    source: event.source ?? 'client',
    checkpoint_id: event.checkpoint_id ?? null,
    qr_payload: event.qr_payload ?? null,
    qr_signature: event.qr_signature ?? null,
    qr_nonce: event.qr_nonce ?? null,
    observedAt: event.observed_at ?? new Date().toISOString(),
    latitude: signal.latitude ?? event.latitude ?? null,
    longitude: signal.longitude ?? event.longitude ?? null,
    accuracy_m: signal.accuracy_m ?? event.accuracy_m ?? null,
    ssid: signal.ssid ?? event.ssid ?? null,
    bssid: signal.bssid ?? event.bssid ?? null,
    beacon_id: signal.beacon_id ?? event.beacon_id ?? null,
    rssi: signal.rssi ?? event.rssi ?? null,
    client_uuid: getClientUUID(),
    synced_from_client: true,
    status: 'pending',
    retries: 0,
    createdAt: Date.now(),
    syncedAt: null,
  }

  await db.presenceQueue.add(record)

  if (navigator.onLine) {
    setTimeout(() => drainPresenceQueue(), 500)
  }

  return record
}

export async function queueQrPresenceEvent({ payload, signature, matricNumber, fallbackType = 'check_in' }) {
  let data
  try {
    data = JSON.parse(payload)
  } catch {
    return null
  }

  const eventType = data.event_type ?? fallbackType
  // Accepted types are enforced again by the server Pydantic model.
  if (!['check_in', 'checkpoint', 'check_out'].includes(eventType)) return null

  const signal = await captureVenueSignal()
  return queuePresenceEvent({
    session_id: data.session_id,
    matric_number: matricNumber,
    event_type: eventType,
    source: 'qr',
    checkpoint_id: data.checkpoint_id ?? null,
    qr_payload: payload,
    qr_signature: signature,
    qr_nonce: data.nonce ?? null,
    signal,
  })
}

export async function queueVenueSignal(sessionId, matricNumber) {
  const signal = await captureVenueSignal()
  if (!signal.latitude && !signal.ssid && !signal.beacon_id) return null

  return queuePresenceEvent({
    session_id: sessionId,
    matric_number: matricNumber,
    event_type: 'venue_signal',
    source: signal.beacon_id ? 'ble' : signal.ssid ? 'wifi' : 'gps',
    signal,
  })
}

export async function getPresencePendingCount() {
  return db.presenceQueue.where('status').equals('pending').count()
}

export async function clearSyncedPresenceEvents() {
  await db.presenceQueue.where('status').equals('synced').delete()
}
