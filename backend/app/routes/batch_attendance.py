"""
Batch attendance endpoints — lecturer-operated proximity batch scan.

POST /attendance/batch
  • Accepts a list of matched face records from the BatchScanPage
  • Inserts attendance for each matched student in one transaction
  • Updates session batch_scan_done flag

POST /attendance/fallback-release
  • Lecturer triggers fallback QR window for unmatched enrolled students
  • Sets fallback_released = TRUE and fallback_expires_at on the session

POST /attendance/fallback-claim
  • Student claims attendance via time-bound fallback QR from their dashboard
  • Only works if: session active + fallback_released + within fallback window
  • Method stored as 'fallback_qr'

GET /attendance/session/{session_id}/status
  • Returns matched + unmatched enrolled students for a session
  • Used by SessionPage after batch scan to show the unmatched list
"""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional

from app.db.database import get_connection, release_connection
from app.auth.jwt import require_roles

router = APIRouter(prefix="/attendance", tags=["attendance"])

FALLBACK_WINDOW_MINUTES = 15   # fallback QR valid for 15 minutes after release


# ── Schemas ───────────────────────────────────────────────────

class BatchFaceRecord(BaseModel):
    matric_number: str
    similarity_distance: float
    confidence_band: str          # 'high' | 'uncertain'
    liveness_ear_score: Optional[float] = None
    liveness_rppg_score: Optional[float] = None


class BatchAttendanceRequest(BaseModel):
    session_id: str
    records: List[BatchFaceRecord]
    client_uuid: Optional[str] = None


class FallbackReleaseRequest(BaseModel):
    session_id: str


class FallbackClaimRequest(BaseModel):
    session_id: str
    matric_number: str


# ── Batch face attendance ─────────────────────────────────────

@router.post("/batch")
def submit_batch_attendance(
    req: BatchAttendanceRequest,
    actor: dict = Depends(require_roles("lecturer", "admin"))
):
    """
    Lecturer submits all matched faces from a proximity batch scan.
    Inserts attendance records for each matched student in one transaction.
    """
    if not req.records:
        raise HTTPException(status_code=400, detail="No face records provided")

    conn = get_connection()
    try:
        cur = conn.cursor()

        # Validate session
        cur.execute(
            "SELECT session_id, course_code, active, expires_at FROM sessions WHERE session_id = %s",
            (req.session_id,)
        )
        session = cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        session_id, course_code, active, expires_at = session
        if not active:
            raise HTTPException(status_code=400, detail="Session is no longer active")
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Session has expired")

        inserted = []
        skipped  = []
        now = datetime.now(timezone.utc)

        for rec in req.records:
            # Verify student is enrolled in this course
            cur.execute(
                "SELECT 1 FROM course_enrollments WHERE matric_number = %s AND course_code = %s",
                (rec.matric_number, course_code)
            )
            if not cur.fetchone():
                skipped.append({"matric_number": rec.matric_number, "reason": "not enrolled in course"})
                continue

            # Insert — skip if already marked (UNIQUE constraint)
            try:
                cur.execute(
                    """INSERT INTO attendance_records
                       (matric_number, session_id, matched_at, similarity_distance,
                        liveness_ear_score, liveness_rppg_score,
                        method, confidence_band, synced_from_client, client_uuid)
                       VALUES (%s, %s, %s, %s, %s, %s, 'batch_face', %s, FALSE, %s)""",
                    (
                        rec.matric_number, req.session_id, now,
                        rec.similarity_distance,
                        rec.liveness_ear_score, rec.liveness_rppg_score,
                        rec.confidence_band, req.client_uuid
                    )
                )
                inserted.append(rec.matric_number)
            except Exception:
                conn.rollback()
                skipped.append({"matric_number": rec.matric_number, "reason": "already marked"})
                continue

        # Update session batch scan stats
        cur.execute(
            """UPDATE sessions
               SET batch_scan_done = TRUE,
                   batch_scanned_at = %s,
                   batch_matched_count = batch_matched_count + %s
               WHERE session_id = %s""",
            (now, len(inserted), req.session_id)
        )
        conn.commit()
        cur.close()

        return {
            "session_id":   req.session_id,
            "inserted":     len(inserted),
            "skipped":      len(skipped),
            "matched":      inserted,
            "skipped_detail": skipped,
        }

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


# ── Fallback QR release ───────────────────────────────────────

