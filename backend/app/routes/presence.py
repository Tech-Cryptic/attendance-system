"""Presence evidence, exemption, and review endpoints."""

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg2.extras import Json

from app.auth.jwt import require_roles
from app.db.database import get_connection, release_connection
from app.models.presence import (
    CheckpointCreateRequest,
    CheckpointOut,
    ExemptionClaimResponse,
    ExemptionCreateRequest,
    ExemptionPreview,
    PresenceEventsBatch,
    ReviewDecisionRequest,
    ReviewGenerateRequest,
)
from app.qr.signing import (
    sign_checkpoint_payload,
    verify_checkpoint_payload,
    verify_session_payload,
)
from app.services.presence_policy import evaluate_presence
from app.services.llm_review import generate_llm_review

router = APIRouter()


def _utc(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _hash_token(raw_token: str) -> str:
    """Store only a hash of a bearer-style token, never the token itself."""
    return hashlib.sha256(raw_token.encode('utf-8')).hexdigest()


def _session_row(cur, session_id):
    cur.execute(
        """SELECT s.session_id, s.course_code, s.lecturer_id, s.started_at,
                  s.expires_at, s.ended_at, s.active, s.batch_scanned_at,
                  s.grace_minutes, s.required_checkpoints,
                  s.venue_lat, s.venue_lon, s.venue_radius_m,
                  s.venue_ssids, s.venue_beacon_ids
           FROM sessions s WHERE s.session_id = %s""",
        (str(session_id),),
    )
    return cur.fetchone()


def _require_owner(lecturer_id, actor):
    """Object-level authorisation shared by every presence workflow."""
    if actor.get('role') == 'admin':
        return
    if lecturer_id is None or int(lecturer_id) != int(actor['sub']):
        raise HTTPException(status_code=403, detail='This session belongs to another lecturer.')


def _require_lecturer_owner(session, actor):
    """Object-level authorisation: lecturers may only touch their own sessions."""
    if session is None:
        raise HTTPException(status_code=404, detail='Session not found.')
    _require_owner(session[2], actor)


def _audit(cur, *, review_id, session_id, matric_number, action, actor_id, detail):
    """Append-only audit record for generation and human decisions."""
    cur.execute(
        """INSERT INTO llm_review_audit
           (review_id, session_id, matric_number, action, actor_id, detail)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (review_id, session_id, matric_number, action, actor_id, Json(detail)),
    )


# ── Checkpoint QR generation (lecturer) ──────────────────────────────

@router.post('/presence/checkpoints', response_model=CheckpointOut)
def create_checkpoint(
    req: CheckpointCreateRequest,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    """
    Generate a short-lived signed QR for a midpoint check or final check-out.

    The nonce is random and is part of the signed payload. A student cannot
    screenshot this QR and reuse it in another class because the server stores
    the nonce with the student's event.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        session = _session_row(cur, req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        _require_lecturer_owner(session, actor)

        if not session[6]:
            raise HTTPException(status_code=400, detail='Session has already ended.')

        checkpoint_id = uuid.uuid4()
        nonce = secrets.token_urlsafe(18)
        expires_at = _utc(datetime.now(timezone.utc)) + timedelta(minutes=req.expires_in_minutes)

        qr = sign_checkpoint_payload(
            session_id=str(req.session_id),
            course_code=session[1],
            checkpoint_id=str(checkpoint_id),
            event_type=req.event_type,
            nonce=nonce,
            expires_at=expires_at.isoformat(),
        )

        cur.execute(
            """INSERT INTO session_checkpoints
               (session_id, checkpoint_id, event_type, label, nonce,
                qr_payload, qr_signature, expires_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                req.session_id, checkpoint_id, req.event_type, req.label,
                nonce, qr['payload'], qr['signature'], expires_at,
            ),
        )
        conn.commit()
        cur.close()

        return CheckpointOut(
            session_id=req.session_id,
            checkpoint_id=checkpoint_id,
            event_type=req.event_type,
            qr_payload=qr['payload'],
            qr_signature=qr['signature'],
            nonce=nonce,
            expires_at=expires_at,
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not create checkpoint.')
    finally:
        release_connection(conn)


# ── Evidence ingestion (student, offline-safe) ───────────────────────

@router.post('/presence/events')
def submit_presence_events(
    batch: PresenceEventsBatch,
    actor: dict = Depends(require_roles('student')),
):
    """
    Accept a batch of presence events.

    The endpoint is idempotent: every event carries a client-generated UUID.
    If a phone syncs, the request times out, and the phone retries, the second
    insert is ignored by `ON CONFLICT (event_id) DO NOTHING`.
    """
    matric = actor.get('matric_number')
    if not matric:
        raise HTTPException(status_code=400, detail='No matric_number in token payload.')

    conn = get_connection()
    try:
        cur = conn.cursor()
        now = datetime.now(timezone.utc)
        accepted_count = 0
        review_count = 0
        duplicate_count = 0
        enrolment_cache = {}
        session_cache = {}

        for event in batch.events:
            if event.matric_number != matric:
                raise HTTPException(status_code=403, detail='Students may only submit their own evidence.')

            if event.session_id not in session_cache:
                session_cache[event.session_id] = _session_row(cur, event.session_id)
            session = session_cache[event.session_id]
            if not session:
                raise HTTPException(status_code=404, detail=f'Session {event.session_id} not found.')

            course_code = session[1]
            if course_code not in enrolment_cache:
                cur.execute(
                    'SELECT 1 FROM course_enrollments WHERE matric_number = %s AND course_code = %s',
                    (matric, course_code),
                )
                enrolment_cache[course_code] = bool(cur.fetchone())
            if not enrolment_cache[course_code]:
                raise HTTPException(status_code=403, detail='You are not enrolled in this course.')

            observed_at = _utc(event.observed_at)
            grace = timedelta(minutes=int(session[8] or 5))
            review_reason = None
            accepted = True
            qr_nonce = event.qr_nonce
            checkpoint_id = event.checkpoint_id

            if observed_at > now + grace:
                accepted = False
                review_reason = 'Observed time is too far in the future.'
            elif now - observed_at > grace:
                review_reason = 'Event arrived after the grace window.'

            if event.source == 'qr':
                if event.event_type == 'check_in':
                    parsed = verify_session_payload(event.qr_payload or '', event.qr_signature or '')
                    if not parsed or str(parsed.get('session_id')) != str(event.session_id) or parsed.get('course_code') != course_code:
                        accepted = False
                        review_reason = 'Invalid session QR signature.'
                    else:
                        qr_nonce = (event.qr_signature or '')[:64]
                else:
                    parsed = verify_checkpoint_payload(event.qr_payload or '', event.qr_signature or '')
                    if not parsed or str(parsed.get('session_id')) != str(event.session_id):
                        accepted = False
                        review_reason = 'Invalid checkpoint QR signature.'
                    else:
                        cur.execute(
                            """SELECT checkpoint_id, nonce, expires_at, event_type
                               FROM session_checkpoints WHERE checkpoint_id = %s AND session_id = %s""",
                            (parsed.get('checkpoint_id'), event.session_id),
                        )
                        saved = cur.fetchone()
                        if (
                            not saved or
                            str(saved[0]) != str(parsed.get('checkpoint_id')) or
                            saved[1] != parsed.get('nonce') or
                            _utc(saved[2]) < now or
                            saved[3] != parsed.get('event_type') or
                            parsed.get('event_type') != event.event_type
                        ):
                            accepted = False
                            review_reason = 'Checkpoint is unknown, expired, or does not match the event.'
                        else:
                            checkpoint_id = saved[0]
                            qr_nonce = saved[1]

            cur.execute(
                """INSERT INTO presence_events
                   (event_id, session_id, matric_number, event_type, source,
                    checkpoint_id, qr_nonce, observed_at, latitude, longitude,
                    accuracy_m, ssid, bssid, beacon_id, rssi, client_uuid,
                    synced_from_client, accepted, review_reason)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (event_id) DO NOTHING""",
                (
                    event.event_id, event.session_id, matric, event.event_type,
                    event.source, checkpoint_id, qr_nonce, observed_at,
                    event.latitude, event.longitude, event.accuracy_m,
                    event.ssid, event.bssid, event.beacon_id, event.rssi,
                    batch.client_uuid or event.client_uuid,
                    event.synced_from_client, accepted, review_reason,
                ),
            )
            if cur.rowcount == 0:
                duplicate_count += 1
            elif accepted and not review_reason:
                accepted_count += 1
            else:
                review_count += 1

        conn.commit()
        cur.close()
        return {
            'accepted': accepted_count,
            'needs_review': review_count,
            'duplicates': duplicate_count,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not store presence evidence.')
    finally:
        release_connection(conn)


# ── Finalisation ─────────────────────────────────────────────────────

def _event_dict(row) -> dict:
    return {
        'event_type': row[0],
        'source': row[1],
        'observed_at': row[2],
        'accepted': row[3],
        'review_reason': row[4],
        'qr_nonce': row[5],
        'latitude': row[6],
        'longitude': row[7],
        'accuracy_m': row[8],
        'ssid': row[9],
        'bssid': row[10],
        'beacon_id': row[11],
    }


def finalize_session(cur, session_id) -> dict:
    """Compute and store one outcome per enrolled student."""
    session = _session_row(cur, session_id)
    if not session:
        raise HTTPException(status_code=404, detail='Session not found.')

    course_code = session[1]
    policy = {
        'required_checkpoints': session[9],
        'grace_minutes': session[8],
        'venue_lat': session[10],
        'venue_lon': session[11],
        'venue_radius_m': session[12],
        'venue_ssids': session[13] or [],
        'venue_beacon_ids': session[14] or [],
    }

    cur.execute(
        'SELECT matric_number FROM course_enrollments WHERE course_code = %s ORDER BY matric_number',
        (course_code,),
    )
    enrolled = [r[0] for r in cur.fetchall()]

    summary = {'present': 0, 'left_early': 0, 'absent': 0, 'exempted': 0, 'pending_review': 0}

    for matric in enrolled:
        # Query evidence per student. Filtering in SQL (rather than in Python)
        # guarantees that one student's evidence can never leak into another
        # student's decision, even if a future refactor changes the event shape.
        cur.execute(
            """SELECT event_type, source, observed_at, accepted, review_reason,
                      qr_nonce, latitude, longitude, accuracy_m, ssid, bssid, beacon_id
               FROM presence_events
               WHERE session_id = %s AND matric_number = %s ORDER BY observed_at""",
            (session_id, matric),
        )
        events = [_event_dict(r) for r in cur.fetchall()]

        cur.execute(
            """SELECT reason, counts_as_present
               FROM presence_exemptions
               WHERE session_id = %s AND matric_number = %s
                 AND used_at IS NOT NULL AND revoked_at IS NULL
               ORDER BY used_at DESC LIMIT 1""",
            (session_id, matric),
        )
        exemption_row = cur.fetchone()
        exemption = None
        if exemption_row:
            exemption = {'reason': exemption_row[0], 'counts_as_present': exemption_row[1], 'active': True}

        result = evaluate_presence(
            policy,
            events,
            session_start=session[3],
            session_end=session[4],
            exemption=exemption,
            batch_scanned_at=session[7],
        )

        cur.execute(
            """INSERT INTO attendance_outcomes
               (session_id, matric_number, status, counts_as_present, reason,
                evidence, finalized_at, finalized_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'policy')
               ON CONFLICT (session_id, matric_number) DO UPDATE SET
                   status = EXCLUDED.status,
                   counts_as_present = EXCLUDED.counts_as_present,
                   reason = EXCLUDED.reason,
                   evidence = EXCLUDED.evidence,
                   finalized_at = EXCLUDED.finalized_at,
                   finalized_by = EXCLUDED.finalized_by""",
            (
                session_id, matric, result['status'], result['counts_as_present'],
                result['reason'], Json(result['evidence']), datetime.now(timezone.utc),
            ),
        )
        summary[result['status']] = summary.get(result['status'], 0) + 1

    cur.execute('UPDATE sessions SET finalized_at = %s WHERE session_id = %s', (datetime.now(timezone.utc), session_id))
    return summary


@router.post('/presence/sessions/{session_id}/finalize')
def finalize_session_endpoint(
    session_id: uuid.UUID,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    conn = get_connection()
    try:
        cur = conn.cursor()
        session = _session_row(cur, session_id)
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        _require_lecturer_owner(session, actor)
        summary = finalize_session(cur, session_id)
        conn.commit()
        cur.close()
        return {'status': 'finalized', 'session_id': str(session_id), 'summary': summary}
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not finalise session.')
    finally:
        release_connection(conn)


@router.get('/presence/sessions/{session_id}/outcomes')
def get_outcomes(
    session_id: uuid.UUID,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    conn = get_connection()
    try:
        cur = conn.cursor()
        session = _session_row(cur, session_id)
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        _require_lecturer_owner(session, actor)
        cur.execute(
            """SELECT o.matric_number, st.full_name, o.status, o.counts_as_present,
                      o.reason, o.finalized_at
               FROM attendance_outcomes o
               JOIN students st ON st.matric_number = o.matric_number
               WHERE o.session_id = %s ORDER BY o.matric_number""",
            (session_id,),
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                'matric_number': r[0], 'full_name': r[1], 'status': r[2],
                'counts_as_present': r[3], 'reason': r[4],
                'finalized_at': r[5].isoformat(),
            }
            for r in rows
        ]
    finally:
        release_connection(conn)


# ── Manual exemption (dead phone / device unavailable) ───────────────

@router.post('/presence/exemptions')
def create_exemption(
    req: ExemptionCreateRequest,
    request: Request,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    """Issue a single-use exemption link bound to one student and session."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        session = _session_row(cur, req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        _require_lecturer_owner(session, actor)

        cur.execute(
            'SELECT 1 FROM course_enrollments WHERE matric_number = %s AND course_code = %s',
            (req.matric_number, session[1]),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=403, detail='Student is not enrolled in this course.')

        cur.execute(
            """UPDATE presence_exemptions
               SET revoked_at = %s
               WHERE session_id = %s AND matric_number = %s AND used_at IS NULL AND revoked_at IS NULL""",
            (datetime.now(timezone.utc), req.session_id, req.matric_number),
        )

        raw_token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=req.expires_in_hours)
        cur.execute(
            """INSERT INTO presence_exemptions
               (token_hash, session_id, matric_number, reason, created_by, expires_at)
               VALUES (%s,%s,%s,%s,%s,%s)""",
            (_hash_token(raw_token), req.session_id, req.matric_number, req.reason, int(actor['sub']), expires_at),
        )
        conn.commit()
        cur.close()

        frontend_url = os.getenv('FRONTEND_URL', 'http://localhost:5173').rstrip('/')
        return {
            'token': raw_token,
            'claim_url': f'{frontend_url}/exemptions/{raw_token}',
            'expires_at': expires_at.isoformat(),
            'matric_number': req.matric_number,
            'session_id': str(req.session_id),
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not create exemption.')
    finally:
        release_connection(conn)


@router.get('/presence/exemptions/{token}/preview', response_model=ExemptionPreview)
def preview_exemption(token: str):
    """Public preview so a student can see what they are about to claim."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT e.session_id, s.course_code, e.expires_at, e.used_at, e.revoked_at
               FROM presence_exemptions e
               JOIN sessions s ON s.session_id = e.session_id
               WHERE e.token_hash = %s""",
            (_hash_token(token),),
        )
        row = cur.fetchone()
        cur.close()
        if not row:
            raise HTTPException(status_code=404, detail='Exemption link not found.')

        if row[4]:
            status = 'revoked'
        elif row[3]:
            status = 'used'
        elif _utc(row[2]) < datetime.now(timezone.utc):
            status = 'expired'
        else:
            status = 'active'
        return ExemptionPreview(
            session_id=row[0], course_code=row[1], status=status, expires_at=row[2],
        )
    finally:
        release_connection(conn)


@router.post('/presence/exemptions/{token}/claim', response_model=ExemptionClaimResponse)
def claim_exemption(
    token: str,
    request: Request,
    actor: dict = Depends(require_roles('student')),
):
    """Claim an exemption using the link token and the authenticated student."""
    matric = actor.get('matric_number')
    if not matric:
        raise HTTPException(status_code=400, detail='No matric_number in token payload.')

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT id, session_id, matric_number, reason, expires_at,
                      used_at, revoked_at, counts_as_present
               FROM presence_exemptions WHERE token_hash = %s""",
            (_hash_token(token),),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='Exemption link not found.')

        (
            exemption_id, session_id, target_matric, reason, expires_at,
            used_at, revoked_at, counts_as_present,
        ) = row

        if target_matric != matric:
            raise HTTPException(status_code=403, detail='This exemption belongs to another student.')
        if revoked_at:
            raise HTTPException(status_code=409, detail='This exemption was revoked.')
        if used_at:
            return ExemptionClaimResponse(
                status='already_claimed', session_id=session_id, matric_number=matric,
                counts_as_present=bool(counts_as_present),
                message='This exemption has already been claimed.',
            )
        if _utc(expires_at) < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail='This exemption link has expired.')

        cur.execute(
            """SELECT course_code FROM sessions WHERE session_id = %s""",
            (session_id,),
        )
        session = cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        cur.execute(
            'SELECT 1 FROM course_enrollments WHERE matric_number = %s AND course_code = %s',
            (matric, session[0]),
        )
        if not cur.fetchone():
            raise HTTPException(status_code=403, detail='You are not enrolled in this course.')

        now = datetime.now(timezone.utc)
        cur.execute(
            """INSERT INTO attendance_records
               (matric_number, session_id, matched_at, similarity_distance,
                method, confidence_band, synced_from_client)
               VALUES (%s,%s,%s,0.0,'manual_override','exempted',FALSE)
               ON CONFLICT (matric_number, session_id) DO NOTHING""",
            (matric, session_id, now),
        )

        cur.execute(
            """INSERT INTO attendance_outcomes
               (session_id, matric_number, status, counts_as_present, reason,
                evidence, finalized_at, finalized_by)
               VALUES (%s,%s,'exempted',%s,%s,%s,%s,'manual')
               ON CONFLICT (session_id, matric_number) DO UPDATE SET
                   status = 'exempted',
                   counts_as_present = EXCLUDED.counts_as_present,
                   reason = EXCLUDED.reason,
                   evidence = EXCLUDED.evidence,
                   finalized_at = EXCLUDED.finalized_at,
                   finalized_by = 'manual'""",
            (
                session_id, matric, bool(counts_as_present), f'Manual exemption: {reason}',
                Json({'exemption_id': exemption_id, 'channel': 'student_claim'}), now,
            ),
        )

        cur.execute(
            """UPDATE presence_exemptions
               SET used_at = %s, claim_ip = %s, claim_user_agent = %s
               WHERE id = %s AND used_at IS NULL""",
            (
                now,
                request.client.host if request.client else None,
                request.headers.get('user-agent', '')[:300],
                exemption_id,
            ),
        )
        conn.commit()
        cur.close()

        return ExemptionClaimResponse(
            status='claimed', session_id=session_id, matric_number=matric,
            counts_as_present=bool(counts_as_present),
            message='Exemption recorded. Your attendance has been updated.',
        )
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not claim exemption.')
    finally:
        release_connection(conn)


# ── LLM-assisted review (advisory, human-approved) ──────────────────

@router.post('/presence/reviews/generate')
def generate_review(
    req: ReviewGenerateRequest,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    """
    Generate a validated LLM suggestion for one pending-review outcome.

    The LLM output is stored, never applied. A separate human decision endpoint
    is the only way to change attendance_outcomes from this workflow.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        session = _session_row(cur, req.session_id)
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        _require_lecturer_owner(session, actor)

        cur.execute(
            """SELECT status, reason, evidence
               FROM attendance_outcomes
               WHERE session_id = %s AND matric_number = %s""",
            (req.session_id, req.matric_number),
        )
        outcome = cur.fetchone()
        if not outcome:
            raise HTTPException(status_code=404, detail='Outcome not found for this student.')
        if outcome[0] != 'pending_review':
            raise HTTPException(status_code=400, detail='Only pending_review outcomes can be reviewed.')

        cur.execute(
            """SELECT reason FROM presence_exemptions
               WHERE session_id = %s AND matric_number = %s
                 AND used_at IS NOT NULL AND revoked_at IS NULL
               ORDER BY used_at DESC LIMIT 1""",
            (req.session_id, req.matric_number),
        )
        exemption_row = cur.fetchone()

        context = {
            'session_id': str(req.session_id),
            'course_code': session[1],
            'matric_number': req.matric_number,
            'session_start': session[3].isoformat() if session[3] else None,
            'session_end': session[4].isoformat() if session[4] else None,
            'policy_reason': outcome[1],
            'evidence': outcome[2] or {},
            'exemption_reason': exemption_row[0] if exemption_row else None,
        }

        suggestion, meta = generate_llm_review(context)

        cur.execute(
            """INSERT INTO llm_presence_reviews
               (session_id, matric_number, recommended_status, confidence,
                reason_summary, entities, draft_message, model, prompt_version,
                fallback_used, fallback_reason, raw_response, created_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               RETURNING id, created_at""",
            (
                req.session_id, req.matric_number, suggestion.recommended_status,
                suggestion.confidence, suggestion.reason_summary,
                Json(suggestion.entities.model_dump()), suggestion.draft_message,
                meta['model'], meta['prompt_version'], meta['fallback_used'],
                meta['fallback_reason'],
                Json(meta['raw_response']) if meta['raw_response'] else None,
                int(actor['sub']),
            ),
        )
        review_id, created_at = cur.fetchone()

        _audit(
            cur,
            review_id=review_id,
            session_id=req.session_id,
            matric_number=req.matric_number,
            action='generated',
            actor_id=int(actor['sub']),
            detail={
                'model': meta['model'],
                'prompt_version': meta['prompt_version'],
                'fallback_used': meta['fallback_used'],
                'fallback_reason': meta['fallback_reason'],
                'confidence': suggestion.confidence,
            },
        )
        conn.commit()
        cur.close()

        return {
            'id': review_id,
            'session_id': str(req.session_id),
            'matric_number': req.matric_number,
            'recommended_status': suggestion.recommended_status,
            'confidence': suggestion.confidence,
            'reason_summary': suggestion.reason_summary,
            'entities': suggestion.entities.model_dump(),
            'draft_message': suggestion.draft_message,
            'model': meta['model'],
            'fallback_used': meta['fallback_used'],
            'created_at': created_at.isoformat(),
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not generate LLM review.')
    finally:
        release_connection(conn)


@router.get('/presence/reviews')
def list_reviews(
    session_id: uuid.UUID,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    """List generated suggestions and the latest human decision for a session."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        session = _session_row(cur, session_id)
        if not session:
            raise HTTPException(status_code=404, detail='Session not found.')
        _require_lecturer_owner(session, actor)

        cur.execute(
            """SELECT r.id, r.matric_number, st.full_name, r.recommended_status,
                      r.confidence, r.reason_summary, r.entities, r.draft_message,
                      r.model, r.prompt_version, r.fallback_used, r.fallback_reason,
                      r.created_at, d.action, d.final_status, d.note, d.decided_at
               FROM llm_presence_reviews r
               JOIN students st ON st.matric_number = r.matric_number
               LEFT JOIN LATERAL (
                   SELECT action, final_status, note, decided_at
                   FROM llm_review_decisions
                   WHERE review_id = r.id ORDER BY decided_at DESC LIMIT 1
               ) d ON TRUE
               WHERE r.session_id = %s
               ORDER BY r.created_at DESC""",
            (session_id,),
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                'id': r[0], 'matric_number': r[1], 'full_name': r[2],
                'recommended_status': r[3],
                'confidence': float(r[4]) if r[4] is not None else None,
                'reason_summary': r[5], 'entities': r[6],
                'draft_message': r[7], 'model': r[8],
                'prompt_version': r[9], 'fallback_used': r[10],
                'fallback_reason': r[11], 'created_at': r[12].isoformat(),
                'decision_action': r[13], 'final_status': r[14],
                'decision_note': r[15],
                'decided_at': r[16].isoformat() if r[16] else None,
            }
            for r in rows
        ]
    finally:
        release_connection(conn)


@router.post('/presence/reviews/{review_id}/decision')
def decide_review(
    review_id: int,
    req: ReviewDecisionRequest,
    actor: dict = Depends(require_roles('lecturer', 'admin')),
):
    """Apply a lecturer/admin decision to an LLM suggestion."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT r.session_id, r.matric_number, r.recommended_status, s.lecturer_id
               FROM llm_presence_reviews r
               JOIN sessions s ON s.session_id = r.session_id
               WHERE r.id = %s""",
            (review_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail='Review not found.')
        session_id, matric_number, recommended_status, lecturer_id = row
        _require_owner(lecturer_id, actor)

        if req.action == 'override' and not req.final_status:
            raise HTTPException(status_code=400, detail='Override requires final_status.')

        if req.action == 'approve':
            final_status = recommended_status
        elif req.action == 'override':
            final_status = req.final_status
        else:
            final_status = None

        if req.action != 'reject':
            reason = f'Human-approved LLM review ({req.action}): {req.note or recommended_status}'
            cur.execute(
                """UPDATE attendance_outcomes
                   SET status = %s, counts_as_present = %s, reason = %s,
                       finalized_at = %s, finalized_by = 'human_review'
                   WHERE session_id = %s AND matric_number = %s""",
                (
                    final_status,
                    final_status in ('present', 'exempted'),
                    reason,
                    datetime.now(timezone.utc),
                    session_id,
                    matric_number,
                ),
            )

        cur.execute(
            """INSERT INTO llm_review_decisions
               (review_id, session_id, matric_number, action, final_status, note, decided_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (
                review_id, session_id, matric_number, req.action,
                final_status, req.note, int(actor['sub']),
            ),
        )
        _audit(
            cur,
            review_id=review_id,
            session_id=session_id,
            matric_number=matric_number,
            action='decision',
            actor_id=int(actor['sub']),
            detail={
                'action': req.action,
                'final_status': final_status,
                'note': req.note,
            },
        )
        conn.commit()
        cur.close()
        return {
            'status': 'recorded',
            'review_id': review_id,
            'action': req.action,
            'final_status': final_status,
            'outcome_updated': req.action != 'reject',
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise HTTPException(status_code=500, detail='Could not record review decision.')
    finally:
        release_connection(conn)
