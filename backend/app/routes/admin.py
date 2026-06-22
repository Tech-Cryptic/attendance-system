"""
Admin management endpoints — /admin/*
Requires admin role JWT on every route.
"""
import csv
import io
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db.database import get_connection, release_connection
from app.auth.jwt import require_roles

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Students ─────────────────────────────────────────────────

@router.get("/students")
def list_students(actor: dict = Depends(require_roles("admin"))):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT matric_number, full_name, enrolled_at,
                      high_similarity_flag, flagged_pair_matric, consent_version
               FROM students
               ORDER BY enrolled_at DESC"""
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                "matric_number":        r[0],
                "full_name":            r[1],
                "enrolled_at":          r[2].isoformat(),
                "high_similarity_flag": r[3],
                "flagged_pair_matric":  r[4],
                "consent_version":      r[5],
            }
            for r in rows
        ]
    finally:
        release_connection(conn)


@router.get("/courses")
def list_courses(actor: dict = Depends(require_roles("admin", "lecturer"))):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.course_code, c.course_title,
                      COUNT(DISTINCT ce.matric_number) as enrolled_count
               FROM courses c
               LEFT JOIN course_enrollments ce ON ce.course_code = c.course_code
               GROUP BY c.course_code
               ORDER BY c.course_code"""
        )
        rows = cur.fetchall()
        cur.close()
        return [{"course_code": r[0], "course_title": r[1], "enrolled_count": r[2]} for r in rows]
    finally:
        release_connection(conn)


class CourseCreate(BaseModel):
    course_code: str
    course_title: str


@router.post("/courses", status_code=201)
def create_course(
    course: CourseCreate,
    actor: dict = Depends(require_roles("admin"))
):
    """Admin-only: create a new course."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO courses (course_code, course_title) VALUES (%s, %s) "
            "ON CONFLICT (course_code) DO NOTHING RETURNING course_code",
            (course.course_code.strip().upper(), course.course_title.strip())
        )
        result = cur.fetchone()
        conn.commit()
        cur.close()
        if not result:
            raise HTTPException(status_code=409, detail=f"Course {course.course_code} already exists")
        return {"course_code": course.course_code.strip().upper(), "course_title": course.course_title.strip(), "enrolled_count": 0}
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


@router.get("/lecturers")
def list_lecturers(actor: dict = Depends(require_roles("admin"))):
    """Return all lecturer accounts — used for course assignment dropdowns."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, full_name, email FROM users WHERE role = 'lecturer' ORDER BY full_name"
        )
        rows = cur.fetchall()
        cur.close()
        return [{"id": r[0], "full_name": r[1], "email": r[2]} for r in rows]
    finally:
        release_connection(conn)




# ── Export ────────────────────────────────────────────────────

@router.get("/export/attendance.csv")
def export_attendance_csv(actor: dict = Depends(require_roles("admin", "lecturer"))):
    """Download all attendance records as CSV."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT ar.matric_number, st.full_name, ar.session_id,
                      s.course_code, c.course_title,
                      ar.matched_at, ar.similarity_distance,
                      ar.liveness_ear_score, ar.liveness_rppg_score,
                      ar.method, ar.synced_from_client
               FROM attendance_records ar
               JOIN students st ON st.matric_number = ar.matric_number
               JOIN sessions s  ON s.session_id     = ar.session_id
               JOIN courses c   ON c.course_code     = s.course_code
               ORDER BY ar.matched_at DESC"""
        )
        rows = cur.fetchall()
        cur.close()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Matric Number", "Full Name", "Session ID",
            "Course Code", "Course Title",
            "Matched At (UTC)", "Similarity Distance",
            "EAR Liveness Score", "rPPG Liveness Score",
            "Method", "Synced From Client"
        ])
        for r in rows:
            writer.writerow([
                r[0], r[1], str(r[2]),
                r[3], r[4],
                r[5].isoformat() if r[5] else "",
                f"{r[6]:.4f}" if r[6] is not None else "",
                f"{r[7]:.3f}" if r[7] is not None else "",
                f"{r[8]:.3f}" if r[8] is not None else "",
                r[9], str(r[10])
            ])
        output.seek(0)

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=attendance_export.csv"}
        )
    finally:
        release_connection(conn)