@router.post("/fallback-release")
def release_fallback_qr(
    req: FallbackReleaseRequest,
    actor: dict = Depends(require_roles("lecturer", "admin"))
):
    """
    Lecturer explicitly releases the fallback QR window.
    Only unmatched enrolled students will see the QR on their dashboard.
    QR window is time-bound (FALLBACK_WINDOW_MINUTES).
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT session_id, active, batch_scan_done FROM sessions WHERE session_id = %s",
            (req.session_id,)
        )
        session = cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        _, active, batch_done = session
        if not active:
            raise HTTPException(status_code=400, detail="Session is not active")
        if not batch_done:
            raise HTTPException(status_code=400, detail="Run batch scan before releasing fallback")

        now = datetime.now(timezone.utc)
        fallback_expires = now + timedelta(minutes=FALLBACK_WINDOW_MINUTES)

        cur.execute(
            """UPDATE sessions
               SET fallback_released = TRUE,
                   fallback_released_at = %s,
                   fallback_expires_at  = %s
               WHERE session_id = %s""",
            (now, fallback_expires, req.session_id)
        )
        conn.commit()
        cur.close()
        return {
            "session_id":         req.session_id,
            "fallback_released":  True,
            "fallback_expires_at": fallback_expires.isoformat(),
            "window_minutes":     FALLBACK_WINDOW_MINUTES,
        }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


# ── Fallback QR claim ─────────────────────────────────────────

@router.post("/fallback-claim")
def claim_fallback_attendance(
    req: FallbackClaimRequest,
    actor: dict = Depends(require_roles("student"))
):
    """
    Student claims attendance via their time-bound dashboard QR.
    Only succeeds if:
      - session active + fallback_released + within fallback window
      - student enrolled in the course
      - student NOT already marked present
    """
    # Students can only claim for themselves
    if actor.get("matric") != req.matric_number:
        raise HTTPException(status_code=403, detail="You can only claim attendance for yourself")

    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT session_id, course_code, active, fallback_released,
                      fallback_expires_at
               FROM sessions WHERE session_id = %s""",
            (req.session_id,)
        )
        session = cur.fetchone()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        session_id, course_code, active, fallback_released, fallback_expires = session

        if not active:
            raise HTTPException(status_code=400, detail="Session is no longer active")
        if not fallback_released:
            raise HTTPException(status_code=400, detail="Fallback QR has not been released for this session")
        if fallback_expires and fallback_expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Fallback QR window has expired")

        # Check enrollment
        cur.execute(
            "SELECT 1 FROM course_enrollments WHERE matric_number = %s AND course_code = %s",
            (req.matric_number, course_code)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=403, detail="You are not enrolled in this course")

        # Check already marked
        cur.execute(
            "SELECT 1 FROM attendance_records WHERE matric_number = %s AND session_id = %s",
            (req.matric_number, req.session_id)
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="You are already marked present for this session")

        now = datetime.now(timezone.utc)
        cur.execute(
            """INSERT INTO attendance_records
               (matric_number, session_id, matched_at, similarity_distance,
                method, confidence_band)
               VALUES (%s, %s, %s, 0.0, 'fallback_qr', 'fallback')""",
            (req.matric_number, req.session_id, now)
        )
        conn.commit()
        cur.close()
        return {"marked": True, "method": "fallback_qr", "session_id": req.session_id}

    except HTTPException:
        conn.rollback()
        raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


# ── Session status (matched vs. unmatched) ───────────────────

@router.get("/session/{session_id}/status")
def get_session_status(
    session_id: str,
    actor: dict = Depends(require_roles("lecturer", "admin"))
):
    """
    Returns enrolled students split into: matched (present) and unmatched.
    Used by SessionPage to show who to include in fallback release.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()

        # Get session info
        cur.execute(
            """SELECT course_code, active, batch_scan_done, batch_matched_count,
                      fallback_released, fallback_expires_at
               FROM sessions WHERE session_id = %s""",
            (session_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        course_code, active, batch_done, batch_count, fallback_released, fallback_expires = row

        # All enrolled students
        cur.execute(
            """SELECT s.matric_number, s.full_name
               FROM course_enrollments ce
               JOIN students s ON s.matric_number = ce.matric_number
               WHERE ce.course_code = %s
               ORDER BY s.full_name""",
            (course_code,)
        )
        all_enrolled = cur.fetchall()

        # Already marked present
        cur.execute(
            """SELECT matric_number, method, confidence_band
               FROM attendance_records WHERE session_id = %s""",
            (session_id,)
        )
        marked = {r[0]: {"method": r[1], "confidence_band": r[2]} for r in cur.fetchall()}
        cur.close()

        matched   = [{"matric_number": m, "full_name": n, **marked[m]}
                     for m, n in all_enrolled if m in marked]
        unmatched = [{"matric_number": m, "full_name": n}
                     for m, n in all_enrolled if m not in marked]

        return {
            "session_id":         session_id,
            "course_code":        course_code,
            "active":             active,
            "batch_scan_done":    batch_done,
            "batch_matched_count": batch_count,
            "fallback_released":  fallback_released,
            "fallback_expires_at": fallback_expires.isoformat() if fallback_expires else None,
            "total_enrolled":     len(all_enrolled),
            "matched":            matched,
            "unmatched":          unmatched,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)
