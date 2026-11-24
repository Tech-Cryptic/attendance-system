# Attendance Presence Policy

## 1. Scope

FaceAttend records biometric evidence and presence evidence separately. A face match proves that a person enrolled; it does not prove that the student stayed for the lecture.

The presence layer records signed QR checkpoints, venue signals, explicit leave events, and manual exemptions. The server converts that evidence into an attendance outcome.

## 2. Data ownership

The device records evidence in IndexedDB while offline. The server owns session times, enrolments, revocations, and the final outcome.

| Store | Purpose |
|---|---|
| IndexedDB `presenceQueue` | Provisional evidence captured on the device |
| `attendance_records` | Biometric evidence: face distance, liveness, match method |
| `attendance_outcomes` | Server-owned result for each student and session |

An outcome is one of `present`, `left_early`, `absent`, `exempted`, or `pending_review`.

## 3. Presence signals

| Signal | Role | Limitation |
|---|---|---|
| Signed session QR | Required check-in | Can be screenshotted |
| Signed checkpoint/check-out QR | Primary continuity proof | Lecturer must generate it |
| GPS | Corroborates continuity | Poor indoors, spoofable, needs permission |
| Wi-Fi / BLE beacon | Corroborates continuity | Needs configuration and native bridge |
| Manual exemption | Lecturer attestation | Trusts the lecturer and is audited |

Continuity is satisfied by either enough accepted QR checkpoints or configured venue signals spanning the lecture. A single weak signal is never enough for `present`.

## 4. Outcome rules

1. An active exemption produces `exempted`.
2. A signed QR check-in is required.
3. Accepted QR checkpoints or configured venue signals establish continuity.
4. A check-out QR, late batch scan, or the same venue continuity establishes end-of-session proof.
5. An explicit leave event or final out-of-venue signal produces `left_early`.
6. Ambiguous or late evidence produces `pending_review` for human inspection.

Late evidence is stored with its original observed time. The server compares it with `grace_minutes` before deciding whether it needs review.

## 5. Request flow

### Online

1. Lecturer creates a session and the signed session QR.
2. Lecturer generates checkpoint or check-out QR codes during the lecture.
3. Student scans; `queueQrPresenceEvent()` writes the event to IndexedDB.
4. The sync manager posts queued events to `/presence/events`.
5. Ending the session calls `finalize_session()` and writes one outcome per enrolled student.

### Offline

1. QR scans and venue signals are stored locally with a client-generated `event_id`.
2. No request is sent while offline; the student sees a pending count.
3. On reconnect, the queue drains.
4. If the session already ended, the lecturer re-runs `/presence/sessions/{id}/finalize`.

`event_id` makes retries idempotent. A timeout followed by a retry cannot create two rows for the same event.

## 6. Manual exemptions

1. After class, the lecturer opens the ended session.
2. `ExemptionPanel` submits the student's matric number and a reason.
3. The backend generates a 32-byte token, stores only its SHA-256 hash, and returns a one-time URL.
4. Previous unused links for that student and session are revoked.
5. The student opens the URL on any device; the JWT supplies identity.
6. `POST /presence/exemptions/{token}/claim` writes an `exempted` outcome and an audit entry.

The link is a capability; the JWT is the identity. Possessing someone else's link does not allow a student to claim it.

## 7. BLE and Wi-Fi adapters

Browsers cannot scan BLE or nearby Wi-Fi consistently across iOS and Android. The web app accepts signals from a native bridge:

```js
window.FaceAttendVenueBridge = {
  getSignals() {
    return { beacon_id: 'room-101-beacon', rssi: -62, ssid: 'UNILORIN-CLASS' }
  }
}
```

A Capacitor or Cordova wrapper can implement that hook. Without it, the app uses QR and optional GPS.

Configure expected signals when creating a session:

```json
{
  "course_code": "CSC401",
  "duration_minutes": 60,
  "venue_lat": 8.4966,
  "venue_lon": 4.4725,
  "venue_radius_m": 100,
  "venue_ssids": ["UNILORIN-CLASS"],
  "venue_beacon_ids": ["room-101-beacon"]
}
```

Only configured signals are compared. Unknown signals are ignored.

## 8. LLM-assisted review

When the rule engine returns `pending_review`, a lecturer can request an advisory review.

```text
pending_review outcome
  → server builds a compact evidence payload
  → OpenAI-compatible LLM returns strict JSON
  → Pydantic validates the suggestion
  → lecturer approves, overrides, or rejects
  → attendance_outcomes changes only after the human decision
```

The validated response contains `recommended_status`, `confidence`, `reason_summary`, extracted `entities`, and a `draft_message`.

- The model has no database access.
- Invalid JSON or an API failure falls back to deterministic rules.
- `llm_presence_reviews`, `llm_review_decisions`, and `llm_review_audit` store suggestions, decisions, and non-sensitive metadata.
- The raw prompt is not logged because it contains student evidence.

Configure with `OPENAI_API_KEY`, optional `OPENAI_MODEL`, and optional `OPENAI_BASE_URL`.

## 9. Privacy notes

- Store coarse evidence such as `within_venue` and timestamps, not continuous location tracks.
- GPS is captured only during an attendance session and only with browser permission.
- Exemption links expire after 24 hours by default and are single-use.
- Only exemption token hashes are stored.
- Exemption reasons are visible in lecturer/admin audits; avoid sensitive medical details.

## 10. API summary

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/presence/checkpoints` | lecturer/admin | Create signed checkpoint QR |
| POST | `/presence/events` | student | Submit offline-safe evidence batch |
| POST | `/presence/sessions/{id}/finalize` | lecturer/admin | Recalculate outcomes |
| GET | `/presence/sessions/{id}/outcomes` | lecturer/admin | Review outcomes |
| POST | `/presence/exemptions` | lecturer/admin | Issue one-time claim link |
| GET | `/presence/exemptions/{token}/preview` | public | Show course/status before claiming |
| POST | `/presence/exemptions/{token}/claim` | student | Claim from any device |
| POST | `/presence/reviews/generate` | lecturer/admin | Generate validated review suggestion |
| GET | `/presence/reviews?session_id=` | lecturer/admin | List suggestions and decisions |
| POST | `/presence/reviews/{id}/decision` | lecturer/admin | Approve, override, or reject suggestion |
