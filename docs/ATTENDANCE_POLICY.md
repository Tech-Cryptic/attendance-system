# Attendance Policy: Offline-First Presence Evidence

## 1. The problem this solves

The original system answered one question:

> Did this face match an enrolled student?

That is not the same as:

> Did the student remain in the lecture?

A student could scan the session QR at 8:00am, leave immediately, and still have a biometric attendance record. This document describes the presence layer that fixes that without breaking the offline-first guarantee.

## 2. The central design rule

```text
evidence != outcome
```

The device records **evidence**. The server computes the **outcome**.

Offline-first means the phone can capture evidence with no network. It does **not** mean the phone has authority over the final result. Only the server knows:

- the real session start/end time,
- who is enrolled,
- whether a token was revoked,
- whether an event arrived after the grace window.

Local state in IndexedDB is therefore always **provisional**. `attendance_outcomes` in PostgreSQL is authoritative.

## 3. Why all four signals can coexist

You asked for QR checkpoints, check-in/check-out, BLE/Wi-Fi, and GPS. They are all useful, but they must not be four separate truths.

| Signal | Strength | Failure mode | Role in policy |
|---|---|---|---|
| Signed QR check-in | Strong identity proof | Can be shared/screenshotted | Required to start |
| Signed midpoint / check-out QR | Strong time proof | Lecturer must generate it | Primary continuity proof |
| GPS venue check | Medium | Poor indoors, spoofable, battery/permission | Corroborates continuity |
| Wi-Fi / BLE beacon | Medium | Needs config/hardware, browser limits | Corroborates continuity |
| Manual exemption | Human attestation | Trusts lecturer | Explicit audited override |

The policy uses **OR**, not AND, for continuity:

```text
enough QR checkpoints  OR  venue signals spanning the lecture
```

That is deliberate. If one sensor fails, another valid signal can still prove presence. Conversely, a single weak signal can never silently produce `present` by itself.

## 4. State machine

```text
(no evidence)
     │
     ├── signed QR check-in ──────► checked_in (provisional)
     │                                  │
     │                                  ├── required checkpoints + end proof ─► present
     │                                  ├── venue signals span lecture ───────► present
     │                                  ├── explicit leave / final out-of-venue ► left_early
     │                                  ├── late/conflicting evidence ─────────► pending_review
     │                                  └── incomplete evidence ───────────────► pending_review
     │
     └── lecturer exemption claimed ───► exempted (counts as present, audited)
```

`left_early` is not stored as SQL `NULL`. We keep the original evidence and store an explicit status. Reports can map `left_early` to “no credit”, but the audit trail remains intact.

## 5. Grace then review

A phone clock can be wrong and an offline sync can arrive minutes late. Hard-rejecting every late event would punish poor networks.

The server therefore:

1. accepts the event and stores it,
2. compares `observed_at` with server time and `grace_minutes`,
3. marks it as needing review when it is outside the grace window,
4. never lets that ambiguity become an automatic failure.

The outcome is `pending_review`, and the lecturer/admin can re-run finalisation after inspecting evidence.

## 6. Request flow

### Online

1. Lecturer creates a session. The signed session QR is the check-in QR.
2. Lecturer generates a midpoint checkpoint QR or an end-of-class check-out QR.
3. Student scans. `queueQrPresenceEvent()` writes the event to Dexie immediately.
4. The sync manager POSTs it to `/presence/events`.
5. Lecturer ends the session. `/sessions/{id}/end` calls `finalize_session()` automatically.
6. One `attendance_outcomes` row is written per enrolled student.

### Offline

1. QR scan is still recorded locally with `crypto.randomUUID()` as `event_id`.
2. GPS/native venue signals are attached when available.
3. No request is made. The student sees a pending count.
4. On the next `online` event, the queue drains.
5. If the session was already ended, the lecturer re-runs `/presence/sessions/{id}/finalize`.

The `event_id` makes retries idempotent. A timeout followed by a retry cannot create two attendance events.

## 7. Why `attendance_records` was not replaced

