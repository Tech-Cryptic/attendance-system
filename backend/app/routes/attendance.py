import secrets
import numpy as np
import json
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional

from app.db.database import get_connection, release_connection
from app.auth.jwt import require_roles
from app.qr.signing import sign_session_payload, verify_session_payload

router = APIRouter()

# ── Cosine similarity (server-side verification) ──────────────
def cosine_similarity(a: list, b: list) -> float:
    va, vb = np.array(a), np.array(b)
    n = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / n) if n > 0 else 0.0

MATCH_THRESHOLD = 0.60


# ── Student: own attendance history ───────────────────────────

@router.get("/student/attendance")
def get_student_attendance(actor: dict = Depends(require_roles("student", "admin"))):
    """Return the authenticated student's attendance history."""
    matric = actor.get("matric_number")
    if not matric:
        raise HTTPException(status_code=400, detail="No matric_number in token payload")
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT ar.session_id, s.course_code, c.course_title,
                      ar.matched_at, ar.similarity_distance,
                      ar.liveness_ear_score, ar.method, ar.synced_from_client
               FROM attendance_records ar
               JOIN sessions s ON s.session_id = ar.session_id
               JOIN courses  c ON c.course_code = s.course_code
               WHERE ar.matric_number = %s
               ORDER BY ar.matched_at DESC""",
            (matric,)
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                "session_id":         str(r[0]),
                "course_code":        r[1],
                "course_title":       r[2],
                "matched_at":         r[3].isoformat(),
                "similarity_distance":r[4],
                "liveness_ear_score": r[5],
                "method":             r[6],
                "synced_from_client": r[7],
            }
            for r in rows
        ]
    finally:
        release_connection(conn)


# ── Student: active fallback QR sessions ──────────────────────

@router.get("/student/fallback-sessions")
def get_student_fallback_sessions(actor: dict = Depends(require_roles("student"))):
    """
    Return any active sessions where:
    - Fallback QR has been released by the lecturer
    - The fallback window has not expired
    - The student is enrolled in the course
    - The student has NOT already been marked present
    Used by StudentDashboard to conditionally show the fallback QR widget.
    """
    matric = actor.get("matric_number")
    if not matric:
        raise HTTPException(status_code=400, detail="No matric_number in token payload")

    conn = get_connection()
    try:
        cur = conn.cursor()
        now = datetime.now(timezone.utc)
        cur.execute(
            """SELECT s.session_id, s.course_code, s.fallback_expires_at
               FROM sessions s
               JOIN course_enrollments ce ON ce.course_code = s.course_code
               WHERE ce.matric_number   = %s
                 AND s.active            = TRUE
                 AND s.fallback_released = TRUE
                 AND s.fallback_expires_at > %s
                 AND NOT EXISTS (
                   SELECT 1 FROM attendance_records ar
                   WHERE ar.session_id    = s.session_id
                     AND ar.matric_number = %s
                 )
               ORDER BY s.fallback_expires_at ASC""",
            (matric, now, matric)
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                "session_id":       str(r[0]),
                "course_code":      r[1],
                "fallback_expires_at": r[2].isoformat(),
                "minutes_remaining": max(0, int((r[2] - now).total_seconds() / 60)),
            }
            for r in rows
        ]
    finally:
        release_connection(conn)


# ── Pydantic models ───────────────────────────────────────────

class SessionCreate(BaseModel):
    course_code:      str
    duration_minutes: int = Field(default=60, ge=10, le=480)

class SessionOut(BaseModel):
    session_id:  str
    course_code: str
    qr_payload:  str
    qr_signature: str
    started_at:  datetime
    expires_at:  datetime

class AttendanceMarkRequest(BaseModel):
    session_id:         str
    qr_payload:         str
    qr_signature:       str
    embedding:          list[float] = Field(..., min_length=1024, max_length=1024)
    liveness_ear_score: Optional[float] = None
    liveness_rppg_score:Optional[float] = None
    iris_distance:      Optional[float] = None
    method:             str = "face"
    synced_from_client: bool = False
    client_uuid:        Optional[str] = None

class SyncBatchRequest(BaseModel):
    records: list[AttendanceMarkRequest]
    client_uuid: str


# ── Session Management ────────────────────────────────────────

@router.post("/sessions", response_model=SessionOut)
def create_session(
    req: SessionCreate,
    actor: dict = Depends(require_roles("lecturer", "admin"))
):
    """Create an attendance session and return a signed QR payload."""
    conn = get_connection()
    try:
        cur = conn.cursor()

        # Verify course exists
        cur.execute("SELECT course_code FROM courses WHERE course_code = %s", (req.course_code,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Course not found")

        started_at  = datetime.now(timezone.utc)
        expires_at  = started_at + timedelta(minutes=req.duration_minutes)
        qr_token    = secrets.token_urlsafe(16)

        # Build signed QR before insert (need expires_at string)
        expires_iso = expires_at.isoformat()

        # Insert session (session_id generated by DB)
        cur.execute(
            """INSERT INTO sessions
               (course_code, lecturer_id, qr_token, qr_signature, started_at, expires_at, active)
               VALUES (%s, %s, %s, %s, %s, %s, TRUE)
               RETURNING session_id""",
            (req.course_code, int(actor["sub"]), qr_token, "pending", started_at, expires_at)
        )
        session_id = str(cur.fetchone()[0])

        # Sign QR with real session_id
        qr_data = sign_session_payload(session_id, req.course_code, expires_iso)

        # Store the real signature
        cur.execute(
            "UPDATE sessions SET qr_signature = %s WHERE session_id = %s",
            (qr_data["signature"], session_id)
        )
        conn.commit()
        cur.close()

        return SessionOut(
            session_id=session_id,
            course_code=req.course_code,
            qr_payload=qr_data["payload"],
            qr_signature=qr_data["signature"],
            started_at=started_at,
            expires_at=expires_at,
        )
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


@router.get("/sessions/{session_id}")
def get_session(
    session_id: str,
    actor: dict = Depends(require_roles("lecturer", "admin", "student"))
):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.session_id, s.course_code, s.started_at, s.expires_at, s.active,
                      c.course_title,
                      COUNT(ar.id) as attendance_count
               FROM sessions s
               JOIN courses c ON c.course_code = s.course_code
               LEFT JOIN attendance_records ar ON ar.session_id = s.session_id
               WHERE s.session_id = %s
               GROUP BY s.session_id, c.course_title""",
            (session_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")

        sid, cc, started, expires, active, title, count = row

        # Fetch attendance list
        cur.execute(
            """SELECT ar.matric_number, st.full_name, ar.matched_at,
                      ar.similarity_distance, ar.liveness_ear_score,
                      ar.liveness_rppg_score, ar.method, ar.synced_from_client
               FROM attendance_records ar
               JOIN students st ON st.matric_number = ar.matric_number
               WHERE ar.session_id = %s
               ORDER BY ar.matched_at ASC""",
            (session_id,)
        )
        records = [
            {
                "matric_number": r[0], "full_name": r[1],
                "matched_at": r[2].isoformat(), "similarity_distance": r[3],
                "liveness_ear_score": r[4], "liveness_rppg_score": r[5],
                "method": r[6], "synced_from_client": r[7],
            }
            for r in cur.fetchall()
        ]
        cur.close()

        return {
            "session_id": str(sid), "course_code": cc, "course_title": title,
            "started_at": started.isoformat(), "expires_at": expires.isoformat(),
            "active": active, "attendance_count": count, "records": records,
            "is_expired": expires < datetime.now(timezone.utc),
        }
    finally:
        release_connection(conn)


@router.post("/sessions/{session_id}/end")
def end_session(
    session_id: str,
    actor: dict = Depends(require_roles("lecturer", "admin"))
):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "UPDATE sessions SET active = FALSE, ended_at = %s WHERE session_id = %s RETURNING session_id",
            (datetime.now(timezone.utc), session_id)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Session not found")
        conn.commit(); cur.close()
        return {"status": "ended", "session_id": session_id}
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


# ── Attendance Marking ────────────────────────────────────────

@router.post("/attendance/mark")
def mark_attendance(req: AttendanceMarkRequest):
    """
    Submit an attendance record.
    - Verifies the session QR signature (tamper-proof)
    - Performs server-side course-scoped embedding match
    - Inserts into attendance_records (or silently ignores duplicate)
    Called both in real-time (online) and during sync (offline queue drain).
    """
    # 1. Verify QR signature
    parsed = verify_session_payload(req.qr_payload, req.qr_signature)
    if not parsed:
        raise HTTPException(status_code=403, detail="Invalid or tampered session QR")

    qr_session_id  = parsed.get("session_id")
    qr_course_code = parsed.get("course_code")
    qr_expires_at  = parsed.get("expires_at")

    if qr_session_id != req.session_id:
        raise HTTPException(status_code=403, detail="Session ID mismatch in QR payload")

    # 2. Check expiry (allow 5-min grace for offline sync)
    try:
        exp = datetime.fromisoformat(qr_expires_at)
        grace = exp + timedelta(minutes=5)
        if datetime.now(timezone.utc) > grace:
            raise HTTPException(status_code=403, detail="Session QR has expired")
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid expiry in QR payload")

    conn = get_connection()
    try:
        cur = conn.cursor()

        # 3. Verify session exists and is for the correct course
        cur.execute(
            "SELECT course_code, active FROM sessions WHERE session_id = %s",
            (req.session_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Session not found")
        course_code, active = row
        if course_code != qr_course_code:
            raise HTTPException(status_code=403, detail="Course code mismatch")

        # 4. Load all embeddings for this course (server-side match)
        cur.execute(
            """SELECT s.matric_number, s.embedding, s.iris_embedding, s.high_similarity_flag
               FROM students s
               JOIN course_enrollments ce ON ce.matric_number = s.matric_number
               WHERE ce.course_code = %s""",
            (course_code,)
        )
        enrolled = cur.fetchall()
        if not enrolled:
            raise HTTPException(status_code=404, detail="No enrolled students found for this course")

        # 5. Course-scoped nearest-neighbour match
        best_match, best_sim = None, -1
        for matric, emb, iris_emb, flag in enrolled:
            sim = cosine_similarity(req.embedding, emb)
            if sim > best_sim:
                best_sim = sim
                best_match = {"matric_number": matric, "iris_embedding": iris_emb, "flag": flag}

        if best_sim < MATCH_THRESHOLD or not best_match:
            raise HTTPException(
                status_code=401,
                detail=f"Face not recognised (best similarity: {best_sim:.3f}). Please re-enroll or try again."
            )

        matched_matric   = best_match["matric_number"]
        similarity_distance = 1.0 - best_sim

        # Iris distance (supplementary — used for twin disambiguation logging)
        iris_dist = None
        if req.iris_distance is not None:
            iris_dist = req.iris_distance

        # 6. Insert attendance (UNIQUE constraint prevents double-marking)
        try:
            cur.execute(
                """INSERT INTO attendance_records
                   (matric_number, session_id, matched_at, similarity_distance,
                    liveness_ear_score, liveness_rppg_score, iris_distance,
                    method, synced_from_client, client_uuid)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (matric_number, session_id) DO NOTHING
                   RETURNING id""",
                (
                    matched_matric, req.session_id,
                    datetime.now(timezone.utc),
                    similarity_distance,
                    req.liveness_ear_score, req.liveness_rppg_score,
                    iris_dist, req.method,
                    req.synced_from_client, req.client_uuid
                )
            )
            result_row = cur.fetchone()
            already_marked = result_row is None
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        # 7. Log sync if from offline queue
        if req.synced_from_client and req.client_uuid:
            cur.execute(
                "INSERT INTO sync_log (client_uuid, session_id, record_count) VALUES (%s, %s, 1)",
                (req.client_uuid, req.session_id)
            )

        conn.commit()
        cur.close()

        return {
            "status":       "already_marked" if already_marked else "marked",
            "matric_number": matched_matric,
            "similarity":   round(best_sim, 4),
            "distance":     round(similarity_distance, 4),
            "session_id":   req.session_id,
        }

    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


@router.post("/attendance/sync")
def sync_batch(req: SyncBatchRequest):
    """Bulk sync offline attendance records from a client device."""
    results = []
    for record in req.records:
        record.synced_from_client = True
        record.client_uuid = req.client_uuid
        try:
            res = mark_attendance(record)
            results.append({"status": "ok", **res})
        except HTTPException as e:
            results.append({"status": "error", "detail": e.detail,
                            "session_id": record.session_id})
    return {"synced": len([r for r in results if r["status"] == "ok"]),
            "failed": len([r for r in results if r["status"] == "error"]),
            "results": results}


# ── Course Embeddings (for offline pre-caching) ───────────────

@router.get("/courses/{course_code}/embeddings")
def get_course_embeddings(
    course_code: str,
    actor: dict = Depends(require_roles("lecturer", "admin", "student"))
):
    """
    Return all 1024-dim face embeddings for enrolled students in a course.
    Used to pre-cache embeddings on client device for offline matching.
    NDPR: returns only mathematical vectors, no raw biometric images.
    """
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.matric_number, s.full_name, s.embedding, s.iris_embedding,
                      s.high_similarity_flag
               FROM students s
               JOIN course_enrollments ce ON ce.matric_number = s.matric_number
               WHERE ce.course_code = %s""",
            (course_code,)
        )
        rows = cur.fetchall()
        cur.close()
        return {
            "course_code": course_code,
            "count": len(rows),
            "embeddings": [
                {
                    "matric_number":       r[0],
                    "full_name":           r[1],
                    "embedding":           r[2],
                    "iris_embedding":      r[3],
                    "high_similarity_flag": r[4],
                }
                for r in rows
            ]
        }
    finally:
        release_connection(conn)


# ── Lecturer Courses ──────────────────────────────────────────

@router.get("/lecturer/courses")
def get_lecturer_courses(actor: dict = Depends(require_roles("lecturer", "admin"))):
    """Return courses belonging to the authenticated lecturer."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.course_code, c.course_title,
                      COUNT(DISTINCT ce.matric_number) as enrolled_count
               FROM courses c
               LEFT JOIN course_enrollments ce ON ce.course_code = c.course_code
               WHERE c.lecturer_id = %s OR %s = 'admin'
               GROUP BY c.course_code""",
            (int(actor["sub"]), actor["role"])
        )
        rows = cur.fetchall()
        cur.close()
        return [{"course_code": r[0], "course_title": r[1], "enrolled_count": r[2]}
                for r in rows]
    finally:
        release_connection(conn)


# ── Session History ───────────────────────────────────────────

@router.get("/lecturer/sessions")
def get_lecturer_sessions(actor: dict = Depends(require_roles("lecturer", "admin"))):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.session_id, s.course_code, c.course_title,
                      s.started_at, s.expires_at, s.active,
                      COUNT(ar.id) as attendance_count
               FROM sessions s
               JOIN courses c ON c.course_code = s.course_code
               LEFT JOIN attendance_records ar ON ar.session_id = s.session_id
               WHERE s.lecturer_id = %s OR %s = 'admin'
               GROUP BY s.session_id, c.course_title
               ORDER BY s.started_at DESC
               LIMIT 50""",
            (int(actor["sub"]), actor["role"])
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                "session_id": str(r[0]), "course_code": r[1], "course_title": r[2],
                "started_at": r[3].isoformat(), "expires_at": r[4].isoformat(),
                "active": r[5], "attendance_count": r[6],
            }
            for r in rows
        ]
    finally:
        release_connection(conn)