@router.get("/export/students.csv")
def export_students_csv(actor: dict = Depends(require_roles("admin"))):
    """Download all enrolled students as CSV."""
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.matric_number, s.full_name, s.enrolled_at,
                      s.high_similarity_flag, s.flagged_pair_matric
               FROM students s
               ORDER BY s.enrolled_at DESC"""
        )
        rows = cur.fetchall()
        cur.close()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Matric Number", "Full Name", "Enrolled At",
                         "Similarity Flag", "Flagged Pair"])
        for r in rows:
            writer.writerow([r[0], r[1], r[2].isoformat() if r[2] else "",
                             r[3], r[4] or ""])
        output.seek(0)

        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=students_export.csv"}
        )
    finally:
        release_connection(conn)


# ── Admin: issue enrollment token ────────────────────────────

class TokenRequest(BaseModel):
    course_code: str
    matric_number: str = ""
    expires_in_hours: int = 24

@router.post("/tokens")
def create_token_admin(
    req: TokenRequest,
    actor: dict = Depends(require_roles("admin"))
):
    """Issue a single-use enrollment token for a course."""
    import secrets as _secrets
    from datetime import datetime, timedelta, timezone

    conn = get_connection()
    try:
        cur = conn.cursor()

        # Verify course exists
        cur.execute("SELECT course_code FROM courses WHERE course_code = %s", (req.course_code,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail=f"Course {req.course_code} not found")

        token = _secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=req.expires_in_hours)
        matric = req.matric_number.strip() or None

        cur.execute(
            "INSERT INTO enrollment_tokens (token, course_code, matric_number, expires_at) "
            "VALUES (%s, %s, %s, %s)",
            (token, req.course_code, matric, expires)
        )
        conn.commit()
        cur.close()
        return {"token": token, "course_code": req.course_code,
                "matric_number": matric, "expires_at": expires.isoformat()}
    except HTTPException:
        conn.rollback(); raise
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        release_connection(conn)


# ── Lecturer: sessions + courses ──────────────────────────────

from fastapi import APIRouter as _AR
lecturer_router = _AR(prefix="/lecturer", tags=["lecturer"])


@lecturer_router.get("/sessions")
def get_lecturer_sessions(actor: dict = Depends(require_roles("lecturer", "admin"))):
    """Return sessions created by this lecturer."""
    lecturer_id = int(actor["sub"])
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT s.session_id, s.course_code, s.started_at, s.expires_at,
                      s.ended_at, s.active,
                      COUNT(ar.id) as attendance_count
               FROM sessions s
               LEFT JOIN attendance_records ar ON ar.session_id = s.session_id
               WHERE s.lecturer_id = %s
               GROUP BY s.session_id
               ORDER BY s.started_at DESC""",
            (lecturer_id,)
        )
        rows = cur.fetchall()
        cur.close()
        return [
            {
                "session_id":       str(r[0]),
                "course_code":      r[1],
                "started_at":       r[2].isoformat(),
                "expires_at":       r[3].isoformat(),
                "ended_at":         r[4].isoformat() if r[4] else None,
                "active":           r[5],
                "attendance_count": r[6],
            }
            for r in rows
        ]
    finally:
        release_connection(conn)


@lecturer_router.get("/courses")
def get_lecturer_courses(actor: dict = Depends(require_roles("lecturer", "admin"))):
    """Return courses assigned to this lecturer."""
    lecturer_id = int(actor["sub"])
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """SELECT c.course_code, c.course_title,
                      COUNT(DISTINCT ce.matric_number) as enrolled_count
               FROM courses c
               LEFT JOIN course_enrollments ce ON ce.course_code = c.course_code
               WHERE c.lecturer_id = %s
               GROUP BY c.course_code
               ORDER BY c.course_code""",
            (lecturer_id,)
        )
        rows = cur.fetchall()
        cur.close()
        return [{"course_code": r[0], "course_title": r[1], "enrolled_count": r[2]} for r in rows]
    finally:
        release_connection(conn)