`attendance_records` remains the biometric evidence table:

- face distance,
- liveness scores,
- method (`batch_face`, `fallback_qr`, `manual_override`),
- device sync flag.

`attendance_outcomes` is the policy decision table. Separating them means a policy change never destroys biometric evidence and a policy bug can be corrected by re-finalising.

## 8. Manual exemption flow

When a phone dies:

1. After class, the lecturer opens the ended session.
2. `ExemptionPanel` submits matric + reason.
3. Backend generates a 32-byte random token, stores only its SHA-256 hash, and returns a one-time URL.
4. Previous unused links for that student/session are revoked.
5. Student opens the URL on **any device**. ProtectedRoute sends them to login if needed, then returns to the same URL.
6. `POST /presence/exemptions/{token}/claim` verifies the JWT matric matches the link, inserts a `manual_override` attendance record, and writes an `exempted` outcome.

The link is a capability; the JWT is the identity. Finding someone else's link does not let a student claim it.

## 9. Adding real BLE / Wi-Fi adapters

Standard browsers cannot scan BLE or nearby Wi-Fi consistently across iOS and Android. The frontend therefore exposes a native bridge hook:

```js
window.FaceAttendVenueBridge = {
  getSignals() {
    return { beacon_id: 'room-101-beacon', rssi: -62, ssid: 'UNILORIN-CLASS' }
  }
}
```

A native wrapper (Capacitor/Cordova) can implement that hook. The web app keeps working without it, using QR + optional GPS.

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

The server compares reported signals only against this configured list. Unknown signals are never treated as proof.

## 10. LLM-assisted review workflow

When the rule engine returns `pending_review`, a lecturer can request an LLM review from the ended session page.

```text
pending_review outcome
   → server builds a compact evidence payload
   → OpenAI-compatible LLM returns strict JSON
   → Pydantic validates the suggestion
   → lecturer approves, overrides, or rejects
   → attendance_outcomes changes only after the human decision
```

The validated JSON contains:

- `recommended_status`
- `confidence`
- `reason_summary`
- `entities` with extracted course, session, signals, issues, and `route_to`
- `draft_message` for the student

Safety rules:

- The LLM has no database access and never writes `attendance_outcomes`.
- Invalid JSON or an API failure falls back to conservative deterministic rules.
- `llm_presence_reviews`, `llm_review_decisions`, and `llm_review_audit` store suggestions, human decisions, and non-sensitive metadata.
- The raw prompt is not logged because it contains student evidence.

Configure the workflow with `OPENAI_API_KEY`, optional `OPENAI_MODEL`, and optional `OPENAI_BASE_URL` for OpenAI-compatible providers.

## 11. Privacy / NDPR notes

- Store coarse evidence (`within_venue: true/false`, timestamp, signal ID), not continuous location tracks.
- GPS is captured only during an attendance session and only with browser permission.
- Exemption links expire after 24 hours by default and are single-use.
- Only token hashes are stored.
- The exemption reason is visible to admin/lecturer audits, so it must not contain sensitive medical details.

## 12. API summary

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/presence/checkpoints` | lecturer/admin | Create signed midpoint/check-out QR |
| POST | `/presence/events` | student | Submit offline-safe evidence batch |
| POST | `/presence/sessions/{id}/finalize` | lecturer/admin | Recalculate outcomes |
| GET | `/presence/sessions/{id}/outcomes` | lecturer/admin | Review outcomes |
| POST | `/presence/exemptions` | lecturer/admin | Issue one-time claim link |
| GET | `/presence/exemptions/{token}/preview` | public | Show course/status before claiming |
| POST | `/presence/exemptions/{token}/claim` | student | Claim from any device |
| POST | `/presence/reviews/generate` | lecturer/admin | Generate validated LLM suggestion |
| GET | `/presence/reviews?session_id=` | lecturer/admin | List suggestions and decisions |
| POST | `/presence/reviews/{id}/decision` | lecturer/admin | Approve, override, or reject suggestion |
